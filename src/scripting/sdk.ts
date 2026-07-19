import {
  BEHAVIOR_API_VERSION,
  DEFAULT_SERIALIZABLE_VALUE_LIMITS,
} from './studioSdkContract';
import type {
  AssetHandle,
  BehaviorDefinition,
  BehaviorPropertySchema,
  BehaviorSchemaIssue,
  ComponentHandle,
  EntityHandle,
  InferBehaviorProperties,
  SerializableValue,
  SerializableValueDiagnosticCode,
  SerializableValueLimits,
  SerializableValueValidationResult,
} from './studioSdkContract';

export * from './studioSdkContract';

export class BehaviorDefinitionError extends TypeError {
  readonly issues: readonly BehaviorSchemaIssue[];

  constructor(issues: readonly BehaviorSchemaIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'BehaviorDefinitionError';
    this.issues = issues;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

function validateMetadata(value: Record<string, unknown>, path: string, issues: BehaviorSchemaIssue[]) {
  for (const key of ['label', 'description', 'group'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].trim().length === 0)) {
      issues.push({ code: 'INVALID_PROPERTY_DEFINITION', path: `${path}.${key}`, message: 'must be a non-empty string.' });
    }
  }
}

function validateNumericRange(value: Record<string, unknown>, path: string, issues: BehaviorSchemaIssue[]) {
  for (const key of ['min', 'max'] as const) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) {
      issues.push({ code: 'INVALID_CONSTRAINT', path: `${path}.${key}`, message: 'must be a finite number.' });
    }
  }
  if (isFiniteNumber(value.min) && isFiniteNumber(value.max) && value.min > value.max) {
    issues.push({ code: 'INVALID_CONSTRAINT', path, message: 'min must be less than or equal to max.' });
  }
}

