import { expect, test } from '@playwright/test';
import {
  DeterministicEventBus,
  defineGameplayEvent,
  type GameplayEventEnvelope,
} from '../src/gameplay/events';
import {
  GameplayStateStore,
  RuntimeVariableStore,
  validateGameplayStateDefinition,
  type GameplaySaveSlot,
  type GameplayStateDefinition,
} from '../src/gameplay/state';

const PING_EVENT = defineGameplayEvent({
  id: 'test.ping',
  version: 1,
  fields: {
    message: { schema: { type: 'string', trim: true, minimumLength: 1 } },
    count: { schema: { type: 'number', integer: true, minimum: 0 }, optional: true, defaultValue: 1 },
  },
});

function createDefinition(saveSchemaVersion = 1): GameplayStateDefinition {
  return {
    id: 'collect-and-escape',
    version: 1,
    fixedHz: 10,
    variables: [
      {
        id: 'player.health',
        name: 'Health',
        scope: 'session',
        schema: { type: 'number', integer: true, minimum: 0, maximum: 100 },
        initialValue: 100,
      },
      {
        id: 'player.callsign',
        name: 'Callsign',
        scope: 'save',
        schema: { type: 'string', trim: true, minimumLength: 1, maximumLength: 20 },
        initialValue: 'Rookie',
      },
      {
        id: 'run.combo',
        name: 'Combo',
        scope: 'scene',
        schema: { type: 'number', integer: true, minimum: 0 },
        initialValue: 0,
      },
    ],
    events: [PING_EVENT],
    timers: [
      { id: 'round.clock', name: 'Round clock', durationSeconds: 0.3, autoStart: true, scope: 'session' },
      { id: 'pulse.clock', name: 'Pulse clock', durationSeconds: 0.2, repeat: true, scope: 'scene' },
    ],
    objectives: [
      { id: 'collect.orbs', title: 'Collect two orbs', target: 2, required: true, autoActivate: true, scope: 'session' },
      { id: 'reach.exit', title: 'Reach the exit', target: 1, required: true, autoActivate: true, scope: 'session' },
    ],
    score: { initialValue: 0, minimum: 0, maximum: 100, integer: true, scope: 'session' },
    flow: { autoWinOnRequiredObjectives: true, autoFailOnRequiredObjectiveFailure: true },
    save: { schemaVersion: saveSchemaVersion },
  };
}

test('typed variables validate and coerce atomically while snapshots stay detached', () => {
  const store = new RuntimeVariableStore(createDefinition().variables);

  expect(store.set('player.health', '80')).toMatchObject({ ok: true, changed: true, value: { value: 80 } });
  expect(store.add('player.health', '-5')).toMatchObject({ ok: true, value: { value: 75 } });
  const invalid = store.setMany({ 'player.health': 101, 'player.callsign': 'Ace' });
  expect(invalid).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
  expect(store.get('player.health')).toBe(75);
  expect(store.get('player.callsign')).toBe('Rookie');

  const snapshot = store.snapshot();
  snapshot['player.health'] = 1;
  expect(store.get('player.health')).toBe(75);
  expect(JSON.parse(JSON.stringify(store.snapshot()))).toEqual(store.snapshot());

  store.dispose();
  expect(store.set('player.health', 20)).toMatchObject({ ok: false, code: 'DISPOSED' });
  store.dispose();
});

test('event bus validates payloads and drains FIFO without recursive dispatch', () => {
  const bus = new DeterministicEventBus([PING_EVENT]);
  const trace: string[] = [];
  let unsubscribeSecond: () => void = () => undefined;

  bus.subscribe('test.ping', (event) => {
    trace.push(`first:${event.payload.message}:${event.sequence}`);
    event.payload.message = 'mutated';
    if (event.payload.message === 'mutated' && event.sequence === 1) {
      bus.enqueue(PING_EVENT, { message: 'second' }, { tick: 4 });
      unsubscribeSecond();
    }
  });
  unsubscribeSecond = bus.subscribe('test.ping', (event) => {
    trace.push(`second:${event.payload.message}:${event.sequence}`);
  });

  expect(bus.enqueue(PING_EVENT, { message: 'first' }, { tick: 3 })).toMatchObject({
    ok: true,
    event: { sequence: 1, tick: 3, payload: { message: 'first', count: 1 } },
  });
  expect(bus.enqueueById('test.ping', { message: '' })).toMatchObject({ ok: false });
  expect(bus.enqueueById('missing.event', {})).toMatchObject({ ok: false });

  const drained = bus.drain();
  expect(drained).toMatchObject({ processedEvents: 2, deliveredListeners: 3, pendingEvents: 0, truncated: false, errors: [] });
  expect(trace).toEqual(['first:first:1', 'second:first:1', 'first:second:2']);
  expect(bus.snapshotQueue()).toEqual([]);

  bus.dispose();
  expect(bus.enqueue(PING_EVENT, { message: 'late' })).toMatchObject({ ok: false });
  expect(bus.drain()).toMatchObject({ processedEvents: 0, pendingEvents: 0 });
  bus.dispose();
});

