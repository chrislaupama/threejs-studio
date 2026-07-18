export const RUNTIME_FIXED_HZ = 60;
export const RUNTIME_FIXED_DELTA_SECONDS = 1 / RUNTIME_FIXED_HZ;
export const RUNTIME_MAX_CATCH_UP_STEPS = 5;

export const RUNTIME_FIXED_SYSTEM_ORDER = [
  'input',
  'scripts-graphs',
  'physics',
  'collisions-events',
  'game-state',
  'animation-vfx-audio',
  'camera-ui',
] as const;

export const RUNTIME_SYSTEM_ORDER = [
  ...RUNTIME_FIXED_SYSTEM_ORDER,
  'render',
] as const;

export type RuntimeFixedSystemStage = (typeof RUNTIME_FIXED_SYSTEM_ORDER)[number];
export type RuntimeSystemStage = (typeof RUNTIME_SYSTEM_ORDER)[number];
export type RuntimeSessionStatus = 'idle' | 'running' | 'paused' | 'failed' | 'disposed';
export type RuntimeUpdateSource = 'frame' | 'manual-step';

export interface RuntimeSessionIdentity {
  readonly sessionId: string;
  readonly revision: number;
  readonly buildHash: string;
}

export interface RuntimeLifecycleContext {
  readonly identity: RuntimeSessionIdentity;
  readonly status: RuntimeSessionStatus;
  readonly restartCount: number;
}

export interface RuntimeFixedUpdateContext extends RuntimeLifecycleContext {
  readonly source: RuntimeUpdateSource;
  readonly tick: number;
  readonly fixedDeltaSeconds: typeof RUNTIME_FIXED_DELTA_SECONDS;
  readonly simulationTimeSeconds: number;
}

export interface RuntimeRenderContext extends RuntimeLifecycleContext {
  readonly frame: number;
  readonly tick: number;
  readonly fixedDeltaSeconds: typeof RUNTIME_FIXED_DELTA_SECONDS;
  readonly simulationTimeSeconds: number;
  readonly frameDeltaSeconds: number;
  readonly interpolationAlpha: number;
  readonly fixedSteps: number;
}

export interface RuntimeSystemLifecycle {
  readonly id: string;
  initialize?(context: RuntimeLifecycleContext): void;
  pause?(context: RuntimeLifecycleContext): void;
  resume?(context: RuntimeLifecycleContext): void;
  restart?(context: RuntimeLifecycleContext): void;
  dispose?(context: RuntimeLifecycleContext): void;
}

export interface RuntimeFixedSystem extends RuntimeSystemLifecycle {
  readonly stage: RuntimeFixedSystemStage;
  fixedUpdate(context: RuntimeFixedUpdateContext): void;
}

export interface RuntimeRenderSystem extends RuntimeSystemLifecycle {
  readonly stage: 'render';
  render(context: RuntimeRenderContext): void;
}

export type RuntimeSystem = RuntimeFixedSystem | RuntimeRenderSystem;

export interface RuntimeSystemDiagnostics {
  id: string;
  stage: RuntimeSystemStage;
  fixedUpdateCalls: number;
  renderCalls: number;
  lastDurationMs: number;
  totalDurationMs: number;
}

export interface RuntimeFailureDiagnostics {
  code: 'system_failure';
  message: string;
  systemId: string;
  stage: RuntimeSystemStage;
  phase: RuntimeSystemPhase;
}

export interface RuntimeAdvanceDiagnostics {
  frameDeltaSeconds: number;
  fixedSteps: number;
  droppedSeconds: number;
  interpolationAlpha: number;
}

export interface RuntimeDiagnostics extends RuntimeSessionIdentity {
  status: RuntimeSessionStatus;
  fixedHz: typeof RUNTIME_FIXED_HZ;
  fixedDeltaSeconds: typeof RUNTIME_FIXED_DELTA_SECONDS;
  maxCatchUpSteps: typeof RUNTIME_MAX_CATCH_UP_STEPS;
  tick: number;
  frame: number;
  restartCount: number;
  simulationTimeSeconds: number;
  accumulatorSeconds: number;
  totalDroppedSeconds: number;
  catchUpClampCount: number;
  lastAdvance: RuntimeAdvanceDiagnostics;
  systems: RuntimeSystemDiagnostics[];
  lastFailure: RuntimeFailureDiagnostics | null;
}

export type RuntimeSystemPhase =
  | 'initialize'
  | 'fixed-update'
  | 'render'
  | 'pause'
  | 'resume'
  | 'restart'
  | 'dispose';

export interface RuntimeSystemFailure {
  readonly error: Error;
  readonly systemId: string;
  readonly stage: RuntimeSystemStage;
  readonly phase: RuntimeSystemPhase;
}

export interface RuntimeSessionOptions {
  readonly identity: RuntimeSessionIdentity;
  readonly systems: readonly RuntimeSystem[];
  readonly now?: () => number;
  readonly onSystemFailure?: (failure: RuntimeSystemFailure) => void;
}
