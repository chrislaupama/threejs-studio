import {
  addInputAction,
  deleteInputAction,
  updateInputAction,
} from './inputActions';
import {
  addModelInstance,
  addPrimitive,
  applyMaterial,
  cloneProject,
  duplicateNode,
  getNode,
  loadProjectDocument,
  removeNode,
  updateNode,
} from './project';
import {
  getComponentDefinition,
  isRegisteredComponentType,
  validateRegisteredComponent,
  type RegisteredComponent,
  type RegisteredComponentType,
} from './componentRegistry';
import type {
  GameplayComponent,
  InputAction,
  PrimitiveType,
  ProjectDocument,
  ProjectSettings,
  SceneNode,
} from './types';

export const PROJECT_COMMAND_PROTOCOL = 'threejs-studio.project-commands' as const;
export const PROJECT_COMMAND_PROTOCOL_VERSION = 1 as const;

export type ProjectCommandErrorCode =
  | 'invalid-envelope'
  | 'invalid-project'
  | 'project-mismatch'
  | 'revision-conflict'
  | 'duplicate-command-id'
  | 'unsupported-command'
  | 'invalid-command'
  | 'not-found'
  | 'conflict'
  | 'validation-failed'
  | 'operation-failed';

export type ProjectCommandWarningCode = 'project-normalized';

export interface ProjectCommandError {
  code: ProjectCommandErrorCode;
  message: string;
  commandIndex?: number;
  commandId?: string;
  path?: string;
  details?: readonly string[];
  expectedRevision?: number;
  actualRevision?: number;
}

export interface ProjectCommandWarning {
  code: ProjectCommandWarningCode;
  message: string;
  commandIndex: number;
  commandId: string;
}

interface ProjectCommandBase {
  id: string;
}

export interface ReplaceProjectCommand extends ProjectCommandBase {
  type: 'project.replace';
  project: ProjectDocument;
}

export interface CreatePrimitiveCommand extends ProjectCommandBase {
  type: 'node.createPrimitive';
  primitive: PrimitiveType;
  nodeId?: string;
  parentId?: string | null;
  color?: string;
}

export type ProjectNodeChanges = Partial<Pick<
  SceneNode,
  | 'name'
  | 'parentId'
  | 'visible'
  | 'locked'
  | 'transform'
  | 'material'
  | 'model'
  | 'light'
  | 'camera'
  | 'castShadow'
  | 'receiveShadow'
>>;

export interface UpdateNodeCommand extends ProjectCommandBase {
  type: 'node.update';
  nodeId: string;
  changes: ProjectNodeChanges;
}

export interface DuplicateNodeCommand extends ProjectCommandBase {
  type: 'node.duplicate';
  nodeId: string;
}

export interface DeleteNodeCommand extends ProjectCommandBase {
  type: 'node.delete';
  nodeId: string;
}

export interface ApplyMaterialCommand extends ProjectCommandBase {
  type: 'node.applyMaterial';
  nodeId: string;
  color: string;
}

export interface AddModelInstanceCommand extends ProjectCommandBase {
  type: 'model.addInstance';
  assetId: string;
  parentId?: string | null;
}

type ComponentCreateValues<TType extends RegisteredComponentType> = Partial<Omit<
  RegisteredComponent<TType>,
  'id' | 'type'
>>;

type ComponentUpdateValues<TType extends RegisteredComponentType> = Partial<Omit<
  RegisteredComponent<TType>,
  'id' | 'type'
>>;

export type AddComponentCommand = {
  [TType in RegisteredComponentType]: ProjectCommandBase & {
    type: 'component.add';
    nodeId: string;
    componentType: TType;
    componentId?: string;
    values?: ComponentCreateValues<TType>;
  };
}[RegisteredComponentType];

export type UpdateComponentCommand = {
  [TType in RegisteredComponentType]: ProjectCommandBase & {
    type: 'component.update';
    nodeId: string;
    componentId: string;
    componentType: TType;
    changes: ComponentUpdateValues<TType>;
  };
}[RegisteredComponentType];

export interface RemoveComponentCommand extends ProjectCommandBase {
  type: 'component.remove';
  nodeId: string;
  componentId: string;
}

export interface UpsertInputActionCommand extends ProjectCommandBase {
  type: 'inputAction.upsert';
  action: InputAction;
}

export interface DeleteInputActionCommand extends ProjectCommandBase {
  type: 'inputAction.delete';
  actionId: string;
}

export interface UpdateWorldSettingsCommand extends ProjectCommandBase {
  type: 'world.updateSettings';
  changes: Partial<ProjectSettings>;
}

export type ProjectCommand =
  | ReplaceProjectCommand
  | CreatePrimitiveCommand
  | UpdateNodeCommand
  | DuplicateNodeCommand
  | DeleteNodeCommand
  | ApplyMaterialCommand
  | AddModelInstanceCommand
  | AddComponentCommand
  | UpdateComponentCommand
  | RemoveComponentCommand
  | UpsertInputActionCommand
  | DeleteInputActionCommand
  | UpdateWorldSettingsCommand;

