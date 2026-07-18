import { KEYBOARD_CODE_PATTERN } from './inputActions';
import type {
  AssetRecord,
  AssetSourceV5,
  BuildProfileV5,
  EntityV5,
  InputActionV5,
  InputBindingV5,
  InputMapV5,
  JsonValueV5,
  LayerDefinitionV5,
  ModelAssetDiagnostics,
  PrefabEntityV5,
  PrefabRecordV5,
  ProjectDocument,
  ProjectDocumentV5,
  ProjectEventV5,
  ProjectPermissionsV5,
  ProjectSettings,
  ProjectVariableV5,
  SceneRecordV5,
  TransformData,
  UIDocumentV5,
  UIElementV5,
} from './types';

export const DEFAULT_V5_SCENE_ID = 'scene-main';
export const DEFAULT_V5_LAYER_ID = 'layer.default';
export const DEFAULT_V5_INPUT_MAP_ID = 'input.default';
export const DEFAULT_V5_BUILD_PROFILE_ID = 'build.web-production';

export type ProjectV5ValidationResult =
  | { ok: true; project: ProjectDocumentV5; warnings: string[] }
  | { ok: false; errors: string[] };

type UnknownRecord = Record<string, unknown>;

const entityKinds = ['group', 'mesh', 'model', 'light', 'camera', 'prefab', 'ui'] as const;
const primitiveKinds = ['box', 'sphere', 'capsule', 'cylinder', 'cone', 'plane', 'torus'] as const;
const assetKinds = ['model', 'texture', 'audio', 'material', 'animation', 'environment', 'script', 'font', 'data'] as const;
const componentKinds = ['rotate', 'float', 'keyboardMove'] as const;
const axes = ['x', 'y', 'z'] as const;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function requireRecord(value: unknown, path: string, errors: string[]): UnknownRecord | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  return value;
}

function requireArray(value: unknown, path: string, errors: string[]): unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return [];
  }
  return value;
}

