import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import {
  BUILD_PROFILES,
  BuildCancelledError,
  BuildPathError,
  BuildRevisionConflictError,
  BuildValidationError,
  assertProjectBuildRevision,
  buildOfflineZip,
  captureProjectBuildSnapshot,
  normalizeBuildFilename,
  normalizeBuildPath,
  sha256Hex,
  type BuildFileInput,
  type BuildProgress,
  type BuildRequest,
} from '../src/build';
import { createCollectEscapeProject } from '../src/templates/collectEscape';

const runtimeFiles: BuildFileInput[] = [
  {
    path: 'chunks/renderer.js',
    contents: 'export const renderer = "threejs-studio";\n',
  },
  {
    path: 'main.js',
    contents: `import { renderer } from './chunks/renderer.js';
export async function boot(context) {
  globalThis.__TEST_OFFLINE_GAME__ = { renderer, context };
}
`,
  },
];

const scriptFiles: BuildFileInput[] = [
  { path: 'behaviors/player.js', contents: 'export const speed = 4;\n' },
  {
    path: 'game.js',
    contents: `export { speed } from './behaviors/player.js';\n`,
  },
];

const assetFiles: BuildFileInput[] = [
  { path: 'models/ship.glb', contents: new Uint8Array([0x67, 0x6c, 0x54, 0x46]), mediaType: 'model/gltf-binary' },
  { path: 'textures/ui.png', contents: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mediaType: 'image/png' },
];

function request(overrides: Partial<BuildRequest> = {}): BuildRequest {
  return {
    profile: 'production',
    projectName: 'Deterministic Space Game',
    title: 'Space Game <Offline>',
    runtime: { entry: 'main.js', files: runtimeFiles },
    scripts: { entry: 'game.js', files: scriptFiles },
    project: {
      path: 'project.json',
      contents: `${JSON.stringify({ schemaVersion: 4, id: 'offline-test', name: 'Space Game' }, null, 2)}\n`,
    },
    assets: assetFiles,
    ...overrides,
  };
}

test('offline ZIP builds are deterministic, sorted, hashed, CSP-restricted, and self-contained', async () => {
  const progress: BuildProgress[] = [];
  const first = await buildOfflineZip(request({ onProgress: (entry) => progress.push(entry) }));
  const second = await buildOfflineZip(request({
    runtime: { entry: 'main.js', files: [...runtimeFiles].reverse() },
    scripts: { entry: 'game.js', files: [...scriptFiles].reverse() },
    assets: [...assetFiles].reverse(),
  }));

  expect(first.filename).toBe('deterministic-space-game-production.zip');
  expect(first.format).toBe('offline-zip');
  expect(first.archive).toEqual(second.archive);
  expect(first.archiveSha256).toBe(second.archiveSha256);
  expect(first.manifestSha256).toBe(second.manifestSha256);
  expect(first.byteLength).toBe(first.archive.byteLength);
  expect(first.archiveSha256).toBe(await sha256Hex(first.archive));

  const archive = unzipSync(first.archive);
  expect(Object.keys(archive).sort()).toEqual([
    'assets/models/ship.glb',
    'assets/textures/ui.png',
    'bootstrap.js',
    'index.html',
    'manifest.json',
    'project/project.json',
    'runtime/chunks/renderer.js',
    'runtime/main.js',
    'scripts/behaviors/player.js.module-artifact',
    'scripts/game.js.module-artifact',
    'styles.css',
  ]);
  expect([...archive['assets/models/ship.glb']]).toEqual([0x67, 0x6c, 0x54, 0x46]);

  const manifestText = strFromU8(archive['manifest.json']);
  const manifest = JSON.parse(manifestText) as typeof first.manifest;
  expect(manifest).toEqual(first.manifest);
  expect(first.manifestSha256).toBe(await sha256Hex(archive['manifest.json']));
  expect(manifest).toMatchObject({
    format: 'threejs-studio-offline-build',
    formatVersion: 1,
    profile: 'production',
    entrypoint: 'index.html',
    project: 'project/project.json',
    runtimeEntry: 'runtime/main.js',
    scriptEntry: 'scripts/game.js.module-artifact',
    offline: true,
    networkDependencies: [],
    hashAlgorithm: 'SHA-256',
  });
  expect(manifest.profileMetadata.offlineZip).toMatchObject({
    format: 'offline-zip',
    offline: true,
    networkIndependent: true,
    compressionLevel: 9,
  });
  expect(manifest.profileMetadata.legacySingleHtml).toEqual({
    format: 'legacy-single-html',
    availability: 'external-exporter',
    offline: false,
    networkIndependent: false,
    recommended: false,
  });

  const manifestPaths = manifest.files.map((file) => file.path);
  expect(manifestPaths).toEqual([...manifestPaths].sort());
  for (const file of manifest.files) {
    expect(archive[file.path], `${file.path} should be packaged`).toBeTruthy();
    expect(file.bytes).toBe(archive[file.path].byteLength);
    expect(file.sha256).toBe(await sha256Hex(archive[file.path]));
  }

  const index = strFromU8(archive['index.html']);
  const bootstrap = strFromU8(archive['bootstrap.js']);
  expect(index).toContain('Content-Security-Policy');
  expect(index).toContain('script type="module" src="./bootstrap.js"');
  expect(index).toContain('Space Game &lt;Offline&gt;');
  expect(index).not.toContain('unsafe-inline');
  expect(index).toContain("connect-src &#39;none&#39;");
  expect(`${index}\n${bootstrap}`).not.toMatch(/https?:\/\/|cdn\./iu);
  expect(bootstrap).toContain("new URL(paths.runtimeEntryUrl, import.meta.url)");
  expect(bootstrap).toContain('const projectManifest = JSON.parse(');
  expect(bootstrap).not.toContain('scriptEntryUrl');
  expect(bootstrap).not.toContain("import(build.script");
  expect(bootstrap).toContain("runtimeModule.boot ?? runtimeModule.default");

  expect(progress.map((entry) => entry.stage)).toEqual(expect.arrayContaining([
    'validating',
    'assembling',
    'hashing',
    'compressing',
    'complete',
  ]));
  expect(progress.at(-1)).toMatchObject({ stage: 'complete', ratio: 1 });
  for (let index = 1; index < progress.length; index += 1) {
    expect(progress[index].ratio).toBeGreaterThanOrEqual(progress[index - 1].ratio);
  }
});