export interface ProjectCommandEnvelope {
  protocol: typeof PROJECT_COMMAND_PROTOCOL;
  protocolVersion: typeof PROJECT_COMMAND_PROTOCOL_VERSION;
  id: string;
  projectId: string;
  baseRevision: number;
  label: string;
  commands: ProjectCommand[];
}

export interface ProjectCommandAffectedRecords {
  nodeIds: string[];
  componentIds: string[];
  assetIds: string[];
  inputActionIds: string[];
  worldSettings: boolean;
  wholeProject: boolean;
}

export interface ProjectCommandApplied {
  id: string;
  type: ProjectCommand['type'];
  affected: ProjectCommandAffectedRecords;
}

export interface ProjectPatchMetadata {
  format: 'json-pointer-v1';
  changedPaths: string[];
  truncated: boolean;
  affected: ProjectCommandAffectedRecords;
}

export interface ProjectCommandInverse {
  kind: 'project-document-snapshot';
  targetProjectId: string;
  expectedBaseRevision: number;
  snapshotRevision: number;
  document: ProjectDocument;
  patch: ProjectPatchMetadata;
}

export interface ProjectCommandResult {
  protocol: typeof PROJECT_COMMAND_PROTOCOL;
  protocolVersion: typeof PROJECT_COMMAND_PROTOCOL_VERSION;
  ok: boolean;
  envelopeId: string | null;
  projectId: string;
  baseRevision: number;
  revision: number;
  changed: boolean;
  project: ProjectDocument;
  applied: ProjectCommandApplied[];
  errors: ProjectCommandError[];
  warnings: ProjectCommandWarning[];
  patch: ProjectPatchMetadata | null;
  inverse: ProjectCommandInverse | null;
}

interface CommandExecutionSuccess {
  ok: true;
  project: ProjectDocument;
  affected: ProjectCommandAffectedRecords;
}

interface CommandExecutionFailure {
  ok: false;
  code: Exclude<
    ProjectCommandErrorCode,
    'invalid-envelope' | 'invalid-project' | 'project-mismatch' | 'revision-conflict' | 'duplicate-command-id'
  >;
  message: string;
  path?: string;
  details?: string[];
}

type CommandExecution = CommandExecutionSuccess | CommandExecutionFailure;

const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const colorPattern = /^#[0-9a-fA-F]{6}$/u;
const primitiveTypes: readonly PrimitiveType[] = ['box', 'sphere', 'capsule', 'cylinder', 'cone', 'plane', 'torus'];
const commandTypes = [
  'project.replace',
  'node.createPrimitive',
  'node.update',
  'node.duplicate',
  'node.delete',
  'node.applyMaterial',
  'model.addInstance',
  'component.add',
  'component.update',
  'component.remove',
  'inputAction.upsert',
  'inputAction.delete',
  'world.updateSettings',
] as const satisfies readonly ProjectCommand['type'][];
const nodeChangeKeys: readonly (keyof ProjectNodeChanges)[] = [
  'name',
  'parentId',
  'visible',
  'locked',
  'transform',
  'material',
  'model',
  'light',
  'camera',
  'castShadow',
  'receiveShadow',
];
const worldSettingKeys: readonly (keyof ProjectSettings)[] = [
  'background',
  'fogColor',
  'fogNear',
  'fogFar',
  'fogEnabled',
  'exposure',
  'gridSize',
  'gridDivisions',
  'shadows',
];
const componentValueKeys: Record<RegisteredComponentType, readonly string[]> = {
  rotate: ['enabled', 'speed', 'axis'],
  float: ['enabled', 'speed', 'distance', 'axis', 'phase'],
  keyboardMove: ['enabled', 'speed', 'plane', 'actionId'],
};
const MAX_COMMANDS_PER_ENVELOPE = 256;
const MAX_PATCH_PATHS = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function findNonSerializable(value: unknown, path = '', seen = new Set<object>()): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : path || '/';
  if (typeof value === 'undefined' || typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return path || '/';
  }
  if (typeof value !== 'object') return path || '/';
  if (seen.has(value)) return path || '/';
  seen.add(value);
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const invalidPath = findNonSerializable(entry, `${path}/${index}`, seen);
      if (invalidPath) return invalidPath;
    }
    seen.delete(value);
    return null;
  }
  if (!isPlainRecord(value)) return path || '/';
  for (const [key, entry] of Object.entries(value)) {
    const invalidPath = findNonSerializable(entry, `${path}/${escapeJsonPointer(key)}`, seen);
    if (invalidPath) return invalidPath;
  }
  seen.delete(value);
  return null;
}

function affected({
  nodeIds = [],
  componentIds = [],
  assetIds = [],
  inputActionIds = [],
  worldSettings = false,
  wholeProject = false,
}: Partial<ProjectCommandAffectedRecords> = {}): ProjectCommandAffectedRecords {
  return {
    nodeIds: [...new Set(nodeIds)].sort(),
    componentIds: [...new Set(componentIds)].sort(),
    assetIds: [...new Set(assetIds)].sort(),
    inputActionIds: [...new Set(inputActionIds)].sort(),
    worldSettings,
    wholeProject,
  };
}