function requireString(record: UnknownRecord, key: string, path: string, errors: string[], allowEmpty = false) {
  const value = record[key];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    errors.push(`${path}.${key} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
    return '';
  }
  return value;
}

function requireBoolean(record: UnknownRecord, key: string, path: string, errors: string[]) {
  const value = record[key];
  if (typeof value !== 'boolean') {
    errors.push(`${path}.${key} must be a boolean.`);
    return false;
  }
  return value;
}

function requireNumber(
  record: UnknownRecord,
  key: string,
  path: string,
  errors: string[],
  options: { integer?: boolean; min?: number; max?: number } = {},
) {
  const value = record[key];
  if (!isFiniteNumber(value)) {
    errors.push(`${path}.${key} must be a finite number.`);
    return 0;
  }
  if (options.integer && !Number.isInteger(value)) errors.push(`${path}.${key} must be an integer.`);
  if (options.min !== undefined && value < options.min) errors.push(`${path}.${key} must be at least ${options.min}.`);
  if (options.max !== undefined && value > options.max) errors.push(`${path}.${key} must be at most ${options.max}.`);
  return value;
}

function requireStringArray(value: unknown, path: string, errors: string[]): string[] {
  const entries = requireArray(value, path, errors);
  const result: string[] = [];
  const used = new Set<string>();
  entries.forEach((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      errors.push(`${path}[${index}] must be a non-empty string.`);
      return;
    }
    if (used.has(entry)) errors.push(`${path}[${index}] duplicates "${entry}".`);
    used.add(entry);
    result.push(entry);
  });
  return result;
}

function validateVec3(value: unknown, path: string, errors: string[]): value is TransformData['position'] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
    errors.push(`${path} must contain exactly three finite numbers.`);
    return false;
  }
  return true;
}

function validateTransform(value: unknown, path: string, errors: string[]) {
  const record = requireRecord(value, path, errors);
  if (!record) return;
  validateVec3(record.position, `${path}.position`, errors);
  validateVec3(record.rotation, `${path}.rotation`, errors);
  validateVec3(record.scale, `${path}.scale`, errors);
}

function validateMaterial(value: unknown, path: string, errors: string[]) {
  const record = requireRecord(value, path, errors);
  if (!record) return;
  requireString(record, 'color', path, errors);
  requireString(record, 'emissive', path, errors);
  requireNumber(record, 'emissiveIntensity', path, errors);
  requireNumber(record, 'metalness', path, errors, { min: 0, max: 1 });
  requireNumber(record, 'roughness', path, errors, { min: 0, max: 1 });
}

function validateProjectSettings(value: unknown, path: string, errors: string[]) {
  const record = requireRecord(value, path, errors);
  if (!record) return;
  requireString(record, 'background', path, errors);
  requireString(record, 'fogColor', path, errors);
  requireNumber(record, 'fogNear', path, errors, { min: 0 });
  requireNumber(record, 'fogFar', path, errors, { min: 0 });
  requireBoolean(record, 'fogEnabled', path, errors);
  requireNumber(record, 'exposure', path, errors, { min: 0 });
  requireNumber(record, 'gridSize', path, errors, { min: 0 });
  requireNumber(record, 'gridDivisions', path, errors, { integer: true, min: 1 });
  requireBoolean(record, 'shadows', path, errors);
  if (isFiniteNumber(record.fogNear) && isFiniteNumber(record.fogFar) && record.fogFar <= record.fogNear) {
    errors.push(`${path}.fogFar must be greater than ${path}.fogNear.`);
  }
}

function validateJsonValue(value: unknown, path: string, errors: string[], visited = new Set<object>()): value is JsonValueV5 {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return true;
    errors.push(`${path} must not contain a non-finite number.`);
    return false;
  }
  if (typeof value !== 'object') {
    errors.push(`${path} must be JSON-serializable.`);
    return false;
  }
  if (visited.has(value)) {
    errors.push(`${path} must not contain a circular reference.`);
    return false;
  }
  visited.add(value);
  let valid = true;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (!validateJsonValue(entry, `${path}[${index}]`, errors, visited)) valid = false;
    });
  } else {
    Object.entries(value).forEach(([key, entry]) => {
      if (!validateJsonValue(entry, `${path}.${key}`, errors, visited)) valid = false;
    });
  }
  visited.delete(value);
  return valid;
}

function validateSource(value: unknown, path: string, errors: string[]) {
  const record = requireRecord(value, path, errors);
  if (!record) return;
  requireString(record, 'filename', path, errors);
  requireString(record, 'mimeType', path, errors, true);
  requireNumber(record, 'byteLength', path, errors, { integer: true, min: 0 });
  if (record.contentHash !== undefined && (typeof record.contentHash !== 'string' || !record.contentHash)) {
    errors.push(`${path}.contentHash must be a non-empty string when present.`);
  }
}

function validateDiagnostics(value: unknown, path: string, errors: string[]) {
  const record = requireRecord(value, path, errors);
  if (!record) return;
  for (const key of ['meshes', 'triangles', 'materials', 'textures'] as const) {
    requireNumber(record, key, path, errors, { integer: true, min: 0 });
  }
  requireStringArray(record.animationNames, `${path}.animationNames`, errors);
  requireStringArray(record.warnings, `${path}.warnings`, errors);
  const bounds = requireRecord(record.bounds, `${path}.bounds`, errors);
  if (!bounds) return;
  for (const key of ['min', 'max', 'size', 'center'] as const) validateVec3(bounds[key], `${path}.bounds.${key}`, errors);
}

function validateAssetBase(record: UnknownRecord, path: string, errors: string[]) {
  if (record.assetVersion !== 1) errors.push(`${path}.assetVersion must be 1.`);
  const id = requireString(record, 'id', path, errors);
  requireString(record, 'name', path, errors);
  requireNumber(record, 'revision', path, errors, { integer: true, min: 1 });
  requireString(record, 'createdAt', path, errors);
  requireString(record, 'updatedAt', path, errors);
  requireStringArray(record.tags, `${path}.tags`, errors);
  return id;
}

function validateAssets(value: unknown, errors: string[]) {
  const records = requireArray(value, 'assets', errors);
  const assets = new Map<string, UnknownRecord>();
  records.forEach((entry, index) => {
    const path = `assets[${index}]`;
    const record = requireRecord(entry, path, errors);
    if (!record) return;
    const id = validateAssetBase(record, path, errors);
    if (assets.has(id)) errors.push(`${path}.id duplicates asset id "${id}".`);
    else if (id) assets.set(id, record);
    if (!assetKinds.includes(record.kind as (typeof assetKinds)[number])) {
      errors.push(`${path}.kind is not supported.`);
      return;
    }
    switch (record.kind) {
      case 'model':
        validateSource(record.source, `${path}.source`, errors);
        validateDiagnostics(record.diagnostics, `${path}.diagnostics`, errors);
        break;
      case 'texture':
        validateSource(record.source, `${path}.source`, errors);
        if (!['srgb', 'linear', 'none'].includes(String(record.colorSpace))) errors.push(`${path}.colorSpace is not supported.`);
        if (!['color', 'normal', 'data', 'environment', 'ui'].includes(String(record.usage))) errors.push(`${path}.usage is not supported.`);
        requireBoolean(record, 'flipY', path, errors);
        break;
      case 'audio':
        validateSource(record.source, `${path}.source`, errors);
        requireBoolean(record, 'streaming', path, errors);
        if (record.durationSeconds !== undefined && (!isFiniteNumber(record.durationSeconds) || record.durationSeconds < 0)) errors.push(`${path}.durationSeconds must be a non-negative finite number when present.`);
        if (record.channels !== undefined && (!Number.isInteger(record.channels) || (record.channels as number) < 1)) errors.push(`${path}.channels must be a positive integer when present.`);
        break;
      case 'material': {
        validateMaterial(record.material, `${path}.material`, errors);
        const material = requireRecord(record.material, `${path}.material`, errors);
        if (material) {
          requireNumber(material, 'opacity', `${path}.material`, errors, { min: 0, max: 1 });
          requireBoolean(material, 'transparent', `${path}.material`, errors);
          requireBoolean(material, 'doubleSided', `${path}.material`, errors);
        }
        const textures = requireRecord(record.textures, `${path}.textures`, errors);
        if (textures) {
          Object.entries(textures).forEach(([slot, assetId]) => {
            if (!['baseColor', 'normal', 'metalness', 'roughness', 'occlusion', 'emissive', 'alpha'].includes(slot)) errors.push(`${path}.textures.${slot} is not a supported material texture slot.`);
            if (typeof assetId !== 'string' || !assetId) errors.push(`${path}.textures.${slot} must reference a texture asset id.`);
          });
        }
        break;
      }
      case 'animation':
        requireString(record, 'modelAssetId', path, errors);
        requireString(record, 'clipName', path, errors);
        if (record.durationSeconds !== undefined && (!isFiniteNumber(record.durationSeconds) || record.durationSeconds < 0)) errors.push(`${path}.durationSeconds must be a non-negative finite number when present.`);
        break;
      case 'environment':
        validateSource(record.source, `${path}.source`, errors);
        if (record.mapping !== 'equirectangular' && record.mapping !== 'cube') errors.push(`${path}.mapping is not supported.`);
        requireNumber(record, 'intensity', path, errors, { min: 0 });
        break;
      case 'script':
        validateSource(record.source, `${path}.source`, errors);
        if (record.language !== 'typescript' && record.language !== 'javascript') errors.push(`${path}.language is not supported.`);
        if (record.runtime !== 'worker' && record.runtime !== 'sandboxed-frame') errors.push(`${path}.runtime is not supported.`);
        requireString(record, 'entryPoint', path, errors);
        break;
      case 'font':
        validateSource(record.source, `${path}.source`, errors);
        requireString(record, 'family', path, errors);
        break;
      case 'data':
        validateJsonValue(record.value, `${path}.value`, errors);
        break;
      default:
        break;
    }
  });
  return assets;
}

function validateComponents(value: unknown, path: string, errors: string[], componentIds: Set<string>) {
  const records = requireArray(value, path, errors);
  records.forEach((entry, index) => {
    const componentPath = `${path}[${index}]`;
    const record = requireRecord(entry, componentPath, errors);
    if (!record) return;
    const id = requireString(record, 'id', componentPath, errors);
    if (componentIds.has(id)) errors.push(`${componentPath}.id duplicates component id "${id}".`);
    componentIds.add(id);
    if (!componentKinds.includes(record.type as (typeof componentKinds)[number])) {
      errors.push(`${componentPath}.type is not supported.`);
      return;
    }
    requireBoolean(record, 'enabled', componentPath, errors);
    requireNumber(record, 'speed', componentPath, errors, { min: 0 });
    if (record.type === 'keyboardMove') {
      if (record.plane !== 'xz' && record.plane !== 'xy') errors.push(`${componentPath}.plane must be "xz" or "xy".`);
      requireString(record, 'actionId', componentPath, errors);
      return;
    }
    if (!axes.includes(record.axis as (typeof axes)[number])) errors.push(`${componentPath}.axis must be "x", "y", or "z".`);
    if (record.type === 'float') {
      requireNumber(record, 'distance', componentPath, errors, { min: 0 });
      requireNumber(record, 'phase', componentPath, errors);
    }
  });
}

function validateModelInstance(value: unknown, path: string, errors: string[]) {
  const record = requireRecord(value, path, errors);
  if (!record) return;
  requireString(record, 'assetId', path, errors);
  if (record.fitMode !== 'fit' && record.fitMode !== 'original') errors.push(`${path}.fitMode must be "fit" or "original".`);
  requireNumber(record, 'targetSize', path, errors, { min: 0.001 });
}

function validateLight(value: unknown, path: string, errors: string[]) {
  const record = requireRecord(value, path, errors);
  if (!record) return;
  if (record.type !== 'directional' && record.type !== 'point' && record.type !== 'spot') errors.push(`${path}.type is not supported.`);
  requireString(record, 'color', path, errors);
  requireNumber(record, 'intensity', path, errors, { min: 0 });
  requireNumber(record, 'distance', path, errors, { min: 0 });
  requireBoolean(record, 'castShadow', path, errors);
}

function validateCamera(value: unknown, path: string, errors: string[]) {
  const record = requireRecord(value, path, errors);
  if (!record) return;
  requireNumber(record, 'fov', path, errors, { min: 1, max: 179 });
  const near = requireNumber(record, 'near', path, errors, { min: 0.0001 });
  const far = requireNumber(record, 'far', path, errors, { min: 0.0001 });
  if (far <= near) errors.push(`${path}.far must be greater than ${path}.near.`);
  requireBoolean(record, 'primary', path, errors);
}

function validateEntityRecord(
  record: UnknownRecord,
  path: string,
  errors: string[],
  componentIds: Set<string>,
  expectSceneId: boolean,
) {
  const id = requireString(record, 'id', path, errors);
  if (expectSceneId) requireString(record, 'sceneId', path, errors);
  else if (record.sceneId !== null) errors.push(`${path}.sceneId must be null inside a prefab.`);
  requireString(record, 'name', path, errors);
  if (!entityKinds.includes(record.kind as (typeof entityKinds)[number])) errors.push(`${path}.kind is not supported.`);
  if (record.parentId !== null && (typeof record.parentId !== 'string' || !record.parentId)) errors.push(`${path}.parentId must be a non-empty string or null.`);
  requireBoolean(record, 'active', path, errors);
  requireBoolean(record, 'visible', path, errors);
  requireBoolean(record, 'locked', path, errors);
  requireStringArray(record.tags, `${path}.tags`, errors);
  requireStringArray(record.layers, `${path}.layers`, errors);
  validateTransform(record.transform, `${path}.transform`, errors);
  validateComponents(record.components, `${path}.components`, errors, componentIds);
  if (record.castShadow !== undefined && typeof record.castShadow !== 'boolean') errors.push(`${path}.castShadow must be a boolean when present.`);
  if (record.receiveShadow !== undefined && typeof record.receiveShadow !== 'boolean') errors.push(`${path}.receiveShadow must be a boolean when present.`);
  if (record.kind === 'mesh') {
    if (!primitiveKinds.includes(record.primitive as (typeof primitiveKinds)[number])) errors.push(`${path}.primitive is not supported.`);
    validateMaterial(record.material, `${path}.material`, errors);
  } else if (record.kind === 'model') {
    validateModelInstance(record.model, `${path}.model`, errors);
  } else if (record.kind === 'light') {
    validateLight(record.light, `${path}.light`, errors);
  } else if (record.kind === 'camera') {
    validateCamera(record.camera, `${path}.camera`, errors);
  } else if (record.kind === 'prefab') {
    const prefab = requireRecord(record.prefab, `${path}.prefab`, errors);
    if (prefab) {
      requireString(prefab, 'prefabId', `${path}.prefab`, errors);
      requireNumber(prefab, 'prefabVersion', `${path}.prefab`, errors, { integer: true, min: 1 });
      requireArray(prefab.overrides, `${path}.prefab.overrides`, errors).forEach((override, overrideIndex) => {
        const overridePath = `${path}.prefab.overrides[${overrideIndex}]`;
        const overrideRecord = requireRecord(override, overridePath, errors);
        if (!overrideRecord) return;
        requireString(overrideRecord, 'entityId', overridePath, errors);
        requireString(overrideRecord, 'path', overridePath, errors);
        validateJsonValue(overrideRecord.value, `${overridePath}.value`, errors);
      });
    }
  }
  return id;
}

function validateScenes(value: unknown, errors: string[]) {
  const records = requireArray(value, 'scenes', errors);
  const scenes = new Map<string, UnknownRecord>();
  records.forEach((entry, index) => {
    const path = `scenes[${index}]`;
    const record = requireRecord(entry, path, errors);
    if (!record) return;
    const id = requireString(record, 'id', path, errors);
    if (scenes.has(id)) errors.push(`${path}.id duplicates scene id "${id}".`);
    else if (id) scenes.set(id, record);
    requireString(record, 'name', path, errors);
    requireNumber(record, 'version', path, errors, { integer: true, min: 1 });
    requireStringArray(record.rootEntityIds, `${path}.rootEntityIds`, errors);
    validateProjectSettings(record.settings, `${path}.settings`, errors);
    requireStringArray(record.tags, `${path}.tags`, errors);
  });
  if (records.length === 0) errors.push('scenes must contain at least one scene.');
  return scenes;
}

function validateLayers(value: unknown, errors: string[]) {
  const records = requireArray(value, 'layers', errors);
  const layers = new Map<string, UnknownRecord>();
  records.forEach((entry, index) => {
    const path = `layers[${index}]`;
    const record = requireRecord(entry, path, errors);
    if (!record) return;
    const id = requireString(record, 'id', path, errors);
    if (layers.has(id)) errors.push(`${path}.id duplicates layer id "${id}".`);
    else if (id) layers.set(id, record);
    requireString(record, 'name', path, errors);
    requireStringArray(record.collisionMask, `${path}.collisionMask`, errors);
  });
  if (records.length === 0) errors.push('layers must contain at least one layer.');
  return layers;
}

function validateBinding(value: unknown, path: string, errors: string[], bindingIds: Set<string>): InputBindingV5 | null {
  const record = requireRecord(value, path, errors);
  if (!record) return null;
  const id = requireString(record, 'id', path, errors);
  if (bindingIds.has(id)) errors.push(`${path}.id duplicates binding id "${id}".`);
  bindingIds.add(id);
  if (!['keyboard', 'pointer', 'gamepad', 'touch'].includes(String(record.device))) {
    errors.push(`${path}.device is not supported.`);
    return null;
  }
  if (record.device === 'keyboard') {
    const code = requireString(record, 'code', path, errors);
    if (code && !KEYBOARD_CODE_PATTERN.test(code)) errors.push(`${path}.code is not a supported KeyboardEvent.code.`);
    if (record.axis !== undefined && record.axis !== 'x' && record.axis !== 'y') errors.push(`${path}.axis must be "x" or "y" when present.`);
    if (record.scale !== undefined && record.scale !== -1 && record.scale !== 1) errors.push(`${path}.scale must be -1 or 1 when present.`);
  } else {
    requireString(record, 'control', path, errors);
    if (record.axis !== undefined && record.axis !== 'x' && record.axis !== 'y') errors.push(`${path}.axis must be "x" or "y" when present.`);
    if (record.scale !== undefined && !isFiniteNumber(record.scale)) errors.push(`${path}.scale must be a finite number when present.`);
    if (record.device === 'gamepad' && record.gamepadIndex !== undefined && (!Number.isInteger(record.gamepadIndex) || (record.gamepadIndex as number) < 0)) errors.push(`${path}.gamepadIndex must be a non-negative integer when present.`);
  }
  return record as unknown as InputBindingV5;
}

function validateInputMaps(value: unknown, errors: string[]) {
  const records = requireArray(value, 'inputMaps', errors);
  const maps = new Map<string, UnknownRecord>();
  const actions = new Map<string, UnknownRecord>();
  const bindingIds = new Set<string>();
  records.forEach((entry, mapIndex) => {
    const path = `inputMaps[${mapIndex}]`;
    const record = requireRecord(entry, path, errors);
    if (!record) return;
    const id = requireString(record, 'id', path, errors);
    if (maps.has(id)) errors.push(`${path}.id duplicates input map id "${id}".`);
    else if (id) maps.set(id, record);
    requireString(record, 'name', path, errors);
    requireNumber(record, 'version', path, errors, { integer: true, min: 1 });
    requireBoolean(record, 'enabled', path, errors);
    requireNumber(record, 'priority', path, errors);
    requireArray(record.actions, `${path}.actions`, errors).forEach((actionValue, actionIndex) => {
      const actionPath = `${path}.actions[${actionIndex}]`;
      const action = requireRecord(actionValue, actionPath, errors);
      if (!action) return;
      const actionId = requireString(action, 'id', actionPath, errors);
      if (actions.has(actionId)) errors.push(`${actionPath}.id duplicates input action id "${actionId}" across input maps.`);
      else if (actionId) actions.set(actionId, action);
      requireString(action, 'name', actionPath, errors);
      if (!['button', 'axis1d', 'axis2d'].includes(String(action.type))) errors.push(`${actionPath}.type is not supported.`);
      requireNumber(action, 'deadZone', actionPath, errors, { min: 0, max: 1 });
      requireArray(action.bindings, `${actionPath}.bindings`, errors).forEach((binding, bindingIndex) => {
        const validated = validateBinding(binding, `${actionPath}.bindings[${bindingIndex}]`, errors, bindingIds);
        if (validated?.device === 'keyboard' && action.type === 'axis2d' && (validated.axis === undefined || validated.scale === undefined)) {
          errors.push(`${actionPath}.bindings[${bindingIndex}] must define axis and scale for an axis2d keyboard action.`);
        }
      });
    });
  });
  return { maps, actions };
}

function validateVariables(value: unknown, errors: string[]) {
  const records = requireArray(value, 'variables', errors);
  const variables = new Map<string, UnknownRecord>();
  records.forEach((entry, index) => {
    const path = `variables[${index}]`;
    const record = requireRecord(entry, path, errors);
    if (!record) return;
    const id = requireString(record, 'id', path, errors);
    if (variables.has(id)) errors.push(`${path}.id duplicates variable id "${id}".`);
    else if (id) variables.set(id, record);
    requireString(record, 'name', path, errors);
    if (!['boolean', 'number', 'string', 'vec3', 'json'].includes(String(record.type))) errors.push(`${path}.type is not supported.`);
    if (!['project', 'save', 'session'].includes(String(record.scope))) errors.push(`${path}.scope is not supported.`);
    validateJsonValue(record.defaultValue, `${path}.defaultValue`, errors);
    if (record.type === 'boolean' && typeof record.defaultValue !== 'boolean') errors.push(`${path}.defaultValue must be a boolean.`);
    if (record.type === 'number' && !isFiniteNumber(record.defaultValue)) errors.push(`${path}.defaultValue must be a finite number.`);
    if (record.type === 'string' && typeof record.defaultValue !== 'string') errors.push(`${path}.defaultValue must be a string.`);
    if (record.type === 'vec3') validateVec3(record.defaultValue, `${path}.defaultValue`, errors);
  });
  return variables;
}

function validateEvents(value: unknown, errors: string[]) {
  const records = requireArray(value, 'events', errors);
  const events = new Map<string, UnknownRecord>();
  records.forEach((entry, eventIndex) => {
    const path = `events[${eventIndex}]`;
    const record = requireRecord(entry, path, errors);
    if (!record) return;
    const id = requireString(record, 'id', path, errors);
    if (events.has(id)) errors.push(`${path}.id duplicates event id "${id}".`);
    else if (id) events.set(id, record);
    requireString(record, 'name', path, errors);
    const fieldIds = new Set<string>();
    requireArray(record.payload, `${path}.payload`, errors).forEach((fieldValue, fieldIndex) => {
      const fieldPath = `${path}.payload[${fieldIndex}]`;
      const field = requireRecord(fieldValue, fieldPath, errors);
      if (!field) return;
      const fieldId = requireString(field, 'id', fieldPath, errors);
      if (fieldIds.has(fieldId)) errors.push(`${fieldPath}.id duplicates payload field id "${fieldId}".`);
      fieldIds.add(fieldId);
      requireString(field, 'name', fieldPath, errors);
      if (!['boolean', 'number', 'string', 'vec3', 'json', 'entity', 'asset'].includes(String(field.type))) errors.push(`${fieldPath}.type is not supported.`);
      requireBoolean(field, 'required', fieldPath, errors);
    });
  });
  return events;
}

function validateHierarchy(
  entries: Map<string, UnknownRecord>,
  pathForId: (id: string) => string,
  errors: string[],
  sceneScoped: boolean,
) {
  for (const [id, record] of entries) {
    const path = pathForId(id);
    const parentId = typeof record.parentId === 'string' ? record.parentId : null;
    if (parentId && !entries.has(parentId)) {
      errors.push(`${path}.parentId references missing entity "${parentId}".`);
      continue;
    }
    if (parentId && sceneScoped && entries.get(parentId)?.sceneId !== record.sceneId) {
      errors.push(`${path}.parentId must reference an entity in the same scene.`);
    }
    const chain = new Set([id]);
    let cursor = parentId;
    while (cursor) {
      if (chain.has(cursor)) {
        errors.push(`${path}.parentId creates a hierarchy cycle through "${cursor}".`);
        break;
      }
      chain.add(cursor);
      const parent = entries.get(cursor);
      cursor = parent && typeof parent.parentId === 'string' ? parent.parentId : null;
    }
  }
}

function validateEntities(value: unknown, errors: string[]) {
  const records = requireArray(value, 'entities', errors);
  const entities = new Map<string, UnknownRecord>();
  const paths = new Map<string, string>();
  const componentIds = new Set<string>();
  records.forEach((entry, index) => {
    const path = `entities[${index}]`;
    const record = requireRecord(entry, path, errors);
    if (!record) return;
    const id = validateEntityRecord(record, path, errors, componentIds, true);
    if (entities.has(id)) errors.push(`${path}.id duplicates entity id "${id}".`);
    else if (id) {
      entities.set(id, record);
      paths.set(id, path);
    }
  });
  validateHierarchy(entities, (id) => paths.get(id) ?? `entities[${id}]`, errors, true);
  return { entities, paths };
}

function validatePrefabs(value: unknown, errors: string[]) {
  const records = requireArray(value, 'prefabs', errors);
  const prefabs = new Map<string, UnknownRecord>();
  records.forEach((entry, prefabIndex) => {
    const path = `prefabs[${prefabIndex}]`;
    const record = requireRecord(entry, path, errors);
    if (!record) return;
    const id = requireString(record, 'id', path, errors);
    if (prefabs.has(id)) errors.push(`${path}.id duplicates prefab id "${id}".`);
    else if (id) prefabs.set(id, record);
    requireString(record, 'name', path, errors);
    requireNumber(record, 'version', path, errors, { integer: true, min: 1 });
    const rootEntityId = requireString(record, 'rootEntityId', path, errors);
    requireStringArray(record.tags, `${path}.tags`, errors);
    const entities = new Map<string, UnknownRecord>();
    const paths = new Map<string, string>();
    const componentIds = new Set<string>();
    requireArray(record.entities, `${path}.entities`, errors).forEach((entityValue, entityIndex) => {
      const entityPath = `${path}.entities[${entityIndex}]`;
      const entity = requireRecord(entityValue, entityPath, errors);
      if (!entity) return;
      const entityId = validateEntityRecord(entity, entityPath, errors, componentIds, false);
      if (entities.has(entityId)) errors.push(`${entityPath}.id duplicates prefab entity id "${entityId}".`);
      else if (entityId) {
        entities.set(entityId, entity);
        paths.set(entityId, entityPath);
      }
    });
    if (!entities.has(rootEntityId)) errors.push(`${path}.rootEntityId references missing prefab entity "${rootEntityId}".`);
    else if (entities.get(rootEntityId)?.parentId !== null) errors.push(`${path}.rootEntityId must reference a root entity.`);
    validateHierarchy(entities, (entityId) => paths.get(entityId) ?? `${path}.entities[${entityId}]`, errors, false);
  });
  return prefabs;
}

function validateUi(value: unknown, errors: string[]) {
  const record = requireRecord(value, 'ui', errors);
  const documents = new Map<string, UnknownRecord>();
  if (!record) return documents;
  if (record.startupDocumentId !== null && (typeof record.startupDocumentId !== 'string' || !record.startupDocumentId)) errors.push('ui.startupDocumentId must be a non-empty string or null.');
  requireArray(record.documents, 'ui.documents', errors).forEach((entry, documentIndex) => {
    const path = `ui.documents[${documentIndex}]`;
    const documentRecord = requireRecord(entry, path, errors);
    if (!documentRecord) return;
    const id = requireString(documentRecord, 'id', path, errors);
    if (documents.has(id)) errors.push(`${path}.id duplicates UI document id "${id}".`);
    else if (id) documents.set(id, documentRecord);
    requireString(documentRecord, 'name', path, errors);
    if (documentRecord.sceneId !== null && (typeof documentRecord.sceneId !== 'string' || !documentRecord.sceneId)) errors.push(`${path}.sceneId must be a non-empty string or null.`);
    const rootElementIds = requireStringArray(documentRecord.rootElementIds, `${path}.rootElementIds`, errors);
    const elements = new Map<string, UnknownRecord>();
    const paths = new Map<string, string>();
    requireArray(documentRecord.elements, `${path}.elements`, errors).forEach((elementValue, elementIndex) => {
      const elementPath = `${path}.elements[${elementIndex}]`;
      const element = requireRecord(elementValue, elementPath, errors);
      if (!element) return;
      const elementId = requireString(element, 'id', elementPath, errors);
      if (elements.has(elementId)) errors.push(`${elementPath}.id duplicates UI element id "${elementId}".`);
      else if (elementId) {
        elements.set(elementId, element);
        paths.set(elementId, elementPath);
      }
      if (element.parentId !== null && (typeof element.parentId !== 'string' || !element.parentId)) errors.push(`${elementPath}.parentId must be a non-empty string or null.`);
      if (!['container', 'text', 'image', 'button', 'progress', 'input'].includes(String(element.type))) errors.push(`${elementPath}.type is not supported.`);
      requireString(element, 'name', elementPath, errors);
      requireBoolean(element, 'active', elementPath, errors);
      const properties = requireRecord(element.properties, `${elementPath}.properties`, errors);
      if (properties) validateJsonValue(properties, `${elementPath}.properties`, errors);
    });
    validateHierarchy(elements, (elementId) => paths.get(elementId) ?? `${path}.elements[${elementId}]`, errors, false);
    const actualRoots = [...elements].filter(([, element]) => element.parentId === null).map(([elementId]) => elementId);
    if (!sameStringSet(rootElementIds, actualRoots)) errors.push(`${path}.rootElementIds must list every root UI element exactly once.`);
  });
  if (typeof record.startupDocumentId === 'string' && !documents.has(record.startupDocumentId)) errors.push(`ui.startupDocumentId references missing UI document "${record.startupDocumentId}".`);
  return documents;
}

function validateBuildProfiles(value: unknown, errors: string[]) {
  const records = requireArray(value, 'buildProfiles', errors);
  const profiles = new Map<string, UnknownRecord>();
  records.forEach((entry, index) => {
    const path = `buildProfiles[${index}]`;
    const record = requireRecord(entry, path, errors);
    if (!record) return;
    const id = requireString(record, 'id', path, errors);
    if (profiles.has(id)) errors.push(`${path}.id duplicates build profile id "${id}".`);
    else if (id) profiles.set(id, record);
    requireString(record, 'name', path, errors);
    if (!['web', 'pwa', 'desktop'].includes(String(record.target))) errors.push(`${path}.target is not supported.`);
    if (!['development', 'preview', 'production'].includes(String(record.mode))) errors.push(`${path}.mode is not supported.`);
    requireString(record, 'startupSceneId', path, errors);
    if (!['low', 'medium', 'high', 'auto'].includes(String(record.quality))) errors.push(`${path}.quality is not supported.`);
    requireString(record, 'basePath', path, errors, true);
    requireBoolean(record, 'offline', path, errors);
  });
  if (records.length === 0) errors.push('buildProfiles must contain at least one profile.');
  return profiles;
}

function validatePermissions(value: unknown, errors: string[]) {
  const record = requireRecord(value, 'permissions', errors);
  if (!record) return;
  const network = requireRecord(record.network, 'permissions.network', errors);
  if (network) {
    if (network.policy !== 'deny' && network.policy !== 'allow-list') errors.push('permissions.network.policy is not supported.');
    const origins = requireStringArray(network.origins, 'permissions.network.origins', errors);
    if (network.policy === 'deny' && origins.length > 0) errors.push('permissions.network.origins must be empty when policy is "deny".');
  }
  if (record.localFiles !== 'none' && record.localFiles !== 'user-mediated') errors.push('permissions.localFiles is not supported.');
  if (!['none', 'local', 'persistent'].includes(String(record.storage))) errors.push('permissions.storage is not supported.');
  for (const key of ['clipboard', 'fullscreen', 'pointerLock', 'gamepad', 'microphone', 'camera'] as const) requireBoolean(record, key, 'permissions', errors);
}

function sameStringSet(left: string[], right: string[]) {
  return left.length === right.length && left.every((entry) => right.includes(entry));
}

function validateCrossReferences(
  root: UnknownRecord,
  scenes: Map<string, UnknownRecord>,
  entities: Map<string, UnknownRecord>,
  entityPaths: Map<string, string>,
  prefabs: Map<string, UnknownRecord>,
  assets: Map<string, UnknownRecord>,
  layers: Map<string, UnknownRecord>,
  actions: Map<string, UnknownRecord>,
  uiDocuments: Map<string, UnknownRecord>,
  profiles: Map<string, UnknownRecord>,
  errors: string[],
) {
  const startupSceneId = typeof root.startupSceneId === 'string' ? root.startupSceneId : '';
  if (startupSceneId && !scenes.has(startupSceneId)) errors.push(`startupSceneId references missing scene "${startupSceneId}".`);
  const defaultBuildProfileId = typeof root.defaultBuildProfileId === 'string' ? root.defaultBuildProfileId : '';
  if (defaultBuildProfileId && !profiles.has(defaultBuildProfileId)) errors.push(`defaultBuildProfileId references missing build profile "${defaultBuildProfileId}".`);

  for (const [layerId, layer] of layers) {
    const mask = Array.isArray(layer.collisionMask) ? layer.collisionMask : [];
    mask.forEach((targetId, index) => {
      if (typeof targetId === 'string' && !layers.has(targetId)) errors.push(`layers[${layerId}].collisionMask[${index}] references missing layer "${targetId}".`);
    });
  }

  for (const [assetId, asset] of assets) {
    if (asset.kind === 'animation' && typeof asset.modelAssetId === 'string' && assets.get(asset.modelAssetId)?.kind !== 'model') {
      errors.push(`assets[${assetId}].modelAssetId must reference a model asset.`);
    }
    if (asset.kind === 'material' && isRecord(asset.textures)) {
      Object.entries(asset.textures).forEach(([slot, textureId]) => {
        if (typeof textureId === 'string' && assets.get(textureId)?.kind !== 'texture') errors.push(`assets[${assetId}].textures.${slot} must reference a texture asset.`);
      });
    }
  }

  for (const [entityId, entity] of entities) {
    const path = entityPaths.get(entityId) ?? `entities[${entityId}]`;
    if (typeof entity.sceneId === 'string' && !scenes.has(entity.sceneId)) errors.push(`${path}.sceneId references missing scene "${entity.sceneId}".`);
    const entityLayers = Array.isArray(entity.layers) ? entity.layers : [];
    entityLayers.forEach((layerId, index) => {
      if (typeof layerId === 'string' && !layers.has(layerId)) errors.push(`${path}.layers[${index}] references missing layer "${layerId}".`);
    });
    if (entity.kind === 'model' && isRecord(entity.model) && typeof entity.model.assetId === 'string' && assets.get(entity.model.assetId)?.kind !== 'model') {
      errors.push(`${path}.model.assetId must reference a model asset.`);
    }
    if (entity.kind === 'prefab' && isRecord(entity.prefab)) {
      const prefabId = typeof entity.prefab.prefabId === 'string' ? entity.prefab.prefabId : '';
      const prefab = prefabs.get(prefabId);
      if (!prefab) errors.push(`${path}.prefab.prefabId references missing prefab "${prefabId}".`);
      else {
        if (entity.prefab.prefabVersion !== prefab.version) errors.push(`${path}.prefab.prefabVersion must match prefab "${prefabId}" version ${String(prefab.version)}.`);
        const prefabEntityIds = new Set(requireArray(prefab.entities, `${path}.prefabDefinition.entities`, []).flatMap((entry) => isRecord(entry) && typeof entry.id === 'string' ? [entry.id] : []));
        requireArray(entity.prefab.overrides, `${path}.prefab.overrides`, []).forEach((override, overrideIndex) => {
          if (isRecord(override) && typeof override.entityId === 'string' && !prefabEntityIds.has(override.entityId)) errors.push(`${path}.prefab.overrides[${overrideIndex}].entityId references missing prefab entity "${override.entityId}".`);
        });
      }
    }
    const components = Array.isArray(entity.components) ? entity.components : [];
    components.forEach((component, componentIndex) => {
      if (isRecord(component) && component.type === 'keyboardMove' && typeof component.actionId === 'string' && !actions.has(component.actionId)) {
        errors.push(`${path}.components[${componentIndex}].actionId references missing input action "${component.actionId}".`);
      }
    });
  }

  for (const [sceneId, scene] of scenes) {
    const declaredRoots = Array.isArray(scene.rootEntityIds) ? scene.rootEntityIds.filter((entry): entry is string => typeof entry === 'string') : [];
    const actualRoots = [...entities].filter(([, entity]) => entity.sceneId === sceneId && entity.parentId === null).map(([entityId]) => entityId);
    if (!sameStringSet(declaredRoots, actualRoots)) errors.push(`scenes[${sceneId}].rootEntityIds must list every root entity in the scene exactly once.`);
    const primaryCameras = [...entities.values()].filter((entity) => entity.sceneId === sceneId && entity.kind === 'camera' && isRecord(entity.camera) && entity.camera.primary === true);
    if (primaryCameras.length > 1) errors.push(`scenes[${sceneId}] must not contain more than one primary camera.`);
  }

  for (const [prefabId, prefab] of prefabs) {
    const prefabEntities = Array.isArray(prefab.entities) ? prefab.entities : [];
    prefabEntities.forEach((entity, entityIndex) => {
      if (!isRecord(entity)) return;
      const path = `prefabs[${prefabId}].entities[${entityIndex}]`;
      const entityLayers = Array.isArray(entity.layers) ? entity.layers : [];
      entityLayers.forEach((layerId, layerIndex) => {
        if (typeof layerId === 'string' && !layers.has(layerId)) errors.push(`${path}.layers[${layerIndex}] references missing layer "${layerId}".`);
      });
      if (entity.kind === 'model' && isRecord(entity.model) && typeof entity.model.assetId === 'string' && assets.get(entity.model.assetId)?.kind !== 'model') errors.push(`${path}.model.assetId must reference a model asset.`);
      const components = Array.isArray(entity.components) ? entity.components : [];
      components.forEach((component, componentIndex) => {
        if (isRecord(component) && component.type === 'keyboardMove' && typeof component.actionId === 'string' && !actions.has(component.actionId)) errors.push(`${path}.components[${componentIndex}].actionId references missing input action "${component.actionId}".`);
      });
    });
  }

  for (const [documentId, document] of uiDocuments) {
    if (typeof document.sceneId === 'string' && !scenes.has(document.sceneId)) errors.push(`ui.documents[${documentId}].sceneId references missing scene "${document.sceneId}".`);
  }
  for (const [profileId, profile] of profiles) {
    if (typeof profile.startupSceneId === 'string' && !scenes.has(profile.startupSceneId)) errors.push(`buildProfiles[${profileId}].startupSceneId references missing scene "${profile.startupSceneId}".`);
  }
}

export function validateProjectDocumentV5(value: unknown): ProjectV5ValidationResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'ProjectDocumentV5', errors);
  if (!root) return { ok: false, errors };
  if (root.schemaVersion !== 5) errors.push('schemaVersion must be 5.');
  requireString(root, 'id', 'project', errors);
  requireString(root, 'name', 'project', errors);
  requireString(root, 'updatedAt', 'project', errors);
  requireString(root, 'startupSceneId', 'project', errors);
  const scenes = validateScenes(root.scenes, errors);
  const assets = validateAssets(root.assets, errors);
  const layers = validateLayers(root.layers, errors);
  const { maps: _inputMaps, actions } = validateInputMaps(root.inputMaps, errors);
  validateVariables(root.variables, errors);
  validateEvents(root.events, errors);
  const prefabs = validatePrefabs(root.prefabs, errors);
  const { entities, paths } = validateEntities(root.entities, errors);
  const uiDocuments = validateUi(root.ui, errors);
  const profiles = validateBuildProfiles(root.buildProfiles, errors);
  requireString(root, 'defaultBuildProfileId', 'project', errors);
  validatePermissions(root.permissions, errors);
  validateCrossReferences(root, scenes, entities, paths, prefabs, assets, layers, actions, uiDocuments, profiles, errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, project: structuredClone(value as ProjectDocumentV5), warnings: [] };
}

export function isProjectDocumentV5(value: unknown): value is ProjectDocumentV5 {
  return validateProjectDocumentV5(value).ok;
}

function migrateAsset(asset: ProjectDocument['assets'][number]): AssetRecord {
  return {
    assetVersion: 1,
    id: asset.id,
    kind: 'model',
    name: asset.name,
    revision: asset.revision,
    createdAt: asset.importedAt,
    updatedAt: asset.importedAt,
    tags: [],
    source: {
      filename: asset.sourceFilename,
      mimeType: asset.mimeType,
      byteLength: asset.byteLength,
    },
    diagnostics: structuredClone(asset.diagnostics),
  };
}

function migrateInputAction(action: ProjectDocument['inputActions'][number]): InputActionV5 {
  return {
    id: action.id,
    name: action.name,
    type: action.type,
    deadZone: 0,
    bindings: action.bindings.map((binding) => ({
      id: binding.id,
      device: 'keyboard',
      code: binding.code,
      axis: binding.axis,
      scale: binding.scale,
    })),
  };
}

function migrateEntity(node: ProjectDocument['nodes'][number]): EntityV5 {
  return {
    ...structuredClone(node),
    sceneId: DEFAULT_V5_SCENE_ID,
    active: true,
    tags: [],
    layers: [DEFAULT_V5_LAYER_ID],
  };
}

export function migrateProjectV4ToV5(project: ProjectDocument): ProjectDocumentV5 {
  const scene: SceneRecordV5 = {
    id: DEFAULT_V5_SCENE_ID,
    name: project.sceneName,
    version: 1,
    rootEntityIds: project.nodes.filter((node) => node.parentId === null).map((node) => node.id),
    settings: structuredClone(project.settings),
    tags: [],
  };
  const layers: LayerDefinitionV5[] = [{
    id: DEFAULT_V5_LAYER_ID,
    name: 'Default',
    collisionMask: [DEFAULT_V5_LAYER_ID],
  }];
  const inputMaps: InputMapV5[] = [{
    id: DEFAULT_V5_INPUT_MAP_ID,
    name: 'Default',
    version: 1,
    enabled: true,
    priority: 0,
    actions: project.inputActions.map(migrateInputAction),
  }];
  const buildProfiles: BuildProfileV5[] = [{
    id: DEFAULT_V5_BUILD_PROFILE_ID,
    name: 'Web Production',
    target: 'web',
    mode: 'production',
    startupSceneId: scene.id,
    quality: 'auto',
    basePath: './',
    offline: false,
  }];
  const permissions: ProjectPermissionsV5 = {
    network: { policy: 'deny', origins: [] },
    localFiles: 'user-mediated',
    storage: 'local',
    clipboard: false,
    fullscreen: true,
    pointerLock: true,
    gamepad: true,
    microphone: false,
    camera: false,
  };
  const migrated: ProjectDocumentV5 = {
    schemaVersion: 5,
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    startupSceneId: scene.id,
    scenes: [scene],
    entities: project.nodes.map(migrateEntity),
    prefabs: [],
    assets: project.assets.map(migrateAsset),
    layers,
    inputMaps,
    variables: [],
    events: [],
    ui: { startupDocumentId: null, documents: [] },
    buildProfiles,
    defaultBuildProfileId: DEFAULT_V5_BUILD_PROFILE_ID,
    permissions,
  };
  const validation = validateProjectDocumentV5(migrated);
  if (!validation.ok) throw new Error(`The v4 project could not be migrated to schema v5: ${validation.errors.join(' ')}`);
  return migrated;
}

export function getSceneV5(project: ProjectDocumentV5, sceneId: string): SceneRecordV5 | undefined {
  return project.scenes.find((scene) => scene.id === sceneId);
}

export function getStartupSceneV5(project: ProjectDocumentV5): SceneRecordV5 | undefined {
  return getSceneV5(project, project.startupSceneId);
}

export function getActiveSceneV5(
  project: ProjectDocumentV5,
  activeSceneId: string | null | undefined = project.startupSceneId,
): SceneRecordV5 | undefined {
  return (activeSceneId ? getSceneV5(project, activeSceneId) : undefined) ?? getStartupSceneV5(project);
}

export function isEntityEffectivelyActiveV5(project: ProjectDocumentV5, entityId: string): boolean {
  const entities = new Map(project.entities.map((entity) => [entity.id, entity]));
  const entity = entities.get(entityId);
  if (!entity?.active) return false;
  const visited = new Set([entity.id]);
  let parentId = entity.parentId;
  while (parentId) {
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    const parent = entities.get(parentId);
    if (!parent || !parent.active || parent.sceneId !== entity.sceneId) return false;
    parentId = parent.parentId;
  }
  return true;
}

export function getEntitiesForSceneV5(
  project: ProjectDocumentV5,
  sceneId: string,
  options: { activeOnly?: boolean } = {},
): EntityV5[] {
  return project.entities.filter((entity) =>
    entity.sceneId === sceneId && (!options.activeOnly || isEntityEffectivelyActiveV5(project, entity.id)),
  );
}

export function getActiveSceneEntitiesV5(
  project: ProjectDocumentV5,
  activeSceneId: string | null | undefined = project.startupSceneId,
  options: { activeOnly?: boolean } = {},
): EntityV5[] {
  const scene = getActiveSceneV5(project, activeSceneId);
  return scene ? getEntitiesForSceneV5(project, scene.id, options) : [];
}

// Short aliases keep call sites readable once v5 becomes authoritative while
// the suffixed exports make today's parallel v4/v5 usage explicit.
export const getActiveScene = getActiveSceneV5;
export const getActiveSceneEntities = getActiveSceneEntitiesV5;

// Re-exported contract types make this module a complete migration entrypoint.
export type {
  AssetRecord,
  AssetSourceV5,
  EntityV5,
  InputActionV5,
  InputMapV5,
  ModelAssetDiagnostics,
  PrefabEntityV5,
  PrefabRecordV5,
  ProjectDocumentV5,
  ProjectEventV5,
  ProjectSettings,
  ProjectVariableV5,
  UIDocumentV5,
  UIElementV5,
};
