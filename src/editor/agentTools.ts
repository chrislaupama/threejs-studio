import {
  addModelInstance,
  addPrimitive,
  cloneProject,
  createGameplayComponent,
  createNodeId,
  createStarterProject,
  duplicateNode,
  getNode,
  loadProjectDocument,
  removeNode,
  updateNode,
} from './project';
import {
  KEYBOARD_CODE_PATTERN_SOURCE,
  addInputAction,
  createAxis2dInputAction,
  createKeyboardInputBinding,
  deleteInputAction,
  getInputActionReferences,
  updateInputAction,
} from './inputActions';
import type {
  CameraData,
  GameplayComponent,
  InputAction,
  KeyboardInputBinding,
  LightData,
  MaterialData,
  NodeKind,
  PrimitiveType,
  ProjectDocument,
  ProjectSettings,
  SceneNode,
  TransformData,
  Vec3,
} from './types';

type UnknownRecord = Record<string, unknown>;

export type AgentToolName =
  | 'studio_get_project_summary'
  | 'studio_reset_project'
  | 'studio_list_nodes'
  | 'studio_get_node'
  | 'studio_search_nodes'
  | 'studio_create_primitive'
  | 'studio_create_group'
  | 'studio_update_node'
  | 'studio_duplicate_node'
  | 'studio_delete_node'
  | 'studio_add_component'
  | 'studio_update_component'
  | 'studio_remove_component'
  | 'studio_list_input_actions'
  | 'studio_upsert_input_action'
  | 'studio_delete_input_action'
  | 'studio_update_world_settings'
  | 'studio_add_model_instance'
  | 'studio_get_editor_context'
  | 'studio_get_diagnostics'
  | 'studio_select_node'
  | 'studio_set_viewport'
  | 'studio_control_runtime'
  | 'studio_control_history'
  | 'studio_get_console'
  | 'studio_clear_console'
  | 'studio_set_editor_layout'
  | 'studio_save_project'
  | 'studio_export_project'
  | 'studio_build_project'
  | 'studio_request_project_import'
  | 'studio_request_model_import';

export type AgentToolCategory =
  | 'inspect'
  | 'scene'
  | 'gameplay'
  | 'input'
  | 'world'
  | 'assets'
  | 'editor'
  | 'viewport'
  | 'runtime'
  | 'history'
  | 'console'
  | 'project-io';
export type AgentRiskLevel = 'read' | 'low' | 'moderate' | 'destructive';
export type AgentApprovalPolicy = 'none' | 'when-sensitive' | 'required';

/** A deliberately small JSON Schema surface accepted by MCP and function-tool adapters. */
export type AgentArgumentSchema = Readonly<Record<string, unknown>>;

export interface AgentToolRisk {
  level: AgentRiskLevel;
  approval: AgentApprovalPolicy;
  reversible: boolean;
  rationale: string;
}

export interface AgentToolDefinition {
  name: AgentToolName;
  title: string;
  description: string;
  category: AgentToolCategory;
  readOnly: boolean;
  scopes: readonly string[];
  risk: AgentToolRisk;
  host?: 'project' | 'editor';
  inputSchema: AgentArgumentSchema;
}

export interface AgentCapabilityDomain {
  id: string;
  title: string;
  read: boolean;
  write: boolean;
  toolNames: readonly AgentToolName[];
}

export interface AgentCapabilityManifest {
  protocol: 'threejs-studio.authoring';
  compatibleProtocols: readonly ['threejs-game-studio.authoring'];
  protocolVersion: 1;
  product: {
    name: 'ThreeJS Studio';
    url: 'https://threejs.studio';
  };
  projectSchemaVersion: ProjectDocument['schemaVersion'];
  guarantees: readonly string[];
  domains: readonly AgentCapabilityDomain[];
  tools: readonly AgentToolDefinition[];
}

export interface AgentToolResult<T = unknown> {
  ok: boolean;
  nextProject: ProjectDocument;
  selectedId: string | null;
  changed: boolean;
  label: string;
  message: string;
  errors: string[];
  data?: T;
}

export interface AgentToolCallAssessment extends AgentToolRisk {
  toolName: string;
  requiresApproval: boolean;
  reasons: string[];
}

export interface AgentNodeSummary {
  id: string;
  name: string;
  kind: NodeKind;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  primitive?: PrimitiveType;
  assetId?: string;
  componentTypes: GameplayComponent['type'][];
  childCount: number;
}

const primitiveValues = ['box', 'sphere', 'capsule', 'cylinder', 'cone', 'plane', 'torus'] as const;
const nodeKindValues = ['group', 'mesh', 'model', 'light', 'camera'] as const;
const componentTypeValues = ['rotate', 'float', 'keyboardMove'] as const;
const axisValues = ['x', 'y', 'z'] as const;
const inputAxisValues = ['x', 'y'] as const;
const inputScaleValues = [-1, 1] as const;
const colorPattern = '^#[0-9a-fA-F]{6}$';
const stableIdPattern = '^[A-Za-z0-9][A-Za-z0-9._:-]*$';
const keyboardCodePattern = KEYBOARD_CODE_PATTERN_SOURCE;

const stringSchema = (description: string): AgentArgumentSchema => ({ type: 'string', minLength: 1, description });
const stableIdSchema = (description: string): AgentArgumentSchema => ({ type: 'string', minLength: 1, pattern: stableIdPattern, description });
const booleanSchema = (description: string): AgentArgumentSchema => ({ type: 'boolean', description });
const numberSchema = (description: string, minimum?: number, maximum?: number): AgentArgumentSchema => ({
  type: 'number',
  description,
  ...(minimum === undefined ? {} : { minimum }),
  ...(maximum === undefined ? {} : { maximum }),
});
const colorSchema = (description: string): AgentArgumentSchema => ({ type: 'string', pattern: colorPattern, description });
const vec3Schema = (description: string): AgentArgumentSchema => ({
  type: 'array',
  description,
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
});
const transformSchema: AgentArgumentSchema = {
  type: 'object',
  description: 'Only supplied transform channels are changed. Rotations use radians.',
  properties: {
    position: vec3Schema('World or parent-relative XYZ position.'),
    rotation: vec3Schema('XYZ Euler rotation in radians.'),
    scale: vec3Schema('XYZ scale.'),
  },
  additionalProperties: false,
};

const nodeIdProperties = { nodeId: stringSchema('Stable scene node identifier.') };
const keyboardBindingSchema: AgentArgumentSchema = {
  type: 'object',
  properties: {
    id: stableIdSchema('Stable binding identifier. Omit to match an existing binding by code or direction, then generate an identifier when needed.'),
    code: { type: 'string', minLength: 1, pattern: keyboardCodePattern, description: 'Supported physical KeyboardEvent.code value such as KeyW, ArrowUp, ControlLeft, or Numpad0.' },
    axis: { type: 'string', enum: inputAxisValues },
    scale: { type: 'number', enum: inputScaleValues },
  },
  required: ['code', 'axis', 'scale'],
  additionalProperties: false,
};

