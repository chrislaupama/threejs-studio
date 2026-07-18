import { validateProjectDocumentV5 } from '../editor/projectV5';
import type {
  DataAssetRecordV5,
  EntityV5,
  JsonValueV5,
  ProjectDocumentV5,
  ProjectEventV5,
  ProjectVariableV5,
} from '../editor/types';
import {
  InputRuntime,
  validateInputActionMap,
  type InputActionMap,
  type InputRuntimeDiagnostics,
} from '../gameplay/input';
import {
  PHYSICS_FIXED_DELTA,
  PhysicsWorld,
  validatePhysicsBodies,
  type PhysicsRigidBodyDefinition,
  type PhysicsTransform,
  type PhysicsVector3,
  type PhysicsWorldDiagnostics,
} from '../gameplay/physics';
import {
  GameplayStateStore,
  type GameplayStateDefinition,
  type GameplayStateSnapshot,
  type GameplayVariableDefinition,
} from '../gameplay/state';
import type {
  GameplayEventDefinition,
  GameplayEventEnvelope,
  GameplayEventFieldDefinition,
  GameplayValueSchema,
  SerializableRecord,
  SerializableValue,
} from '../gameplay/events';
import {
  mountRuntimeUI,
  validateUIDocument,
  type RuntimeUIController,
  type UIActionDispatch,
  type UIDiagnostic,
  type UIDocument,
  type UIElement,
  type UIEventDispatch,
} from '../runtime-ui';
import { RUNTIME_MAX_CATCH_UP_STEPS } from './types';

export const RUNTIME_BINDINGS_FORMAT = 'threejs-studio.runtime-bindings.v1' as const;

export const RUNTIME_INPUT_ACTION_CODES = Object.freeze({
  move: 'move',
  moveUp: 'move.up',
  moveDown: 'move.down',
  moveLeft: 'move.left',
  moveRight: 'move.right',
  restart: 'restart',
});

export type ProjectGameRuntimeStatus =
  | 'ready'
  | 'running'
  | 'paused'
  | 'failed'
  | 'disposed';

export type ProjectGameRuntimeDiagnosticCode =
  | 'INVALID_PROJECT'
  | 'INVALID_MANIFEST'
  | 'MISSING_BINDING'
  | 'INPUT_HOST_ERROR'
  | 'EVENT_REJECTED'
  | 'UI_DIAGNOSTIC'
  | 'RUNTIME_ERROR';

export interface ProjectGameRuntimeDiagnostic {
  level: 'warning' | 'error';
  code: ProjectGameRuntimeDiagnosticCode;
  message: string;
  tick: number;
  details?: string[];
}

export class ProjectGameRuntimeError extends Error {
  readonly code: 'INVALID_PROJECT' | 'INVALID_MANIFEST' | 'INVALID_STATE' | 'DISPOSED';
  readonly details: string[];

  constructor(
    code: ProjectGameRuntimeError['code'],
    message: string,
    details: string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectGameRuntimeError';
    this.code = code;
    this.details = [...details];
  }
}

export interface RuntimeBindingComponent {
  id: string;
  entityId: string;
  type: 'physicsBody' | 'characterController' | 'scriptBehavior' | 'runtimeUI';
  definitionId?: string;
  assetId?: string;
  properties?: Record<string, JsonValueV5>;
}

export interface RuntimeBindingVariableIds {
  score: string;
  pickupsRemaining: string;
  timeRemaining: string;
  roundState: string;
  statusMessage: string;
  gameOver: string;
  exitUnlocked: string;
  touchAvailable: string;
}

export interface RuntimeBindingEventIds {
  roundStarted: string;
  pickupCollected: string;
  exitReached: string;
  roundWon: string;
  roundFailed: string;
}

export interface RuntimeBindingManifestV1 {
  schemaVersion: 1;
  format: typeof RUNTIME_BINDINGS_FORMAT;
  fixedDeltaSeconds: number;
  maxCatchUpTicks: number;
  systemOrder: readonly string[];
  physics: {
    gravity: PhysicsVector3;
    bodies: PhysicsRigidBodyDefinition[];
  };
  input: InputActionMap;
  componentBindings: RuntimeBindingComponent[];
  rules: {
    roundSeconds: number;
    pickupTarget: number;
    playerSpawn: PhysicsVector3;
    resetEventId: string;
    moveSpeed?: number;
    moveActionId?: string;
    restartActionId?: string;
    pickupTag?: string;
    exitTag?: string;
    variableIds?: Partial<RuntimeBindingVariableIds>;
    eventIds?: Partial<RuntimeBindingEventIds>;
  };
}

export interface DetectedProjectRuntimeBindings {
  assetId: string;
  sceneId: string;
  manifest: RuntimeBindingManifestV1;
  uiDocument: UIDocument | null;
}

export interface ProjectGameRuntimeTransformUpdate {
  entityId: string;
  bodyId: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  active: boolean;
}

export interface RuntimeGamepadSnapshot {
  index: number;
  connected?: boolean;
  buttons: readonly (number | { value: number })[];
  axes: readonly number[];
}

export interface ProjectGameRuntimeHUDSnapshot {
  score: number;
  pickupTarget: number;
  pickupsRemaining: number;
  timeRemaining: number;
  roundState: 'playing' | 'won' | 'failed';
  statusMessage: string;
  gameOver: boolean;
  exitUnlocked: boolean;
  touchAvailable: boolean;
}

export interface ProjectGameRuntimeSnapshot {
  status: ProjectGameRuntimeStatus;
  projectId: string;
  sceneId: string;
  manifestAssetId: string;
  tick: number;
  restartCount: number;
  playerEntityId: string;
  playerBodyId: string;
  activeEntityIds: string[];
  collectedEntityIds: string[];
  hud: ProjectGameRuntimeHUDSnapshot;
  gameplay: GameplayStateSnapshot;
}

export interface ProjectGameRuntimeDiagnostics {
  status: ProjectGameRuntimeStatus;
  tick: number;
  restartCount: number;
  processedCollisionEvents: number;
  collectedPickups: number;
  activeRuntimeEntities: number;
  input: InputRuntimeDiagnostics;
  physics: PhysicsWorldDiagnostics;
  hudMounted: boolean;
  diagnosticCount: number;
  lastDiagnostic: ProjectGameRuntimeDiagnostic | null;
}

export interface ProjectGameRuntimeHost {
  hudTarget?: HTMLElement;
  touchAvailable?: boolean;
  setEntityTransform?: (update: ProjectGameRuntimeTransformUpdate) => void;
  setEntityActive?: (entityId: string, active: boolean) => void;
  onHUDChange?: (hud: ProjectGameRuntimeHUDSnapshot) => void;
  onEvent?: (event: GameplayEventEnvelope) => void;
  onDiagnostic?: (diagnostic: ProjectGameRuntimeDiagnostic) => void;
  getGamepads?: () => readonly RuntimeGamepadSnapshot[];
}

export interface CreateProjectGameRuntimeOptions {
  project: ProjectDocumentV5;
  sceneId?: string;
  host?: ProjectGameRuntimeHost;
}

