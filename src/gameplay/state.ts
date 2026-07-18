import {
  DeterministicEventBus,
  GAMEPLAY_ID_PATTERN,
  cloneSerializableValue,
  defineGameplayEvent,
  validateGameplayEventDefinition,
  validateGameplayValue,
  validateGameplayValueSchema,
  validateSerializableValue,
  type GameplayEventDefinition,
  type GameplayValueFor,
  type GameplayValueSchema,
  type SerializableRecord,
  type SerializableValue,
} from './events';

export type GameplayScope = 'scene' | 'session' | 'save';
export type GameplayPhase = 'ready' | 'running' | 'paused' | 'won' | 'failed' | 'disposed';
export type ObjectiveStatus = 'inactive' | 'active' | 'completed' | 'failed';
export type TimerStatus = 'idle' | 'running' | 'paused' | 'elapsed';

export type GameplayStateErrorCode =
  | 'DISPOSED'
  | 'INVALID_DEFINITION'
  | 'INVALID_TRANSITION'
  | 'INVALID_VALUE'
  | 'NOT_FOUND'
  | 'NOT_SUPPORTED'
  | 'SAVE_INVALID'
  | 'SAVE_MIGRATION_MISSING'
  | 'SAVE_MIGRATION_FAILED'
  | 'SAVE_VERSION_UNSUPPORTED';

export type GameplayStateResult<T> =
  | { ok: true; changed: boolean; value: T }
  | { ok: false; changed: false; code: GameplayStateErrorCode; message: string; errors: string[] };

export interface GameplayVariableDefinition<TSchema extends GameplayValueSchema = GameplayValueSchema> {
  id: string;
  name: string;
  description?: string;
  scope: GameplayScope;
  schema: TSchema;
  initialValue: GameplayValueFor<TSchema>;
}

export interface GameplayTimerDefinition {
  id: string;
  name: string;
  durationSeconds: number;
  autoStart?: boolean;
  repeat?: boolean;
  scope: Exclude<GameplayScope, 'save'>;
}

export interface GameplayObjectiveDefinition {
  id: string;
  title: string;
  description?: string;
  target: number;
  required?: boolean;
  autoActivate?: boolean;
  scope: GameplayScope;
}

export interface GameplayScoreDefinition {
  name?: string;
  initialValue: number;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
  higherIsBetter?: boolean;
  scope: GameplayScope;
}

export interface GameplayFlowDefinition {
  autoWinOnRequiredObjectives?: boolean;
  autoFailOnRequiredObjectiveFailure?: boolean;
}

export interface GameplaySaveDefinition {
  schemaVersion: number;
}

export interface GameplayStateDefinition {
  id: string;
  version: number;
  fixedHz?: number;
  variables?: readonly GameplayVariableDefinition[];
  events?: readonly GameplayEventDefinition[];
  timers?: readonly GameplayTimerDefinition[];
  objectives?: readonly GameplayObjectiveDefinition[];
  score?: GameplayScoreDefinition;
  flow?: GameplayFlowDefinition;
  save?: GameplaySaveDefinition;
}

export interface GameplayVariableChange {
  id: string;
  previousValue: SerializableValue;
  value: SerializableValue;
}

export interface TimerSnapshot {
  id: string;
  status: TimerStatus;
  durationTicks: number;
  remainingTicks: number;
  remainingSeconds: number;
  iteration: number;
}

export interface ObjectiveSnapshot {
  id: string;
  status: ObjectiveStatus;
  progress: number;
  target: number;
  required: boolean;
}

export interface GameplayStateSnapshot {
  definitionId: string;
  definitionVersion: number;
  phase: GameplayPhase;
  tick: number;
  runNumber: number;
  variables: SerializableRecord;
  timers: Record<string, TimerSnapshot>;
  objectives: Record<string, ObjectiveSnapshot>;
  score: number;
}

export interface GameplaySaveSlotPayload {
  variables: SerializableRecord;
  objectives: Record<string, { status: ObjectiveStatus; progress: number }>;
  score?: number;
}

export interface GameplaySaveSlot {
  format: 'threejs-studio.game-save';
  formatVersion: 1;
  stateDefinitionId: string;
  saveSchemaVersion: number;
  slotId: string;
  revision: number;
  metadata: SerializableRecord;
  payload: GameplaySaveSlotPayload;
}

export interface GameplaySaveMigration {
  id: string;
  fromVersion: number;
  toVersion: number;
  migrate: (slot: GameplaySaveSlot) => unknown;
}

interface RuntimeTimer {
  definition: GameplayTimerDefinition;
  durationTicks: number;
  remainingTicks: number;
  status: TimerStatus;
  iteration: number;
}

interface RuntimeObjective {
  definition: GameplayObjectiveDefinition;
  status: ObjectiveStatus;
  progress: number;
}

const BUILT_IN_GAMEPLAY_EVENTS = [
  defineGameplayEvent({
    id: 'studio.variable.changed',
    version: 1,
    fields: {
      variableId: { schema: { type: 'string' } },
      previousValue: { schema: { type: 'json' } },
      value: { schema: { type: 'json' } },
    },
  }),
  defineGameplayEvent({
    id: 'studio.timer.elapsed',
    version: 1,
    fields: {
      timerId: { schema: { type: 'string' } },
      iteration: { schema: { type: 'number', integer: true, minimum: 1 } },
    },
  }),
  defineGameplayEvent({
    id: 'studio.objective.changed',
    version: 1,
    fields: {
      objectiveId: { schema: { type: 'string' } },
      status: { schema: { type: 'string', values: ['inactive', 'active', 'completed', 'failed'] } },
      progress: { schema: { type: 'number', minimum: 0 } },
      target: { schema: { type: 'number', minimum: 0 } },
    },
  }),
  defineGameplayEvent({
    id: 'studio.score.changed',
    version: 1,
    fields: {
      previousValue: { schema: { type: 'number' } },
      value: { schema: { type: 'number' } },
      delta: { schema: { type: 'number' } },
    },
  }),
  defineGameplayEvent({
    id: 'studio.game.phase.changed',
    version: 1,
    fields: {
      previousPhase: { schema: { type: 'string', values: ['ready', 'running', 'paused', 'won', 'failed'] } },
      phase: { schema: { type: 'string', values: ['ready', 'running', 'paused', 'won', 'failed'] } },
      reason: { schema: { type: 'string' }, optional: true },
    },
  }),
  defineGameplayEvent({
    id: 'studio.game.restarted',
    version: 1,
    fields: {
      scope: { schema: { type: 'string', values: ['scene', 'session'] } },
      runNumber: { schema: { type: 'number', integer: true, minimum: 1 } },
      phase: { schema: { type: 'string', values: ['ready', 'running'] } },
    },
  }),
  defineGameplayEvent({
    id: 'studio.save.loaded',
    version: 1,
    fields: {
      slotId: { schema: { type: 'string' } },
      revision: { schema: { type: 'number', integer: true, minimum: 0 } },
      schemaVersion: { schema: { type: 'number', integer: true, minimum: 1 } },
    },
  }),
] satisfies readonly GameplayEventDefinition[];