test('production keeps compiled behaviors inert and excludes raw TypeScript and source maps', async () => {
  const rawSourceMarker = 'RAW_TYPESCRIPT_AUTHORING_SOURCE_DO_NOT_SHIP';
  const topLevelExecutionMarker = '__AUTHORED_TOP_LEVEL_CODE_RAN__';
  const project = {
    schemaVersion: 5,
    id: 'secure-production-project',
    name: 'Secure Production Project',
    assets: [
      {
        kind: 'script',
        id: 'asset.script.player',
        entryPoint: 'scripts/player.ts',
        source: { filename: 'scripts/player.ts', mimeType: 'text/typescript', byteLength: 64 },
      },
      {
        kind: 'data',
        id: 'asset.sources.project',
        value: {
          format: 'threejs-studio.source-catalog.v1',
          files: { 'scripts/player.ts': `const ${rawSourceMarker} = true;` },
        },
      },
      { kind: 'data', id: 'asset.runtime.rules', value: { format: 'threejs-studio.runtime-bindings.v1' } },
    ],
  };
  const built = await buildOfflineZip(request({
    project: { path: 'project.json', contents: JSON.stringify(project) },
    scripts: {
      entry: 'game.js',
      files: [
        { path: 'game.js', contents: `globalThis.${topLevelExecutionMarker} = true;\nexport const ready = true;\n` },
        {
          path: 'game.js.map',
          contents: JSON.stringify({ version: 3, sourcesContent: [`const ${rawSourceMarker} = true;`] }),
        },
      ],
    },
  }));
  const archive = unzipSync(built.archive);
  const paths = Object.keys(archive);
  const projectText = strFromU8(archive['project/project.json']);
  const runtimeProject = JSON.parse(projectText) as typeof project;

  expect(projectText).not.toContain(rawSourceMarker);
  expect(projectText).not.toContain('threejs-studio.source-catalog.v1');
  expect(runtimeProject.assets).toEqual([
    expect.objectContaining({ kind: 'script', id: 'asset.script.player', entryPoint: 'scripts/player.ts' }),
    expect.objectContaining({ kind: 'data', id: 'asset.runtime.rules' }),
  ]);
  expect(paths.some((path) => /\.map(?:\.|$)/iu.test(path))).toBe(false);

  const scriptArtifactPath = 'scripts/game.js.module-artifact';
  expect(strFromU8(archive[scriptArtifactPath])).toContain(topLevelExecutionMarker);
  expect(built.manifest.scriptEntry).toBe(scriptArtifactPath);
  expect(built.manifest.files.find((file) => file.path === scriptArtifactPath)).toMatchObject({
    kind: 'script',
    mediaType: 'application/octet-stream',
  });
  expect(built.manifest.security).toEqual({
    networkPolicy: 'deny',
    authoredScriptExecution: 'disabled-pending-opaque-sandbox',
    projectAuthoringSource: 'omitted',
  });
  expect(built.manifest.contentSecurityPolicy).toContain("connect-src 'none'");

  const executablePaths = paths.filter((path) => /(?:^|\/)[^/]+\.(?:mjs|js)$/iu.test(path));
  expect(executablePaths).toEqual(expect.arrayContaining(['bootstrap.js', 'runtime/main.js']));
  for (const path of executablePaths) {
    const executable = strFromU8(archive[path]);
    expect(executable, `${path} must not embed raw TypeScript`).not.toContain(rawSourceMarker);
    expect(executable, `${path} must not contain authored top-level code`).not.toContain(topLevelExecutionMarker);
    expect(executable, `${path} must not reference the inert behavior artifact`).not.toContain(scriptArtifactPath);
  }
});

