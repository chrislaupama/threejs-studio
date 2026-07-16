import type {
  MaterialData,
  PrimitiveType,
  ProjectDocument,
  SceneNode,
  StudioAsset,
  TransformData,
} from './types';

const TAU = Math.PI * 2;

const transform = (
  position: TransformData['position'] = [0, 0, 0],
  rotation: TransformData['rotation'] = [0, 0, 0],
  scale: TransformData['scale'] = [1, 1, 1],
): TransformData => ({ position, rotation, scale });

const material = (
  color: string,
  roughness = 0.45,
  metalness = 0.08,
  emissive = '#000000',
  emissiveIntensity = 0,
): MaterialData => ({ color, roughness, metalness, emissive, emissiveIntensity });

const createProjectId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `project-${Date.now().toString(36)}`;

export const createNodeId = (prefix = 'entity') =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;

export const BUILT_IN_ASSETS: StudioAsset[] = [
  { id: 'scene-main', name: 'MainWorld', kind: 'scene', meta: 'Scene · 13 objects' },
  { id: 'primitive-box', name: 'Crate', kind: 'primitive', primitive: 'box', color: '#8493a8', meta: 'Prefab · Mesh' },
  { id: 'primitive-capsule', name: 'Player Capsule', kind: 'primitive', primitive: 'capsule', color: '#53e0cf', meta: 'Prefab · Mesh' },
  { id: 'primitive-sphere', name: 'Energy Orb', kind: 'primitive', primitive: 'sphere', color: '#a78bfa', meta: 'Prefab · Mesh' },
  { id: 'primitive-torus', name: 'Energy Ring', kind: 'primitive', primitive: 'torus', color: '#f6c177', meta: 'Prefab · Mesh' },
  { id: 'primitive-cylinder', name: 'Column', kind: 'primitive', primitive: 'cylinder', color: '#69788e', meta: 'Prefab · Mesh' },
  { id: 'material-graphite', name: 'Graphite', kind: 'material', color: '#202a36', meta: 'Material · PBR' },
  { id: 'material-cyan', name: 'Neon Cyan', kind: 'material', color: '#55ead7', meta: 'Material · Emissive' },
  { id: 'material-violet', name: 'Studio Violet', kind: 'material', color: '#9b87f5', meta: 'Material · Emissive' },
  { id: 'material-coral', name: 'Signal Coral', kind: 'material', color: '#f47f6b', meta: 'Material · PBR' },
  { id: 'material-concrete', name: 'Soft Concrete', kind: 'material', color: '#7e8b9d', meta: 'Material · Rough' },
];

