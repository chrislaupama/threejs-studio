export type Vec3 = [number, number, number];

export type PrimitiveType =
  | 'box'
  | 'sphere'
  | 'capsule'
  | 'cylinder'
  | 'cone'
  | 'plane'
  | 'torus';

export type NodeKind = 'group' | 'mesh' | 'model' | 'light' | 'camera';

export interface TransformData {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface MaterialData {
  color: string;
  emissive: string;
  emissiveIntensity: number;
  metalness: number;
  roughness: number;
}

export interface LightData {
  type: 'directional' | 'point' | 'spot';
  color: string;
  intensity: number;
  distance: number;
  castShadow: boolean;
}

export interface CameraData {
  fov: number;
  near: number;
  far: number;
  primary: boolean;
}

export type Axis = 'x' | 'y' | 'z';

export interface KeyboardInputBinding {
  id: string;
  code: string;
  axis: 'x' | 'y';
  scale: -1 | 1;
}

export interface InputAction {
  id: string;
  name: string;
  type: 'axis2d';
  bindings: KeyboardInputBinding[];
}

interface GameplayComponentBase {
  id: string;
  enabled: boolean;
}

export interface RotateGameplayComponent extends GameplayComponentBase {
  type: 'rotate';
  speed: number;
  axis: Axis;
}

export interface FloatGameplayComponent extends GameplayComponentBase {
  type: 'float';
  speed: number;
  distance: number;
  axis: Axis;
  phase: number;
}

export interface KeyboardMoveGameplayComponent extends GameplayComponentBase {
  type: 'keyboardMove';
  speed: number;
  plane: 'xz' | 'xy';
  actionId: string;
}

export type GameplayComponent =
  | RotateGameplayComponent
  | FloatGameplayComponent
  | KeyboardMoveGameplayComponent;

export interface ModelAssetDiagnostics {
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  animationNames: string[];
  bounds: {
    min: Vec3;
    max: Vec3;
    size: Vec3;
    center: Vec3;
  };
  warnings: string[];
}

export interface ModelAssetRecord {
  id: string;
  kind: 'model';
  name: string;
  sourceFilename: string;
  mimeType: string;
  byteLength: number;
  revision: number;
  importedAt: string;
  diagnostics: ModelAssetDiagnostics;
}

export interface ModelInstanceData {
  assetId: string;
  fitMode: 'fit' | 'original';
  targetSize: number;
}

export interface SceneNode {
  id: string;
  name: string;
  kind: NodeKind;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  transform: TransformData;
  primitive?: PrimitiveType;
  material?: MaterialData;
  model?: ModelInstanceData;
  light?: LightData;
  camera?: CameraData;
  components: GameplayComponent[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface ProjectSettings {
  background: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  fogEnabled: boolean;
  exposure: number;
  gridSize: number;
  gridDivisions: number;
  shadows: boolean;
}

export interface ProjectDocument {
  schemaVersion: 4;
  id: string;
  name: string;
  sceneName: string;
  updatedAt: string;
  settings: ProjectSettings;
  assets: ModelAssetRecord[];
  inputActions: InputAction[];
  nodes: SceneNode[];
}

export type EditorTool = 'select' | 'translate' | 'rotate' | 'scale';
export type EditorMode = 'edit' | 'play' | 'paused';
export type ViewMode = 'scene' | 'game';

export interface RendererStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export type AssetKind = 'scene' | 'primitive' | 'material' | 'model';

export type AssetLoadState = 'checking' | 'loading' | 'ready' | 'missing' | 'error';

export interface AssetStatus {
  state: AssetLoadState;
  message?: string;
}

export interface StudioAsset {
  id: string;
  name: string;
  kind: AssetKind;
  primitive?: PrimitiveType;
  color?: string;
  modelAsset?: ModelAssetRecord;
  meta: string;
}

export interface ConsoleEntry {
  id: string;
  level: 'info' | 'success' | 'warning';
  message: string;
  time: string;
}

// Schema-v5 contracts are additive while the mounted editor continues to use
// ProjectDocument v4. Keeping the contracts beside the existing serializable
// types lets the migration and future runtime/editor adapters share one API
// without widening the current application's accepted document shape.
export type JsonPrimitiveV5 = string | number | boolean | null;
export type JsonValueV5 = JsonPrimitiveV5 | JsonValueV5[] | { [key: string]: JsonValueV5 };

export interface AssetSourceV5 {
  filename: string;
  mimeType: string;
  byteLength: number;
  contentHash?: string;
}

export interface AssetRecordBaseV5 {
  assetVersion: 1;
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface ModelAssetRecordV5 extends AssetRecordBaseV5 {
  kind: 'model';
  source: AssetSourceV5;
  diagnostics: ModelAssetDiagnostics;
}

export type TextureUsageV5 = 'color' | 'normal' | 'data' | 'environment' | 'ui';

export interface TextureAssetRecordV5 extends AssetRecordBaseV5 {
  kind: 'texture';
  source: AssetSourceV5;
  colorSpace: 'srgb' | 'linear' | 'none';
  usage: TextureUsageV5;
  flipY: boolean;
}

export interface AudioAssetRecordV5 extends AssetRecordBaseV5 {
  kind: 'audio';
  source: AssetSourceV5;
  streaming: boolean;
  durationSeconds?: number;
  channels?: number;
}

export type MaterialTextureSlotV5 =
  | 'baseColor'
  | 'normal'
  | 'metalness'
  | 'roughness'
  | 'occlusion'
  | 'emissive'
  | 'alpha';

export interface MaterialAssetRecordV5 extends AssetRecordBaseV5 {
  kind: 'material';
  material: MaterialData & {
    opacity: number;
    transparent: boolean;
    doubleSided: boolean;
  };
  textures: Partial<Record<MaterialTextureSlotV5, string>>;
}

export interface AnimationAssetRecordV5 extends AssetRecordBaseV5 {
  kind: 'animation';
  modelAssetId: string;
  clipName: string;
  durationSeconds?: number;
}

export interface EnvironmentAssetRecordV5 extends AssetRecordBaseV5 {
  kind: 'environment';
  source: AssetSourceV5;
  mapping: 'equirectangular' | 'cube';
  intensity: number;
}

export interface ScriptAssetRecordV5 extends AssetRecordBaseV5 {
  kind: 'script';
  source: AssetSourceV5;
  language: 'typescript' | 'javascript';
  runtime: 'worker' | 'sandboxed-frame';
  entryPoint: string;
}

export interface FontAssetRecordV5 extends AssetRecordBaseV5 {
  kind: 'font';
  source: AssetSourceV5;
  family: string;
}

export interface DataAssetRecordV5 extends AssetRecordBaseV5 {
  kind: 'data';
  value: JsonValueV5;
}

export type AssetRecord =
  | ModelAssetRecordV5
  | TextureAssetRecordV5
  | AudioAssetRecordV5
  | MaterialAssetRecordV5
  | AnimationAssetRecordV5
  | EnvironmentAssetRecordV5
  | ScriptAssetRecordV5
  | FontAssetRecordV5
  | DataAssetRecordV5;

export type AssetRecordV5 = AssetRecord;

export interface LayerDefinitionV5 {
  id: string;
  name: string;
  collisionMask: string[];
}

export interface PrefabOverrideV5 {
  entityId: string;
  path: string;
  value: JsonValueV5;
}

export interface PrefabInstanceDataV5 {
  prefabId: string;
  prefabVersion: number;
  overrides: PrefabOverrideV5[];
}

export type EntityKindV5 = NodeKind | 'prefab' | 'ui';

export interface EntityV5 {
  id: string;
  sceneId: string;
  name: string;
  kind: EntityKindV5;
  parentId: string | null;
  active: boolean;
  visible: boolean;
  locked: boolean;
  tags: string[];
  layers: string[];
  transform: TransformData;
  primitive?: PrimitiveType;
  material?: MaterialData;
  model?: ModelInstanceData;
  light?: LightData;
  camera?: CameraData;
  prefab?: PrefabInstanceDataV5;
  components: GameplayComponent[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface PrefabEntityV5 extends Omit<EntityV5, 'sceneId'> {
  sceneId: null;
}

export interface SceneRecordV5 {
  id: string;
  name: string;
  version: number;
  rootEntityIds: string[];
  settings: ProjectSettings;
  tags: string[];
}

export interface PrefabRecordV5 {
  id: string;
  name: string;
  version: number;
  rootEntityId: string;
  entities: PrefabEntityV5[];
  tags: string[];
}

export interface KeyboardInputBindingV5 {
  id: string;
  device: 'keyboard';
  code: string;
  axis?: 'x' | 'y';
  scale?: -1 | 1;
}

export interface PointerInputBindingV5 {
  id: string;
  device: 'pointer';
  control: 'primary' | 'secondary' | 'middle' | 'deltaX' | 'deltaY' | 'wheel';
  scale?: number;
}

export interface GamepadInputBindingV5 {
  id: string;
  device: 'gamepad';
  control: string;
  gamepadIndex?: number;
  axis?: 'x' | 'y';
  scale?: number;
}

export interface TouchInputBindingV5 {
  id: string;
  device: 'touch';
  control: string;
  axis?: 'x' | 'y';
  scale?: number;
}

export type InputBindingV5 =
  | KeyboardInputBindingV5
  | PointerInputBindingV5
  | GamepadInputBindingV5
  | TouchInputBindingV5;

export interface InputActionV5 {
  id: string;
  name: string;
  type: 'button' | 'axis1d' | 'axis2d';
  bindings: InputBindingV5[];
  deadZone: number;
}

export interface InputMapV5 {
  id: string;
  name: string;
  version: number;
  enabled: boolean;
  priority: number;
  actions: InputActionV5[];
}

export interface ProjectVariableV5 {
  id: string;
  name: string;
  type: 'boolean' | 'number' | 'string' | 'vec3' | 'json';
  scope: 'project' | 'save' | 'session';
  defaultValue: JsonValueV5;
}

export interface EventPayloadFieldV5 {
  id: string;
  name: string;
  type: ProjectVariableV5['type'] | 'entity' | 'asset';
  required: boolean;
}

export interface ProjectEventV5 {
  id: string;
  name: string;
  payload: EventPayloadFieldV5[];
}

export interface UIElementV5 {
  id: string;
  parentId: string | null;
  type: 'container' | 'text' | 'image' | 'button' | 'progress' | 'input';
  name: string;
  active: boolean;
  properties: Record<string, JsonValueV5>;
}

export interface UIDocumentV5 {
  id: string;
  name: string;
  sceneId: string | null;
  rootElementIds: string[];
  elements: UIElementV5[];
}

export interface ProjectUIV5 {
  startupDocumentId: string | null;
  documents: UIDocumentV5[];
}

export interface BuildProfileV5 {
  id: string;
  name: string;
  target: 'web' | 'pwa' | 'desktop';
  mode: 'development' | 'preview' | 'production';
  startupSceneId: string;
  quality: 'low' | 'medium' | 'high' | 'auto';
  basePath: string;
  offline: boolean;
}

export interface ProjectPermissionsV5 {
  network: {
    policy: 'deny' | 'allow-list';
    origins: string[];
  };
  localFiles: 'none' | 'user-mediated';
  storage: 'none' | 'local' | 'persistent';
  clipboard: boolean;
  fullscreen: boolean;
  pointerLock: boolean;
  gamepad: boolean;
  microphone: boolean;
  camera: boolean;
}

export interface ProjectDocumentV5 {
  schemaVersion: 5;
  id: string;
  name: string;
  updatedAt: string;
  startupSceneId: string;
  scenes: SceneRecordV5[];
  entities: EntityV5[];
  prefabs: PrefabRecordV5[];
  assets: AssetRecord[];
  layers: LayerDefinitionV5[];
  inputMaps: InputMapV5[];
  variables: ProjectVariableV5[];
  events: ProjectEventV5[];
  ui: ProjectUIV5;
  buildProfiles: BuildProfileV5[];
  defaultBuildProfileId: string;
  permissions: ProjectPermissionsV5;
}