test('production bootstrap starts without requesting or executing the authored artifact', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'The production bootstrap security journey runs once.');
  const executionMarker = '__OFFLINE_AUTHORED_MODULE_EXECUTED__';
  const built = await buildOfflineZip(request({
    runtime: {
      entry: 'main.js',
      files: [{
        path: 'main.js',
        contents: 'export function boot(context) { globalThis.__OFFLINE_BOOT_PROJECT__ = context.projectManifest; }\n',
      }],
    },
    scripts: {
      entry: 'game.js',
      files: [{ path: 'game.js', contents: `globalThis.${executionMarker} = true;\nexport default {};\n` }],
    },
  }));
  const archive = unzipSync(built.archive);
  const requestedPaths: string[] = [];
  await page.route('**/offline-security/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const path = pathname.slice(pathname.indexOf('/offline-security/') + '/offline-security/'.length) || 'index.html';
    requestedPaths.push(path);
    const bytes = archive[path];
    if (!bytes) {
      await route.fulfill({ status: 404, body: 'Not found' });
      return;
    }
    const contentType = path.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : path.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : path.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'application/octet-stream';
    await route.fulfill({ status: 200, body: Buffer.from(bytes), contentType });
  });

  await page.goto('http://127.0.0.1:5188/offline-security/index.html');
  await expect.poll(() => page.evaluate(() => Boolean(
    (globalThis as typeof globalThis & { __OFFLINE_BOOT_PROJECT__?: unknown }).__OFFLINE_BOOT_PROJECT__,
  ))).toBe(true);
  const securityState = await page.evaluate((marker) => ({
    authoredTopLevelRan: Boolean((globalThis as typeof globalThis & Record<string, unknown>)[marker]),
    project: (globalThis as typeof globalThis & { __OFFLINE_BOOT_PROJECT__?: unknown }).__OFFLINE_BOOT_PROJECT__,
  }), executionMarker);

  expect(securityState.authoredTopLevelRan).toBe(false);
  expect(securityState.project).toMatchObject({ schemaVersion: 4, id: 'offline-test' });
  expect(requestedPaths).toContain('runtime/main.js');
  expect(requestedPaths).not.toContain('scripts/game.js.module-artifact');
});

test('all profiles advertise offline ZIP and the external legacy single-HTML format explicitly', () => {
  expect(Object.keys(BUILD_PROFILES)).toEqual(['development', 'preview', 'production']);
  expect(BUILD_PROFILES.development.offlineZip).toMatchObject({ compressionLevel: 0, sourceMaps: 'external' });
  expect(BUILD_PROFILES.preview.offlineZip).toMatchObject({ compressionLevel: 6, sourceMaps: 'external' });
  expect(BUILD_PROFILES.production.offlineZip).toMatchObject({ compressionLevel: 9, sourceMaps: 'none' });
  for (const profile of Object.values(BUILD_PROFILES)) {
    expect(profile.offlineZip).toMatchObject({ offline: true, networkIndependent: true });
    expect(profile.legacySingleHtml).toMatchObject({
      availability: 'external-exporter',
      offline: false,
      networkIndependent: false,
    });
  }
});

