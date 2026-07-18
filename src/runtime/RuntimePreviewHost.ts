import {
  RUNTIME_IFRAME_PROTOCOL,
  RUNTIME_IFRAME_PROTOCOL_VERSION,
  createRuntimeCommandMessage,
  parseRuntimeIframeMessage,
  type RuntimeControlAction,
  type RuntimeDiagnosticsMessage,
  type RuntimeErrorMessage,
  type RuntimeIframeMessage,
  type RuntimeReadyMessage,
  type RuntimeResultMessage,
} from './protocol';
import type { RuntimeDiagnostics, RuntimeSessionIdentity } from './types';
import { isJsonValue, isPlainObject, validateRuntimeIdentity } from './validation';

export const RUNTIME_PREVIEW_TRANSPORT = 'threejs-studio.runtime.preview';
export const RUNTIME_PREVIEW_TRANSPORT_VERSION = 1;
export const RUNTIME_PREVIEW_SANDBOX = 'allow-scripts allow-pointer-lock';
export const RUNTIME_PREVIEW_ALLOW = 'gamepad';

/**
 * The preview is deliberately network-dark. Runtime modules and assets must be
 * embedded in srcdoc or delivered over the private MessagePort as cloned data.
 * Inline scripts are required for srcdoc bootstrapping, while unsafe-eval is
 * intentionally absent so eval/new Function remain unavailable.
 */
export const RUNTIME_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "connect-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data: blob:",
  "style-src 'unsafe-inline'",
  "worker-src blob:",
  "child-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const DEFAULT_READY_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_DIAGNOSTICS_THROTTLE_MS = 100;
const MAX_TIMEOUT_MS = 60_000;

export type RuntimePreviewHostStatus =
  | 'new'
  | 'mounting'
  | 'handshaking'
  | 'ready'
  | 'disposing'
  | 'disposed';

export type RuntimePreviewHostErrorCode =
  | 'invalid_argument'
  | 'invalid_state'
  | 'handshake_timeout'
  | 'command_timeout'
  | 'protocol_error'
  | 'runtime_error'
  | 'disposed';

export class RuntimePreviewHostError extends Error {
  readonly code: RuntimePreviewHostErrorCode;
  readonly details?: readonly string[];

  constructor(code: RuntimePreviewHostErrorCode, message: string, details?: readonly string[]) {
    super(message);
    this.name = 'RuntimePreviewHostError';
    this.code = code;
    this.details = details ? [...details] : undefined;
  }
}

export interface RuntimePreviewProtocolIssue {
  code:
    | 'invalid_envelope'
    | 'identity_mismatch'
    | 'stale_sequence'
    | 'sequence_gap'
    | 'unexpected_message'
    | 'unknown_request';
  message: string;
  details?: readonly string[];
}

export interface RuntimePreviewHostOptions {
  readonly container: HTMLElement;
  readonly identity: RuntimeSessionIdentity;
  /**
   * Trusted, already-compiled runtime code. It may install
   * globalThis.__THREEJS_STUDIO_PREVIEW_RUNTIME_FACTORY__, returning either a
   * RuntimeSession-like object or an adapter with lifecycle methods.
   */
  readonly runtimeSource?: string;
  readonly title?: string;
  readonly readyTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly diagnosticsThrottleMs?: number;
  readonly onDiagnostics?: (diagnostics: RuntimeDiagnostics) => void;
  readonly onRuntimeError?: (error: RuntimeErrorMessage) => void;
  readonly onProtocolIssue?: (issue: RuntimePreviewProtocolIssue) => void;
}

interface RuntimePreviewEnvelope {
  transport: typeof RUNTIME_PREVIEW_TRANSPORT;
  transportVersion: typeof RUNTIME_PREVIEW_TRANSPORT_VERSION;
  sequence: number;
  sessionId: string;
  revision: number;
  buildHash: string;
  message: RuntimeIframeMessage;
}

interface PendingCommand {
  readonly action: RuntimeControlAction;
  readonly resolve: (message: RuntimeResultMessage) => void;
  readonly reject: (error: RuntimePreviewHostError) => void;
  readonly timeout: number;
}