function mergeAffected(entries: readonly ProjectCommandAffectedRecords[]): ProjectCommandAffectedRecords {
  return affected({
    nodeIds: entries.flatMap((entry) => entry.nodeIds),
    componentIds: entries.flatMap((entry) => entry.componentIds),
    assetIds: entries.flatMap((entry) => entry.assetIds),
    inputActionIds: entries.flatMap((entry) => entry.inputActionIds),
    worldSettings: entries.some((entry) => entry.worldSettings),
    wholeProject: entries.some((entry) => entry.wholeProject),
  });
}

function baseResult(
  project: ProjectDocument,
  currentRevision: number,
  envelopeId: string | null,
): ProjectCommandResult {
  return {
    protocol: PROJECT_COMMAND_PROTOCOL,
    protocolVersion: PROJECT_COMMAND_PROTOCOL_VERSION,
    ok: false,
    envelopeId,
    projectId: project.id,
    baseRevision: currentRevision,
    revision: currentRevision,
    changed: false,
    project: cloneProject(project),
    applied: [],
    errors: [],
    warnings: [],
    patch: null,
    inverse: null,
  };
}

function invalidResult(
  project: ProjectDocument,
  currentRevision: number,
  envelopeId: string | null,
  error: ProjectCommandError,
): ProjectCommandResult {
  const result = baseResult(project, currentRevision, envelopeId);
  result.errors = [error];
  return result;
}

function isStableId(value: unknown): value is string {
  return typeof value === 'string' && stableIdPattern.test(value);
}

function validateEnvelopeShape(value: unknown): ProjectCommandError | null {
  const nonSerializablePath = findNonSerializable(value);
  if (nonSerializablePath) {
    return {
      code: 'invalid-envelope',
      message: 'Command envelope must contain only JSON-compatible serializable data.',
      path: nonSerializablePath,
    };
  }
  if (!isRecord(value)) return { code: 'invalid-envelope', message: 'Command envelope must be an object.' };
  const allowedKeys = ['protocol', 'protocolVersion', 'id', 'projectId', 'baseRevision', 'label', 'commands'];
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unknownKey) return { code: 'invalid-envelope', message: `Envelope field "${unknownKey}" is not supported.`, path: `/${unknownKey}` };
  if (value.protocol !== PROJECT_COMMAND_PROTOCOL || value.protocolVersion !== PROJECT_COMMAND_PROTOCOL_VERSION) {
    return { code: 'invalid-envelope', message: 'Command protocol or protocol version is not supported.' };
  }
  if (!isStableId(value.id)) return { code: 'invalid-envelope', message: 'Envelope id must be a stable identifier.', path: '/id' };
  if (!isStableId(value.projectId)) return { code: 'invalid-envelope', message: 'projectId must be a stable identifier.', path: '/projectId' };
  if (!Number.isInteger(value.baseRevision) || (value.baseRevision as number) < 0) {
    return { code: 'invalid-envelope', message: 'baseRevision must be a non-negative integer.', path: '/baseRevision' };
  }
  if (typeof value.label !== 'string' || !value.label.trim()) {
    return { code: 'invalid-envelope', message: 'Envelope label must be a non-empty string.', path: '/label' };
  }
  if (!Array.isArray(value.commands) || value.commands.length === 0 || value.commands.length > MAX_COMMANDS_PER_ENVELOPE) {
    return {
      code: 'invalid-envelope',
      message: `commands must contain between 1 and ${MAX_COMMANDS_PER_ENVELOPE} commands.`,
      path: '/commands',
    };
  }
  return null;
}

