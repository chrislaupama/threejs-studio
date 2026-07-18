import { expect, test } from '@playwright/test';
import {
  RUNTIME_FIXED_DELTA_SECONDS,
  RUNTIME_FIXED_SYSTEM_ORDER,
  RUNTIME_MAX_CATCH_UP_STEPS,
  RuntimeProtocolValidationError,
  RuntimeSession,
  RuntimeSessionError,
  RuntimeSystemExecutionError,
  createRuntimeCommandMessage,
  createRuntimeDiagnosticsMessage,
  createRuntimeErrorMessage,
  createRuntimeReadyMessage,
  createRuntimeResultMessage,
  parseRuntimeIframeMessage,
  validateRuntimeIframeMessage,
  type RuntimeFixedSystem,
  type RuntimeFixedSystemStage,
  type RuntimeRenderSystem,
  type RuntimeSessionIdentity,
  type RuntimeSystem,
} from '../src/runtime';

const identity: RuntimeSessionIdentity = {
  sessionId: 'runtime-session-1',
  revision: 7,
  buildHash: 'sha256-deadbeef',
};

function fixedSystem(
  id: string,
  stage: RuntimeFixedSystemStage,
  update: RuntimeFixedSystem['fixedUpdate'],
  lifecycle: Partial<Omit<RuntimeFixedSystem, 'id' | 'stage' | 'fixedUpdate'>> = {},
): RuntimeFixedSystem {
  return { id, stage, fixedUpdate: update, ...lifecycle };
}

function renderSystem(
  id: string,
  render: RuntimeRenderSystem['render'],
  lifecycle: Partial<Omit<RuntimeRenderSystem, 'id' | 'stage' | 'render'>> = {},
): RuntimeRenderSystem {
  return { id, stage: 'render', render, ...lifecycle };
}

test('runs one deterministic fixed tick in the required stage order before render', () => {
  const calls: string[] = [];
  const contexts: Array<{ stage: RuntimeFixedSystemStage; tick: number; time: number; delta: number }> = [];
  const systems: RuntimeSystem[] = RUNTIME_FIXED_SYSTEM_ORDER.map((stage) => fixedSystem(
    `system-${stage}`,
    stage,
    (context) => {
      calls.push(stage);
      contexts.push({
        stage,
        tick: context.tick,
        time: context.simulationTimeSeconds,
        delta: context.fixedDeltaSeconds,
      });
    },
    { initialize: () => calls.push(`initialize-${stage}`) },
  ));
  systems.push(renderSystem('system-render', (context) => {
    calls.push('render');
    expect(context).toMatchObject({
      frame: 1,
      tick: 1,
      fixedSteps: 1,
      interpolationAlpha: 0,
    });
  }, { initialize: () => calls.push('initialize-render') }));

  const scrambled = [systems[7]!, systems[3]!, systems[0]!, systems[6]!, systems[1]!, systems[5]!, systems[2]!, systems[4]!];
  let clock = 0;
  const session = new RuntimeSession({ identity, systems: scrambled, now: () => (clock += 0.25) });
  session.start();
  expect(calls).toEqual([
    ...RUNTIME_FIXED_SYSTEM_ORDER.map((stage) => `initialize-${stage}`),
    'initialize-render',
  ]);

  calls.length = 0;
  const diagnostics = session.advance(RUNTIME_FIXED_DELTA_SECONDS);
  expect(calls).toEqual([...RUNTIME_FIXED_SYSTEM_ORDER, 'render']);
  expect(contexts).toEqual(RUNTIME_FIXED_SYSTEM_ORDER.map((stage) => ({
    stage,
    tick: 1,
    time: RUNTIME_FIXED_DELTA_SECONDS,
    delta: RUNTIME_FIXED_DELTA_SECONDS,
  })));
  expect(diagnostics).toMatchObject({
    ...identity,
    status: 'running',
    tick: 1,
    frame: 1,
    simulationTimeSeconds: RUNTIME_FIXED_DELTA_SECONDS,
    lastAdvance: { fixedSteps: 1, droppedSeconds: 0, interpolationAlpha: 0 },
  });
  expect(diagnostics.systems.map(({ id }) => id)).toEqual([
    ...RUNTIME_FIXED_SYSTEM_ORDER.map((stage) => `system-${stage}`),
    'system-render',
  ]);
  expect(diagnostics.systems.every(({ totalDurationMs }) => totalDurationMs === 0.25)).toBe(true);
});

