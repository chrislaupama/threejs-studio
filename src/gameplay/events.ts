export type SerializablePrimitive = null | boolean | number | string;

export type SerializableValue =
  | SerializablePrimitive
  | SerializableValue[]
  | { [key: string]: SerializableValue };

export type SerializableRecord = { [key: string]: SerializableValue };

export type GameplayValueSchema =
  | { type: 'boolean' }
  | { type: 'number'; integer?: boolean; minimum?: number; maximum?: number }
  | {
    type: 'string';
    trim?: boolean;
    minimumLength?: number;
    maximumLength?: number;
    pattern?: string;
    values?: readonly string[];
  }
  | { type: 'vec2'; minimum?: number; maximum?: number }
  | { type: 'vec3'; minimum?: number; maximum?: number }
  | { type: 'json' };

export type GameplayValueFor<TSchema extends GameplayValueSchema> =
  TSchema extends { type: 'boolean' } ? boolean
    : TSchema extends { type: 'number' } ? number
      : TSchema extends { type: 'string' } ? string
        : TSchema extends { type: 'vec2' } ? [number, number]
          : TSchema extends { type: 'vec3' } ? [number, number, number]
            : SerializableValue;

export interface GameplayEventFieldDefinition<TSchema extends GameplayValueSchema = GameplayValueSchema> {
  schema: TSchema;
  optional?: boolean;
  defaultValue?: GameplayValueFor<TSchema>;
}

export type GameplayEventFields = Record<string, GameplayEventFieldDefinition>;

type OptionalEventFieldKeys<TFields extends GameplayEventFields> = {
  [TKey in keyof TFields]: TFields[TKey]['optional'] extends true ? TKey : never;
}[keyof TFields];

type RequiredEventFieldKeys<TFields extends GameplayEventFields> = Exclude<keyof TFields, OptionalEventFieldKeys<TFields>>;

export type GameplayEventPayload<TFields extends GameplayEventFields> = {
  [TKey in RequiredEventFieldKeys<TFields>]: GameplayValueFor<TFields[TKey]['schema']>;
} & {
  [TKey in OptionalEventFieldKeys<TFields>]?: GameplayValueFor<TFields[TKey]['schema']>;
};

export interface GameplayEventDefinition<TFields extends GameplayEventFields = GameplayEventFields> {
  id: string;
  version: number;
  description?: string;
  fields: TFields;
}

export interface GameplayEventMetadata {
  tick?: number;
  sourceId?: string;
  targetId?: string;
}

export interface GameplayEventEnvelope<TPayload extends SerializableRecord = SerializableRecord> {
  eventId: string;
  eventVersion: number;
  sequence: number;
  tick: number;
  sourceId?: string;
  targetId?: string;
  payload: TPayload;
}

export type GameplayValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export type GameplayEventEnqueueResult =
  | { ok: true; event: GameplayEventEnvelope }
  | { ok: false; errors: string[] };

export interface GameplayEventDispatchError {
  eventId: string;
  sequence: number;
  listenerIndex: number;
  message: string;
}

export interface GameplayEventDrainResult {
  processedEvents: number;
  deliveredListeners: number;
  pendingEvents: number;
  truncated: boolean;
  errors: GameplayEventDispatchError[];
}