export interface ProjectGameRuntimeController {
  readonly status: ProjectGameRuntimeStatus;
  readonly sceneId: string;
  readonly manifestAssetId: string;
  start(): ProjectGameRuntimeSnapshot;
  pause(): ProjectGameRuntimeSnapshot;
  resume(): ProjectGameRuntimeSnapshot;
  setKeyboardKey(code: string, pressed: boolean): void;
  setPointerButton(button: number, pressed: boolean | number): void;
  setPointerPosition(x: number, y: number): void;
  addPointerDelta(deltaX: number, deltaY: number): void;
  addWheelDelta(deltaX: number, deltaY: number): void;
  setTouch(touchId: number, x: number, y: number): void;
  removeTouch(touchId: number): void;
  setGamepadButton(gamepad: number, button: number, value: number): void;
  setGamepadAxis(gamepad: number, axis: number, value: number): void;
  removeGamepad(gamepad: number): void;
  setVirtualAction(actionId: string, pressed: boolean): void;
  pulseAction(actionId: string): void;
  fixedUpdate(deltaSeconds?: number): ProjectGameRuntimeSnapshot;
  restart(): ProjectGameRuntimeSnapshot;
  getSnapshot(): ProjectGameRuntimeSnapshot;
  getDiagnostics(): ProjectGameRuntimeDiagnostics;
  dispose(): void;
}

type UnknownRecord = Record<string, unknown>;

