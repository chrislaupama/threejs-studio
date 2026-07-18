import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { buildOfflineZip } from '../src/build';
import {
  OFFLINE_RUNTIME_ENTRY_PATH,
  OFFLINE_RUNTIME_ENTRY_SOURCE,
  OFFLINE_RUNTIME_RAPIER_PATH,
  OFFLINE_RUNTIME_STYLES_PATH,
  OFFLINE_RUNTIME_STYLES_SOURCE,
  OFFLINE_RUNTIME_THREE_CORE_MIN_PATH,
  OFFLINE_RUNTIME_THREE_PATH,
  createOfflineRuntimeBundle,
} from '../src/build/runtime';
import { createCollectEscapeProject } from '../src/templates/collectEscape';
import { PhysicsWorld, type PhysicsRigidBodyDefinition } from '../src/gameplay/physics';

interface NormalizedRuntimeProject {
  schemaVersion: 5;
  sourceSchemaVersion: 4 | 5;
  startupSceneId: string;
  scene: { id: string; name: string; settings: Record<string, unknown> };
  entities: Array<{ id: string; sceneId: string; name: string; parentId: string | null }>;
  inputMaps: unknown[];
}

interface FixedStepAdvance {
  accumulatorSeconds: number;
  ticks: number;
  droppedTicks: number;
}

interface RuntimeSourceModule {
  FIXED_DELTA_SECONDS: number;
  MAX_CATCH_UP_TICKS: number;
  normalizeProjectManifest(project: unknown): NormalizedRuntimeProject;
  advanceFixedStep(state: { accumulatorSeconds: number }, elapsedSeconds: number): FixedStepAdvance;
  boot(context: { projectManifest: unknown }): Promise<RuntimeController>;
}

interface RuntimeController {
  pause(): void;
  resume(): void;
  step(): boolean;
  restart(): void;
  dispose(): void;
  diagnostics(): {
    state: string;
    simulationTick: number;
    entityCount: number;
    physicsEngine: string | null;
    score: number | null;
    pickupsRemaining: number | null;
    timeRemaining: number | null;
    roundState: string | null;
    playerPosition: [number, number, number] | null;
  };
}

let runtimeImportSequence = 0;