function validateCommandShape(value: unknown): CommandExecutionFailure | null {
  if (!isRecord(value)) return { ok: false, code: 'invalid-command', message: 'Command must be an object.' };
  if (!isStableId(value.id)) return { ok: false, code: 'invalid-command', message: 'Command id must be a stable identifier.', path: 'id' };
  if (typeof value.type !== 'string' || !commandTypes.includes(value.type as ProjectCommand['type'])) {
    return { ok: false, code: 'unsupported-command', message: `Command type "${String(value.type)}" is not supported.`, path: 'type' };
  }
  const allowedCommandKeys: Record<ProjectCommand['type'], readonly string[]> = {
    'project.replace': ['id', 'type', 'project'],
    'node.createPrimitive': ['id', 'type', 'primitive', 'nodeId', 'parentId', 'color'],
    'node.update': ['id', 'type', 'nodeId', 'changes'],
    'node.duplicate': ['id', 'type', 'nodeId'],
    'node.delete': ['id', 'type', 'nodeId'],
    'node.applyMaterial': ['id', 'type', 'nodeId', 'color'],
    'model.addInstance': ['id', 'type', 'assetId', 'parentId'],
    'component.add': ['id', 'type', 'nodeId', 'componentType', 'componentId', 'values'],
    'component.update': ['id', 'type', 'nodeId', 'componentType', 'componentId', 'changes'],
    'component.remove': ['id', 'type', 'nodeId', 'componentId'],
    'inputAction.upsert': ['id', 'type', 'action'],
    'inputAction.delete': ['id', 'type', 'actionId'],
    'world.updateSettings': ['id', 'type', 'changes'],
  };
  const unknownCommandKey = Object.keys(value).find((key) => !allowedCommandKeys[value.type as ProjectCommand['type']].includes(key));
  if (unknownCommandKey) return { ok: false, code: 'invalid-command', message: `Command field "${unknownCommandKey}" is not supported.`, path: unknownCommandKey };
  const requireStable = (key: string) => {
    if (!isStableId(value[key])) return { ok: false, code: 'invalid-command', message: `${key} must be a stable identifier.`, path: key } as const;
    return null;
  };
  if (value.type === 'project.replace') {
    if (!isRecord(value.project)) return { ok: false, code: 'invalid-command', message: 'project must be a project document.', path: 'project' };
  } else if (value.type === 'node.createPrimitive') {
    if (!primitiveTypes.includes(value.primitive as PrimitiveType)) return { ok: false, code: 'invalid-command', message: 'primitive is not supported.', path: 'primitive' };
    if (value.nodeId !== undefined && !isStableId(value.nodeId)) return { ok: false, code: 'invalid-command', message: 'nodeId must be a stable identifier.', path: 'nodeId' };
    if (value.parentId !== undefined && value.parentId !== null && !isStableId(value.parentId)) return { ok: false, code: 'invalid-command', message: 'parentId must be a stable identifier or null.', path: 'parentId' };
    if (value.color !== undefined && (typeof value.color !== 'string' || !colorPattern.test(value.color))) return { ok: false, code: 'invalid-command', message: 'color must be a six-digit hex color.', path: 'color' };
  } else if (value.type === 'node.update') {
    const idError = requireStable('nodeId');
    if (idError) return idError;
    if (!isRecord(value.changes) || Object.keys(value.changes).length === 0) return { ok: false, code: 'invalid-command', message: 'changes must be a non-empty object.', path: 'changes' };
    const unknownKey = Object.keys(value.changes).find((key) => !nodeChangeKeys.includes(key as keyof ProjectNodeChanges));
    if (unknownKey) return { ok: false, code: 'invalid-command', message: `Node change "${unknownKey}" is not supported.`, path: `changes.${unknownKey}` };
    const nestedKeys: Partial<Record<keyof ProjectNodeChanges, readonly string[]>> = {
      transform: ['position', 'rotation', 'scale'],
      material: ['color', 'emissive', 'emissiveIntensity', 'metalness', 'roughness'],
      model: ['assetId', 'fitMode', 'targetSize'],
      light: ['type', 'color', 'intensity', 'distance', 'castShadow'],
      camera: ['fov', 'near', 'far', 'primary'],
    };
    for (const [key, allowed] of Object.entries(nestedKeys)) {
      const nestedValue = value.changes[key];
      if (nestedValue === undefined) continue;
      if (!isRecord(nestedValue)) return { ok: false, code: 'invalid-command', message: `${key} must be an object.`, path: `changes.${key}` };
      const unknownNestedKey = Object.keys(nestedValue).find((candidate) => !allowed.includes(candidate));
      if (unknownNestedKey) return { ok: false, code: 'invalid-command', message: `${key} field "${unknownNestedKey}" is not supported.`, path: `changes.${key}.${unknownNestedKey}` };
    }
  } else if (value.type === 'node.duplicate' || value.type === 'node.delete') {
    const idError = requireStable('nodeId');
    if (idError) return idError;
  } else if (value.type === 'node.applyMaterial') {
    const idError = requireStable('nodeId');
    if (idError) return idError;
    if (typeof value.color !== 'string' || !colorPattern.test(value.color)) return { ok: false, code: 'invalid-command', message: 'color must be a six-digit hex color.', path: 'color' };
  } else if (value.type === 'model.addInstance') {
    const assetError = requireStable('assetId');
    if (assetError) return assetError;
    if (value.parentId !== undefined && value.parentId !== null && !isStableId(value.parentId)) return { ok: false, code: 'invalid-command', message: 'parentId must be a stable identifier or null.', path: 'parentId' };
  } else if (value.type === 'component.add') {
    const nodeError = requireStable('nodeId');
    if (nodeError) return nodeError;
    if (!isRegisteredComponentType(value.componentType)) return { ok: false, code: 'invalid-command', message: 'componentType is not registered.', path: 'componentType' };
    const componentType = value.componentType;
    if (value.componentId !== undefined && !isStableId(value.componentId)) return { ok: false, code: 'invalid-command', message: 'componentId must be a stable identifier.', path: 'componentId' };
    if (value.values !== undefined && !isRecord(value.values)) return { ok: false, code: 'invalid-command', message: 'values must be an object.', path: 'values' };
    if (isRecord(value.values)) {
      const unknownValueKey = Object.keys(value.values).find((key) => !componentValueKeys[componentType].includes(key));
      if (unknownValueKey) return { ok: false, code: 'invalid-command', message: `Component value "${unknownValueKey}" is not supported.`, path: `values.${unknownValueKey}` };
    }
  } else if (value.type === 'component.update') {
    const nodeError = requireStable('nodeId') ?? requireStable('componentId');
    if (nodeError) return nodeError;
    if (!isRegisteredComponentType(value.componentType)) return { ok: false, code: 'invalid-command', message: 'componentType is not registered.', path: 'componentType' };
    const componentType = value.componentType;
    if (!isRecord(value.changes) || Object.keys(value.changes).length === 0) return { ok: false, code: 'invalid-command', message: 'changes must be a non-empty object.', path: 'changes' };
    const unknownChangeKey = Object.keys(value.changes).find((key) => !componentValueKeys[componentType].includes(key));
    if (unknownChangeKey) return { ok: false, code: 'invalid-command', message: `Component change "${unknownChangeKey}" is not supported.`, path: `changes.${unknownChangeKey}` };
  } else if (value.type === 'component.remove') {
    const idError = requireStable('nodeId') ?? requireStable('componentId');
    if (idError) return idError;
  } else if (value.type === 'inputAction.upsert') {
    if (!isRecord(value.action)) return { ok: false, code: 'invalid-command', message: 'action must be an Input Action object.', path: 'action' };
    const unknownActionKey = Object.keys(value.action).find((key) => !['id', 'name', 'type', 'bindings'].includes(key));
    if (unknownActionKey) return { ok: false, code: 'invalid-command', message: `Input Action field "${unknownActionKey}" is not supported.`, path: `action.${unknownActionKey}` };
    if (Array.isArray(value.action.bindings)) {
      for (const [index, binding] of value.action.bindings.entries()) {
        if (!isRecord(binding)) return { ok: false, code: 'invalid-command', message: 'Input binding must be an object.', path: `action.bindings.${index}` };
        const unknownBindingKey = Object.keys(binding).find((key) => !['id', 'code', 'axis', 'scale'].includes(key));
        if (unknownBindingKey) return { ok: false, code: 'invalid-command', message: `Input binding field "${unknownBindingKey}" is not supported.`, path: `action.bindings.${index}.${unknownBindingKey}` };
      }
    }
  } else if (value.type === 'inputAction.delete') {
    const actionError = requireStable('actionId');
    if (actionError) return actionError;
  } else if (value.type === 'world.updateSettings') {
    if (!isRecord(value.changes) || Object.keys(value.changes).length === 0) return { ok: false, code: 'invalid-command', message: 'changes must be a non-empty object.', path: 'changes' };
    const unknownKey = Object.keys(value.changes).find((key) => !worldSettingKeys.includes(key as keyof ProjectSettings));
    if (unknownKey) return { ok: false, code: 'invalid-command', message: `World setting "${unknownKey}" is not supported.`, path: `changes.${unknownKey}` };
  }
  return null;
}