function copyIdentity(identity: RuntimeSessionIdentity): RuntimeSessionIdentity {
  return Object.freeze({
    sessionId: identity.sessionId,
    revision: identity.revision,
    buildHash: identity.buildHash,
  });
}

function copyDiagnostics(diagnostics: RuntimeDiagnostics): RuntimeDiagnostics {
  return JSON.parse(JSON.stringify(diagnostics)) as RuntimeDiagnostics;
}

/**
 * Host callbacks are integration hooks, not part of the preview transport.
 * Their failures must never interrupt promise settlement or sandbox cleanup.
 * Although the public callback types are synchronous, also consume a returned
 * thenable so an accidentally async callback cannot create an unhandled
 * rejection in the editor.
 */
function invokeHostCallback<T>(callback: ((value: T) => void) | undefined, value: T): void {
  if (!callback) return;
  try {
    const result: unknown = callback(value);
    if (
      result !== null
      && (typeof result === 'object' || typeof result === 'function')
      && typeof (result as PromiseLike<unknown>).then === 'function'
    ) {
      void Promise.resolve(result as PromiseLike<unknown>).catch(() => undefined);
    }
  } catch {
    // The runtime host owns lifecycle progress even when an observer fails.
  }
}

function validateTimeout(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > MAX_TIMEOUT_MS) {
    throw new RuntimePreviewHostError(
      'invalid_argument',
      `${name} must be a finite number between 0 and ${MAX_TIMEOUT_MS}.`,
    );
  }
  return value;
}

