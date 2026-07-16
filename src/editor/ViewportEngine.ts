import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { disposeModelResources, parseModelSource, type StoredModelSource } from './modelAssets';
import type {
  AssetLoadState,
  EditorMode,
  EditorTool,
  GameplayComponent,
  ModelAssetRecord,
  PrimitiveType,
  ProjectDocument,
  RendererStats,
  SceneNode,
  TransformData,
  ViewMode,
} from './types';

interface ViewportCallbacks {
  onSelect: (id: string | null) => void;
  onTransformStart: (id: string) => void;
  onTransformChange: (id: string, transform: TransformData, final: boolean) => void;
  onStats: (stats: RendererStats) => void;
  resolveAssetSource: (projectId: string, assetId: string, revision: number) => Promise<StoredModelSource | null>;
  onAssetState: (nodeId: string, assetId: string, state: AssetLoadState, message?: string) => void;
}

interface CachedModel {
  refs: number;
  promise: Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>;
  value?: { scene: THREE.Group; animations: THREE.AnimationClip[] };
}

interface ModelBinding {
  key: string;
  token: number;
}

class MissingModelSourceError extends Error {
  constructor() {
    super('Model file is missing from this browser. Relink the source file to restore it.');
    this.name = 'MissingModelSourceError';
  }
}

const editorOnlyKey = 'studioEditorOnly';
const movementKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

function geometryFor(primitive: PrimitiveType): THREE.BufferGeometry {
  switch (primitive) {
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 40, 24);
    case 'capsule':
      return new THREE.CapsuleGeometry(0.5, 1, 8, 24);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1, false);
    case 'cone':
      return new THREE.ConeGeometry(0.55, 1, 32);
    case 'plane':
      return new THREE.PlaneGeometry(1, 1);
    case 'torus':
      return new THREE.TorusGeometry(0.6, 0.12, 18, 48);
    case 'box':
    default:
      return new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
  }
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else material.dispose();
}

function nodeTransform(object: THREE.Object3D): TransformData {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  };
}

function updateStandardMaterial(material: THREE.MeshStandardMaterial, node: SceneNode) {
  if (!node.material) return;
  material.color.set(node.material.color);
  material.emissive.set(node.material.emissive);
  material.emissiveIntensity = node.material.emissiveIntensity;
  material.metalness = node.material.metalness;
  material.roughness = node.material.roughness;
  material.needsUpdate = true;
}