function commandFailure(
  code: CommandExecutionFailure['code'],
  message: string,
  path?: string,
  details?: string[],
): CommandExecutionFailure {
  return { ok: false, code, message, ...(path ? { path } : {}), ...(details ? { details } : {}) };
}

function executeCommand(project: ProjectDocument, command: ProjectCommand): CommandExecution {
  if (command.type === 'project.replace') {
    const loaded = loadProjectDocument(command.project);
    if (!loaded.ok) return commandFailure('validation-failed', 'Replacement project is invalid.', 'project', loaded.errors);
    return { ok: true, project: loaded.project, affected: affected({ wholeProject: true }) };
  }

  if (command.type === 'node.createPrimitive') {
    const parentId = command.parentId === undefined ? 'scene-root' : command.parentId;
    if (parentId !== null && !getNode(project, parentId)) return commandFailure('not-found', `Parent node "${parentId}" does not exist.`, 'parentId');
    const desiredNodeId = command.nodeId ?? `node-${command.id}`;
    if (getNode(project, desiredNodeId)) return commandFailure('conflict', `Node "${desiredNodeId}" already exists.`, 'nodeId');
    const created = addPrimitive(project, command.primitive, parentId, command.color);
    const next = cloneProject(created.project);
    const node = getNode(next, created.nodeId);
    if (!node) return commandFailure('operation-failed', 'Primitive creation did not return a scene node.');
    node.id = desiredNodeId;
    return { ok: true, project: next, affected: affected({ nodeIds: [desiredNodeId] }) };
  }

  if (command.type === 'node.update') {
    const existing = getNode(project, command.nodeId);
    if (!existing) return commandFailure('not-found', `Node "${command.nodeId}" does not exist.`, 'nodeId');
    if (command.changes.material !== undefined && existing.kind !== 'mesh') return commandFailure('conflict', 'Only primitive mesh nodes have editable material data.', 'changes.material');
    if (command.changes.model !== undefined && existing.kind !== 'model') return commandFailure('conflict', 'Only model nodes have model instance data.', 'changes.model');
    if (command.changes.light !== undefined && existing.kind !== 'light') return commandFailure('conflict', 'Only light nodes have light data.', 'changes.light');
    if (command.changes.camera !== undefined && existing.kind !== 'camera') return commandFailure('conflict', 'Only camera nodes have camera data.', 'changes.camera');
    if (
      (command.changes.castShadow !== undefined || command.changes.receiveShadow !== undefined) &&
      existing.kind !== 'mesh' &&
      existing.kind !== 'model'
    ) return commandFailure('conflict', 'Only mesh and model nodes have mesh shadow settings.', 'changes');
    const changes = structuredClone(command.changes);
    return {
      ok: true,
      project: updateNode(project, command.nodeId, (node) => ({ ...node, ...changes })),
      affected: affected({ nodeIds: [command.nodeId] }),
    };
  }

  if (command.type === 'node.duplicate') {
    const beforeIds = new Set(project.nodes.map((node) => node.id));
    const duplicated = duplicateNode(project, command.nodeId);
    if (!duplicated) return commandFailure('not-found', `Node "${command.nodeId}" cannot be duplicated.`, 'nodeId');
    const createdIds = duplicated.project.nodes.filter((node) => !beforeIds.has(node.id)).map((node) => node.id);
    return { ok: true, project: duplicated.project, affected: affected({ nodeIds: [command.nodeId, ...createdIds] }) };
  }

  if (command.type === 'node.delete') {
    if (!getNode(project, command.nodeId)) return commandFailure('not-found', `Node "${command.nodeId}" does not exist.`, 'nodeId');
    if (command.nodeId === 'scene-root') return commandFailure('conflict', 'The scene root cannot be deleted.', 'nodeId');
    const removedIds = new Set([command.nodeId]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const node of project.nodes) {
        if (node.parentId && removedIds.has(node.parentId) && !removedIds.has(node.id)) {
          removedIds.add(node.id);
          expanded = true;
        }
      }
    }
    const removedComponentIds = project.nodes
      .filter((node) => removedIds.has(node.id))
      .flatMap((node) => node.components.map((component) => component.id));
    return { ok: true, project: removeNode(project, command.nodeId), affected: affected({ nodeIds: [...removedIds], componentIds: removedComponentIds }) };
  }

  if (command.type === 'node.applyMaterial') {
    const node = getNode(project, command.nodeId);
    if (!node) return commandFailure('not-found', `Node "${command.nodeId}" does not exist.`, 'nodeId');
    if (node.kind !== 'mesh' || !node.material) return commandFailure('conflict', `Node "${command.nodeId}" has no editable primitive material.`, 'nodeId');
    return { ok: true, project: applyMaterial(project, command.nodeId, command.color), affected: affected({ nodeIds: [command.nodeId] }) };
  }

  if (command.type === 'model.addInstance') {
    if (!project.assets.some((asset) => asset.id === command.assetId)) return commandFailure('not-found', `Model asset "${command.assetId}" does not exist.`, 'assetId');
    const parentId = command.parentId === undefined ? 'scene-root' : command.parentId;
    if (parentId !== null && !getNode(project, parentId)) return commandFailure('not-found', `Parent node "${parentId}" does not exist.`, 'parentId');
    const added = addModelInstance(project, command.assetId, parentId);
    if (!added) return commandFailure('operation-failed', 'Model instance could not be created.');
    return { ok: true, project: added.project, affected: affected({ nodeIds: [added.nodeId], assetIds: [command.assetId] }) };
  }

  if (command.type === 'component.add') {
    const node = getNode(project, command.nodeId);
    if (!node) return commandFailure('not-found', `Node "${command.nodeId}" does not exist.`, 'nodeId');
    const definition = getComponentDefinition(command.componentType);
    const componentId = command.componentId ?? `component-${command.componentType}-${command.id}`;
    if (project.nodes.some((entry) => entry.components.some((component) => component.id === componentId))) {
      return commandFailure('conflict', `Component "${componentId}" already exists.`, 'componentId');
    }
    if (!definition.allowMultiple && node.components.some((component) => component.type === command.componentType)) {
      return commandFailure('conflict', `${definition.editor.advancedLabel} cannot be added more than once to a node.`, 'componentType');
    }
    const conflicting = node.components.find((component) => definition.conflicts.includes(component.type));
    if (conflicting) return commandFailure('conflict', `${definition.editor.advancedLabel} conflicts with ${conflicting.type}.`, 'componentType');
    const component = {
      ...definition.create(componentId),
      ...(command.values ? structuredClone(command.values) : {}),
      id: componentId,
      type: command.componentType,
    } as GameplayComponent;
    const issues = validateRegisteredComponent(component, { project, nodeId: command.nodeId });
    if (issues.length) return commandFailure('validation-failed', 'Component values are invalid.', 'values', issues.map((issue) => `${issue.path}: ${issue.message}`));
    return {
      ok: true,
      project: updateNode(project, command.nodeId, (current) => ({ ...current, components: [...current.components, component] })),
      affected: affected({ nodeIds: [command.nodeId], componentIds: [componentId] }),
    };
  }

  if (command.type === 'component.update') {
    const node = getNode(project, command.nodeId);
    if (!node) return commandFailure('not-found', `Node "${command.nodeId}" does not exist.`, 'nodeId');
    const component = node.components.find((entry) => entry.id === command.componentId);
    if (!component) return commandFailure('not-found', `Component "${command.componentId}" does not exist on node "${command.nodeId}".`, 'componentId');
    if (component.type !== command.componentType) return commandFailure('conflict', `Component "${command.componentId}" is ${component.type}, not ${command.componentType}.`, 'componentType');
    const updated = { ...component, ...structuredClone(command.changes), id: component.id, type: component.type } as GameplayComponent;
    const issues = validateRegisteredComponent(updated, { project, nodeId: command.nodeId });
    if (issues.length) return commandFailure('validation-failed', 'Component changes are invalid.', 'changes', issues.map((issue) => `${issue.path}: ${issue.message}`));
    return {
      ok: true,
      project: updateNode(project, command.nodeId, (current) => ({
        ...current,
        components: current.components.map((entry) => entry.id === command.componentId ? updated : entry),
      })),
      affected: affected({ nodeIds: [command.nodeId], componentIds: [command.componentId] }),
    };
  }

  if (command.type === 'component.remove') {
    const node = getNode(project, command.nodeId);
    if (!node) return commandFailure('not-found', `Node "${command.nodeId}" does not exist.`, 'nodeId');
    if (!node.components.some((component) => component.id === command.componentId)) return commandFailure('not-found', `Component "${command.componentId}" does not exist on node "${command.nodeId}".`, 'componentId');
    return {
      ok: true,
      project: updateNode(project, command.nodeId, (current) => ({
        ...current,
        components: current.components.filter((component) => component.id !== command.componentId),
      })),
      affected: affected({ nodeIds: [command.nodeId], componentIds: [command.componentId] }),
    };
  }

  if (command.type === 'inputAction.upsert') {
    const existing = project.inputActions.some((action) => action.id === command.action.id);
    const next = existing
      ? updateInputAction(project, command.action.id, {
          name: command.action.name,
          bindings: structuredClone(command.action.bindings),
        })
      : addInputAction(project, structuredClone(command.action));
    if (!next) return commandFailure('conflict', `Input Action "${command.action.id}" conflicts with an existing id or name.`, 'action');
    return { ok: true, project: next, affected: affected({ inputActionIds: [command.action.id] }) };
  }

  if (command.type === 'inputAction.delete') {
    if (!project.inputActions.some((action) => action.id === command.actionId)) return commandFailure('not-found', `Input Action "${command.actionId}" does not exist.`, 'actionId');
    const next = deleteInputAction(project, command.actionId);
    if (!next) return commandFailure('conflict', `Input Action "${command.actionId}" is still referenced by a component.`, 'actionId');
    return { ok: true, project: next, affected: affected({ inputActionIds: [command.actionId] }) };
  }

  if (command.type === 'world.updateSettings') {
    const next = cloneProject(project);
    next.settings = { ...next.settings, ...structuredClone(command.changes) };
    next.updatedAt = new Date().toISOString();
    return { ok: true, project: next, affected: affected({ worldSettings: true }) };
  }

  return commandFailure('unsupported-command', `Command type "${(command as ProjectCommand).type}" is not supported.`);
}

