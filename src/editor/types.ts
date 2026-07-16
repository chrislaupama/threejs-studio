export type Vec3 = [number, number, number];

export type PrimitiveType =
  | 'box'
  | 'sphere'
  | 'capsule'
  | 'cylinder'
  | 'cone'
  | 'plane'
  | 'torus';

export type NodeKind = 'group' | 'mesh' | 'light' | 'camera';

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

export interface BehaviorData {
  type: 'rotate' | 'float';
  enabled: boolean;
  speed: number;
  amplitude: number;
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
  light?: LightData;
  camera?: CameraData;
  behavior?: BehaviorData;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface ProjectSettings {
  background: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  gridSize: number;
  gridDivisions: number;
  shadows: boolean;
}

export interface ProjectDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  sceneName: string;
  updatedAt: string;
  settings: ProjectSettings;
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

export type AssetKind = 'scene' | 'primitive' | 'material';

export interface StudioAsset {
  id: string;
  name: string;
  kind: AssetKind;
  primitive?: PrimitiveType;
  color?: string;
  meta: string;
}

export interface ConsoleEntry {
  id: string;
  level: 'info' | 'success' | 'warning';
  message: string;
  time: string;
}