function validatePropertyDefinition(value: unknown, path: string, issues: BehaviorSchemaIssue[]) {
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    issues.push({ code: 'INVALID_PROPERTY_DEFINITION', path, message: 'must be a property definition object.' });
    return;
  }
  validateMetadata(value, path, issues);

  const keysByType: Record<string, readonly string[]> = {
    number: ['min', 'max', 'step'],
    boolean: [],
    string: ['maxLength', 'multiline'],
    color: [],
    enum: ['options'],
    vec2: ['min', 'max'],
    vec3: ['min', 'max'],
    entity: [],
    asset: ['assetKinds'],
  };
  const allowedKeys = new Set(['type', 'default', 'label', 'description', 'group', ...(keysByType[value.type] ?? [])]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({ code: 'INVALID_PROPERTY_DEFINITION', path: `${path}.${key}`, message: 'is not supported.' });
    }
  }
  if (!isSerializableValue(value)) {
    issues.push({ code: 'INVALID_PROPERTY_DEFINITION', path, message: 'must contain only finite serializable values.' });
  }

  switch (value.type) {
    case 'number': {
      validateNumericRange(value, path, issues);
      if (!isFiniteNumber(value.default)) {
        issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must be a finite number.' });
      } else {
        if (isFiniteNumber(value.min) && value.default < value.min) {
          issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must be greater than or equal to min.' });
        }
        if (isFiniteNumber(value.max) && value.default > value.max) {
          issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must be less than or equal to max.' });
        }
      }
      if (value.step !== undefined && (!isFiniteNumber(value.step) || value.step <= 0)) {
        issues.push({ code: 'INVALID_CONSTRAINT', path: `${path}.step`, message: 'must be a positive finite number.' });
      }
      break;
    }
    case 'boolean':
      if (typeof value.default !== 'boolean') {
        issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must be a boolean.' });
      }
      break;
    case 'string':
      if (typeof value.default !== 'string') {
        issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must be a string.' });
      }
      if (value.maxLength !== undefined && (!Number.isInteger(value.maxLength) || (value.maxLength as number) < 1)) {
        issues.push({ code: 'INVALID_CONSTRAINT', path: `${path}.maxLength`, message: 'must be a positive integer.' });
      } else if (typeof value.default === 'string' && typeof value.maxLength === 'number' && value.default.length > value.maxLength) {
        issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must not exceed maxLength.' });
      }
      if (value.multiline !== undefined && typeof value.multiline !== 'boolean') {
        issues.push({ code: 'INVALID_CONSTRAINT', path: `${path}.multiline`, message: 'must be a boolean.' });
      }
      break;
    case 'color':
      if (typeof value.default !== 'string' || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value.default)) {
        issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must be a #RRGGBB or #RRGGBBAA color.' });
      }
      break;
    case 'enum': {
      if (!Array.isArray(value.options) || value.options.length === 0 || value.options.some((option) => typeof option !== 'string')) {
        issues.push({ code: 'INVALID_CONSTRAINT', path: `${path}.options`, message: 'must contain at least one string option.' });
      } else if (new Set(value.options).size !== value.options.length) {
        issues.push({ code: 'INVALID_CONSTRAINT', path: `${path}.options`, message: 'must not contain duplicate options.' });
      }
      if (typeof value.default !== 'string' || !Array.isArray(value.options) || !value.options.includes(value.default)) {
        issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must match one of the enum options.' });
      }
      break;
    }
    case 'vec2':
    case 'vec3': {
      validateNumericRange(value, path, issues);
      const expectedLength = value.type === 'vec2' ? 2 : 3;
      const min = isFiniteNumber(value.min) ? value.min : null;
      const max = isFiniteNumber(value.max) ? value.max : null;
      if (!isFiniteTuple(value.default, expectedLength)) {
        issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: `must be a ${expectedLength}-element finite number tuple.` });
      } else if (
        (min !== null && value.default.some((entry) => entry < min))
        || (max !== null && value.default.some((entry) => entry > max))
      ) {
        issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must stay within the configured range.' });
      }
      break;
    }
    case 'entity':
      if (value.default !== null && (typeof value.default !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.default))) {
        issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must be a stable entity id or null.' });
      }
      break;
    case 'asset':
      if (value.default !== null && (typeof value.default !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.default))) {
        issues.push({ code: 'INVALID_DEFAULT', path: `${path}.default`, message: 'must be a stable asset id or null.' });
      }
      if (
        value.assetKinds !== undefined
        && (!Array.isArray(value.assetKinds) || value.assetKinds.some((kind) => typeof kind !== 'string' || kind.length === 0))
      ) {
        issues.push({ code: 'INVALID_CONSTRAINT', path: `${path}.assetKinds`, message: 'must contain non-empty asset kind strings.' });
      } else if (Array.isArray(value.assetKinds) && new Set(value.assetKinds).size !== value.assetKinds.length) {
        issues.push({ code: 'INVALID_CONSTRAINT', path: `${path}.assetKinds`, message: 'must not contain duplicate asset kinds.' });
      }
      break;
    default:
      issues.push({ code: 'INVALID_PROPERTY_DEFINITION', path: `${path}.type`, message: `unsupported property type "${value.type}".` });
  }
}

export function validateBehaviorSchema(schema: unknown): readonly BehaviorSchemaIssue[] {
  const issues: BehaviorSchemaIssue[] = [];
  if (!isPlainRecord(schema)) {
    return [{ code: 'INVALID_SCHEMA', path: 'schema', message: 'must be a plain object.' }];
  }
  for (const [propertyName, definition] of Object.entries(schema)) {
    const path = `schema.${propertyName}`;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(propertyName)) {
      issues.push({ code: 'INVALID_PROPERTY_NAME', path, message: 'must be a valid identifier.' });
    }
    validatePropertyDefinition(definition, path, issues);
  }
  return issues;
}

const BEHAVIOR_LIFECYCLE_KEYS = [
  'onStart',
  'onFixedUpdate',
  'onUpdate',
  'onAction',
  'onEvent',
  'onCollisionEnter',
  'onCollisionExit',
  'onDestroy',
] as const;

