import {
  STUDIO_SDK_DECLARATION,
  STUDIO_SDK_DECLARATION_URI,
} from '@/scripting/studioSdkContract';
import { configureMonacoEnvironment } from './monacoEnvironment';

export interface MonacoTypeScriptApi {
  typescriptDefaults: {
    setCompilerOptions(options: Record<string, unknown>): void;
    addExtraLib(source: string, path: string): { dispose(): void };
  };
  getTypeScriptWorker(): Promise<(resource: { toString(): string }) => Promise<{
    getSyntacticDiagnostics(fileName: string): Promise<readonly unknown[]>;
    getSemanticDiagnostics(fileName: string): Promise<readonly unknown[]>;
  }>>;
  ModuleKind: { ESNext: number };
  ModuleResolutionKind: { NodeJs: number };
  ScriptTarget: { ES2022: number };
}

/** Load Monaco and install the exact SDK declaration used by authored scripts. */
export async function loadStudioMonaco() {
  configureMonacoEnvironment();
  const [monaco] = await Promise.all([
    import('monaco-editor'),
    import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
  ]);
  const typescript = (monaco.languages as unknown as { typescript: MonacoTypeScriptApi }).typescript;
  typescript.typescriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
    strict: true,
    target: typescript.ScriptTarget.ES2022,
    noEmit: true,
  });
  const sdk = typescript.typescriptDefaults.addExtraLib(
    STUDIO_SDK_DECLARATION,
    STUDIO_SDK_DECLARATION_URI,
  );
  return {
    monaco,
    typescript,
    disposeSdk: () => sdk.dispose(),
  };
}