export function createStarterProject(): ProjectDocument {
  return {
    schemaVersion: 1,
    id: createProjectId(),
    name: 'Starter Project',
    sceneName: 'MainWorld',
    updatedAt: new Date().toISOString(),
    settings: {
      background: '#111823',
      fogColor: '#111823',
      fogNear: 18,
      fogFar: 56,
      gridSize: 30,
      gridDivisions: 30,
      shadows: true,
    },
    nodes: [
      {
        id: 'scene-root',
        name: 'MainWorld',
        kind: 'group',
        parentId: null,
        visible: true,
        locked: true,
        transform: transform(),
      },
      {
        id: 'environment',
        name: 'Environment',
        kind: 'group',
        parentId: 'scene-root',
        visible: true,
        locked: false,
        transform: transform(),
      },
      {
        id: 'ground',
        name: 'Ground Plane',
        kind: 'mesh',
        primitive: 'plane',
        parentId: 'environment',
        visible: true,
        locked: false,
        transform: transform([0, -0.06, 0], [-Math.PI / 2, 0, 0], [28, 28, 1]),
        material: material('#26303c', 0.88, 0.04),
        receiveShadow: true,
      },
      {
        id: 'platform',
        name: 'Hero Platform',
        kind: 'mesh',
        primitive: 'cylinder',
        parentId: 'environment',
        visible: true,
        locked: false,
        transform: transform([0, 0.28, 0], [0, 0, 0], [4.6, 0.56, 4.6]),
        material: material('#303c4c', 0.32, 0.52),
        castShadow: true,
        receiveShadow: true,
      },
      {
        id: 'arch-left',
        name: 'Arch Left',
        kind: 'mesh',
        primitive: 'box',
        parentId: 'environment',
        visible: true,
        locked: false,
        transform: transform([-4.5, 2.4, -3.8], [0, 0.12, 0], [0.55, 4.8, 0.72]),
        material: material('#39475a', 0.38, 0.36),
        castShadow: true,
        receiveShadow: true,
      },
      {
        id: 'arch-right',
        name: 'Arch Right',
        kind: 'mesh',
        primitive: 'box',
        parentId: 'environment',
        visible: true,
        locked: false,
        transform: transform([4.5, 2.4, -3.8], [0, -0.12, 0], [0.55, 4.8, 0.72]),
        material: material('#39475a', 0.38, 0.36),
        castShadow: true,
        receiveShadow: true,
      },
      {
        id: 'arch-top',
        name: 'Arch Header',
        kind: 'mesh',
        primitive: 'box',
        parentId: 'environment',
        visible: true,
        locked: false,
        transform: transform([0, 4.7, -3.8], [0, 0, 0], [9.55, 0.55, 0.72]),
        material: material('#354356', 0.38, 0.42, '#263b49', 0.2),
        castShadow: true,
        receiveShadow: true,
      },
      {
        id: 'player-rig',
        name: 'Player Rig',
        kind: 'group',
        parentId: 'scene-root',
        visible: true,
        locked: false,
        transform: transform([0, 1.55, 0]),
      },
      {
        id: 'player-core',
        name: 'Player Core',
        kind: 'mesh',
        primitive: 'capsule',
        parentId: 'player-rig',
        visible: true,
        locked: false,
        transform: transform([0, 0.2, 0], [0, 0, 0], [1.15, 1.15, 1.15]),
        material: material('#51dfce', 0.24, 0.58, '#1fd8c3', 0.42),
        castShadow: true,
        receiveShadow: true,
        behavior: { type: 'float', enabled: true, speed: 1.25, amplitude: 0.12 },
      },
      {
        id: 'player-ring',
        name: 'Orbit Ring',
        kind: 'mesh',
        primitive: 'torus',
        parentId: 'player-rig',
        visible: true,
        locked: false,
        transform: transform([0, 0.15, 0], [Math.PI / 2, 0, 0], [1.65, 1.65, 1.65]),
        material: material('#a58bf5', 0.2, 0.72, '#7659f2', 0.6),
        castShadow: true,
        behavior: { type: 'rotate', enabled: true, speed: 0.72, amplitude: 0 },
      },
      {
        id: 'main-camera',
        name: 'Main Camera',
        kind: 'camera',
        parentId: 'scene-root',
        visible: true,
        locked: false,
        transform: transform([9, 6.5, 11], [-0.34, 0.68, 0]),
        camera: { fov: 48, near: 0.1, far: 200, primary: true },
      },
      {
        id: 'key-light',
        name: 'Key Light',
        kind: 'light',
        parentId: 'scene-root',
        visible: true,
        locked: false,
        transform: transform([6, 10, 7], [-0.8, 0.55, 0]),
        light: { type: 'directional', color: '#d8eeff', intensity: 3.2, distance: 18, castShadow: true },
      },
      {
        id: 'rim-light',
        name: 'Rim Light',
        kind: 'light',
        parentId: 'scene-root',
        visible: true,
        locked: false,
        transform: transform([-4, 4.5, -2], [0, 0, 0]),
        light: { type: 'point', color: '#8b72ff', intensity: 34, distance: 15, castShadow: false },
      },
    ],
  };
}

export function cloneProject(project: ProjectDocument): ProjectDocument {
  return structuredClone(project);
}

export function getNode(project: ProjectDocument, id: string | null): SceneNode | undefined {
  return id ? project.nodes.find((node) => node.id === id) : undefined;
}

export function updateNode(
  project: ProjectDocument,
  id: string,
  update: Partial<SceneNode> | ((node: SceneNode) => SceneNode),
): ProjectDocument {
  const next = cloneProject(project);
  next.updatedAt = new Date().toISOString();
  next.nodes = next.nodes.map((node) => {
    if (node.id !== id) return node;
    return typeof update === 'function' ? update(node) : { ...node, ...update };
  });
  return next;
}

