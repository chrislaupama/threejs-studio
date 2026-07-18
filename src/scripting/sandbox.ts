import {
  validateSerializableValue,
  type SerializableValue,
  type SerializableValueDiagnostic,
  type SerializableValueDiagnosticCode,
  type SerializableValueLimits,
} from './sdk';

export const SCRIPT_SANDBOX_PROTOCOL = 'threejs-studio.runtime' as const;
export const SCRIPT_SANDBOX_PROTOCOL_VERSION = 1 as const;
export const SCRIPT_SANDBOX_ATTRIBUTE = 'allow-scripts allow-pointer-lock' as const;
export const SCRIPT_SANDBOX_REFERRER_POLICY = 'no-referrer' as const;
export const SCRIPT_SANDBOX_ALLOW = 'gamepad' as const;
export const MAX_SANDBOX_MODULE_BYTES = 16 * 1024 * 1024;
export const SCRIPT_SANDBOX_MESSAGE_LIMITS: Readonly<SerializableValueLimits> = Object.freeze({
  maxDepth: 32,
  maxNodes: 20_000,
  maxStringBytes: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
});
export const SCRIPT_SANDBOX_PROJECT_SNAPSHOT_LIMITS: Readonly<SerializableValueLimits> = Object.freeze({
  maxDepth: 64,
  maxNodes: 200_000,
  maxStringBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
});

const SCRIPT_SANDBOX_INITIALIZE_LIMITS: Readonly<SerializableValueLimits> = Object.freeze({
  maxDepth: SCRIPT_SANDBOX_PROJECT_SNAPSHOT_LIMITS.maxDepth + 1,
  maxNodes: SCRIPT_SANDBOX_PROJECT_SNAPSHOT_LIMITS.maxNodes + 8,
  maxStringBytes: MAX_SANDBOX_MODULE_BYTES,
  maxTotalBytes: 64 * 1024 * 1024,
});

export type SandboxHostControl = 'start' | 'pause' | 'resume' | 'step' | 'restart' | 'dispose';

export interface SandboxMessage<TType extends string = string, TPayload = SerializableValue> {
  readonly protocol: typeof SCRIPT_SANDBOX_PROTOCOL;
  readonly protocolVersion: typeof SCRIPT_SANDBOX_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly sequence: number;
  readonly type: TType;
  readonly payload: TPayload;
}

export interface SandboxInitializePayload {
  readonly projectRevision: number;
  readonly contentHash: string;
  readonly moduleCode: string;
  readonly projectSnapshot: SerializableValue;
}

export type SandboxHostMessage =
  | SandboxMessage<'host.connect', null>
  | SandboxMessage<'host.initialize', SandboxInitializePayload>
  | SandboxMessage<'host.control', { readonly command: SandboxHostControl }>;

export type SandboxRuntimeMessage =
  | SandboxMessage<'runtime.bootstrap-ready', null>
  | SandboxMessage<'runtime.ready', { readonly exports: readonly string[]; readonly contentHash: string }>
  | SandboxMessage<'runtime.status', SerializableValue>
  | SandboxMessage<'runtime.diagnostic', { readonly level: 'info' | 'warning' | 'error'; readonly message: string }>
  | SandboxMessage<'runtime.fatal', { readonly code: string; readonly message: string }>
  | SandboxMessage<'runtime.dispose-ack', null>;

export interface SandboxDocument {
  readonly sessionId: string;
  readonly nonce: string;
  readonly sandbox: typeof SCRIPT_SANDBOX_ATTRIBUTE;
  readonly referrerPolicy: typeof SCRIPT_SANDBOX_REFERRER_POLICY;
  readonly allow: typeof SCRIPT_SANDBOX_ALLOW;
  readonly csp: string;
  readonly srcdoc: string;
}

export interface SandboxDocumentOptions {
  readonly sessionId: string;
  readonly nonce?: string;
  readonly title?: string;
}

export type SandboxMessageDiagnosticCode =
  | 'SANDBOX_INVALID_ENVELOPE'
  | 'SANDBOX_INVALID_PROTOCOL'
  | 'SANDBOX_INVALID_PROTOCOL_VERSION'
  | 'SANDBOX_INVALID_SESSION_ID'
  | 'SANDBOX_INVALID_SEQUENCE'
  | 'SANDBOX_INVALID_MESSAGE_TYPE'
  | SerializableValueDiagnosticCode;

export interface SandboxMessageDiagnostic {
  readonly code: SandboxMessageDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export type SandboxMessageValidationResult =
  | Readonly<{ readonly ok: true; readonly message: SandboxMessage }>
  | Readonly<{ readonly ok: false; readonly diagnostic: SandboxMessageDiagnostic }>;

export class SandboxPayloadValidationError extends TypeError {
  readonly code: SerializableValueDiagnosticCode;
  readonly path: string;

  constructor(diagnostic: SerializableValueDiagnostic) {
    super(`${diagnostic.path}: ${diagnostic.message}`);
    this.name = 'SandboxPayloadValidationError';
    this.code = diagnostic.code;
    this.path = diagnostic.path;
  }
}

const textEncoder = new TextEncoder();

function assertSessionId(sessionId: string) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) {
    throw new TypeError('Sandbox sessionId must be a stable identifier with at most 128 characters.');
  }
}