const toolDefinitions: AgentToolDefinition[] = [
  {
    name: 'studio_get_project_summary',
    title: 'Get project summary',
    description: 'Inspect project metadata, world settings, assets, named Input Actions, node totals, and gameplay-component totals.',
    category: 'inspect',
    readOnly: true,
    scopes: ['project.read', 'scene.read', 'world.read', 'assets.read', 'gameplay.read', 'input.read'],
    risk: { level: 'read', approval: 'none', reversible: true, rationale: 'Reads a cloned project without changing it.' },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_reset_project',
    title: 'Create new starter project',
    description: 'Replace the current project with a fresh validated starter scene. This changes the complete open project and requires explicit review.',
    category: 'scene',
    readOnly: false,
    scopes: ['project.write'],
    risk: { level: 'destructive', approval: 'required', reversible: true, rationale: 'Replaces the complete project document; the editor keeps the previous project as one Undo entry.' },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_list_nodes',
    title: 'List scene nodes',
    description: 'List compact scene-node summaries, optionally constrained to a parent, subtree, or node kind.',
    category: 'inspect',
    readOnly: true,
    scopes: ['scene.read'],
    risk: { level: 'read', approval: 'none', reversible: true, rationale: 'Reads scene hierarchy metadata only.' },
    inputSchema: {
      type: 'object',
      properties: {
        parentId: { type: ['string', 'null'], description: 'Parent to list. Omit to list every node.' },
        recursive: booleanSchema('When parentId is supplied, include every descendant.'),
        kinds: { type: 'array', items: { type: 'string', enum: nodeKindValues }, uniqueItems: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'studio_get_node',
    title: 'Get scene node',
    description: 'Get a full scene node plus child identifiers and referenced model-asset metadata.',
    category: 'inspect',
    readOnly: true,
    scopes: ['scene.read', 'assets.read', 'gameplay.read'],
    risk: { level: 'read', approval: 'none', reversible: true, rationale: 'Reads one scene node only.' },
    inputSchema: {
      type: 'object',
      properties: nodeIdProperties,
      required: ['nodeId'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_search_nodes',
    title: 'Search scene nodes',
    description: 'Search nodes by name/id text and optional kind, primitive, component, model asset, visibility, or lock filters.',
    category: 'inspect',
    readOnly: true,
    scopes: ['scene.read', 'assets.read', 'gameplay.read'],
    risk: { level: 'read', approval: 'none', reversible: true, rationale: 'Searches a cloned project without changing it.' },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive substring matched against node name and id.' },
        kind: { type: 'string', enum: nodeKindValues },
        primitive: { type: 'string', enum: primitiveValues },
        componentType: { type: 'string', enum: componentTypeValues },
        assetId: stringSchema('Only instances of this model asset.'),
        visible: booleanSchema('Filter by effective node visibility flag.'),
        locked: booleanSchema('Filter by node lock flag.'),
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'studio_create_primitive',
    title: 'Create primitive',
    description: 'Create a Three.js primitive mesh and optionally configure its name, transform, material, and shadows.',
    category: 'scene',
    readOnly: false,
    scopes: ['scene.write', 'materials.write'],
    risk: { level: 'low', approval: 'none', reversible: true, rationale: 'Adds one undoable scene object.' },
    inputSchema: {
      type: 'object',
      properties: {
        primitive: { type: 'string', enum: primitiveValues },
        parentId: { type: ['string', 'null'], default: 'scene-root' },
        name: stringSchema('Optional display name.'),
        color: colorSchema('Initial material base color.'),
        transform: transformSchema,
        material: {
          type: 'object',
          properties: {
            color: colorSchema('Base color.'),
            emissive: colorSchema('Emissive color.'),
            emissiveIntensity: numberSchema('Emissive strength.', 0),
            metalness: numberSchema('PBR metalness.', 0, 1),
            roughness: numberSchema('PBR roughness.', 0, 1),
          },
          additionalProperties: false,
        },
        castShadow: booleanSchema('Whether the mesh casts shadows.'),
        receiveShadow: booleanSchema('Whether the mesh receives shadows.'),
      },
      required: ['primitive'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_create_group',
    title: 'Create group',
    description: 'Create a transformable scene group for organizing or moving child nodes.',
    category: 'scene',
    readOnly: false,
    scopes: ['scene.write'],
    risk: { level: 'low', approval: 'none', reversible: true, rationale: 'Adds one undoable hierarchy node.' },
    inputSchema: {
      type: 'object',
      properties: {
        name: stringSchema('Group display name.'),
        parentId: { type: ['string', 'null'], default: 'scene-root' },
        transform: transformSchema,
        visible: booleanSchema('Initial visibility.'),
        locked: booleanSchema('Initial editor lock state.'),
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_update_node',
    title: 'Update scene node',
    description: 'Update hierarchy, identity, transform, visibility, lock, shadows, or type-specific mesh/model/light/camera properties.',
    category: 'scene',
    readOnly: false,
    scopes: ['scene.write', 'materials.write', 'assets.instances.write', 'lights.write', 'cameras.write'],
    risk: { level: 'moderate', approval: 'when-sensitive', reversible: true, rationale: 'Can edit locked nodes, root hierarchy, camera, or lighting state.' },
    inputSchema: {
      type: 'object',
      properties: {
        ...nodeIdProperties,
        name: stringSchema('New display name.'),
        parentId: { type: ['string', 'null'], description: 'New parent; null makes the node a root.' },
        visible: booleanSchema('Node visibility.'),
        locked: booleanSchema('Editor lock state.'),
        transform: transformSchema,
        material: {
          type: 'object',
          description: 'Mesh-only PBR material changes.',
          properties: {
            color: colorSchema('Base color.'),
            emissive: colorSchema('Emissive color.'),
            emissiveIntensity: numberSchema('Emissive strength.', 0),
            metalness: numberSchema('PBR metalness.', 0, 1),
            roughness: numberSchema('PBR roughness.', 0, 1),
          },
          additionalProperties: false,
        },
        model: {
          type: 'object',
          description: 'Imported-model instance sizing changes.',
          properties: {
            fitMode: { type: 'string', enum: ['fit', 'original'] },
            targetSize: numberSchema('Largest fitted dimension in scene units.', 0.001),
          },
          additionalProperties: false,
        },
        light: {
          type: 'object',
          description: 'Light-only changes.',
          properties: {
            type: { type: 'string', enum: ['directional', 'point', 'spot'] },
            color: colorSchema('Light color.'),
            intensity: numberSchema('Light intensity.', 0),
            distance: numberSchema('Light range; zero means unlimited where supported.', 0),
            castShadow: booleanSchema('Whether this light casts shadows.'),
          },
          additionalProperties: false,
        },
        camera: {
          type: 'object',
          description: 'Camera-only changes.',
          properties: {
            fov: numberSchema('Vertical field of view in degrees.', 1, 179),
            near: numberSchema('Near clipping distance.', 0.0001),
            far: numberSchema('Far clipping distance.', 0.001),
            primary: booleanSchema('Whether this is the primary game camera.'),
          },
          additionalProperties: false,
        },
        castShadow: booleanSchema('Mesh/model shadow casting.'),
        receiveShadow: booleanSchema('Mesh/model shadow receiving.'),
      },
      required: ['nodeId'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_duplicate_node',
    title: 'Duplicate node',
    description: 'Duplicate a node, its descendants, and gameplay components with fresh stable identifiers.',
    category: 'scene',
    readOnly: false,
    scopes: ['scene.write', 'gameplay.write'],
    risk: { level: 'low', approval: 'none', reversible: true, rationale: 'Creates an undoable copy while preserving the source.' },
    inputSchema: { type: 'object', properties: nodeIdProperties, required: ['nodeId'], additionalProperties: false },
  },
  {
    name: 'studio_delete_node',
    title: 'Delete node',
    description: 'Delete one scene node and its complete descendant subtree. The scene root cannot be deleted.',
    category: 'scene',
    readOnly: false,
    scopes: ['scene.delete', 'gameplay.delete'],
    risk: { level: 'destructive', approval: 'required', reversible: true, rationale: 'Removes a complete hierarchy subtree and should be confirmed by the user.' },
    inputSchema: { type: 'object', properties: nodeIdProperties, required: ['nodeId'], additionalProperties: false },
  },
  {
    name: 'studio_add_component',
    title: 'Add gameplay component',
    description: 'Attach keyboard movement, rotation, or floating behavior to a scene node using safe defaults and optional settings.',
    category: 'gameplay',
    readOnly: false,
    scopes: ['gameplay.write', 'input.read'],
    risk: { level: 'low', approval: 'none', reversible: true, rationale: 'Adds one undoable gameplay behavior.' },
    inputSchema: {
      type: 'object',
      properties: {
        ...nodeIdProperties,
        type: { type: 'string', enum: componentTypeValues },
        settings: {
          type: 'object',
          properties: {
            enabled: booleanSchema('Whether the behavior runs in Play mode.'),
            speed: numberSchema('Behavior speed; negative rotation/float speeds reverse direction.'),
            axis: { type: 'string', enum: axisValues },
            distance: numberSchema('Float travel distance.', 0),
            phase: numberSchema('Float phase offset in radians.'),
            plane: { type: 'string', enum: ['xz', 'xy'] },
            actionId: stableIdSchema('Named Input Action used by Keyboard Move.'),
          },
          additionalProperties: false,
        },
      },
      required: ['nodeId', 'type'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_update_component',
    title: 'Update gameplay component',
    description: 'Update an existing gameplay component by stable component id.',
    category: 'gameplay',
    readOnly: false,
    scopes: ['gameplay.write', 'input.read'],
    risk: { level: 'low', approval: 'when-sensitive', reversible: true, rationale: 'Changes one undoable gameplay behavior; reassigning controls is reviewed as sensitive.' },
    inputSchema: {
      type: 'object',
      properties: {
        ...nodeIdProperties,
        componentId: stringSchema('Stable gameplay component identifier.'),
        changes: {
          type: 'object',
          properties: {
            enabled: booleanSchema('Whether the behavior runs in Play mode.'),
            speed: numberSchema('Behavior speed; negative rotation/float speeds reverse direction.'),
            axis: { type: 'string', enum: axisValues },
            distance: numberSchema('Float travel distance.', 0),
            phase: numberSchema('Float phase offset in radians.'),
            plane: { type: 'string', enum: ['xz', 'xy'] },
            actionId: stableIdSchema('Named Input Action used by Keyboard Move.'),
          },
          additionalProperties: false,
        },
      },
      required: ['nodeId', 'componentId', 'changes'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_remove_component',
    title: 'Remove gameplay component',
    description: 'Remove one gameplay component from a node by stable component id.',
    category: 'gameplay',
    readOnly: false,
    scopes: ['gameplay.delete'],
    risk: { level: 'moderate', approval: 'when-sensitive', reversible: true, rationale: 'Removes an undoable gameplay behavior.' },
    inputSchema: {
      type: 'object',
      properties: { ...nodeIdProperties, componentId: stringSchema('Stable gameplay component identifier.') },
      required: ['nodeId', 'componentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_list_input_actions',
    title: 'List Input Actions',
    description: 'Inspect every named Input Action, its keyboard bindings, and the gameplay components that reference it.',
    category: 'input',
    readOnly: true,
    scopes: ['input.read', 'gameplay.read', 'scene.read'],
    risk: { level: 'read', approval: 'none', reversible: true, rationale: 'Reads cloned Input Action data without changing the project.' },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_upsert_input_action',
    title: 'Create or update Input Action',
    description: 'Create a named 2D axis action or update its name and complete keyboard-binding list. Omitted binding IDs are matched by code, then direction, before new IDs are generated.',
    category: 'input',
    readOnly: false,
    scopes: ['input.read', 'input.write', 'gameplay.read'],
    risk: { level: 'low', approval: 'when-sensitive', reversible: true, rationale: 'Creates or changes one named input mapping; changes to referenced controls are reviewed as sensitive.' },
    inputSchema: {
      type: 'object',
      properties: {
        actionId: stableIdSchema('Stable Input Action identifier. Omit to create one; a missing identifier is created when name is supplied.'),
        name: stringSchema('Unique display name for the Input Action.'),
        bindings: { type: 'array', items: keyboardBindingSchema },
      },
      minProperties: 1,
      additionalProperties: false,
    },
  },
  {
    name: 'studio_delete_input_action',
    title: 'Delete Input Action',
    description: 'Delete an unreferenced Input Action. Actions used by gameplay components must be reassigned before deletion.',
    category: 'input',
    readOnly: false,
    scopes: ['input.read', 'input.delete', 'gameplay.read'],
    risk: { level: 'moderate', approval: 'required', reversible: true, rationale: 'Removes a named input mapping after proving that no gameplay component references it.' },
    inputSchema: {
      type: 'object',
      properties: { actionId: stableIdSchema('Stable Input Action identifier.') },
      required: ['actionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_update_world_settings',
    title: 'Update world settings',
    description: 'Update background, fog, exposure, editor grid, and realtime-shadow settings.',
    category: 'world',
    readOnly: false,
    scopes: ['world.write', 'rendering.write'],
    risk: { level: 'low', approval: 'none', reversible: true, rationale: 'Changes undoable visual and rendering settings.' },
    inputSchema: {
      type: 'object',
      properties: {
        changes: {
          type: 'object',
          properties: {
            background: colorSchema('World clear color.'),
            fogColor: colorSchema('Depth-fog color.'),
            fogNear: numberSchema('Fog start distance.', 0, 100000),
            fogFar: numberSchema('Fog end distance.', 0.001, 100001),
            fogEnabled: booleanSchema('Whether depth fog is active.'),
            exposure: numberSchema('Tone-mapping exposure.', 0.1, 4),
            gridSize: numberSchema('Editor grid size.', 1, 1000),
            gridDivisions: { type: 'integer', minimum: 1, maximum: 1000 },
            shadows: booleanSchema('Whether realtime shadows are rendered.'),
          },
          additionalProperties: false,
        },
      },
      required: ['changes'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_add_model_instance',
    title: 'Add model instance',
    description: 'Create another scene instance of an existing imported model asset without duplicating its binary source.',
    category: 'assets',
    readOnly: false,
    scopes: ['assets.read', 'assets.instances.write', 'scene.write'],
    risk: { level: 'low', approval: 'none', reversible: true, rationale: 'Adds one undoable instance of an existing trusted project asset.' },
    inputSchema: {
      type: 'object',
      properties: {
        assetId: stringSchema('Existing model asset identifier.'),
        parentId: { type: ['string', 'null'], default: 'scene-root' },
        name: stringSchema('Optional instance name.'),
        transform: transformSchema,
        fitMode: { type: 'string', enum: ['fit', 'original'] },
        targetSize: numberSchema('Largest fitted dimension in scene units.', 0.001),
        visible: booleanSchema('Initial visibility.'),
        locked: booleanSchema('Initial editor lock state.'),
        castShadow: booleanSchema('Whether imported meshes cast shadows.'),
        receiveShadow: booleanSchema('Whether imported meshes receive shadows.'),
      },
      required: ['assetId'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_get_editor_context',
    title: 'Get editor context',
    description: 'Read live selection, authoring mode, viewport state, layout, dirty state, and undo/redo availability.',
    category: 'editor',
    readOnly: true,
    scopes: ['editor.context.read', 'editor.selection.read', 'editor.layout.read', 'history.read'],
    risk: { level: 'read', approval: 'none', reversible: true, rationale: 'Reads ephemeral editor state without changing the project or interface.' },
    host: 'editor',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_get_diagnostics',
    title: 'Get editor diagnostics',
    description: 'Read live editor, renderer, model-asset, and history diagnostics exposed by the mounted editor.',
    category: 'editor',
    readOnly: true,
    scopes: ['editor.diagnostics.read', 'renderer.diagnostics.read', 'assets.diagnostics.read', 'history.read'],
    risk: { level: 'read', approval: 'none', reversible: true, rationale: 'Reads diagnostic counters and states only.' },
    host: 'editor',
    inputSchema: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          description: 'Optional sections; omit to read every available diagnostic section.',
          items: { type: 'string', enum: ['editor', 'renderer', 'assets', 'history'] },
          minItems: 1,
          uniqueItems: true,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'studio_select_node',
    title: 'Select scene node',
    description: 'Select a scene node in the live editor, or clear selection with null, without changing the project document.',
    category: 'editor',
    readOnly: false,
    scopes: ['editor.selection.write', 'scene.read'],
    risk: { level: 'low', approval: 'none', reversible: true, rationale: 'Changes ephemeral selection only.' },
    host: 'editor',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: ['string', 'null'], description: 'Existing scene node id, or null to clear selection.' },
        reveal: booleanSchema('Open the hierarchy and inspector so the selection is visible.'),
        frame: booleanSchema('Frame the selected object in the scene viewport.'),
      },
      required: ['nodeId'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_set_viewport',
    title: 'Configure viewport',
    description: 'Configure live scene/game view, camera orientation, transform tool, coordinate space, snapping, grid, framing, or fullscreen.',
    category: 'viewport',
    readOnly: false,
    scopes: ['editor.viewport.write', 'editor.selection.read'],
    risk: { level: 'low', approval: 'none', reversible: true, rationale: 'Changes ephemeral viewport preferences without editing authored scene data.' },
    host: 'editor',
    inputSchema: {
      type: 'object',
      minProperties: 1,
      properties: {
        viewMode: { type: 'string', enum: ['scene', 'game'] },
        cameraView: { type: 'string', enum: ['perspective', 'top', 'right', 'front'] },
        tool: { type: 'string', enum: ['select', 'translate', 'rotate', 'scale'] },
        space: { type: 'string', enum: ['world', 'local'] },
        snap: booleanSchema('Whether transform snapping is active.'),
        gridVisible: booleanSchema('Whether the scene grid is visible.'),
        frameSelection: booleanSchema('Frame the current selection after applying the viewport changes.'),
        fullscreen: booleanSchema('Enter or leave viewport fullscreen mode.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'studio_control_runtime',
    title: 'Control game runtime',
    description: 'Play, pause, resume, fixed-step, stop, enter clean Preview, or exit Preview through the editor runtime lifecycle.',
    category: 'runtime',
    readOnly: false,
    scopes: ['runtime.control'],
    risk: { level: 'moderate', approval: 'none', reversible: true, rationale: 'Changes ephemeral Play mode while authored project data remains unchanged.' },
    host: 'editor',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['play', 'pause', 'resume', 'step', 'stop', 'preview', 'exit-preview'] } },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_control_history',
    title: 'Control editor history',
    description: 'Undo or redo one committed editor transaction through the same history used by the human interface.',
    category: 'history',
    readOnly: false,
    scopes: ['history.read', 'history.write', 'project.write'],
    risk: { level: 'moderate', approval: 'when-sensitive', reversible: true, rationale: 'Changes the current project revision through an existing undo or redo entry.' },
    host: 'editor',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['undo', 'redo'] } },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_get_console',
    title: 'Get editor console',
    description: 'Read recent editor console entries with optional level, text, and count filters.',
    category: 'console',
    readOnly: true,
    scopes: ['console.read'],
    risk: { level: 'read', approval: 'none', reversible: true, rationale: 'Reads editor-authored diagnostic messages only.' },
    host: 'editor',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['info', 'success', 'warning'] },
        query: { type: 'string', description: 'Case-insensitive substring matched against console messages.' },
        limit: { type: 'integer', minimum: 1, maximum: 120, default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'studio_clear_console',
    title: 'Clear editor console',
    description: 'Clear all current editor console entries without modifying the authored project.',
    category: 'console',
    readOnly: false,
    scopes: ['console.delete'],
    risk: { level: 'moderate', approval: 'required', reversible: false, rationale: 'Permanently removes the current diagnostic log from the editor session.' },
    host: 'editor',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_set_editor_layout',
    title: 'Configure editor layout',
    description: 'Switch experience level and show, hide, or focus hierarchy, inspector, project, console, Quick Start, or command-palette surfaces.',
    category: 'editor',
    readOnly: false,
    scopes: ['editor.layout.write'],
    risk: { level: 'low', approval: 'none', reversible: true, rationale: 'Changes ephemeral editor layout preferences only.' },
    host: 'editor',
    inputSchema: {
      type: 'object',
      minProperties: 1,
      properties: {
        experience: { type: 'string', enum: ['essentials', 'advanced'] },
        hierarchyOpen: booleanSchema('Show or hide the scene hierarchy.'),
        inspectorOpen: booleanSchema('Show or hide the inspector.'),
        bottomOpen: booleanSchema('Show or hide the Project/Console dock.'),
        bottomTab: { type: 'string', enum: ['assets', 'console'] },
        quickStartOpen: booleanSchema('Show or dismiss Quick Start.'),
        commandPaletteOpen: booleanSchema('Show or close the command palette.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'studio_save_project',
    title: 'Save project',
    description: 'Persist the current editable project and model references through the mounted editor save workflow.',
    category: 'project-io',
    readOnly: false,
    scopes: ['project.save', 'storage.write'],
    risk: { level: 'low', approval: 'none', reversible: false, rationale: 'Persists the current project revision to editor storage.' },
    host: 'editor',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_export_project',
    title: 'Export editable project',
    description: 'Download a portable editable project package, including available model-source bytes.',
    category: 'project-io',
    readOnly: false,
    scopes: ['project.export', 'assets.read', 'downloads.write'],
    risk: { level: 'low', approval: 'required', reversible: false, rationale: 'Creates a local download and may include project asset data.' },
    host: 'editor',
    inputSchema: {
      type: 'object',
      properties: { filename: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[a-zA-Z0-9][a-zA-Z0-9._ -]*$' } },
      additionalProperties: false,
    },
  },
  {
    name: 'studio_build_project',
    title: 'Build web game',
    description: 'Build and download the current project as a standalone HTML game using the editor build pipeline.',
    category: 'project-io',
    readOnly: false,
    scopes: ['project.build', 'assets.read', 'downloads.write'],
    risk: { level: 'low', approval: 'required', reversible: false, rationale: 'Creates a local executable build artifact containing project data.' },
    host: 'editor',
    inputSchema: {
      type: 'object',
      properties: { filename: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[a-zA-Z0-9][a-zA-Z0-9._ -]*$' } },
      additionalProperties: false,
    },
  },
  {
    name: 'studio_request_project_import',
    title: 'Request project import',
    description: 'Open the user-mediated project file picker. Choosing a valid package replaces the current editor project.',
    category: 'project-io',
    readOnly: false,
    scopes: ['project.import', 'local-files.request', 'project.write'],
    risk: { level: 'destructive', approval: 'required', reversible: false, rationale: 'Requires a local file choice and may replace the complete current project.' },
    host: 'editor',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_request_model_import',
    title: 'Request model import',
    description: 'Open the user-mediated model picker to import a new self-contained model or relink an existing asset.',
    category: 'project-io',
    readOnly: false,
    scopes: ['assets.import', 'local-files.request', 'project.write'],
    risk: { level: 'moderate', approval: 'required', reversible: true, rationale: 'Requires an explicit local file choice and may add or revise model asset data.' },
    host: 'editor',
    inputSchema: {
      type: 'object',
      properties: { assetId: stringSchema('Optional existing model asset id to relink or replace.') },
      additionalProperties: false,
    },
  },
];

export const AGENT_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = Object.freeze(
  toolDefinitions.map<AgentToolDefinition>((definition) => Object.freeze({ host: 'project', ...definition })),
);

export const AGENT_CAPABILITY_MANIFEST: AgentCapabilityManifest = Object.freeze<AgentCapabilityManifest>({
  protocol: 'threejs-studio.authoring',
  compatibleProtocols: ['threejs-game-studio.authoring'],
  protocolVersion: 1,
  product: {
    name: 'ThreeJS Studio',
    url: 'https://threejs.studio',
  },
  projectSchemaVersion: 4,
  guarantees: [
    'Every tool call validates its arguments and project result.',
    'No tool mutates the ProjectDocument supplied by the caller.',
    'Mutations return a complete nextProject suitable for the editor undo/redo history.',
    'Stable node, asset, component, Input Action, and binding identifiers are used instead of hierarchy indexes.',
    'Destructive and locked/root-sensitive calls expose approval metadata for human-in-the-loop hosts.',
    'Every definition declares whether it runs against a pure project document or requires the mounted editor host.',
    'project.write is the explicit full-document lifecycle scope used by reset, import, and history restoration operations.',
    'Editor-host tools use strict argument schemas and never silently fall back to pure project execution.',
    'Local project and model file access remains user-mediated through editor file pickers.',
  ],
  domains: [
    { id: 'project', title: 'Project inspection and lifecycle', read: true, write: true, toolNames: ['studio_get_project_summary', 'studio_reset_project'] },
    { id: 'scene', title: 'Scene hierarchy and transforms', read: true, write: true, toolNames: ['studio_list_nodes', 'studio_get_node', 'studio_search_nodes', 'studio_create_primitive', 'studio_create_group', 'studio_update_node', 'studio_duplicate_node', 'studio_delete_node'] },
    { id: 'materials', title: 'Primitive PBR materials', read: true, write: true, toolNames: ['studio_get_node', 'studio_update_node', 'studio_create_primitive'] },
    { id: 'gameplay', title: 'Gameplay components', read: true, write: true, toolNames: ['studio_get_node', 'studio_search_nodes', 'studio_add_component', 'studio_update_component', 'studio_remove_component'] },
    { id: 'input', title: 'Named Input Actions and keyboard bindings', read: true, write: true, toolNames: ['studio_get_project_summary', 'studio_list_input_actions', 'studio_upsert_input_action', 'studio_delete_input_action', 'studio_update_component'] },
    { id: 'world', title: 'World and rendering settings', read: true, write: true, toolNames: ['studio_get_project_summary', 'studio_update_world_settings'] },
    { id: 'model-assets', title: 'Imported model inspection and instancing', read: true, write: true, toolNames: ['studio_get_project_summary', 'studio_get_node', 'studio_search_nodes', 'studio_add_model_instance'] },
    { id: 'lights-cameras', title: 'Light and camera properties', read: true, write: true, toolNames: ['studio_get_node', 'studio_search_nodes', 'studio_update_node'] },
    { id: 'editor-context', title: 'Live editor context and diagnostics', read: true, write: false, toolNames: ['studio_get_editor_context', 'studio_get_diagnostics'] },
    { id: 'editor-selection', title: 'Live selection and layout', read: true, write: true, toolNames: ['studio_get_editor_context', 'studio_select_node', 'studio_set_editor_layout'] },
    { id: 'viewport', title: 'Viewport and transform controls', read: true, write: true, toolNames: ['studio_get_editor_context', 'studio_set_viewport'] },
    { id: 'runtime', title: 'Game preview lifecycle', read: true, write: true, toolNames: ['studio_get_editor_context', 'studio_control_runtime'] },
    { id: 'history', title: 'Undo and redo history', read: true, write: true, toolNames: ['studio_get_editor_context', 'studio_get_diagnostics', 'studio_control_history'] },
    { id: 'console', title: 'Editor console', read: true, write: true, toolNames: ['studio_get_console', 'studio_clear_console'] },
    { id: 'project-io', title: 'Save, import, export, and build workflows', read: true, write: true, toolNames: ['studio_save_project', 'studio_export_project', 'studio_build_project', 'studio_request_project_import', 'studio_request_model_import'] },
  ],
  tools: AGENT_TOOL_DEFINITIONS,
});

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: UnknownRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validateKeys(record: UnknownRecord, allowed: readonly string[], path: string, errors: string[]) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not supported.`);
  }
}

function readRecord(value: unknown, path: string, errors: string[]): UnknownRecord | null {
  if (isRecord(value)) return value;
  errors.push(`${path} must be an object.`);
  return null;
}

function readString(record: UnknownRecord, key: string, path: string, errors: string[], required = false): string | undefined {
  if (!hasOwn(record, key)) {
    if (required) errors.push(`${path}.${key} is required.`);
    return undefined;
  }
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${path}.${key} must be a non-empty string.`);
    return undefined;
  }
  return value.trim();
}

function readBoolean(record: UnknownRecord, key: string, path: string, errors: string[]): boolean | undefined {
  if (!hasOwn(record, key)) return undefined;
  if (typeof record[key] !== 'boolean') {
    errors.push(`${path}.${key} must be a boolean.`);
    return undefined;
  }
  return record[key];
}

function readNumber(
  record: UnknownRecord,
  key: string,
  path: string,
  errors: string[],
  limits: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  if (!hasOwn(record, key)) return undefined;
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}.${key} must be a finite number.`);
    return undefined;
  }
  if (limits.integer && !Number.isInteger(value)) errors.push(`${path}.${key} must be an integer.`);
  if (limits.min !== undefined && value < limits.min) errors.push(`${path}.${key} must be at least ${limits.min}.`);
  if (limits.max !== undefined && value > limits.max) errors.push(`${path}.${key} must be at most ${limits.max}.`);
  return value;
}

function readEnum<T extends string>(
  record: UnknownRecord,
  key: string,
  path: string,
  errors: string[],
  values: readonly T[],
  required = false,
): T | undefined {
  const value = readString(record, key, path, errors, required);
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) {
    errors.push(`${path}.${key} must be one of: ${values.join(', ')}.`);
    return undefined;
  }
  return value as T;
}

function readColor(record: UnknownRecord, key: string, path: string, errors: string[]): string | undefined {
  const value = readString(record, key, path, errors);
  if (value === undefined) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    errors.push(`${path}.${key} must be a six-digit hex color such as #55ead7.`);
    return undefined;
  }
  return value.toLowerCase();
}

function readVec3(record: UnknownRecord, key: string, path: string, errors: string[]): Vec3 | undefined {
  if (!hasOwn(record, key)) return undefined;
  const value = record[key];
  if (!Array.isArray(value) || value.length !== 3 || !value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    errors.push(`${path}.${key} must contain exactly three finite numbers.`);
    return undefined;
  }
  return [value[0], value[1], value[2]];
}

function readNullableParentId(record: UnknownRecord, errors: string[]): string | null | undefined {
  if (!hasOwn(record, 'parentId')) return undefined;
  const value = record.parentId;
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    errors.push('arguments.parentId must be a non-empty string or null.');
    return undefined;
  }
  return value.trim();
}

function readTransform(value: unknown, errors: string[], path = 'arguments.transform'): Partial<TransformData> | undefined {
  if (value === undefined) return undefined;
  const record = readRecord(value, path, errors);
  if (!record) return undefined;
  validateKeys(record, ['position', 'rotation', 'scale'], path, errors);
  const result: Partial<TransformData> = {};
  const position = readVec3(record, 'position', path, errors);
  const rotation = readVec3(record, 'rotation', path, errors);
  const scale = readVec3(record, 'scale', path, errors);
  if (position) result.position = position;
  if (rotation) result.rotation = rotation;
  if (scale) result.scale = scale;
  if (!Object.keys(result).length && !errors.length) errors.push(`${path} must change at least one transform channel.`);
  return result;
}

function readMaterial(value: unknown, errors: string[], path = 'arguments.material'): Partial<MaterialData> | undefined {
  if (value === undefined) return undefined;
  const record = readRecord(value, path, errors);
  if (!record) return undefined;
  validateKeys(record, ['color', 'emissive', 'emissiveIntensity', 'metalness', 'roughness'], path, errors);
  const result: Partial<MaterialData> = {};
  const color = readColor(record, 'color', path, errors);
  const emissive = readColor(record, 'emissive', path, errors);
  const emissiveIntensity = readNumber(record, 'emissiveIntensity', path, errors, { min: 0 });
  const metalness = readNumber(record, 'metalness', path, errors, { min: 0, max: 1 });
  const roughness = readNumber(record, 'roughness', path, errors, { min: 0, max: 1 });
  if (color) result.color = color;
  if (emissive) result.emissive = emissive;
  if (emissiveIntensity !== undefined) result.emissiveIntensity = emissiveIntensity;
  if (metalness !== undefined) result.metalness = metalness;
  if (roughness !== undefined) result.roughness = roughness;
  if (!Object.keys(result).length && !errors.length) errors.push(`${path} must change at least one material property.`);
  return result;
}

function readLight(value: unknown, errors: string[]): Partial<LightData> | undefined {
  if (value === undefined) return undefined;
  const path = 'arguments.light';
  const record = readRecord(value, path, errors);
  if (!record) return undefined;
  validateKeys(record, ['type', 'color', 'intensity', 'distance', 'castShadow'], path, errors);
  const result: Partial<LightData> = {};
  const type = readEnum(record, 'type', path, errors, ['directional', 'point', 'spot'] as const);
  const color = readColor(record, 'color', path, errors);
  const intensity = readNumber(record, 'intensity', path, errors, { min: 0 });
  const distance = readNumber(record, 'distance', path, errors, { min: 0 });
  const castShadow = readBoolean(record, 'castShadow', path, errors);
  if (type) result.type = type;
  if (color) result.color = color;
  if (intensity !== undefined) result.intensity = intensity;
  if (distance !== undefined) result.distance = distance;
  if (castShadow !== undefined) result.castShadow = castShadow;
  if (!Object.keys(result).length && !errors.length) errors.push(`${path} must change at least one light property.`);
  return result;
}

function readCamera(value: unknown, errors: string[]): Partial<CameraData> | undefined {
  if (value === undefined) return undefined;
  const path = 'arguments.camera';
  const record = readRecord(value, path, errors);
  if (!record) return undefined;
  validateKeys(record, ['fov', 'near', 'far', 'primary'], path, errors);
  const result: Partial<CameraData> = {};
  const fov = readNumber(record, 'fov', path, errors, { min: 1, max: 179 });
  const near = readNumber(record, 'near', path, errors, { min: 0.0001 });
  const far = readNumber(record, 'far', path, errors, { min: 0.001 });
  const primary = readBoolean(record, 'primary', path, errors);
  if (fov !== undefined) result.fov = fov;
  if (near !== undefined) result.near = near;
  if (far !== undefined) result.far = far;
  if (primary !== undefined) result.primary = primary;
  if (!Object.keys(result).length && !errors.length) errors.push(`${path} must change at least one camera property.`);
  return result;
}

function readModel(value: unknown, errors: string[]): Partial<NonNullable<SceneNode['model']>> | undefined {
  if (value === undefined) return undefined;
  const path = 'arguments.model';
  const record = readRecord(value, path, errors);
  if (!record) return undefined;
  validateKeys(record, ['fitMode', 'targetSize'], path, errors);
  const result: Partial<NonNullable<SceneNode['model']>> = {};
  const fitMode = readEnum(record, 'fitMode', path, errors, ['fit', 'original'] as const);
  const targetSize = readNumber(record, 'targetSize', path, errors, { min: 0.001 });
  if (fitMode) result.fitMode = fitMode;
  if (targetSize !== undefined) result.targetSize = targetSize;
  if (!Object.keys(result).length && !errors.length) errors.push(`${path} must change at least one model property.`);
  return result;
}

function emptyResult(project: ProjectDocument, label: string, message: string, errors: string[] = []): AgentToolResult {
  return {
    ok: errors.length === 0,
    nextProject: cloneProject(project),
    selectedId: null,
    changed: false,
    label,
    message,
    errors,
  };
}

function invalidResult(project: ProjectDocument, label: string, errors: string[], selectedId: string | null = null): AgentToolResult {
  return { ...emptyResult(project, label, 'The tool call was not applied.', errors), selectedId };
}

function successResult<T>(
  original: ProjectDocument,
  next: ProjectDocument,
  selectedId: string | null,
  label: string,
  message: string,
  data?: T,
): AgentToolResult<T> {
  const validation = loadProjectDocument(next);
  if (!validation.ok) {
    return {
      ok: false,
      nextProject: cloneProject(original),
      selectedId,
      changed: false,
      label,
      message: 'The generated project failed validation and was not applied.',
      errors: validation.errors,
    };
  }
  return {
    ok: true,
    nextProject: validation.project,
    selectedId,
    changed: JSON.stringify(validation.project) !== JSON.stringify(original),
    label,
    message,
    errors: [],
    ...(data === undefined ? {} : { data: structuredClone(data) }),
  };
}

function argsRecord(project: ProjectDocument, args: unknown, label: string): { record: UnknownRecord } | { result: AgentToolResult } {
  const errors: string[] = [];
  const record = readRecord(args, 'arguments', errors);
  if (!record) return { result: invalidResult(project, label, errors) };
  return { record };
}

function validateParent(project: ProjectDocument, parentId: string | null, errors: string[]) {
  if (parentId !== null && !getNode(project, parentId)) errors.push(`Parent node "${parentId}" does not exist.`);
}

function nodeSummary(project: ProjectDocument, node: SceneNode): AgentNodeSummary {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    parentId: node.parentId,
    visible: node.visible,
    locked: node.locked,
    ...(node.primitive ? { primitive: node.primitive } : {}),
    ...(node.model ? { assetId: node.model.assetId } : {}),
    componentTypes: node.components.map((component) => component.type),
    childCount: project.nodes.filter((candidate) => candidate.parentId === node.id).length,
  };
}

function descendantsOf(project: ProjectDocument, parentId: string): Set<string> {
  const ids = new Set<string>();
  let frontier = [parentId];
  while (frontier.length) {
    const nextFrontier: string[] = [];
    for (const candidate of project.nodes) {
      if (candidate.parentId && frontier.includes(candidate.parentId) && !ids.has(candidate.id)) {
        ids.add(candidate.id);
        nextFrontier.push(candidate.id);
      }
    }
    frontier = nextFrontier;
  }
  return ids;
}

function executeProjectSummary(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Inspect project';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const errors: string[] = [];
  validateKeys(parsed.record, [], 'arguments', errors);
  if (errors.length) return invalidResult(project, label, errors);

  const byKind = Object.fromEntries(nodeKindValues.map((kind) => [kind, project.nodes.filter((node) => node.kind === kind).length]));
  const byPrimitive = Object.fromEntries(primitiveValues.map((primitive) => [primitive, project.nodes.filter((node) => node.primitive === primitive).length]));
  const components = Object.fromEntries(componentTypeValues.map((type) => [type, project.nodes.reduce((count, node) => count + node.components.filter((component) => component.type === type).length, 0)]));
  const data = {
    project: { id: project.id, name: project.name, sceneName: project.sceneName, schemaVersion: project.schemaVersion, updatedAt: project.updatedAt },
    settings: structuredClone(project.settings),
    totals: {
      nodes: project.nodes.length,
      assets: project.assets.length,
      components: project.nodes.reduce((count, node) => count + node.components.length, 0),
      inputActions: project.inputActions.length,
    },
    byKind,
    byPrimitive,
    components,
    roots: project.nodes.filter((node) => node.parentId === null).map((node) => nodeSummary(project, node)),
    modelAssets: structuredClone(project.assets),
    inputActions: structuredClone(project.inputActions),
  };
  return { ...emptyResult(project, label, `Project has ${project.nodes.length} nodes and ${project.assets.length} model assets.`), data };
}

function executeResetProject(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Create new starter project';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const errors: string[] = [];
  validateKeys(parsed.record, [], 'arguments', errors);
  if (errors.length) return invalidResult(project, label, errors);
  const next = createStarterProject();
  return successResult(project, next, 'player-core', label, 'Created a fresh starter project.', {
    projectId: next.id,
    selectedId: 'player-core',
  });
}

function executeListNodes(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'List scene nodes';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['parentId', 'recursive', 'kinds'], 'arguments', errors);
  const parentId = readNullableParentId(record, errors);
  const recursive = readBoolean(record, 'recursive', 'arguments', errors) ?? false;
  let kinds: NodeKind[] | undefined;
  if (hasOwn(record, 'kinds')) {
    if (!Array.isArray(record.kinds) || !record.kinds.every((value) => typeof value === 'string' && nodeKindValues.includes(value as NodeKind))) {
      errors.push(`arguments.kinds must be an array containing only: ${nodeKindValues.join(', ')}.`);
    } else {
      kinds = [...new Set(record.kinds as NodeKind[])];
    }
  }
  if (parentId !== undefined) validateParent(project, parentId, errors);
  if (recursive && parentId === undefined) errors.push('arguments.recursive requires arguments.parentId.');
  if (errors.length) return invalidResult(project, label, errors);

  const descendants = recursive
    ? typeof parentId === 'string'
      ? descendantsOf(project, parentId)
      : new Set(project.nodes.map((node) => node.id))
    : null;
  const nodes = project.nodes.filter((node) => {
    if (parentId !== undefined) {
      if (recursive) {
        if (!descendants?.has(node.id)) return false;
      } else if (node.parentId !== parentId) return false;
    }
    return !kinds || kinds.includes(node.kind);
  });
  const data = { nodes: nodes.map((node) => nodeSummary(project, node)), total: nodes.length };
  return { ...emptyResult(project, label, `Found ${nodes.length} matching scene nodes.`), data };
}

function executeGetNode(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Inspect scene node';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['nodeId'], 'arguments', errors);
  const nodeId = readString(record, 'nodeId', 'arguments', errors, true);
  const node = nodeId ? getNode(project, nodeId) : undefined;
  if (nodeId && !node) errors.push(`Node "${nodeId}" does not exist.`);
  if (errors.length || !node) return invalidResult(project, label, errors, nodeId ?? null);
  const data = {
    node: structuredClone(node),
    childIds: project.nodes.filter((candidate) => candidate.parentId === node.id).map((candidate) => candidate.id),
    modelAsset: node.model ? structuredClone(project.assets.find((asset) => asset.id === node.model?.assetId) ?? null) : null,
  };
  return { ...emptyResult(project, label, `Read ${node.name}.`), selectedId: node.id, data };
}

function executeSearchNodes(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Search scene nodes';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['query', 'kind', 'primitive', 'componentType', 'assetId', 'visible', 'locked', 'limit'], 'arguments', errors);
  let query: string | undefined;
  if (hasOwn(record, 'query')) {
    if (typeof record.query !== 'string') errors.push('arguments.query must be a string.');
    else query = record.query.trim().toLowerCase();
  }
  const kind = readEnum(record, 'kind', 'arguments', errors, nodeKindValues);
  const primitive = readEnum(record, 'primitive', 'arguments', errors, primitiveValues);
  const componentType = readEnum(record, 'componentType', 'arguments', errors, componentTypeValues);
  const assetId = readString(record, 'assetId', 'arguments', errors);
  const visible = readBoolean(record, 'visible', 'arguments', errors);
  const locked = readBoolean(record, 'locked', 'arguments', errors);
  const limit = readNumber(record, 'limit', 'arguments', errors, { min: 1, max: 200, integer: true }) ?? 50;
  if (errors.length) return invalidResult(project, label, errors);

  const matches = project.nodes.filter((node) => {
    if (query && !node.name.toLowerCase().includes(query) && !node.id.toLowerCase().includes(query)) return false;
    if (kind && node.kind !== kind) return false;
    if (primitive && node.primitive !== primitive) return false;
    if (componentType && !node.components.some((component) => component.type === componentType)) return false;
    if (assetId && node.model?.assetId !== assetId) return false;
    if (visible !== undefined && node.visible !== visible) return false;
    if (locked !== undefined && node.locked !== locked) return false;
    return true;
  });
  const nodes = matches.slice(0, limit).map((node) => nodeSummary(project, node));
  const data = { nodes, total: matches.length, truncated: matches.length > nodes.length };
  return { ...emptyResult(project, label, `Found ${matches.length} matching scene nodes.`), data };
}

function applyCommonNodeOptions(node: SceneNode, record: UnknownRecord, errors: string[]): SceneNode {
  const transformChanges = readTransform(record.transform, errors);
  const name = readString(record, 'name', 'arguments', errors);
  const visible = readBoolean(record, 'visible', 'arguments', errors);
  const locked = readBoolean(record, 'locked', 'arguments', errors);
  const castShadow = readBoolean(record, 'castShadow', 'arguments', errors);
  const receiveShadow = readBoolean(record, 'receiveShadow', 'arguments', errors);
  return {
    ...node,
    ...(name ? { name } : {}),
    ...(visible === undefined ? {} : { visible }),
    ...(locked === undefined ? {} : { locked }),
    ...(transformChanges ? { transform: { ...node.transform, ...transformChanges } } : {}),
    ...(castShadow === undefined ? {} : { castShadow }),
    ...(receiveShadow === undefined ? {} : { receiveShadow }),
  };
}

function executeCreatePrimitive(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Create primitive';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['primitive', 'parentId', 'name', 'color', 'transform', 'material', 'castShadow', 'receiveShadow'], 'arguments', errors);
  const primitive = readEnum(record, 'primitive', 'arguments', errors, primitiveValues, true);
  const requestedParentId = readNullableParentId(record, errors);
  const parentId = requestedParentId === undefined ? 'scene-root' : requestedParentId;
  validateParent(project, parentId, errors);
  const color = readColor(record, 'color', 'arguments', errors) ?? '#7f91a8';
  const materialChanges = readMaterial(record.material, errors);
  if (errors.length || !primitive) return invalidResult(project, label, errors);

  const created = addPrimitive(project, primitive, parentId, color);
  const createdNode = getNode(created.project, created.nodeId);
  if (!createdNode) return invalidResult(project, label, ['Primitive creation did not return a valid node.']);
  const configured = applyCommonNodeOptions(createdNode, record, errors);
  const nextNode: SceneNode = {
    ...configured,
    material: configured.material && materialChanges ? { ...configured.material, ...materialChanges } : configured.material,
  };
  if (errors.length) return invalidResult(project, label, errors);
  const next = updateNode(created.project, created.nodeId, nextNode);
  return successResult(project, next, created.nodeId, `Create ${primitive}`, `Created ${nextNode.name}.`, { node: nextNode });
}

function executeCreateGroup(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Create group';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['name', 'parentId', 'transform', 'visible', 'locked'], 'arguments', errors);
  const name = readString(record, 'name', 'arguments', errors, true);
  const requestedParentId = readNullableParentId(record, errors);
  const parentId = requestedParentId === undefined ? 'scene-root' : requestedParentId;
  validateParent(project, parentId, errors);
  const transformChanges = readTransform(record.transform, errors);
  const visible = readBoolean(record, 'visible', 'arguments', errors) ?? true;
  const locked = readBoolean(record, 'locked', 'arguments', errors) ?? false;
  if (errors.length || !name) return invalidResult(project, label, errors);

  const next = cloneProject(project);
  const node: SceneNode = {
    id: createNodeId('group'),
    name,
    kind: 'group',
    parentId,
    visible,
    locked,
    transform: {
      position: transformChanges?.position ?? [0, 0, 0],
      rotation: transformChanges?.rotation ?? [0, 0, 0],
      scale: transformChanges?.scale ?? [1, 1, 1],
    },
    components: [],
  };
  next.nodes.push(node);
  next.updatedAt = new Date().toISOString();
  return successResult(project, next, node.id, label, `Created ${node.name}.`, { node });
}

function executeUpdateNode(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Update scene node';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  const allowed = ['nodeId', 'name', 'parentId', 'visible', 'locked', 'transform', 'material', 'model', 'light', 'camera', 'castShadow', 'receiveShadow'];
  validateKeys(record, allowed, 'arguments', errors);
  const nodeId = readString(record, 'nodeId', 'arguments', errors, true);
  const node = nodeId ? getNode(project, nodeId) : undefined;
  if (nodeId && !node) errors.push(`Node "${nodeId}" does not exist.`);
  const parentId = readNullableParentId(record, errors);
  if (parentId !== undefined) validateParent(project, parentId, errors);
  if (nodeId && parentId === nodeId) errors.push('A node cannot be its own parent.');
  const materialChanges = readMaterial(record.material, errors);
  const modelChanges = readModel(record.model, errors);
  const lightChanges = readLight(record.light, errors);
  const cameraChanges = readCamera(record.camera, errors);
  if (record.material !== undefined && node?.kind !== 'mesh') errors.push('arguments.material can only update mesh nodes.');
  if (record.model !== undefined && node?.kind !== 'model') errors.push('arguments.model can only update imported-model nodes.');
  if (record.light !== undefined && node?.kind !== 'light') errors.push('arguments.light can only update light nodes.');
  if (record.camera !== undefined && node?.kind !== 'camera') errors.push('arguments.camera can only update camera nodes.');
  if (!allowed.some((key) => key !== 'nodeId' && hasOwn(record, key))) errors.push('At least one node property must be supplied.');
  if (errors.length || !node || !nodeId) return invalidResult(project, label, errors, nodeId ?? null);

  let nextNode = applyCommonNodeOptions(node, record, errors);
  if (parentId !== undefined) nextNode = { ...nextNode, parentId };
  if (materialChanges && nextNode.material) nextNode = { ...nextNode, material: { ...nextNode.material, ...materialChanges } };
  if (modelChanges && nextNode.model) nextNode = { ...nextNode, model: { ...nextNode.model, ...modelChanges } };
  if (lightChanges && nextNode.light) nextNode = { ...nextNode, light: { ...nextNode.light, ...lightChanges } };
  if (cameraChanges && nextNode.camera) {
    const camera = { ...nextNode.camera, ...cameraChanges };
    if (camera.far <= camera.near) errors.push('Camera far distance must be greater than its near distance.');
    nextNode = { ...nextNode, camera };
  }
  if (errors.length) return invalidResult(project, label, errors, nodeId);
  if (JSON.stringify(nextNode) === JSON.stringify(node)) {
    return { ...emptyResult(project, label, `${node.name} already has those values.`), selectedId: nodeId };
  }
  const next = updateNode(project, nodeId, nextNode);
  return successResult(project, next, nodeId, `Update ${nextNode.name}`, `Updated ${nextNode.name}.`, { node: nextNode });
}

function executeDuplicateNode(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Duplicate scene node';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['nodeId'], 'arguments', errors);
  const nodeId = readString(record, 'nodeId', 'arguments', errors, true);
  const node = nodeId ? getNode(project, nodeId) : undefined;
  if (nodeId && !node) errors.push(`Node "${nodeId}" does not exist.`);
  if (nodeId === 'scene-root') errors.push('The scene root cannot be duplicated.');
  if (errors.length || !node || !nodeId) return invalidResult(project, label, errors, nodeId ?? null);
  const duplicated = duplicateNode(project, nodeId);
  if (!duplicated) return invalidResult(project, label, [`${node.name} could not be duplicated.`], nodeId);
  return successResult(project, duplicated.project, duplicated.nodeId, `Duplicate ${node.name}`, `Duplicated ${node.name}.`, { sourceId: nodeId, nodeId: duplicated.nodeId });
}

function executeDeleteNode(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Delete scene node';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['nodeId'], 'arguments', errors);
  const nodeId = readString(record, 'nodeId', 'arguments', errors, true);
  const node = nodeId ? getNode(project, nodeId) : undefined;
  if (nodeId && !node) errors.push(`Node "${nodeId}" does not exist.`);
  if (nodeId === 'scene-root') errors.push('The scene root cannot be deleted.');
  if (errors.length || !node || !nodeId) return invalidResult(project, label, errors, nodeId ?? null);
  const descendantCount = descendantsOf(project, nodeId).size;
  const next = removeNode(project, nodeId);
  return successResult(project, next, node.parentId, `Delete ${node.name}`, `Deleted ${node.name}${descendantCount ? ` and ${descendantCount} descendants` : ''}.`, { deletedId: nodeId, descendantCount });
}

function readComponentChanges(
  value: unknown,
  componentType: GameplayComponent['type'],
  errors: string[],
  path: 'arguments.settings' | 'arguments.changes',
): Partial<GameplayComponent> {
  const record = readRecord(value ?? {}, path, errors);
  if (!record) return {};
  const allowed = componentType === 'keyboardMove'
    ? ['enabled', 'speed', 'plane', 'actionId']
    : componentType === 'float'
      ? ['enabled', 'speed', 'axis', 'distance', 'phase']
      : ['enabled', 'speed', 'axis'];
  validateKeys(record, allowed, path, errors);
  const changes: UnknownRecord = {};
  const enabled = readBoolean(record, 'enabled', path, errors);
  const speed = readNumber(record, 'speed', path, errors, componentType === 'keyboardMove' ? { min: 0 } : {});
  if (enabled !== undefined) changes.enabled = enabled;
  if (speed !== undefined) changes.speed = speed;
  if (componentType === 'keyboardMove') {
    const plane = readEnum(record, 'plane', path, errors, ['xz', 'xy'] as const);
    if (plane) changes.plane = plane;
    const actionId = readString(record, 'actionId', path, errors);
    if (actionId) changes.actionId = actionId;
  } else {
    const axis = readEnum(record, 'axis', path, errors, axisValues);
    if (axis) changes.axis = axis;
    if (componentType === 'float') {
      const distance = readNumber(record, 'distance', path, errors, { min: 0 });
      const phase = readNumber(record, 'phase', path, errors);
      if (distance !== undefined) changes.distance = distance;
      if (phase !== undefined) changes.phase = phase;
    }
  }
  return changes as Partial<GameplayComponent>;
}

function executeAddComponent(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Add gameplay component';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['nodeId', 'type', 'settings'], 'arguments', errors);
  const nodeId = readString(record, 'nodeId', 'arguments', errors, true);
  const type = readEnum(record, 'type', 'arguments', errors, componentTypeValues, true);
  const node = nodeId ? getNode(project, nodeId) : undefined;
  if (nodeId && !node) errors.push(`Node "${nodeId}" does not exist.`);
  const changes = type ? readComponentChanges(record.settings, type, errors, 'arguments.settings') : {};
  const requestedActionId = (changes as { actionId?: string }).actionId;
  if (requestedActionId && !project.inputActions.some((action) => action.id === requestedActionId)) {
    errors.push(`Input Action "${requestedActionId}" does not exist.`);
  }
  if (type === 'keyboardMove' && !requestedActionId && !project.inputActions.length) {
    errors.push('Create an Input Action before adding Keyboard Move.');
  }
  if (errors.length || !node || !nodeId || !type) return invalidResult(project, label, errors, nodeId ?? null);
  let component = { ...createGameplayComponent(type), ...changes } as GameplayComponent;
  if (component.type === 'keyboardMove') {
    const actionId = component.actionId;
    if (!project.inputActions.some((action) => action.id === actionId)) {
      component = { ...component, actionId: project.inputActions[0].id };
    }
  }
  const next = updateNode(project, nodeId, { components: [...node.components, component] });
  return successResult(project, next, nodeId, `Add ${type} component`, `Added ${type} behavior to ${node.name}.`, { component });
}

function executeUpdateComponent(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Update gameplay component';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['nodeId', 'componentId', 'changes'], 'arguments', errors);
  const nodeId = readString(record, 'nodeId', 'arguments', errors, true);
  const componentId = readString(record, 'componentId', 'arguments', errors, true);
  const node = nodeId ? getNode(project, nodeId) : undefined;
  if (nodeId && !node) errors.push(`Node "${nodeId}" does not exist.`);
  const component = node?.components.find((candidate) => candidate.id === componentId);
  if (node && componentId && !component) errors.push(`Component "${componentId}" does not exist on ${node.name}.`);
  const changes = component ? readComponentChanges(record.changes, component.type, errors, 'arguments.changes') : {};
  const requestedActionId = (changes as { actionId?: string }).actionId;
  if (requestedActionId && !project.inputActions.some((action) => action.id === requestedActionId)) {
    errors.push(`Input Action "${requestedActionId}" does not exist.`);
  }
  if (!Object.keys(changes).length && !errors.length) errors.push('arguments.changes must update at least one component property.');
  if (errors.length || !node || !nodeId || !component || !componentId) return invalidResult(project, label, errors, nodeId ?? null);
  const nextComponent = { ...component, ...changes } as GameplayComponent;
  if (JSON.stringify(component) === JSON.stringify(nextComponent)) {
    return { ...emptyResult(project, label, `${component.type} already has those values.`), selectedId: nodeId };
  }
  const next = updateNode(project, nodeId, { components: node.components.map((candidate) => candidate.id === componentId ? nextComponent : candidate) });
  return successResult(project, next, nodeId, `Update ${component.type} component`, `Updated ${component.type} behavior on ${node.name}.`, { component: nextComponent });
}

function executeRemoveComponent(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Remove gameplay component';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['nodeId', 'componentId'], 'arguments', errors);
  const nodeId = readString(record, 'nodeId', 'arguments', errors, true);
  const componentId = readString(record, 'componentId', 'arguments', errors, true);
  const node = nodeId ? getNode(project, nodeId) : undefined;
  if (nodeId && !node) errors.push(`Node "${nodeId}" does not exist.`);
  const component = node?.components.find((candidate) => candidate.id === componentId);
  if (node && componentId && !component) errors.push(`Component "${componentId}" does not exist on ${node.name}.`);
  if (errors.length || !node || !nodeId || !component || !componentId) return invalidResult(project, label, errors, nodeId ?? null);
  const next = updateNode(project, nodeId, { components: node.components.filter((candidate) => candidate.id !== componentId) });
  return successResult(project, next, nodeId, `Remove ${component.type} component`, `Removed ${component.type} behavior from ${node.name}.`, { componentId });
}

function readKeyboardBindings(
  value: unknown,
  existingBindings: readonly KeyboardInputBinding[] | undefined,
  errors: string[],
): KeyboardInputBinding[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push('arguments.bindings must be an array.');
    return undefined;
  }
  const bindings: KeyboardInputBinding[] = [];
  const bindingIds = new Set<string>();
  const claimedExistingIds = new Set<string>();
  value.forEach((entry, index) => {
    const path = `arguments.bindings[${index}]`;
    const record = readRecord(entry, path, errors);
    if (!record) return;
    validateKeys(record, ['id', 'code', 'axis', 'scale'], path, errors);
    const requestedId = readString(record, 'id', path, errors);
    const code = readString(record, 'code', path, errors, true);
    const axis = readEnum(record, 'axis', path, errors, inputAxisValues, true);
    const scale = readNumber(record, 'scale', path, errors);
    if (scale !== undefined && scale !== -1 && scale !== 1) errors.push(`${path}.scale must be -1 or 1.`);
    if (!code || !axis || (scale !== -1 && scale !== 1)) return;
    const matchedExisting = requestedId
      ? existingBindings?.find((binding) => binding.id === requestedId)
      : existingBindings?.find((binding) => binding.code === code && !claimedExistingIds.has(binding.id))
        ?? existingBindings?.find((binding) => binding.axis === axis && binding.scale === scale && !claimedExistingIds.has(binding.id));
    const id = requestedId ?? matchedExisting?.id;
    const binding = createKeyboardInputBinding(code, axis, scale, id);
    if (bindingIds.has(binding.id)) errors.push(`${path}.id duplicates binding id "${binding.id}".`);
    bindingIds.add(binding.id);
    if (matchedExisting) claimedExistingIds.add(matchedExisting.id);
    bindings.push(binding);
  });
  return bindings;
}

function executeListInputActions(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'List Input Actions';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const errors: string[] = [];
  validateKeys(parsed.record, [], 'arguments', errors);
  if (errors.length) return invalidResult(project, label, errors);
  const actions = project.inputActions.map((action) => ({
    ...structuredClone(action),
    references: getInputActionReferences(project, action.id),
  }));
  return {
    ...emptyResult(project, label, `Project has ${actions.length} named Input Action${actions.length === 1 ? '' : 's'}.`),
    data: { actions, total: actions.length },
  };
}

function executeUpsertInputAction(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Create or update Input Action';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['actionId', 'name', 'bindings'], 'arguments', errors);
  const actionId = readString(record, 'actionId', 'arguments', errors);
  const name = readString(record, 'name', 'arguments', errors);
  const existing = actionId ? project.inputActions.find((action) => action.id === actionId) : undefined;
  const bindings = readKeyboardBindings(record.bindings, existing?.bindings, errors);
  if (!actionId && !name) errors.push('arguments.name is required when creating an Input Action without actionId.');
  if (existing && name === undefined && bindings === undefined) {
    errors.push('Provide arguments.name or arguments.bindings to update the Input Action.');
  }
  if (!existing && actionId && !name) {
    errors.push(`Input Action "${actionId}" does not exist; arguments.name is required to create it.`);
  }
  if (errors.length) return invalidResult(project, label, errors);

  if (existing) {
    const updatedAction: InputAction = {
      ...existing,
      ...(name ? { name } : {}),
      ...(bindings ? { bindings } : {}),
    };
    if (JSON.stringify(updatedAction) === JSON.stringify(existing)) {
      return emptyResult(project, label, `${existing.name} already has those input bindings.`);
    }
    const next = updateInputAction(project, existing.id, { name: updatedAction.name, bindings: updatedAction.bindings });
    if (!next) {
      return invalidResult(project, label, [`Another Input Action already uses the name "${updatedAction.name}".`]);
    }
    const action = next.inputActions.find((candidate) => candidate.id === existing.id)!;
    return successResult(project, next, null, `Update ${action.name} controls`, `Updated ${action.name} keyboard bindings.`, { action });
  }

  const action = createAxis2dInputAction({
    ...(actionId ? { id: actionId } : {}),
    name: name!,
    bindings: bindings ?? [],
  });
  const next = addInputAction(project, action);
  if (!next) {
    return invalidResult(project, label, [`Input Action id "${action.id}" or name "${action.name}" is already in use.`]);
  }
  return successResult(project, next, null, `Create ${action.name} controls`, `Created ${action.name} with ${action.bindings.length} keyboard bindings.`, { action });
}

function executeDeleteInputAction(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Delete Input Action';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['actionId'], 'arguments', errors);
  const actionId = readString(record, 'actionId', 'arguments', errors, true);
  const action = actionId ? project.inputActions.find((candidate) => candidate.id === actionId) : undefined;
  if (actionId && !action) errors.push(`Input Action "${actionId}" does not exist.`);
  const references = actionId ? getInputActionReferences(project, actionId) : [];
  if (action && references.length) {
    const names = [...new Set(references.map((reference) => reference.nodeName))];
    errors.push(`${action.name} is referenced by ${names.join(', ')}. Reassign those Keyboard Move components before deleting it.`);
  }
  if (errors.length || !action || !actionId) return invalidResult(project, label, errors);
  const next = deleteInputAction(project, actionId);
  if (!next) return invalidResult(project, label, [`${action.name} could not be deleted.`]);
  return successResult(project, next, null, `Delete ${action.name} controls`, `Deleted the unreferenced ${action.name} Input Action.`, { actionId });
}

function readWorldChanges(value: unknown, errors: string[]): Partial<ProjectSettings> {
  const path = 'arguments.changes';
  const record = readRecord(value, path, errors);
  if (!record) return {};
  validateKeys(record, ['background', 'fogColor', 'fogNear', 'fogFar', 'fogEnabled', 'exposure', 'gridSize', 'gridDivisions', 'shadows'], path, errors);
  const changes: Partial<ProjectSettings> = {};
  const background = readColor(record, 'background', path, errors);
  const fogColor = readColor(record, 'fogColor', path, errors);
  const fogNear = readNumber(record, 'fogNear', path, errors, { min: 0, max: 100000 });
  const fogFar = readNumber(record, 'fogFar', path, errors, { min: 0.001, max: 100001 });
  const fogEnabled = readBoolean(record, 'fogEnabled', path, errors);
  const exposure = readNumber(record, 'exposure', path, errors, { min: 0.1, max: 4 });
  const gridSize = readNumber(record, 'gridSize', path, errors, { min: 1, max: 1000 });
  const gridDivisions = readNumber(record, 'gridDivisions', path, errors, { min: 1, max: 1000, integer: true });
  const shadows = readBoolean(record, 'shadows', path, errors);
  if (background) changes.background = background;
  if (fogColor) changes.fogColor = fogColor;
  if (fogNear !== undefined) changes.fogNear = fogNear;
  if (fogFar !== undefined) changes.fogFar = fogFar;
  if (fogEnabled !== undefined) changes.fogEnabled = fogEnabled;
  if (exposure !== undefined) changes.exposure = exposure;
  if (gridSize !== undefined) changes.gridSize = gridSize;
  if (gridDivisions !== undefined) changes.gridDivisions = gridDivisions;
  if (shadows !== undefined) changes.shadows = shadows;
  return changes;
}

function executeUpdateWorld(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Update world settings';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['changes'], 'arguments', errors);
  if (!hasOwn(record, 'changes')) errors.push('arguments.changes is required.');
  const changes = readWorldChanges(record.changes, errors);
  if (!Object.keys(changes).length && !errors.length) errors.push('arguments.changes must update at least one world property.');
  const settings = { ...project.settings, ...changes };
  if (settings.fogFar <= settings.fogNear) errors.push('Fog end distance must be greater than fog start distance.');
  if (errors.length) return invalidResult(project, label, errors, 'scene-root');
  if (JSON.stringify(settings) === JSON.stringify(project.settings)) {
    return { ...emptyResult(project, label, 'World settings already have those values.'), selectedId: 'scene-root' };
  }
  const next = cloneProject(project);
  next.settings = settings;
  next.updatedAt = new Date().toISOString();
  return successResult(project, next, 'scene-root', label, 'Updated world and rendering settings.', { settings });
}

function executeAddModelInstance(project: ProjectDocument, args: unknown): AgentToolResult {
  const label = 'Add model instance';
  const parsed = argsRecord(project, args, label);
  if ('result' in parsed) return parsed.result;
  const record = parsed.record;
  const errors: string[] = [];
  validateKeys(record, ['assetId', 'parentId', 'name', 'transform', 'fitMode', 'targetSize', 'visible', 'locked', 'castShadow', 'receiveShadow'], 'arguments', errors);
  const assetId = readString(record, 'assetId', 'arguments', errors, true);
  const asset = assetId ? project.assets.find((candidate) => candidate.id === assetId) : undefined;
  if (assetId && !asset) errors.push(`Model asset "${assetId}" does not exist.`);
  const requestedParentId = readNullableParentId(record, errors);
  const parentId = requestedParentId === undefined ? 'scene-root' : requestedParentId;
  validateParent(project, parentId, errors);
  const fitMode = readEnum(record, 'fitMode', 'arguments', errors, ['fit', 'original'] as const);
  const targetSize = readNumber(record, 'targetSize', 'arguments', errors, { min: 0.001 });
  if (errors.length || !asset || !assetId) return invalidResult(project, label, errors);
  const created = addModelInstance(project, assetId, parentId);
  if (!created) return invalidResult(project, label, [`Model asset "${assetId}" could not be instanced.`]);
  const node = getNode(created.project, created.nodeId);
  if (!node || !node.model) return invalidResult(project, label, ['Model instance creation did not return a valid node.']);
  let configured = applyCommonNodeOptions(node, record, errors);
  configured = {
    ...configured,
    model: {
      ...node.model,
      ...(fitMode ? { fitMode } : {}),
      ...(targetSize === undefined ? {} : { targetSize }),
    },
  };
  if (errors.length) return invalidResult(project, label, errors);
  const next = updateNode(created.project, created.nodeId, configured);
  return successResult(project, next, created.nodeId, label, `Added an instance of ${asset.name}.`, { node: configured, asset: structuredClone(asset) });
}

const executors: Partial<Record<AgentToolName, (project: ProjectDocument, args: unknown) => AgentToolResult>> = {
  studio_get_project_summary: executeProjectSummary,
  studio_reset_project: executeResetProject,
  studio_list_nodes: executeListNodes,
  studio_get_node: executeGetNode,
  studio_search_nodes: executeSearchNodes,
  studio_create_primitive: executeCreatePrimitive,
  studio_create_group: executeCreateGroup,
  studio_update_node: executeUpdateNode,
  studio_duplicate_node: executeDuplicateNode,
  studio_delete_node: executeDeleteNode,
  studio_add_component: executeAddComponent,
  studio_update_component: executeUpdateComponent,
  studio_remove_component: executeRemoveComponent,
  studio_list_input_actions: executeListInputActions,
  studio_upsert_input_action: executeUpsertInputAction,
  studio_delete_input_action: executeDeleteInputAction,
  studio_update_world_settings: executeUpdateWorld,
  studio_add_model_instance: executeAddModelInstance,
};

export function getAgentToolDefinition(name: string): AgentToolDefinition | undefined {
  return AGENT_TOOL_DEFINITIONS.find((definition) => definition.name === name);
}

function valueMatchesSchemaType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  if (type === 'integer') return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function readableSchemaTypes(types: readonly string[]) {
  if (types.length === 1) return types[0];
  return `${types.slice(0, -1).join(', ')} or ${types.at(-1)}`;
}

function validateSchemaValue(schema: UnknownRecord, value: unknown, path: string, errors: string[]) {
  const rawTypes = schema.type;
  const types = typeof rawTypes === 'string'
    ? [rawTypes]
    : Array.isArray(rawTypes) && rawTypes.every((entry) => typeof entry === 'string')
      ? rawTypes
      : [];
  if (types.length && !types.some((type) => valueMatchesSchemaType(value, type))) {
    errors.push(`${path} must be ${readableSchemaTypes(types)}.`);
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
    errors.push(`${path} must be one of: ${schema.enum.map((entry) => String(entry)).join(', ')}.`);
    return;
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path} must contain at least ${schema.minLength} characters.`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path} must contain at most ${schema.maxLength} characters.`);
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match the required format.`);
      } catch {
        errors.push(`${path} uses an invalid registered pattern.`);
      }
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}.`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}.`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path} must contain at least ${schema.minItems} items.`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${path} must contain at most ${schema.maxItems} items.`);
    if (schema.uniqueItems === true && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) {
      errors.push(`${path} must not contain duplicate items.`);
    }
    if (isRecord(schema.items)) {
      value.forEach((entry, index) => validateSchemaValue(schema.items as UnknownRecord, entry, `${path}[${index}]`, errors));
    }
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties) {
      errors.push(`${path} must contain at least ${schema.minProperties} properties.`);
    }
    if (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties) {
      errors.push(`${path} must contain at most ${schema.maxProperties} properties.`);
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : [];
    for (const key of required) {
      if (!hasOwn(value, key)) errors.push(`${path}.${key} is required.`);
    }
    if (schema.additionalProperties === false) {
      for (const key of keys) {
        if (!hasOwn(properties, key)) errors.push(`${path}.${key} is not supported.`);
      }
    }
    for (const [key, entry] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (isRecord(propertySchema)) validateSchemaValue(propertySchema, entry, `${path}.${key}`, errors);
    }
  }
}

export function validateAgentToolArguments(toolName: string, args: unknown): string[] {
  const definition = getAgentToolDefinition(toolName);
  if (!definition) return [`Unknown agent tool "${toolName}".`];
  const errors: string[] = [];
  validateSchemaValue(definition.inputSchema as UnknownRecord, args, 'arguments', errors);
  return errors;
}

export function assessAgentToolCall(project: ProjectDocument, toolName: string, args: unknown): AgentToolCallAssessment {
  const definition = getAgentToolDefinition(toolName);
  if (!definition) {
    return {
      toolName,
      level: 'destructive',
      approval: 'required',
      reversible: false,
      rationale: 'Unknown tools are not part of the advertised authoring contract.',
      requiresApproval: true,
      reasons: ['The requested tool is unknown.'],
    };
  }
  const reasons: string[] = [];
  let level = definition.risk.level;
  let approval = definition.risk.approval;
  if (isRecord(args)) {
    const nodeId = typeof args.nodeId === 'string' ? args.nodeId : null;
    const node = nodeId ? getNode(project, nodeId) : undefined;
    if (node?.locked) reasons.push(`${node.name} is locked in the editor.`);
    if (nodeId === 'scene-root') reasons.push('The call targets the scene root.');
    if (toolName === 'studio_update_node' && hasOwn(args, 'parentId')) reasons.push('The call changes scene hierarchy.');
    if (toolName === 'studio_update_node' && (hasOwn(args, 'camera') || hasOwn(args, 'light'))) reasons.push('The call changes game framing or lighting.');
    if (toolName === 'studio_upsert_input_action' && typeof args.actionId === 'string' && hasOwn(args, 'bindings')) {
      const action = project.inputActions.find((candidate) => candidate.id === args.actionId);
      const references = action ? getInputActionReferences(project, action.id) : [];
      if (action && references.length) {
        const objectNames = [...new Set(references.map((reference) => reference.nodeName))].join(', ');
        reasons.push(Array.isArray(args.bindings) && args.bindings.length === 0
          ? `The call removes every binding from ${action.name}, which controls ${objectNames}.`
          : `The call changes ${action.name} bindings used by ${objectNames}.`);
      }
    }
    const componentChanges = args.changes;
    if (toolName === 'studio_update_component' && isRecord(componentChanges) && typeof componentChanges.actionId === 'string') {
      const componentId = typeof args.componentId === 'string' ? args.componentId : null;
      const component = node?.components.find((candidate) => candidate.id === componentId);
      if (component?.type === 'keyboardMove' && component.actionId !== componentChanges.actionId) {
        const currentAction = project.inputActions.find((action) => action.id === component.actionId)?.name ?? component.actionId;
        const nextAction = project.inputActions.find((action) => action.id === componentChanges.actionId)?.name ?? componentChanges.actionId;
        reasons.push(`The call reassigns ${node?.name ?? 'a scene object'} controls from ${currentAction} to ${nextAction}.`);
      }
    }
  }
  if (reasons.length && approval === 'when-sensitive') {
    level = level === 'low' || level === 'read' ? 'moderate' : level;
    approval = 'required';
  }
  return {
    ...definition.risk,
    toolName,
    level,
    approval,
    requiresApproval: approval === 'required',
    reasons: reasons.length ? reasons : [definition.risk.rationale],
  };
}

export function executeAgentTool<T = unknown>(project: ProjectDocument, toolName: string, args: unknown = {}): AgentToolResult<T> {
  const inputValidation = loadProjectDocument(project);
  if (!inputValidation.ok) {
    return {
      ok: false,
      nextProject: cloneProject(project),
      selectedId: null,
      changed: false,
      label: 'Validate project',
      message: 'The current project is invalid, so no agent tool was run.',
      errors: inputValidation.errors,
    };
  }
  const definition = getAgentToolDefinition(toolName);
  if (definition?.host === 'editor') {
    const argumentErrors = validateAgentToolArguments(toolName, args);
    if (argumentErrors.length) return invalidResult(inputValidation.project, definition.title, argumentErrors) as AgentToolResult<T>;
    return invalidResult(
      inputValidation.project,
      definition.title,
      [`Editor-host tool "${toolName}" requires the live editor bridge and cannot run through executeAgentTool().`],
    ) as AgentToolResult<T>;
  }
  const executor = executors[toolName as AgentToolName];
  if (!executor) {
    return invalidResult(inputValidation.project, 'Run agent tool', [`Unknown agent tool "${toolName}".`]) as AgentToolResult<T>;
  }
  return executor(inputValidation.project, args) as AgentToolResult<T>;
}
