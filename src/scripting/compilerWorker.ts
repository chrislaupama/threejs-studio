import { SCRIPT_COMPILER_PROTOCOL_VERSION, type ScriptCompilerWorkerRequest, type ScriptCompilerWorkerResponse } from './compilerProtocol';
import { ScriptCompilerService } from './compiler';

export interface ScriptCompilerWorkerScope {
  postMessage(message: ScriptCompilerWorkerResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

export class ScriptCompilerWorkerController {
  readonly #compiler: ScriptCompilerService;
  readonly #cancelled = new Set<string>();
  #latestCompileGeneration = 0;
  #disposed = false;

  constructor(compiler: ScriptCompilerService) {
    this.#compiler = compiler;
  }

  ready(): ScriptCompilerWorkerResponse {
    return {
      protocolVersion: SCRIPT_COMPILER_PROTOCOL_VERSION,
      type: 'ready',
      compilerVersion: this.#compiler.compilerVersion,
    };
  }

  async handle(message: ScriptCompilerWorkerRequest): Promise<ScriptCompilerWorkerResponse | null> {
    if (this.#disposed) {
      return {
        protocolVersion: SCRIPT_COMPILER_PROTOCOL_VERSION,
        type: 'fatal',
        requestId: message.type === 'compile' ? message.payload.requestId : null,
        code: 'COMPILER_DISPOSED',
        message: 'The script compiler Worker has been disposed.',
      };
    }
    if (message.protocolVersion !== SCRIPT_COMPILER_PROTOCOL_VERSION) {
      return {
        protocolVersion: SCRIPT_COMPILER_PROTOCOL_VERSION,
        type: 'fatal',
        requestId: message.type === 'compile' ? message.payload.requestId : null,
        code: 'PROTOCOL_VERSION_MISMATCH',
        message: `Expected compiler protocol ${SCRIPT_COMPILER_PROTOCOL_VERSION}.`,
      };
    }
    if (message.type === 'cancel') {
      this.#cancelled.add(message.requestId);
      return {
        protocolVersion: SCRIPT_COMPILER_PROTOCOL_VERSION,
        type: 'cancelled',
        requestId: message.requestId,
      };
    }
    if (message.type === 'dispose') {
      this.#disposed = true;
      return null;
    }

    const generation = ++this.#latestCompileGeneration;
    const result = await this.#compiler.compile(message.payload);
    if (this.#cancelled.delete(message.payload.requestId) || generation !== this.#latestCompileGeneration) {
      return {
        protocolVersion: SCRIPT_COMPILER_PROTOCOL_VERSION,
        type: 'cancelled',
        requestId: message.payload.requestId,
      };
    }
    return {
      protocolVersion: SCRIPT_COMPILER_PROTOCOL_VERSION,
      type: 'result',
      payload: result,
    };
  }
}

export function installScriptCompilerWorker(scope: ScriptCompilerWorkerScope, controller: ScriptCompilerWorkerController) {
  scope.postMessage(controller.ready());
  scope.addEventListener('message', (event) => {
    void controller.handle(event.data as ScriptCompilerWorkerRequest).then((response) => {
      if (response) scope.postMessage(response);
      if (event.data && typeof event.data === 'object' && (event.data as { type?: unknown }).type === 'dispose') scope.close();
    }).catch((error: unknown) => {
      scope.postMessage({
        protocolVersion: SCRIPT_COMPILER_PROTOCOL_VERSION,
        type: 'fatal',
        requestId: null,
        code: 'COMPILER_WORKER_FAILURE',
        message: error instanceof Error ? error.message : 'Unknown compiler Worker failure.',
      });
    });
  });
}
