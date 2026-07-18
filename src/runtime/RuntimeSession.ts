import {
  RUNTIME_FIXED_DELTA_SECONDS,
  RUNTIME_FIXED_HZ,
  RUNTIME_MAX_CATCH_UP_STEPS,
  RUNTIME_SYSTEM_ORDER,
  type RuntimeAdvanceDiagnostics,
  type RuntimeDiagnostics,
  type RuntimeFixedSystem,
  type RuntimeFixedUpdateContext,
  type RuntimeLifecycleContext,
  type RuntimeRenderContext,
  type RuntimeRenderSystem,
  type RuntimeSessionIdentity,
  type RuntimeSessionOptions,
  type RuntimeSessionStatus,
  type RuntimeSystem,
  type RuntimeSystemDiagnostics,
  type RuntimeSystemFailure,
  type RuntimeSystemPhase,
  type RuntimeSystemStage,
  type RuntimeUpdateSource,
} from './types';
import { cloneRuntimeIdentity, validateRuntimeIdentity, validateSafeToken } from './validation';

const MAX_RUNTIME_SYSTEMS = 256;
const FLOATING_POINT_EPSILON = 1e-9;

export type RuntimeSessionErrorCode =
  | 'invalid_argument'
  | 'invalid_transition'
  | 'disposed'
  | 'system_failure';

export class RuntimeSessionError extends Error {
  readonly code: RuntimeSessionErrorCode;

  constructor(code: RuntimeSessionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeSessionError';
    this.code = code;
  }
}

export class RuntimeSystemExecutionError extends RuntimeSessionError {
  readonly systemId: string;
  readonly stage: RuntimeSystemStage;
  readonly phase: RuntimeSystemPhase;

  constructor(failure: RuntimeSystemFailure) {
    super(
      'system_failure',
      `Runtime system "${failure.systemId}" failed during ${failure.phase}: ${failure.error.message}`,
      { cause: failure.error },
    );
    this.name = 'RuntimeSystemExecutionError';
    this.systemId = failure.systemId;
    this.stage = failure.stage;
    this.phase = failure.phase;
  }
}

interface MutableSystemDiagnostics extends RuntimeSystemDiagnostics {}

function defaultNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function systemOrder(stage: RuntimeSystemStage): number {
  return RUNTIME_SYSTEM_ORDER.indexOf(stage);
}

function normalizeRemainder(value: number): number {
  if (value < FLOATING_POINT_EPSILON || RUNTIME_FIXED_DELTA_SECONDS - value < FLOATING_POINT_EPSILON) return 0;
  return value;
}

function validateSystems(systems: readonly RuntimeSystem[]): void {
  if (!Array.isArray(systems)) {
    throw new RuntimeSessionError('invalid_argument', 'Runtime systems must be an array.');
  }
  if (systems.length > MAX_RUNTIME_SYSTEMS) {
    throw new RuntimeSessionError('invalid_argument', `Runtime sessions support at most ${MAX_RUNTIME_SYSTEMS} systems.`);
  }

  const ids = new Set<string>();
  for (const [index, system] of systems.entries()) {
    if (typeof system !== 'object' || system === null) {
      throw new RuntimeSessionError('invalid_argument', `Runtime system at index ${index} must be an object.`);
    }
    const idErrors = validateSafeToken(system.id, `systems[${index}].id`);
    if (idErrors.length) throw new RuntimeSessionError('invalid_argument', idErrors[0]);
    if (ids.has(system.id)) {
      throw new RuntimeSessionError('invalid_argument', `Runtime system id "${system.id}" is duplicated.`);
    }
    ids.add(system.id);
    if (!RUNTIME_SYSTEM_ORDER.includes(system.stage)) {
      throw new RuntimeSessionError('invalid_argument', `Runtime system "${system.id}" has unsupported stage "${String(system.stage)}".`);
    }
    if (system.stage === 'render' && typeof system.render !== 'function') {
      throw new RuntimeSessionError('invalid_argument', `Render system "${system.id}" must define render().`);
    }
    if (system.stage !== 'render' && typeof system.fixedUpdate !== 'function') {
      throw new RuntimeSessionError('invalid_argument', `Fixed system "${system.id}" must define fixedUpdate().`);
    }
  }
}

export class RuntimeSession {
  readonly identity: RuntimeSessionIdentity;

