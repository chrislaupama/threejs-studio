/** CSP-compatible styles loaded as a local sibling by physics-enabled builds. */
export const OFFLINE_RUNTIME_STYLES_SOURCE = String.raw`
#threejs-studio-game{position:relative;background:#050914;color:#f8fafc}
.studio-runtime-hud{position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:space-between;gap:1rem;padding:max(1rem,env(safe-area-inset-top)) max(1rem,env(safe-area-inset-right)) max(1rem,env(safe-area-inset-bottom)) max(1rem,env(safe-area-inset-left));pointer-events:none;font-family:system-ui,sans-serif}
.studio-runtime-hud__top{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.75rem;border:1px solid rgba(103,232,249,.55);border-radius:.75rem;background:rgba(9,14,25,.82);box-shadow:0 12px 32px rgba(0,0,0,.35);pointer-events:auto}
.studio-runtime-hud__score{margin:0;font-size:1rem;letter-spacing:.04em}
.studio-runtime-hud__timer{display:flex;align-items:center;gap:.5rem;min-width:14rem}.studio-runtime-hud__timer progress{width:10rem;accent-color:#67e8f9}
.studio-runtime-hud__status{align-self:center;max-width:38rem;padding:.75rem;border:1px solid #22d3ee;border-radius:.75rem;background:rgba(9,14,25,.88);text-align:center;pointer-events:auto}.studio-runtime-hud__status p{margin:0}.studio-runtime-hud__restart{min-width:11rem;min-height:44px;margin-top:.65rem;padding:.75rem;border:0;border-radius:.5rem;color:#082f49;background:#67e8f9;font:inherit;font-weight:750;cursor:pointer}.studio-runtime-hud__restart[hidden]{display:none}
.studio-runtime-hud__bottom{display:flex;align-items:end;justify-content:space-between;gap:1rem}.studio-runtime-hud__hint{padding:.55rem .7rem;border-radius:.5rem;background:rgba(9,14,25,.78)}.studio-runtime-hud__touch{display:none;grid-template-columns:repeat(3,56px);gap:.4rem;pointer-events:auto}.studio-runtime-hud__touch button{width:56px;height:56px;border:1px solid rgba(103,232,249,.65);border-radius:.75rem;color:#f8fafc;background:rgba(15,23,42,.92);font:700 1.4rem system-ui;touch-action:none}.studio-runtime-hud__touch button[data-direction="up"]{grid-column:2}.studio-runtime-hud__touch button[data-direction="left"]{grid-column:1}.studio-runtime-hud__touch button[data-direction="down"]{grid-column:2}.studio-runtime-hud__touch button[data-direction="right"]{grid-column:3}.studio-runtime-hud[data-touch="true"] .studio-runtime-hud__touch{display:grid}
@media(max-width:767px){.studio-runtime-hud{padding:.6rem}.studio-runtime-hud__top{align-items:stretch;flex-direction:column;font-size:.875rem}.studio-runtime-hud__timer{min-width:0}.studio-runtime-hud__timer progress{flex:1;width:auto}.studio-runtime-hud__hint{display:none}}
@media(prefers-reduced-motion:reduce){.studio-runtime-hud *{scroll-behavior:auto!important}}
`;

/**
 * Browser module packaged as runtime/main.js by createOfflineRuntimeBundle.
 *
 * This source deliberately imports only a sibling module that is copied into
 * the ZIP. Project data enters through JSON and runtime diagnostics leave as
 * plain serializable values; editor state and browser handles are never part of
 * the authoring contract.
 */
