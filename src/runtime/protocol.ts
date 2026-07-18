import {
  RUNTIME_FIXED_DELTA_SECONDS,
  RUNTIME_FIXED_HZ,
  RUNTIME_MAX_CATCH_UP_STEPS,
  RUNTIME_SYSTEM_ORDER,
  type RuntimeDiagnostics,
  type RuntimeSessionIdentity,
  type RuntimeSessionStatus,
  type RuntimeSystemPhase,
  type RuntimeSystemStage,
} from './types';
import {
  cloneRuntimeIdentity,
  isJsonValue,
  isPlainObject,
  type JsonValue,
  validateRuntimeIdentity,
  validateSafeToken,
} from './validation';

export const RUNTIME_IFRAME_PROTOCOL = 'threejs-studio.runtime';
export const RUNTIME_IFRAME_PROTOCOL_VERSION = 1;

export const RUNTIME_CONTROL_ACTIONS = [
  'start',
  'pause',
  'resume',
  'step',
  'restart',
  'dispose',
] as const;

export type RuntimeControlAction = (typeof RUNTIME_CONTROL_ACTIONS)[number];

interface RuntimeIframeEnvelope extends RuntimeSessionIdentity {
  protocol: typeof RUNTIME_IFRAME_PROTOCOL;
  protocolVersion: typeof RUNTIME_IFRAME_PROTOCOL_VERSION;
}

export interface RuntimeCommandMessage extends RuntimeIframeEnvelope {
  type: 'runtime.command';
  requestId: string;
  action: RuntimeControlAction;
}

export interface RuntimeReadyMessage extends RuntimeIframeEnvelope {
  type: 'runtime.ready';
  diagnostics: RuntimeDiagnostics;
}

export interface RuntimeDiagnosticsMessage extends RuntimeIframeEnvelope {
  type: 'runtime.diagnostics';
  diagnostics: RuntimeDiagnostics;
}

export interface RuntimeResultMessage extends RuntimeIframeEnvelope {
  type: 'runtime.result';
  requestId: string;
  action: RuntimeControlAction;
  ok: true;
  diagnostics: RuntimeDiagnostics;
}

export interface RuntimeErrorMessage extends RuntimeIframeEnvelope {
  type: 'runtime.error';
  requestId: string | null;
  code: string;
  message: string;
  fatal: boolean;
  details?: JsonValue;
}

export type RuntimeIframeMessage =
  | RuntimeCommandMessage
  | RuntimeReadyMessage
  | RuntimeDiagnosticsMessage
  | RuntimeResultMessage
  | RuntimeErrorMessage;

export type RuntimeProtocolValidationResult =
  | { ok: true; message: RuntimeIframeMessage }
  | { ok: false; errors: string[] };

export class RuntimeProtocolValidationError extends Error {
  readonly errors: string[];

  constructor(errors: readonly string[]) {
    super(errors.join(' '));
    this.name = 'RuntimeProtocolValidationError';
    this.errors = [...errors];
  }
}

const SESSION_STATUSES: readonly RuntimeSessionStatus[] = ['idle', 'running', 'paused', 'failed', 'disposed'];
const SYSTEM_PHASES: readonly RuntimeSystemPhase[] = [
  'initialize',
  'fixed-update',
  'render',
  'pause',
  'resume',
  'restart',
  'dispose',
];

function addUnsupportedKeyErrors(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) errors.push(`${path}.${key} is not supported.`);
  }
}

function validateFiniteNumber(
  value: unknown,
  path: string,
  errors: string[],
  options: { integer?: boolean; minimum?: number } = {},
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number.`);
    return;
  }
  if (options.integer && !Number.isSafeInteger(value)) errors.push(`${path} must be a safe integer.`);
  if (options.minimum !== undefined && value < options.minimum) errors.push(`${path} must be at least ${options.minimum}.`);
}

function validateAdvanceDiagnostics(value: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be a plain object.`);
    return;
  }
  addUnsupportedKeyErrors(
    value,
    ['frameDeltaSeconds', 'fixedSteps', 'droppedSeconds', 'interpolationAlpha'],
    path,
    errors,
  );
  validateFiniteNumber(value.frameDeltaSeconds, `${path}.frameDeltaSeconds`, errors, { minimum: 0 });
  validateFiniteNumber(value.fixedSteps, `${path}.fixedSteps`, errors, { integer: true, minimum: 0 });
  validateFiniteNumber(value.droppedSeconds, `${path}.droppedSeconds`, errors, { minimum: 0 });
  validateFiniteNumber(value.interpolationAlpha, `${path}.interpolationAlpha`, errors, { minimum: 0 });
  if (typeof value.interpolationAlpha === 'number' && value.interpolationAlpha >= 1) {
    errors.push(`${path}.interpolationAlpha must be less than 1.`);
  }
}

