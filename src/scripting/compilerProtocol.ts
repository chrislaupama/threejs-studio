import type { VirtualProjectSnapshot } from './virtualFileSystem';

export const SCRIPT_COMPILER_PROTOCOL_VERSION = 1 as const;

export type ScriptCompileMode = 'development' | 'production';

export interface ScriptCompileRequest {
  readonly requestId: string;
  readonly projectRevision: number;
  readonly entryPath: string;
  readonly snapshot: VirtualProjectSnapshot;
  readonly mode: ScriptCompileMode;
}

export interface ScriptDiagnosticNote {
  readonly message: string;
  readonly filePath: string | null;
  readonly line: number | null;
  /** One-based UTF-16 column, suitable for Monaco. */
  readonly column: number | null;
}

export interface ScriptDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly source: 'request' | 'vfs' | 'esbuild' | 'compiler';
  readonly message: string;
  readonly filePath: string | null;
  readonly line: number | null;
  /** One-based UTF-16 column, suitable for Monaco. */
  readonly column: number | null;
  readonly length: number | null;
  readonly lineText: string | null;
  readonly notes: readonly ScriptDiagnosticNote[];
}

interface ScriptCompileResultBase {
  readonly requestId: string;
  readonly projectRevision: number;
  readonly entryPath: string;
  readonly compilerVersion: string;
  readonly diagnostics: readonly ScriptDiagnostic[];
}

export interface ScriptCompileSuccess extends ScriptCompileResultBase {
  readonly ok: true;
  readonly javascript: string;
  readonly sourceMap: string | null;
  readonly dependencies: readonly string[];
  readonly contentHash: string;
  /** esbuild transpiles TypeScript; Monaco's TypeScript worker supplies semantic diagnostics. */
  readonly semanticDiagnosticsIncluded: false;
}

export interface ScriptCompileFailure extends ScriptCompileResultBase {
  readonly ok: false;
}

export type ScriptCompileResult = ScriptCompileSuccess | ScriptCompileFailure;

export type ScriptCompilerWorkerRequest =
  | {
      readonly protocolVersion: typeof SCRIPT_COMPILER_PROTOCOL_VERSION;
      readonly type: 'compile';
      readonly payload: ScriptCompileRequest;
    }
  | {
      readonly protocolVersion: typeof SCRIPT_COMPILER_PROTOCOL_VERSION;
      readonly type: 'cancel';
      readonly requestId: string;
    }
  | {
      readonly protocolVersion: typeof SCRIPT_COMPILER_PROTOCOL_VERSION;
      readonly type: 'dispose';
    };

export type ScriptCompilerWorkerResponse =
  | {
      readonly protocolVersion: typeof SCRIPT_COMPILER_PROTOCOL_VERSION;
      readonly type: 'ready';
      readonly compilerVersion: string;
    }
  | {
      readonly protocolVersion: typeof SCRIPT_COMPILER_PROTOCOL_VERSION;
      readonly type: 'result';
      readonly payload: ScriptCompileResult;
    }
  | {
      readonly protocolVersion: typeof SCRIPT_COMPILER_PROTOCOL_VERSION;
      readonly type: 'cancelled';
      readonly requestId: string;
    }
  | {
      readonly protocolVersion: typeof SCRIPT_COMPILER_PROTOCOL_VERSION;
      readonly type: 'fatal';
      readonly requestId: string | null;
      readonly code: string;
      readonly message: string;
    };