interface HorizontalObstacle {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface AxisAlignedBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

const DEFAULT_VARIABLE_IDS: RuntimeBindingVariableIds = {
  score: 'score',
  pickupsRemaining: 'pickupsRemaining',
  timeRemaining: 'timeRemaining',
  roundState: 'roundState',
  statusMessage: 'statusMessage',
  gameOver: 'gameOver',
  exitUnlocked: 'exitUnlocked',
  touchAvailable: 'touchAvailable',
};

const DEFAULT_EVENT_IDS: RuntimeBindingEventIds = {
  roundStarted: 'round.started',
  pickupCollected: 'pickup.collected',
  exitReached: 'exit.reached',
  roundWon: 'round.won',
  roundFailed: 'round.failed',
};

const BUILT_IN_EVENT_IDS = [
  'studio.variable.changed',
  'studio.timer.elapsed',
  'studio.objective.changed',
  'studio.score.changed',
  'studio.game.phase.changed',
  'studio.game.restarted',
] as const;

const ROUND_TIMER_ID = 'studio.runtime.round';
const PICKUP_OBJECTIVE_ID = 'studio.runtime.collect';
const EXIT_OBJECTIVE_ID = 'studio.runtime.exit';
const POSITION_EPSILON = 0.0001;

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const isVec3 = (value: unknown): value is PhysicsVector3 => (
  Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
);

const clone = <T>(value: T): T => structuredClone(value);

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function readRuntimeManifest(value: unknown): { manifest: RuntimeBindingManifestV1 | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { manifest: null, errors: ['Runtime binding asset value must be an object.'] };
  if (value.format !== RUNTIME_BINDINGS_FORMAT) {
    return { manifest: null, errors: [`Runtime binding format must be "${RUNTIME_BINDINGS_FORMAT}".`] };
  }
  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (!isFiniteNumber(value.fixedDeltaSeconds) || value.fixedDeltaSeconds <= 0) {
    errors.push('fixedDeltaSeconds must be finite and greater than zero.');
  } else if (Math.abs(value.fixedDeltaSeconds - PHYSICS_FIXED_DELTA) > 1e-10) {
    errors.push(`fixedDeltaSeconds must be ${PHYSICS_FIXED_DELTA} for the shared 60 Hz runtime.`);
  }
  if (value.maxCatchUpTicks !== RUNTIME_MAX_CATCH_UP_STEPS) {
    errors.push(`maxCatchUpTicks must be ${RUNTIME_MAX_CATCH_UP_STEPS} for the shared runtime.`);
  }
  if (!Array.isArray(value.systemOrder) || !value.systemOrder.every((entry) => typeof entry === 'string')) {
    errors.push('systemOrder must be an array of strings.');
  }

  const physics = isRecord(value.physics) ? value.physics : null;
  if (!physics) errors.push('physics must be an object.');
  else {
    if (!isVec3(physics.gravity)) errors.push('physics.gravity must contain three finite numbers.');
    if (!Array.isArray(physics.bodies)) errors.push('physics.bodies must be an array.');
    else {
      try {
        errors.push(...validatePhysicsBodies(physics.bodies as PhysicsRigidBodyDefinition[]).map((error) => `physics.${error}`));
      } catch (error) {
        errors.push(`physics.bodies are malformed: ${errorMessage(error)}`);
      }
    }
  }

  if (!isRecord(value.input)) errors.push('input must be an object.');
  else {
    try {
      errors.push(...validateInputActionMap(value.input as unknown as InputActionMap).map((error) => `input.${error}`));
    } catch (error) {
      errors.push(`input is malformed: ${errorMessage(error)}`);
    }
  }

  if (!Array.isArray(value.componentBindings)) errors.push('componentBindings must be an array.');
  else {
    const bindingIds = new Set<string>();
    value.componentBindings.forEach((candidate, index) => {
      const path = `componentBindings[${index}]`;
      if (!isRecord(candidate)) {
        errors.push(`${path} must be an object.`);
        return;
      }
      if (typeof candidate.id !== 'string' || !candidate.id) errors.push(`${path}.id must be a non-empty string.`);
      else if (bindingIds.has(candidate.id)) errors.push(`${path}.id duplicates "${candidate.id}".`);
      else bindingIds.add(candidate.id);
      if (typeof candidate.entityId !== 'string' || !candidate.entityId) errors.push(`${path}.entityId must be a non-empty string.`);
      if (!['physicsBody', 'characterController', 'scriptBehavior', 'runtimeUI'].includes(String(candidate.type))) {
        errors.push(`${path}.type is unsupported.`);
      }
      if (candidate.definitionId !== undefined && (typeof candidate.definitionId !== 'string' || !candidate.definitionId)) {
        errors.push(`${path}.definitionId must be a non-empty string when present.`);
      }
      if (candidate.assetId !== undefined && (typeof candidate.assetId !== 'string' || !candidate.assetId)) {
        errors.push(`${path}.assetId must be a non-empty string when present.`);
      }
    });
  }

  const rules = isRecord(value.rules) ? value.rules : null;
  if (!rules) errors.push('rules must be an object.');
  else {
    if (!isFiniteNumber(rules.roundSeconds) || rules.roundSeconds <= 0) errors.push('rules.roundSeconds must be greater than zero.');
    if (!Number.isInteger(rules.pickupTarget) || (rules.pickupTarget as number) < 1) {
      errors.push('rules.pickupTarget must be a positive integer.');
    }
    if (!isVec3(rules.playerSpawn)) errors.push('rules.playerSpawn must contain three finite numbers.');
    if (typeof rules.resetEventId !== 'string' || !rules.resetEventId) errors.push('rules.resetEventId must be a non-empty string.');
    if (rules.moveSpeed !== undefined && (!isFiniteNumber(rules.moveSpeed) || rules.moveSpeed < 0)) {
      errors.push('rules.moveSpeed must be finite and non-negative when present.');
    }
    for (const key of ['moveActionId', 'restartActionId', 'pickupTag', 'exitTag'] as const) {
      if (rules[key] !== undefined && (typeof rules[key] !== 'string' || !rules[key])) {
        errors.push(`rules.${key} must be a non-empty string when present.`);
      }
    }
    for (const key of ['variableIds', 'eventIds'] as const) {
      const mapping = rules[key];
      if (mapping === undefined) continue;
      if (!isRecord(mapping)) {
        errors.push(`rules.${key} must be an object when present.`);
        continue;
      }
      Object.entries(mapping).forEach(([name, id]) => {
        if (typeof id !== 'string' || !id) errors.push(`rules.${key}.${name} must be a non-empty string.`);
      });
    }
  }

  return errors.length > 0
    ? { manifest: null, errors }
    : { manifest: clone(value as unknown as RuntimeBindingManifestV1), errors: [] };
}

export function validateRuntimeBindingsManifest(value: unknown): string[] {
  return readRuntimeManifest(value).errors;
}

function findDataAsset(project: ProjectDocumentV5, assetId: string): DataAssetRecordV5 | undefined {
  const asset = project.assets.find((candidate) => candidate.id === assetId);
  return asset?.kind === 'data' ? asset : undefined;
}

function findRuntimeUIDocument(
  project: ProjectDocumentV5,
  manifest: RuntimeBindingManifestV1,
): UIDocument | null {
  const uiBinding = manifest.componentBindings.find((binding) => binding.type === 'runtimeUI' && binding.assetId);
  if (!uiBinding?.assetId) return null;
  const asset = findDataAsset(project, uiBinding.assetId);
  if (!asset) return null;
  const validation = validateUIDocument(asset.value);
  return validation.ok ? clone(validation.document) : null;
}

function validateManifestReferences(
  project: ProjectDocumentV5,
  manifest: RuntimeBindingManifestV1,
  sceneId: string,
): string[] {
  const errors: string[] = [];
  const entities = new Map(project.entities.filter((entity) => entity.sceneId === sceneId).map((entity) => [entity.id, entity]));
  const assets = new Set(project.assets.map((asset) => asset.id));
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const bodies = new Set(manifest.physics.bodies.map((body) => body.id));
  for (const [index, binding] of manifest.componentBindings.entries()) {
    const path = `componentBindings[${index}]`;
    if (!entities.has(binding.entityId)) errors.push(`${path}.entityId references missing scene entity "${binding.entityId}".`);
    if ((binding.type === 'physicsBody' || binding.type === 'characterController') && (!binding.definitionId || !bodies.has(binding.definitionId))) {
      errors.push(`${path}.definitionId must reference a physics body.`);
    }
    if ((binding.type === 'scriptBehavior' || binding.type === 'runtimeUI') && (!binding.assetId || !assets.has(binding.assetId))) {
      errors.push(`${path}.assetId must reference a project asset.`);
    }
    if (binding.type === 'scriptBehavior' && binding.assetId && assetsById.get(binding.assetId)?.kind !== 'script') {
      errors.push(`${path}.assetId must reference a script asset.`);
    }
    if (binding.type === 'runtimeUI' && binding.assetId) {
      const asset = assetsById.get(binding.assetId);
      if (asset?.kind !== 'data') errors.push(`${path}.assetId must reference a data asset containing a UIDocument.`);
      else {
        const uiValidation = validateUIDocument(asset.value);
        if (!uiValidation.ok) {
          errors.push(...uiValidation.issues.map((issue) => `${path}.assetId UIDocument ${issue.path}: ${issue.message}`));
        }
      }
    }
  }
  const characterBindings = manifest.componentBindings.filter((binding) => binding.type === 'characterController');
  if (characterBindings.length !== 1) errors.push('Exactly one characterController binding is required.');
  return errors;
}

export function detectProjectRuntimeBindings(
  project: ProjectDocumentV5,
  requestedSceneId: string = project.startupSceneId,
): DetectedProjectRuntimeBindings | null {
  const projectValidation = validateProjectDocumentV5(project);
  if (!projectValidation.ok) {
    throw new ProjectGameRuntimeError('INVALID_PROJECT', 'ProjectDocumentV5 is invalid.', projectValidation.errors);
  }
  const sceneId = project.scenes.some((scene) => scene.id === requestedSceneId)
    ? requestedSceneId
    : project.startupSceneId;
  for (const asset of project.assets) {
    if (asset.kind !== 'data' || !isRecord(asset.value) || asset.value.format !== RUNTIME_BINDINGS_FORMAT) continue;
    const parsed = readRuntimeManifest(asset.value);
    if (!parsed.manifest) {
      throw new ProjectGameRuntimeError('INVALID_MANIFEST', `Runtime binding asset "${asset.id}" is invalid.`, parsed.errors);
    }
    const referenceErrors = validateManifestReferences(project, parsed.manifest, sceneId);
    if (referenceErrors.length > 0) {
      throw new ProjectGameRuntimeError('INVALID_MANIFEST', `Runtime binding asset "${asset.id}" has invalid references.`, referenceErrors);
    }
    return {
      assetId: asset.id,
      sceneId,
      manifest: parsed.manifest,
      uiDocument: findRuntimeUIDocument(project, parsed.manifest),
    };
  }
  return null;
}

function schemaForProjectType(type: ProjectVariableV5['type']): GameplayValueSchema {
  if (type === 'boolean') return { type: 'boolean' };
  if (type === 'number') return { type: 'number' };
  if (type === 'string') return { type: 'string' };
  if (type === 'vec3') return { type: 'vec3' };
  return { type: 'json' };
}

function eventFieldSchema(type: ProjectEventV5['payload'][number]['type']): GameplayValueSchema {
  if (type === 'entity' || type === 'asset') return { type: 'string' };
  return schemaForProjectType(type);
}

function projectEventDefinition(event: ProjectEventV5): GameplayEventDefinition {
  return {
    id: event.id,
    version: 1,
    fields: Object.fromEntries(event.payload.map((field) => [field.id, {
      schema: eventFieldSchema(field.type),
      optional: !field.required,
    } satisfies GameplayEventFieldDefinition])),
  };
}

function ensureEvent(
  events: GameplayEventDefinition[],
  id: string,
  fields: GameplayEventDefinition['fields'],
) {
  if (!events.some((event) => event.id === id)) events.push({ id, version: 1, fields });
}

function gameplayDefinition(
  project: ProjectDocumentV5,
  manifest: RuntimeBindingManifestV1,
  eventIds: RuntimeBindingEventIds,
): GameplayStateDefinition {
  const variables = project.variables.map((variable): GameplayVariableDefinition => ({
    id: variable.id,
    name: variable.name,
    scope: variable.scope === 'save' ? 'save' : 'session',
    schema: schemaForProjectType(variable.type),
    initialValue: clone(variable.defaultValue) as SerializableValue,
  }));
  const events = project.events.map(projectEventDefinition);
  ensureEvent(events, eventIds.roundStarted, { seconds: { schema: { type: 'number', minimum: 0 } } });
  ensureEvent(events, eventIds.pickupCollected, {
    pickup: { schema: { type: 'string' } },
    score: { schema: { type: 'number', integer: true, minimum: 0 } },
  });
  ensureEvent(events, eventIds.exitReached, {});
  ensureEvent(events, eventIds.roundWon, {
    score: { schema: { type: 'number', integer: true, minimum: 0 } },
    timeRemaining: { schema: { type: 'number', minimum: 0 } },
  });
  ensureEvent(events, eventIds.roundFailed, { reason: { schema: { type: 'string', minimumLength: 1 } } });
  ensureEvent(events, manifest.rules.resetEventId, {});
  return {
    id: `runtime:${project.id}`,
    version: 1,
    fixedHz: Math.round(1 / manifest.fixedDeltaSeconds),
    variables,
    events,
    timers: [{
      id: ROUND_TIMER_ID,
      name: 'Round countdown',
      durationSeconds: manifest.rules.roundSeconds,
      autoStart: true,
      scope: 'session',
    }],
    objectives: [
      {
        id: PICKUP_OBJECTIVE_ID,
        title: 'Collect pickups',
        target: manifest.rules.pickupTarget,
        required: true,
        autoActivate: true,
        scope: 'session',
      },
      {
        id: EXIT_OBJECTIVE_ID,
        title: 'Reach exit',
        target: 1,
        required: true,
        autoActivate: true,
        scope: 'session',
      },
    ],
    score: {
      initialValue: 0,
      minimum: 0,
      maximum: manifest.rules.pickupTarget,
      integer: true,
      higherIsBetter: true,
      scope: 'session',
    },
    flow: { autoWinOnRequiredObjectives: true, autoFailOnRequiredObjectiveFailure: true },
  };
}

function readNumberProperty(binding: RuntimeBindingComponent | undefined, key: string, fallback: number): number {
  const value = binding?.properties?.[key];
  return isFiniteNumber(value) ? value : fallback;
}

function playerHalfExtents(definition: PhysicsRigidBodyDefinition): { x: number; y: number; z: number } {
  let x = 0.25;
  let y = 0.5;
  let z = 0.25;
  for (const collider of definition.colliders) {
    const shape = collider.shape;
    if (shape.type === 'box') {
      x = Math.max(x, shape.halfExtents[0]);
      y = Math.max(y, shape.halfExtents[1]);
      z = Math.max(z, shape.halfExtents[2]);
    } else if (shape.type === 'sphere') {
      x = Math.max(x, shape.radius);
      y = Math.max(y, shape.radius);
      z = Math.max(z, shape.radius);
    } else {
      x = Math.max(x, shape.radius);
      y = Math.max(y, shape.halfHeight + shape.radius);
      z = Math.max(z, shape.radius);
    }
  }
  return { x, y, z };
}

function buildHorizontalObstacles(
  bodies: readonly PhysicsRigidBodyDefinition[],
  excludedBodyId: string,
  halfExtents: { x: number; y: number; z: number },
): HorizontalObstacle[] {
  const result: HorizontalObstacle[] = [];
  for (const body of bodies) {
    if (body.id === excludedBodyId || body.type !== 'fixed' || body.enabled === false) continue;
    const bodyPosition = body.position ?? [0, 0, 0];
    for (const collider of body.colliders) {
      if (collider.sensor || collider.shape.type !== 'box') continue;
      const offset = collider.position ?? [0, 0, 0];
      const centerX = bodyPosition[0] + offset[0];
      const centerY = bodyPosition[1] + offset[1];
      const centerZ = bodyPosition[2] + offset[2];
      result.push({
        minX: centerX - collider.shape.halfExtents[0] - halfExtents.x,
        maxX: centerX + collider.shape.halfExtents[0] + halfExtents.x,
        minY: centerY - collider.shape.halfExtents[1] - halfExtents.y,
        maxY: centerY + collider.shape.halfExtents[1] + halfExtents.y,
        minZ: centerZ - collider.shape.halfExtents[2] - halfExtents.z,
        maxZ: centerZ + collider.shape.halfExtents[2] + halfExtents.z,
      });
    }
  }
  return result;
}

function colliderHalfExtents(collider: PhysicsRigidBodyDefinition['colliders'][number]) {
  const shape = collider.shape;
  if (shape.type === 'box') return {
    x: shape.halfExtents[0],
    y: shape.halfExtents[1],
    z: shape.halfExtents[2],
  };
  if (shape.type === 'sphere') return { x: shape.radius, y: shape.radius, z: shape.radius };
  return { x: shape.radius, y: shape.halfHeight + shape.radius, z: shape.radius };
}

function bodyBounds(
  definition: PhysicsRigidBodyDefinition,
  position: PhysicsVector3,
  sensorsOnly = false,
): AxisAlignedBounds | null {
  let bounds: AxisAlignedBounds | null = null;
  for (const collider of definition.colliders) {
    if (sensorsOnly && !collider.sensor) continue;
    const offset = collider.position ?? [0, 0, 0];
    const half = colliderHalfExtents(collider);
    const next: AxisAlignedBounds = {
      minX: position[0] + offset[0] - half.x,
      maxX: position[0] + offset[0] + half.x,
      minY: position[1] + offset[1] - half.y,
      maxY: position[1] + offset[1] + half.y,
      minZ: position[2] + offset[2] - half.z,
      maxZ: position[2] + offset[2] + half.z,
    };
    bounds = bounds ? {
      minX: Math.min(bounds.minX, next.minX),
      maxX: Math.max(bounds.maxX, next.maxX),
      minY: Math.min(bounds.minY, next.minY),
      maxY: Math.max(bounds.maxY, next.maxY),
      minZ: Math.min(bounds.minZ, next.minZ),
      maxZ: Math.max(bounds.maxZ, next.maxZ),
    } : next;
  }
  return bounds;
}

function boundsOverlap(left: AxisAlignedBounds, right: AxisAlignedBounds) {
  return left.minX <= right.maxX && left.maxX >= right.minX
    && left.minY <= right.maxY && left.maxY >= right.minY
    && left.minZ <= right.maxZ && left.maxZ >= right.minZ;
}

function resolveHorizontalMovement(
  current: PhysicsVector3,
  desired: PhysicsVector3,
  obstacles: readonly HorizontalObstacle[],
): PhysicsVector3 {
  let x = desired[0];
  const y = current[1];
  const movingX = x - current[0];
  for (const obstacle of obstacles) {
    if (y < obstacle.minY || y > obstacle.maxY || current[2] <= obstacle.minZ || current[2] >= obstacle.maxZ) continue;
    if (movingX > 0 && current[0] <= obstacle.minX && x > obstacle.minX) x = Math.min(x, obstacle.minX - POSITION_EPSILON);
    else if (movingX < 0 && current[0] >= obstacle.maxX && x < obstacle.maxX) x = Math.max(x, obstacle.maxX + POSITION_EPSILON);
  }
  let z = desired[2];
  const movingZ = z - current[2];
  for (const obstacle of obstacles) {
    if (y < obstacle.minY || y > obstacle.maxY || x <= obstacle.minX || x >= obstacle.maxX) continue;
    if (movingZ > 0 && current[2] <= obstacle.minZ && z > obstacle.minZ) z = Math.min(z, obstacle.minZ - POSITION_EPSILON);
    else if (movingZ < 0 && current[2] >= obstacle.maxZ && z < obstacle.maxZ) z = Math.max(z, obstacle.maxZ + POSITION_EPSILON);
  }
  return [x, current[1], z];
}

function flattenElements(element: UIElement, result: UIElement[] = []): UIElement[] {
  result.push(element);
  if (element.type === 'screen' || element.type === 'stack' || element.type === 'panel') {
    element.children.forEach((child) => flattenElements(child, result));
  }
  return result;
}

class ProjectGameRuntimeControllerImpl implements ProjectGameRuntimeController {
  readonly sceneId: string;
  readonly manifestAssetId: string;