export const OFFLINE_RUNTIME_ENTRY_SOURCE = String.raw`import * as THREE from './vendor/three.module.js';

export const OFFLINE_RUNTIME_VERSION = '1.1.0';
export const FIXED_DELTA_SECONDS = 1 / 60;
export const MAX_CATCH_UP_TICKS = 5;

const DEFAULT_SETTINGS = Object.freeze({
  background: '#090d12',
  fogColor: '#090d12',
  fogNear: 12,
  fogFar: 80,
  fogEnabled: false,
  exposure: 1,
  shadows: true,
});

const AXIS_INDEX = Object.freeze({ x: 0, y: 1, z: 2 });
let activeSession = null;
let pendingSession = null;
let bootGeneration = 0;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function string(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function vec3(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return [finite(value[0], fallback[0]), finite(value[1], fallback[1]), finite(value[2], fallback[2])];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function normalizeSettings(settings) {
  const source = isRecord(settings) ? settings : {};
  return {
    background: string(source.background, DEFAULT_SETTINGS.background),
    fogColor: string(source.fogColor, DEFAULT_SETTINGS.fogColor),
    fogNear: Math.max(0, finite(source.fogNear, DEFAULT_SETTINGS.fogNear)),
    fogFar: Math.max(0.001, finite(source.fogFar, DEFAULT_SETTINGS.fogFar)),
    fogEnabled: typeof source.fogEnabled === 'boolean' ? source.fogEnabled : DEFAULT_SETTINGS.fogEnabled,
    exposure: Math.max(0, finite(source.exposure, DEFAULT_SETTINGS.exposure)),
    shadows: typeof source.shadows === 'boolean' ? source.shadows : DEFAULT_SETTINGS.shadows,
  };
}

function normalizeTransform(transform) {
  const source = isRecord(transform) ? transform : {};
  return {
    position: vec3(source.position, [0, 0, 0]),
    rotation: vec3(source.rotation, [0, 0, 0]),
    scale: vec3(source.scale, [1, 1, 1]),
  };
}

function normalizeEntity(entity, sceneId) {
  if (!isRecord(entity) || typeof entity.id !== 'string' || entity.id.length === 0) {
    throw new TypeError('Every runtime entity must have a stable non-empty id.');
  }
  const components = Array.isArray(entity.components)
    ? entity.components.filter(isRecord).map(cloneJson)
    : [];
  return {
    id: entity.id,
    sceneId,
    name: string(entity.name, entity.id),
    kind: string(entity.kind, 'group'),
    parentId: typeof entity.parentId === 'string' ? entity.parentId : null,
    active: entity.active !== false,
    visible: entity.visible !== false,
    transform: normalizeTransform(entity.transform),
    primitive: typeof entity.primitive === 'string' ? entity.primitive : undefined,
    material: isRecord(entity.material) ? cloneJson(entity.material) : undefined,
    light: isRecord(entity.light) ? cloneJson(entity.light) : undefined,
    camera: isRecord(entity.camera) ? cloneJson(entity.camera) : undefined,
    components,
    castShadow: entity.castShadow === true,
    receiveShadow: entity.receiveShadow === true,
  };
}

function normalizeV4Project(project) {
  if (!Array.isArray(project.nodes)) throw new TypeError('A schema-v4 project must contain nodes.');
  const sceneId = 'scene-main';
  const entities = project.nodes.map((node) => normalizeEntity(node, sceneId));
  return {
    schemaVersion: 5,
    sourceSchemaVersion: 4,
    id: string(project.id, 'project'),
    name: string(project.name, 'Untitled Game'),
    startupSceneId: sceneId,
    scene: {
      id: sceneId,
      name: string(project.sceneName, 'Main Scene'),
      settings: normalizeSettings(project.settings),
    },
    entities,
    inputMaps: [{
      id: 'input.migrated',
      name: 'Migrated input',
      enabled: true,
      priority: 0,
      actions: Array.isArray(project.inputActions) ? project.inputActions.filter(isRecord).map(cloneJson) : [],
    }],
    runtimeBindings: null,
    runtimeUI: null,
  };
}

function normalizeRuntimeBindings(value) {
  if (!isRecord(value) || value.format !== 'threejs-studio.runtime-bindings.v1') return null;
  if (value.schemaVersion !== 1 || !isRecord(value.physics) || !Array.isArray(value.physics.bodies)) {
    throw new TypeError('Runtime bindings v1 must contain schemaVersion 1 and a physics body list.');
  }
  if (!isRecord(value.input) || !Array.isArray(value.input.actions) || !isRecord(value.rules)) {
    throw new TypeError('Runtime bindings v1 must contain input actions and game rules.');
  }
  const fixedDelta = finite(value.fixedDeltaSeconds, FIXED_DELTA_SECONDS);
  if (Math.abs(fixedDelta - FIXED_DELTA_SECONDS) > 1e-9) {
    throw new TypeError('Runtime bindings v1 must use the shared 60 Hz fixed delta.');
  }
  return cloneJson(value);
}

function normalizeV5Project(project) {
  if (!Array.isArray(project.scenes) || !Array.isArray(project.entities)) {
    throw new TypeError('A schema-v5 project must contain scenes and entities.');
  }
  const startupSceneId = string(project.startupSceneId, '');
  const scene = project.scenes.find((entry) => isRecord(entry) && entry.id === startupSceneId);
  if (!isRecord(scene)) throw new TypeError('The startup scene does not exist.');
  const entities = project.entities
    .filter((entity) => isRecord(entity) && entity.sceneId === startupSceneId)
    .map((entity) => normalizeEntity(entity, startupSceneId));
  const assets = Array.isArray(project.assets) ? project.assets.filter(isRecord) : [];
  let runtimeBindings = null;
  let runtimeUI = null;
  for (const asset of assets) {
    if (asset.kind !== 'data') continue;
    const candidate = normalizeRuntimeBindings(asset.value);
    if (!candidate) continue;
    if (runtimeBindings) throw new TypeError('A project can contain only one active runtime-bindings.v1 data asset.');
    runtimeBindings = candidate;
    const uiBinding = Array.isArray(candidate.componentBindings)
      ? candidate.componentBindings.find((binding) => isRecord(binding) && binding.type === 'runtimeUI')
      : null;
    if (uiBinding && typeof uiBinding.assetId === 'string') {
      const uiAsset = assets.find((entry) => entry.kind === 'data' && entry.id === uiBinding.assetId);
      if (uiAsset && isRecord(uiAsset.value)) runtimeUI = cloneJson(uiAsset.value);
    }
  }
  return {
    schemaVersion: 5,
    sourceSchemaVersion: 5,
    id: string(project.id, 'project'),
    name: string(project.name, 'Untitled Game'),
    startupSceneId,
    scene: {
      id: startupSceneId,
      name: string(scene.name, 'Main Scene'),
      settings: normalizeSettings(scene.settings),
    },
    entities,
    inputMaps: Array.isArray(project.inputMaps) ? project.inputMaps.filter(isRecord).map(cloneJson) : [],
    runtimeBindings,
    runtimeUI,
  };
}

export function normalizeProjectManifest(project) {
  if (!isRecord(project)) throw new TypeError('The project manifest must be a JSON object.');
  const normalized = project.schemaVersion === 5
    ? normalizeV5Project(project)
    : project.schemaVersion === 4
      ? normalizeV4Project(project)
      : null;
  if (!normalized) throw new TypeError('Only schema-v4 and schema-v5 projects are supported.');
  const ids = new Set();
  for (const entity of normalized.entities) {
    if (ids.has(entity.id)) throw new TypeError('Duplicate runtime entity id: ' + entity.id);
    ids.add(entity.id);
  }
  for (const entity of normalized.entities) {
    if (entity.parentId !== null && !ids.has(entity.parentId)) {
      throw new TypeError('Entity ' + entity.id + ' references a missing parent ' + entity.parentId + '.');
    }
  }
  const entitiesById = new Map(normalized.entities.map((entity) => [entity.id, entity]));
  for (const entity of normalized.entities) {
    const ancestors = new Set([entity.id]);
    let parentId = entity.parentId;
    while (parentId !== null) {
      if (ancestors.has(parentId)) throw new TypeError('Entity hierarchy contains a cycle at ' + parentId + '.');
      ancestors.add(parentId);
      parentId = entitiesById.get(parentId).parentId;
    }
  }
  return deepFreeze(normalized);
}

export function advanceFixedStep(state, elapsedSeconds) {
  const previous = isRecord(state) ? state : {};
  const priorAccumulator = Math.max(0, finite(previous.accumulatorSeconds, 0));
  const elapsed = Math.max(0, finite(elapsedSeconds, 0));
  const total = priorAccumulator + elapsed;
  const availableTicks = Math.floor((total + 1e-9) / FIXED_DELTA_SECONDS);
  const ticks = Math.min(MAX_CATCH_UP_TICKS, availableTicks);
  const droppedTicks = Math.max(0, availableTicks - ticks);
  const remainder = droppedTicks > 0
    ? total - availableTicks * FIXED_DELTA_SECONDS
    : total - ticks * FIXED_DELTA_SECONDS;
  return Object.freeze({
    accumulatorSeconds: Math.max(0, Math.min(FIXED_DELTA_SECONDS, remainder)),
    ticks,
    droppedTicks,
  });
}

function geometryFor(primitive) {
  switch (primitive) {
    case 'sphere': return new THREE.SphereGeometry(0.5, 32, 16);
    case 'capsule': return new THREE.CapsuleGeometry(0.35, 0.7, 8, 16);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    case 'cone': return new THREE.ConeGeometry(0.5, 1, 24);
    case 'plane': return new THREE.PlaneGeometry(1, 1);
    case 'torus': return new THREE.TorusGeometry(0.4, 0.15, 12, 32);
    case 'box':
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

function materialFor(material) {
  const source = isRecord(material) ? material : {};
  return new THREE.MeshStandardMaterial({
    color: string(source.color, '#8fa7bb'),
    emissive: string(source.emissive, '#000000'),
    emissiveIntensity: Math.max(0, finite(source.emissiveIntensity, 0)),
    metalness: Math.min(1, Math.max(0, finite(source.metalness, 0.1))),
    roughness: Math.min(1, Math.max(0, finite(source.roughness, 0.7))),
  });
}

function disposeObjectResources(object) {
  if (!object) return;
  if (object.geometry && typeof object.geometry.dispose === 'function') {
    try { object.geometry.dispose(); } catch {}
  }
  const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
  for (const material of materials) {
    if (typeof material.dispose !== 'function') continue;
    try { material.dispose(); } catch {}
  }
}

function createObject(entity) {
  let object;
  if (entity.kind === 'mesh') {
    const geometry = geometryFor(entity.primitive);
    let material = null;
    try {
      material = materialFor(entity.material);
      object = new THREE.Mesh(geometry, material);
      object.castShadow = entity.castShadow;
      object.receiveShadow = entity.receiveShadow;
    } catch (error) {
      try { geometry.dispose?.(); } catch {}
      try { material?.dispose?.(); } catch {}
      throw error;
    }
  } else if (entity.kind === 'camera') {
    const camera = isRecord(entity.camera) ? entity.camera : {};
    object = new THREE.PerspectiveCamera(
      Math.min(179, Math.max(1, finite(camera.fov, 50))),
      1,
      Math.max(0.001, finite(camera.near, 0.1)),
      Math.max(0.01, finite(camera.far, 1000)),
    );
  } else if (entity.kind === 'light') {
    const light = isRecord(entity.light) ? entity.light : {};
    const color = string(light.color, '#ffffff');
    const intensity = Math.max(0, finite(light.intensity, 1));
    if (light.type === 'point') {
      object = new THREE.PointLight(color, intensity, Math.max(0, finite(light.distance, 0)));
    } else if (light.type === 'spot') {
      object = new THREE.SpotLight(color, intensity, Math.max(0, finite(light.distance, 0)));
    } else {
      object = new THREE.DirectionalLight(color, intensity);
    }
    object.castShadow = light.castShadow === true;
  } else {
    object = new THREE.Group();
  }
  try {
    object.name = entity.name;
    object.visible = entity.active && entity.visible;
    object.position.fromArray(entity.transform.position);
    object.rotation.fromArray(entity.transform.rotation, 'XYZ');
    object.scale.fromArray(entity.transform.scale);
    object.userData.runtimeEntityId = entity.id;
    return object;
  } catch (error) {
    disposeObjectResources(object);
    throw error;
  }
}

function collectKeyboardBindings(inputMaps) {
  const bindings = new Map();
  for (const inputMap of inputMaps) {
    if (!isRecord(inputMap) || inputMap.enabled === false || !Array.isArray(inputMap.actions)) continue;
    for (const action of inputMap.actions) {
      if (!isRecord(action) || typeof action.id !== 'string' || !Array.isArray(action.bindings)) continue;
      const keyboard = action.bindings.filter((binding) => isRecord(binding) &&
        (binding.device === undefined || binding.device === 'keyboard') && typeof binding.code === 'string');
      bindings.set(action.id, keyboard);
    }
  }
  return bindings;
}

function runtimeInputActions(project) {
  const actions = project.runtimeBindings && project.runtimeBindings.input && Array.isArray(project.runtimeBindings.input.actions)
    ? project.runtimeBindings.input.actions
    : [];
  return actions.filter((action) => isRecord(action) && typeof action.id === 'string');
}

function physicsBodyEntityMap(bindings) {
  const result = new Map();
  for (const binding of Array.isArray(bindings.componentBindings) ? bindings.componentBindings : []) {
    if (!isRecord(binding) || binding.type !== 'physicsBody') continue;
    if (typeof binding.definitionId === 'string' && typeof binding.entityId === 'string') {
      result.set(binding.definitionId, binding.entityId);
    }
  }
  return result;
}

function packCollisionGroups(groups) {
  if (!isRecord(groups)) return null;
  const memberships = Number.isInteger(groups.memberships) ? groups.memberships & 0xffff : 0xffff;
  const filter = Number.isInteger(groups.filter) ? groups.filter & 0xffff : 0xffff;
  return ((memberships << 16) | filter) >>> 0;
}

function createBodyDescriptor(rapier, definition) {
  let descriptor;
  if (definition.type === 'fixed') descriptor = rapier.RigidBodyDesc.fixed();
  else if (definition.type === 'kinematicPosition') descriptor = rapier.RigidBodyDesc.kinematicPositionBased();
  else if (definition.type === 'kinematicVelocity') descriptor = rapier.RigidBodyDesc.kinematicVelocityBased();
  else descriptor = rapier.RigidBodyDesc.dynamic();
  const position = vec3(definition.position, [0, 0, 0]);
  descriptor.setTranslation(position[0], position[1], position[2]);
  descriptor.setEnabled(definition.enabled !== false);
  descriptor.setGravityScale(finite(definition.gravityScale, 1));
  descriptor.setLinearDamping(Math.max(0, finite(definition.linearDamping, 0)));
  descriptor.setAngularDamping(Math.max(0, finite(definition.angularDamping, 0)));
  descriptor.setCanSleep(definition.canSleep !== false);
  descriptor.setCcdEnabled(definition.ccd === true);
  if (Array.isArray(definition.linearVelocity)) descriptor.setLinvel(...vec3(definition.linearVelocity, [0, 0, 0]));
  if (Array.isArray(definition.angularVelocity)) {
    const velocity = vec3(definition.angularVelocity, [0, 0, 0]);
    descriptor.setAngvel({ x: velocity[0], y: velocity[1], z: velocity[2] });
  }
  return descriptor;
}

function createColliderDescriptor(rapier, definition) {
  const shape = isRecord(definition.shape) ? definition.shape : {};
  let descriptor;
  if (shape.type === 'sphere') descriptor = rapier.ColliderDesc.ball(Math.max(0.001, finite(shape.radius, 0.5)));
  else if (shape.type === 'capsule') descriptor = rapier.ColliderDesc.capsule(Math.max(0.001, finite(shape.halfHeight, 0.5)), Math.max(0.001, finite(shape.radius, 0.35)));
  else if (shape.type === 'cylinder') descriptor = rapier.ColliderDesc.cylinder(Math.max(0.001, finite(shape.halfHeight, 0.5)), Math.max(0.001, finite(shape.radius, 0.5)));
  else if (shape.type === 'cone') descriptor = rapier.ColliderDesc.cone(Math.max(0.001, finite(shape.halfHeight, 0.5)), Math.max(0.001, finite(shape.radius, 0.5)));
  else {
    const halfExtents = vec3(shape.halfExtents, [0.5, 0.5, 0.5]).map((entry) => Math.max(0.001, entry));
    descriptor = rapier.ColliderDesc.cuboid(...halfExtents);
  }
  const position = vec3(definition.position, [0, 0, 0]);
  descriptor.setTranslation(position[0], position[1], position[2]);
  descriptor.setSensor(definition.sensor === true);
  if (rapier.ActiveCollisionTypes) {
    descriptor.setActiveCollisionTypes(rapier.ActiveCollisionTypes.ALL);
  }
  descriptor.setFriction(Math.max(0, finite(definition.friction, 0.5)));
  descriptor.setRestitution(Math.min(1, Math.max(0, finite(definition.restitution, 0))));
  descriptor.setDensity(Math.max(0, finite(definition.density, 1)));
  const collisionGroups = packCollisionGroups(definition.collisionGroups);
  if (collisionGroups !== null) descriptor.setCollisionGroups(collisionGroups);
  const solverGroups = packCollisionGroups(definition.solverGroups);
  if (solverGroups !== null) descriptor.setSolverGroups(solverGroups);
  if (definition.emitCollisionEvents !== false) descriptor.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
  return descriptor;
}

function element(tagName, className, textContent) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

class OfflineRuntimeSession {
  constructor(host, project) {
    this.host = host;
    this.project = project;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.entityStates = new Map();
    this.keyBindings = collectKeyboardBindings(project.inputMaps);
    this.runtimeActions = runtimeInputActions(project);
    this.pressedCodes = new Set();
    this.virtualDirections = new Set();
    this.restartActionActive = false;
    this.rapier = null;
    this.physicsWorld = null;
    this.physicsEventQueue = null;
    this.physicsBodies = new Map();
    this.physicsColliders = new Map();
    this.colliderEntityIds = new Map();
    this.characterController = null;
    this.playerBody = null;
    this.playerCollider = null;
    this.playerEntityId = null;
    this.gameplayState = null;
    this.hud = null;
    this.hudFields = null;
    this.hudDisposers = [];
    this.runtimeStyle = null;
    this.frameHandle = 0;
    this.lastFrameMs = null;
    this.accumulatorSeconds = 0;
    this.simulationTick = 0;
    this.droppedTicks = 0;
    this.paused = false;
    this.disposed = false;
    this.starting = false;
    this.prepared = false;
    this.started = false;
    this.committed = false;
    this.runtimeError = null;
    this.onKeyDown = (event) => {
      if (this.usesKeyboardCode(event.code)) {
        this.pressedCodes.add(event.code);
        event.preventDefault();
      }
    };
    this.onKeyUp = (event) => {
      if (this.usesKeyboardCode(event.code)) {
        this.pressedCodes.delete(event.code);
        event.preventDefault();
      }
    };
    this.onBlur = () => { this.pressedCodes.clear(); this.virtualDirections.clear(); };
    this.onResize = () => this.resize();
  }

  async prepare() {
    if (this.disposed) return false;
    if (this.starting || this.prepared || this.started) throw new Error('Offline runtime session has already been prepared.');
    this.starting = true;
    this.createWorld();
    if (this.renderer) this.renderer.domElement.hidden = true;
    if (this.project.runtimeBindings) {
      await this.createGameplayRuntime();
      if (this.disposed) {
        this.starting = false;
        return false;
      }
      this.createGameplayHUD();
      if (this.hud) this.hud.hidden = true;
      this.updateGameplayHUD();
    }
    if (this.disposed) {
      this.starting = false;
      return false;
    }
    this.starting = false;
    this.prepared = true;
    return true;
  }

  arm() {
    if (this.disposed || !this.prepared) return false;
    if (this.started) return true;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp, { passive: false });
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    this.frameHandle = requestAnimationFrame((now) => this.frame(now));
    this.started = true;
    return true;
  }

  commit() {
    if (this.disposed || !this.started) return false;
    if (this.renderer) this.renderer.domElement.hidden = false;
    if (this.hud) this.hud.hidden = false;
    this.committed = true;
    this.publishState();
    return true;
  }

  publishState() {
    if (!this.committed || this.disposed) return;
    this.host.setAttribute('data-runtime-state', this.paused ? 'paused' : 'playing');
  }

  usesKeyboardCode(code) {
    for (const bindings of this.keyBindings.values()) {
      if (bindings.some((binding) => binding.code === code)) return true;
    }
    for (const action of this.runtimeActions) {
      if (!Array.isArray(action.bindings)) continue;
      if (action.bindings.some((binding) => isRecord(binding) && binding.device === 'keyboard' && binding.code === code)) return true;
    }
    return false;
  }

  resolveAction(actionId) {
    let x = 0;
    let y = 0;
    for (const binding of this.keyBindings.get(actionId) || []) {
      if (!this.pressedCodes.has(binding.code)) continue;
      const scale = binding.scale === -1 ? -1 : 1;
      if (binding.axis === 'y' || binding.output === 'y') y += scale;
      else x += scale;
    }
    const action = this.runtimeActions.find((candidate) => candidate.id === actionId);
    if (action && Array.isArray(action.bindings)) {
      const gamepads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
        ? navigator.getGamepads()
        : [];
      for (const binding of action.bindings) {
        if (!isRecord(binding)) continue;
        let value = 0;
        if (binding.device === 'keyboard' && typeof binding.code === 'string') {
          value = this.pressedCodes.has(binding.code) ? 1 : 0;
        } else if (binding.device === 'gamepad') {
          const gamepad = gamepads[Number.isInteger(binding.gamepad) ? binding.gamepad : 0];
          if (!gamepad) continue;
          if (binding.control === 'axis') value = finite(gamepad.axes && gamepad.axes[binding.index], 0);
          else value = finite(gamepad.buttons && gamepad.buttons[binding.index] && gamepad.buttons[binding.index].value, 0);
        }
        const deadZone = Math.max(0, Math.min(0.99, finite(binding.deadZone, 0)));
        if (Math.abs(value) <= deadZone) value = 0;
        value *= finite(binding.scale, 1);
        if (binding.output === 'y' || binding.axis === 'y') y += value;
        else x += value;
      }
    }
    if (actionId === 'move') {
      if (this.virtualDirections.has('left')) x -= 1;
      if (this.virtualDirections.has('right')) x += 1;
      if (this.virtualDirections.has('up')) y -= 1;
      if (this.virtualDirections.has('down')) y += 1;
    }
    const length = Math.hypot(x, y);
    return length > 1 ? [x / length, y / length] : [x, y];
  }

  resolveButton(actionId) {
    const value = this.resolveAction(actionId);
    return Math.max(Math.abs(value[0]), Math.abs(value[1]));
  }

  createWorld() {
    const settings = this.project.scene.settings;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(settings.background);
    scene.fog = settings.fogEnabled
      ? new THREE.Fog(settings.fogColor, settings.fogNear, Math.max(settings.fogNear + 0.001, settings.fogFar))
      : null;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.scene = scene;
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = settings.shadows;
    renderer.toneMappingExposure = settings.exposure;
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', this.project.name + ' game canvas');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.tabIndex = 0;
    this.host.append(renderer.domElement);

    const objects = new Map();
    let primaryCamera = null;
    let firstCamera = null;
    let lightCount = 0;
    for (const entity of this.project.entities) {
      const object = createObject(entity);
      objects.set(entity.id, object);
      if (object.isCamera && entity.active) {
        firstCamera ||= object;
        if (entity.camera && entity.camera.primary === true) primaryCamera = object;
      }
      if (object.isLight) lightCount += 1;
      this.entityStates.set(entity.id, {
        entity,
        object,
        movement: [0, 0, 0],
        rotation: [0, 0, 0],
      });
    }
    for (const entity of this.project.entities) {
      const object = objects.get(entity.id);
      const parent = entity.parentId ? objects.get(entity.parentId) : null;
      (parent || scene).add(object);
    }
    if (lightCount === 0) {
      scene.add(new THREE.HemisphereLight('#dcecff', '#18212d', 1.5));
    }
    const camera = primaryCamera || firstCamera || new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    if (!primaryCamera && !firstCamera) {
      camera.position.set(7, 5, 9);
      camera.lookAt(0, 0, 0);
      scene.add(camera);
    }
    this.camera = camera;
    this.resize();
    this.render();
  }

  async createGameplayRuntime() {
    const bindings = this.project.runtimeBindings;
    if (!bindings) return;
    const injectedRapier = globalThis.__THREEJS_STUDIO_TEST_RAPIER__;
    const rapier = injectedRapier || await import('./vendor/rapier.mjs');
    if (!injectedRapier && typeof rapier.init === 'function') await rapier.init();
    if (this.disposed) return;
    this.rapier = rapier;
    this.initializeGameplayState();
    this.createPhysicsWorld();
  }

  initializeGameplayState() {
    const rules = this.project.runtimeBindings.rules;
    const pickupTarget = Math.max(1, Math.floor(finite(rules.pickupTarget, 1)));
    const roundSeconds = Math.max(FIXED_DELTA_SECONDS, finite(rules.roundSeconds, 60));
    this.gameplayState = {
      score: 0,
      pickupsRemaining: pickupTarget,
      timeRemaining: roundSeconds,
      roundState: 'playing',
      gameOver: false,
      exitUnlocked: false,
      statusMessage: 'Collect ' + pickupTarget + ' energy shard' + (pickupTarget === 1 ? '' : 's') + ', then reach the portal.',
      pickupTarget,
      roundSeconds,
      collectedEntities: new Set(),
    };
  }

  createPhysicsWorld() {
    const bindings = this.project.runtimeBindings;
    const rapier = this.rapier;
    if (!bindings || !rapier) return;
    this.disposePhysicsWorld();
    const gravity = vec3(bindings.physics.gravity, [0, -9.81, 0]);
    const world = new rapier.World({ x: gravity[0], y: gravity[1], z: gravity[2] });
    world.timestep = FIXED_DELTA_SECONDS;
    const eventQueue = new rapier.EventQueue(true);
    const entityByBodyId = physicsBodyEntityMap(bindings);
    this.physicsWorld = world;
    this.physicsEventQueue = eventQueue;
    for (const definition of bindings.physics.bodies) {
      if (!isRecord(definition) || typeof definition.id !== 'string') continue;
      const body = world.createRigidBody(createBodyDescriptor(rapier, definition));
      this.physicsBodies.set(definition.id, body);
      const entityId = entityByBodyId.get(definition.id) || definition.id.replace(/^physics\./u, 'entity.');
      for (const colliderDefinition of Array.isArray(definition.colliders) ? definition.colliders : []) {
        if (!isRecord(colliderDefinition) || typeof colliderDefinition.id !== 'string') continue;
        const collider = world.createCollider(createColliderDescriptor(rapier, colliderDefinition), body);
        this.physicsColliders.set(colliderDefinition.id, collider);
        this.colliderEntityIds.set(collider.handle, entityId);
      }
    }
    const characterBinding = Array.isArray(bindings.componentBindings)
      ? bindings.componentBindings.find((binding) => isRecord(binding) && binding.type === 'characterController')
      : null;
    if (!characterBinding || typeof characterBinding.definitionId !== 'string' || typeof characterBinding.entityId !== 'string') {
      throw new TypeError('Runtime bindings v1 require one characterController component binding.');
    }
    this.playerBody = this.physicsBodies.get(characterBinding.definitionId) || null;
    const playerBodyDefinition = bindings.physics.bodies.find((definition) => definition.id === characterBinding.definitionId);
    const playerColliderId = playerBodyDefinition && Array.isArray(playerBodyDefinition.colliders)
      ? playerBodyDefinition.colliders[0] && playerBodyDefinition.colliders[0].id
      : null;
    this.playerCollider = playerColliderId ? this.physicsColliders.get(playerColliderId) || null : null;
    this.playerEntityId = characterBinding.entityId;
    if (!this.playerBody || !this.playerCollider) throw new TypeError('The character controller references a missing body or collider.');
    const properties = isRecord(characterBinding.properties) ? characterBinding.properties : {};
    const controller = world.createCharacterController(Math.max(0.001, finite(properties.offset, 0.02)));
    controller.setSlideEnabled(true);
    if (finite(properties.snapToGround, 0) > 0) controller.enableSnapToGround(properties.snapToGround);
    if (finite(properties.maxSlopeClimbAngleDegrees, 0) > 0) controller.setMaxSlopeClimbAngle(properties.maxSlopeClimbAngleDegrees * Math.PI / 180);
    if (finite(properties.minSlopeSlideAngleDegrees, 0) > 0) controller.setMinSlopeSlideAngle(properties.minSlopeSlideAngleDegrees * Math.PI / 180);
    if (isRecord(properties.autostep)) {
      controller.enableAutostep(
        Math.max(0.001, finite(properties.autostep.maxHeight, 0.35)),
        Math.max(0.001, finite(properties.autostep.minWidth, 0.2)),
        properties.autostep.includeDynamicBodies === true,
      );
    }
    this.characterController = controller;
    this.syncPhysicsTransforms();
  }

  disposePhysicsWorld() {
    if (this.physicsWorld && this.characterController) {
      try {
        this.physicsWorld.removeCharacterController(this.characterController);
      } catch {
        try { this.characterController.free?.(); } catch {}
      }
    }
    this.characterController = null;
    this.playerBody = null;
    this.playerCollider = null;
    this.playerEntityId = null;
    this.physicsBodies.clear();
    this.physicsColliders.clear();
    this.colliderEntityIds.clear();
    try { this.physicsEventQueue?.free?.(); } catch {}
    try { this.physicsWorld?.free?.(); } catch {}
    this.physicsEventQueue = null;
    this.physicsWorld = null;
  }

  createGameplayHUD() {
    if (!this.gameplayState || typeof document.createElement !== 'function') return;
    try {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = new URL('./runtime.css', import.meta.url).href;
      document.head?.append(stylesheet);
      this.runtimeStyle = stylesheet;
    } catch {
      this.runtimeStyle = null;
    }
    const root = element('section', 'studio-runtime-hud');
    root.setAttribute('aria-label', 'Collect and Escape heads-up display');
    root.dataset.touch = String(('ontouchstart' in window) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));

    const top = element('div', 'studio-runtime-hud__top');
    const score = element('h2', 'studio-runtime-hud__score');
    score.setAttribute('aria-live', 'polite');
    const timerWrap = element('div', 'studio-runtime-hud__timer');
    const progress = element('progress');
    progress.setAttribute('aria-label', 'Time remaining');
    progress.max = this.gameplayState.roundSeconds;
    const timerText = element('output');
    timerText.setAttribute('aria-live', 'off');
    timerWrap.append(progress, timerText);
    top.append(score, timerWrap);

    const statusWrap = element('div', 'studio-runtime-hud__status');
    statusWrap.setAttribute('role', 'status');
    statusWrap.setAttribute('aria-live', 'polite');
    const status = element('p');
    const restart = element('button', 'studio-runtime-hud__restart', 'Restart round');
    restart.type = 'button';
    restart.setAttribute('aria-label', 'Restart Collect and Escape');
    const onRestart = () => this.restartGameplay();
    restart.addEventListener('click', onRestart);
    this.hudDisposers.push(() => restart.removeEventListener('click', onRestart));
    statusWrap.append(status, restart);

    const bottom = element('div', 'studio-runtime-hud__bottom');
    const hint = element('div', 'studio-runtime-hud__hint', 'Move: WASD / arrows / left stick · Restart: R / Menu');
    const touch = element('div', 'studio-runtime-hud__touch');
    touch.setAttribute('role', 'group');
    touch.setAttribute('aria-label', 'Touch movement controls');
    const directionLabels = { left: ['←', 'Move left'], up: ['↑', 'Move forward'], down: ['↓', 'Move backward'], right: ['→', 'Move right'] };
    for (const direction of ['up', 'left', 'down', 'right']) {
      const labels = directionLabels[direction];
      const button = element('button', '', labels[0]);
      button.type = 'button';
      button.dataset.direction = direction;
      button.setAttribute('aria-label', labels[1]);
      const activate = (event) => { event.preventDefault(); this.virtualDirections.add(direction); };
      const deactivate = (event) => { event.preventDefault(); this.virtualDirections.delete(direction); };
      button.addEventListener('pointerdown', activate, { passive: false });
      for (const eventName of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(eventName, deactivate, { passive: false });
      this.hudDisposers.push(() => {
        button.removeEventListener('pointerdown', activate);
        for (const eventName of ['pointerup', 'pointercancel', 'pointerleave']) button.removeEventListener(eventName, deactivate);
      });
      touch.append(button);
    }
    bottom.append(hint, touch);
    root.append(top, statusWrap, bottom);
    this.host.append(root);
    this.hud = root;
    this.hudFields = { score, progress, timerText, status, restart };
  }

  updateGameplayHUD() {
    const state = this.gameplayState;
    const fields = this.hudFields;
    if (!state || !fields) return;
    fields.score.textContent = 'Shards ' + state.score + ' / ' + state.pickupTarget;
    fields.progress.max = state.roundSeconds;
    fields.progress.value = state.timeRemaining;
    const roundedSeconds = Math.ceil(state.timeRemaining);
    fields.progress.setAttribute('aria-valuetext', roundedSeconds + ' seconds');
    fields.timerText.textContent = roundedSeconds + 's';
    fields.status.textContent = state.statusMessage;
    fields.restart.hidden = !state.gameOver;
  }

  restartGameplay() {
    if (!this.project.runtimeBindings || this.disposed) return;
    this.initializeGameplayState();
    this.createPhysicsWorld();
    for (const state of this.entityStates.values()) state.object.visible = state.entity.active && state.entity.visible;
    this.restartActionActive = true;
    this.updateGameplayHUD();
  }

  disposeGameplayHUD() {
    for (const dispose of this.hudDisposers.splice(0)) {
      try { dispose(); } catch {}
    }
    this.virtualDirections.clear();
    try { this.hud?.remove(); } catch {}
    try { this.runtimeStyle?.remove(); } catch {}
    this.hud = null;
    this.hudFields = null;
    this.runtimeStyle = null;
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, this.host.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, this.host.clientHeight || window.innerHeight || 1);
    this.renderer.setSize(width, height, false);
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  fixedGameplayUpdate() {
    const state = this.gameplayState;
    const world = this.physicsWorld;
    const eventQueue = this.physicsEventQueue;
    if (!state || !world || !eventQueue || !this.playerBody || !this.playerCollider || !this.characterController) return;

    const restartActive = this.resolveButton('restart') > 0.5;
    if (restartActive && !this.restartActionActive) {
      this.restartGameplay();
      return;
    }
    this.restartActionActive = restartActive;

    if (state.roundState === 'playing') {
      const move = this.resolveAction('move');
      const scriptBinding = Array.isArray(this.project.runtimeBindings.componentBindings)
        ? this.project.runtimeBindings.componentBindings.find((binding) => isRecord(binding) && binding.type === 'scriptBehavior')
        : null;
      const speed = Math.max(0, finite(scriptBinding && scriptBinding.properties && scriptBinding.properties.moveSpeed, 5.5));
      const desired = { x: move[0] * speed * FIXED_DELTA_SECONDS, y: 0, z: move[1] * speed * FIXED_DELTA_SECONDS };
      this.characterController.computeColliderMovement(
        this.playerCollider,
        desired,
        this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
      );
      const movement = this.characterController.computedMovement();
      const position = this.playerBody.translation();
      this.playerBody.setNextKinematicTranslation({
        x: position.x + movement.x,
        y: position.y + movement.y,
        z: position.z + movement.z,
      });
      state.timeRemaining = Math.max(0, state.timeRemaining - FIXED_DELTA_SECONDS);
      if (state.timeRemaining <= 0) {
        state.roundState = 'failed';
        state.gameOver = true;
        state.statusMessage = 'Time expired';
      }
    }

    world.timestep = FIXED_DELTA_SECONDS;
    world.step(eventQueue);
    eventQueue.drainCollisionEvents((handleA, handleB, started) => {
      if (!started) return;
      this.processGameplayContact(handleA, handleB);
    });
    world.intersectionPairsWith(this.playerCollider, (collider) => {
      this.processGameplayEntity(this.colliderEntityIds.get(collider.handle));
    });
    this.syncPhysicsTransforms();
    this.updateGameplayHUD();
  }

  processGameplayContact(handleA, handleB) {
    const entityA = this.colliderEntityIds.get(handleA);
    const entityB = this.colliderEntityIds.get(handleB);
    if (entityA === this.playerEntityId) this.processGameplayEntity(entityB);
    else if (entityB === this.playerEntityId) this.processGameplayEntity(entityA);
  }

  processGameplayEntity(entityId) {
    const state = this.gameplayState;
    if (!state || state.roundState !== 'playing' || typeof entityId !== 'string') return;
    if (entityId.startsWith('entity.pickup.') && !state.collectedEntities.has(entityId)) {
      state.collectedEntities.add(entityId);
      state.score += 1;
      state.pickupsRemaining = Math.max(0, state.pickupTarget - state.score);
      const entityState = this.entityStates.get(entityId);
      if (entityState) entityState.object.visible = false;
      for (const [colliderId, collider] of this.physicsColliders) {
        if (this.colliderEntityIds.get(collider.handle) !== entityId) continue;
        collider.setEnabled(false);
        this.physicsColliders.set(colliderId, collider);
      }
      if (state.pickupsRemaining === 0) {
        state.exitUnlocked = true;
        state.statusMessage = 'Exit unlocked — reach the portal!';
      } else {
        state.statusMessage = state.pickupsRemaining + ' shard' + (state.pickupsRemaining === 1 ? '' : 's') + ' remaining.';
      }
      return;
    }
    if (entityId === 'entity.exit') {
      if (!state.exitUnlocked) {
        state.statusMessage = 'Collect every energy shard first.';
        return;
      }
      state.roundState = 'won';
      state.gameOver = true;
      state.statusMessage = 'Escaped!';
    }
  }

  syncPhysicsTransforms() {
    const bindings = this.project.runtimeBindings;
    if (!bindings) return;
    const entityByBodyId = physicsBodyEntityMap(bindings);
    for (const [bodyId, body] of this.physicsBodies) {
      const entityId = entityByBodyId.get(bodyId) || bodyId.replace(/^physics\./u, 'entity.');
      const state = this.entityStates.get(entityId);
      if (!state) continue;
      const position = body.translation();
      const rotation = body.rotation();
      state.object.position.set(position.x, position.y, position.z);
      if (state.object.quaternion && typeof state.object.quaternion.set === 'function') {
        state.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      }
    }
  }

  fixedUpdate() {
    this.simulationTick += 1;
    if (this.gameplayState) this.fixedGameplayUpdate();
    const time = this.simulationTick * FIXED_DELTA_SECONDS;
    for (const state of this.entityStates.values()) {
      const entity = state.entity;
      for (const component of entity.components) {
        if (component.enabled === false) continue;
        if (component.type === 'keyboardMove' && !this.gameplayState) {
          const action = this.resolveAction(component.actionId);
          const speed = Math.max(0, finite(component.speed, 0));
          state.movement[0] += action[0] * speed * FIXED_DELTA_SECONDS;
          if (component.plane === 'xy') state.movement[1] += action[1] * speed * FIXED_DELTA_SECONDS;
          else state.movement[2] -= action[1] * speed * FIXED_DELTA_SECONDS;
        } else if (component.type === 'rotate' && AXIS_INDEX[component.axis] !== undefined) {
          state.rotation[AXIS_INDEX[component.axis]] += finite(component.speed, 0) * FIXED_DELTA_SECONDS;
        }
      }
      if (!this.gameplayState || !this.physicsBodies.has(entity.id.replace(/^entity\./u, 'physics.'))) {
        state.object.position.fromArray(entity.transform.position);
        state.object.position.x += state.movement[0];
        state.object.position.y += state.movement[1];
        state.object.position.z += state.movement[2];
      }
      state.object.rotation.fromArray(entity.transform.rotation, 'XYZ');
      state.object.rotation.x += state.rotation[0];
      state.object.rotation.y += state.rotation[1];
      state.object.rotation.z += state.rotation[2];
      for (const component of entity.components) {
        if (component.enabled === false || component.type !== 'float' || AXIS_INDEX[component.axis] === undefined) continue;
        const offset = Math.sin(time * finite(component.speed, 0) * 2 + finite(component.phase, 0)) * Math.max(0, finite(component.distance, 0));
        state.object.position[component.axis] += offset;
      }
    }
  }

  render() {
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  }

  frame(nowMs) {
    if (this.disposed) return;
    try {
      if (this.lastFrameMs === null) this.lastFrameMs = nowMs;
      const elapsedSeconds = Math.max(0, (nowMs - this.lastFrameMs) / 1000);
      this.lastFrameMs = nowMs;
      if (!this.paused) {
        const advance = advanceFixedStep({ accumulatorSeconds: this.accumulatorSeconds }, elapsedSeconds);
        this.accumulatorSeconds = advance.accumulatorSeconds;
        this.droppedTicks += advance.droppedTicks;
        for (let index = 0; index < advance.ticks; index += 1) this.fixedUpdate();
      }
      this.render();
      this.frameHandle = requestAnimationFrame((next) => this.frame(next));
    } catch (error) {
      this.fail(error);
    }
  }

  fail(error) {
    this.runtimeError = Object.freeze({
      name: error && typeof error.name === 'string' ? error.name : 'Error',
      message: error && typeof error.message === 'string' ? error.message : String(error),
    });
    this.dispose();
    this.host.setAttribute('data-runtime-error', this.runtimeError.message);
  }

  pause() {
    if (this.disposed) return;
    this.paused = true;
    this.host.setAttribute('data-runtime-state', 'paused');
  }

  resume() {
    if (this.disposed) return;
    this.paused = false;
    this.lastFrameMs = null;
    this.host.setAttribute('data-runtime-state', 'playing');
  }

  step() {
    if (this.disposed || !this.paused) return false;
    this.fixedUpdate();
    this.render();
    return true;
  }

  restart() {
    if (this.disposed) return;
    if (this.gameplayState) {
      this.accumulatorSeconds = 0;
      this.simulationTick = 0;
      this.droppedTicks = 0;
      this.lastFrameMs = null;
      this.pressedCodes.clear();
      this.virtualDirections.clear();
      this.restartGameplay();
      this.host.setAttribute('data-runtime-state', this.paused ? 'paused' : 'playing');
      return;
    }
    this.disposeWorld();
    this.accumulatorSeconds = 0;
    this.simulationTick = 0;
    this.droppedTicks = 0;
    this.lastFrameMs = null;
    this.pressedCodes.clear();
    this.createWorld();
    this.host.setAttribute('data-runtime-state', this.paused ? 'paused' : 'playing');
  }

  diagnostics() {
    const gameplay = this.gameplayState;
    const player = this.playerBody && this.playerBody.translation();
    return Object.freeze({
      runtimeVersion: OFFLINE_RUNTIME_VERSION,
      projectId: this.project.id,
      sceneId: this.project.startupSceneId,
      sourceSchemaVersion: this.project.sourceSchemaVersion,
      state: this.disposed ? 'disposed' : this.paused ? 'paused' : 'playing',
      simulationTick: this.simulationTick,
      droppedTicks: this.droppedTicks,
      entityCount: this.entityStates.size,
      runtimeBindingsFormat: this.project.runtimeBindings ? this.project.runtimeBindings.format : null,
      physicsEngine: this.physicsWorld ? 'rapier' : null,
      score: gameplay ? gameplay.score : null,
      pickupsRemaining: gameplay ? gameplay.pickupsRemaining : null,
      timeRemaining: gameplay ? gameplay.timeRemaining : null,
      roundState: gameplay ? gameplay.roundState : null,
      playerPosition: player ? [player.x, player.y, player.z] : null,
      error: this.runtimeError,
    });
  }

  disposeObject(object) {
    disposeObjectResources(object);
  }

  disposeWorld() {
    const disposedObjects = new Set();
    const disposeOnce = (object) => {
      if (!object || disposedObjects.has(object)) return;
      disposedObjects.add(object);
      this.disposeObject(object);
    };
    try { this.scene?.traverse(disposeOnce); } catch {}
    for (const state of this.entityStates.values()) disposeOnce(state.object);
    this.entityStates.clear();
    const renderer = this.renderer;
    this.renderer = null;
    if (renderer) {
      const canvas = renderer.domElement;
      try { renderer.dispose(); } catch {}
      try { renderer.forceContextLoss?.(); } catch {}
      try { canvas.remove(); } catch {}
    }
    this.scene = null;
    this.camera = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.starting = false;
    this.prepared = false;
    this.started = false;
    try { cancelAnimationFrame(this.frameHandle); } catch {}
    try { window.removeEventListener('keydown', this.onKeyDown); } catch {}
    try { window.removeEventListener('keyup', this.onKeyUp); } catch {}
    try { window.removeEventListener('blur', this.onBlur); } catch {}
    try { window.removeEventListener('resize', this.onResize); } catch {}
    this.pressedCodes.clear();
    this.disposeGameplayHUD();
    this.disposePhysicsWorld();
    this.gameplayState = null;
    this.rapier = null;
    this.disposeWorld();
    if (this.committed) {
      try { this.host.setAttribute('data-runtime-state', 'disposed'); } catch {}
    }
    this.committed = false;
  }
}

function bootSupersededError() {
  const error = new Error('Offline runtime boot was superseded by a newer session.');
  error.name = 'AbortError';
  error.code = 'ERR_RUNTIME_BOOT_SUPERSEDED';
  return error;
}

function requireBuildContext(context) {
  if (!isRecord(context) || !isRecord(context.projectManifest)) {
    throw new TypeError('Offline runtime boot requires a serializable projectManifest.');
  }
  return context;
}

export async function boot(context) {
  const build = requireBuildContext(context);
  const project = normalizeProjectManifest(build.projectManifest);
  const host = document.getElementById('threejs-studio-game');
  if (!host) throw new Error('Missing #threejs-studio-game runtime host.');
  const generation = ++bootGeneration;
  if (pendingSession) pendingSession.dispose();
  const session = new OfflineRuntimeSession(host, project);
  pendingSession = session;
  if (!activeSession) host.setAttribute('data-runtime-state', 'initializing');
  try {
    const prepared = await session.prepare();
    if (!prepared || session.disposed || pendingSession !== session || generation !== bootGeneration) {
      throw bootSupersededError();
    }
    if (!session.arm()) throw new Error('Offline runtime session could not be armed.');
    if (!session.commit()) throw new Error('Offline runtime session could not be committed.');
    const previousSession = activeSession;
    if (previousSession) previousSession.dispose();
    activeSession = session;
    pendingSession = null;
    session.publishState();
  } catch (error) {
    const superseded = session.disposed || pendingSession !== session || generation !== bootGeneration;
    session.dispose();
    if (pendingSession === session) pendingSession = null;
    if (!activeSession && generation === bootGeneration) host.setAttribute('data-runtime-state', 'disposed');
    if (superseded && (!error || error.code !== 'ERR_RUNTIME_BOOT_SUPERSEDED')) {
      throw bootSupersededError();
    }
    throw error;
  }
  return Object.freeze({
    pause: () => session.pause(),
    resume: () => session.resume(),
    step: () => session.step(),
    restart: () => session.restart(),
    dispose: () => {
      session.dispose();
      if (activeSession === session) activeSession = null;
    },
    diagnostics: () => session.diagnostics(),
  });
}

export default boot;
`;
