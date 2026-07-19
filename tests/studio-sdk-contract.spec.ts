import { expect, test } from '@playwright/test';
import * as ts from 'typescript';
import { ScriptCompilerService } from '../src/scripting/compiler';
import {
  DEFAULT_BEHAVIOR_SOURCE,
  STUDIO_SDK_DECLARATION,
  STUDIO_SDK_DECLARATION_URI,
  STUDIO_SDK_MODULE_ID,
  STUDIO_SDK_RUNTIME_MODULE_SOURCE,
} from '../src/scripting/studioSdkContract';
import { createVirtualProjectSnapshot } from '../src/scripting/virtualFileSystem';
import { COLLECT_ESCAPE_BEHAVIOR_SOURCE } from '../src/templates/collectEscape';

function semanticDiagnostics(source: string) {
  const sourcePath = '/workspace/behavior.ts';
  const declarationPath = new URL(STUDIO_SDK_DECLARATION_URI).pathname;
  const virtualFiles = new Map([
    [sourcePath, source],
    [declarationPath, STUDIO_SDK_DECLARATION],
  ]);
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => virtualFiles.has(fileName) || fileExists(fileName);
  host.readFile = (fileName) => virtualFiles.get(fileName) ?? readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const sourceText = virtualFiles.get(fileName);
    if (sourceText !== undefined) return ts.createSourceFile(fileName, sourceText, languageVersion, true);
    return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const program = ts.createProgram({
    rootNames: [sourcePath, declarationPath],
    options,
    host,
  });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    file: diagnostic.file?.fileName ?? null,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    start: diagnostic.start ?? null,
  }));
}

async function compileExactSource(source: string, requestId: string) {
  const compiler = new ScriptCompilerService();
  return compiler.compile({
    requestId,
    projectRevision: 1,
    entryPath: '/scripts/behavior.ts',
    snapshot: createVirtualProjectSnapshot([
      { path: '/scripts/behavior.ts', contents: source },
    ], 1),
    mode: 'development',
  });
}

test('the exact default behavior has zero SDK semantic errors and compiles unchanged', async () => {
  expect(DEFAULT_BEHAVIOR_SOURCE).toContain(`from '${STUDIO_SDK_MODULE_ID}'`);
  expect(semanticDiagnostics(DEFAULT_BEHAVIOR_SOURCE)).toEqual([]);

  const result = await compileExactSource(DEFAULT_BEHAVIOR_SOURCE, 'default-template-contract');
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.entryPath).toBe('/scripts/behavior.ts');
    expect(result.dependencies).toEqual(['/scripts/behavior.ts']);
    expect(result.javascript).toContain('Behavior started');
  }
});

test('the Monaco declaration covers the complete bundled behavior API', async () => {
  expect(STUDIO_SDK_DECLARATION_URI).toContain('/@threejs-studio/sdk/');
  expect(STUDIO_SDK_DECLARATION).toContain(`declare module '${STUDIO_SDK_MODULE_ID}'`);
  expect(STUDIO_SDK_DECLARATION).not.toContain('@threejs-studio/runtime');
  expect(STUDIO_SDK_DECLARATION).toContain('readonly api: BehaviorRuntimeApi');
  expect(STUDIO_SDK_DECLARATION).toContain('onCollisionEnter?:');
  expect(semanticDiagnostics(COLLECT_ESCAPE_BEHAVIOR_SOURCE)).toEqual([]);

  const result = await compileExactSource(COLLECT_ESCAPE_BEHAVIOR_SOURCE, 'collect-template-contract');
  expect(result.ok).toBe(true);
});

test('the declaration and compiler shim expose the same runtime values', () => {
  const exportedRuntimeValues = (source: string) => [...source.matchAll(/export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gu)]
    .map((match) => match[1])
    .sort();
  expect(exportedRuntimeValues(STUDIO_SDK_DECLARATION)).toEqual([
    'BEHAVIOR_API_VERSION',
    'defineBehavior',
  ]);
  expect(exportedRuntimeValues(STUDIO_SDK_RUNTIME_MODULE_SOURCE)).toEqual([
    'BEHAVIOR_API_VERSION',
    'defineBehavior',
  ]);
});

test('Monaco reports zero semantic diagnostics for the exact default behavior', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The Monaco language worker only needs one browser contract pass.');
  await page.goto('/');

  const diagnostics = await page.evaluate(async () => {
    const contractPath = '/src/scripting/studioSdkContract.ts';
    const integrationPath = '/src/components/studio/monacoSdk.ts';
    const integration = await import(integrationPath);
    const { monaco, typescript, disposeSdk } = await integration.loadStudioMonaco();
    const contract = await import(contractPath);
    const uri = monaco.Uri.parse('file:///scripts/default-behavior.ts');
    const model = monaco.editor.createModel(contract.DEFAULT_BEHAVIOR_SOURCE, 'typescript', uri);
    try {
      // Monaco activates language services asynchronously after the first
      // model for a language is created.
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      const getWorker = await typescript.getTypeScriptWorker();
      const worker = await getWorker(uri);
      const [syntactic, semantic] = await Promise.all([
        worker.getSyntacticDiagnostics(uri.toString()),
        worker.getSemanticDiagnostics(uri.toString()),
      ]);
      return [...syntactic, ...semantic].map((diagnostic) => ({
        code: diagnostic.code,
        messageText: String(diagnostic.messageText),
      }));
    } finally {
      model.dispose();
      disposeSdk();
    }
  });

  expect(diagnostics).toEqual([]);
});