const defaultName = (primitive: PrimitiveType) =>
  ({
    box: 'Box',
    sphere: 'Sphere',
    capsule: 'Capsule',
    cylinder: 'Cylinder',
    cone: 'Cone',
    plane: 'Plane',
    torus: 'Torus',
  })[primitive];

const defaultScale = (primitive: PrimitiveType): TransformData['scale'] => {
  if (primitive === 'plane') return [5, 5, 1];
  if (primitive === 'torus') return [1.25, 1.25, 1.25];
  return [1, 1, 1];
};

export function addPrimitive(
  project: ProjectDocument,
  primitive: PrimitiveType,
  parentId: string | null = 'scene-root',
  color = '#7f91a8',
): { project: ProjectDocument; nodeId: string } {
  const next = cloneProject(project);
  const nodeId = createNodeId(primitive);
  const siblingCount = next.nodes.filter((node) => node.primitive === primitive).length;
  next.nodes.push({
    id: nodeId,
    name: `${defaultName(primitive)} ${String(siblingCount + 1).padStart(2, '0')}`,
    kind: 'mesh',
    primitive,
    parentId,
    visible: true,
    locked: false,
    transform: transform([0, primitive === 'plane' ? 0 : 0.65, 0], primitive === 'plane' ? [-Math.PI / 2, 0, 0] : [0, 0, 0], defaultScale(primitive)),
    material: material(color, primitive === 'plane' ? 0.82 : 0.42, primitive === 'plane' ? 0.02 : 0.16),
    castShadow: primitive !== 'plane',
    receiveShadow: true,
  });
  next.updatedAt = new Date().toISOString();
  return { project: next, nodeId };
}

export function duplicateNode(
  project: ProjectDocument,
  id: string,
): { project: ProjectDocument; nodeId: string } | null {
  const original = getNode(project, id);
  if (!original || original.id === 'scene-root') return null;

  const next = cloneProject(project);
  const idMap = new Map<string, string>();
  const descendants = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of project.nodes) {
      if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }

  for (const nodeId of descendants) idMap.set(nodeId, createNodeId('copy'));
  const clones = project.nodes
    .filter((node) => descendants.has(node.id))
    .map((node) => {
      const copy = structuredClone(node);
      copy.id = idMap.get(node.id) ?? copy.id;
      copy.parentId = node.id === id ? node.parentId : node.parentId ? idMap.get(node.parentId) ?? node.parentId : null;
      if (node.id === id) {
        copy.name = `${node.name} Copy`;
        copy.transform.position = [node.transform.position[0] + 1.25, node.transform.position[1], node.transform.position[2] + 0.35];
      }
      return copy;
    });

  next.nodes.push(...clones);
  next.updatedAt = new Date().toISOString();
  return { project: next, nodeId: idMap.get(id) ?? id };
}

export function removeNode(project: ProjectDocument, id: string): ProjectDocument {
  if (id === 'scene-root') return project;
  const removed = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of project.nodes) {
      if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
        removed.add(node.id);
        changed = true;
      }
    }
  }
  const next = cloneProject(project);
  next.nodes = next.nodes.filter((node) => !removed.has(node.id));
  next.updatedAt = new Date().toISOString();
  return next;
}

export function applyMaterial(project: ProjectDocument, id: string, color: string): ProjectDocument {
  return updateNode(project, id, (node) => {
    if (node.kind !== 'mesh' || !node.material) return node;
    const emissive = color === '#55ead7' || color === '#9b87f5' ? color : '#000000';
    return {
      ...node,
      material: {
        ...node.material,
        color,
        emissive,
        emissiveIntensity: emissive === '#000000' ? 0 : 0.32,
      },
    };
  });
}

export function isProjectDocument(value: unknown): value is ProjectDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProjectDocument>;
  return candidate.schemaVersion === 1 && typeof candidate.name === 'string' && Array.isArray(candidate.nodes);
}