test('accumulates fractional time and drops excess work after five catch-up steps', () => {
  let updates = 0;
  let renders = 0;
  const session = new RuntimeSession({
    identity,
    systems: [
      fixedSystem('input', 'input', () => { updates += 1; }),
      renderSystem('renderer', () => { renders += 1; }),
    ],
  });
  session.start();

  let diagnostics = session.advance(RUNTIME_FIXED_DELTA_SECONDS / 2);
  expect(diagnostics).toMatchObject({ tick: 0, frame: 1, accumulatorSeconds: RUNTIME_FIXED_DELTA_SECONDS / 2 });
  diagnostics = session.advance(RUNTIME_FIXED_DELTA_SECONDS / 2);
  expect(diagnostics).toMatchObject({ tick: 1, frame: 2, accumulatorSeconds: 0 });
  expect(updates).toBe(1);
  expect(renders).toBe(2);

  diagnostics = session.advance(1);
  expect(updates).toBe(1 + RUNTIME_MAX_CATCH_UP_STEPS);
  expect(renders).toBe(3);
  expect(diagnostics.tick).toBe(1 + RUNTIME_MAX_CATCH_UP_STEPS);
  expect(diagnostics.lastAdvance.fixedSteps).toBe(RUNTIME_MAX_CATCH_UP_STEPS);
  expect(diagnostics.lastAdvance.droppedSeconds).toBeCloseTo(55 * RUNTIME_FIXED_DELTA_SECONDS);
  expect(diagnostics.totalDroppedSeconds).toBeCloseTo(55 * RUNTIME_FIXED_DELTA_SECONDS);
  expect(diagnostics.catchUpClampCount).toBe(1);
  expect(diagnostics.accumulatorSeconds).toBe(0);
});

test('pause freezes simulation, step advances exactly once, restart resets run state, and dispose is terminal', () => {
  const calls: string[] = [];
  let gameValue = 0;
  const input = fixedSystem('input', 'input', () => {
    gameValue += 1;
    calls.push('update');
  }, {
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    restart: () => { gameValue = 0; calls.push('restart-input'); },
    dispose: () => calls.push('dispose-input'),
  });
  const renderer = renderSystem('renderer', () => calls.push('render'), {
    restart: () => calls.push('restart-render'),
    dispose: () => calls.push('dispose-render'),
  });
  const session = new RuntimeSession({ identity, systems: [renderer, input] });

  session.start();
  session.advance(RUNTIME_FIXED_DELTA_SECONDS);
  expect(gameValue).toBe(1);
  session.pause();
  const pausedTick = session.getDiagnostics().tick;
  calls.length = 0;
  session.advance(10);
  expect(calls).toEqual(['render']);
  expect(session.getDiagnostics().tick).toBe(pausedTick);
  expect(gameValue).toBe(1);

  calls.length = 0;
  const stepped = session.step();
  expect(calls).toEqual(['update', 'render']);
  expect(stepped).toMatchObject({ status: 'paused', tick: pausedTick + 1, lastAdvance: { fixedSteps: 1 } });
  expect(gameValue).toBe(2);

  session.resume();
  calls.length = 0;
  const restarted = session.restart();
  expect(calls).toEqual(['restart-input', 'restart-render']);
  expect(gameValue).toBe(0);
  expect(restarted).toMatchObject({
    status: 'running',
    tick: 0,
    frame: 0,
    simulationTimeSeconds: 0,
    accumulatorSeconds: 0,
    restartCount: 1,
  });

  calls.length = 0;
  expect(session.dispose().status).toBe('disposed');
  expect(calls).toEqual(['dispose-render', 'dispose-input']);
  expect(session.dispose().status).toBe('disposed');
  expect(calls).toEqual(['dispose-render', 'dispose-input']);
  expect(() => session.advance(0)).toThrow(RuntimeSessionError);
  try {
    session.advance(0);
  } catch (error) {
    expect(error).toMatchObject({ code: 'disposed' });
  }
});

test('contains system failures, emits typed failure diagnostics, and can restart', () => {
  const failures: string[] = [];
  let shouldFail = true;
  const session = new RuntimeSession({
    identity,
    systems: [fixedSystem('physics', 'physics', () => {
      if (shouldFail) throw new Error('physics exploded');
    }, {
      restart: () => { shouldFail = false; },
    })],
    onSystemFailure: ({ systemId, phase }) => failures.push(`${systemId}:${phase}`),
  });
  session.start();

  expect(() => session.advance(RUNTIME_FIXED_DELTA_SECONDS)).toThrow(RuntimeSystemExecutionError);
  expect(failures).toEqual(['physics:fixed-update']);
  expect(session.getDiagnostics()).toMatchObject({
    status: 'failed',
    tick: 0,
    lastFailure: {
      code: 'system_failure',
      message: 'physics exploded',
      systemId: 'physics',
      stage: 'physics',
      phase: 'fixed-update',
    },
  });
  expect(() => session.advance(0)).toThrow(RuntimeSessionError);

  expect(session.restart()).toMatchObject({ status: 'running', tick: 0, lastFailure: null, restartCount: 1 });
  expect(session.advance(RUNTIME_FIXED_DELTA_SECONDS)).toMatchObject({ status: 'running', tick: 1 });
});