  private statusValue: ProjectGameRuntimeStatus = 'ready';
  private readonly project: ProjectDocumentV5;
  private readonly manifest: RuntimeBindingManifestV1;
  private readonly host: ProjectGameRuntimeHost;
  private readonly input: InputRuntime;
  private readonly physics: PhysicsWorld;
  private readonly gameplay: GameplayStateStore;
  private readonly bodyToEntity = new Map<string, string>();
  private readonly entityById = new Map<string, EntityV5>();
  private readonly runtimeActive = new Map<string, boolean>();
  private readonly pickupBodyIds = new Set<string>();
  private readonly exitBodyIds = new Set<string>();
  private readonly collectedEntityIds = new Set<string>();
  private readonly virtualActions = new Map<string, boolean>();
  private readonly pulseActions = new Set<string>();
  private readonly connectedGamepads = new Set<number>();
  private readonly overlappingSensorBodies = new Set<string>();
  private readonly cleanupCallbacks: Array<() => void> = [];
  private readonly obstacles: HorizontalObstacle[];
  private readonly playerEntityId: string;
  private readonly playerBodyId: string;
  private readonly moveActionId: string;
  private readonly restartActionId: string;
  private readonly moveSpeed: number;
  private readonly variableIds: RuntimeBindingVariableIds;
  private readonly eventIds: RuntimeBindingEventIds;
  private readonly initialBodies: PhysicsRigidBodyDefinition[];
  private readonly transformTarget: PhysicsTransform = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  private readonly touchAvailable: boolean;
  private ui: RuntimeUIController | null = null;
  private tickValue = 0;
  private restartCountValue = 0;
  private processedCollisionEvents = 0;
  private pendingRestart = false;
  private statusMessage = 'Collect every pickup, then reach the exit.';
  private initialStatusMessage = this.statusMessage;
  private exitUnlocked = false;
  private diagnostics: ProjectGameRuntimeDiagnostic[] = [];
  private lastHUDJson = '';
  private lastSnapshot!: ProjectGameRuntimeSnapshot;