function escapeInlineScript(source: string): string {
  return source
    .replace(/<\/script/giu, '<\\/script')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

function createHandshakeId(view: Window): string {
  if (typeof view.crypto?.randomUUID === 'function') return `preview-${view.crypto.randomUUID()}`;
  const bytes = new Uint32Array(4);
  view.crypto.getRandomValues(bytes);
  return `preview-${[...bytes].map((entry) => entry.toString(16).padStart(8, '0')).join('')}`;
}

function createRuntimePreviewDocument(runtimeSource = ''): string {
  const bridgeSource = `
(() => {
  'use strict';
  const TRANSPORT = ${JSON.stringify(RUNTIME_PREVIEW_TRANSPORT)};
  const TRANSPORT_VERSION = ${RUNTIME_PREVIEW_TRANSPORT_VERSION};
  const PROTOCOL = ${JSON.stringify(RUNTIME_IFRAME_PROTOCOL)};
  const PROTOCOL_VERSION = ${RUNTIME_IFRAME_PROTOCOL_VERSION};
  const FIXED_HZ = 60;
  const FIXED_DELTA = 1 / FIXED_HZ;
  const MAX_CATCH_UP = 5;
  const ACTIONS = new Set(['start', 'pause', 'resume', 'step', 'restart', 'dispose']);
  let port = null;
  let identity = null;
  let adapter = null;
  let inboundSequence = 1;
  let outboundSequence = 1;
  let diagnostics = null;

  const plainObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  };

  const sameIdentity = (value) => plainObject(value)
    && value.sessionId === identity.sessionId
    && value.revision === identity.revision
    && value.buildHash === identity.buildHash;

  const makeDiagnostics = () => ({
    ...identity,
    status: 'idle',
    fixedHz: FIXED_HZ,
    fixedDeltaSeconds: FIXED_DELTA,
    maxCatchUpSteps: MAX_CATCH_UP,
    tick: 0,
    frame: 0,
    restartCount: 0,
    simulationTimeSeconds: 0,
    accumulatorSeconds: 0,
    totalDroppedSeconds: 0,
    catchUpClampCount: 0,
    lastAdvance: {
      frameDeltaSeconds: 0,
      fixedSteps: 0,
      droppedSeconds: 0,
      interpolationAlpha: 0,
    },
    systems: [],
    lastFailure: null,
  });

  const post = (message) => {
    if (!port) return;
    port.postMessage({
      transport: TRANSPORT,
      transportVersion: TRANSPORT_VERSION,
      sequence: outboundSequence++,
      ...identity,
      message,
    });
  };

  const runtimeMessage = (type, values = {}) => ({
    protocol: PROTOCOL,
    protocolVersion: PROTOCOL_VERSION,
    ...identity,
    type,
    ...values,
  });

  const defaultCommand = (action) => {
    if (action === 'start') {
      if (diagnostics.status !== 'idle') throw new Error('Runtime can only start while idle.');
      diagnostics.status = 'running';
    } else if (action === 'pause') {
      if (diagnostics.status !== 'running') throw new Error('Runtime can only pause while running.');
      diagnostics.status = 'paused';
    } else if (action === 'resume') {
      if (diagnostics.status !== 'paused') throw new Error('Runtime can only resume while paused.');
      diagnostics.status = 'running';
    } else if (action === 'step') {
      if (diagnostics.status !== 'paused') throw new Error('Runtime can only step while paused.');
      diagnostics.tick += 1;
      diagnostics.frame += 1;
      diagnostics.simulationTimeSeconds = diagnostics.tick * FIXED_DELTA;
      diagnostics.lastAdvance = {
        frameDeltaSeconds: 0,
        fixedSteps: 1,
        droppedSeconds: 0,
        interpolationAlpha: 0,
      };
    } else if (action === 'restart') {
      diagnostics.restartCount += 1;
      diagnostics.status = 'running';
      diagnostics.tick = 0;
      diagnostics.frame = 0;
      diagnostics.simulationTimeSeconds = 0;
      diagnostics.accumulatorSeconds = 0;
      diagnostics.lastAdvance = {
        frameDeltaSeconds: 0,
        fixedSteps: 0,
        droppedSeconds: 0,
        interpolationAlpha: 0,
      };
    } else if (action === 'dispose') {
      diagnostics.status = 'disposed';
    }
    return diagnostics;
  };

  const execute = async (action) => {
    let result;
    if (adapter && typeof adapter[action] === 'function') {
      result = await adapter[action]();
    } else if (adapter && typeof adapter.command === 'function') {
      result = await adapter.command(action);
    } else {
      result = defaultCommand(action);
    }
    if (plainObject(result)) diagnostics = result;
    else if (adapter && typeof adapter.getDiagnostics === 'function') diagnostics = adapter.getDiagnostics();
    if (!plainObject(diagnostics)) throw new Error('Runtime adapter returned invalid diagnostics.');
    return diagnostics;
  };

  const handleCommand = async (event) => {
    const envelope = event.data;
    if (!plainObject(envelope)
      || envelope.transport !== TRANSPORT
      || envelope.transportVersion !== TRANSPORT_VERSION
      || envelope.sequence !== inboundSequence
      || !sameIdentity(envelope)
      || !plainObject(envelope.message)) return;
    const message = envelope.message;
    if (message.protocol !== PROTOCOL
      || message.protocolVersion !== PROTOCOL_VERSION
      || message.type !== 'runtime.command'
      || !sameIdentity(message)
      || typeof message.requestId !== 'string'
      || !ACTIONS.has(message.action)) return;
    inboundSequence += 1;
    try {
      const nextDiagnostics = await execute(message.action);
      post(runtimeMessage('runtime.result', {
        requestId: message.requestId,
        action: message.action,
        ok: true,
        diagnostics: nextDiagnostics,
      }));
      post(runtimeMessage('runtime.diagnostics', { diagnostics: nextDiagnostics }));
      if (message.action === 'dispose') queueMicrotask(() => port && port.close());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Runtime command failed.';
      post(runtimeMessage('runtime.error', {
        requestId: message.requestId,
        code: 'runtime_command_failed',
        message: errorMessage.slice(0, 2000) || 'Runtime command failed.',
        fatal: false,
      }));
    }
  };

  const handleHandshake = async (event) => {
    const value = event.data;
    if (event.source !== parent
      || !plainObject(value)
      || value.transport !== TRANSPORT
      || value.transportVersion !== TRANSPORT_VERSION
      || value.type !== 'runtime.handshake'
      || typeof value.handshakeId !== 'string'
      || typeof value.sessionId !== 'string'
      || !Number.isSafeInteger(value.revision)
      || value.revision < 0
      || typeof value.buildHash !== 'string'
      || event.ports.length !== 1) return;

    removeEventListener('message', handleHandshake);
    identity = {
      sessionId: value.sessionId,
      revision: value.revision,
      buildHash: value.buildHash,
    };
    port = event.ports[0];
    port.onmessage = handleCommand;
    port.start();
    diagnostics = makeDiagnostics();

    try {
      const factory = globalThis.__THREEJS_STUDIO_PREVIEW_RUNTIME_FACTORY__;
      if (typeof factory === 'function') adapter = await factory(Object.freeze({ ...identity }));
      if (adapter && typeof adapter.getDiagnostics === 'function') {
        const initialDiagnostics = adapter.getDiagnostics();
        if (plainObject(initialDiagnostics)) diagnostics = initialDiagnostics;
      }
      post(runtimeMessage('runtime.ready', { diagnostics }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Runtime initialization failed.';
      post(runtimeMessage('runtime.error', {
        requestId: null,
        code: 'runtime_initialization_failed',
        message: errorMessage.slice(0, 2000) || 'Runtime initialization failed.',
        fatal: true,
      }));
    }
  };

  addEventListener('message', handleHandshake);
})();`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${RUNTIME_PREVIEW_CSP}">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <title>ThreeJS Studio runtime preview</title>
    <style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#09090b;color:#fafafa}canvas{display:block}</style>
  </head>
  <body>
    <main id="runtime-root" aria-label="Game preview"></main>
    ${runtimeSource ? `<script>${escapeInlineScript(runtimeSource)}</script>` : ''}
    <script>${escapeInlineScript(bridgeSource)}</script>
  </body>
</html>`;
}

function validatePreviewEnvelope(
  value: unknown,
  identity: RuntimeSessionIdentity,
): { ok: true; envelope: RuntimePreviewEnvelope } | { ok: false; issue: RuntimePreviewProtocolIssue } {
  if (!isJsonValue(value) || !isPlainObject(value)) {
    return {
      ok: false,
      issue: { code: 'invalid_envelope', message: 'Runtime preview message must be a finite, acyclic JSON object.' },
    };
  }

  const allowedKeys = [
    'transport',
    'transportVersion',
    'sequence',
    'sessionId',
    'revision',
    'buildHash',
    'message',
  ];
  const extraKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  const errors: string[] = [];
  if (extraKeys.length) errors.push(...extraKeys.map((key) => `envelope.${key} is not supported.`));
  if (value.transport !== RUNTIME_PREVIEW_TRANSPORT) errors.push('envelope.transport is invalid.');
  if (value.transportVersion !== RUNTIME_PREVIEW_TRANSPORT_VERSION) errors.push('envelope.transportVersion is invalid.');
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) {
    errors.push('envelope.sequence must be a positive safe integer.');
  }
  if (errors.length) {
    return {
      ok: false,
      issue: { code: 'invalid_envelope', message: errors.join(' '), details: errors },
    };
  }

  if (
    value.sessionId !== identity.sessionId
    || value.revision !== identity.revision
    || value.buildHash !== identity.buildHash
  ) {
    return {
      ok: false,
      issue: { code: 'identity_mismatch', message: 'Runtime preview message does not match the active session revision.' },
    };
  }

  let message: RuntimeIframeMessage;
  try {
    message = parseRuntimeIframeMessage(value.message);
  } catch (error) {
    const details = error instanceof Error ? [error.message] : ['Runtime protocol message is invalid.'];
    return {
      ok: false,
      issue: { code: 'invalid_envelope', message: details.join(' '), details },
    };
  }
  if (
    message.sessionId !== identity.sessionId
    || message.revision !== identity.revision
    || message.buildHash !== identity.buildHash
  ) {
    return {
      ok: false,
      issue: { code: 'identity_mismatch', message: 'Runtime protocol message does not match the active session revision.' },
    };
  }

  return { ok: true, envelope: { ...value, message } as RuntimePreviewEnvelope };
}

export class RuntimePreviewHost {
  readonly identity: RuntimeSessionIdentity;

  private readonly container: HTMLElement;
  private readonly runtimeSource: string;
  private readonly title: string;
  private readonly readyTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly diagnosticsThrottleMs: number;
  private readonly onDiagnostics?: (diagnostics: RuntimeDiagnostics) => void;
  private readonly onRuntimeError?: (error: RuntimeErrorMessage) => void;
  private readonly onProtocolIssue?: (issue: RuntimePreviewProtocolIssue) => void;
  private readonly view: Window;
  private readonly handshakeId: string;

  private status: RuntimePreviewHostStatus = 'new';
  private iframe: HTMLIFrameElement | null = null;
  private port: MessagePort | null = null;
  private inboundSequence = 1;
  private outboundSequence = 1;
  private requestSequence = 1;
  private pendingCommands = new Map<string, PendingCommand>();
  private readyTimeout: number | null = null;
  private diagnosticsTimeout: number | null = null;
  private lastDiagnosticsAt = Number.NEGATIVE_INFINITY;
  private queuedDiagnostics: RuntimeDiagnostics | null = null;
  private latestDiagnostics: RuntimeDiagnostics | null = null;
  private disposePromise: Promise<void> | null = null;
  private resolveReady!: (message: RuntimeReadyMessage) => void;
  private rejectReady!: (error: RuntimePreviewHostError) => void;
  private readonly readyPromise: Promise<RuntimeReadyMessage>;

  constructor(options: RuntimePreviewHostOptions) {
    const identityErrors = validateRuntimeIdentity(options.identity);
    if (identityErrors.length) {
      throw new RuntimePreviewHostError('invalid_argument', identityErrors.join(' '), identityErrors);
    }
    const container = options.container;
    const view = container?.ownerDocument?.defaultView;
    if (!view || !(container instanceof view.HTMLElement)) {
      throw new RuntimePreviewHostError('invalid_argument', 'Runtime preview container must be a window-owned HTMLElement.');
    }
    if (options.runtimeSource !== undefined && typeof options.runtimeSource !== 'string') {
      throw new RuntimePreviewHostError('invalid_argument', 'runtimeSource must be a string.');
    }

    this.identity = copyIdentity(options.identity);
    this.container = container;
    this.runtimeSource = options.runtimeSource ?? '';
    this.title = options.title?.trim() || 'Game preview';
    this.readyTimeoutMs = validateTimeout(options.readyTimeoutMs, DEFAULT_READY_TIMEOUT_MS, 'readyTimeoutMs');
    this.commandTimeoutMs = validateTimeout(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, 'commandTimeoutMs');
    this.diagnosticsThrottleMs = validateTimeout(
      options.diagnosticsThrottleMs,
      DEFAULT_DIAGNOSTICS_THROTTLE_MS,
      'diagnosticsThrottleMs',
    );
    this.onDiagnostics = options.onDiagnostics;
    this.onRuntimeError = options.onRuntimeError;
    this.onProtocolIssue = options.onProtocolIssue;
    this.view = view;
    this.handshakeId = createHandshakeId(view);
    this.readyPromise = new Promise<RuntimeReadyMessage>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Disposing before a caller observes mount() must not create a global
    // unhandled-rejection, while the original promise remains rejectable to
    // every explicit mount()/whenReady() consumer.
    void this.readyPromise.catch(() => undefined);
  }

  get lifecycleStatus(): RuntimePreviewHostStatus {
    return this.status;
  }

  get element(): HTMLIFrameElement | null {
    return this.iframe;
  }

  getDiagnostics(): RuntimeDiagnostics | null {
    return this.latestDiagnostics ? copyDiagnostics(this.latestDiagnostics) : null;
  }

  mount(): Promise<RuntimeReadyMessage> {
    if (this.status !== 'new') {
      if (this.status === 'mounting' || this.status === 'handshaking' || this.status === 'ready') {
        return this.readyPromise;
      }
      return Promise.reject(new RuntimePreviewHostError('disposed', 'Runtime preview host has been disposed.'));
    }

    this.status = 'mounting';
    const iframe = this.container.ownerDocument.createElement('iframe');
    iframe.title = this.title;
    iframe.name = this.handshakeId;
    iframe.setAttribute('sandbox', RUNTIME_PREVIEW_SANDBOX);
    iframe.setAttribute('allow', RUNTIME_PREVIEW_ALLOW);
    iframe.setAttribute('csp', RUNTIME_PREVIEW_CSP);
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('data-threejs-studio-runtime-preview', '');
    iframe.srcdoc = createRuntimePreviewDocument(this.runtimeSource);
    // Keep observing load after the first handshake. A second load means the
    // isolated runtime navigated and its MessagePort/runtime state can no
    // longer be trusted.
    iframe.addEventListener('load', () => this.handleFrameLoad());
    iframe.addEventListener('error', () => this.handleFrameFailure(
      'runtime_frame_load_failed',
      'Runtime preview frame failed to load.',
    ));
    this.iframe = iframe;
    this.container.append(iframe);

    this.readyTimeout = this.view.setTimeout(() => {
      if (this.status === 'ready' || this.status === 'disposed') return;
      const error = new RuntimePreviewHostError('handshake_timeout', 'Runtime preview did not become ready in time.');
      this.rejectReady(error);
      this.cleanup(error);
    }, this.readyTimeoutMs);
    return this.readyPromise;
  }

  whenReady(): Promise<RuntimeReadyMessage> {
    return this.readyPromise;
  }

  start(): Promise<RuntimeDiagnostics> {
    return this.command('start');
  }

  pause(): Promise<RuntimeDiagnostics> {
    return this.command('pause');
  }

  resume(): Promise<RuntimeDiagnostics> {
    return this.command('resume');
  }

  step(): Promise<RuntimeDiagnostics> {
    return this.command('step');
  }

  restart(): Promise<RuntimeDiagnostics> {
    return this.command('restart');
  }

  async command(action: Exclude<RuntimeControlAction, 'dispose'>): Promise<RuntimeDiagnostics> {
    if (this.status !== 'ready') {
      const code = this.status === 'disposed' || this.status === 'disposing' ? 'disposed' : 'invalid_state';
      throw new RuntimePreviewHostError(code, `Cannot send "${action}" while preview host is ${this.status}.`);
    }
    const result = await this.sendCommand(action, this.commandTimeoutMs);
    return copyDiagnostics(result.diagnostics);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    if (this.status === 'disposed') return Promise.resolve();

    this.disposePromise = (async () => {
      if (this.status === 'ready') {
        const resultPromise = this.sendCommand('dispose', Math.min(this.commandTimeoutMs, 1_000));
        this.status = 'disposing';
        try {
          await resultPromise;
        } catch {
          // Cleanup is authoritative even when the sandbox stops responding.
        }
      }
      const error = new RuntimePreviewHostError('disposed', 'Runtime preview host was disposed.');
      if (this.status !== 'disposing') this.rejectReady(error);
      this.cleanup(error);
    })();
    return this.disposePromise;
  }

  private beginHandshake(): void {
    const target = this.iframe?.contentWindow;
    if (this.status !== 'mounting' || !target) return;
    const channel = new MessageChannel();
    const port = channel.port1;
    this.port = port;
    port.onmessage = (event: MessageEvent<unknown>) => this.handlePortMessage(event.data);
    port.onmessageerror = () => this.reportProtocolIssue({
      code: 'invalid_envelope',
      message: 'Runtime preview channel received a non-cloneable message.',
    });
    port.start();
    this.status = 'handshaking';
    try {
      target.postMessage({
        transport: RUNTIME_PREVIEW_TRANSPORT,
        transportVersion: RUNTIME_PREVIEW_TRANSPORT_VERSION,
        type: 'runtime.handshake',
        handshakeId: this.handshakeId,
        ...this.identity,
      }, '*', [channel.port2]);
    } catch (error) {
      port.close();
      channel.port2.close();
      this.handleFrameFailure(
        'runtime_handshake_failed',
        error instanceof Error ? error.message : 'Runtime preview handshake failed.',
      );
    }
  }

  private handleFrameLoad(): void {
    if (this.status === 'mounting') {
      this.beginHandshake();
      return;
    }
    if (this.status === 'handshaking' || this.status === 'ready' || this.status === 'disposing') {
      this.handleFrameFailure(
        'runtime_frame_navigated',
        'Runtime preview frame navigated after its isolated session started.',
      );
    }
  }

  private handleFrameFailure(code: string, message: string): void {
    if (this.status === 'disposed') return;
    const runtimeMessage: RuntimeErrorMessage = {
      protocol: RUNTIME_IFRAME_PROTOCOL,
      protocolVersion: RUNTIME_IFRAME_PROTOCOL_VERSION,
      ...this.identity,
      type: 'runtime.error',
      requestId: null,
      code,
      message,
      fatal: true,
    };
    const error = new RuntimePreviewHostError('runtime_error', message);
    if (this.status === 'mounting' || this.status === 'handshaking') this.rejectReady(error);
    this.cleanup(error);
    invokeHostCallback(this.onRuntimeError, runtimeMessage);
  }

  private sendCommand(action: RuntimeControlAction, timeoutMs: number): Promise<RuntimeResultMessage> {
    const port = this.port;
    if (!port) return Promise.reject(new RuntimePreviewHostError('invalid_state', 'Runtime preview channel is unavailable.'));
    const requestId = `runtime-request-${this.requestSequence++}`;
    const command = createRuntimeCommandMessage(this.identity, requestId, action);
    const envelope: RuntimePreviewEnvelope = {
      transport: RUNTIME_PREVIEW_TRANSPORT,
      transportVersion: RUNTIME_PREVIEW_TRANSPORT_VERSION,
      sequence: this.outboundSequence++,
      ...this.identity,
      message: command,
    };

    return new Promise<RuntimeResultMessage>((resolve, reject) => {
      const timeout = this.view.setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new RuntimePreviewHostError('command_timeout', `Runtime command "${action}" timed out.`));
      }, timeoutMs);
      this.pendingCommands.set(requestId, { action, resolve, reject, timeout });
      try {
        port.postMessage(envelope);
      } catch (error) {
        this.view.clearTimeout(timeout);
        this.pendingCommands.delete(requestId);
        reject(new RuntimePreviewHostError(
          'runtime_error',
          error instanceof Error ? error.message : `Could not send runtime command "${action}".`,
        ));
      }
    });
  }

  private handlePortMessage(value: unknown): void {
    if (this.status === 'disposed') return;
    const validation = validatePreviewEnvelope(value, this.identity);
    if (!validation.ok) {
      this.reportProtocolIssue(validation.issue);
      return;
    }
    const { envelope } = validation;
    if (envelope.sequence < this.inboundSequence) {
      this.reportProtocolIssue({
        code: 'stale_sequence',
        message: `Rejected stale runtime sequence ${envelope.sequence}; expected ${this.inboundSequence}.`,
      });
      return;
    }
    if (envelope.sequence > this.inboundSequence) {
      this.reportProtocolIssue({
        code: 'sequence_gap',
        message: `Rejected runtime sequence ${envelope.sequence}; expected ${this.inboundSequence}.`,
      });
      return;
    }
    this.inboundSequence += 1;

    const message = envelope.message;
    if (message.type === 'runtime.ready') {
      this.handleReady(message);
    } else if (message.type === 'runtime.result') {
      this.handleResult(message);
    } else if (message.type === 'runtime.diagnostics') {
      this.handleDiagnostics(message);
    } else if (message.type === 'runtime.error') {
      this.handleRuntimeError(message);
    } else {
      this.reportProtocolIssue({
        code: 'unexpected_message',
        message: `Runtime host cannot receive message type "${message.type}".`,
      });
    }
  }

  private handleReady(message: RuntimeReadyMessage): void {
    if (this.status !== 'handshaking') {
      this.reportProtocolIssue({ code: 'unexpected_message', message: 'Runtime sent ready more than once.' });
      return;
    }
    if (this.readyTimeout !== null) {
      this.view.clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
    this.status = 'ready';
    this.latestDiagnostics = copyDiagnostics(message.diagnostics);
    this.resolveReady({ ...message, diagnostics: copyDiagnostics(message.diagnostics) });
    this.scheduleDiagnostics(message.diagnostics);
  }

  private handleResult(message: RuntimeResultMessage): void {
    const pending = this.pendingCommands.get(message.requestId);
    if (!pending) {
      this.reportProtocolIssue({
        code: 'unknown_request',
        message: `Runtime responded to unknown request "${message.requestId}".`,
      });
      return;
    }
    if (pending.action !== message.action) {
      this.reportProtocolIssue({
        code: 'unexpected_message',
        message: `Runtime response action "${message.action}" does not match "${pending.action}".`,
      });
      return;
    }
    this.pendingCommands.delete(message.requestId);
    this.view.clearTimeout(pending.timeout);
    this.latestDiagnostics = copyDiagnostics(message.diagnostics);
    pending.resolve({ ...message, diagnostics: copyDiagnostics(message.diagnostics) });
    this.scheduleDiagnostics(message.diagnostics);
  }

  private handleDiagnostics(message: RuntimeDiagnosticsMessage): void {
    if (this.status !== 'ready' && this.status !== 'disposing') {
      this.reportProtocolIssue({
        code: 'unexpected_message',
        message: 'Runtime diagnostics arrived before the preview was ready.',
      });
      return;
    }
    this.latestDiagnostics = copyDiagnostics(message.diagnostics);
    this.scheduleDiagnostics(message.diagnostics);
  }

  private handleRuntimeError(message: RuntimeErrorMessage): void {
    if (message.requestId !== null) {
      const pending = this.pendingCommands.get(message.requestId);
      if (!pending) {
        this.reportProtocolIssue({
          code: 'unknown_request',
          message: `Runtime error referenced unknown request "${message.requestId}".`,
        });
      } else {
        this.pendingCommands.delete(message.requestId);
        this.view.clearTimeout(pending.timeout);
        pending.reject(new RuntimePreviewHostError('runtime_error', message.message));
      }
    }
    if (message.fatal && this.status !== 'disposed') {
      const error = new RuntimePreviewHostError('runtime_error', message.message);
      if (this.status === 'handshaking' || this.status === 'mounting') this.rejectReady(error);
      this.cleanup(error);
    }
    invokeHostCallback(this.onRuntimeError, { ...message });
  }

  private scheduleDiagnostics(diagnostics: RuntimeDiagnostics): void {
    if (!this.onDiagnostics || this.status === 'disposed') return;
    this.queuedDiagnostics = copyDiagnostics(diagnostics);
    const now = this.view.performance.now();
    const remaining = Math.max(0, this.diagnosticsThrottleMs - (now - this.lastDiagnosticsAt));
    if (remaining === 0 && this.diagnosticsTimeout === null) {
      this.flushDiagnostics();
      return;
    }
    if (this.diagnosticsTimeout !== null) return;
    this.diagnosticsTimeout = this.view.setTimeout(() => {
      this.diagnosticsTimeout = null;
      this.flushDiagnostics();
    }, remaining);
  }

  private flushDiagnostics(): void {
    if (!this.queuedDiagnostics || this.status === 'disposed') return;
    const diagnostics = this.queuedDiagnostics;
    this.queuedDiagnostics = null;
    this.lastDiagnosticsAt = this.view.performance.now();
    invokeHostCallback(this.onDiagnostics, copyDiagnostics(diagnostics));
  }

  private reportProtocolIssue(issue: RuntimePreviewProtocolIssue): void {
    if (this.status === 'disposed') return;
    invokeHostCallback(this.onProtocolIssue, {
      ...issue,
      details: issue.details ? [...issue.details] : undefined,
    });
  }

  private cleanup(error: RuntimePreviewHostError): void {
    if (this.status === 'disposed') return;
    this.status = 'disposed';
    if (this.readyTimeout !== null) this.view.clearTimeout(this.readyTimeout);
    if (this.diagnosticsTimeout !== null) this.view.clearTimeout(this.diagnosticsTimeout);
    this.readyTimeout = null;
    this.diagnosticsTimeout = null;
    this.queuedDiagnostics = null;

    for (const pending of this.pendingCommands.values()) {
      this.view.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingCommands.clear();

    if (this.port) {
      this.port.onmessage = null;
      this.port.onmessageerror = null;
      this.port.close();
      this.port = null;
    }
    this.iframe?.remove();
    this.iframe = null;
  }
}