function escapeJsonPointer(value: string) {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function collectChangedPaths(
  before: unknown,
  after: unknown,
  path: string,
  paths: string[],
): boolean {
  if (Object.is(before, after)) return false;
  if (paths.length >= MAX_PATCH_PATHS) return true;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    let truncated = false;
    for (let index = 0; index < length; index += 1) {
      if (index >= before.length || index >= after.length) paths.push(`${path}/${index}` || `/${index}`);
      else truncated = collectChangedPaths(before[index], after[index], `${path}/${index}`, paths) || truncated;
      if (paths.length >= MAX_PATCH_PATHS) return true;
    }
    return truncated;
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    let truncated = false;
    for (const key of keys) {
      const childPath = `${path}/${escapeJsonPointer(key)}`;
      if (!Object.hasOwn(before, key) || !Object.hasOwn(after, key)) paths.push(childPath);
      else truncated = collectChangedPaths(before[key], after[key], childPath, paths) || truncated;
      if (paths.length >= MAX_PATCH_PATHS) return true;
    }
    return truncated;
  }
  paths.push(path || '/');
  return false;
}

function createPatchMetadata(
  before: ProjectDocument,
  after: ProjectDocument,
  commandAffected: ProjectCommandAffectedRecords,
): ProjectPatchMetadata {
  const changedPaths: string[] = [];
  const truncated = collectChangedPaths(before, after, '', changedPaths);
  return {
    format: 'json-pointer-v1',
    changedPaths,
    truncated,
    affected: commandAffected,
  };
}