test('gameplay flow advances deterministic timers, score, objectives, terminal state, and restart', () => {
  const state = new GameplayStateStore(createDefinition());
  const events: GameplayEventEnvelope[] = [];
  for (const eventId of [
    'studio.timer.elapsed',
    'studio.objective.changed',
    'studio.score.changed',
    'studio.game.phase.changed',
    'studio.game.restarted',
  ]) {
    state.events.subscribe(eventId, (event) => events.push(event));
  }

  expect(state.snapshot()).toMatchObject({ phase: 'ready', tick: 0, runNumber: 0, score: 0 });
  expect(state.setVariable('player.callsign', '  Ace  ')).toMatchObject({ ok: true, value: { value: 'Ace' } });
  expect(state.start()).toMatchObject({ ok: true, value: 'running' });
  expect(state.getTimer('round.clock')).toMatchObject({ status: 'running', durationTicks: 3, remainingTicks: 3 });

  state.step(2);
  expect(state.getTimer('round.clock')).toMatchObject({ status: 'running', remainingTicks: 1 });
  state.pause();
  expect(state.step(10)).toMatchObject({ ok: true, changed: false });
  expect(state.tick).toBe(2);
  state.resume();
  state.step();
  expect(state.getTimer('round.clock')).toMatchObject({ status: 'elapsed', remainingTicks: 0, iteration: 1 });

  expect(state.addScore(60)).toMatchObject({ ok: true, value: 60 });
  expect(state.addScore(80)).toMatchObject({ ok: true, value: 100 });
  expect(state.addObjectiveProgress('collect.orbs', 1)).toMatchObject({ value: { status: 'active', progress: 1 } });
  expect(state.completeObjective('collect.orbs')).toMatchObject({ value: { status: 'completed', progress: 2 } });
  expect(state.phase).toBe('running');
  expect(state.completeObjective('reach.exit')).toMatchObject({ value: { status: 'completed' } });
  expect(state.phase).toBe('won');
  expect(state.requestFail('too late')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  expect(state.addScore(1)).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });

  const drain = state.events.drain();
  expect(drain.errors).toEqual([]);
  expect(events.filter((event) => event.eventId === 'studio.timer.elapsed')).toHaveLength(1);
  expect(events.at(-1)).toMatchObject({ eventId: 'studio.game.phase.changed', payload: { phase: 'won' } });

  expect(state.restart()).toMatchObject({
    ok: true,
    value: {
      phase: 'running',
      tick: 0,
      runNumber: 2,
      score: 0,
      variables: { 'player.health': 100, 'player.callsign': 'Ace', 'run.combo': 0 },
    },
  });
  expect(state.events.pendingCount).toBe(1);
  state.events.drain();
  expect(events.at(-1)).toMatchObject({ eventId: 'studio.game.restarted', payload: { scope: 'session', runNumber: 2 } });

  expect(state.failObjective('collect.orbs')).toMatchObject({ ok: true });
  expect(state.phase).toBe('failed');
  expect(state.requestWin()).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
});

test('repeating timers use exact fixed ticks and event order remains deterministic', () => {
  const first = new GameplayStateStore(createDefinition());
  const second = new GameplayStateStore(createDefinition());
  const run = (state: GameplayStateStore) => {
    const trace: Array<{ eventId: string; sequence: number; tick: number; payload: object }> = [];
    state.events.subscribe('studio.timer.elapsed', (event) => trace.push({
      eventId: event.eventId,
      sequence: event.sequence,
      tick: event.tick,
      payload: event.payload,
    }));
    state.start();
    state.events.clear();
    state.startTimer('pulse.clock');
    state.step(6);
    state.events.drain();
    return trace;
  };

  expect(run(first)).toEqual(run(second));
  expect(first.getTimer('pulse.clock')).toMatchObject({ status: 'running', remainingTicks: 2, iteration: 3 });
});