test('rejects malformed identities, duplicate systems, invalid deltas, and invalid transitions', () => {
  expect(() => new RuntimeSession({
    identity: { ...identity, revision: -1 },
    systems: [],
  })).toThrow(/revision/u);
  expect(() => new RuntimeSession({
    identity,
    systems: [
      fixedSystem('duplicate', 'input', () => undefined),
      fixedSystem('duplicate', 'physics', () => undefined),
    ],
  })).toThrow(/duplicated/u);

  const session = new RuntimeSession({ identity, systems: [] });
  expect(() => session.advance(0)).toThrow(/idle/u);
  session.start();
  expect(() => session.start()).toThrow(/running/u);
  expect(() => session.step()).toThrow(/expected paused/u);
  expect(() => session.advance(Number.NaN)).toThrow(/finite/u);
  expect(() => session.advance(-1)).toThrow(/non-negative/u);
});

test('iframe protocol factories round-trip identity-bound serializable messages', () => {
  const session = new RuntimeSession({ identity, systems: [] });
  const diagnostics = session.start();
  const messages = [
    createRuntimeCommandMessage(identity, 'request-1', 'pause'),
    createRuntimeReadyMessage(identity, diagnostics),
    createRuntimeDiagnosticsMessage(identity, diagnostics),
    createRuntimeResultMessage(identity, 'request-2', 'start', diagnostics),
    createRuntimeErrorMessage(identity, {
      requestId: 'request-3',
      code: 'system_failure',
      message: 'A system failed.',
      fatal: false,
      details: { systemId: 'physics', retryable: true },
    }),
  ];

  for (const message of messages) {
    const roundTrip: unknown = JSON.parse(JSON.stringify(message));
    expect(parseRuntimeIframeMessage(roundTrip)).toEqual(message);
    expect(validateRuntimeIframeMessage(roundTrip)).toEqual({ ok: true, message });
    expect(message).toMatchObject({
      sessionId: identity.sessionId,
      revision: identity.revision,
      buildHash: identity.buildHash,
    });
  }
});

test('iframe protocol rejects stale identity metadata, unsupported fields, cycles, and non-finite data', () => {
  const session = new RuntimeSession({ identity, systems: [] });
  const diagnostics = session.start();
  const stale = {
    ...createRuntimeDiagnosticsMessage(identity, diagnostics),
    revision: identity.revision + 1,
  };
  const staleResult = validateRuntimeIframeMessage(stale);
  expect(staleResult.ok).toBe(false);
  if (!staleResult.ok) expect(staleResult.errors).toContain('message.diagnostics.revision must match message.revision.');

  const command = { ...createRuntimeCommandMessage(identity, 'request-1', 'pause'), force: true };
  const commandResult = validateRuntimeIframeMessage(command);
  expect(commandResult.ok).toBe(false);
  if (!commandResult.ok) expect(commandResult.errors).toContain('message.force is not supported.');

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(validateRuntimeIframeMessage(cyclic)).toEqual({
    ok: false,
    errors: ['message must be a finite, acyclic JSON value.'],
  });
  const nonFinite = createRuntimeErrorMessage(identity, {
    code: 'runtime_error',
    message: 'Invalid sample.',
    fatal: false,
  }) as unknown as Record<string, unknown>;
  nonFinite.details = { frameTime: Number.POSITIVE_INFINITY };
  expect(validateRuntimeIframeMessage(nonFinite)).toEqual({
    ok: false,
    errors: ['message must be a finite, acyclic JSON value.'],
  });

  expect(() => createRuntimeCommandMessage(identity, '../escape', 'pause')).toThrow(RuntimeProtocolValidationError);
  expect(() => createRuntimeReadyMessage({ ...identity, buildHash: 'other' }, diagnostics)).toThrow(
    RuntimeProtocolValidationError,
  );
});

test('diagnostic snapshots cannot mutate session counters', () => {
  const session = new RuntimeSession({
    identity,
    systems: [fixedSystem('input', 'input', () => undefined)],
  });
  session.start();
  const snapshot = session.advance(RUNTIME_FIXED_DELTA_SECONDS);
  snapshot.systems[0]!.fixedUpdateCalls = 999;
  snapshot.lastAdvance.fixedSteps = 999;
  expect(session.getDiagnostics()).toMatchObject({
    tick: 1,
    lastAdvance: { fixedSteps: 1 },
    systems: [{ id: 'input', fixedUpdateCalls: 1 }],
  });
});