export function validateBehaviorDefinition(definition: unknown): readonly BehaviorSchemaIssue[] {
  if (!isPlainRecord(definition)) {
    return [{ code: 'INVALID_DEFINITION', path: 'definition', message: 'must be a plain object.' }];
  }
  const issues = [...validateBehaviorSchema(definition.schema)];
  const allowedKeys = new Set(['apiVersion', 'name', 'description', 'schema', ...BEHAVIOR_LIFECYCLE_KEYS]);
  for (const key of Object.keys(definition)) {
    if (!allowedKeys.has(key)) {
      issues.push({ code: 'INVALID_DEFINITION', path: `definition.${key}`, message: 'is not supported.' });
    }
  }
  for (const key of ['name', 'description'] as const) {
    if (definition[key] !== undefined && (typeof definition[key] !== 'string' || definition[key].trim().length === 0)) {
      issues.push({ code: 'INVALID_DEFINITION', path: key, message: 'must be a non-empty string.' });
    }
  }
  for (const key of BEHAVIOR_LIFECYCLE_KEYS) {
    if (definition[key] !== undefined && typeof definition[key] !== 'function') {
      issues.push({ code: 'INVALID_DEFINITION', path: key, message: 'must be a function.' });
    }
  }
  if (definition.apiVersion !== undefined && definition.apiVersion !== BEHAVIOR_API_VERSION) {
    issues.push({
      code: 'UNSUPPORTED_API_VERSION',
      path: 'apiVersion',
      message: `must be ${BEHAVIOR_API_VERSION}.`,
    });
  }
  return issues;
}

const serializableTextEncoder = new TextEncoder();

function assertSerializableLimits(limits: SerializableValueLimits) {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`Serializable value limit ${name} must be a non-negative safe integer.`);
    }
  }
}

function stringByteLength(value: string) {
  return serializableTextEncoder.encode(value).byteLength;
}

function jsonStringByteLength(value: string) {
  return stringByteLength(JSON.stringify(value));
}

function childPath(parentPath: string, key: string | number) {
  if (typeof key === 'number') return `${parentPath}[${key}]`;
  const visibleKey = key.length > 64 ? `${key.slice(0, 61)}...` : key;
  return `${parentPath}[${JSON.stringify(visibleKey)}]`;
}

type SerializableTraversalFrame =
  | Readonly<{ readonly kind: 'value'; readonly value: unknown; readonly depth: number; readonly path: string }>
  | Readonly<{ readonly kind: 'leave'; readonly value: object }>;

/**
 * Iteratively validates JSON-like data and returns a stable first-failure
 * diagnostic. The iterative walk is intentional: hostile nesting must result
 * in a limit diagnostic, never a JavaScript call-stack overflow.
 */