export function executeProjectCommandEnvelope(
  project: ProjectDocument,
  currentRevision: number,
  envelopeValue: unknown,
): ProjectCommandResult {
  const safeCurrentRevision = Number.isInteger(currentRevision) && currentRevision >= 0 ? currentRevision : 0;
  const envelopeId = isRecord(envelopeValue) && typeof envelopeValue.id === 'string' ? envelopeValue.id : null;
  const projectValidation = loadProjectDocument(project);
  if (!projectValidation.ok || projectValidation.warnings.length > 0) {
    return invalidResult(project, safeCurrentRevision, envelopeId, {
      code: 'invalid-project',
      message: 'Current project must be valid and normalized before commands run.',
      details: projectValidation.ok ? projectValidation.warnings : projectValidation.errors,
    });
  }
  if (!Number.isInteger(currentRevision) || currentRevision < 0) {
    return invalidResult(project, safeCurrentRevision, envelopeId, {
      code: 'invalid-envelope',
      message: 'Current revision must be a non-negative integer.',
    });
  }
  const envelopeError = validateEnvelopeShape(envelopeValue);
  if (envelopeError) return invalidResult(project, currentRevision, envelopeId, envelopeError);
  const envelope = envelopeValue as ProjectCommandEnvelope;
  if (envelope.projectId !== project.id) {
    return invalidResult(project, currentRevision, envelope.id, {
      code: 'project-mismatch',
      message: `Envelope targets project "${envelope.projectId}", but the open project is "${project.id}".`,
    });
  }
  if (envelope.baseRevision !== currentRevision) {
    return invalidResult(project, currentRevision, envelope.id, {
      code: 'revision-conflict',
      message: `Envelope revision ${envelope.baseRevision} is stale; current revision is ${currentRevision}.`,
      expectedRevision: envelope.baseRevision,
      actualRevision: currentRevision,
    });
  }

  const commandIds = new Set<string>();
  for (const [commandIndex, commandValue] of envelope.commands.entries()) {
    const shapeError = validateCommandShape(commandValue);
    const commandId = isRecord(commandValue) && typeof commandValue.id === 'string' ? commandValue.id : undefined;
    if (shapeError) {
      return invalidResult(project, currentRevision, envelope.id, {
        code: shapeError.code,
        message: shapeError.message,
        commandIndex,
        ...(commandId ? { commandId } : {}),
        ...(shapeError.path ? { path: `/commands/${commandIndex}/${shapeError.path.replaceAll('.', '/')}` } : {}),
      });
    }
    if (commandIds.has(commandId!)) {
      return invalidResult(project, currentRevision, envelope.id, {
        code: 'duplicate-command-id',
        message: `Command id "${commandId}" appears more than once.`,
        commandIndex,
        commandId,
      });
    }
    commandIds.add(commandId!);
  }

  const original = cloneProject(project);
  let working = cloneProject(project);
  const applied: ProjectCommandApplied[] = [];
  const warnings: ProjectCommandWarning[] = [];

  for (const [commandIndex, command] of envelope.commands.entries()) {
    let execution: CommandExecution;
    try {
      execution = executeCommand(working, command);
    } catch (error) {
      execution = commandFailure(
        'operation-failed',
        error instanceof Error ? error.message : 'Command execution failed unexpectedly.',
      );
    }
    if (!execution.ok) {
      return invalidResult(project, currentRevision, envelope.id, {
        code: execution.code,
        message: execution.message,
        commandIndex,
        commandId: command.id,
        ...(execution.path ? { path: `/commands/${commandIndex}/${execution.path.replaceAll('.', '/')}` } : {}),
        ...(execution.details ? { details: execution.details } : {}),
      });
    }

    const validated = loadProjectDocument(execution.project);
    if (!validated.ok) {
      return invalidResult(project, currentRevision, envelope.id, {
        code: 'validation-failed',
        message: 'Command produced an invalid project; the entire batch was discarded.',
        commandIndex,
        commandId: command.id,
        details: validated.errors,
      });
    }
    working = validated.project;
    applied.push({ id: command.id, type: command.type, affected: execution.affected });
    warnings.push(...validated.warnings.map<ProjectCommandWarning>((message) => ({
      code: 'project-normalized',
      message,
      commandIndex,
      commandId: command.id,
    })));
  }

  const changed = JSON.stringify(original) !== JSON.stringify(working);
  const revision = changed ? currentRevision + 1 : currentRevision;
  const allAffected = mergeAffected(applied.map((entry) => entry.affected));
  const patch = changed ? createPatchMetadata(original, working, allAffected) : null;
  const inversePatch = changed ? createPatchMetadata(working, original, allAffected) : null;

  return {
    protocol: PROJECT_COMMAND_PROTOCOL,
    protocolVersion: PROJECT_COMMAND_PROTOCOL_VERSION,
    ok: true,
    envelopeId: envelope.id,
    projectId: working.id,
    baseRevision: currentRevision,
    revision,
    changed,
    project: cloneProject(working),
    applied,
    errors: [],
    warnings,
    patch,
    inverse: changed && inversePatch ? {
      kind: 'project-document-snapshot',
      targetProjectId: working.id,
      expectedBaseRevision: revision,
      snapshotRevision: currentRevision,
      document: original,
      patch: inversePatch,
    } : null,
  };
}