export { BUILT_IN_GAMEPLAY_EVENTS };

function success<T>(value: T, changed = true): GameplayStateResult<T> {
  return { ok: true, changed, value };
}

function failure<T>(
  code: GameplayStateErrorCode,
  message: string,
  errors: string[] = [message],
): GameplayStateResult<T> {
  return { ok: false, changed: false, code, message, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameValue(left: SerializableValue, right: SerializableValue) {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function isGameplayScope(value: unknown): value is GameplayScope {
  return value === 'scene' || value === 'session' || value === 'save';
}

function cloneDefinition<T>(definition: T): T {
  const errors = validateSerializableValue(definition, 'definition');
  if (errors.length > 0) throw new TypeError(errors.join('\n'));
  return cloneSerializableValue(definition as SerializableValue) as T;
}

export function defineGameplayVariable<const TSchema extends GameplayValueSchema>(
  definition: GameplayVariableDefinition<TSchema>,
): GameplayVariableDefinition<TSchema> {
  return definition;
}

export function validateGameplayStateDefinition(definition: GameplayStateDefinition): string[] {
  const errors = validateSerializableValue(definition, 'definition');
  if (!GAMEPLAY_ID_PATTERN.test(definition.id)) errors.push('definition.id must be a stable gameplay identifier.');
  if (!Number.isInteger(definition.version) || definition.version < 1) errors.push('definition.version must be a positive integer.');
  const fixedHz = definition.fixedHz ?? 60;
  if (!Number.isInteger(fixedHz) || fixedHz < 1 || fixedHz > 1000) errors.push('definition.fixedHz must be an integer between 1 and 1000.');

  const variables = definition.variables ?? [];
  const variableIds = new Set<string>();
  variables.forEach((variable, index) => {
    const path = `definition.variables[${index}]`;
    if (!GAMEPLAY_ID_PATTERN.test(variable.id)) errors.push(`${path}.id must be a stable gameplay identifier.`);
    if (variableIds.has(variable.id)) errors.push(`${path}.id duplicates variable "${variable.id}".`);
    variableIds.add(variable.id);
    if (variable.name.trim() === '') errors.push(`${path}.name must not be empty.`);
    if (!isGameplayScope(variable.scope)) errors.push(`${path}.scope must be scene, session, or save.`);
    errors.push(...validateGameplayValueSchema(variable.schema, `${path}.schema`));
    const initial = validateGameplayValue(variable.schema, variable.initialValue, { path: `${path}.initialValue` });
    if (!initial.ok) errors.push(...initial.errors);
  });

  const customEventIds = new Set<string>();
  (definition.events ?? []).forEach((event, index) => {
    const path = `definition.events[${index}]`;
    errors.push(...validateGameplayEventDefinition(event, path));
    if (event.id.startsWith('studio.')) errors.push(`${path}.id uses the reserved "studio." namespace.`);
    if (customEventIds.has(event.id)) errors.push(`${path}.id duplicates event "${event.id}".`);
    customEventIds.add(event.id);
  });

  const timerIds = new Set<string>();
  (definition.timers ?? []).forEach((timer, index) => {
    const path = `definition.timers[${index}]`;
    if (!GAMEPLAY_ID_PATTERN.test(timer.id)) errors.push(`${path}.id must be a stable gameplay identifier.`);
    if (timerIds.has(timer.id)) errors.push(`${path}.id duplicates timer "${timer.id}".`);
    timerIds.add(timer.id);
    if (timer.name.trim() === '') errors.push(`${path}.name must not be empty.`);
    if (!Number.isFinite(timer.durationSeconds) || timer.durationSeconds <= 0) errors.push(`${path}.durationSeconds must be greater than zero.`);
    if (timer.scope !== 'scene' && timer.scope !== 'session') errors.push(`${path}.scope must be scene or session.`);
    if (timer.autoStart !== undefined && typeof timer.autoStart !== 'boolean') errors.push(`${path}.autoStart must be a boolean.`);
    if (timer.repeat !== undefined && typeof timer.repeat !== 'boolean') errors.push(`${path}.repeat must be a boolean.`);
    if (Number.isFinite(timer.durationSeconds) && timer.durationSeconds * fixedHz > Number.MAX_SAFE_INTEGER) {
      errors.push(`${path}.durationSeconds is too large for deterministic fixed ticks.`);
    }
  });

  const objectiveIds = new Set<string>();
  (definition.objectives ?? []).forEach((objective, index) => {
    const path = `definition.objectives[${index}]`;
    if (!GAMEPLAY_ID_PATTERN.test(objective.id)) errors.push(`${path}.id must be a stable gameplay identifier.`);
    if (objectiveIds.has(objective.id)) errors.push(`${path}.id duplicates objective "${objective.id}".`);
    objectiveIds.add(objective.id);
    if (objective.title.trim() === '') errors.push(`${path}.title must not be empty.`);
    if (!Number.isFinite(objective.target) || objective.target <= 0) errors.push(`${path}.target must be greater than zero.`);
    if (!isGameplayScope(objective.scope)) errors.push(`${path}.scope must be scene, session, or save.`);
    if (objective.required !== undefined && typeof objective.required !== 'boolean') errors.push(`${path}.required must be a boolean.`);
    if (objective.autoActivate !== undefined && typeof objective.autoActivate !== 'boolean') errors.push(`${path}.autoActivate must be a boolean.`);
  });

  const score = definition.score;
  if (score) {
    if (!isGameplayScope(score.scope)) errors.push('definition.score.scope must be scene, session, or save.');
    if (!Number.isFinite(score.initialValue)) errors.push('definition.score.initialValue must be finite.');
    if (score.minimum !== undefined && !Number.isFinite(score.minimum)) errors.push('definition.score.minimum must be finite.');
    if (score.maximum !== undefined && !Number.isFinite(score.maximum)) errors.push('definition.score.maximum must be finite.');
    if (score.minimum !== undefined && score.maximum !== undefined && score.minimum > score.maximum) {
      errors.push('definition.score.minimum must not be greater than definition.score.maximum.');
    }
    if (score.minimum !== undefined && score.initialValue < score.minimum) errors.push('definition.score.initialValue is below its minimum.');
    if (score.maximum !== undefined && score.initialValue > score.maximum) errors.push('definition.score.initialValue is above its maximum.');
    if (score.integer && !Number.isInteger(score.initialValue)) errors.push('definition.score.initialValue must be an integer.');
    if (score.integer && score.minimum !== undefined && !Number.isInteger(score.minimum)) errors.push('definition.score.minimum must be an integer.');
    if (score.integer && score.maximum !== undefined && !Number.isInteger(score.maximum)) errors.push('definition.score.maximum must be an integer.');
  }
  if (definition.flow?.autoWinOnRequiredObjectives !== undefined && typeof definition.flow.autoWinOnRequiredObjectives !== 'boolean') {
    errors.push('definition.flow.autoWinOnRequiredObjectives must be a boolean.');
  }
  if (definition.flow?.autoFailOnRequiredObjectiveFailure !== undefined && typeof definition.flow.autoFailOnRequiredObjectiveFailure !== 'boolean') {
    errors.push('definition.flow.autoFailOnRequiredObjectiveFailure must be a boolean.');
  }
  const saveVersion = definition.save?.schemaVersion ?? 1;
  if (!Number.isInteger(saveVersion) || saveVersion < 1) errors.push('definition.save.schemaVersion must be a positive integer.');
  return errors;
}

export class RuntimeVariableStore {
  private readonly definitions = new Map<string, GameplayVariableDefinition>();
  private readonly values = new Map<string, SerializableValue>();
  private disposed = false;

  constructor(definitions: readonly GameplayVariableDefinition[] = []) {
    const wrapper: GameplayStateDefinition = { id: 'variable-store', version: 1, variables: definitions };
    const errors = validateGameplayStateDefinition(wrapper).filter((error) => error.includes('.variables['));
    if (errors.length > 0) throw new TypeError(errors.join('\n'));
    definitions.forEach((definition) => {
      const copy = cloneDefinition(definition);
      this.definitions.set(copy.id, copy);
      this.values.set(copy.id, cloneSerializableValue(copy.initialValue));
    });
  }

  get isDisposed() {
    return this.disposed;
  }

  get(id: string): SerializableValue | undefined {
    const value = this.values.get(id);
    return value === undefined ? undefined : cloneSerializableValue(value);
  }

  getDefinition(id: string): GameplayVariableDefinition | undefined {
    const definition = this.definitions.get(id);
    return definition ? cloneDefinition(definition) : undefined;
  }

  set(id: string, input: unknown, options: { coerce?: boolean } = {}): GameplayStateResult<GameplayVariableChange> {
    if (this.disposed) return failure('DISPOSED', 'The runtime variable store has been disposed.');
    const definition = this.definitions.get(id);
    if (!definition) return failure('NOT_FOUND', `Unknown gameplay variable "${id}".`);
    const validated = validateGameplayValue(definition.schema, input, {
      coerce: options.coerce ?? true,
      path: `Variable "${id}"`,
    });
    if (!validated.ok) return failure('INVALID_VALUE', `Variable "${id}" rejected its value.`, validated.errors);
    const previousValue = this.values.get(id)!;
    const value = validated.value;
    const change = {
      id,
      previousValue: cloneSerializableValue(previousValue),
      value: cloneSerializableValue(value),
    };
    if (sameValue(previousValue, value)) return success(change, false);
    this.values.set(id, cloneSerializableValue(value));
    return success(change);
  }

  setMany(values: Record<string, unknown>, options: { coerce?: boolean } = {}): GameplayStateResult<GameplayVariableChange[]> {
    if (this.disposed) return failure('DISPOSED', 'The runtime variable store has been disposed.');
    const changes: GameplayVariableChange[] = [];
    const errors: string[] = [];
    for (const [id, input] of Object.entries(values)) {
      const definition = this.definitions.get(id);
      if (!definition) {
        errors.push(`Unknown gameplay variable "${id}".`);
        continue;
      }
      const validated = validateGameplayValue(definition.schema, input, {
        coerce: options.coerce ?? true,
        path: `Variable "${id}"`,
      });
      if (!validated.ok) {
        errors.push(...validated.errors);
        continue;
      }
      const previousValue = this.values.get(id)!;
      changes.push({ id, previousValue: cloneSerializableValue(previousValue), value: cloneSerializableValue(validated.value) });
    }
    if (errors.length > 0) return failure('INVALID_VALUE', 'One or more gameplay variables rejected their values.', errors);
    for (const change of changes) this.values.set(change.id, cloneSerializableValue(change.value));
    return success(changes, changes.some((change) => !sameValue(change.previousValue, change.value)));
  }

  add(id: string, delta: unknown): GameplayStateResult<GameplayVariableChange> {
    const definition = this.definitions.get(id);
    if (!definition) return failure('NOT_FOUND', `Unknown gameplay variable "${id}".`);
    if (definition.schema.type !== 'number') return failure('NOT_SUPPORTED', `Gameplay variable "${id}" is not numeric.`);
    const parsedDelta = validateGameplayValue({ type: 'number' }, delta, { coerce: true, path: 'delta' });
    if (!parsedDelta.ok) return failure('INVALID_VALUE', `Gameplay variable "${id}" rejected its delta.`, parsedDelta.errors);
    return this.set(id, (this.values.get(id) as number) + parsedDelta.value, { coerce: false });
  }

  reset(scopes: ReadonlySet<GameplayScope>): GameplayVariableChange[] {
    if (this.disposed) return [];
    const changes: GameplayVariableChange[] = [];
    for (const definition of this.definitions.values()) {
      if (!scopes.has(definition.scope)) continue;
      const previousValue = this.values.get(definition.id)!;
      const value = cloneSerializableValue(definition.initialValue);
      if (!sameValue(previousValue, value)) changes.push({ id: definition.id, previousValue: cloneSerializableValue(previousValue), value });
      this.values.set(definition.id, value);
    }
    return changes;
  }

  snapshot(scopes?: ReadonlySet<GameplayScope>): SerializableRecord {
    const snapshot: SerializableRecord = {};
    for (const definition of this.definitions.values()) {
      if (!scopes || scopes.has(definition.scope)) snapshot[definition.id] = cloneSerializableValue(this.values.get(definition.id)!);
    }
    return snapshot;
  }

  validateSaveSnapshot(input: unknown): GameplayStateResult<SerializableRecord> {
    if (!isRecord(input)) return failure('SAVE_INVALID', 'Save variables must be an object.');
    const result: SerializableRecord = {};
    const errors: string[] = [];
    for (const id of Object.keys(input)) {
      const definition = this.definitions.get(id);
      if (!definition || definition.scope !== 'save') errors.push(`Save variables contain unknown or non-persistent variable "${id}".`);
    }
    for (const definition of this.definitions.values()) {
      if (definition.scope !== 'save') continue;
      const inputValue = input[definition.id] ?? definition.initialValue;
      const validated = validateGameplayValue(definition.schema, inputValue, {
        coerce: false,
        path: `Save variable "${definition.id}"`,
      });
      if (validated.ok) result[definition.id] = validated.value;
      else errors.push(...validated.errors);
    }
    return errors.length > 0 ? failure('SAVE_INVALID', 'Save variables failed validation.', errors) : success(result, false);
  }

  applySaveSnapshot(snapshot: SerializableRecord) {
    for (const [id, value] of Object.entries(snapshot)) this.values.set(id, cloneSerializableValue(value));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.values.clear();
    this.definitions.clear();
  }
}

function objectiveSnapshot(objective: RuntimeObjective): ObjectiveSnapshot {
  return {
    id: objective.definition.id,
    status: objective.status,
    progress: objective.progress,
    target: objective.definition.target,
    required: objective.definition.required ?? false,
  };
}

function timerSnapshot(timer: RuntimeTimer, fixedHz: number): TimerSnapshot {
  return {
    id: timer.definition.id,
    status: timer.status,
    durationTicks: timer.durationTicks,
    remainingTicks: timer.remainingTicks,
    remainingSeconds: timer.remainingTicks / fixedHz,
    iteration: timer.iteration,
  };
}

function parseSaveSlot(value: unknown): GameplayStateResult<GameplaySaveSlot> {
  const serializableErrors = validateSerializableValue(value, 'save');
  if (serializableErrors.length > 0) return failure('SAVE_INVALID', 'The save slot is not serializable.', serializableErrors);
  if (!isRecord(value)) return failure('SAVE_INVALID', 'The save slot must be an object.');
  const errors: string[] = [];
  if (value.format !== 'threejs-studio.game-save') errors.push('save.format must be "threejs-studio.game-save".');
  if (value.formatVersion !== 1) errors.push('save.formatVersion must be 1.');
  if (typeof value.stateDefinitionId !== 'string' || !GAMEPLAY_ID_PATTERN.test(value.stateDefinitionId)) errors.push('save.stateDefinitionId is invalid.');
  if (!Number.isInteger(value.saveSchemaVersion) || (value.saveSchemaVersion as number) < 1) errors.push('save.saveSchemaVersion must be a positive integer.');
  if (typeof value.slotId !== 'string' || !GAMEPLAY_ID_PATTERN.test(value.slotId)) errors.push('save.slotId is invalid.');
  if (!Number.isInteger(value.revision) || (value.revision as number) < 0) errors.push('save.revision must be a non-negative integer.');
  if (!isRecord(value.metadata)) errors.push('save.metadata must be an object.');
  if (!isRecord(value.payload)) errors.push('save.payload must be an object.');
  else {
    if (!isRecord(value.payload.variables)) errors.push('save.payload.variables must be an object.');
    if (!isRecord(value.payload.objectives)) errors.push('save.payload.objectives must be an object.');
    else {
      for (const [objectiveId, objective] of Object.entries(value.payload.objectives)) {
        if (!isRecord(objective)) {
          errors.push(`save.payload.objectives.${objectiveId} must be an object.`);
          continue;
        }
        if (!['inactive', 'active', 'completed', 'failed'].includes(String(objective.status))) {
          errors.push(`save.payload.objectives.${objectiveId}.status is invalid.`);
        }
        if (typeof objective.progress !== 'number' || !Number.isFinite(objective.progress)) {
          errors.push(`save.payload.objectives.${objectiveId}.progress must be finite.`);
        }
      }
    }
    if (value.payload.score !== undefined && (typeof value.payload.score !== 'number' || !Number.isFinite(value.payload.score))) {
      errors.push('save.payload.score must be finite when present.');
    }
  }
  return errors.length > 0
    ? failure('SAVE_INVALID', 'The save slot shape is invalid.', errors)
    : success(cloneSerializableValue(value as SerializableRecord) as unknown as GameplaySaveSlot, false);
}

export class GameplayStateStore {
  readonly definition: GameplayStateDefinition;
  readonly events: DeterministicEventBus;
  readonly variables: RuntimeVariableStore;

  private readonly timers = new Map<string, RuntimeTimer>();
  private readonly objectives = new Map<string, RuntimeObjective>();
  private readonly fixedHz: number;
  private scoreValue: number;
  private phaseValue: GameplayPhase = 'ready';
  private tickValue = 0;
  private runNumberValue = 0;

  constructor(definition: GameplayStateDefinition) {
    const errors = validateGameplayStateDefinition(definition);
    if (errors.length > 0) throw new TypeError(errors.join('\n'));
    this.definition = cloneDefinition(definition);
    this.fixedHz = this.definition.fixedHz ?? 60;
    this.variables = new RuntimeVariableStore(this.definition.variables ?? []);
    this.events = new DeterministicEventBus([
      ...BUILT_IN_GAMEPLAY_EVENTS,
      ...(this.definition.events ?? []),
    ]);
    for (const timerDefinition of this.definition.timers ?? []) {
      const durationTicks = Math.max(1, Math.ceil(timerDefinition.durationSeconds * this.fixedHz));
      this.timers.set(timerDefinition.id, {
        definition: timerDefinition,
        durationTicks,
        remainingTicks: durationTicks,
        status: 'idle',
        iteration: 0,
      });
    }
    for (const objectiveDefinition of this.definition.objectives ?? []) {
      this.objectives.set(objectiveDefinition.id, {
        definition: objectiveDefinition,
        status: objectiveDefinition.autoActivate ? 'active' : 'inactive',
        progress: 0,
      });
    }
    this.scoreValue = this.definition.score?.initialValue ?? 0;
  }

  get phase() {
    return this.phaseValue;
  }

  get tick() {
    return this.tickValue;
  }

  get runNumber() {
    return this.runNumberValue;
  }

  get score() {
    return this.scoreValue;
  }

  private guard<T>(): GameplayStateResult<T> | null {
    return this.phaseValue === 'disposed' ? failure('DISPOSED', 'The gameplay state store has been disposed.') : null;
  }

  private guardSimulationMutation<T>(): GameplayStateResult<T> | null {
    const disposed = this.guard<T>();
    if (disposed) return disposed;
    if (this.phaseValue === 'won' || this.phaseValue === 'failed') {
      return failure('INVALID_TRANSITION', `Gameplay is frozen while the phase is "${this.phaseValue}".`);
    }
    return null;
  }

  private enqueue(eventId: string, payload: SerializableRecord) {
    this.events.enqueueById(eventId, payload, { tick: this.tickValue });
  }

  private changePhase(next: Exclude<GameplayPhase, 'disposed'>, reason?: string): GameplayStateResult<GameplayPhase> {
    const disposed = this.guard<GameplayPhase>();
    if (disposed) return disposed;
    const previous = this.phaseValue;
    if (previous === next) return success(next, false);
    this.phaseValue = next;
    const payload: SerializableRecord = { previousPhase: previous, phase: next };
    if (reason !== undefined) payload.reason = reason;
    this.enqueue('studio.game.phase.changed', payload);
    return success(next);
  }

  start(): GameplayStateResult<GameplayPhase> {
    const disposed = this.guard<GameplayPhase>();
    if (disposed) return disposed;
    if (this.phaseValue !== 'ready') return failure('INVALID_TRANSITION', `Cannot start gameplay from phase "${this.phaseValue}".`);
    this.runNumberValue = Math.max(1, this.runNumberValue);
    for (const timer of this.timers.values()) if (timer.definition.autoStart) timer.status = 'running';
    return this.changePhase('running');
  }

  pause(): GameplayStateResult<GameplayPhase> {
    const disposed = this.guard<GameplayPhase>();
    if (disposed) return disposed;
    if (this.phaseValue !== 'running') return failure('INVALID_TRANSITION', `Cannot pause gameplay from phase "${this.phaseValue}".`);
    return this.changePhase('paused');
  }

  resume(): GameplayStateResult<GameplayPhase> {
    const disposed = this.guard<GameplayPhase>();
    if (disposed) return disposed;
    if (this.phaseValue !== 'paused') return failure('INVALID_TRANSITION', `Cannot resume gameplay from phase "${this.phaseValue}".`);
    return this.changePhase('running');
  }

  requestWin(reason?: string): GameplayStateResult<GameplayPhase> {
    const disposed = this.guard<GameplayPhase>();
    if (disposed) return disposed;
    if (this.phaseValue === 'won') return success('won', false);
    if (this.phaseValue !== 'running' && this.phaseValue !== 'paused') {
      return failure('INVALID_TRANSITION', `Cannot win gameplay from phase "${this.phaseValue}".`);
    }
    return this.changePhase('won', reason);
  }

  requestFail(reason?: string): GameplayStateResult<GameplayPhase> {
    const disposed = this.guard<GameplayPhase>();
    if (disposed) return disposed;
    if (this.phaseValue === 'failed') return success('failed', false);
    if (this.phaseValue !== 'running' && this.phaseValue !== 'paused') {
      return failure('INVALID_TRANSITION', `Cannot fail gameplay from phase "${this.phaseValue}".`);
    }
    return this.changePhase('failed', reason);
  }

  setVariable(id: string, value: unknown, options?: { coerce?: boolean }): GameplayStateResult<GameplayVariableChange> {
    const blocked = this.guardSimulationMutation<GameplayVariableChange>();
    if (blocked) return blocked;
    const result = this.variables.set(id, value, options);
    if (result.ok && result.changed) {
      this.enqueue('studio.variable.changed', {
        variableId: result.value.id,
        previousValue: result.value.previousValue,
        value: result.value.value,
      });
    }
    return result;
  }

  addVariable(id: string, delta: unknown): GameplayStateResult<GameplayVariableChange> {
    const blocked = this.guardSimulationMutation<GameplayVariableChange>();
    if (blocked) return blocked;
    const result = this.variables.add(id, delta);
    if (result.ok && result.changed) {
      this.enqueue('studio.variable.changed', {
        variableId: result.value.id,
        previousValue: result.value.previousValue,
        value: result.value.value,
      });
    }
    return result;
  }

  setScore(value: unknown): GameplayStateResult<number> {
    const blocked = this.guardSimulationMutation<number>();
    if (blocked) return blocked;
    const parsed = validateGameplayValue({ type: 'number', integer: this.definition.score?.integer }, value, {
      coerce: true,
      path: 'Score',
    });
    if (!parsed.ok) return failure('INVALID_VALUE', 'Score rejected its value.', parsed.errors);
    let next = parsed.value;
    const scoreDefinition = this.definition.score;
    if (scoreDefinition?.minimum !== undefined) next = Math.max(scoreDefinition.minimum, next);
    if (scoreDefinition?.maximum !== undefined) next = Math.min(scoreDefinition.maximum, next);
    const previous = this.scoreValue;
    if (previous === next) return success(next, false);
    this.scoreValue = next;
    this.enqueue('studio.score.changed', { previousValue: previous, value: next, delta: next - previous });
    return success(next);
  }

  addScore(delta: unknown): GameplayStateResult<number> {
    const parsed = validateGameplayValue({ type: 'number' }, delta, { coerce: true, path: 'Score delta' });
    if (!parsed.ok) return failure('INVALID_VALUE', 'Score rejected its delta.', parsed.errors);
    return this.setScore(this.scoreValue + parsed.value);
  }

  getTimer(id: string): TimerSnapshot | undefined {
    const timer = this.timers.get(id);
    return timer ? timerSnapshot(timer, this.fixedHz) : undefined;
  }

  startTimer(id: string): GameplayStateResult<TimerSnapshot> {
    const blocked = this.guardSimulationMutation<TimerSnapshot>();
    if (blocked) return blocked;
    const timer = this.timers.get(id);
    if (!timer) return failure('NOT_FOUND', `Unknown gameplay timer "${id}".`);
    if (timer.status === 'running') return success(timerSnapshot(timer, this.fixedHz), false);
    if (timer.status === 'elapsed') return failure('INVALID_TRANSITION', `Timer "${id}" has elapsed; restart it explicitly.`);
    timer.status = 'running';
    return success(timerSnapshot(timer, this.fixedHz));
  }

  pauseTimer(id: string): GameplayStateResult<TimerSnapshot> {
    const blocked = this.guardSimulationMutation<TimerSnapshot>();
    if (blocked) return blocked;
    const timer = this.timers.get(id);
    if (!timer) return failure('NOT_FOUND', `Unknown gameplay timer "${id}".`);
    if (timer.status !== 'running') return failure('INVALID_TRANSITION', `Cannot pause timer "${id}" from status "${timer.status}".`);
    timer.status = 'paused';
    return success(timerSnapshot(timer, this.fixedHz));
  }

  resumeTimer(id: string): GameplayStateResult<TimerSnapshot> {
    const blocked = this.guardSimulationMutation<TimerSnapshot>();
    if (blocked) return blocked;
    const timer = this.timers.get(id);
    if (!timer) return failure('NOT_FOUND', `Unknown gameplay timer "${id}".`);
    if (timer.status !== 'paused') return failure('INVALID_TRANSITION', `Cannot resume timer "${id}" from status "${timer.status}".`);
    timer.status = 'running';
    return success(timerSnapshot(timer, this.fixedHz));
  }

  restartTimer(id: string, running = true): GameplayStateResult<TimerSnapshot> {
    const blocked = this.guardSimulationMutation<TimerSnapshot>();
    if (blocked) return blocked;
    const timer = this.timers.get(id);
    if (!timer) return failure('NOT_FOUND', `Unknown gameplay timer "${id}".`);
    timer.remainingTicks = timer.durationTicks;
    timer.iteration = 0;
    timer.status = running ? 'running' : 'idle';
    return success(timerSnapshot(timer, this.fixedHz));
  }

  step(ticks = 1): GameplayStateResult<GameplayStateSnapshot> {
    const disposed = this.guard<GameplayStateSnapshot>();
    if (disposed) return disposed;
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > 100_000) {
      return failure('INVALID_VALUE', 'Fixed-step tick count must be an integer between 0 and 100000.');
    }
    if (ticks === 0 || this.phaseValue !== 'running') return success(this.snapshot(), false);
    for (let tick = 0; tick < ticks && this.phaseValue === 'running'; tick += 1) {
      this.tickValue += 1;
      for (const timer of this.timers.values()) {
        if (timer.status !== 'running') continue;
        timer.remainingTicks -= 1;
        if (timer.remainingTicks > 0) continue;
        timer.iteration += 1;
        this.enqueue('studio.timer.elapsed', { timerId: timer.definition.id, iteration: timer.iteration });
        if (timer.definition.repeat) timer.remainingTicks = timer.durationTicks;
        else {
          timer.remainingTicks = 0;
          timer.status = 'elapsed';
        }
      }
    }
    return success(this.snapshot());
  }

  getObjective(id: string): ObjectiveSnapshot | undefined {
    const objective = this.objectives.get(id);
    return objective ? objectiveSnapshot(objective) : undefined;
  }

  private emitObjective(objective: RuntimeObjective) {
    const snapshot = objectiveSnapshot(objective);
    this.enqueue('studio.objective.changed', {
      objectiveId: snapshot.id,
      status: snapshot.status,
      progress: snapshot.progress,
      target: snapshot.target,
    });
  }

  private reconcileObjectives(objective: RuntimeObjective) {
    const flow = this.definition.flow;
    if (objective.status === 'failed' && objective.definition.required && flow?.autoFailOnRequiredObjectiveFailure) {
      this.requestFail(`Required objective "${objective.definition.id}" failed.`);
      return;
    }
    if (!flow?.autoWinOnRequiredObjectives) return;
    const required = [...this.objectives.values()].filter((candidate) => candidate.definition.required);
    if (required.length > 0 && required.every((candidate) => candidate.status === 'completed')) {
      this.requestWin('All required objectives completed.');
    }
  }

  activateObjective(id: string): GameplayStateResult<ObjectiveSnapshot> {
    const blocked = this.guardSimulationMutation<ObjectiveSnapshot>();
    if (blocked) return blocked;
    const objective = this.objectives.get(id);
    if (!objective) return failure('NOT_FOUND', `Unknown gameplay objective "${id}".`);
    if (objective.status === 'active') return success(objectiveSnapshot(objective), false);
    if (objective.status !== 'inactive') return failure('INVALID_TRANSITION', `Cannot activate objective "${id}" from status "${objective.status}".`);
    objective.status = 'active';
    this.emitObjective(objective);
    return success(objectiveSnapshot(objective));
  }

  setObjectiveProgress(id: string, progress: unknown): GameplayStateResult<ObjectiveSnapshot> {
    const blocked = this.guardSimulationMutation<ObjectiveSnapshot>();
    if (blocked) return blocked;
    const objective = this.objectives.get(id);
    if (!objective) return failure('NOT_FOUND', `Unknown gameplay objective "${id}".`);
    if (objective.status === 'completed' || objective.status === 'failed') {
      return failure('INVALID_TRANSITION', `Objective "${id}" is already ${objective.status}.`);
    }
    const parsed = validateGameplayValue({ type: 'number' }, progress, { coerce: true, path: `Objective "${id}" progress` });
    if (!parsed.ok) return failure('INVALID_VALUE', `Objective "${id}" rejected its progress.`, parsed.errors);
    const previousProgress = objective.progress;
    const previousStatus = objective.status;
    objective.progress = Math.min(objective.definition.target, Math.max(0, parsed.value));
    if (objective.status === 'inactive') objective.status = 'active';
    if (objective.progress >= objective.definition.target) objective.status = 'completed';
    const changed = previousProgress !== objective.progress || previousStatus !== objective.status;
    if (changed) {
      this.emitObjective(objective);
      this.reconcileObjectives(objective);
    }
    return success(objectiveSnapshot(objective), changed);
  }

  addObjectiveProgress(id: string, delta: unknown): GameplayStateResult<ObjectiveSnapshot> {
    const blocked = this.guardSimulationMutation<ObjectiveSnapshot>();
    if (blocked) return blocked;
    const objective = this.objectives.get(id);
    if (!objective) return failure('NOT_FOUND', `Unknown gameplay objective "${id}".`);
    const parsed = validateGameplayValue({ type: 'number' }, delta, { coerce: true, path: `Objective "${id}" delta` });
    if (!parsed.ok) return failure('INVALID_VALUE', `Objective "${id}" rejected its delta.`, parsed.errors);
    return this.setObjectiveProgress(id, objective.progress + parsed.value);
  }

  completeObjective(id: string): GameplayStateResult<ObjectiveSnapshot> {
    const disposed = this.guard<ObjectiveSnapshot>();
    if (disposed) return disposed;
    const objective = this.objectives.get(id);
    if (!objective) return failure('NOT_FOUND', `Unknown gameplay objective "${id}".`);
    if (objective.status === 'completed') return success(objectiveSnapshot(objective), false);
    const blocked = this.guardSimulationMutation<ObjectiveSnapshot>();
    if (blocked) return blocked;
    return this.setObjectiveProgress(id, objective.definition.target);
  }

  failObjective(id: string): GameplayStateResult<ObjectiveSnapshot> {
    const disposed = this.guard<ObjectiveSnapshot>();
    if (disposed) return disposed;
    const objective = this.objectives.get(id);
    if (!objective) return failure('NOT_FOUND', `Unknown gameplay objective "${id}".`);
    if (objective.status === 'failed') return success(objectiveSnapshot(objective), false);
    const blocked = this.guardSimulationMutation<ObjectiveSnapshot>();
    if (blocked) return blocked;
    if (objective.status === 'completed') return failure('INVALID_TRANSITION', `Objective "${id}" is already completed.`);
    objective.status = 'failed';
    this.emitObjective(objective);
    this.reconcileObjectives(objective);
    return success(objectiveSnapshot(objective));
  }

  restart(scope: Exclude<GameplayScope, 'save'> = 'session', autoStart = true): GameplayStateResult<GameplayStateSnapshot> {
    const disposed = this.guard<GameplayStateSnapshot>();
    if (disposed) return disposed;
    const scopes = scope === 'session'
      ? new Set<GameplayScope>(['scene', 'session'])
      : new Set<GameplayScope>(['scene']);
    this.events.clear();
    this.variables.reset(scopes);
    for (const timer of this.timers.values()) {
      if (!scopes.has(timer.definition.scope)) continue;
      timer.remainingTicks = timer.durationTicks;
      timer.iteration = 0;
      timer.status = autoStart && timer.definition.autoStart ? 'running' : 'idle';
    }
    for (const objective of this.objectives.values()) {
      if (!scopes.has(objective.definition.scope)) continue;
      objective.progress = 0;
      objective.status = objective.definition.autoActivate ? 'active' : 'inactive';
    }
    const scoreDefinition = this.definition.score;
    if (!scoreDefinition || scopes.has(scoreDefinition.scope)) this.scoreValue = scoreDefinition?.initialValue ?? 0;
    this.tickValue = 0;
    this.runNumberValue += 1;
    this.phaseValue = autoStart ? 'running' : 'ready';
    this.enqueue('studio.game.restarted', { scope, runNumber: this.runNumberValue, phase: this.phaseValue });
    return success(this.snapshot());
  }

  snapshot(): GameplayStateSnapshot {
    const timers: Record<string, TimerSnapshot> = {};
    for (const timer of this.timers.values()) timers[timer.definition.id] = timerSnapshot(timer, this.fixedHz);
    const objectives: Record<string, ObjectiveSnapshot> = {};
    for (const objective of this.objectives.values()) objectives[objective.definition.id] = objectiveSnapshot(objective);
    return {
      definitionId: this.definition.id,
      definitionVersion: this.definition.version,
      phase: this.phaseValue,
      tick: this.tickValue,
      runNumber: this.runNumberValue,
      variables: this.variables.snapshot(),
      timers,
      objectives,
      score: this.scoreValue,
    };
  }

  createSaveSlot(
    slotId: string,
    revision = 0,
    metadata: SerializableRecord = {},
  ): GameplayStateResult<GameplaySaveSlot> {
    const disposed = this.guard<GameplaySaveSlot>();
    if (disposed) return disposed;
    if (!GAMEPLAY_ID_PATTERN.test(slotId)) return failure('SAVE_INVALID', 'Save slot id must be a stable gameplay identifier.');
    if (!Number.isInteger(revision) || revision < 0) return failure('SAVE_INVALID', 'Save slot revision must be a non-negative integer.');
    const metadataErrors = validateSerializableValue(metadata, 'save metadata');
    if (metadataErrors.length > 0) return failure('SAVE_INVALID', 'Save metadata is not serializable.', metadataErrors);
    const objectivePayload: GameplaySaveSlotPayload['objectives'] = {};
    for (const objective of this.objectives.values()) {
      if (objective.definition.scope === 'save') {
        objectivePayload[objective.definition.id] = { status: objective.status, progress: objective.progress };
      }
    }
    const payload: GameplaySaveSlotPayload = {
      variables: this.variables.snapshot(new Set<GameplayScope>(['save'])),
      objectives: objectivePayload,
    };
    if (this.definition.score?.scope === 'save') payload.score = this.scoreValue;
    return success({
      format: 'threejs-studio.game-save',
      formatVersion: 1,
      stateDefinitionId: this.definition.id,
      saveSchemaVersion: this.definition.save?.schemaVersion ?? 1,
      slotId,
      revision,
      metadata: cloneSerializableValue(metadata),
      payload,
    }, false);
  }

  loadSaveSlot(value: unknown, migrations: readonly GameplaySaveMigration[] = []): GameplayStateResult<GameplayStateSnapshot> {
    const disposed = this.guard<GameplayStateSnapshot>();
    if (disposed) return disposed;
    let parsed = parseSaveSlot(value);
    if (!parsed.ok) return parsed;
    if (parsed.value.stateDefinitionId !== this.definition.id) {
      return failure('SAVE_INVALID', `Save belongs to gameplay definition "${parsed.value.stateDefinitionId}", not "${this.definition.id}".`);
    }
    const targetVersion = this.definition.save?.schemaVersion ?? 1;
    if (parsed.value.saveSchemaVersion > targetVersion) {
      return failure('SAVE_VERSION_UNSUPPORTED', `Save schema v${parsed.value.saveSchemaVersion} is newer than supported v${targetVersion}.`);
    }
    const migrationKeys = new Set<string>();
    for (const migration of migrations) {
      const key = `${migration.fromVersion}:${migration.toVersion}`;
      if (migrationKeys.has(key)) return failure('SAVE_INVALID', `Duplicate save migration ${key}.`);
      migrationKeys.add(key);
      if (!GAMEPLAY_ID_PATTERN.test(migration.id) || migration.toVersion !== migration.fromVersion + 1) {
        return failure('SAVE_INVALID', `Save migration "${migration.id}" must have a stable id and advance exactly one version.`);
      }
    }
    while (parsed.value.saveSchemaVersion < targetVersion) {
      const fromVersion = parsed.value.saveSchemaVersion;
      const migration = migrations.find((candidate) => candidate.fromVersion === fromVersion && candidate.toVersion === fromVersion + 1);
      if (!migration) return failure('SAVE_MIGRATION_MISSING', `Missing save migration from v${fromVersion} to v${fromVersion + 1}.`);
      let migrated: unknown;
      try {
        migrated = migration.migrate(cloneSerializableValue(parsed.value as unknown as SerializableRecord) as unknown as GameplaySaveSlot);
      } catch (error) {
        return failure('SAVE_MIGRATION_FAILED', `Save migration "${migration.id}" failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      parsed = parseSaveSlot(migrated);
      if (!parsed.ok) return failure('SAVE_MIGRATION_FAILED', `Save migration "${migration.id}" returned an invalid save.`, parsed.errors);
      if (parsed.value.saveSchemaVersion !== fromVersion + 1) {
        return failure('SAVE_MIGRATION_FAILED', `Save migration "${migration.id}" did not advance to v${fromVersion + 1}.`);
      }
    }
    if (parsed.value.stateDefinitionId !== this.definition.id) {
      return failure('SAVE_MIGRATION_FAILED', 'A save migration changed the gameplay definition id.');
    }

    const variableCandidate = this.variables.validateSaveSnapshot(parsed.value.payload.variables);
    if (!variableCandidate.ok) return failure('SAVE_INVALID', variableCandidate.message, variableCandidate.errors);
    const objectiveCandidate = new Map<string, { status: ObjectiveStatus; progress: number }>();
    const objectiveErrors: string[] = [];
    for (const id of Object.keys(parsed.value.payload.objectives)) {
      const objective = this.objectives.get(id);
      if (!objective || objective.definition.scope !== 'save') objectiveErrors.push(`Save objectives contain unknown or non-persistent objective "${id}".`);
    }
    for (const objective of this.objectives.values()) {
      if (objective.definition.scope !== 'save') continue;
      const candidate = parsed.value.payload.objectives[objective.definition.id]
        ?? { status: objective.definition.autoActivate ? 'active' : 'inactive', progress: 0 };
      if (!['inactive', 'active', 'completed', 'failed'].includes(candidate.status)) {
        objectiveErrors.push(`Save objective "${objective.definition.id}" has an invalid status.`);
      }
      if (!Number.isFinite(candidate.progress) || candidate.progress < 0 || candidate.progress > objective.definition.target) {
        objectiveErrors.push(`Save objective "${objective.definition.id}" progress must be between 0 and ${objective.definition.target}.`);
      }
      if (candidate.status === 'completed' && candidate.progress !== objective.definition.target) {
        objectiveErrors.push(`Completed save objective "${objective.definition.id}" must be at its target.`);
      }
      objectiveCandidate.set(objective.definition.id, { status: candidate.status, progress: candidate.progress });
    }
    if (objectiveErrors.length > 0) return failure('SAVE_INVALID', 'Save objectives failed validation.', objectiveErrors);

    let scoreCandidate = this.definition.score?.initialValue ?? 0;
    if (this.definition.score?.scope === 'save') {
      const scoreResult = validateGameplayValue({ type: 'number', integer: this.definition.score.integer }, parsed.value.payload.score ?? scoreCandidate, {
        coerce: false,
        path: 'Save score',
      });
      if (!scoreResult.ok) return failure('SAVE_INVALID', 'Save score failed validation.', scoreResult.errors);
      scoreCandidate = scoreResult.value;
      if (this.definition.score.minimum !== undefined && scoreCandidate < this.definition.score.minimum) return failure('SAVE_INVALID', 'Save score is below its minimum.');
      if (this.definition.score.maximum !== undefined && scoreCandidate > this.definition.score.maximum) return failure('SAVE_INVALID', 'Save score is above its maximum.');
    } else if (parsed.value.payload.score !== undefined) {
      return failure('SAVE_INVALID', 'Save payload contains a non-persistent score.');
    }

    this.events.clear();
    this.variables.reset(new Set<GameplayScope>(['scene', 'session', 'save']));
    this.variables.applySaveSnapshot(variableCandidate.value);
    for (const objective of this.objectives.values()) {
      objective.status = objective.definition.autoActivate ? 'active' : 'inactive';
      objective.progress = 0;
    }
    for (const [id, candidate] of objectiveCandidate) {
      const objective = this.objectives.get(id)!;
      objective.status = candidate.status;
      objective.progress = candidate.progress;
    }
    this.scoreValue = this.definition.score?.initialValue ?? 0;
    if (this.definition.score?.scope === 'save') this.scoreValue = scoreCandidate;
    this.phaseValue = 'ready';
    this.tickValue = 0;
    this.runNumberValue = 0;
    for (const timer of this.timers.values()) {
      timer.status = 'idle';
      timer.remainingTicks = timer.durationTicks;
      timer.iteration = 0;
    }
    this.enqueue('studio.save.loaded', {
      slotId: parsed.value.slotId,
      revision: parsed.value.revision,
      schemaVersion: parsed.value.saveSchemaVersion,
    });
    return success(this.snapshot());
  }

  dispose() {
    if (this.phaseValue === 'disposed') return;
    this.phaseValue = 'disposed';
    this.variables.dispose();
    this.events.dispose();
    this.timers.clear();
    this.objectives.clear();
    this.scoreValue = 0;
  }
}

export { GameplayStateStore as GameplayState };