export const GAMEPLAY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function collectSerializableErrors(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  depth: number,
): string[] {
  if (depth > 64) return [`${path} exceeds the maximum serializable depth of 64.`];
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path} must be a finite number.`];
  if (typeof value !== 'object') return [`${path} must contain only JSON-serializable values.`];

  if (seen.has(value)) return [`${path} must not contain a circular reference.`];
  seen.add(value);
  const errors: string[] = [];
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      errors.push(...collectSerializableErrors(value[index], `${path}[${index}]`, seen, depth + 1));
    }
  } else if (isPlainRecord(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) errors.push(`${path} must not contain symbol keys.`);
    for (const [key, child] of Object.entries(value)) {
      errors.push(...collectSerializableErrors(child, `${path}.${key}`, seen, depth + 1));
    }
  } else {
    errors.push(`${path} must be a plain JSON object.`);
  }
  seen.delete(value);
  return errors;
}

export function validateSerializableValue(value: unknown, path = 'value'): string[] {
  return collectSerializableErrors(value, path, new WeakSet<object>(), 0);
}

export function isSerializableValue(value: unknown): value is SerializableValue {
  return validateSerializableValue(value).length === 0;
}

export function cloneSerializableValue<T extends SerializableValue>(value: T): T {
  const errors = validateSerializableValue(value);
  if (errors.length > 0) throw new TypeError(errors.join(' '));
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((child) => cloneSerializableValue(child)) as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneSerializableValue(child)]),
  ) as T;
}

export function validateGameplayValueSchema(schema: GameplayValueSchema, path = 'schema'): string[] {
  const errors: string[] = [];
  if (!isPlainRecord(schema) || !['boolean', 'number', 'string', 'vec2', 'vec3', 'json'].includes(String(schema.type))) {
    return [`${path}.type must be boolean, number, string, vec2, vec3, or json.`];
  }
  if (schema.type === 'number' || schema.type === 'vec2' || schema.type === 'vec3') {
    if (schema.minimum !== undefined && !Number.isFinite(schema.minimum)) errors.push(`${path}.minimum must be finite.`);
    if (schema.maximum !== undefined && !Number.isFinite(schema.maximum)) errors.push(`${path}.maximum must be finite.`);
    if (schema.minimum !== undefined && schema.maximum !== undefined && schema.minimum > schema.maximum) {
      errors.push(`${path}.minimum must not be greater than ${path}.maximum.`);
    }
  }
  if (schema.type === 'string') {
    if (schema.minimumLength !== undefined && (!Number.isInteger(schema.minimumLength) || schema.minimumLength < 0)) {
      errors.push(`${path}.minimumLength must be a non-negative integer.`);
    }
    if (schema.maximumLength !== undefined && (!Number.isInteger(schema.maximumLength) || schema.maximumLength < 0)) {
      errors.push(`${path}.maximumLength must be a non-negative integer.`);
    }
    if (
      schema.minimumLength !== undefined
      && schema.maximumLength !== undefined
      && schema.minimumLength > schema.maximumLength
    ) {
      errors.push(`${path}.minimumLength must not be greater than ${path}.maximumLength.`);
    }
    if (schema.pattern !== undefined) {
      try {
        new RegExp(schema.pattern);
      } catch {
        errors.push(`${path}.pattern must be a valid regular expression.`);
      }
    }
    if (schema.values !== undefined) {
      if (schema.values.length === 0) errors.push(`${path}.values must contain at least one value.`);
      if (!schema.values.every((value) => typeof value === 'string')) errors.push(`${path}.values must contain only strings.`);
      if (new Set(schema.values).size !== schema.values.length) errors.push(`${path}.values must not contain duplicates.`);
    }
  }
  return errors;
}

function coerceFiniteNumber(value: unknown, coerce: boolean): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (coerce && typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function validateGameplayValue<TSchema extends GameplayValueSchema>(
  schema: TSchema,
  input: unknown,
  options: { coerce?: boolean; path?: string } = {},
): GameplayValidationResult<GameplayValueFor<TSchema>> {
  const path = options.path ?? 'value';
  const coerce = options.coerce ?? false;
  const schemaErrors = validateGameplayValueSchema(schema, `${path} schema`);
  if (schemaErrors.length > 0) return { ok: false, errors: schemaErrors };

  if (schema.type === 'json') {
    const errors = validateSerializableValue(input, path);
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, value: cloneSerializableValue(input as SerializableValue) as GameplayValueFor<TSchema> };
  }

  if (schema.type === 'boolean') {
    let value = input;
    if (coerce && typeof input === 'string') {
      if (input.trim().toLowerCase() === 'true' || input.trim() === '1') value = true;
      if (input.trim().toLowerCase() === 'false' || input.trim() === '0') value = false;
    } else if (coerce && (input === 0 || input === 1)) {
      value = input === 1;
    }
    return typeof value === 'boolean'
      ? { ok: true, value: value as GameplayValueFor<TSchema> }
      : { ok: false, errors: [`${path} must be a boolean.`] };
  }

  if (schema.type === 'string') {
    let value = input;
    if (coerce && (typeof input === 'number' || typeof input === 'boolean')) value = String(input);
    if (typeof value !== 'string') return { ok: false, errors: [`${path} must be a string.`] };
    const stringValue = schema.trim ? value.trim() : value;
    const errors: string[] = [];
    if (schema.minimumLength !== undefined && stringValue.length < schema.minimumLength) {
      errors.push(`${path} must contain at least ${schema.minimumLength} characters.`);
    }
    if (schema.maximumLength !== undefined && stringValue.length > schema.maximumLength) {
      errors.push(`${path} must contain at most ${schema.maximumLength} characters.`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(stringValue)) errors.push(`${path} does not match the required pattern.`);
    if (schema.values !== undefined && !schema.values.includes(stringValue)) errors.push(`${path} must be one of: ${schema.values.join(', ')}.`);
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, value: stringValue as GameplayValueFor<TSchema> };
  }

  if (schema.type === 'number') {
    const value = coerceFiniteNumber(input, coerce);
    if (value === null) return { ok: false, errors: [`${path} must be a finite number.`] };
    const errors: string[] = [];
    if (schema.integer && !Number.isInteger(value)) errors.push(`${path} must be an integer.`);
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}.`);
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, value: value as GameplayValueFor<TSchema> };
  }

  const expectedLength = schema.type === 'vec2' ? 2 : 3;
  if (!Array.isArray(input) || input.length !== expectedLength) {
    return { ok: false, errors: [`${path} must be a ${expectedLength}-element numeric tuple.`] };
  }
  const values = input.map((part) => coerceFiniteNumber(part, coerce));
  if (values.some((part) => part === null)) {
    return { ok: false, errors: [`${path} must contain only finite numbers.`] };
  }
  const errors: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}[${index}] must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}[${index}] must be at most ${schema.maximum}.`);
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: values as GameplayValueFor<TSchema> };
}

export function defineGameplayEvent<const TFields extends GameplayEventFields>(
  definition: GameplayEventDefinition<TFields>,
): GameplayEventDefinition<TFields> {
  return definition;
}

export function validateGameplayEventDefinition(definition: GameplayEventDefinition, path = 'event'): string[] {
  const errors: string[] = [];
  if (!GAMEPLAY_ID_PATTERN.test(definition.id)) errors.push(`${path}.id must be a stable gameplay identifier.`);
  if (!Number.isInteger(definition.version) || definition.version < 1) errors.push(`${path}.version must be a positive integer.`);
  if (!isPlainRecord(definition.fields)) {
    errors.push(`${path}.fields must be an object.`);
    return errors;
  }
  for (const [fieldId, field] of Object.entries(definition.fields)) {
    if (!GAMEPLAY_ID_PATTERN.test(fieldId)) errors.push(`${path}.fields.${fieldId} must use a stable field identifier.`);
    errors.push(...validateGameplayValueSchema(field.schema, `${path}.fields.${fieldId}.schema`));
    if (field.defaultValue !== undefined) {
      const result = validateGameplayValue(field.schema, field.defaultValue, { path: `${path}.fields.${fieldId}.defaultValue` });
      if (!result.ok) errors.push(...result.errors);
    }
  }
  return errors;
}

function validateEventPayload(
  definition: GameplayEventDefinition,
  payload: unknown,
): GameplayValidationResult<SerializableRecord> {
  if (!isPlainRecord(payload)) return { ok: false, errors: [`Event "${definition.id}" payload must be an object.`] };
  const errors: string[] = [];
  const value: SerializableRecord = {};
  for (const key of Object.keys(payload)) {
    if (!(key in definition.fields)) errors.push(`Event "${definition.id}" payload contains unknown field "${key}".`);
  }
  for (const [fieldId, field] of Object.entries(definition.fields)) {
    const input = payload[fieldId];
    if (input === undefined) {
      if (field.defaultValue !== undefined) value[fieldId] = cloneSerializableValue(field.defaultValue);
      else if (!field.optional) errors.push(`Event "${definition.id}" payload.${fieldId} is required.`);
      continue;
    }
    const result = validateGameplayValue(field.schema, input, {
      coerce: false,
      path: `Event "${definition.id}" payload.${fieldId}`,
    });
    if (result.ok) value[fieldId] = result.value;
    else errors.push(...result.errors);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

type GameplayEventListener = (event: GameplayEventEnvelope) => void;

export class DeterministicEventBus {
  private readonly definitions = new Map<string, GameplayEventDefinition>();
  private readonly listeners = new Map<string, Map<number, GameplayEventListener>>();
  private readonly queue: GameplayEventEnvelope[] = [];
  private nextSequence = 1;
  private nextListenerId = 1;
  private draining = false;
  private disposed = false;

  constructor(definitions: readonly GameplayEventDefinition[] = []) {
    const errors: string[] = [];
    definitions.forEach((definition, index) => {
      errors.push(...validateGameplayEventDefinition(definition, `events[${index}]`));
      if (this.definitions.has(definition.id)) errors.push(`events[${index}].id duplicates event "${definition.id}".`);
      else this.definitions.set(definition.id, cloneSerializableValue(definition as unknown as SerializableRecord) as unknown as GameplayEventDefinition);
    });
    if (errors.length > 0) throw new TypeError(errors.join('\n'));
  }

  get pendingCount() {
    return this.queue.length;
  }

  get isDisposed() {
    return this.disposed;
  }

  getDefinition(eventId: string): GameplayEventDefinition | undefined {
    const definition = this.definitions.get(eventId);
    return definition
      ? cloneSerializableValue(definition as unknown as SerializableRecord) as unknown as GameplayEventDefinition
      : undefined;
  }

  enqueue<TFields extends GameplayEventFields>(
    definition: GameplayEventDefinition<TFields>,
    payload: GameplayEventPayload<TFields>,
    metadata?: GameplayEventMetadata,
  ): GameplayEventEnqueueResult {
    return this.enqueueById(definition.id, payload as SerializableRecord, metadata);
  }

  enqueueById(
    eventId: string,
    payload: unknown = {},
    metadata: GameplayEventMetadata = {},
  ): GameplayEventEnqueueResult {
    if (this.disposed) return { ok: false, errors: ['The gameplay event bus has been disposed.'] };
    const definition = this.definitions.get(eventId);
    if (!definition) return { ok: false, errors: [`Unknown gameplay event "${eventId}".`] };
    const tick = metadata.tick ?? 0;
    const metadataErrors: string[] = [];
    if (!Number.isInteger(tick) || tick < 0) metadataErrors.push('Event tick must be a non-negative integer.');
    if (metadata.sourceId !== undefined && !GAMEPLAY_ID_PATTERN.test(metadata.sourceId)) metadataErrors.push('Event sourceId must be a stable gameplay identifier.');
    if (metadata.targetId !== undefined && !GAMEPLAY_ID_PATTERN.test(metadata.targetId)) metadataErrors.push('Event targetId must be a stable gameplay identifier.');
    const payloadResult = validateEventPayload(definition, payload);
    if (!payloadResult.ok) metadataErrors.push(...payloadResult.errors);
    if (metadataErrors.length > 0 || !payloadResult.ok) return { ok: false, errors: metadataErrors };
    const event: GameplayEventEnvelope = {
      eventId,
      eventVersion: definition.version,
      sequence: this.nextSequence,
      tick,
      payload: payloadResult.value,
    };
    if (metadata.sourceId !== undefined) event.sourceId = metadata.sourceId;
    if (metadata.targetId !== undefined) event.targetId = metadata.targetId;
    this.nextSequence += 1;
    this.queue.push(event);
    return { ok: true, event: cloneSerializableValue(event as unknown as SerializableRecord) as unknown as GameplayEventEnvelope };
  }

  subscribe(eventId: string, listener: GameplayEventListener): () => void {
    if (this.disposed) throw new Error('The gameplay event bus has been disposed.');
    if (!this.definitions.has(eventId)) throw new Error(`Unknown gameplay event "${eventId}".`);
    const listenerId = this.nextListenerId;
    this.nextListenerId += 1;
    const eventListeners = this.listeners.get(eventId) ?? new Map<number, GameplayEventListener>();
    eventListeners.set(listenerId, listener);
    this.listeners.set(eventId, eventListeners);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.listeners.get(eventId);
      current?.delete(listenerId);
      if (current?.size === 0) this.listeners.delete(eventId);
    };
  }

  drain(maxEvents = 4096): GameplayEventDrainResult {
    if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new RangeError('maxEvents must be a positive integer.');
    if (this.disposed) {
      return { processedEvents: 0, deliveredListeners: 0, pendingEvents: 0, truncated: false, errors: [] };
    }
    if (this.draining) throw new Error('Gameplay events cannot be drained recursively.');
    this.draining = true;
    let processedEvents = 0;
    let deliveredListeners = 0;
    const errors: GameplayEventDispatchError[] = [];
    try {
      while (this.queue.length > 0 && processedEvents < maxEvents) {
        const event = this.queue.shift()!;
        const listeners = [...(this.listeners.get(event.eventId)?.values() ?? [])];
        for (let listenerIndex = 0; listenerIndex < listeners.length; listenerIndex += 1) {
          try {
            const copy = cloneSerializableValue(event as unknown as SerializableRecord) as unknown as GameplayEventEnvelope;
            listeners[listenerIndex]!(copy);
          } catch (error) {
            errors.push({
              eventId: event.eventId,
              sequence: event.sequence,
              listenerIndex,
              message: error instanceof Error ? error.message : String(error),
            });
          }
          deliveredListeners += 1;
        }
        processedEvents += 1;
      }
    } finally {
      this.draining = false;
    }
    return {
      processedEvents,
      deliveredListeners,
      pendingEvents: this.queue.length,
      truncated: this.queue.length > 0,
      errors,
    };
  }

  snapshotQueue(): GameplayEventEnvelope[] {
    return this.queue.map((event) => (
      cloneSerializableValue(event as unknown as SerializableRecord) as unknown as GameplayEventEnvelope
    ));
  }

  clear() {
    this.queue.length = 0;
  }

  clearListeners() {
    this.listeners.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.clearListeners();
    this.definitions.clear();
  }
}
