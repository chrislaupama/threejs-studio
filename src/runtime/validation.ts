import type { RuntimeSessionIdentity } from './types';

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const MAX_TOKEN_LENGTH = 128;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;
const MAX_JSON_STRING_LENGTH = 100_000;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateSafeToken(value: unknown, path: string): string[] {
  if (typeof value !== 'string') return [`${path} must be a string.`];
  if (value.length === 0) return [`${path} must not be empty.`];
  if (value.length > MAX_TOKEN_LENGTH) return [`${path} must be at most ${MAX_TOKEN_LENGTH} characters.`];
  if (!SAFE_TOKEN_PATTERN.test(value)) {
    return [`${path} must begin with an alphanumeric character and contain only letters, numbers, dot, underscore, colon, or hyphen.`];
  }
  return [];
}

export function validateRuntimeIdentity(value: unknown, path = 'identity'): string[] {
  if (!isPlainRecord(value)) return [`${path} must be a plain object.`];
  const errors = [
    ...validateSafeToken(value.sessionId, `${path}.sessionId`),
    ...validateSafeToken(value.buildHash, `${path}.buildHash`),
  ];
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    errors.push(`${path}.revision must be a non-negative safe integer.`);
  }
  const extraKeys = Object.keys(value).filter((key) => !['sessionId', 'revision', 'buildHash'].includes(key));
  for (const key of extraKeys) errors.push(`${path}.${key} is not supported.`);
  return errors;
}

export function cloneRuntimeIdentity(identity: RuntimeSessionIdentity): RuntimeSessionIdentity {
  return {
    sessionId: identity.sessionId,
    revision: identity.revision,
    buildHash: identity.buildHash,
  };
}

export function isJsonValue(value: unknown): value is JsonValue {
  const ancestors = new Set<object>();
  let remainingNodes = MAX_JSON_NODES;

  const visit = (entry: unknown, depth: number): boolean => {
    remainingNodes -= 1;
    if (remainingNodes < 0) return false;
    if (entry === null || typeof entry === 'boolean') return true;
    if (typeof entry === 'string') return entry.length <= MAX_JSON_STRING_LENGTH;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (typeof entry !== 'object' || depth > MAX_JSON_DEPTH) return false;
    if (ancestors.has(entry)) return false;

    ancestors.add(entry);
    let valid: boolean;
    if (Array.isArray(entry)) {
      valid = entry.every((item) => visit(item, depth + 1));
    } else if (isPlainRecord(entry)) {
      valid = Object.values(entry).every((item) => visit(item, depth + 1));
    } else {
      valid = false;
    }
    ancestors.delete(entry);
    return valid;
  };

  return visit(value, 0);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value);
}