export function createInverseProjectCommandEnvelope(
  inverse: ProjectCommandInverse,
  envelopeId: string,
  label = 'Undo project command',
): ProjectCommandEnvelope {
  if (!isStableId(envelopeId)) throw new Error('Inverse envelope id must be a stable identifier.');
  return {
    protocol: PROJECT_COMMAND_PROTOCOL,
    protocolVersion: PROJECT_COMMAND_PROTOCOL_VERSION,
    id: envelopeId,
    projectId: inverse.targetProjectId,
    baseRevision: inverse.expectedBaseRevision,
    label,
    commands: [{
      id: `${envelopeId}.restore`,
      type: 'project.replace',
      project: cloneProject(inverse.document),
    }],
  };
}

export function isProjectCommandEnvelope(value: unknown): value is ProjectCommandEnvelope {
  if (validateEnvelopeShape(value)) return false;
  const envelope = value as ProjectCommandEnvelope;
  const ids = new Set<string>();
  return envelope.commands.every((command) => {
    if (validateCommandShape(command) || ids.has(command.id)) return false;
    ids.add(command.id);
    return true;
  });
}

export type ProjectCommandSerializableValue =
  | null
  | boolean
  | number
  | string
  | ProjectCommandSerializableValue[]
  | { [key: string]: ProjectCommandSerializableValue };
