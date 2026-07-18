import {
  SCRIPT_COMPILER_PROTOCOL_VERSION,
  type ScriptCompileRequest,
  type ScriptCompileResult,
  type ScriptCompilerWorkerRequest,
  type ScriptCompilerWorkerResponse,
} from './compilerProtocol';

export class ScriptCompileCancelledError extends Error {
  readonly requestId: string;

  constructor(requestId: string, message = 'Script compilation was superseded or cancelled.') {
    super(message);
    this.name = 'ScriptCompileCancelledError';
    this.requestId = requestId;
  }
}

export class ScriptCompilerWorkerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ScriptCompilerWorkerError';
    this.code = code;
  }
}

interface PendingCompile {
  readonly projectRevision: number;
  readonly resolve: (result: ScriptCompileResult) => void;
  readonly reject: (error: Error) => void;
}

function createRequestId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `compile-${suffix}`;
}

export class ScriptCompilerClient {
  readonly #worker: Worker;
  readonly #pending = new Map<string, PendingCompile>();
  #latestRequestId: string | null = null;
  #disposed = false;

  constructor(worker = new Worker(new URL('./compiler.worker.ts', import.meta.url), {
    name: 'threejs-studio-script-compiler',
    type: 'module',
  })) {
    this.#worker = worker;
    worker.addEventListener('message', this.#handleMessage);
    worker.addEventListener('error', this.#handleError);
    worker.addEventListener('messageerror', this.#handleMessageError);
  }

  compile(request: Omit<ScriptCompileRequest, 'requestId'>): Promise<ScriptCompileResult> {
    if (this.#disposed) return Promise.reject(new ScriptCompilerWorkerError('COMPILER_DISPOSED', 'Script compiler is disposed.'));
    if (this.#latestRequestId) this.cancel(this.#latestRequestId);
    const requestId = createRequestId();
    const payload: ScriptCompileRequest = { ...request, requestId };
    this.#latestRequestId = requestId;
    return new Promise<ScriptCompileResult>((resolve, reject) => {
      this.#pending.set(requestId, { projectRevision: request.projectRevision, resolve, reject });
      this.#post({
        protocolVersion: SCRIPT_COMPILER_PROTOCOL_VERSION,
        type: 'compile',
        payload,
      });
    });
  }

  cancel(requestId: string) {
    const pending = this.#pending.get(requestId);
    if (pending) {
      this.#pending.delete(requestId);
      pending.reject(new ScriptCompileCancelledError(requestId));
    }
    if (this.#latestRequestId === requestId) this.#latestRequestId = null;
    if (!this.#disposed) {
      this.#post({
        protocolVersion: SCRIPT_COMPILER_PROTOCOL_VERSION,
        type: 'cancel',
        requestId,
      });
    }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#post({ protocolVersion: SCRIPT_COMPILER_PROTOCOL_VERSION, type: 'dispose' });
    this.#worker.removeEventListener('message', this.#handleMessage);
    this.#worker.removeEventListener('error', this.#handleError);
    this.#worker.removeEventListener('messageerror', this.#handleMessageError);
    this.#worker.terminate();
    for (const [requestId, pending] of this.#pending) {
      pending.reject(new ScriptCompileCancelledError(requestId, 'Script compiler was disposed.'));
    }
    this.#pending.clear();
    this.#latestRequestId = null;
  }

  #post(message: ScriptCompilerWorkerRequest) {
    this.#worker.postMessage(message);
  }

  readonly #handleMessage = (event: MessageEvent<ScriptCompilerWorkerResponse>) => {
    const message = event.data;
    if (!message || message.protocolVersion !== SCRIPT_COMPILER_PROTOCOL_VERSION) return;
    if (message.type === 'fatal') {
      const error = new ScriptCompilerWorkerError(message.code, message.message);
      if (message.requestId) {
        const pending = this.#pending.get(message.requestId);
        this.#pending.delete(message.requestId);
        pending?.reject(error);
        if (this.#latestRequestId === message.requestId) this.#latestRequestId = null;
      } else {
        this.#failAll(error);
      }
      return;
    }
    if (message.type === 'cancelled') {
      const pending = this.#pending.get(message.requestId);
      this.#pending.delete(message.requestId);
      pending?.reject(new ScriptCompileCancelledError(message.requestId));
      return;
    }
    if (message.type !== 'result') return;
    const pending = this.#pending.get(message.payload.requestId);
    if (!pending) return;
    this.#pending.delete(message.payload.requestId);
    if (
      message.payload.requestId !== this.#latestRequestId
      || message.payload.projectRevision !== pending.projectRevision
    ) {
      pending.reject(new ScriptCompileCancelledError(message.payload.requestId));
      return;
    }
    this.#latestRequestId = null;
    pending.resolve(message.payload);
  };

  readonly #handleError = (event: ErrorEvent) => {
    this.#failAll(new ScriptCompilerWorkerError('COMPILER_WORKER_CRASHED', event.message || 'Script compiler Worker crashed.'));
  };

  readonly #handleMessageError = () => {
    this.#failAll(new ScriptCompilerWorkerError('COMPILER_WORKER_MESSAGE_ERROR', 'Script compiler Worker sent invalid data.'));
  };

  #failAll(error: Error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#latestRequestId = null;
  }
}