  constructor(
    project: ProjectDocumentV5,
    detected: DetectedProjectRuntimeBindings,
    physics: PhysicsWorld,
    host: ProjectGameRuntimeHost,
  ) {
    this.project = project;
    this.sceneId = detected.sceneId;
    this.manifestAssetId = detected.assetId;
    this.manifest = detected.manifest;
    this.host = host;
    this.input = new InputRuntime(this.manifest.input);
    this.physics = physics;
    this.variableIds = { ...DEFAULT_VARIABLE_IDS, ...(this.manifest.rules.variableIds ?? {}) };
    this.eventIds = { ...DEFAULT_EVENT_IDS, ...(this.manifest.rules.eventIds ?? {}) };
    this.gameplay = new GameplayStateStore(gameplayDefinition(project, this.manifest, this.eventIds));
    this.initialBodies = clone(this.manifest.physics.bodies);
    this.touchAvailable = host.touchAvailable ?? Boolean(
      host.hudTarget?.ownerDocument.defaultView?.navigator.maxTouchPoints,
    );

    const character = this.manifest.componentBindings.find((binding) => binding.type === 'characterController')!;
    this.playerEntityId = character.entityId;
    this.playerBodyId = character.definitionId!;
    const script = this.manifest.componentBindings.find((binding) => binding.type === 'scriptBehavior');
    this.moveActionId = this.manifest.rules.moveActionId ?? RUNTIME_INPUT_ACTION_CODES.move;
    this.restartActionId = this.manifest.rules.restartActionId ?? RUNTIME_INPUT_ACTION_CODES.restart;
    this.moveSpeed = this.manifest.rules.moveSpeed ?? readNumberProperty(script, 'moveSpeed', 5.5);

    for (const entity of project.entities.filter((candidate) => candidate.sceneId === this.sceneId)) {
      this.entityById.set(entity.id, entity);
      this.runtimeActive.set(entity.id, entity.active);
    }
    for (const binding of this.manifest.componentBindings) {
      if ((binding.type === 'physicsBody' || binding.type === 'characterController') && binding.definitionId) {
        this.bodyToEntity.set(binding.definitionId, binding.entityId);
      }
    }
    const pickupTag = this.manifest.rules.pickupTag ?? 'pickup';
    const exitTag = this.manifest.rules.exitTag ?? 'exit';
    for (const [bodyId, entityId] of this.bodyToEntity) {
      const entity = this.entityById.get(entityId);
      if (entity?.tags.includes(pickupTag) || entity?.tags.includes('collectible')) this.pickupBodyIds.add(bodyId);
      if (entity?.tags.includes(exitTag)) this.exitBodyIds.add(bodyId);
    }
    const playerDefinition = this.initialBodies.find((body) => body.id === this.playerBodyId)!;
    this.obstacles = buildHorizontalObstacles(this.initialBodies, this.playerBodyId, playerHalfExtents(playerDefinition));

    const statusVariable = project.variables.find((variable) => variable.id === this.variableIds.statusMessage);
    if (statusVariable?.type === 'string' && typeof statusVariable.defaultValue === 'string') {
      this.statusMessage = statusVariable.defaultValue;
    }
    this.initialStatusMessage = this.statusMessage;
    this.subscribeHostEvents();
    if (detected.uiDocument && host.hudTarget) this.mountHUD(detected.uiDocument, host.hudTarget);
    this.initializeRoundVariables();
    this.syncTransforms();
    this.refreshSnapshot(true);
  }

  get status() {
    return this.statusValue;
  }

  start(): ProjectGameRuntimeSnapshot {
    this.assertNotDisposed();
    if (this.statusValue === 'failed') throw new ProjectGameRuntimeError('INVALID_STATE', 'Failed runtime must be restarted.');
    if (this.statusValue === 'paused') return this.resume();
    if (this.statusValue === 'running') return this.getSnapshot();
    this.gameplay.start();
    this.statusValue = 'running';
    this.emit(this.eventIds.roundStarted, { seconds: this.manifest.rules.roundSeconds });
    this.drainEvents();
    this.syncTransforms();
    return this.refreshSnapshot(true);
  }

  pause(): ProjectGameRuntimeSnapshot {
    this.assertNotDisposed();
    if (this.statusValue !== 'running') throw new ProjectGameRuntimeError('INVALID_STATE', `Cannot pause runtime while ${this.statusValue}.`);
    if (this.gameplay.phase === 'running') this.gameplay.pause();
    this.statusValue = 'paused';
    this.releaseTransientInput();
    this.drainEvents();
    return this.refreshSnapshot(true);
  }

  resume(): ProjectGameRuntimeSnapshot {
    this.assertNotDisposed();
    if (this.statusValue !== 'paused') throw new ProjectGameRuntimeError('INVALID_STATE', `Cannot resume runtime while ${this.statusValue}.`);
    if (this.gameplay.phase === 'paused') this.gameplay.resume();
    this.statusValue = 'running';
    this.drainEvents();
    return this.refreshSnapshot(true);
  }

  setKeyboardKey(code: string, pressed: boolean) {
    this.assertNotDisposed();
    this.input.setKeyboardKey(code, pressed);
  }

  setPointerButton(button: number, pressed: boolean | number) {
    this.assertNotDisposed();
    this.input.setPointerButton(button, pressed);
  }

  setPointerPosition(x: number, y: number) {
    this.assertNotDisposed();
    this.input.setPointerPosition(x, y);
  }

  addPointerDelta(deltaX: number, deltaY: number) {
    this.assertNotDisposed();
    this.input.addPointerDelta(deltaX, deltaY);
  }

  addWheelDelta(deltaX: number, deltaY: number) {
    this.assertNotDisposed();
    this.input.addWheelDelta(deltaX, deltaY);
  }

  setTouch(touchId: number, x: number, y: number) {
    this.assertNotDisposed();
    this.input.setTouch(touchId, x, y);
  }

  removeTouch(touchId: number) {
    this.assertNotDisposed();
    this.input.removeTouch(touchId);
  }

  setGamepadButton(gamepad: number, button: number, value: number) {
    this.assertNotDisposed();
    this.connectedGamepads.add(gamepad);
    this.input.setGamepadButton(gamepad, button, value);
  }

  setGamepadAxis(gamepad: number, axis: number, value: number) {
    this.assertNotDisposed();
    this.connectedGamepads.add(gamepad);
    this.input.setGamepadAxis(gamepad, axis, value);
  }

  removeGamepad(gamepad: number) {
    this.assertNotDisposed();
    this.connectedGamepads.delete(gamepad);
    this.input.removeGamepad(gamepad);
  }

  setVirtualAction(actionId: string, pressed: boolean) {
    this.assertNotDisposed();
    if (!actionId) throw new TypeError('Virtual action id must be a non-empty string.');
    if (pressed) this.virtualActions.set(actionId, true);
    else this.virtualActions.delete(actionId);
  }