export function validateSerializableValue(
  value: unknown,
  limits: Readonly<SerializableValueLimits> = DEFAULT_SERIALIZABLE_VALUE_LIMITS,
): SerializableValueValidationResult {
  assertSerializableLimits(limits);
  const activeAncestors = new Set<object>();
  const stack: SerializableTraversalFrame[] = [{ kind: 'value', value, depth: 0, path: '$' }];
  let nodeCount = 0;
  let totalBytes = 0;

  const reject = (
    code: SerializableValueDiagnosticCode,
    path: string,
    message: string,
  ): SerializableValueValidationResult => ({
    ok: false,
    nodeCount,
    totalBytes,
    diagnostic: { code, path, message },
  });
  const addBytes = (amount: number, path: string): SerializableValueValidationResult | null => {
    totalBytes += amount;
    if (totalBytes > limits.maxTotalBytes) {
      return reject(
        'SERIALIZABLE_MAX_TOTAL_BYTES',
        path,
        `Serialized data exceeds the ${limits.maxTotalBytes} byte limit.`,
      );
    }
    return null;
  };

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.kind === 'leave') {
      activeAncestors.delete(frame.value);
      continue;
    }

    if (frame.depth > limits.maxDepth) {
      return reject(
        'SERIALIZABLE_MAX_DEPTH',
        frame.path,
        `Serialized data exceeds the maximum depth of ${limits.maxDepth}.`,
      );
    }
    nodeCount += 1;
    if (nodeCount > limits.maxNodes) {
      return reject(
        'SERIALIZABLE_MAX_NODES',
        frame.path,
        `Serialized data exceeds the ${limits.maxNodes} node limit.`,
      );
    }

    const candidate = frame.value;
    if (candidate === null) {
      const failure = addBytes(4, frame.path);
      if (failure) return failure;
      continue;
    }
    if (typeof candidate === 'boolean') {
      const failure = addBytes(candidate ? 4 : 5, frame.path);
      if (failure) return failure;
      continue;
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        return reject('SERIALIZABLE_NON_FINITE_NUMBER', frame.path, 'Numbers must be finite.');
      }
      const failure = addBytes(String(Object.is(candidate, -0) ? 0 : candidate).length, frame.path);
      if (failure) return failure;
      continue;
    }
    if (typeof candidate === 'string') {
      const contentBytes = stringByteLength(candidate);
      if (contentBytes > limits.maxStringBytes) {
        return reject(
          'SERIALIZABLE_MAX_STRING_BYTES',
          frame.path,
          `String data exceeds the ${limits.maxStringBytes} byte per-string limit.`,
        );
      }
      const failure = addBytes(jsonStringByteLength(candidate), frame.path);
      if (failure) return failure;
      continue;
    }
    if (typeof candidate !== 'object') {
      return reject(
        'SERIALIZABLE_INVALID_TYPE',
        frame.path,
        `Values of type ${typeof candidate} are not serializable.`,
      );
    }
    if (activeAncestors.has(candidate)) {
      return reject('SERIALIZABLE_CYCLE', frame.path, 'Cyclic references are not serializable.');
    }

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(candidate);
    } catch {
      return reject('SERIALIZABLE_ACCESS_ERROR', frame.path, 'The value could not be safely inspected.');
    }
    if (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null) {
      return reject('SERIALIZABLE_NON_PLAIN_OBJECT', frame.path, 'Objects must use a plain or null prototype.');
    }

    activeAncestors.add(candidate);
    stack.push({ kind: 'leave', value: candidate });

    if (Array.isArray(candidate)) {
      let arrayLength: number;
      try {
        arrayLength = candidate.length;
      } catch {
        return reject('SERIALIZABLE_ACCESS_ERROR', frame.path, 'The array could not be safely inspected.');
      }
      if (arrayLength > limits.maxNodes - nodeCount) {
        return reject(
          'SERIALIZABLE_MAX_NODES',
          frame.path,
          `Serialized data exceeds the ${limits.maxNodes} node limit.`,
        );
      }
      const containerFailure = addBytes(2 + Math.max(0, arrayLength - 1), frame.path);
      if (containerFailure) return containerFailure;
      for (let index = arrayLength - 1; index >= 0; index -= 1) {
        let hasEntry: boolean;
        let child: unknown;
        try {
          hasEntry = Object.hasOwn(candidate, index);
          child = candidate[index];
        } catch {
          return reject('SERIALIZABLE_ACCESS_ERROR', childPath(frame.path, index), 'The array entry could not be safely inspected.');
        }
        if (!hasEntry) {
          return reject(
            'SERIALIZABLE_ARRAY_HOLE',
            childPath(frame.path, index),
            'Sparse array entries are not serializable plain data.',
          );
        }
        stack.push({ kind: 'value', value: child, depth: frame.depth + 1, path: childPath(frame.path, index) });
      }
      continue;
    }

    let keys: string[];
    try {
      keys = Object.keys(candidate);
    } catch {
      return reject('SERIALIZABLE_ACCESS_ERROR', frame.path, 'The object could not be safely inspected.');
    }
    if (keys.length > limits.maxNodes - nodeCount) {
      return reject(
        'SERIALIZABLE_MAX_NODES',
        frame.path,
        `Serialized data exceeds the ${limits.maxNodes} node limit.`,
      );
    }
    const containerFailure = addBytes(2 + Math.max(0, keys.length - 1), frame.path);
    if (containerFailure) return containerFailure;
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      const keyPath = childPath(frame.path, key);
      const keyBytes = stringByteLength(key);
      if (keyBytes > limits.maxStringBytes) {
        return reject(
          'SERIALIZABLE_MAX_STRING_BYTES',
          keyPath,
          `Object key exceeds the ${limits.maxStringBytes} byte per-string limit.`,
        );
      }
      const keyFailure = addBytes(jsonStringByteLength(key) + 1, keyPath);
      if (keyFailure) return keyFailure;
      let child: unknown;
      try {
        child = (candidate as Record<string, unknown>)[key];
      } catch {
        return reject('SERIALIZABLE_ACCESS_ERROR', keyPath, 'The property could not be safely inspected.');
      }
      stack.push({ kind: 'value', value: child, depth: frame.depth + 1, path: keyPath });
    }
  }

  return { ok: true, nodeCount, totalBytes };
}