export class ViewportEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly contentRoot = new THREE.Group();
  private readonly editorRoot = new THREE.Group();
  private readonly editorCamera = new THREE.PerspectiveCamera(48, 1, 0.05, 500);
  private readonly orbit: OrbitControls;
  private readonly transformControls: TransformControls;
  private readonly selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0x55ead7);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly objects = new Map<string, THREE.Group>();
  private readonly modelCache = new Map<string, CachedModel>();
  private readonly modelBindings = new Map<string, ModelBinding>();
  private readonly assetStatesByNode = new Map<string, AssetLoadState>();
  private readonly callbacks: ViewportCallbacks;
  private readonly resizeObserver: ResizeObserver;
  private grid: THREE.GridHelper;
  private document: ProjectDocument | null = null;
  private selectedId: string | null = null;
  private tool: EditorTool = 'translate';
  private mode: EditorMode = 'edit';
  private viewMode: ViewMode = 'scene';
  private disposed = false;
  private pointerDownAt = { x: 0, y: 0 };
  private runtimeTime = 0;
  private runtimeTick = 0;
  private stepRequested = false;
  private readonly keys = new Set<string>();
  private frames = 0;
  private totalFrames = 0;
  private statsElapsed = 0;
  private frameElapsed = 0;
  private lastTime = performance.now();
  private modelLoadToken = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: ViewportCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.contentRoot.name = 'Project Content';
    this.editorRoot.name = 'Editor Helpers';
    this.scene.add(this.contentRoot, this.editorRoot);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x11151c, 1.25));

    this.grid = this.createGrid(30, 30);
    this.editorRoot.add(this.grid);

    this.selectionBox.material.depthTest = false;
    this.selectionBox.material.transparent = true;
    this.selectionBox.material.opacity = 0.72;
    this.selectionBox.renderOrder = 100;
    this.selectionBox.visible = false;
    this.selectionBox.userData[editorOnlyKey] = true;
    this.editorRoot.add(this.selectionBox);

    this.editorCamera.position.set(9.5, 6.8, 11.5);
    this.editorCamera.lookAt(0, 1.2, 0);
    this.orbit = new OrbitControls(this.editorCamera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.target.set(0, 1.25, 0);
    this.orbit.minDistance = 2;
    this.orbit.maxDistance = 80;
    this.orbit.screenSpacePanning = true;

    this.transformControls = new TransformControls(this.editorCamera, canvas);
    this.transformControls.size = 0.85;
    this.transformControls.setMode('translate');
    const transformHelper = this.transformControls.getHelper();
    transformHelper.userData[editorOnlyKey] = true;
    this.editorRoot.add(transformHelper);

    this.transformControls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean(event.value);
      this.orbit.enabled = !dragging && this.mode === 'edit' && this.viewMode === 'scene';
    });
    this.transformControls.addEventListener('mouseDown', () => {
      if (this.selectedId) this.callbacks.onTransformStart(this.selectedId);
    });
    this.transformControls.addEventListener('objectChange', () => {
      if (!this.selectedId) return;
      const object = this.objects.get(this.selectedId);
      if (!object) return;
      this.selectionBox.setFromObject(object);
      this.callbacks.onTransformChange(this.selectedId, nodeTransform(object), false);
    });
    this.transformControls.addEventListener('mouseUp', () => {
      if (!this.selectedId) return;
      const object = this.objects.get(this.selectedId);
      if (object) this.callbacks.onTransformChange(this.selectedId, nodeTransform(object), true);
    });

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.renderer.setAnimationLoop(this.render);
  }

  private createGrid(size: number, divisions: number) {
    const grid = new THREE.GridHelper(size, divisions, 0x637286, 0x2a3543);
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = 0.46;
      material.depthWrite = false;
    }
    grid.position.y = 0.002;
    grid.userData[editorOnlyKey] = true;
    return grid;
  }

  private readonly resize = () => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.renderer.setSize(width, height, false);
    this.editorCamera.aspect = width / height;
    this.editorCamera.updateProjectionMatrix();
    for (const object of this.objects.values()) {
      object.traverse((child) => {
        if (child instanceof THREE.PerspectiveCamera) {
          child.aspect = width / height;
          child.updateProjectionMatrix();
        }
      });
    }
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (this.mode !== 'edit' || this.viewMode !== 'scene' || this.transformControls.dragging) return;
    const distance = Math.hypot(event.clientX - this.pointerDownAt.x, event.clientY - this.pointerDownAt.y);
    if (distance > 5) return;
    this.pick(event);
  };

  private readonly onDoubleClick = () => {
    if (this.selectedId) this.frameSelection();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (this.mode !== 'play') return;
    const key = event.key.toLowerCase();
    if (!movementKeys.has(key)) return;
    this.keys.add(key);
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key.toLowerCase());
  };

  private readonly onWindowBlur = () => {
    this.keys.clear();
  };

  private pick(event: PointerEvent) {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.editorCamera);
    const hits = this.raycaster.intersectObjects([...this.objects.values()], true);
    for (const hit of hits) {
      let current: THREE.Object3D | null = hit.object;
      while (current && !current.userData.nodeId) current = current.parent;
      const nodeId = current?.userData.nodeId as string | undefined;
      if (nodeId) {
        const node = this.document?.nodes.find((entry) => entry.id === nodeId);
        if (node && node.kind !== 'group') {
          this.callbacks.onSelect(nodeId);
          return;
        }
      }
    }
    this.callbacks.onSelect(null);
  }

  private modelCacheKey(project: ProjectDocument, asset: ModelAssetRecord) {
    return `${project.id}:${asset.id}:${asset.revision}`;
  }

  private setAssetState(nodeId: string, assetId: string, state: AssetLoadState, message?: string) {
    this.assetStatesByNode.set(nodeId, state);
    this.callbacks.onAssetState(nodeId, assetId, state, message);
  }

  private createModelPlaceholder(state: 'loading' | 'missing' | 'error') {
    const root = new THREE.Group();
    root.name = `Model ${state} placeholder`;
    const color = state === 'loading' ? 0x6d8196 : state === 'missing' ? 0xf2bd67 : 0xf47f6b;
    const material = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.86 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 1.2), material);
    mesh.position.y = 0.8;
    root.add(mesh);
    const base = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.72, 24),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.48 }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.01;
    root.add(base);
    return root;
  }

  private replaceModelPlaceholder(root: THREE.Group, state: 'loading' | 'missing' | 'error') {
    const previous = root.userData.modelPlaceholder as THREE.Object3D | undefined;
    if (previous) this.disposeObject(previous);
    const placeholder = this.createModelPlaceholder(state);
    root.userData.modelPlaceholder = placeholder;
    root.add(placeholder);
  }

  private removeModelPlaceholder(root: THREE.Group) {
    const placeholder = root.userData.modelPlaceholder as THREE.Object3D | undefined;
    if (!placeholder) return;
    delete root.userData.modelPlaceholder;
    this.disposeObject(placeholder);
  }

  private acquireModel(project: ProjectDocument, asset: ModelAssetRecord): CachedModel {
    const key = this.modelCacheKey(project, asset);
    let entry = this.modelCache.get(key);
    if (!entry) {
      const created = {} as CachedModel;
      created.refs = 0;
      created.promise = (async () => {
        const source = await this.callbacks.resolveAssetSource(project.id, asset.id, asset.revision);
        if (!source) throw new MissingModelSourceError();
        const parsed = await parseModelSource(source);
        created.value = parsed;
        return parsed;
      })();
      entry = created;
      this.modelCache.set(key, entry);
    }
    entry.refs += 1;
    return entry;
  }

  private removeModelHost(root: THREE.Group) {
    const host = root.userData.modelHost as THREE.Group | undefined;
    if (!host) return;
    delete root.userData.modelHost;
    host.removeFromParent();
    host.clear();
  }

  private releaseModelBinding(nodeId: string, root?: THREE.Group) {
    const binding = this.modelBindings.get(nodeId);
    if (!binding) return;
    this.modelBindings.delete(nodeId);
    if (root) this.removeModelHost(root);
    const entry = this.modelCache.get(binding.key);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs > 0) return;
    this.modelCache.delete(binding.key);
    if (entry.value) {
      disposeModelResources(entry.value.scene);
      return;
    }
    void entry.promise.then((value) => {
      if (entry.refs === 0) disposeModelResources(value.scene);
    }).catch(() => {
      // A failed or missing source owns no GPU resources.
    });
  }

  private applyModelLayout(root: THREE.Group, node: SceneNode, asset: ModelAssetRecord) {
    const host = root.userData.modelHost as THREE.Group | undefined;
    if (!host || !node.model) return;
    if (node.model.fitMode === 'original') {
      host.position.set(0, 0, 0);
      host.scale.setScalar(1);
      return;
    }
    const { min, size, center } = asset.diagnostics.bounds;
    const largest = Math.max(size[0], size[1], size[2], 0.0001);
    const scale = node.model.targetSize / largest;
    host.scale.setScalar(scale);
    host.position.set(-center[0] * scale, -min[1] * scale, -center[2] * scale);
  }

  private ensureModelObject(root: THREE.Group, node: SceneNode, project: ProjectDocument) {
    if (node.kind !== 'model' || !node.model) return;
    const asset = project.assets.find((entry) => entry.id === node.model?.assetId);
    if (!asset) {
      this.releaseModelBinding(node.id, root);
      this.removeModelHost(root);
      this.replaceModelPlaceholder(root, 'error');
      this.setAssetState(node.id, node.model.assetId, 'error', 'The project no longer contains this model asset.');
      return;
    }
    const key = this.modelCacheKey(project, asset);
    const current = this.modelBindings.get(node.id);
    if (current?.key === key) {
      this.applyModelLayout(root, node, asset);
      return;
    }

    this.releaseModelBinding(node.id, root);
    this.removeModelHost(root);
    this.replaceModelPlaceholder(root, 'loading');
    this.setAssetState(node.id, asset.id, 'loading');
    const token = ++this.modelLoadToken;
    this.modelBindings.set(node.id, { key, token });
    const entry = this.acquireModel(project, asset);

    void entry.promise.then(({ scene }) => {
      const binding = this.modelBindings.get(node.id);
      if (this.disposed || !binding || binding.key !== key || binding.token !== token || this.objects.get(node.id) !== root) return;
      const instance = cloneSkeleton(scene);
      instance.name = `${asset.name} Instance`;
      instance.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = Boolean(node.castShadow);
          child.receiveShadow = Boolean(node.receiveShadow);
        }
      });
      const host = new THREE.Group();
      host.name = `${asset.name} Model Host`;
      host.add(instance);
      root.userData.modelHost = host;
      root.add(host);
      this.removeModelPlaceholder(root);
      this.applyModelLayout(root, node, asset);
      this.setAssetState(node.id, asset.id, 'ready');
      if (this.selectedId === node.id) this.syncSelection();
    }).catch((error: unknown) => {
      const binding = this.modelBindings.get(node.id);
      if (this.disposed || !binding || binding.key !== key || binding.token !== token || this.objects.get(node.id) !== root) return;
      const missing = error instanceof MissingModelSourceError;
      const message = error instanceof Error ? error.message : 'The model could not be loaded.';
      this.replaceModelPlaceholder(root, missing ? 'missing' : 'error');
      this.setAssetState(node.id, asset.id, missing ? 'missing' : 'error', message);
    });
  }

  private disposeNodeObject(id: string, root: THREE.Group) {
    this.releaseModelBinding(id, root);
    this.removeModelHost(root);
    this.removeModelPlaceholder(root);
    this.assetStatesByNode.delete(id);
    this.disposeObject(root);
  }

  private createObject(node: SceneNode): THREE.Group {
    const root = new THREE.Group();
    root.name = node.name;
    root.userData.nodeId = node.id;
    root.userData.nodeKind = node.kind;

    if (node.kind === 'model') this.replaceModelPlaceholder(root, 'loading');

    if (node.kind === 'mesh' && node.primitive && node.material) {
      const material = new THREE.MeshStandardMaterial({
        color: node.material.color,
        emissive: node.material.emissive,
        emissiveIntensity: node.material.emissiveIntensity,
        metalness: node.material.metalness,
        roughness: node.material.roughness,
      });
      const mesh = new THREE.Mesh(geometryFor(node.primitive), material);
      mesh.name = `${node.name} Mesh`;
      mesh.castShadow = Boolean(node.castShadow);
      mesh.receiveShadow = Boolean(node.receiveShadow);
      root.add(mesh);
    }

    if (node.kind === 'light' && node.light) {
      let light: THREE.Light;
      if (node.light.type === 'directional') {
        const directional = new THREE.DirectionalLight(node.light.color, node.light.intensity);
        directional.castShadow = node.light.castShadow;
        directional.shadow.mapSize.set(1024, 1024);
        directional.shadow.camera.near = 0.5;
        directional.shadow.camera.far = 45;
        directional.shadow.camera.left = -12;
        directional.shadow.camera.right = 12;
        directional.shadow.camera.top = 12;
        directional.shadow.camera.bottom = -12;
        light = directional;
      } else if (node.light.type === 'spot') {
        const spot = new THREE.SpotLight(node.light.color, node.light.intensity, node.light.distance, Math.PI / 5, 0.35, 1.4);
        spot.castShadow = node.light.castShadow;
        light = spot;
      } else {
        light = new THREE.PointLight(node.light.color, node.light.intensity, node.light.distance, 2);
        light.castShadow = node.light.castShadow;
      }
      light.name = `${node.name} Source`;
      root.add(light);

      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.18, 0),
        new THREE.MeshBasicMaterial({ color: 0xf2bd67, wireframe: true, transparent: true, opacity: 0.7 }),
      );
      marker.userData[editorOnlyKey] = true;
      marker.name = `${node.name} Editor Icon`;
      marker.scale.setScalar(0.08);
      root.add(marker);
    }

    if (node.kind === 'camera' && node.camera) {
      const camera = new THREE.PerspectiveCamera(node.camera.fov, 1, node.camera.near, node.camera.far);
      camera.userData.projectCamera = true;
      camera.userData.primary = node.camera.primary;
      root.add(camera);

      const marker = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.48, 4),
        new THREE.MeshBasicMaterial({ color: 0x9b87f5, wireframe: true, transparent: true, opacity: 0.72 }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.z = -0.35;
      marker.scale.setScalar(0.25);
      marker.userData[editorOnlyKey] = true;
      root.add(marker);
    }

    return root;
  }

  private updateObject(root: THREE.Group, node: SceneNode) {
    root.name = node.name;
    root.visible = node.visible;
    root.position.fromArray(node.transform.position);
    root.rotation.set(...node.transform.rotation, 'XYZ');
    root.scale.fromArray(node.transform.scale);
    root.userData.basePosition = [...node.transform.position];
    root.userData.baseRotation = [...node.transform.rotation];
    root.userData.baseScale = [...node.transform.scale];
    root.userData.runtimeOffset = [0, 0, 0];
    root.userData.components = structuredClone(node.components);

    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (node.kind === 'mesh' && child.material instanceof THREE.MeshStandardMaterial) {
          updateStandardMaterial(child.material, node);
        }
        if (node.kind === 'mesh' || node.kind === 'model') {
          child.castShadow = Boolean(node.castShadow);
          child.receiveShadow = Boolean(node.receiveShadow);
        }
      }
      if (child instanceof THREE.Light && node.light) {
        child.color.set(node.light.color);
        child.intensity = node.light.intensity;
        if (child instanceof THREE.PointLight || child instanceof THREE.SpotLight) child.distance = node.light.distance;
        child.castShadow = node.light.castShadow;
      }
      if (child instanceof THREE.PerspectiveCamera && node.camera) {
        child.fov = node.camera.fov;
        child.near = node.camera.near;
        child.far = node.camera.far;
        child.userData.primary = node.camera.primary;
        child.updateProjectionMatrix();
      }
    });
  }

  private disposeObject(root: THREE.Object3D) {
    root.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        disposeMaterial(child.material);
      }
    });
    root.removeFromParent();
  }

  setDocument(project: ProjectDocument) {
    this.document = project;
    this.scene.background = new THREE.Color(project.settings.background);
    this.scene.fog = project.settings.fogEnabled
      ? new THREE.Fog(project.settings.fogColor, project.settings.fogNear, project.settings.fogFar)
      : null;
    this.renderer.toneMappingExposure = project.settings.exposure;
    this.renderer.shadowMap.enabled = project.settings.shadows;

    if (
      this.grid.userData.gridSize !== project.settings.gridSize ||
      this.grid.userData.gridDivisions !== project.settings.gridDivisions
    ) {
      this.editorRoot.remove(this.grid);
      this.grid.geometry.dispose();
      disposeMaterial(this.grid.material);
      this.grid = this.createGrid(project.settings.gridSize, project.settings.gridDivisions);
      this.grid.userData.gridSize = project.settings.gridSize;
      this.grid.userData.gridDivisions = project.settings.gridDivisions;
      this.editorRoot.add(this.grid);
    }

    const incoming = new Set(project.nodes.map((node) => node.id));
    for (const [id, object] of this.objects) {
      const nextNode = project.nodes.find((node) => node.id === id);
      if (!incoming.has(id) || nextNode?.kind !== object.userData.nodeKind) {
        if (this.selectedId === id) this.transformControls.detach();
        this.disposeNodeObject(id, object);
        this.objects.delete(id);
      }
    }

    for (const node of project.nodes) {
      if (!this.objects.has(node.id)) this.objects.set(node.id, this.createObject(node));
    }

    for (const node of project.nodes) {
      const object = this.objects.get(node.id);
      if (!object) continue;
      const parent = node.parentId ? this.objects.get(node.parentId) : this.contentRoot;
      if (parent && object.parent !== parent) parent.add(object);
      this.updateObject(object, node);
      if (node.kind === 'model') this.ensureModelObject(object, node, project);
    }

    this.syncSelection();
    this.updateEditorVisibility();
    this.resize();
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    this.syncSelection();
  }

  private syncSelection() {
    const object = this.selectedId ? this.objects.get(this.selectedId) : undefined;
    const node = this.document?.nodes.find((entry) => entry.id === this.selectedId);
    if (!object || !node || this.mode !== 'edit' || this.viewMode !== 'scene') {
      this.transformControls.detach();
      this.selectionBox.visible = false;
      return;
    }
    this.selectionBox.setFromObject(object);
    this.selectionBox.visible = node.kind !== 'group';
    if (this.tool === 'select' || node.locked) this.transformControls.detach();
    else this.transformControls.attach(object);
  }

  setTool(tool: EditorTool) {
    this.tool = tool;
    if (tool !== 'select') this.transformControls.setMode(tool);
    this.syncSelection();
  }

  setSpace(space: 'local' | 'world') {
    this.transformControls.setSpace(space);
  }

  setSnap(enabled: boolean) {
    this.transformControls.translationSnap = enabled ? 0.5 : null;
    this.transformControls.rotationSnap = enabled ? THREE.MathUtils.degToRad(15) : null;
    this.transformControls.scaleSnap = enabled ? 0.1 : null;
  }

  setGridVisible(visible: boolean) {
    this.grid.visible = visible && this.mode === 'edit' && this.viewMode === 'scene';
  }

  setMode(mode: EditorMode) {
    const previousMode = this.mode;
    this.mode = mode;
    if (mode === 'edit') {
      this.runtimeTime = 0;
      this.runtimeTick = 0;
      if (this.document) this.setDocument(this.document);
    } else if (mode === 'play' && previousMode === 'edit') {
      this.runtimeTime = 0;
      this.runtimeTick = 0;
      if (this.document) this.setDocument(this.document);
    }
    if (mode !== 'play') this.keys.clear();
    this.stepRequested = false;
    this.updateEditorVisibility();
    this.syncSelection();
  }

  setViewMode(viewMode: ViewMode) {
    this.viewMode = viewMode;
    this.updateEditorVisibility();
    this.syncSelection();
  }

  private updateEditorVisibility() {
    const helpersVisible = this.mode === 'edit' && this.viewMode === 'scene';
    this.editorRoot.visible = helpersVisible;
    this.orbit.enabled = helpersVisible && !this.transformControls.dragging;
    for (const root of this.objects.values()) {
      root.traverse((child) => {
        if (child.userData[editorOnlyKey]) child.visible = helpersVisible;
      });
    }
  }

  step() {
    if (this.mode === 'paused') this.stepRequested = true;
  }

  frameSelection() {
    if (!this.selectedId) return;
    const object = this.objects.get(this.selectedId);
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1.5);
    const direction = this.editorCamera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center);
    this.editorCamera.position.copy(center).addScaledVector(direction, size * 2.2);
    this.orbit.update();
  }

  setCameraView(view: 'perspective' | 'top' | 'front' | 'right') {
    const target = this.selectedId
      ? new THREE.Box3().setFromObject(this.objects.get(this.selectedId) ?? this.contentRoot).getCenter(new THREE.Vector3())
      : new THREE.Vector3(0, 1, 0);
    const distance = 14;
    if (view === 'top') this.editorCamera.position.copy(target).add(new THREE.Vector3(0, distance, 0.001));
    else if (view === 'front') this.editorCamera.position.copy(target).add(new THREE.Vector3(0, 2, distance));
    else if (view === 'right') this.editorCamera.position.copy(target).add(new THREE.Vector3(distance, 2, 0));
    else this.editorCamera.position.copy(target).add(new THREE.Vector3(9, 6.5, 11));
    this.orbit.target.copy(target);
    this.editorCamera.lookAt(target);
    this.orbit.update();
  }

  private getProjectCamera(): THREE.PerspectiveCamera | null {
    let fallback: THREE.PerspectiveCamera | null = null;
    for (const root of this.objects.values()) {
      for (const child of root.children) {
        if (child instanceof THREE.PerspectiveCamera) {
          fallback ??= child;
          if (child.userData.primary) return child;
        }
      }
    }
    return fallback;
  }

  private updateRuntime(delta: number) {
    if (this.mode === 'edit') return;
    let simulationDelta = delta;
    if (this.mode === 'paused') {
      if (!this.stepRequested) return;
      simulationDelta = 1 / 60;
    }
    this.stepRequested = false;
    this.runtimeTime += simulationDelta;
    this.runtimeTick += 1;
    for (const root of this.objects.values()) {
      const components = root.userData.components as GameplayComponent[] | undefined;
      const basePosition = root.userData.basePosition as TransformData['position'];
      const baseRotation = root.userData.baseRotation as TransformData['rotation'];
      const baseScale = root.userData.baseScale as TransformData['scale'];
      const runtimeOffset = root.userData.runtimeOffset as TransformData['position'];
      if (!components || !basePosition || !baseRotation || !baseScale || !runtimeOffset) continue;

      for (const component of components) {
        if (!component.enabled || component.type !== 'keyboardMove') continue;
        let horizontal = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) -
          (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
        let vertical = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) -
          (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
        const length = Math.hypot(horizontal, vertical) || 1;
        horizontal /= length;
        vertical /= length;
        runtimeOffset[0] += horizontal * component.speed * simulationDelta;
        if (component.plane === 'xy') runtimeOffset[1] += vertical * component.speed * simulationDelta;
        else runtimeOffset[2] -= vertical * component.speed * simulationDelta;
      }

      root.position.set(
        basePosition[0] + runtimeOffset[0],
        basePosition[1] + runtimeOffset[1],
        basePosition[2] + runtimeOffset[2],
      );
      root.rotation.set(...baseRotation, 'XYZ');
      root.scale.fromArray(baseScale);

      for (const component of components) {
        if (!component.enabled) continue;
        if (component.type === 'rotate') {
          root.rotation[component.axis] += this.runtimeTime * component.speed;
        } else if (component.type === 'float') {
          root.position[component.axis] +=
            Math.sin(this.runtimeTime * component.speed * 2 + component.phase) * component.distance;
        }
      }
    }
  }

  private readonly render = (time: number) => {
    if (this.disposed) return;
    const delta = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.updateRuntime(delta);
    this.orbit.update();
    if (this.selectionBox.visible && this.selectedId) {
      const selected = this.objects.get(this.selectedId);
      if (selected) this.selectionBox.setFromObject(selected);
    }

    const projectCamera = this.getProjectCamera();
    const activeCamera = (this.viewMode === 'game' || this.mode !== 'edit') && projectCamera ? projectCamera : this.editorCamera;
    this.renderer.render(this.scene, activeCamera);

    this.frames += 1;
    this.totalFrames += 1;
    this.statsElapsed += delta;
    this.frameElapsed += delta * 1000;
    if (this.statsElapsed >= 0.5) {
      const fps = this.frames / this.statsElapsed;
      this.callbacks.onStats({
        fps,
        frameMs: this.frameElapsed / this.frames,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
      });
      window.__THREE_GAME_DIAGNOSTICS__ = {
        frame: this.totalFrames,
        elapsed: this.runtimeTime,
        renderer: {
          calls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles,
          geometries: this.renderer.info.memory.geometries,
          textures: this.renderer.info.memory.textures,
        },
        canvas: {
          clientWidth: this.canvas.clientWidth,
          clientHeight: this.canvas.clientHeight,
          width: this.canvas.width,
          height: this.canvas.height,
          dpr: Math.min(window.devicePixelRatio, 2),
        },
        editor: {
          mode: this.mode,
          viewMode: this.viewMode,
          selectedId: this.selectedId,
          objectCount: this.objects.size,
          schemaVersion: this.document?.schemaVersion ?? 3,
          assetCount: this.document?.assets.length ?? 0,
        },
        assets: {
          statesByNode: Object.fromEntries(this.assetStatesByNode),
          readyInstances: [...this.assetStatesByNode.values()].filter((state) => state === 'ready').length,
          missingInstances: [...this.assetStatesByNode.values()].filter((state) => state === 'missing').length,
          failedInstances: [...this.assetStatesByNode.values()].filter((state) => state === 'error').length,
          cachedModels: this.modelCache.size,
        },
        runtime: {
          tick: this.runtimeTick,
          fixedDelta: 1 / 60,
          transforms: Object.fromEntries([...this.objects].map(([id, object]) => [id, {
            position: object.position.toArray(),
            rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
            scale: object.scale.toArray(),
          }])),
        },
      };
      this.frames = 0;
      this.statsElapsed = 0;
      this.frameElapsed = 0;
    }
  };

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    this.keys.clear();
    this.orbit.dispose();
    this.transformControls.dispose();
    for (const [id, object] of this.objects) this.disposeNodeObject(id, object);
    this.objects.clear();
    this.grid.geometry.dispose();
    disposeMaterial(this.grid.material);
    this.renderer.dispose();
    delete window.__THREE_GAME_DIAGNOSTICS__;
  }
}