  pulseAction(actionId: string) {
    this.assertNotDisposed();
    if (!actionId) throw new TypeError('Virtual action id must be a non-empty string.');
    this.pulseActions.add(actionId);
  }

  fixedUpdate(deltaSeconds = this.manifest.fixedDeltaSeconds): ProjectGameRuntimeSnapshot {
    this.assertNotDisposed();
    if (this.statusValue !== 'running') {
      throw new ProjectGameRuntimeError('INVALID_STATE', `Cannot fixed-update runtime while ${this.statusValue}.`);
    }
    if (!isFiniteNumber(deltaSeconds) || Math.abs(deltaSeconds - this.manifest.fixedDeltaSeconds) > 1e-10) {
      throw new TypeError(`Project runtime fixedUpdate requires exactly ${this.manifest.fixedDeltaSeconds} seconds.`);
    }

    try {
      this.pollGamepads();
      this.input.update();
      this.tickValue += 1;
      if (this.pendingRestart || this.isActionStarted(this.restartActionId) || this.isVirtualActive(this.restartActionId)) {
        this.pendingRestart = false;
        this.clearPulses();
        return this.restart();
      }

      if (this.gameplay.phase === 'running') {
        this.applyPlayerMovement(deltaSeconds);
        this.physics.step(deltaSeconds);
        this.processCollisions();
        if (this.gameplay.phase === 'running') {
          this.gameplay.step(1);
          const timer = this.gameplay.getTimer(ROUND_TIMER_ID);
          this.setVariable(this.variableIds.timeRemaining, timer?.remainingSeconds ?? 0);
          if (timer?.status === 'elapsed') this.failRound('Time expired');
        }
      }
      this.syncTransforms();
      this.drainEvents();
      this.clearPulses();
      return this.refreshSnapshot();
    } catch (error) {
      this.statusValue = 'failed';
      this.report('error', 'RUNTIME_ERROR', errorMessage(error));
      this.clearPulses();
      this.refreshSnapshot(true);
      throw error;
    }
  }

  restart(): ProjectGameRuntimeSnapshot {
    this.assertNotDisposed();
    this.physics.reset(this.initialBodies);
    this.physics.setBodyTranslation(this.playerBodyId, clone(this.manifest.rules.playerSpawn));
    this.gameplay.restart('session', true);
    this.input.reset();
    this.virtualActions.clear();
    this.pulseActions.clear();
    this.pendingRestart = false;
    this.tickValue = 0;
    this.restartCountValue += 1;
    this.processedCollisionEvents = 0;
    this.collectedEntityIds.clear();
    this.overlappingSensorBodies.clear();
    this.exitUnlocked = false;
    this.statusMessage = this.initialStatusMessage;
    for (const bodyId of this.pickupBodyIds) {
      const entityId = this.bodyToEntity.get(bodyId)!;
      this.setEntityActive(entityId, this.entityById.get(entityId)?.active ?? true);
    }
    this.initializeRoundVariables();
    this.statusValue = 'running';
    this.emit(this.manifest.rules.resetEventId, {});
    this.emit(this.eventIds.roundStarted, { seconds: this.manifest.rules.roundSeconds });
    this.syncTransforms();
    this.drainEvents();
    return this.refreshSnapshot(true);
  }

  getSnapshot(): ProjectGameRuntimeSnapshot {
    return clone(this.lastSnapshot);
  }

  getDiagnostics(): ProjectGameRuntimeDiagnostics {
    const lastDiagnostic = this.diagnostics.at(-1) ?? null;
    return {
      status: this.statusValue,
      tick: this.tickValue,
      restartCount: this.restartCountValue,
      processedCollisionEvents: this.processedCollisionEvents,
      collectedPickups: this.collectedEntityIds.size,
      activeRuntimeEntities: [...this.runtimeActive.values()].filter(Boolean).length,
      input: clone(this.input.getDiagnostics()),
      physics: clone(this.physics.getDiagnostics()),
      hudMounted: this.ui !== null,
      diagnosticCount: this.diagnostics.length,
      lastDiagnostic: lastDiagnostic ? clone(lastDiagnostic) : null,
    };
  }

  dispose() {
    if (this.statusValue === 'disposed') return;
    this.refreshSnapshot(true);
    this.cleanupCallbacks.splice(0).reverse().forEach((cleanup) => {
      try { cleanup(); } catch { /* Best-effort host listener cleanup. */ }
    });
    this.ui?.dispose();
    this.ui = null;
    this.input.releaseAll();
    this.virtualActions.clear();
    this.pulseActions.clear();
    this.connectedGamepads.clear();
    this.physics.dispose();
    this.gameplay.dispose();
    this.statusValue = 'disposed';
    this.lastSnapshot = { ...this.lastSnapshot, status: 'disposed' };
  }

  private assertNotDisposed() {
    if (this.statusValue === 'disposed') throw new ProjectGameRuntimeError('DISPOSED', 'Project game runtime is disposed.');
  }

  private subscribeHostEvents() {
    if (!this.host.onEvent) return;
    const ids = new Set([
      ...this.project.events.map((event) => event.id),
      ...Object.values(this.eventIds),
      this.manifest.rules.resetEventId,
      ...BUILT_IN_EVENT_IDS,
    ]);
    ids.forEach((id) => {
      const unsubscribe = this.gameplay.events.subscribe(id, (event) => {
        try {
          this.host.onEvent?.(clone(event));
        } catch (error) {
          this.report('warning', 'RUNTIME_ERROR', `Runtime event host callback failed: ${errorMessage(error)}`);
        }
      });
      this.cleanupCallbacks.push(unsubscribe);
    });
  }

  private mountHUD(document: UIDocument, target: HTMLElement) {
    const suppressedClicks = new Set<string>();
    this.ui = mountRuntimeUI({
      target,
      document,
      variables: this.hudVariables(),
      actionPrompts: { [this.moveActionId]: 'WASD / Left stick', [this.restartActionId]: 'R' },
      onAction: (action) => {
        if (suppressedClicks.delete(action.sourceElementId)) return;
        this.handleUIAction(action);
      },
      onEvent: (event) => this.handleUIEvent(event),
      onDiagnostic: (diagnostic) => this.handleUIDiagnostic(diagnostic),
    });

    const holdPrefix = `${this.moveActionId}.`;
    for (const element of flattenElements(document.root)) {
      if (element.type !== 'button') continue;
      const actions = element.activations.filter((binding) => (
        binding.type === 'action' && binding.phase !== 'released' && binding.actionId.startsWith(holdPrefix)
      ));
      if (actions.length === 0) continue;
      const button = this.ui.getElement(element.id);
      if (!(button instanceof target.ownerDocument.defaultView!.HTMLButtonElement)) continue;
      const press = (event: PointerEvent) => {
        suppressedClicks.add(element.id);
        actions.forEach((binding) => binding.type === 'action' && this.setVirtualAction(binding.actionId, true));
        try { button.setPointerCapture(event.pointerId); } catch { /* Pointer may already be released. */ }
      };
      const release = () => actions.forEach((binding) => binding.type === 'action' && this.setVirtualAction(binding.actionId, false));
      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
      this.cleanupCallbacks.push(() => {
        release();
        button.removeEventListener('pointerdown', press);
        button.removeEventListener('pointerup', release);
        button.removeEventListener('pointercancel', release);
        button.removeEventListener('lostpointercapture', release);
      });
    }
    const releaseHeldActions = () => this.virtualActions.clear();
    const ownerWindow = target.ownerDocument.defaultView;
    ownerWindow?.addEventListener('blur', releaseHeldActions);
    this.cleanupCallbacks.push(() => ownerWindow?.removeEventListener('blur', releaseHeldActions));
  }