function assertSequence(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError('Sandbox message sequence must be a non-negative safe integer.');
  }
}

function randomNonce() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Web Crypto is required to create a sandbox nonce.');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertNonce(nonce: string) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new TypeError('Sandbox nonce contains unsupported characters.');
}

function safeScriptJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildSandboxCsp(nonce: string) {
  assertNonce(nonce);
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'`,
    `style-src 'nonce-${nonce}'`,
    "worker-src blob:",
    "connect-src 'none'",
    'img-src data: blob:',
    'media-src data: blob:',
    'font-src data: blob:',
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function createSandboxMessageWithLimits<TType extends string, TPayload>(
  sessionId: string,
  sequence: number,
  type: TType,
  payload: TPayload,
  limits: Readonly<SerializableValueLimits>,
): SandboxMessage<TType, TPayload> {
  assertSessionId(sessionId);
  assertSequence(sequence);
  if (!type || !/^[a-z]+(?:[.-][a-z]+)*$/.test(type)) throw new TypeError('Sandbox message type is invalid.');
  const payloadValidation = validateSerializableValue(payload, limits);
  if (!payloadValidation.ok) throw new SandboxPayloadValidationError(payloadValidation.diagnostic);
  return {
    protocol: SCRIPT_SANDBOX_PROTOCOL,
    protocolVersion: SCRIPT_SANDBOX_PROTOCOL_VERSION,
    sessionId,
    sequence,
    type,
    payload,
  };
}

export function createSandboxMessage<TType extends string, TPayload>(
  sessionId: string,
  sequence: number,
  type: TType,
  payload: TPayload,
): SandboxMessage<TType, TPayload> {
  return createSandboxMessageWithLimits(sessionId, sequence, type, payload, SCRIPT_SANDBOX_MESSAGE_LIMITS);
}

export function createSandboxConnectionMessage(sessionId: string): SandboxMessage<'host.connect', null> {
  return createSandboxMessage(sessionId, 0, 'host.connect', null);
}

export function createSandboxInitializeMessage(
  sessionId: string,
  sequence: number,
  payload: SandboxInitializePayload,
): SandboxMessage<'host.initialize', SandboxInitializePayload> {
  if (!Number.isSafeInteger(payload.projectRevision) || payload.projectRevision < 0) {
    throw new RangeError('Sandbox projectRevision must be a non-negative safe integer.');
  }
  if (!/^[a-f0-9]{64}$/i.test(payload.contentHash)) throw new TypeError('Sandbox contentHash must be a SHA-256 hex digest.');
  if (textEncoder.encode(payload.moduleCode).byteLength > MAX_SANDBOX_MODULE_BYTES) {
    throw new RangeError(`Sandbox module exceeds the ${MAX_SANDBOX_MODULE_BYTES} byte limit.`);
  }
  const snapshotValidation = validateSerializableValue(payload.projectSnapshot, SCRIPT_SANDBOX_PROJECT_SNAPSHOT_LIMITS);
  if (!snapshotValidation.ok) throw new SandboxPayloadValidationError(snapshotValidation.diagnostic);
  return createSandboxMessageWithLimits(
    sessionId,
    sequence,
    'host.initialize',
    payload,
    SCRIPT_SANDBOX_INITIALIZE_LIMITS,
  );
}

export function createSandboxControlMessage(
  sessionId: string,
  sequence: number,
  command: SandboxHostControl,
): SandboxMessage<'host.control', { readonly command: SandboxHostControl }> {
  return createSandboxMessage(sessionId, sequence, 'host.control', { command });
}

export function validateSandboxMessage(value: unknown): SandboxMessageValidationResult {
  const reject = (
    code: SandboxMessageDiagnosticCode,
    path: string,
    message: string,
  ): SandboxMessageValidationResult => ({ ok: false, diagnostic: { code, path, message } });

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return reject('SANDBOX_INVALID_ENVELOPE', '$', 'Sandbox messages must be plain envelope objects.');
  }
  const message = value as Partial<SandboxMessage>;
  if (message.protocol !== SCRIPT_SANDBOX_PROTOCOL) {
    return reject('SANDBOX_INVALID_PROTOCOL', '$.protocol', 'Sandbox message protocol is invalid.');
  }
  if (message.protocolVersion !== SCRIPT_SANDBOX_PROTOCOL_VERSION) {
    return reject('SANDBOX_INVALID_PROTOCOL_VERSION', '$.protocolVersion', 'Sandbox protocol version is unsupported.');
  }
  if (typeof message.sessionId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(message.sessionId)) {
    return reject('SANDBOX_INVALID_SESSION_ID', '$.sessionId', 'Sandbox session id is invalid.');
  }
  if (typeof message.sequence !== 'number' || !Number.isSafeInteger(message.sequence) || message.sequence < 0) {
    return reject('SANDBOX_INVALID_SEQUENCE', '$.sequence', 'Sandbox message sequence is invalid.');
  }
  if (typeof message.type !== 'string' || !/^[a-z]+(?:[.-][a-z]+)*$/.test(message.type)) {
    return reject('SANDBOX_INVALID_MESSAGE_TYPE', '$.type', 'Sandbox message type is invalid.');
  }
  const limits = message.type === 'host.initialize'
    ? SCRIPT_SANDBOX_INITIALIZE_LIMITS
    : SCRIPT_SANDBOX_MESSAGE_LIMITS;
  const payloadValidation = validateSerializableValue(message.payload, limits);
  if (!payloadValidation.ok) {
    return {
      ok: false,
      diagnostic: {
        ...payloadValidation.diagnostic,
        path: `$.payload${payloadValidation.diagnostic.path.slice(1)}`,
      },
    };
  }
  return { ok: true, message: message as SandboxMessage };
}