async function importTestableRuntimeSource(
  threeSource = 'const THREE = Object.freeze({});',
  options: { deferredRapier?: boolean } = {},
): Promise<RuntimeSourceModule> {
  let source = OFFLINE_RUNTIME_ENTRY_SOURCE.replace(
    "import * as THREE from './vendor/three.module.js';",
    threeSource,
  );
  if (options.deferredRapier) {
    source = source.replace(
      'const injectedRapier = globalThis.__THREEJS_STUDIO_TEST_RAPIER__;',
      'const injectedRapier = await globalThis.__THREEJS_STUDIO_TEST_RAPIER_PROMISE__;',
    );
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${runtimeImportSequence++}`;
  return import(url) as Promise<RuntimeSourceModule>;
}

const FAKE_THREE_SOURCE = `const THREE = (() => {
  class Vector {
    constructor() { this.x = 0; this.y = 0; this.z = 0; }
    fromArray(value) { [this.x, this.y, this.z] = value; return this; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Object3D {
    constructor() {
      this.children = [];
      this.position = new Vector();
      this.rotation = new Vector();
      this.scale = new Vector().set(1, 1, 1);
      this.userData = {};
      this.visible = true;
    }
    add(child) { this.children.push(child); child.parent = this; }
    traverse(callback) { callback(this); for (const child of this.children) child.traverse(callback); }
  }
  class Scene extends Object3D {}
  class Group extends Object3D {}
  class Geometry { dispose() { this.disposed = true; } }
  class Material { constructor(options) { this.options = options; } dispose() { this.disposed = true; } }
  class Mesh extends Object3D {
    constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; }
  }
  class PerspectiveCamera extends Object3D {
    constructor() { super(); this.isCamera = true; this.isPerspectiveCamera = true; }
    lookAt() {}
    updateProjectionMatrix() {}
  }
  class Light extends Object3D { constructor() { super(); this.isLight = true; } }
  class DirectionalLight extends Light {}
  class PointLight extends Light {}
  class SpotLight extends Light {}
  class HemisphereLight extends Light {}
  class WebGLRenderer {
    constructor() {
      this.shadowMap = {};
      this.domElement = {
        attributes: new Map(),
        setAttribute(key, value) { this.attributes.set(key, value); },
        remove() { this.parentNode?.removeChild(this); },
      };
    }
    setPixelRatio() {}
    setSize() {}
    render() { this.renderCount = (this.renderCount || 0) + 1; }
    dispose() { this.disposed = true; }
    forceContextLoss() { this.contextLost = true; }
  }
  return Object.freeze({
    Scene,
    Group,
    Mesh,
    PerspectiveCamera,
    DirectionalLight,
    PointLight,
    SpotLight,
    HemisphereLight,
    WebGLRenderer,
    BoxGeometry: Geometry,
    SphereGeometry: Geometry,
    CapsuleGeometry: Geometry,
    CylinderGeometry: Geometry,
    ConeGeometry: Geometry,
    PlaneGeometry: Geometry,
    TorusGeometry: Geometry,
    MeshStandardMaterial: Material,
    Color: class Color { constructor(value) { this.value = value; } },
    Fog: class Fog {},
    SRGBColorSpace: 'srgb',
  });
})();`;

class FakeRuntimeElement {
  readonly children: Array<FakeRuntimeElement | Record<string, unknown>> = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Set<(event: { preventDefault(): void }) => void>>();
  parentNode?: FakeRuntimeElement;
  className = '';
  textContent = '';
  hidden = false;
  type = '';
  rel = '';
  href = '';
  max = 0;
  value = 0;
  clientWidth = 800;
  clientHeight = 450;

  constructor(readonly tagName: string) {}

  append(...children: Array<FakeRuntimeElement | Record<string, unknown>>) {
    for (const child of children) {
      (child as { parentNode?: FakeRuntimeElement }).parentNode = this;
      this.children.push(child);
    }
  }

  removeChild(child: FakeRuntimeElement | Record<string, unknown>) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    (child as { parentNode?: FakeRuntimeElement }).parentNode = undefined;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }

  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void) {
    const entries = this.listeners.get(type) ?? new Set();
    entries.add(listener);
    this.listeners.set(type, entries);
  }

  removeEventListener(type: string, listener: (event: { preventDefault(): void }) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault() {} });
  }

  findByAttribute(key: string, value: string): FakeRuntimeElement | undefined {
    if (this.attributes.get(key) === value) return this;
    for (const child of this.children) {
      if (child instanceof FakeRuntimeElement) {
        const match = child.findByAttribute(key, value);
        if (match) return match;
      }
    }
    return undefined;
  }
}

const transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

const settings = {
  background: '#101318',
  fogColor: '#202830',
  fogNear: 4,
  fogFar: 60,
  fogEnabled: true,
  exposure: 1.2,
  shadows: true,
};

test('runtime bundle is self-contained and packages its relative Three.js dependency', async () => {
  const localThreeCoreSource = 'export const REVISION = "offline-test";\n';
  const localThreeSource = 'export { REVISION } from "./three.core.min.js";\n';
  const runtime = createOfflineRuntimeBundle({
    threeModuleSource: localThreeSource,
    threeCoreModuleSource: localThreeCoreSource,
  });

  expect(runtime.entry).toBe(OFFLINE_RUNTIME_ENTRY_PATH);
  expect(runtime.files.map((file) => file.path)).toEqual([
    OFFLINE_RUNTIME_ENTRY_PATH,
    OFFLINE_RUNTIME_THREE_PATH,
    OFFLINE_RUNTIME_STYLES_PATH,
    OFFLINE_RUNTIME_THREE_CORE_MIN_PATH,
  ]);
  expect(OFFLINE_RUNTIME_ENTRY_SOURCE).toContain("from './vendor/three.module.js'");
  expect(OFFLINE_RUNTIME_ENTRY_SOURCE).not.toMatch(/from\s+['"]three['"]/u);
  expect(OFFLINE_RUNTIME_ENTRY_SOURCE).not.toMatch(/https?:\/\/|cdn\./iu);
  expect(OFFLINE_RUNTIME_ENTRY_SOURCE).toContain("import('./vendor/rapier.mjs')");
  expect(OFFLINE_RUNTIME_STYLES_SOURCE).toContain('.studio-runtime-hud');
  expect(OFFLINE_RUNTIME_ENTRY_SOURCE).toContain('export async function boot(context)');
  expect(OFFLINE_RUNTIME_ENTRY_SOURCE).toContain('restart: () => session.restart()');
  expect(OFFLINE_RUNTIME_ENTRY_SOURCE).toContain('dispose: () =>');
  expect(() => createOfflineRuntimeBundle({ threeModuleSource: localThreeSource })).toThrow(/no core module source/u);
  expect(() => createOfflineRuntimeBundle({
    threeModuleSource: 'export * from "https://cdn.example/three.js";',
  })).toThrow(/unsupported dependency/u);

  const built = await buildOfflineZip({
    profile: 'production',
    projectName: 'Runtime bundle proof',
    runtime,
    project: {
      path: 'project.json',
      contents: JSON.stringify({ schemaVersion: 4, id: 'proof', name: 'Proof', nodes: [] }),
    },
  });
  const archive = unzipSync(built.archive);
  expect(strFromU8(archive['runtime/main.js'])).toBe(OFFLINE_RUNTIME_ENTRY_SOURCE);
  expect(strFromU8(archive['runtime/vendor/three.module.js'])).toBe(localThreeSource);
  expect(strFromU8(archive['runtime/vendor/three.core.min.js'])).toBe(localThreeCoreSource);
  expect(strFromU8(archive['runtime/runtime.css'])).toBe(OFFLINE_RUNTIME_STYLES_SOURCE);
  expect(built.manifest.runtimeEntry).toBe('runtime/main.js');
  expect(built.manifest.networkDependencies).toEqual([]);
});

test('runtime adapter packages a supplied self-contained Rapier module', () => {
  const runtime = createOfflineRuntimeBundle({
    threeModuleSource: 'export const REVISION = "offline";',
    rapierModuleSource: 'export async function init() {}\nexport class World {}\n',
  });
  const rapier = runtime.files.find((file) => file.path === OFFLINE_RUNTIME_RAPIER_PATH);
  expect(rapier).toBeDefined();
  expect(typeof rapier?.contents).toBe('string');
  expect(rapier?.contents).toContain('class World');
  expect(OFFLINE_RUNTIME_ENTRY_SOURCE).not.toMatch(/import\(['"]https?:/u);
  expect(() => createOfflineRuntimeBundle({
    threeModuleSource: 'export const REVISION = "offline";',
    rapierModuleSource: 'export * from "https://cdn.example/rapier.mjs";',
  })).toThrow(/Rapier compatibility module must be self-contained/u);
});

test('runtime normalizes v4 projects into an immutable v5-shaped startup scene without changing IDs', async () => {
  const runtime = await importTestableRuntimeSource();
  const v4 = {
    schemaVersion: 4,
    id: 'legacy-project',
    name: 'Legacy Game',
    sceneName: 'Arena',
    settings,
    inputActions: [{ id: 'move', name: 'Move', type: 'axis2d', bindings: [] }],
    nodes: [
      {
        id: 'root',
        name: 'Root',
        kind: 'group',
        parentId: null,
        visible: true,
        transform,
        components: [],
      },
      {
        id: 'player',
        name: 'Player',
        kind: 'mesh',
        parentId: 'root',
        visible: true,
        transform,
        primitive: 'capsule',
        components: [],
      },
    ],
  };

  const normalized = runtime.normalizeProjectManifest(v4);
  expect(normalized).toMatchObject({
    schemaVersion: 5,
    sourceSchemaVersion: 4,
    startupSceneId: 'scene-main',
    scene: { id: 'scene-main', name: 'Arena' },
  });
  expect(normalized.entities.map((entity) => entity.id)).toEqual(['root', 'player']);
  expect(normalized.entities[1]).toMatchObject({ sceneId: 'scene-main', parentId: 'root' });
  expect(normalized.inputMaps).toHaveLength(1);
  expect(Object.isFrozen(normalized)).toBe(true);
  expect(Object.isFrozen(normalized.entities)).toBe(true);
  expect(v4).toEqual(expect.objectContaining({ schemaVersion: 4, nodes: expect.any(Array) }));
});

test('runtime selects only the v5 startup scene and rejects unsafe hierarchy references and cycles', async () => {
  const runtime = await importTestableRuntimeSource();
  const v5 = {
    schemaVersion: 5,
    id: 'v5-project',
    name: 'Two Scenes',
    startupSceneId: 'scene-game',
    scenes: [
      { id: 'scene-menu', name: 'Menu', settings },
      { id: 'scene-game', name: 'Game', settings },
    ],
    entities: [
      { id: 'menu-root', sceneId: 'scene-menu', name: 'Menu', kind: 'group', parentId: null, transform, components: [] },
      { id: 'game-root', sceneId: 'scene-game', name: 'Game', kind: 'group', parentId: null, transform, components: [] },
      { id: 'pickup', sceneId: 'scene-game', name: 'Pickup', kind: 'mesh', parentId: 'game-root', transform, components: [] },
    ],
    inputMaps: [],
  };
  const normalized = runtime.normalizeProjectManifest(v5);
  expect(normalized.sourceSchemaVersion).toBe(5);
  expect(normalized.scene.name).toBe('Game');
  expect(normalized.entities.map((entity) => entity.id)).toEqual(['game-root', 'pickup']);

  expect(() => runtime.normalizeProjectManifest({
    ...v5,
    entities: [{ ...v5.entities[1], parentId: 'missing' }],
  })).toThrow(/missing parent/u);
  expect(() => runtime.normalizeProjectManifest({
    ...v5,
    entities: [
      { ...v5.entities[1], parentId: 'pickup' },
      { ...v5.entities[2], parentId: 'game-root' },
    ],
  })).toThrow(/cycle/u);
  expect(() => runtime.normalizeProjectManifest({ ...v5, startupSceneId: 'missing' })).toThrow(/startup scene/u);
});

test('fixed scheduler is deterministic across frame rates and caps spike catch-up at five ticks', async () => {
  const runtime = await importTestableRuntimeSource();

  const simulate = (frames: number, frameDelta: number) => {
    let state: FixedStepAdvance = { accumulatorSeconds: 0, ticks: 0, droppedTicks: 0 };
    let totalTicks = 0;
    let totalDropped = 0;
    for (let index = 0; index < frames; index += 1) {
      state = runtime.advanceFixedStep(state, frameDelta);
      totalTicks += state.ticks;
      totalDropped += state.droppedTicks;
    }
    return { state, totalTicks, totalDropped };
  };

  expect(runtime.FIXED_DELTA_SECONDS).toBeCloseTo(1 / 60, 12);
  expect(runtime.MAX_CATCH_UP_TICKS).toBe(5);
  expect(simulate(30, 1 / 30)).toMatchObject({ totalTicks: 60, totalDropped: 0 });
  expect(simulate(60, 1 / 60)).toMatchObject({ totalTicks: 60, totalDropped: 0 });
  expect(simulate(144, 1 / 144)).toMatchObject({ totalTicks: 60, totalDropped: 0 });

  const spike = runtime.advanceFixedStep({ accumulatorSeconds: 0 }, 1);
  expect(spike.ticks).toBe(5);
  expect(spike.droppedTicks).toBe(55);
  expect(spike.accumulatorSeconds).toBeLessThan(runtime.FIXED_DELTA_SECONDS);
});

test('boot renders primitive entities and restart/dispose release runtime-owned resources', async () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const frames = new Map<number, (now: number) => void>();
  let nextFrame = 1;
  const host = {
    clientWidth: 800,
    clientHeight: 450,
    children: [] as Array<{ parentNode?: unknown }>,
    attributes: new Map<string, string>(),
    append(child: { parentNode?: unknown }) {
      child.parentNode = this;
      this.children.push(child);
    },
    removeChild(child: { parentNode?: unknown }) {
      this.children = this.children.filter((entry) => entry !== child);
      child.parentNode = undefined;
    },
    setAttribute(key: string, value: string) {
      this.attributes.set(key, value);
    },
  };
  const runtimeWindow = {
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 450,
    addEventListener(type: string, listener: (...args: unknown[]) => void) {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type: string, listener: (...args: unknown[]) => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const project = {
    schemaVersion: 4,
    id: 'lifecycle-project',
    name: 'Lifecycle Game',
    settings,
    inputActions: [],
    nodes: [
      { id: 'root', name: 'Root', kind: 'group', parentId: null, visible: true, transform, components: [] },
      { id: 'cube', name: 'Cube', kind: 'mesh', primitive: 'box', parentId: 'root', visible: true, transform, components: [] },
      { id: 'camera', name: 'Camera', kind: 'camera', parentId: null, visible: true, transform, camera: { primary: true }, components: [] },
      { id: 'light', name: 'Light', kind: 'light', parentId: null, visible: true, transform, light: { type: 'directional' }, components: [] },
    ],
  };

  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const replacements: Record<string, unknown> = {
    window: runtimeWindow,
    document: { getElementById: (id: string) => id === 'threejs-studio-game' ? host : null },
    requestAnimationFrame: (callback: (now: number) => void) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globals, key, { value, configurable: true, writable: true });
  }

  try {
    const runtime = await importTestableRuntimeSource(FAKE_THREE_SOURCE);
    const controller = await runtime.boot({ projectManifest: project });
    expect(host.children).toHaveLength(1);
    expect(host.attributes.get('data-runtime-state')).toBe('playing');
    expect(controller.diagnostics()).toMatchObject({ state: 'playing', simulationTick: 0, entityCount: 4 });

    controller.pause();
    expect(controller.step()).toBe(true);
    expect(controller.diagnostics()).toMatchObject({ state: 'paused', simulationTick: 1 });
    controller.restart();
    expect(host.children).toHaveLength(1);
    expect(controller.diagnostics()).toMatchObject({ state: 'paused', simulationTick: 0, entityCount: 4 });

    controller.dispose();
    expect(host.children).toHaveLength(0);
    expect(host.attributes.get('data-runtime-state')).toBe('disposed');
    expect(controller.diagnostics().state).toBe('disposed');
    expect([...listeners.values()].every((entries) => entries.size === 0)).toBe(true);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globals[key];
    }
  }
});

test('concurrent boots cancel pending initialization and retain exactly one disposable session', async () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const frames = new Map<number, (now: number) => void>();
  const host = new FakeRuntimeElement('main');
  const head = new FakeRuntimeElement('head');
  let nextFrame = 1;
  const runtimeWindow = {
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 450,
    addEventListener(type: string, listener: (...args: unknown[]) => void) {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type: string, listener: (...args: unknown[]) => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const project = createCollectEscapeProject();
  const rapier = await import('@dimforge/rapier3d-compat');
  await rapier.init();
  let releaseRapier!: (value: typeof rapier) => void;
  const deferredRapier = new Promise<typeof rapier>((resolve) => { releaseRapier = resolve; });
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const replacements: Record<string, unknown> = {
    window: runtimeWindow,
    document: {
      head,
      createElement: (tagName: string) => new FakeRuntimeElement(tagName),
      getElementById: (id: string) => id === 'threejs-studio-game' ? host : null,
    },
    navigator: { maxTouchPoints: 0, getGamepads: () => [] },
    requestAnimationFrame: (callback: (now: number) => void) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    __THREEJS_STUDIO_TEST_RAPIER_PROMISE__: deferredRapier,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globals, key, { value, configurable: true, writable: true });
  }

  let secondController: RuntimeController | null = null;
  let latestController: RuntimeController | null = null;
  try {
    const runtime = await importTestableRuntimeSource(FAKE_THREE_SOURCE, { deferredRapier: true });
    const firstBoot = runtime.boot({ projectManifest: project });
    const firstOutcome = firstBoot.then(
      () => ({ status: 'fulfilled' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    expect(host.children).toHaveLength(1);
    expect(host.attributes.get('data-runtime-state')).toBe('initializing');

    const secondBoot = runtime.boot({ projectManifest: project });
    expect(host.children).toHaveLength(1);
    expect(host.attributes.get('data-runtime-state')).toBe('initializing');
    expect([...listeners.values()].every((entries) => entries.size === 0)).toBe(true);
    expect(frames.size).toBe(0);

    releaseRapier(rapier);
    const [firstResult, activeController] = await Promise.all([firstOutcome, secondBoot]);
    secondController = activeController;
    expect(firstResult).toMatchObject({
      status: 'rejected',
      error: { name: 'AbortError', code: 'ERR_RUNTIME_BOOT_SUPERSEDED' },
    });
    expect(activeController.diagnostics().state).toBe('playing');
    expect(host.children).toHaveLength(2);
    expect(frames.size).toBe(1);
    expect([...listeners.values()].map((entries) => entries.size)).toEqual([1, 1, 1, 1]);

    latestController = await runtime.boot({ projectManifest: project });
    expect(secondController.diagnostics().state).toBe('disposed');
    expect(latestController.diagnostics().state).toBe('playing');
    expect(host.children).toHaveLength(2);
    expect(frames.size).toBe(1);
    expect([...listeners.values()].map((entries) => entries.size)).toEqual([1, 1, 1, 1]);

    // A stale controller must not clear or tear down the newer active session.
    secondController.dispose();
    expect(latestController.diagnostics().state).toBe('playing');
    expect(host.children).toHaveLength(2);
    expect(frames.size).toBe(1);

    latestController.dispose();
    expect(host.children).toHaveLength(0);
    expect(frames.size).toBe(0);
    expect([...listeners.values()].every((entries) => entries.size === 0)).toBe(true);
  } finally {
    latestController?.dispose();
    secondController?.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globals[key];
    }
  }
});

test('Collect & Escape executes offline with Rapier, keyboard/gamepad input, HUD, win/fail, restart, and cleanup', async () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const frames = new Map<number, (now: number) => void>();
  const host = new FakeRuntimeElement('main');
  const head = new FakeRuntimeElement('head');
  let nextFrame = 1;
  const gamepads: Array<{ axes: number[]; buttons: Array<{ value: number }> } | null> = [{
    axes: [0, 0],
    buttons: Array.from({ length: 10 }, () => ({ value: 0 })),
  }];
  const runtimeWindow = {
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 450,
    addEventListener(type: string, listener: (...args: unknown[]) => void) {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type: string, listener: (...args: unknown[]) => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const project = createCollectEscapeProject();
  const runtimeAsset = project.assets.find((asset) => asset.kind === 'data' &&
    typeof asset.value === 'object' && asset.value !== null && !Array.isArray(asset.value) &&
    asset.value.format === 'threejs-studio.runtime-bindings.v1');
  expect(runtimeAsset?.kind).toBe('data');
  if (!runtimeAsset || runtimeAsset.kind !== 'data' || typeof runtimeAsset.value !== 'object' || runtimeAsset.value === null || Array.isArray(runtimeAsset.value)) {
    throw new Error('Collect & Escape runtime bindings missing.');
  }
  const bindings = runtimeAsset.value as unknown as {
    rules: { roundSeconds: number };
    physics: { bodies: Array<{ id: string; position?: [number, number, number] }> };
    componentBindings: Array<{ type: string; properties?: { moveSpeed?: number } }>;
  };
  bindings.rules.roundSeconds = 2;
  for (const body of bindings.physics.bodies) {
    if (body.id.startsWith('physics.pickup.') || body.id === 'physics.exit') body.position = [0, 0.8, 5];
  }
  const scriptBinding = bindings.componentBindings.find((binding) => binding.type === 'scriptBehavior');
  if (scriptBinding?.properties) scriptBinding.properties.moveSpeed = 10;

  const sharedPhysicsProbe = new PhysicsWorld({
    bodies: bindings.physics.bodies as unknown as PhysicsRigidBodyDefinition[],
  });
  await sharedPhysicsProbe.initialize();
  sharedPhysicsProbe.step(1 / 60);
  sharedPhysicsProbe.dispose();
  const rapier = await import('@dimforge/rapier3d-compat');
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const replacements: Record<string, unknown> = {
    window: runtimeWindow,
    document: {
      head,
      createElement: (tagName: string) => new FakeRuntimeElement(tagName),
      getElementById: (id: string) => id === 'threejs-studio-game' ? host : null,
    },
    navigator: { maxTouchPoints: 1, getGamepads: () => gamepads },
    requestAnimationFrame: (callback: (now: number) => void) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    __THREEJS_STUDIO_TEST_RAPIER__: rapier,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globals, key, { value, configurable: true, writable: true });
  }

  try {
    const runtime = await importTestableRuntimeSource(FAKE_THREE_SOURCE);
    const normalized = runtime.normalizeProjectManifest(project) as NormalizedRuntimeProject & {
      runtimeBindings: { format: string };
      runtimeUI: { schemaVersion: number };
    };
    expect(normalized.runtimeBindings.format).toBe('threejs-studio.runtime-bindings.v1');
    expect(normalized.runtimeUI.schemaVersion).toBe(1);

    const controller = await runtime.boot({ projectManifest: project });
    controller.pause();
    expect(host.children).toHaveLength(2);
    expect(host.findByAttribute('aria-label', 'Collect and Escape heads-up display')).toBeDefined();
    expect(controller.diagnostics()).toMatchObject({
      physicsEngine: 'rapier',
      score: 0,
      pickupsRemaining: 5,
      roundState: 'playing',
    });

    const keydown = [...(listeners.get('keydown') ?? [])][0];
    const keyup = [...(listeners.get('keyup') ?? [])][0];
    expect(keydown).toBeDefined();
    keydown?.({ code: 'KeyW', preventDefault() {} });
    for (let index = 0; index < 12; index += 1) expect(controller.step()).toBe(true);
    keyup?.({ code: 'KeyW', preventDefault() {} });
    expect(controller.diagnostics().playerPosition?.[2]).toBeLessThan(5.9);
    expect(controller.diagnostics()).toMatchObject({
      score: 5,
      pickupsRemaining: 0,
      roundState: 'won',
    });
    expect(host.findByAttribute('aria-label', 'Restart Collect and Escape')?.hidden).toBe(false);

    controller.restart();
    const touchForward = host.findByAttribute('aria-label', 'Move forward');
    expect(touchForward).toBeDefined();
    touchForward?.dispatch('pointerdown');
    for (let index = 0; index < 4; index += 1) controller.step();
    touchForward?.dispatch('pointerup');
    expect(controller.diagnostics().playerPosition?.[2]).toBeLessThan(6);

    controller.restart();
    gamepads[0]!.axes[1] = -1;
    for (let index = 0; index < 4; index += 1) controller.step();
    expect(controller.diagnostics().playerPosition?.[2]).toBeLessThan(6);
    gamepads[0]!.axes[1] = 0;

    controller.restart();
    for (let index = 0; index < 125; index += 1) controller.step();
    expect(controller.diagnostics()).toMatchObject({ score: 0, roundState: 'failed' });
    expect(host.findByAttribute('aria-label', 'Restart Collect and Escape')?.hidden).toBe(false);

    controller.restart();
    expect(controller.diagnostics()).toMatchObject({ score: 0, pickupsRemaining: 5, roundState: 'playing' });
    expect(host.findByAttribute('aria-label', 'Restart Collect and Escape')?.hidden).toBe(true);

    controller.dispose();
    expect(host.children).toHaveLength(0);
    expect([...listeners.values()].every((entries) => entries.size === 0)).toBe(true);
    expect([...(touchForward?.listeners.values() ?? [])].every((entries) => entries.size === 0)).toBe(true);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globals[key];
    }
  }
});