export function isSerializableValue(
  value: unknown,
  limits: Readonly<SerializableValueLimits> = DEFAULT_SERIALIZABLE_VALUE_LIMITS,
): value is SerializableValue {
  return validateSerializableValue(value, limits).ok;
}

function assertStableHandlePart(value: string, label: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new TypeError(`${label} must be a stable identifier.`);
}

function assertGeneration(generation: number) {
  if (!Number.isSafeInteger(generation) || generation < 0) throw new RangeError('Handle generation must be a non-negative safe integer.');
}

export function createEntityHandle(id: string, sceneId: string, generation: number): EntityHandle {
  assertStableHandlePart(id, 'Entity id');
  assertStableHandlePart(sceneId, 'Scene id');
  assertGeneration(generation);
  return Object.freeze({ kind: 'entity', id, sceneId, generation });
}

export function createComponentHandle(id: string, entityId: string, generation: number): ComponentHandle {
  assertStableHandlePart(id, 'Component id');
  assertStableHandlePart(entityId, 'Entity id');
  assertGeneration(generation);
  return Object.freeze({ kind: 'component', id, entityId, generation });
}

export function createAssetHandle(id: string, assetKind: string, revision: number): AssetHandle {
  assertStableHandlePart(id, 'Asset id');
  assertStableHandlePart(assetKind, 'Asset kind');
  if (!Number.isSafeInteger(revision) || revision < 0) throw new RangeError('Asset revision must be a non-negative safe integer.');
  return Object.freeze({ kind: 'asset', id, assetKind, revision });
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function createDefaultBehaviorProperties<const TSchema extends BehaviorPropertySchema>(
  schema: TSchema,
): InferBehaviorProperties<TSchema> {
  const issues = validateBehaviorSchema(schema);
  if (issues.length > 0) throw new BehaviorDefinitionError(issues);
  const defaults = Object.fromEntries(
    Object.entries(schema).map(([key, definition]) => [key, structuredClone(definition.default)]),
  );
  return deepFreeze(defaults) as InferBehaviorProperties<TSchema>;
}

export function defineBehavior<const TSchema extends BehaviorPropertySchema>(
  definition: BehaviorDefinition<TSchema>,
): Readonly<BehaviorDefinition<TSchema>> {
  const issues = validateBehaviorDefinition(definition);
  if (issues.length > 0) throw new BehaviorDefinitionError(issues);

  const normalized = {
    ...definition,
    apiVersion: BEHAVIOR_API_VERSION,
    schema: structuredClone(definition.schema),
  } satisfies BehaviorDefinition<TSchema>;
  return deepFreeze(normalized) as Readonly<BehaviorDefinition<TSchema>>;
}