export function isSandboxMessage(value: unknown): value is SandboxMessage {
  return validateSandboxMessage(value).ok;
}

interface WorkerBootstrapConfiguration {
  readonly messageLimits: SerializableValueLimits;
}

function behaviorWorkerBootstrap(configuration: WorkerBootstrapConfiguration) {
  let importedModule: Record<string, unknown> | null = null;
  let moduleUrl: string | null = null;
  let trustedPort: MessagePort | null = null;
  let initialized = false;

  // Capture every intrinsic used by the trusted channel before authored ESM is
  // imported. Authored code can mutate Worker globals and prototypes, but it
  // cannot recover the lexical MessagePort or replace these bound operations.
  const portPostMessage = Function.prototype.call.bind(MessagePort.prototype.postMessage) as unknown as (
    target: MessagePort,
    message: unknown,
  ) => void;
  const portClose = Function.prototype.call.bind(MessagePort.prototype.close) as unknown as (target: MessagePort) => void;
  const portAddEventListener = Function.prototype.call.bind(MessagePort.prototype.addEventListener) as unknown as (
    target: MessagePort,
    type: string,
    listener: EventListener,
  ) => void;
  const portStart = Function.prototype.call.bind(MessagePort.prototype.start) as unknown as (target: MessagePort) => void;
  const arraySort = Function.prototype.call.bind(Array.prototype.sort) as unknown as (target: string[]) => string[];
  const objectKeys = Object.keys.bind(Object);
  const objectGetPrototypeOf = Object.getPrototypeOf.bind(Object);
  const objectHasOwn = Object.hasOwn.bind(Object);
  const arrayIsArray = Array.isArray.bind(Array);
  const jsonStringify = JSON.stringify.bind(JSON);
  const encoder = new TextEncoder();
  const encode = Function.prototype.call.bind(TextEncoder.prototype.encode) as unknown as (
    target: TextEncoder,
    input?: string,
  ) => Uint8Array;
  const createObjectUrl = URL.createObjectURL.bind(URL);
  const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
  const closeWorker = globalThis.close.bind(globalThis);

  const safeMessage = (error: unknown, fallback: string) => {
    try {
      const value = typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : fallback;
      return value.slice(0, 4096);
    } catch {
      return fallback;
    }
  };
  const pathFor = (parentPath: string, key: string | number) => {
    if (typeof key === 'number') return `${parentPath}[${key}]`;
    const visibleKey = key.length > 64 ? `${key.slice(0, 61)}...` : key;
    return `${parentPath}[${jsonStringify(visibleKey)}]`;
  };
  const validate = (value: unknown) => {
    const stack: Array<
      | { kind: 'value'; value: unknown; depth: number; path: string }
      | { kind: 'leave'; value: object }
    > = [{ kind: 'value', value, depth: 0, path: '$' }];
    const active = new Set<object>();
    let nodes = 0;
    let bytes = 0;
    const reject = (code: SerializableValueDiagnosticCode, path: string, message: string) => ({ ok: false as const, code, path, message });
    const addBytes = (amount: number, path: string) => {
      bytes += amount;
      return bytes > configuration.messageLimits.maxTotalBytes
        ? reject('SERIALIZABLE_MAX_TOTAL_BYTES', path, 'Worker payload exceeds its total byte limit.')
        : null;
    };
    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (frame.kind === 'leave') {
        active.delete(frame.value);
        continue;
      }
      if (frame.depth > configuration.messageLimits.maxDepth) {
        return reject('SERIALIZABLE_MAX_DEPTH', frame.path, 'Worker payload exceeds its depth limit.');
      }
      nodes += 1;
      if (nodes > configuration.messageLimits.maxNodes) {
        return reject('SERIALIZABLE_MAX_NODES', frame.path, 'Worker payload exceeds its node limit.');
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
        if (!Number.isFinite(candidate)) return reject('SERIALIZABLE_NON_FINITE_NUMBER', frame.path, 'Worker payload numbers must be finite.');
        const failure = addBytes(String(Object.is(candidate, -0) ? 0 : candidate).length, frame.path);
        if (failure) return failure;
        continue;
      }
      if (typeof candidate === 'string') {
        const stringBytes = encode(encoder, candidate).byteLength;
        if (stringBytes > configuration.messageLimits.maxStringBytes) {
          return reject('SERIALIZABLE_MAX_STRING_BYTES', frame.path, 'Worker payload string exceeds its byte limit.');
        }
        const failure = addBytes(encode(encoder, jsonStringify(candidate)).byteLength, frame.path);
        if (failure) return failure;
        continue;
      }
      if (typeof candidate !== 'object') {
        return reject('SERIALIZABLE_INVALID_TYPE', frame.path, 'Worker payload contains a non-serializable value.');
      }
      if (active.has(candidate)) return reject('SERIALIZABLE_CYCLE', frame.path, 'Worker payload contains a cycle.');
      let prototype: object | null;
      try {
        prototype = objectGetPrototypeOf(candidate);
      } catch {
        return reject('SERIALIZABLE_ACCESS_ERROR', frame.path, 'Worker payload could not be inspected.');
      }
      if (!arrayIsArray(candidate) && prototype !== Object.prototype && prototype !== null) {
        return reject('SERIALIZABLE_NON_PLAIN_OBJECT', frame.path, 'Worker payload contains a non-plain object.');
      }
      active.add(candidate);
      stack.push({ kind: 'leave', value: candidate });
      if (arrayIsArray(candidate)) {
        let arrayLength: number;
        try {
          arrayLength = candidate.length;
        } catch {
          return reject('SERIALIZABLE_ACCESS_ERROR', frame.path, 'Worker payload array could not be inspected.');
        }
        if (arrayLength > configuration.messageLimits.maxNodes - nodes) {
          return reject('SERIALIZABLE_MAX_NODES', frame.path, 'Worker payload exceeds its node limit.');
        }
        const failure = addBytes(2 + Math.max(0, arrayLength - 1), frame.path);
        if (failure) return failure;
        for (let index = arrayLength - 1; index >= 0; index -= 1) {
          let hasEntry: boolean;
          let child: unknown;
          try {
            hasEntry = objectHasOwn(candidate, index);
            child = candidate[index];
          } catch {
            return reject('SERIALIZABLE_ACCESS_ERROR', pathFor(frame.path, index), 'Worker payload array entry could not be inspected.');
          }
          if (!hasEntry) {
            return reject('SERIALIZABLE_ARRAY_HOLE', pathFor(frame.path, index), 'Worker payload contains a sparse array.');
          }
          stack.push({ kind: 'value', value: child, depth: frame.depth + 1, path: pathFor(frame.path, index) });
        }
        continue;
      }
      let keys: string[];
      try {
        keys = objectKeys(candidate);
      } catch {
        return reject('SERIALIZABLE_ACCESS_ERROR', frame.path, 'Worker payload could not be inspected.');
      }
      if (keys.length > configuration.messageLimits.maxNodes - nodes) {
        return reject('SERIALIZABLE_MAX_NODES', frame.path, 'Worker payload exceeds its node limit.');
      }
      const failure = addBytes(2 + Math.max(0, keys.length - 1), frame.path);
      if (failure) return failure;
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index]!;
        const keyPath = pathFor(frame.path, key);
        if (encode(encoder, key).byteLength > configuration.messageLimits.maxStringBytes) {
          return reject('SERIALIZABLE_MAX_STRING_BYTES', keyPath, 'Worker payload key exceeds its byte limit.');
        }
        const keyFailure = addBytes(encode(encoder, jsonStringify(key)).byteLength + 1, keyPath);
        if (keyFailure) return keyFailure;
        let child: unknown;
        try {
          child = (candidate as Record<string, unknown>)[key];
        } catch {
          return reject('SERIALIZABLE_ACCESS_ERROR', keyPath, 'Worker payload property could not be inspected.');
        }
        stack.push({ kind: 'value', value: child, depth: frame.depth + 1, path: keyPath });
      }
    }
    return { ok: true as const };
  };
  const send = (type: string, payload: SerializableValue) => {
    if (!trustedPort) return;
    const validation = validate(payload);
    if (!validation.ok) {
      portPostMessage(trustedPort, {
        type: 'worker.error',
        payload: {
          code: validation.code,
          message: `${validation.path}: ${validation.message}`.slice(0, 4096),
        },
      });
      return;
    }
    portPostMessage(trustedPort, { type, payload });
  };
  const cleanup = () => {
    if (moduleUrl) revokeObjectUrl(moduleUrl);
    moduleUrl = null;
    if (trustedPort) portClose(trustedPort);
    trustedPort = null;
  };
  const handleTrustedMessage = (event: MessageEvent<Record<string, unknown>>) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'dispose') {
      cleanup();
      closeWorker();
      return;
    }
    const onSandboxMessage = importedModule?.onSandboxMessage;
    if (typeof onSandboxMessage !== 'function') return;
    try {
      const result = onSandboxMessage(message.payload);
      let thenable = false;
      try {
        thenable = result !== null
          && (typeof result === 'object' || typeof result === 'function')
          && typeof (result as { then?: unknown }).then === 'function';
      } catch {
        thenable = true;
      }
      if (thenable) {
        send('worker.error', { code: 'ASYNC_HOOK_NOT_SUPPORTED', message: 'Sandbox message hooks must be synchronous.' });
      } else if (result !== undefined) {
        send('worker.response', { value: result as SerializableValue });
      }
    } catch (error) {
      send('worker.error', { code: 'HOOK_FAILED', message: safeMessage(error, 'Behavior sandbox hook failed.') });
    }
  };
  const connect = (event: MessageEvent<Record<string, unknown>>) => {
    const message = event.data;
    const transferredPort = event.ports[0];
    if (initialized || !transferredPort || message?.type !== 'bootstrap.initialize' || typeof message.moduleCode !== 'string') return;
    initialized = true;
    trustedPort = transferredPort;
    globalThis.removeEventListener('message', connect);
    portAddEventListener(trustedPort, 'message', handleTrustedMessage as EventListener);
    portStart(trustedPort);
    moduleUrl = createObjectUrl(new Blob([message.moduleCode], { type: 'text/javascript' }));
    void import(moduleUrl).then((moduleValue: Record<string, unknown>) => {
      importedModule = moduleValue;
      send('worker.ready', { exports: arraySort(objectKeys(moduleValue)) });
    }).catch((error: unknown) => {
      send('worker.error', { code: 'MODULE_LOAD_FAILED', message: safeMessage(error, 'Behavior module failed to load.') });
    });
  };

  globalThis.addEventListener('message', connect);
}