function validateSystemDiagnostics(value: unknown, path: string, errors: string[]): RuntimeSystemStage | null {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be a plain object.`);
    return null;
  }
  addUnsupportedKeyErrors(
    value,
    ['id', 'stage', 'fixedUpdateCalls', 'renderCalls', 'lastDurationMs', 'totalDurationMs'],
    path,
    errors,
  );
  errors.push(...validateSafeToken(value.id, `${path}.id`));
  if (typeof value.stage !== 'string' || !RUNTIME_SYSTEM_ORDER.includes(value.stage as RuntimeSystemStage)) {
    errors.push(`${path}.stage must be one of: ${RUNTIME_SYSTEM_ORDER.join(', ')}.`);
  }
  validateFiniteNumber(value.fixedUpdateCalls, `${path}.fixedUpdateCalls`, errors, { integer: true, minimum: 0 });
  validateFiniteNumber(value.renderCalls, `${path}.renderCalls`, errors, { integer: true, minimum: 0 });
  validateFiniteNumber(value.lastDurationMs, `${path}.lastDurationMs`, errors, { minimum: 0 });
  validateFiniteNumber(value.totalDurationMs, `${path}.totalDurationMs`, errors, { minimum: 0 });
  return typeof value.stage === 'string' && RUNTIME_SYSTEM_ORDER.includes(value.stage as RuntimeSystemStage)
    ? value.stage as RuntimeSystemStage
    : null;
}

function validateFailureDiagnostics(value: unknown, path: string, errors: string[]): void {
  if (value === null) return;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be null or a plain object.`);
    return;
  }
  addUnsupportedKeyErrors(value, ['code', 'message', 'systemId', 'stage', 'phase'], path, errors);
  if (value.code !== 'system_failure') errors.push(`${path}.code must be "system_failure".`);
  if (typeof value.message !== 'string' || value.message.length === 0) errors.push(`${path}.message must be a non-empty string.`);
  errors.push(...validateSafeToken(value.systemId, `${path}.systemId`));
  if (typeof value.stage !== 'string' || !RUNTIME_SYSTEM_ORDER.includes(value.stage as RuntimeSystemStage)) {
    errors.push(`${path}.stage must be one of: ${RUNTIME_SYSTEM_ORDER.join(', ')}.`);
  }
  if (typeof value.phase !== 'string' || !SYSTEM_PHASES.includes(value.phase as RuntimeSystemPhase)) {
    errors.push(`${path}.phase is not a supported runtime system phase.`);
  }
}