  private readonly systems: RuntimeSystem[];
  private readonly fixedSystems: RuntimeFixedSystem[];
  private readonly renderSystems: RuntimeRenderSystem[];
  private readonly systemDiagnostics = new Map<string, MutableSystemDiagnostics>();
  private readonly now: () => number;
  private readonly onSystemFailure?: (failure: RuntimeSystemFailure) => void;
  private readonly initializedSystems: RuntimeSystem[] = [];
  private initialized = false;

  private status: RuntimeSessionStatus = 'idle';
  private tick = 0;
  private frame = 0;
  private restartCount = 0;
  private simulationTimeSeconds = 0;
  private accumulatorSeconds = 0;
  private totalDroppedSeconds = 0;
  private catchUpClampCount = 0;
  private lastFailure: RuntimeDiagnostics['lastFailure'] = null;
  private lastAdvance: RuntimeAdvanceDiagnostics = {
    frameDeltaSeconds: 0,
    fixedSteps: 0,
    droppedSeconds: 0,
    interpolationAlpha: 0,
  };

  constructor(options: RuntimeSessionOptions) {
    const identityErrors = validateRuntimeIdentity(options.identity);
    if (identityErrors.length) throw new RuntimeSessionError('invalid_argument', identityErrors[0]);
    validateSystems(options.systems);
    if (options.now !== undefined && typeof options.now !== 'function') {
      throw new RuntimeSessionError('invalid_argument', 'Runtime clock must be a function.');
    }

    this.identity = Object.freeze(cloneRuntimeIdentity(options.identity));
    this.now = options.now ?? defaultNow;
    this.onSystemFailure = options.onSystemFailure;
    this.systems = options.systems
      .map((system, registrationIndex) => ({ system, registrationIndex }))
      .sort((left, right) => systemOrder(left.system.stage) - systemOrder(right.system.stage) || left.registrationIndex - right.registrationIndex)
      .map(({ system }) => system);
    this.fixedSystems = this.systems.filter((system): system is RuntimeFixedSystem => system.stage !== 'render');
    this.renderSystems = this.systems.filter((system): system is RuntimeRenderSystem => system.stage === 'render');

    for (const system of this.systems) {
      this.systemDiagnostics.set(system.id, {
        id: system.id,
        stage: system.stage,
        fixedUpdateCalls: 0,
        renderCalls: 0,
        lastDurationMs: 0,
        totalDurationMs: 0,
      });
    }
  }

  start(): RuntimeDiagnostics {
    this.assertNotDisposed('start');
    if (this.status !== 'idle') {
      throw new RuntimeSessionError('invalid_transition', `Cannot start a runtime session while it is ${this.status}.`);
    }

    this.initializeSystems();
    this.status = 'running';
    return this.getDiagnostics();
  }

  pause(): RuntimeDiagnostics {
    this.assertStatus('running', 'pause');
    this.status = 'paused';
    this.accumulatorSeconds = 0;
    for (const system of this.systems) this.invokeLifecycle(system, 'pause', system.pause);
    return this.getDiagnostics();
  }

  resume(): RuntimeDiagnostics {
    this.assertStatus('paused', 'resume');
    this.status = 'running';
    for (const system of this.systems) this.invokeLifecycle(system, 'resume', system.resume);
    return this.getDiagnostics();
  }

  step(): RuntimeDiagnostics {
    this.assertStatus('paused', 'step');
    this.accumulatorSeconds = 0;
    this.runFixedStep('manual-step');
    this.lastAdvance = {
      frameDeltaSeconds: 0,
      fixedSteps: 1,
      droppedSeconds: 0,
      interpolationAlpha: 0,
    };
    this.runRender(0, 1, 0);
    return this.getDiagnostics();
  }

  restart(): RuntimeDiagnostics {
    this.assertNotDisposed('restart');
    this.restartCount += 1;

    if (this.status === 'idle' || !this.initialized) {
      this.resetRunState();
      this.initializeSystems();
    } else {
      this.status = 'running';
      this.resetRunState();
      for (const system of this.systems) this.invokeLifecycle(system, 'restart', system.restart);
    }
    this.status = 'running';
    return this.getDiagnostics();
  }