interface BootstrapConfiguration {
  readonly protocol: string;
  readonly protocolVersion: number;
  readonly sessionId: string;
  readonly workerSource: string;
  readonly maxModuleBytes: number;
  readonly messageLimits: SerializableValueLimits;
  readonly projectSnapshotLimits: SerializableValueLimits;
}

// Chromium rejects module-type Blob Workers created by opaque-origin frames.
// A classic Worker is supported across Chromium and WebKit and can still
// dynamically import the compiled ESM Blob inside the same constrained CSP.
function iframeSandboxBootstrap(configuration: BootstrapConfiguration) {
  let port: MessagePort | null = null;
  let behaviorWorker: Worker | null = null;
  let behaviorWorkerUrl: string | null = null;
  let behaviorWorkerPort: MessagePort | null = null;
  let runtimeSequence = 0;
  let lastHostSequence = -1;
  let lifecycle: 'idle' | 'verifying' | 'ready' | 'failed' | 'disposed' = 'idle';
  let disposed = false;
  let activeContentHash = '';

  const encoder = new TextEncoder();
  const pathFor = (parentPath: string, key: string | number) => {
    if (typeof key === 'number') return `${parentPath}[${key}]`;
    const visibleKey = key.length > 64 ? `${key.slice(0, 61)}...` : key;
    return `${parentPath}[${JSON.stringify(visibleKey)}]`;
  };
  const validatePlainSerializable = (value: unknown, limits: SerializableValueLimits) => {
    const stack: Array<
      | { kind: 'value'; value: unknown; depth: number; path: string }
      | { kind: 'leave'; value: object }
    > = [{ kind: 'value', value, depth: 0, path: '$' }];
    const active = new Set<object>();
    let nodes = 0;
    let bytes = 0;
    const reject = (code: SerializableValueDiagnosticCode, path: string, message: string) => ({ ok: false as const, code, path, message });
    const addBytes = (amount: number, path: string) => {
      bytes += amount;
      return bytes > limits.maxTotalBytes
        ? reject('SERIALIZABLE_MAX_TOTAL_BYTES', path, `Payload exceeds the ${limits.maxTotalBytes} byte limit.`)
        : null;
    };
    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (frame.kind === 'leave') {
        active.delete(frame.value);
        continue;
      }
      if (frame.depth > limits.maxDepth) {
        return reject('SERIALIZABLE_MAX_DEPTH', frame.path, `Payload exceeds the maximum depth of ${limits.maxDepth}.`);
      }
      nodes += 1;
      if (nodes > limits.maxNodes) return reject('SERIALIZABLE_MAX_NODES', frame.path, `Payload exceeds the ${limits.maxNodes} node limit.`);
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
        if (!Number.isFinite(candidate)) return reject('SERIALIZABLE_NON_FINITE_NUMBER', frame.path, 'Payload numbers must be finite.');
        const failure = addBytes(String(Object.is(candidate, -0) ? 0 : candidate).length, frame.path);
        if (failure) return failure;
        continue;
      }
      if (typeof candidate === 'string') {
        if (encoder.encode(candidate).byteLength > limits.maxStringBytes) {
          return reject('SERIALIZABLE_MAX_STRING_BYTES', frame.path, `Payload string exceeds the ${limits.maxStringBytes} byte limit.`);
        }
        const failure = addBytes(encoder.encode(JSON.stringify(candidate)).byteLength, frame.path);
        if (failure) return failure;
        continue;
      }
      if (typeof candidate !== 'object') return reject('SERIALIZABLE_INVALID_TYPE', frame.path, 'Payload contains a non-serializable value.');
      if (active.has(candidate)) return reject('SERIALIZABLE_CYCLE', frame.path, 'Payload contains a cycle.');
      let prototype: object | null;
      try {
        prototype = Object.getPrototypeOf(candidate);
      } catch {
        return reject('SERIALIZABLE_ACCESS_ERROR', frame.path, 'Payload could not be inspected.');
      }
      if (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null) {
        return reject('SERIALIZABLE_NON_PLAIN_OBJECT', frame.path, 'Payload contains a non-plain object.');
      }
      active.add(candidate);
      stack.push({ kind: 'leave', value: candidate });
      if (Array.isArray(candidate)) {
        let arrayLength: number;
        try {
          arrayLength = candidate.length;
        } catch {
          return reject('SERIALIZABLE_ACCESS_ERROR', frame.path, 'Payload array could not be inspected.');
        }
        if (arrayLength > limits.maxNodes - nodes) return reject('SERIALIZABLE_MAX_NODES', frame.path, `Payload exceeds the ${limits.maxNodes} node limit.`);
        const failure = addBytes(2 + Math.max(0, arrayLength - 1), frame.path);
        if (failure) return failure;
        for (let index = arrayLength - 1; index >= 0; index -= 1) {
          let hasEntry: boolean;
          let child: unknown;
          try {
            hasEntry = Object.hasOwn(candidate, index);
            child = candidate[index];
          } catch {
            return reject('SERIALIZABLE_ACCESS_ERROR', pathFor(frame.path, index), 'Payload array entry could not be inspected.');
          }
          if (!hasEntry) return reject('SERIALIZABLE_ARRAY_HOLE', pathFor(frame.path, index), 'Payload contains a sparse array.');
          stack.push({ kind: 'value', value: child, depth: frame.depth + 1, path: pathFor(frame.path, index) });
        }
        continue;
      }
      let keys: string[];
      try {
        keys = Object.keys(candidate);
      } catch {
        return reject('SERIALIZABLE_ACCESS_ERROR', frame.path, 'Payload could not be inspected.');
      }
      if (keys.length > limits.maxNodes - nodes) return reject('SERIALIZABLE_MAX_NODES', frame.path, `Payload exceeds the ${limits.maxNodes} node limit.`);
      const failure = addBytes(2 + Math.max(0, keys.length - 1), frame.path);
      if (failure) return failure;
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index]!;
        const keyPath = pathFor(frame.path, key);
        if (encoder.encode(key).byteLength > limits.maxStringBytes) {
          return reject('SERIALIZABLE_MAX_STRING_BYTES', keyPath, `Payload key exceeds the ${limits.maxStringBytes} byte limit.`);
        }
        const keyFailure = addBytes(encoder.encode(JSON.stringify(key)).byteLength + 1, keyPath);
        if (keyFailure) return keyFailure;
        let child: unknown;
        try {
          child = (candidate as Record<string, unknown>)[key];
        } catch {
          return reject('SERIALIZABLE_ACCESS_ERROR', keyPath, 'Payload property could not be inspected.');
        }
        stack.push({ kind: 'value', value: child, depth: frame.depth + 1, path: keyPath });
      }
    }
    return { ok: true as const };
  };

  const envelope = (type: string, payload: unknown) => ({
    protocol: configuration.protocol,
    protocolVersion: configuration.protocolVersion,
    sessionId: configuration.sessionId,
    sequence: ++runtimeSequence,
    type,
    payload,
  });
  const send = (type: string, payload: unknown) => port?.postMessage(envelope(type, payload));
  const fatal = (code: string, message: string) => send('runtime.fatal', { code, message: message.slice(0, 4096) });
  const cleanup = () => {
    behaviorWorkerPort?.close();
    behaviorWorkerPort = null;
    behaviorWorker?.terminate();
    behaviorWorker = null;
    if (behaviorWorkerUrl) URL.revokeObjectURL(behaviorWorkerUrl);
    behaviorWorkerUrl = null;
  };
  const validateEnvelope = (value: unknown) => {
    const reject = (code: string, message: string) => ({ ok: false as const, code, message });
    if (!value || typeof value !== 'object' || Array.isArray(value)) return reject('SANDBOX_INVALID_ENVELOPE', 'Sandbox message envelope is invalid.');
    const candidate = value as Partial<SandboxMessage>;
    if (candidate.protocol !== configuration.protocol) return reject('SANDBOX_INVALID_PROTOCOL', 'Sandbox message protocol is invalid.');
    if (candidate.protocolVersion !== configuration.protocolVersion) return reject('SANDBOX_INVALID_PROTOCOL_VERSION', 'Sandbox protocol version is unsupported.');
    if (candidate.sessionId !== configuration.sessionId) return reject('SANDBOX_INVALID_SESSION_ID', 'Sandbox session id is invalid.');
    if (typeof candidate.sequence !== 'number' || !Number.isSafeInteger(candidate.sequence) || candidate.sequence <= lastHostSequence) {
      return reject('SANDBOX_INVALID_SEQUENCE', 'Sandbox message is stale, replayed, or has an invalid sequence.');
    }
    if (typeof candidate.type !== 'string' || !/^[a-z]+(?:[.-][a-z]+)*$/.test(candidate.type)) {
      return reject('SANDBOX_INVALID_MESSAGE_TYPE', 'Sandbox message type is invalid.');
    }
    return { ok: true as const, message: candidate as SandboxMessage };
  };
  const sha256Fallback = (input: Uint8Array) => {
    // Sandboxed opaque-origin documents do not expose SubtleCrypto in every
    // browser. This compact, deterministic SHA-256 implementation keeps the
    // verification inside the trusted iframe bootstrap in Chromium and WebKit.
    const constants = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const state = new Uint32Array([
      0x6a09e667,
      0xbb67ae85,
      0x3c6ef372,
      0xa54ff53a,
      0x510e527f,
      0x9b05688c,
      0x1f83d9ab,
      0x5be0cd19,
    ]);
    const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(input);
    padded[input.byteLength] = 0x80;
    const bitLength = input.byteLength * 8;
    const paddedView = new DataView(padded.buffer);
    paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
    paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);
    const words = new Uint32Array(64);
    const rotateRight = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let index = 0; index < 16; index += 1) words[index] = paddedView.getUint32(offset + index * 4, false);
      for (let index = 16; index < 64; index += 1) {
        const value15 = words[index - 15]!;
        const value2 = words[index - 2]!;
        const sigma0 = rotateRight(value15, 7) ^ rotateRight(value15, 18) ^ (value15 >>> 3);
        const sigma1 = rotateRight(value2, 17) ^ rotateRight(value2, 19) ^ (value2 >>> 10);
        words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
      }
      let a = state[0]!;
      let b = state[1]!;
      let c = state[2]!;
      let d = state[3]!;
      let e = state[4]!;
      let f = state[5]!;
      let g = state[6]!;
      let h = state[7]!;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = (e & f) ^ (~e & g);
        const temp1 = (h + sum1 + choose + constants[index]! + words[index]!) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }
      state[0] = (state[0]! + a) >>> 0;
      state[1] = (state[1]! + b) >>> 0;
      state[2] = (state[2]! + c) >>> 0;
      state[3] = (state[3]! + d) >>> 0;
      state[4] = (state[4]! + e) >>> 0;
      state[5] = (state[5]! + f) >>> 0;
      state[6] = (state[6]! + g) >>> 0;
      state[7] = (state[7]! + h) >>> 0;
    }
    return [...state].map((word) => word.toString(16).padStart(8, '0')).join('');
  };
  const sha256Hex = async (value: string) => {
    const bytes = encoder.encode(value);
    if (!globalThis.crypto?.subtle) return sha256Fallback(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  };
  const handleWorkerMessage = (event: MessageEvent<unknown>) => {
    const workerMessage = event.data;
    const validation = validatePlainSerializable(workerMessage, configuration.messageLimits);
    if (!validation.ok) {
      fatal(validation.code, `${validation.path}: ${validation.message}`);
      return;
    }
    if (!workerMessage || typeof workerMessage !== 'object' || Array.isArray(workerMessage)) {
      fatal('BEHAVIOR_WORKER_MESSAGE_ERROR', 'Behavior Worker sent an invalid envelope.');
      return;
    }
    const candidate = workerMessage as { type?: unknown; payload?: unknown };
    if (candidate.type === 'worker.ready') {
      const workerPayload = candidate.payload as { exports?: unknown } | null;
      if (!workerPayload || !Array.isArray(workerPayload.exports) || workerPayload.exports.some((name) => typeof name !== 'string')) {
        fatal('BEHAVIOR_WORKER_MESSAGE_ERROR', 'Behavior Worker sent invalid export metadata.');
        return;
      }
      lifecycle = 'ready';
      send('runtime.ready', { exports: workerPayload.exports, contentHash: activeContentHash });
    } else if (candidate.type === 'worker.error') {
      const errorPayload = candidate.payload as { code?: unknown; message?: unknown } | null;
      fatal(
        errorPayload && typeof errorPayload.code === 'string' ? errorPayload.code : 'BEHAVIOR_WORKER_ERROR',
        errorPayload && typeof errorPayload.message === 'string' ? errorPayload.message : 'Behavior Worker failed.',
      );
    } else if (candidate.type === 'worker.response') {
      send('runtime.status', (candidate.payload ?? null) as SerializableValue);
    } else {
      fatal('BEHAVIOR_WORKER_MESSAGE_ERROR', 'Behavior Worker sent an unsupported message type.');
    }
  };
  const initialize = async (payload: Partial<SandboxInitializePayload>) => {
    lifecycle = 'verifying';
    let actualContentHash: string;
    try {
      actualContentHash = await sha256Hex(payload.moduleCode as string);
    } catch {
      lifecycle = 'failed';
      fatal('CONTENT_HASH_UNAVAILABLE', 'Could not verify the authored module SHA-256 digest.');
      return;
    }
    if (disposed) return;
    if (actualContentHash !== (payload.contentHash as string).toLowerCase()) {
      lifecycle = 'failed';
      fatal('CONTENT_HASH_MISMATCH', 'Authored module bytes do not match the approved SHA-256 digest.');
      return;
    }
    activeContentHash = actualContentHash;
    behaviorWorkerUrl = URL.createObjectURL(new Blob([
      `(${configuration.workerSource})(${JSON.stringify({ messageLimits: configuration.messageLimits })})`,
    ], { type: 'text/javascript' }));
    behaviorWorker = new Worker(behaviorWorkerUrl, { name: 'threejs-studio-behavior-runtime' });
    const workerChannel = new MessageChannel();
    behaviorWorkerPort = workerChannel.port1;
    behaviorWorkerPort.addEventListener('message', handleWorkerMessage);
    behaviorWorkerPort.addEventListener('messageerror', () => fatal('BEHAVIOR_WORKER_MESSAGE_ERROR', 'Behavior Worker sent invalid data.'));
    behaviorWorkerPort.start();
    behaviorWorker.addEventListener('error', (workerEvent) => {
      fatal('BEHAVIOR_WORKER_CRASHED', workerEvent.message || 'Behavior Worker crashed.');
    });
    behaviorWorker.postMessage(
      { type: 'bootstrap.initialize', moduleCode: payload.moduleCode },
      [workerChannel.port2],
    );
  };
  const handlePortMessage = (event: MessageEvent<unknown>) => {
    const envelopeValidation = validateEnvelope(event.data);
    if (!envelopeValidation.ok) {
      fatal(envelopeValidation.code, envelopeValidation.message);
      return;
    }
    const message = envelopeValidation.message;
    lastHostSequence = message.sequence;
    if (message.type === 'host.initialize') {
      if (lifecycle !== 'idle') {
        fatal('ALREADY_INITIALIZED', 'Script sandbox is already initialized.');
        return;
      }
      const payload = message.payload as Partial<SandboxInitializePayload>;
      const payloadRecord = payload as Record<string, unknown>;
      const payloadKeys = payload && typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payloadRecord) : [];
      if (
        !payload || typeof payload !== 'object' || Array.isArray(payload)
        || payloadKeys.length !== 4
        || !['contentHash', 'moduleCode', 'projectRevision', 'projectSnapshot'].every((key) => Object.hasOwn(payloadRecord, key))
        || typeof payload.moduleCode !== 'string'
        || encoder.encode(payload.moduleCode).byteLength > configuration.maxModuleBytes
        || typeof payload.contentHash !== 'string'
        || !/^[a-f0-9]{64}$/i.test(payload.contentHash)
        || !Number.isSafeInteger(payload.projectRevision)
        || (payload.projectRevision as number) < 0
      ) {
        fatal('INVALID_INITIALIZE', 'Sandbox initialization payload is invalid.');
        return;
      }
      const snapshotValidation = validatePlainSerializable(payload.projectSnapshot, configuration.projectSnapshotLimits);
      if (!snapshotValidation.ok) {
        fatal(snapshotValidation.code, `$.projectSnapshot${snapshotValidation.path.slice(1)}: ${snapshotValidation.message}`);
        return;
      }
      void initialize(payload);
      return;
    }
    if (message.type === 'host.control') {
      const payload = message.payload as { command?: unknown };
      const payloadValidation = validatePlainSerializable(payload, configuration.messageLimits);
      if (!payloadValidation.ok) {
        fatal(payloadValidation.code, `${payloadValidation.path}: ${payloadValidation.message}`);
        return;
      }
      if (payload.command === 'dispose') {
        disposed = true;
        lifecycle = 'disposed';
        behaviorWorkerPort?.postMessage({ type: 'dispose' });
        cleanup();
        send('runtime.dispose-ack', null);
        port?.close();
        port = null;
        return;
      }
      if (lifecycle !== 'ready' || !behaviorWorkerPort) {
        fatal('NOT_INITIALIZED', 'Script sandbox must be initialized before controls are sent.');
        return;
      }
      if (!['start', 'pause', 'resume', 'step', 'restart'].includes(payload.command as string)) {
        fatal('INVALID_CONTROL', 'Sandbox control command is invalid.');
        return;
      }
      behaviorWorkerPort.postMessage({ type: 'control', payload });
      return;
    }
    fatal('UNSUPPORTED_MESSAGE_TYPE', 'Sandbox host message type is unsupported.');
  };
  const connect = (event: MessageEvent<unknown>) => {
    if (event.source !== parent || port) return;
    const envelopeValidation = validateEnvelope(event.data);
    if (!envelopeValidation.ok) return;
    const message = envelopeValidation.message;
    if (message.type !== 'host.connect' || !event.ports[0]) return;
    if (message.payload !== null) return;
    lastHostSequence = message.sequence;
    port = event.ports[0];
    globalThis.removeEventListener('message', connect);
    port.addEventListener('message', handlePortMessage);
    port.addEventListener('messageerror', () => fatal('PORT_MESSAGE_ERROR', 'Host channel sent invalid data.'));
    port.start();
    send('runtime.bootstrap-ready', null);
  };

  globalThis.addEventListener('message', connect);
  globalThis.addEventListener('pagehide', cleanup, { once: true });
  parent.postMessage(envelope('runtime.bootstrap-ready', null), '*');
}