test('save slots round-trip only persistent state and migrations are atomic', () => {
  const versionOneDefinition = createDefinition(1);
  versionOneDefinition.objectives = [
    { id: 'story.exit', title: 'Open the exit', target: 1, autoActivate: true, scope: 'save' },
  ];
  versionOneDefinition.score = { initialValue: 0, integer: true, scope: 'save' };
  versionOneDefinition.flow = {};
  const source = new GameplayStateStore(versionOneDefinition);
  source.setVariable('player.callsign', 'Veteran');
  source.setVariable('player.health', 12);
  source.completeObjective('story.exit');
  source.setScore(900);

  const created = source.createSaveSlot('slot-1', 7, { checkpoint: 'exit-door' });
  expect(created).toMatchObject({
    ok: true,
    value: {
      revision: 7,
      payload: {
        variables: { 'player.callsign': 'Veteran' },
        objectives: { 'story.exit': { status: 'completed', progress: 1 } },
        score: 900,
      },
    },
  });
  if (!created.ok) throw new Error('Expected save creation to succeed.');
  const portable = JSON.parse(JSON.stringify(created.value)) as GameplaySaveSlot;

  const restored = new GameplayStateStore(versionOneDefinition);
  expect(restored.loadSaveSlot(portable)).toMatchObject({
    ok: true,
    value: {
      phase: 'ready',
      variables: { 'player.health': 100, 'player.callsign': 'Veteran', 'run.combo': 0 },
      objectives: { 'story.exit': { status: 'completed', progress: 1 } },
      score: 900,
    },
  });
  expect(restored.events.snapshotQueue()).toEqual([
    expect.objectContaining({ eventId: 'studio.save.loaded', payload: { slotId: 'slot-1', revision: 7, schemaVersion: 1 } }),
  ]);
  restored.setVariable('player.health', 5);
  restored.setVariable('run.combo', 9);
  expect(restored.loadSaveSlot(portable)).toMatchObject({
    ok: true,
    value: { variables: { 'player.health': 100, 'player.callsign': 'Veteran', 'run.combo': 0 } },
  });

  const versionTwoDefinition = { ...versionOneDefinition, save: { schemaVersion: 2 } };
  const migratedState = new GameplayStateStore(versionTwoDefinition);
  const originalJson = JSON.stringify(portable);
  expect(migratedState.loadSaveSlot(portable, [{
    id: 'save-v1-v2',
    fromVersion: 1,
    toVersion: 2,
    migrate: (slot) => ({ ...slot, saveSchemaVersion: 2, metadata: { ...slot.metadata, migrated: true } }),
  }])).toMatchObject({ ok: true, value: { score: 900 } });
  expect(JSON.stringify(portable)).toBe(originalJson);

  const beforeFailedLoad = migratedState.snapshot();
  const malformed = structuredClone(portable) as GameplaySaveSlot;
  malformed.saveSchemaVersion = 2;
  malformed.payload.objectives['unknown.objective'] = { status: 'active', progress: 0 };
  expect(migratedState.loadSaveSlot(malformed)).toMatchObject({ ok: false, code: 'SAVE_INVALID' });
  expect(migratedState.snapshot()).toEqual(beforeFailedLoad);
  expect(new GameplayStateStore(versionTwoDefinition).loadSaveSlot(portable)).toMatchObject({
    ok: false,
    code: 'SAVE_MIGRATION_MISSING',
  });
});

test('invalid authored definitions fail before runtime state is created and teardown is idempotent', () => {
  const malformed = createDefinition();
  malformed.variables = [
    ...(malformed.variables ?? []),
    { ...(malformed.variables?.[0]!), initialValue: Number.NaN },
  ];
  malformed.events = [
    defineGameplayEvent({ id: 'studio.custom', version: 1, fields: {} }),
  ];
  const errors = validateGameplayStateDefinition(malformed);
  expect(errors).toEqual(expect.arrayContaining([
    expect.stringContaining('duplicates variable'),
    expect.stringContaining('finite number'),
    expect.stringContaining('reserved "studio." namespace'),
  ]));
  expect(() => new GameplayStateStore(malformed)).toThrow();

  const state = new GameplayStateStore(createDefinition());
  state.dispose();
  state.dispose();
  expect(state.phase).toBe('disposed');
  expect(state.events.pendingCount).toBe(0);
  expect(state.setVariable('player.health', 1)).toMatchObject({ ok: false, code: 'DISPOSED' });
  expect(state.step()).toMatchObject({ ok: false, code: 'DISPOSED' });
  expect(state.start()).toMatchObject({ ok: false, code: 'DISPOSED' });
  expect(state.pauseTimer('round.clock')).toMatchObject({ ok: false, code: 'DISPOSED' });
});