test('build paths normalize separators but reject traversal, absolute paths, URL ambiguity, and collisions', async () => {
  expect(normalizeBuildPath('./chunks//physics\\rapier.js')).toBe('chunks/physics/rapier.js');
  expect(normalizeBuildFilename('my-game')).toBe('my-game.zip');
  expect(normalizeBuildFilename('my-game.ZIP')).toBe('my-game.ZIP');

  for (const unsafe of [
    '../secret.txt',
    'assets/../../secret.txt',
    '/absolute/main.js',
    'C:\\private\\main.js',
    'https://cdn.example/main.js',
    'assets/%2e%2e/secret.txt',
    'assets/model.glb?download=1',
    'assets/model.glb/',
  ]) {
    expect(() => normalizeBuildPath(unsafe), unsafe).toThrow(BuildPathError);
  }

  await expect(buildOfflineZip(request({
    runtime: {
      entry: 'main.js',
      files: [runtimeFiles[1], { ...runtimeFiles[1], path: './MAIN.js' }],
    },
  }))).rejects.toBeInstanceOf(BuildValidationError);

  await expect(buildOfflineZip(request({
    runtime: { entry: 'missing.js', files: runtimeFiles },
  }))).rejects.toThrow('does not exist in its bundled files');

  await expect(buildOfflineZip(request({
    project: { path: '../project.json', contents: '{}' },
  }))).rejects.toBeInstanceOf(BuildPathError);
});

test('build paths reject Windows device names and ambiguous trailing dots or spaces in every segment', () => {
  for (const unsafe of [
    'CON',
    'con.txt',
    'assets/PRN/model.glb',
    'assets/aux.json',
    'assets/NUL.data',
    'assets/COM1.bin',
    'assets/lpt9/output.txt',
    'assets/trailing./model.glb',
    'assets/trailing /model.glb',
    'archive.zip.',
  ]) {
    expect(() => normalizeBuildPath(unsafe), unsafe).toThrow(BuildPathError);
  }

  expect(normalizeBuildPath('assets/console/model.glb')).toBe('assets/console/model.glb');
  expect(normalizeBuildPath('assets/com10/model.glb')).toBe('assets/com10/model.glb');
  expect(normalizeBuildPath('assets/lpt0/model.glb')).toBe('assets/lpt0/model.glb');
});

test('project build snapshots keep one project revision and reject stale async work', () => {
  const project = createCollectEscapeProject();
  const originalName = project.name;
  const snapshot = captureProjectBuildSnapshot(project, 12);

  project.name = 'Changed after build started';
  expect(snapshot.project).not.toBe(project);
  expect(snapshot.project.name).toBe(originalName);
  expect(snapshot.revision).toBe(12);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.project)).toBe(true);
  expect(Object.isFrozen(snapshot.project.assets)).toBe(true);
  expect(() => assertProjectBuildRevision(snapshot, 12)).not.toThrow();
  expect(() => assertProjectBuildRevision(snapshot, 13)).toThrow(BuildRevisionConflictError);

  try {
    assertProjectBuildRevision(snapshot, 13);
  } catch (error) {
    expect(error).toMatchObject({
      code: 'build_revision_conflict',
      retryable: true,
      buildRevision: 12,
      currentRevision: 13,
    });
  }
});

test('AbortSignal cancels before work and from a progress hook without returning a partial artifact', async () => {
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort('cancel-before-start');
  await expect(buildOfflineZip(request({ signal: alreadyCancelled.signal }))).rejects.toMatchObject({
    name: 'BuildCancelledError',
    code: 'build_cancelled',
    reason: 'cancel-before-start',
  });

  const duringHashing = new AbortController();
  const stages: string[] = [];
  const cancelledBuild = buildOfflineZip(request({
    signal: duringHashing.signal,
    onProgress: (progress) => {
      stages.push(progress.stage);
      if (progress.stage === 'hashing') duringHashing.abort('cancel-during-hash');
    },
  }));
  await expect(cancelledBuild).rejects.toBeInstanceOf(BuildCancelledError);
  expect(stages).toContain('hashing');
  expect(stages).not.toContain('compressing');
  expect(stages).not.toContain('complete');
});