  advance(frameDeltaSeconds: number): RuntimeDiagnostics {
    this.assertFrameDelta(frameDeltaSeconds);
    this.assertNotDisposed('advance');
    if (this.status !== 'running' && this.status !== 'paused') {
      throw new RuntimeSessionError('invalid_transition', `Cannot advance a runtime session while it is ${this.status}.`);
    }

    if (this.status === 'paused') {
      this.lastAdvance = {
        frameDeltaSeconds: 0,
        fixedSteps: 0,
        droppedSeconds: 0,
        interpolationAlpha: 0,
      };
      this.runRender(0, 0, 0);
      return this.getDiagnostics();
    }

    const accumulatedSeconds = this.accumulatorSeconds + frameDeltaSeconds;
    const availableSteps = Math.floor(accumulatedSeconds / RUNTIME_FIXED_DELTA_SECONDS + FLOATING_POINT_EPSILON);
    const fixedSteps = Math.min(availableSteps, RUNTIME_MAX_CATCH_UP_STEPS);
    const droppedSteps = Math.max(0, availableSteps - fixedSteps);
    this.accumulatorSeconds = normalizeRemainder(accumulatedSeconds % RUNTIME_FIXED_DELTA_SECONDS);
    const droppedSeconds = droppedSteps > 0
      ? Math.max(0, accumulatedSeconds - fixedSteps * RUNTIME_FIXED_DELTA_SECONDS - this.accumulatorSeconds)
      : 0;

    if (droppedSteps > 0) {
      this.totalDroppedSeconds = Math.min(Number.MAX_VALUE, this.totalDroppedSeconds + droppedSeconds);
      this.catchUpClampCount += 1;
    }
    for (let stepIndex = 0; stepIndex < fixedSteps; stepIndex += 1) this.runFixedStep('frame');

    const interpolationAlpha = this.accumulatorSeconds / RUNTIME_FIXED_DELTA_SECONDS;
    this.lastAdvance = {
      frameDeltaSeconds,
      fixedSteps,
      droppedSeconds,
      interpolationAlpha,
    };
    this.runRender(frameDeltaSeconds, fixedSteps, interpolationAlpha);
    return this.getDiagnostics();
  }

  dispose(): RuntimeDiagnostics {
    if (this.status === 'disposed') return this.getDiagnostics();

    for (const system of [...this.initializedSystems].reverse()) {
      if (!system.dispose) continue;
      try {
        system.dispose(this.lifecycleContext());
      } catch (cause) {
        this.recordSystemFailure(system, 'dispose', cause);
      }
    }
    this.initializedSystems.length = 0;
    this.initialized = false;
    this.accumulatorSeconds = 0;
    this.status = 'disposed';
    return this.getDiagnostics();
  }

  getDiagnostics(): RuntimeDiagnostics {
    return {
      ...cloneRuntimeIdentity(this.identity),
      status: this.status,
      fixedHz: RUNTIME_FIXED_HZ,
      fixedDeltaSeconds: RUNTIME_FIXED_DELTA_SECONDS,
      maxCatchUpSteps: RUNTIME_MAX_CATCH_UP_STEPS,
      tick: this.tick,
      frame: this.frame,
      restartCount: this.restartCount,
      simulationTimeSeconds: this.simulationTimeSeconds,
      accumulatorSeconds: this.accumulatorSeconds,
      totalDroppedSeconds: this.totalDroppedSeconds,
      catchUpClampCount: this.catchUpClampCount,
      lastAdvance: { ...this.lastAdvance },
      systems: this.systems.map((system) => ({ ...this.systemDiagnostics.get(system.id)! })),
      lastFailure: this.lastFailure ? { ...this.lastFailure } : null,
    };
  }

  private initializeSystems(): void {
    this.initializedSystems.length = 0;
    this.initialized = false;
    for (const system of this.systems) {
      try {
        if (system.initialize) system.initialize(this.lifecycleContext());
        this.initializedSystems.push(system);
      } catch (cause) {
        const executionError = this.recordSystemFailure(system, 'initialize', cause);
        this.cleanupPartialInitialization();
        throw executionError;
      }
    }
    this.initialized = true;
  }

  private cleanupPartialInitialization(): void {
    for (const system of [...this.initializedSystems].reverse()) {
      try {
        system.dispose?.(this.lifecycleContext());
      } catch (cause) {
        this.recordSystemFailure(system, 'dispose', cause);
      }
    }
    this.initializedSystems.length = 0;
    this.initialized = false;
  }

  private resetRunState(): void {
    this.tick = 0;
    this.frame = 0;
    this.simulationTimeSeconds = 0;
    this.accumulatorSeconds = 0;
    this.totalDroppedSeconds = 0;
    this.catchUpClampCount = 0;
    this.lastFailure = null;
    this.lastAdvance = {
      frameDeltaSeconds: 0,
      fixedSteps: 0,
      droppedSeconds: 0,
      interpolationAlpha: 0,
    };
    for (const diagnostics of this.systemDiagnostics.values()) {
      diagnostics.fixedUpdateCalls = 0;
      diagnostics.renderCalls = 0;
      diagnostics.lastDurationMs = 0;
      diagnostics.totalDurationMs = 0;
    }
  }