export function validateRuntimeDiagnostics(value: unknown, path = 'diagnostics'): string[] {
  const errors: string[] = [];
  if (!isPlainObject(value)) return [`${path} must be a plain object.`];
  addUnsupportedKeyErrors(value, [
    'sessionId',
    'revision',
    'buildHash',
    'status',
    'fixedHz',
    'fixedDeltaSeconds',
    'maxCatchUpSteps',
    'tick',
    'frame',
    'restartCount',
    'simulationTimeSeconds',
    'accumulatorSeconds',
    'totalDroppedSeconds',
    'catchUpClampCount',
    'lastAdvance',
    'systems',
    'lastFailure',
  ], path, errors);

  errors.push(...validateRuntimeIdentity({
    sessionId: value.sessionId,
    revision: value.revision,
    buildHash: value.buildHash,
  }, path));
  if (typeof value.status !== 'string' || !SESSION_STATUSES.includes(value.status as RuntimeSessionStatus)) {
    errors.push(`${path}.status is not a supported runtime session status.`);
  }
  if (value.fixedHz !== RUNTIME_FIXED_HZ) errors.push(`${path}.fixedHz must be ${RUNTIME_FIXED_HZ}.`);
  if (value.fixedDeltaSeconds !== RUNTIME_FIXED_DELTA_SECONDS) {
    errors.push(`${path}.fixedDeltaSeconds must be ${RUNTIME_FIXED_DELTA_SECONDS}.`);
  }
  if (value.maxCatchUpSteps !== RUNTIME_MAX_CATCH_UP_STEPS) {
    errors.push(`${path}.maxCatchUpSteps must be ${RUNTIME_MAX_CATCH_UP_STEPS}.`);
  }
  validateFiniteNumber(value.tick, `${path}.tick`, errors, { integer: true, minimum: 0 });
  validateFiniteNumber(value.frame, `${path}.frame`, errors, { integer: true, minimum: 0 });
  validateFiniteNumber(value.restartCount, `${path}.restartCount`, errors, { integer: true, minimum: 0 });
  validateFiniteNumber(value.simulationTimeSeconds, `${path}.simulationTimeSeconds`, errors, { minimum: 0 });
  validateFiniteNumber(value.accumulatorSeconds, `${path}.accumulatorSeconds`, errors, { minimum: 0 });
  if (typeof value.accumulatorSeconds === 'number' && value.accumulatorSeconds >= RUNTIME_FIXED_DELTA_SECONDS) {
    errors.push(`${path}.accumulatorSeconds must be less than one fixed timestep.`);
  }
  validateFiniteNumber(value.totalDroppedSeconds, `${path}.totalDroppedSeconds`, errors, { minimum: 0 });
  validateFiniteNumber(value.catchUpClampCount, `${path}.catchUpClampCount`, errors, { integer: true, minimum: 0 });
  validateAdvanceDiagnostics(value.lastAdvance, `${path}.lastAdvance`, errors);
  validateFailureDiagnostics(value.lastFailure, `${path}.lastFailure`, errors);

  if (!Array.isArray(value.systems)) {
    errors.push(`${path}.systems must be an array.`);
  } else {
    if (value.systems.length > 256) errors.push(`${path}.systems must contain at most 256 entries.`);
    const ids = new Set<string>();
    let previousStageIndex = -1;
    value.systems.forEach((system, index) => {
      const stage = validateSystemDiagnostics(system, `${path}.systems[${index}]`, errors);
      if (isPlainObject(system) && typeof system.id === 'string') {
        if (ids.has(system.id)) errors.push(`${path}.systems[${index}].id duplicates "${system.id}".`);
        ids.add(system.id);
      }
      if (stage) {
        const stageIndex = RUNTIME_SYSTEM_ORDER.indexOf(stage);
        if (stageIndex < previousStageIndex) errors.push(`${path}.systems must follow runtime system order.`);
        previousStageIndex = Math.max(previousStageIndex, stageIndex);
      }
    });
  }
  return errors;
}

function validateEnvelope(value: Record<string, unknown>, errors: string[]): void {
  if (value.protocol !== RUNTIME_IFRAME_PROTOCOL) {
    errors.push(`message.protocol must be "${RUNTIME_IFRAME_PROTOCOL}".`);
  }
  if (value.protocolVersion !== RUNTIME_IFRAME_PROTOCOL_VERSION) {
    errors.push(`message.protocolVersion must be ${RUNTIME_IFRAME_PROTOCOL_VERSION}.`);
  }
  errors.push(...validateRuntimeIdentity({
    sessionId: value.sessionId,
    revision: value.revision,
    buildHash: value.buildHash,
  }, 'message'));
}

function validateDiagnosticsIdentity(message: Record<string, unknown>, errors: string[]): void {
  if (!isPlainObject(message.diagnostics)) return;
  for (const field of ['sessionId', 'revision', 'buildHash'] as const) {
    if (message[field] !== message.diagnostics[field]) {
      errors.push(`message.diagnostics.${field} must match message.${field}.`);
    }
  }
}

export function validateRuntimeIframeMessage(value: unknown): RuntimeProtocolValidationResult {
  if (!isJsonValue(value)) return { ok: false, errors: ['message must be a finite, acyclic JSON value.'] };
  if (!isPlainObject(value)) return { ok: false, errors: ['message must be a plain object.'] };

  const errors: string[] = [];
  validateEnvelope(value, errors);
  const envelopeKeys = ['protocol', 'protocolVersion', 'sessionId', 'revision', 'buildHash', 'type'];

  if (value.type === 'runtime.command') {
    addUnsupportedKeyErrors(value, [...envelopeKeys, 'requestId', 'action'], 'message', errors);
    errors.push(...validateSafeToken(value.requestId, 'message.requestId'));
    if (typeof value.action !== 'string' || !RUNTIME_CONTROL_ACTIONS.includes(value.action as RuntimeControlAction)) {
      errors.push(`message.action must be one of: ${RUNTIME_CONTROL_ACTIONS.join(', ')}.`);
    }
  } else if (value.type === 'runtime.ready' || value.type === 'runtime.diagnostics') {
    addUnsupportedKeyErrors(value, [...envelopeKeys, 'diagnostics'], 'message', errors);
    errors.push(...validateRuntimeDiagnostics(value.diagnostics, 'message.diagnostics'));
    validateDiagnosticsIdentity(value, errors);
  } else if (value.type === 'runtime.result') {
    addUnsupportedKeyErrors(value, [...envelopeKeys, 'requestId', 'action', 'ok', 'diagnostics'], 'message', errors);
    errors.push(...validateSafeToken(value.requestId, 'message.requestId'));
    if (typeof value.action !== 'string' || !RUNTIME_CONTROL_ACTIONS.includes(value.action as RuntimeControlAction)) {
      errors.push(`message.action must be one of: ${RUNTIME_CONTROL_ACTIONS.join(', ')}.`);
    }
    if (value.ok !== true) errors.push('message.ok must be true.');
    errors.push(...validateRuntimeDiagnostics(value.diagnostics, 'message.diagnostics'));
    validateDiagnosticsIdentity(value, errors);
  } else if (value.type === 'runtime.error') {
    addUnsupportedKeyErrors(value, [...envelopeKeys, 'requestId', 'code', 'message', 'fatal', 'details'], 'message', errors);
    if (value.requestId !== null) errors.push(...validateSafeToken(value.requestId, 'message.requestId'));
    errors.push(...validateSafeToken(value.code, 'message.code'));
    if (typeof value.message !== 'string' || value.message.length === 0 || value.message.length > 2_000) {
      errors.push('message.message must be a non-empty string of at most 2000 characters.');
    }
    if (typeof value.fatal !== 'boolean') errors.push('message.fatal must be a boolean.');
  } else {
    errors.push('message.type is not a supported runtime iframe message type.');
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, message: value as unknown as RuntimeIframeMessage };
}

