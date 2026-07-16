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
  schemaVersion: 3;
  id: string;
  name: string;
  sceneName: string;
  updatedAt: string;
  settings: ProjectSettings;
  assets: ModelAssetRecord[];
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