  private handleUIAction(action: UIActionDispatch) {
    if (action.actionId === this.restartActionId && action.phase === 'pressed') {
      this.pendingRestart = true;
      return;
    }
    if (action.phase === 'released') this.setVirtualAction(action.actionId, false);
    else this.pulseAction(action.actionId);
  }

  private handleUIEvent(event: UIEventDispatch) {
    if (event.eventId === this.manifest.rules.resetEventId) this.pendingRestart = true;
  }

  private handleUIDiagnostic(diagnostic: UIDiagnostic) {
    this.report('warning', 'UI_DIAGNOSTIC', diagnostic.message, [diagnostic.code, diagnostic.elementId ?? 'unknown-element']);
  }

  private releaseTransientInput() {
    this.input.releaseAll();
    this.virtualActions.clear();
    this.pulseActions.clear();
  }

  private pollGamepads() {
    if (!this.host.getGamepads) return;
    try {
      const snapshots = this.host.getGamepads();
      const seen = new Set<number>();
      for (const snapshot of snapshots) {
        if (!Number.isInteger(snapshot.index) || snapshot.index < 0 || snapshot.connected === false) continue;
        seen.add(snapshot.index);
        snapshot.buttons.forEach((button, index) => {
          const value = typeof button === 'number' ? button : button.value;
          if (isFiniteNumber(value)) this.input.setGamepadButton(snapshot.index, index, value);
        });
        snapshot.axes.forEach((value, index) => {
          if (isFiniteNumber(value)) this.input.setGamepadAxis(snapshot.index, index, value);
        });
      }
      for (const index of this.connectedGamepads) if (!seen.has(index)) this.input.removeGamepad(index);
      this.connectedGamepads.clear();
      seen.forEach((index) => this.connectedGamepads.add(index));
    } catch (error) {
      this.report('warning', 'INPUT_HOST_ERROR', `Gamepad host adapter failed: ${errorMessage(error)}`);
    }
  }

  private isActionStarted(actionId: string): boolean {
    let started = false;
    this.input.forEachEvent((event) => {
      if (event.actionId === actionId && event.phase === 'started') started = true;
    });
    return started;
  }

  private isVirtualActive(actionId: string): boolean {
    return this.virtualActions.get(actionId) === true || this.pulseActions.has(actionId);
  }

  private clearPulses() {
    this.pulseActions.clear();
  }

  private applyPlayerMovement(deltaSeconds: number) {
    const transform = this.physics.getBodyTransform(this.playerBodyId, this.transformTarget);
    if (!transform) throw new Error(`Player physics body "${this.playerBodyId}" is unavailable.`);
    const move = this.input.getActionState(this.moveActionId)?.value ?? [0, 0];
    let x = move[0]
      + Number(this.isVirtualActive(`${this.moveActionId}.right`))
      - Number(this.isVirtualActive(`${this.moveActionId}.left`));
    let z = move[1]
      + Number(this.isVirtualActive(`${this.moveActionId}.down`))
      - Number(this.isVirtualActive(`${this.moveActionId}.up`));
    const magnitude = Math.hypot(x, z);
    if (magnitude > 1) {
      x /= magnitude;
      z /= magnitude;
    }
    const desired: PhysicsVector3 = [
      transform.position[0] + x * this.moveSpeed * deltaSeconds,
      transform.position[1],
      transform.position[2] + z * this.moveSpeed * deltaSeconds,
    ];
    const resolved = resolveHorizontalMovement(transform.position, desired, this.obstacles);
    this.physics.setKinematicTarget(this.playerBodyId, resolved, transform.rotation);
  }

  private processCollisions() {
    const enteredBodies = new Set<string>();
    this.physics.drainCollisionEvents((event) => {
      this.processedCollisionEvents += 1;
      if (!event.started || !event.sensor) return;
      const otherBody = event.bodyAId === this.playerBodyId
        ? event.bodyBId
        : event.bodyBId === this.playerBodyId ? event.bodyAId : null;
      if (!otherBody) return;
      enteredBodies.add(otherBody);
    });
    this.detectSensorEntries().forEach((bodyId) => enteredBodies.add(bodyId));
    [...enteredBodies].filter((bodyId) => this.pickupBodyIds.has(bodyId)).sort().forEach((bodyId) => this.collectPickup(bodyId));
    if ([...enteredBodies].some((bodyId) => this.exitBodyIds.has(bodyId))) this.reachExit();
  }

  /**
   * Rapier does not emit kinematic-vs-fixed sensor events unless a world opts
   * into that collision class. The project wrapper intentionally keeps its
   * defaults conservative, so the binding adapter deterministically derives
   * sensor enter transitions from the same serialized collider definitions.
   */
  private detectSensorEntries(): string[] {
    const playerDefinition = this.initialBodies.find((body) => body.id === this.playerBodyId);
    const playerTransform = this.physics.getBodyTransform(this.playerBodyId);
    if (!playerDefinition || !playerTransform) return [];
    const playerBounds = bodyBounds(playerDefinition, playerTransform.position);
    if (!playerBounds) return [];
    const current = new Set<string>();
    const entered: string[] = [];
    const candidates = new Set([...this.pickupBodyIds, ...this.exitBodyIds]);
    for (const bodyId of candidates) {
      const entityId = this.bodyToEntity.get(bodyId);
      if (!entityId || this.runtimeActive.get(entityId) === false) continue;
      const definition = this.initialBodies.find((body) => body.id === bodyId);
      const transform = this.physics.getBodyTransform(bodyId);
      if (!definition || !transform) continue;
      const sensorBounds = bodyBounds(definition, transform.position, true);
      if (!sensorBounds || !boundsOverlap(playerBounds, sensorBounds)) continue;
      current.add(bodyId);
      if (!this.overlappingSensorBodies.has(bodyId)) entered.push(bodyId);
    }
    this.overlappingSensorBodies.clear();
    current.forEach((bodyId) => this.overlappingSensorBodies.add(bodyId));
    this.processedCollisionEvents += entered.length;
    return entered;
  }

  private collectPickup(bodyId: string) {
    const entityId = this.bodyToEntity.get(bodyId);
    if (!entityId || this.collectedEntityIds.has(entityId)) return;
    this.collectedEntityIds.add(entityId);
    this.overlappingSensorBodies.delete(bodyId);
    this.physics.removeRigidBody(bodyId);
    this.setEntityActive(entityId, false);
    this.gameplay.addScore(1);
    this.gameplay.addObjectiveProgress(PICKUP_OBJECTIVE_ID, 1);
    const score = this.gameplay.score;
    const remaining = Math.max(0, this.manifest.rules.pickupTarget - score);
    this.setVariable(this.variableIds.score, score);
    this.setVariable(this.variableIds.pickupsRemaining, remaining);
    this.emit(this.eventIds.pickupCollected, { pickup: entityId, score });
    if (remaining === 0) {
      this.exitUnlocked = true;
      this.statusMessage = 'Exit unlocked — reach the portal!';
      this.setVariable(this.variableIds.exitUnlocked, true);
      this.setVariable(this.variableIds.statusMessage, this.statusMessage);
    }
  }