  private runFixedStep(source: RuntimeUpdateSource): void {
    const nextTick = this.tick + 1;
    const nextSimulationTime = nextTick * RUNTIME_FIXED_DELTA_SECONDS;
    const context: RuntimeFixedUpdateContext = {
      ...this.lifecycleContext(),
      source,
      tick: nextTick,
      fixedDeltaSeconds: RUNTIME_FIXED_DELTA_SECONDS,
      simulationTimeSeconds: nextSimulationTime,
    };

    for (const system of this.fixedSystems) {
      this.measureSystem(system, 'fixed-update', () => system.fixedUpdate(context));
    }
    this.tick = nextTick;
    this.simulationTimeSeconds = nextSimulationTime;
  }

  private runRender(frameDeltaSeconds: number, fixedSteps: number, interpolationAlpha: number): void {
    const nextFrame = this.frame + 1;
    const context: RuntimeRenderContext = {
      ...this.lifecycleContext(),
      frame: nextFrame,
      tick: this.tick,
      fixedDeltaSeconds: RUNTIME_FIXED_DELTA_SECONDS,
      simulationTimeSeconds: this.simulationTimeSeconds,
      frameDeltaSeconds,
      interpolationAlpha,
      fixedSteps,
    };
    for (const system of this.renderSystems) {
      this.measureSystem(system, 'render', () => system.render(context));
    }
    this.frame = nextFrame;
  }

  private measureSystem(system: RuntimeSystem, phase: 'fixed-update' | 'render', callback: () => void): void {
    const startedAt = this.now();
    try {
      callback();
    } catch (cause) {
      throw this.recordSystemFailure(system, phase, cause);
    } finally {
      const endedAt = this.now();
      const duration = Number.isFinite(endedAt - startedAt) ? Math.max(0, endedAt - startedAt) : 0;
      const diagnostics = this.systemDiagnostics.get(system.id)!;
      diagnostics.lastDurationMs = duration;
      diagnostics.totalDurationMs += duration;
      if (phase === 'fixed-update') diagnostics.fixedUpdateCalls += 1;
      else diagnostics.renderCalls += 1;
    }
  }

  private invokeLifecycle(
    system: RuntimeSystem,
    phase: Exclude<RuntimeSystemPhase, 'initialize' | 'fixed-update' | 'render' | 'dispose'>,
    callback: ((context: RuntimeLifecycleContext) => void) | undefined,
  ): void {
    if (!callback) return;
    try {
      callback.call(system, this.lifecycleContext());
    } catch (cause) {
      throw this.recordSystemFailure(system, phase, cause);
    }
  }

  private recordSystemFailure(system: RuntimeSystem, phase: RuntimeSystemPhase, cause: unknown): RuntimeSystemExecutionError {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const failure: RuntimeSystemFailure = {
      error,
      systemId: system.id,
      stage: system.stage,
      phase,
    };
    this.lastFailure = {
      code: 'system_failure',
      message: error.message,
      systemId: system.id,
      stage: system.stage,
      phase,
    };
    if (phase !== 'dispose') this.status = 'failed';
    try {
      this.onSystemFailure?.(failure);
    } catch {
      // Failure observers must not replace the originating runtime error.
    }
    return new RuntimeSystemExecutionError(failure);
  }

  private lifecycleContext(): RuntimeLifecycleContext {
    return {
      identity: this.identity,
      status: this.status,
      restartCount: this.restartCount,
    };
  }

  private assertFrameDelta(frameDeltaSeconds: number): void {
    if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds < 0) {
      throw new RuntimeSessionError('invalid_argument', 'Frame delta must be a finite, non-negative number of seconds.');
    }
  }

  private assertNotDisposed(operation: string): void {
    if (this.status === 'disposed') {
      throw new RuntimeSessionError('disposed', `Cannot ${operation} a disposed runtime session.`);
    }
  }

  private assertStatus(expected: RuntimeSessionStatus, operation: string): void {
    this.assertNotDisposed(operation);
    if (this.status !== expected) {
      throw new RuntimeSessionError('invalid_transition', `Cannot ${operation} a runtime session while it is ${this.status}; expected ${expected}.`);
    }
  }
}