export function parseRuntimeIframeMessage(value: unknown): RuntimeIframeMessage {
  const result = validateRuntimeIframeMessage(value);
  if (!result.ok) throw new RuntimeProtocolValidationError(result.errors);
  return result.message;
}

function envelope(identity: RuntimeSessionIdentity): RuntimeIframeEnvelope {
  const errors = validateRuntimeIdentity(identity);
  if (errors.length) throw new RuntimeProtocolValidationError(errors);
  return {
    protocol: RUNTIME_IFRAME_PROTOCOL,
    protocolVersion: RUNTIME_IFRAME_PROTOCOL_VERSION,
    ...cloneRuntimeIdentity(identity),
  };
}

function assertDiagnostics(identity: RuntimeSessionIdentity, diagnostics: RuntimeDiagnostics): void {
  const errors = validateRuntimeDiagnostics(diagnostics);
  for (const field of ['sessionId', 'revision', 'buildHash'] as const) {
    if (identity[field] !== diagnostics[field]) errors.push(`diagnostics.${field} must match identity.${field}.`);
  }
  if (errors.length) throw new RuntimeProtocolValidationError(errors);
}

export function createRuntimeCommandMessage(
  identity: RuntimeSessionIdentity,
  requestId: string,
  action: RuntimeControlAction,
): RuntimeCommandMessage {
  return parseRuntimeIframeMessage({
    ...envelope(identity),
    type: 'runtime.command',
    requestId,
    action,
  }) as RuntimeCommandMessage;
}

export function createRuntimeReadyMessage(
  identity: RuntimeSessionIdentity,
  diagnostics: RuntimeDiagnostics,
): RuntimeReadyMessage {
  assertDiagnostics(identity, diagnostics);
  return {
    ...envelope(identity),
    type: 'runtime.ready',
    diagnostics,
  };
}

export function createRuntimeDiagnosticsMessage(
  identity: RuntimeSessionIdentity,
  diagnostics: RuntimeDiagnostics,
): RuntimeDiagnosticsMessage {
  assertDiagnostics(identity, diagnostics);
  return {
    ...envelope(identity),
    type: 'runtime.diagnostics',
    diagnostics,
  };
}

export function createRuntimeResultMessage(
  identity: RuntimeSessionIdentity,
  requestId: string,
  action: RuntimeControlAction,
  diagnostics: RuntimeDiagnostics,
): RuntimeResultMessage {
  assertDiagnostics(identity, diagnostics);
  return parseRuntimeIframeMessage({
    ...envelope(identity),
    type: 'runtime.result',
    requestId,
    action,
    ok: true,
    diagnostics,
  }) as RuntimeResultMessage;
}

export function createRuntimeErrorMessage(
  identity: RuntimeSessionIdentity,
  error: {
    requestId?: string | null;
    code: string;
    message: string;
    fatal: boolean;
    details?: JsonValue;
  },
): RuntimeErrorMessage {
  const message: RuntimeErrorMessage = {
    ...envelope(identity),
    type: 'runtime.error',
    requestId: error.requestId ?? null,
    code: error.code,
    message: error.message,
    fatal: error.fatal,
    ...(error.details === undefined ? {} : { details: error.details }),
  };
  return parseRuntimeIframeMessage(message) as RuntimeErrorMessage;
}