  private reachExit() {
    this.emit(this.eventIds.exitReached, {});
    if (!this.exitUnlocked) {
      this.statusMessage = 'Collect every pickup first.';
      this.setVariable(this.variableIds.statusMessage, this.statusMessage);
      return;
    }
    this.statusMessage = 'Escaped!';
    this.setVariable(this.variableIds.roundState, 'won');
    this.setVariable(this.variableIds.gameOver, true);
    this.setVariable(this.variableIds.statusMessage, this.statusMessage);
    this.gameplay.completeObjective(EXIT_OBJECTIVE_ID);
    if (this.gameplay.phase !== 'won') this.gameplay.requestWin('Exit reached.');
    this.emit(this.eventIds.roundWon, {
      score: this.gameplay.score,
      timeRemaining: this.gameplay.getTimer(ROUND_TIMER_ID)?.remainingSeconds ?? 0,
    });
  }

  private failRound(reason: string) {
    this.statusMessage = reason;
    this.setVariable(this.variableIds.roundState, 'failed');
    this.setVariable(this.variableIds.gameOver, true);
    this.setVariable(this.variableIds.statusMessage, reason);
    this.gameplay.requestFail(reason);
    this.emit(this.eventIds.roundFailed, { reason });
  }

  private initializeRoundVariables() {
    this.setVariable(this.variableIds.score, 0);
    this.setVariable(this.variableIds.pickupsRemaining, this.manifest.rules.pickupTarget);
    this.setVariable(this.variableIds.timeRemaining, this.manifest.rules.roundSeconds);
    this.setVariable(this.variableIds.roundState, 'playing');
    this.setVariable(this.variableIds.statusMessage, this.statusMessage);
    this.setVariable(this.variableIds.gameOver, false);
    this.setVariable(this.variableIds.exitUnlocked, false);
    this.setVariable(this.variableIds.touchAvailable, this.touchAvailable);
  }

  private setVariable(id: string, value: SerializableValue) {
    if (!this.gameplay.variables.getDefinition(id)) return;
    const result = this.gameplay.setVariable(id, value);
    if (!result.ok) this.report('warning', 'RUNTIME_ERROR', result.message, result.errors);
  }

  private emit(eventId: string, payload: SerializableRecord) {
    const result = this.gameplay.events.enqueueById(eventId, payload, { tick: this.tickValue });
    if (!result.ok) this.report('warning', 'EVENT_REJECTED', `Event "${eventId}" was rejected.`, result.errors);
  }

  private drainEvents() {
    const result = this.gameplay.events.drain();
    result.errors.forEach((error) => this.report(
      'warning',
      'RUNTIME_ERROR',
      `Gameplay event listener failed for "${error.eventId}": ${error.message}`,
    ));
  }

  private setEntityActive(entityId: string, active: boolean) {
    if (this.runtimeActive.get(entityId) === active) return;
    this.runtimeActive.set(entityId, active);
    try {
      this.host.setEntityActive?.(entityId, active);
    } catch (error) {
      this.report('warning', 'RUNTIME_ERROR', `Entity-active host callback failed: ${errorMessage(error)}`);
    }
  }

  private syncTransforms() {
    for (const [bodyId, entityId] of this.bodyToEntity) {
      const active = this.runtimeActive.get(entityId) ?? false;
      if (!active) continue;
      const transform = this.physics.getBodyTransform(bodyId);
      if (!transform) continue;
      try {
        this.host.setEntityTransform?.({
          entityId,
          bodyId,
          position: [...transform.position],
          rotation: [...transform.rotation],
          active,
        });
      } catch (error) {
        this.report('warning', 'RUNTIME_ERROR', `Entity-transform host callback failed: ${errorMessage(error)}`);
      }
    }
  }

  private hudVariables(): Record<string, string | number | boolean> {
    const hud = this.createHUDSnapshot();
    return {
      [this.variableIds.score]: hud.score,
      [this.variableIds.pickupsRemaining]: hud.pickupsRemaining,
      [this.variableIds.timeRemaining]: hud.timeRemaining,
      [this.variableIds.roundState]: hud.roundState,
      [this.variableIds.statusMessage]: hud.statusMessage,
      [this.variableIds.gameOver]: hud.gameOver,
      [this.variableIds.exitUnlocked]: hud.exitUnlocked,
      [this.variableIds.touchAvailable]: hud.touchAvailable,
    };
  }

  private createHUDSnapshot(): ProjectGameRuntimeHUDSnapshot {
    const timer = this.gameplay.getTimer(ROUND_TIMER_ID);
    const phase = this.gameplay.phase === 'won' ? 'won' : this.gameplay.phase === 'failed' ? 'failed' : 'playing';
    return {
      score: this.gameplay.score,
      pickupTarget: this.manifest.rules.pickupTarget,
      pickupsRemaining: Math.max(0, this.manifest.rules.pickupTarget - this.gameplay.score),
      timeRemaining: timer?.remainingSeconds ?? this.manifest.rules.roundSeconds,
      roundState: phase,
      statusMessage: this.statusMessage,
      gameOver: phase !== 'playing',
      exitUnlocked: this.exitUnlocked,
      touchAvailable: this.touchAvailable,
    };
  }

  private refreshSnapshot(forceHUD = false): ProjectGameRuntimeSnapshot {
    const hud = this.createHUDSnapshot();
    const hudJson = JSON.stringify(hud);
    if (forceHUD || hudJson !== this.lastHUDJson) {
      this.lastHUDJson = hudJson;
      const updateResult = this.ui?.setVariables(this.hudVariables());
      if (updateResult && !updateResult.ok) {
        this.report('warning', 'UI_DIAGNOSTIC', updateResult.message);
      }
      try {
        this.host.onHUDChange?.(clone(hud));
      } catch (error) {
        this.report('warning', 'RUNTIME_ERROR', `HUD host callback failed: ${errorMessage(error)}`);
      }
    }
    this.lastSnapshot = {
      status: this.statusValue,
      projectId: this.project.id,
      sceneId: this.sceneId,
      manifestAssetId: this.manifestAssetId,
      tick: this.tickValue,
      restartCount: this.restartCountValue,
      playerEntityId: this.playerEntityId,
      playerBodyId: this.playerBodyId,
      activeEntityIds: [...this.runtimeActive].filter(([, active]) => active).map(([id]) => id).sort(),
      collectedEntityIds: [...this.collectedEntityIds].sort(),
      hud,
      gameplay: this.gameplay.snapshot(),
    };
    return this.getSnapshot();
  }

  private report(
    level: ProjectGameRuntimeDiagnostic['level'],
    code: ProjectGameRuntimeDiagnosticCode,
    message: string,
    details?: string[],
  ) {
    const diagnostic: ProjectGameRuntimeDiagnostic = { level, code, message, tick: this.tickValue };
    if (details?.length) diagnostic.details = [...details];
    this.diagnostics.push(diagnostic);
    if (this.diagnostics.length > 100) this.diagnostics.shift();
    try {
      this.host.onDiagnostic?.(clone(diagnostic));
    } catch {
      // Diagnostics are observational and must never take down the simulation.
    }
  }
}

export async function createProjectGameRuntime(
  options: CreateProjectGameRuntimeOptions,
): Promise<ProjectGameRuntimeController | null> {
  const detected = detectProjectRuntimeBindings(options.project, options.sceneId);
  if (!detected) return null;
  const physics = new PhysicsWorld({
    gravity: clone(detected.manifest.physics.gravity),
    bodies: clone(detected.manifest.physics.bodies),
    maxSubSteps: 1,
  });
  try {
    await physics.initialize();
    return new ProjectGameRuntimeControllerImpl(
      clone(options.project),
      detected,
      physics,
      options.host ?? {},
    );
  } catch (error) {
    physics.dispose();
    if (error instanceof ProjectGameRuntimeError) throw error;
    throw new ProjectGameRuntimeError(
      'INVALID_STATE',
      `Project game runtime initialization failed: ${errorMessage(error)}`,
      [],
      { cause: error },
    );
  }
}