export function createSandboxDocument(options: SandboxDocumentOptions): SandboxDocument {
  assertSessionId(options.sessionId);
  const nonce = options.nonce ?? randomNonce();
  assertNonce(nonce);
  const csp = buildSandboxCsp(nonce);
  const title = escapeHtml(options.title ?? 'Game preview');
  const configuration: BootstrapConfiguration = {
    protocol: SCRIPT_SANDBOX_PROTOCOL,
    protocolVersion: SCRIPT_SANDBOX_PROTOCOL_VERSION,
    sessionId: options.sessionId,
    workerSource: behaviorWorkerBootstrap.toString(),
    maxModuleBytes: MAX_SANDBOX_MODULE_BYTES,
    messageLimits: SCRIPT_SANDBOX_MESSAGE_LIMITS,
    projectSnapshotLimits: SCRIPT_SANDBOX_PROJECT_SNAPSHOT_LIMITS,
  };
  const bootstrap = `(${iframeSandboxBootstrap.toString()})(${safeScriptJson(configuration)});`;
  const srcdoc = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title}</title>`,
    `<style nonce="${nonce}">html,body,#studio-runtime-root{width:100%;height:100%;margin:0;overflow:hidden;background:#000}</style>`,
    '</head>',
    '<body>',
    '<main id="studio-runtime-root" aria-label="Game preview"></main>',
    `<script nonce="${nonce}">${bootstrap}</script>`,
    '</body>',
    '</html>',
  ].join('');
  return {
    sessionId: options.sessionId,
    nonce,
    sandbox: SCRIPT_SANDBOX_ATTRIBUTE,
    referrerPolicy: SCRIPT_SANDBOX_REFERRER_POLICY,
    allow: SCRIPT_SANDBOX_ALLOW,
    csp,
    srcdoc,
  };
}