export function downloadTextFile(contents: string, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildRuntimeHtml(project: ProjectDocument): string {
  const serialized = JSON.stringify(project).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${project.name.replaceAll('<', '&lt;')}</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#090d12;color:#eef5f4;font-family:Inter,system-ui,sans-serif}canvas{display:block;width:100%;height:100%}.badge{position:fixed;left:18px;bottom:18px;padding:9px 12px;border:1px solid #ffffff24;border-radius:8px;background:#0d131ccc;backdrop-filter:blur(12px);font-size:12px;letter-spacing:.03em}.badge b{color:#57e4d2}.hint{position:fixed;right:18px;bottom:18px;color:#9ba9b9;font-size:12px}
  </style>
  <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/"}}</script>
</head>
<body>
  <div class="badge"><b>THREEJS</b> GAME STUDIO · ${project.sceneName.replaceAll('<', '&lt;')}</div>
  <div class="hint">Drag to orbit · Scroll to zoom</div>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    const project = ${serialized};
    const renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.setSize(innerWidth,innerHeight);
    renderer.shadowMap.enabled=project.settings.shadows;
    renderer.shadowMap.type=THREE.PCFShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.1;
    document.body.prepend(renderer.domElement);
    const scene=new THREE.Scene();
    scene.background=new THREE.Color(project.settings.background);
    scene.fog=new THREE.Fog(project.settings.fogColor,project.settings.fogNear,project.settings.fogFar);
    scene.add(new THREE.HemisphereLight(0xbfd9ff,0x1a2028,1.15));
    const objects=new Map();
    const makeGeometry=(kind)=>({box:()=>new THREE.BoxGeometry(),sphere:()=>new THREE.SphereGeometry(.5,40,24),capsule:()=>new THREE.CapsuleGeometry(.5,1,8,24),cylinder:()=>new THREE.CylinderGeometry(.5,.5,1,32),cone:()=>new THREE.ConeGeometry(.55,1,32),plane:()=>new THREE.PlaneGeometry(1,1),torus:()=>new THREE.TorusGeometry(.6,.12,18,48)}[kind]());
    for(const node of project.nodes){
      const root=new THREE.Group(); root.name=node.name; root.userData.node=node; objects.set(node.id,root);
      if(node.kind==='mesh'){
        const m=node.material; const mat=new THREE.MeshStandardMaterial({color:m.color,roughness:m.roughness,metalness:m.metalness,emissive:m.emissive,emissiveIntensity:m.emissiveIntensity});
        const mesh=new THREE.Mesh(makeGeometry(node.primitive),mat); mesh.castShadow=!!node.castShadow; mesh.receiveShadow=!!node.receiveShadow; root.add(mesh);
      }
      if(node.kind==='light'){
        const l=node.light; let light;
        if(l.type==='directional') light=new THREE.DirectionalLight(l.color,l.intensity); else if(l.type==='spot') light=new THREE.SpotLight(l.color,l.intensity, l.distance, Math.PI/5,.35,1.4); else light=new THREE.PointLight(l.color,l.intensity,l.distance,2);
        light.castShadow=l.castShadow; root.add(light);
      }
      if(node.kind==='camera'){
        const c=node.camera; const cam=new THREE.PerspectiveCamera(c.fov,innerWidth/innerHeight,c.near,c.far); cam.userData.primary=c.primary; root.add(cam);
      }
      root.position.fromArray(node.transform.position); root.rotation.fromArray([...node.transform.rotation,'XYZ']); root.scale.fromArray(node.transform.scale); root.visible=node.visible;
    }
    for(const node of project.nodes){const obj=objects.get(node.id); const parent=node.parentId?objects.get(node.parentId):scene; parent.add(obj);}
    let camera;
    for(const root of objects.values()){const c=root.children.find(child=>child.isPerspectiveCamera&&child.userData.primary); if(c){camera=c;break}}
    if(!camera){camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,200);camera.position.set(9,6.5,11);camera.lookAt(0,1,0)}
    camera.updateMatrixWorld(true);
    const controls=new OrbitControls(camera,renderer.domElement); controls.enableDamping=true; controls.target.set(0,1.2,0);
    const clock=new THREE.Clock();
    function frame(){requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),.05);const t=clock.elapsedTime;for(const root of objects.values()){const n=root.userData.node;if(!n.behavior?.enabled)continue;if(n.behavior.type==='rotate')root.rotation.y+=dt*n.behavior.speed*${TAU.toFixed(8)}*.16;else if(n.behavior.type==='float')root.position.y=n.transform.position[1]+Math.sin(t*n.behavior.speed*2)*n.behavior.amplitude}controls.update();renderer.render(scene,camera)}
    addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});frame();
  </script>
</body>
</html>`;
}
