import {
  Box,
  Boxes,
  Camera,
  Check,
  ChevronDown,
  Circle,
  Command,
  Copy,
  Crosshair,
  Cylinder,
  FileCode2,
  FileJson,
  FolderOpen,
  Globe2,
  Grid3X3,
  Layers3,
  Magnet,
  Maximize2,
  Menu,
  MousePointer2,
  Move3d,
  Package,
  PanelBottomOpen,
  PanelLeftOpen,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  Redo2,
  Rocket,
  Rotate3d,
  Save,
  Scaling,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  StepForward,
  Terminal,
  Trash2,
  Triangle,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Command as CommandMenu,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { AgentPanel, type AssistantMessage, type AssistantPlan } from './editor/AgentPanel';
import { BottomDock, HierarchyPanel, IconButton, InspectorPanel, primitiveLabel } from './editor/components';
import {
  executeAgentToolBatch,
  guidedStudioAgentProvider,
  type StudioAgentBatchResult,
  type StudioAgentToolCall,
} from './editor/agentRuntime';
import {
  AGENT_CAPABILITY_MANIFEST,
  AGENT_GAME_CAPABILITY_MANIFEST,
  assessAgentGameToolCall,
  assessAgentToolCall,
  executeAgentGameTool,
  getAgentToolDefinition,
  validateAgentToolArguments,
  type AgentGameToolName,
  type AgentGameToolResult,
  type AgentToolName,
} from './editor/agentTools';
import {
  createPortableGameProjectBundle,
  deleteModelAssetSource,
  getModelAssetSource,
  putModelAssetSource,
  readPortableGameProjectBundle,
  readPortableProjectBundle,
  sourceToDataUrl,
} from './editor/assetStore';
import { analyzeModelFile, formatTriangles } from './editor/modelAssets';
import {
  createLegacySceneView,
  loadGameProjectDocument,
  syncLegacySceneToV5,
} from './editor/gameProject';
import {
  addModelAsset,
  addModelInstance,
  addPrimitive,
  applyMaterial,
  buildRuntimeHtml,
  BUILT_IN_ASSETS,
  cloneProject,
  createNodeId,
  createStarterProject,
  downloadTextFile,
  duplicateNode,
  getNode,
  loadProjectDocument,
  removeNode,
  updateNode,
} from './editor/project';
import type {
  AssetStatus,
  ConsoleEntry,
  EditorMode,
  EditorTool,
  InputAction,
  ModelAssetRecord,
  PrimitiveType,
  ProjectDocument,
  ProjectDocumentV5,
  ProjectSettings,
  RendererStats,
  SceneNode,
  StudioAsset,
  ViewMode,
} from './editor/types';
import { ViewportEngine } from './editor/ViewportEngine';
import { createCollectEscapeProject } from './templates/collectEscape';
import { GameAuthoringWorkspace } from './components/studio/GameAuthoringWorkspace';
import { detectProjectRuntimeBindings } from './runtime/ProjectGameRuntime';
import {
  assertProjectBuildRevision,
  captureProjectBuildSnapshot,
} from './build/projectBuildTransaction';

const STORAGE_KEY = 'threejs-studio:project:v5';
const LEGACY_STORAGE_KEYS = [
  'threejs-studio:project:v4',
  'threejs-game-studio:project:v4',
  'threejs-game-studio:project:v3',
  'threejs-game-studio:project:v2',
  'threejs-game-studio:project:v1',
];
const EXPERIENCE_KEY = 'threejs-studio:experience';
const LEGACY_EXPERIENCE_KEY = 'threejs-game-studio:experience';
const QUICK_START_KEY = 'threejs-studio:quick-start';
const LEGACY_QUICK_START_KEY = 'threejs-game-studio:quick-start';
const MAX_HISTORY = 60;

type ExperienceLevel = 'essentials' | 'advanced';
type QuickStartStep = 'add' | 'style' | 'play' | 'complete';
type ApplicationMenuName = 'file' | 'edit' | 'object' | 'window' | 'help';

interface QuickStartProgress {
  added: boolean;
  styled: boolean;
  played: boolean;
  dismissed: boolean;
}

interface HistoryEntry {
  document: ProjectDocument;
  gameDocument: ProjectDocumentV5;
  label: string;
}

interface MenuItemProps {
  icon?: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

interface CommandAction {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  icon: ReactNode;
  disabled?: boolean;
  run: () => void;
}

interface PendingAssistantPlan extends AssistantPlan {
  baseRevision: number;
  source: 'guided' | 'bridge';
  toolCalls: Array<StudioAgentToolCall | { name: AgentGameToolName; arguments: Record<string, unknown> }>;
  batch?: StudioAgentBatchResult;
  gameResult?: AgentGameToolResult;
}

interface EditorToolExecutionResult {
  ok: boolean;
  changed: boolean;
  message: string;
  errors: string[];
  data?: unknown;
}

interface AssistantCommitMarker {
  revision: number;
  label: string;
  actor: EditorActor;
}

type EditorActor = NonNullable<ThreeJSStudioAgentEvent['actor']>;

interface LoadedEditorProject {
  project: ProjectDocument;
  gameProject: ProjectDocumentV5;
}

function loadInitialProject(): LoadedEditorProject {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const result = loadGameProjectDocument(JSON.parse(saved) as unknown);
        if (result.ok) {
          if (key !== STORAGE_KEY) localStorage.setItem(STORAGE_KEY, JSON.stringify(result.project));
          return { gameProject: result.project, project: createLegacySceneView(result.project) };
        }
      }
    } catch {
      // Try the next recovery source before falling back to the starter scene.
    }
  }
  const project = createStarterProject();
  const migrated = loadGameProjectDocument(project);
  if (!migrated.ok) throw new Error(migrated.errors.join(' '));
  return { gameProject: migrated.project, project };
}

function loadExperience(): ExperienceLevel {
  try {
    const current = localStorage.getItem(EXPERIENCE_KEY);
    const stored = current ?? localStorage.getItem(LEGACY_EXPERIENCE_KEY);
    if (current === null && stored !== null) localStorage.setItem(EXPERIENCE_KEY, stored);
    return stored === 'advanced' ? 'advanced' : 'essentials';
  } catch {
    return 'essentials';
  }
}

function loadQuickStart(): QuickStartProgress {
  try {
    const current = localStorage.getItem(QUICK_START_KEY);
    const stored = current ?? localStorage.getItem(LEGACY_QUICK_START_KEY);
    if (current === null && stored !== null) localStorage.setItem(QUICK_START_KEY, stored);
    const value = JSON.parse(stored ?? '{}') as Partial<QuickStartProgress>;
    return {
      added: value.added === true,
      styled: value.styled === true,
      played: value.played === true,
      dismissed: value.dismissed === true,
    };
  } catch {
    return { added: false, styled: false, played: false, dismissed: false };
  }
}

function getQuickStartStep(progress: QuickStartProgress): QuickStartStep {
  if (!progress.added) return 'add';
  if (!progress.styled) return 'style';
  if (!progress.played) return 'play';
  return 'complete';
}

function nowLabel() {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}

function safeFilename(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'threejs-game';
}

function downloadBinaryFile(bytes: Uint8Array, filename: string, mimeType = 'application/zip') {
  const blob = new Blob([bytes.slice().buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function modelDisplayName(filename: string) {
  const withoutExtension = filename.replace(/\.(?:glb|gltf)$/i, '');
  const cleaned = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.replace(/\b\w/g, (character) => character.toUpperCase()) : 'Imported Model';
}

function inputCodeLabel(code: string) {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  return ({
    ArrowUp: '↑',
    ArrowLeft: '←',
    ArrowDown: '↓',
    ArrowRight: '→',
    Space: 'Space',
  } as Record<string, string>)[code] ?? code;
}

function movementControlsHint(project: ProjectDocument) {
  const components = project.nodes.flatMap((node) => node.components);
  const movementComponent = components.find((component) => component.id === 'player-move' && component.type === 'keyboardMove')
    ?? components.find((component) => component.type === 'keyboardMove');
  const actionId = movementComponent?.type === 'keyboardMove' ? movementComponent.actionId : undefined;
  const action = project.inputActions.find((candidate) => candidate.id === actionId);
  if (!action) return 'Use your configured movement controls';
  const directions: Array<[InputAction['bindings'][number]['axis'], InputAction['bindings'][number]['scale']]> = [
    ['y', 1],
    ['x', -1],
    ['y', -1],
    ['x', 1],
  ];
  const primary = directions.flatMap(([axis, scale]) => {
    const matches = action.bindings.filter((binding) => binding.axis === axis && binding.scale === scale);
    const binding = matches.find((candidate) => !candidate.code.startsWith('Arrow')) ?? matches[0];
    return binding ? [inputCodeLabel(binding.code)] : [];
  });
  if (!primary.length) return `Use the ${action.name} controls`;
  const hasArrowSet = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']
    .every((code) => action.bindings.some((binding) => binding.code === code));
  return `Use ${primary.join(' / ')}${hasArrowSet && !primary.some((label) => ['↑', '←', '↓', '→'].includes(label)) ? ' or arrow keys' : ''}`;
}

function assistantId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeAgentBatch(batch: StudioAgentBatchResult) {
  const result = batch.results.at(-1);
  const data = result?.data as Record<string, unknown> | undefined;
  const totals = data?.totals as { nodes?: number; assets?: number; components?: number } | undefined;
  if (totals) {
    return `${result?.message ?? 'Project inspected'} It contains ${totals.nodes ?? 0} scene objects, ${totals.assets ?? 0} imported model assets, and ${totals.components ?? 0} gameplay components.`;
  }
  const nodes = data?.nodes as Array<{ name?: string; kind?: string }> | undefined;
  if (nodes) {
    const preview = nodes.slice(0, 10).map((node) => `${node.name ?? 'Unnamed'} (${node.kind ?? 'node'})`).join(', ');
    return `${result?.message ?? `Found ${nodes.length} nodes`}${preview ? ` ${preview}${nodes.length > 10 ? ', …' : ''}` : ''}`;
  }
  return batch.messages.join('\n') || 'The tool call completed.';
}

function MenuItem({ icon, label, shortcut, disabled, danger, onClick }: MenuItemProps) {
  return (
    <MenubarItem
      className={`menu-item !grid !grid-cols-[22px_1fr_auto] ${danger ? 'is-danger' : ''}`}
      variant={danger ? 'destructive' : 'default'}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-item-icon">{icon}</span>
      <span>{label}</span>
      {shortcut ? <MenubarShortcut><kbd>{shortcut}</kbd></MenubarShortcut> : null}
    </MenubarItem>
  );
}

function PrimitiveIcon({ primitive }: { primitive: PrimitiveType }) {
  if (primitive === 'sphere' || primitive === 'torus') return <Circle size={15} />;
  if (primitive === 'cylinder' || primitive === 'capsule') return <Cylinder size={15} />;
  if (primitive === 'cone') return <Triangle size={15} />;
  return <Box size={15} />;
}

const primitives: PrimitiveType[] = ['box', 'sphere', 'capsule', 'cylinder', 'cone', 'plane', 'torus'];

export default function App() {
  const [initialProject] = useState<LoadedEditorProject>(loadInitialProject);
  const [project, setProject] = useState<ProjectDocument>(initialProject.project);
  const projectRef = useRef(project);
  const gameProjectRef = useRef<ProjectDocumentV5>(initialProject.gameProject);
  const [experience, setExperience] = useState<ExperienceLevel>(loadExperience);
  const [quickStart, setQuickStart] = useState<QuickStartProgress>(loadQuickStart);
  const [selectedId, setSelectedId] = useState<string | null>('player-core');
  const [tool, setTool] = useState<EditorTool>('translate');
  const [mode, setMode] = useState<EditorMode>('edit');
  const modeRef = useRef<EditorMode>('edit');
  const [runtimePreparing, setRuntimePreparing] = useState(false);
  const playRequestRef = useRef(0);
  const playStartInFlightRef = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('scene');
  const [space, setSpace] = useState<'local' | 'world'>('world');
  const [snap, setSnap] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [hierarchyOpen, setHierarchyOpen] = useState(() => window.innerWidth > 960);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 960);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [gameAuthoringOpen, setGameAuthoringOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(() => experience === 'advanced' && window.innerWidth > 720);
  const [bottomTab, setBottomTab] = useState<'assets' | 'console'>('assets');
  const [previewMode, setPreviewMode] = useState(false);
  const [openMenu, setOpenMenu] = useState<ApplicationMenuName | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const commandPaletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const [commandQuery, setCommandQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState('Loaded');
  const [toast, setToast] = useState<string | null>('Starter scene ready — add a shape or adjust Player Core.');
  const [stats, setStats] = useState<RendererStats>({ fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 });
  const [assetStatuses, setAssetStatuses] = useState<Record<string, AssetStatus>>({});
  const [modelImportNotice, setModelImportNotice] = useState<{ state: 'loading' | 'error'; message: string } | null>(null);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [projectRevision, setProjectRevision] = useState(1);
  const projectRevisionRef = useRef(1);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [pendingAssistantPlan, setPendingAssistantPlan] = useState<PendingAssistantPlan | null>(null);
  const pendingAssistantPlanRef = useRef<PendingAssistantPlan | null>(null);
  const assistantApplyInFlightRef = useRef<string | null>(null);
  const [lastAssistantCommit, setLastAssistantCommit] = useState<AssistantCommitMarker | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([
    { id: 'boot-1', level: 'success', message: 'Editor runtime initialized', time: nowLabel() },
    { id: 'boot-2', level: 'info', message: 'MainWorld loaded · 13 objects', time: nowLabel() },
    { id: 'boot-3', level: 'info', message: 'WebGL renderer ready · ACES tone mapping · soft shadows', time: nowLabel() },
  ]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ViewportEngine | null>(null);
  const dragStartRef = useRef<ProjectDocument | null>(null);
  const dragGameStartRef = useRef<ProjectDocumentV5 | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const relinkAssetIdRef = useRef<string | null>(null);
  const assistantSubscribersRef = useRef(new Set<(event: ThreeJSStudioAgentEvent) => void>());
  const assistantSnapshotRef = useRef<() => unknown>(() => ({ revision: 0 }));
  const assistantRequestRef = useRef<(request: ThreeJSStudioAgentRequest) => Promise<unknown>>(async () => ({ status: 'unavailable' }));

  const selectedNode = getNode(project, selectedId);
  const editingDisabled = mode !== 'edit' || runtimePreparing;
  const quickStartStep = getQuickStartStep(quickStart);
  const studioAssets = useMemo<StudioAsset[]>(() => [
    ...BUILT_IN_ASSETS,
    ...project.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: 'model' as const,
      modelAsset: asset,
      meta: `${asset.diagnostics.meshes} mesh${asset.diagnostics.meshes === 1 ? '' : 'es'} · ${formatTriangles(asset.diagnostics.triangles)} tris`,
    })),
  ], [project.assets]);
  const modelIssue = project.assets.find((asset) => {
    const state = assetStatuses[asset.id]?.state;
    return state === 'missing' || state === 'error';
  });

  const addLog = useCallback((message: string, level: ConsoleEntry['level'] = 'info') => {
    setConsoleEntries((entries) => [
      ...entries,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, level, message, time: nowLabel() },
    ].slice(-120));
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  const openCommandPalette = useCallback(() => {
    commandPaletteReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setCommandPaletteOpen(true);
  }, []);

  const markQuickStart = useCallback((key: 'added' | 'styled' | 'played') => {
    setQuickStart((current) => {
      if (current[key]) return current;
      if (key === 'styled' && !current.added) return current;
      if (key === 'played' && (!current.added || !current.styled)) return current;
      return { ...current, [key]: true };
    });
  }, []);

  const changeExperience = useCallback((next: ExperienceLevel) => {
    setExperience(next);
    setOpenMenu(null);
    if (next === 'essentials') {
      setBottomOpen(false);
      if (modeRef.current === 'paused') {
        modeRef.current = 'play';
        setMode('play');
      }
    }
    showToast(next === 'essentials' ? 'Essentials keeps the core tools in focus' : 'Advanced tools are now visible');
  }, [showToast]);

  const bumpProjectRevision = useCallback(() => {
    const next = projectRevisionRef.current + 1;
    projectRevisionRef.current = next;
    setProjectRevision(next);
    return next;
  }, []);

  const publishAssistantEvent = useCallback((event: ThreeJSStudioAgentEvent) => {
    for (const subscriber of assistantSubscribersRef.current) {
      try {
        subscriber(structuredClone(event));
      } catch {
        // Integration listeners are isolated from editor commits and history.
      }
    }
  }, []);

  const commitProject = useCallback((next: ProjectDocument, label: string, actor: EditorActor = 'human') => {
    if (modeRef.current !== 'edit') {
      showToast('Stop Play mode before editing the scene');
      return false;
    }
    const previous = cloneProject(projectRef.current);
    const previousGame = structuredClone(gameProjectRef.current);
    try {
      if (next.id === gameProjectRef.current.id) {
        gameProjectRef.current = syncLegacySceneToV5(gameProjectRef.current, next);
      } else {
        const replacement = loadGameProjectDocument(next);
        if (!replacement.ok) throw new Error(replacement.errors.join(' '));
        gameProjectRef.current = replacement.project;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The project command could not be applied.';
      addLog(message, 'warning');
      showToast(message);
      return false;
    }
    setUndoStack((entries) => [...entries, { document: previous, gameDocument: previousGame, label }].slice(-MAX_HISTORY));
    setRedoStack([]);
    projectRef.current = next;
    setProject(next);
    setDirty(true);
    const revision = bumpProjectRevision();
    addLog(label);
    publishAssistantEvent({ type: 'project.changed', revision, label, actor });
    return true;
  }, [addLog, bumpProjectRevision, publishAssistantEvent, showToast]);

  const commitGameProject = useCallback((next: ProjectDocumentV5, label: string, actor: EditorActor = 'human') => {
    if (modeRef.current !== 'edit') {
      showToast('Stop Play mode before changing projects');
      return false;
    }
    const validated = loadGameProjectDocument(next);
    if (!validated.ok) {
      const message = validated.errors[0] ?? 'The game project is invalid.';
      addLog(message, 'warning');
      showToast(message);
      return false;
    }
    const previous = cloneProject(projectRef.current);
    const previousGame = structuredClone(gameProjectRef.current);
    const legacy = createLegacySceneView(validated.project);
    setUndoStack((entries) => [...entries, { document: previous, gameDocument: previousGame, label }].slice(-MAX_HISTORY));
    setRedoStack([]);
    gameProjectRef.current = validated.project;
    projectRef.current = legacy;
    setProject(legacy);
    setDirty(true);
    const revision = bumpProjectRevision();
    addLog(label);
    publishAssistantEvent({ type: 'project.changed', revision, label, actor });
    return true;
  }, [addLog, bumpProjectRevision, publishAssistantEvent, showToast]);

  const updateSceneNode = useCallback((node: SceneNode, label: string) => {
    if (!commitProject(updateNode(projectRef.current, node.id, () => node), label)) return;
    const styledImportedModel = node.kind === 'model' && (
      label === 'Change position' ||
      label === 'Change rotation' ||
      label === 'Change scale' ||
      label === 'Change model sizing' ||
      label === 'Change model target size'
    );
    if (label === 'Change material color' || label.startsWith('Apply ') || styledImportedModel) markQuickStart('styled');
  }, [commitProject, markQuickStart]);

  const updateProjectSettings = useCallback((settings: ProjectSettings, label: string) => {
    const next = cloneProject(projectRef.current);
    next.settings = settings;
    next.updatedAt = new Date().toISOString();
    commitProject(next, label);
  }, [commitProject]);

  const updateInputActions = useCallback((inputActions: InputAction[], label: string) => {
    const next = cloneProject(projectRef.current);
    next.inputActions = structuredClone(inputActions);
    next.updatedAt = new Date().toISOString();
    const validated = loadProjectDocument(next);
    if (!validated.ok) {
      const message = validated.errors[0] ?? 'Input Actions could not be updated.';
      addLog(message, 'warning');
      showToast(message);
      return;
    }
    commitProject(validated.project, label);
  }, [addLog, commitProject, showToast]);

  const undo = useCallback((actor: EditorActor = 'human') => {
    if (modeRef.current !== 'edit') return;
    const entry = undoStack.at(-1);
    if (!entry) return;
    const current = cloneProject(projectRef.current);
    const currentGame = structuredClone(gameProjectRef.current);
    const restored = cloneProject(entry.document);
    setUndoStack((entries) => entries.slice(0, -1));
    setRedoStack((entries) => [...entries, { document: current, gameDocument: currentGame, label: entry.label }].slice(-MAX_HISTORY));
    gameProjectRef.current = structuredClone(entry.gameDocument);
    projectRef.current = restored;
    setProject(restored);
    setDirty(true);
    const revision = bumpProjectRevision();
    if (selectedId && !getNode(restored, selectedId)) setSelectedId(null);
    addLog(`Undo · ${entry.label}`);
    publishAssistantEvent({ type: 'project.changed', revision, label: `Undo · ${entry.label}`, actor });
  }, [addLog, bumpProjectRevision, publishAssistantEvent, selectedId, undoStack]);

  const redo = useCallback((actor: EditorActor = 'human') => {
    if (modeRef.current !== 'edit') return;
    const entry = redoStack.at(-1);
    if (!entry) return;
    const current = cloneProject(projectRef.current);
    const currentGame = structuredClone(gameProjectRef.current);
    const restored = cloneProject(entry.document);
    setRedoStack((entries) => entries.slice(0, -1));
    setUndoStack((entries) => [...entries, { document: current, gameDocument: currentGame, label: entry.label }].slice(-MAX_HISTORY));
    gameProjectRef.current = structuredClone(entry.gameDocument);
    projectRef.current = restored;
    setProject(restored);
    setDirty(true);
    const revision = bumpProjectRevision();
    addLog(`Redo · ${entry.label}`);
    publishAssistantEvent({ type: 'project.changed', revision, label: `Redo · ${entry.label}`, actor });
  }, [addLog, bumpProjectRevision, publishAssistantEvent, redoStack]);

  const createPrimitive = useCallback((primitive: PrimitiveType, color?: string) => {
    if (modeRef.current !== 'edit') return;
    const currentSelection = getNode(projectRef.current, selectedId);
    const parentId = currentSelection?.kind === 'group' ? currentSelection.id : 'scene-root';
    const result = addPrimitive(projectRef.current, primitive, parentId, color);
    if (!commitProject(result.project, `Create ${primitiveLabel(primitive)}`)) return;
    setSelectedId(result.nodeId);
    markQuickStart('added');
    setAddMenuOpen(false);
    showToast(`${primitiveLabel(primitive)} added to ${getNode(result.project, parentId)?.name ?? 'scene'}`);
  }, [commitProject, markQuickStart, selectedId, showToast]);

  const createEmptyGroup = useCallback(() => {
    if (modeRef.current !== 'edit') return;
    const next = cloneProject(projectRef.current);
    const id = createNodeId('group');
    const selected = getNode(next, selectedId);
    next.nodes.push({
      id,
      name: 'Empty Group',
      kind: 'group',
      parentId: selected?.kind === 'group' ? selected.id : 'scene-root',
      visible: true,
      locked: false,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      components: [],
    });
    next.updatedAt = new Date().toISOString();
    if (!commitProject(next, 'Create Empty Group')) return;
    setSelectedId(id);
  }, [commitProject, selectedId]);

  const duplicateSelected = useCallback(() => {
    if (!selectedId || editingDisabled) return;
    const result = duplicateNode(projectRef.current, selectedId);
    if (!result) return;
    commitProject(result.project, 'Duplicate object');
    setSelectedId(result.nodeId);
    showToast('Object duplicated · Cmd/Ctrl+Z to undo');
  }, [commitProject, editingDisabled, selectedId, showToast]);

  const deleteSelected = useCallback(() => {
    if (!selectedId || selectedId === 'scene-root' || editingDisabled) return;
    const node = getNode(projectRef.current, selectedId);
    if (!node) return;
    commitProject(removeNode(projectRef.current, selectedId), `Remove ${node.name}`);
    setSelectedId(node.parentId ?? 'scene-root');
    showToast(`${node.name} removed · Cmd/Ctrl+Z to restore`);
  }, [commitProject, editingDisabled, selectedId, showToast]);

  const saveProject = useCallback((announce = true) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(gameProjectRef.current));
      setDirty(false);
      setLastSaved('Saved just now');
      if (announce) {
        addLog('Project saved to this browser', 'success');
        showToast('Project saved locally');
      }
      return true;
    } catch {
      addLog('Browser storage is unavailable; export a project file instead', 'warning');
      showToast('Could not save locally');
      return false;
    }
  }, [addLog, showToast]);

  const exportProject = useCallback(async (requestedFilename?: string) => {
    const current = gameProjectRef.current;
    try {
      const { bundle, missingAssetIds } = await createPortableGameProjectBundle(current);
      downloadTextFile(JSON.stringify(bundle, null, 2), requestedFilename?.trim() || `${safeFilename(current.name)}.tjsstudio.json`);
      if (missingAssetIds.length) {
        addLog(`Project exported with ${missingAssetIds.length} missing model file${missingAssetIds.length === 1 ? '' : 's'}`, 'warning');
        showToast('Game project exported · relink missing models before sharing');
        return { ok: true, message: `Project exported with ${missingAssetIds.length} missing model source${missingAssetIds.length === 1 ? '' : 's'}.` };
      } else {
        addLog('Schema-v5 game project exported with local models', 'success');
        showToast('Schema-v5 game project package exported');
        return { ok: true, message: 'Schema-v5 game project package exported with available model sources.' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not package the project';
      addLog(`Project export failed · ${message}`, 'warning');
      showToast(`Project export failed · ${message}`);
      return { ok: false, message };
    }
  }, [addLog, showToast]);

  const buildLegacyWebGame = useCallback(async (requestedFilename?: string) => {
    const current = projectRef.current;
    try {
      const referencedAssetIds = new Set(
        current.nodes.flatMap((node) => node.kind === 'model' && node.model ? [node.model.assetId] : []),
      );
      const embeddedAssets: Record<string, string> = {};
      const missing: string[] = [];
      for (const assetId of referencedAssetIds) {
        const asset = current.assets.find((entry) => entry.id === assetId);
        if (!asset) {
          missing.push(assetId);
          continue;
        }
        const source = await getModelAssetSource(current.id, asset.id, asset.revision);
        if (!source) missing.push(asset.name);
        else embeddedAssets[asset.id] = sourceToDataUrl(source);
      }
      if (missing.length) {
        throw new Error(`Relink ${missing.join(', ')} before building.`);
      }
      downloadTextFile(buildRuntimeHtml(current, embeddedAssets), requestedFilename?.trim() || `${safeFilename(current.name)}-web.html`, 'text/html');
      addLog('Single-file web build generated with embedded models', 'success');
      showToast('Web game built · models included');
      return { ok: true, message: 'Single-file web build generated with embedded model sources.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not build the web game';
      addLog(`Build failed · ${message}`, 'warning');
      showToast(`Build failed · ${message}`);
      return { ok: false, message };
    }
  }, [addLog, showToast]);

  const buildWebGame = useCallback(async (requestedFilename?: string) => {
    const snapshot = captureProjectBuildSnapshot(gameProjectRef.current, projectRevisionRef.current);
    const current = snapshot.project;
    const profileRecord = current.buildProfiles.find((entry) => entry.id === current.defaultBuildProfileId);
    const profile = profileRecord?.mode ?? 'production';
    const buildAbort = new AbortController();
    const assertCurrentRevision = () => {
      try {
        assertProjectBuildRevision(snapshot, projectRevisionRef.current);
      } catch (error) {
        buildAbort.abort(error);
        throw error;
      }
    };
    try {
      const modelAssets = current.assets.filter((asset) => asset.kind === 'model');
      const assets = [];
      const missing: string[] = [];
      for (const asset of modelAssets) {
        const source = await getModelAssetSource(current.id, asset.id, asset.revision);
        assertCurrentRevision();
        if (!source) {
          const referenced = current.entities.some((entity) => entity.model?.assetId === asset.id);
          if (referenced) missing.push(asset.name);
          continue;
        }
        const extension = /\.[a-z0-9]{1,8}$/iu.exec(source.fileName)?.[0].toLowerCase() ?? '.bin';
        assets.push({
          path: `models/${asset.id}/${safeFilename(source.fileName.replace(/\.[^.]+$/u, ''))}${extension}`,
          contents: source.bytes,
          mediaType: source.mimeType || 'application/octet-stream',
          compression: 'auto' as const,
        });
      }
      assertCurrentRevision();
      if (missing.length) throw new Error(`Relink ${missing.join(', ')} before building.`);

      const [{ buildOfflineZip }, { createDefaultOfflineRuntimeBundle }, { compileProjectScriptsForBuild }] = await Promise.all([
        import('./build'),
        import('./build/runtime/createDefaultOfflineRuntimeBundle'),
        import('./build/scriptBuild'),
      ]);
      assertCurrentRevision();
      const compiled = await compileProjectScriptsForBuild(current, snapshot.revision, profile);
      assertCurrentRevision();
      if (!compiled.bundle && compiled.diagnostics.length) throw new Error(compiled.diagnostics[0]);
      const result = await buildOfflineZip({
        profile,
        projectName: current.name,
        title: current.name,
        ...(requestedFilename?.trim() ? { filename: requestedFilename.trim() } : {}),
        runtime: createDefaultOfflineRuntimeBundle(),
        ...(compiled.bundle ? { scripts: compiled.bundle } : {}),
        project: {
          path: 'project.json',
          contents: JSON.stringify(current),
          mediaType: 'application/json; charset=utf-8',
          compression: 'deflate',
        },
        assets,
        signal: buildAbort.signal,
        onProgress: assertCurrentRevision,
      });
      assertCurrentRevision();
      downloadBinaryFile(result.archive, result.filename);
      addLog(`Offline ${profile} build generated · ${result.manifest.files.length} files · ${result.archiveSha256.slice(0, 12)}`, 'success');
      showToast('Offline web game built as a production ZIP');
      return {
        ok: true,
        message: `Offline ${profile} ZIP generated with no network dependencies.`,
        filename: result.filename,
        sha256: result.archiveSha256,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not build the web game';
      addLog(`Build failed · ${message}`, 'warning');
      showToast(`Build failed · ${message}`);
      return { ok: false, message };
    }
  }, [addLog, showToast]);

  const createCollectEscape = useCallback(() => {
    if (!commitGameProject(createCollectEscapeProject(), 'Create Collect & Escape game')) return;
    setSelectedId('entity.player');
    setAssetStatuses({});
    setExperience('advanced');
    setGameAuthoringOpen(true);
    showToast('Collect & Escape created · scripts, physics, HUD, input, and build profile included');
  }, [commitGameProject, showToast]);

  const startPlay = useCallback(async () => {
    if (modeRef.current !== 'edit' || playStartInFlightRef.current !== null) return false;
    const request = ++playRequestRef.current;
    const revision = projectRevisionRef.current;
    const gameProject = gameProjectRef.current;
    playStartInFlightRef.current = request;
    setRuntimePreparing(true);
    try {
      const engine = engineRef.current;
      if (!engine) throw new Error('The viewport runtime is unavailable.');
      const requiresGameRuntime = detectProjectRuntimeBindings(gameProject) !== null;
      const hasAuthoredBehavior = gameProject.assets.some((asset) => asset.kind === 'script');
      let compiledBehavior;
      if (hasAuthoredBehavior) {
        const { compileProjectScriptsForBuild } = await import('./build/scriptBuild');
        const compiled = await compileProjectScriptsForBuild(gameProject, revision, 'development');
        if (!compiled.moduleCode || !compiled.contentHash) {
          throw new Error(compiled.diagnostics[0] ?? 'The authored behavior did not produce an executable module.');
        }
        compiledBehavior = {
          moduleCode: compiled.moduleCode,
          contentHash: compiled.contentHash,
          projectRevision: revision,
        };
      }
      if (request !== playRequestRef.current || revision !== projectRevisionRef.current) return false;
      const prepared = await engine.prepareGameRuntime(gameProject, compiledBehavior);
      if (request !== playRequestRef.current || modeRef.current !== 'edit' || revision !== projectRevisionRef.current) {
        // The synchronous in-flight owner prevents a newer Play preparation
        // from starting until this call settles, so this cleanup can only
        // dispose the stale controller produced by this request.
        engine.cancelPreparedGameRuntime();
        return false;
      }
      if (requiresGameRuntime && !prepared) {
        engine.cancelPreparedGameRuntime();
        throw new Error('The project game runtime was detected but could not be prepared.');
      }
      setGameAuthoringOpen(false);
      modeRef.current = 'play';
      setMode('play');
      setViewMode('game');
      markQuickStart('played');
      addLog('Entered Play mode · disposable runtime clone started', 'success');
      return true;
    } catch (error) {
      if (request === playRequestRef.current) engineRef.current?.cancelPreparedGameRuntime();
      const message = error instanceof Error ? error.message : 'The game runtime could not be prepared.';
      addLog(`Play failed · ${message}`, 'warning');
      showToast(`Play failed · ${message}`);
      return false;
    } finally {
      if (playStartInFlightRef.current === request) {
        playStartInFlightRef.current = null;
        setRuntimePreparing(false);
      }
    }
  }, [addLog, markQuickStart, showToast]);

  const stopPlay = useCallback(() => {
    playRequestRef.current += 1;
    setRuntimePreparing(false);
    if (modeRef.current === 'edit') engineRef.current?.cancelPreparedGameRuntime();
    modeRef.current = 'edit';
    setMode('edit');
    setViewMode('scene');
    setPreviewMode(false);
    addLog('Stopped Play mode · authoring scene restored');
  }, [addLog]);

  const togglePause = useCallback(() => {
    setMode((current) => {
      const next = current === 'paused' ? 'play' : current === 'play' ? 'paused' : current;
      modeRef.current = next;
      return next;
    });
  }, []);

  const enterPreview = useCallback(async () => {
    if (modeRef.current !== 'edit' || playStartInFlightRef.current !== null) return false;
    setAssistantOpen(false);
    setPreviewMode(true);
    const started = await startPlay();
    if (started) addLog('Clean game preview started', 'success');
    else setPreviewMode(false);
    return started;
  }, [addLog, startPlay]);

  const activateAsset = useCallback((asset: StudioAsset) => {
    if (modeRef.current !== 'edit') return;
    if (asset.kind === 'model' && asset.modelAsset) {
      const selected = getNode(projectRef.current, selectedId);
      const parentId = selected?.kind === 'group' ? selected.id : 'scene-root';
      const result = addModelInstance(projectRef.current, asset.modelAsset.id, parentId);
      if (!result || !commitProject(result.project, `Add ${asset.modelAsset.name} instance`)) return;
      setSelectedId(result.nodeId);
      markQuickStart('added');
      showToast(`${asset.modelAsset.name} added to the scene`);
      return;
    }
    if (asset.kind === 'primitive' && asset.primitive) {
      createPrimitive(asset.primitive, asset.color);
      return;
    }
    if (asset.kind === 'material' && asset.color) {
      const node = getNode(projectRef.current, selectedId);
      if (!node || node.kind !== 'mesh') {
        showToast('Select a mesh before applying a material');
        return;
      }
      if (!commitProject(applyMaterial(projectRef.current, node.id, asset.color), `Apply ${asset.name}`)) return;
      markQuickStart('styled');
      showToast(`${asset.name} applied to ${node.name}`);
      return;
    }
    setSelectedId('scene-root');
    showToast('MainWorld is already the active scene');
  }, [commitProject, createPrimitive, markQuickStart, selectedId, showToast]);

  const openModelPicker = useCallback((assetId?: string) => {
    if (modeRef.current !== 'edit') {
      showToast('Stop Play mode before importing a model');
      return;
    }
    relinkAssetIdRef.current = assetId ?? null;
    modelInputRef.current?.click();
  }, [showToast]);

  const handleModelImport = useCallback(async (file: File | undefined, relinkAssetId: string | null) => {
    if (!file || modeRef.current !== 'edit') return;
    setModelImportNotice({
      state: 'loading',
      message: relinkAssetId ? `Checking ${file.name} before relinking…` : `Checking ${file.name}…`,
    });
    let stored: { projectId: string; assetId: string; revision: number } | null = null;
    let committed = false;
    try {
      const { source, diagnostics } = await analyzeModelFile(file);
      const current = projectRef.current;

      if (relinkAssetId) {
        const existing = current.assets.find((asset) => asset.id === relinkAssetId);
        if (!existing) throw new Error('This model asset is no longer part of the project.');
        const revision = existing.revision + 1;
        await putModelAssetSource(current.id, existing.id, revision, source);
        stored = { projectId: current.id, assetId: existing.id, revision };
        const latest = projectRef.current.assets.find((asset) => asset.id === existing.id);
        if (!latest || latest.revision !== existing.revision) {
          throw new Error('The model changed while the replacement file was being checked. Try relinking again.');
        }
        const next = cloneProject(projectRef.current);
        next.assets = next.assets.map((asset) => asset.id === existing.id ? {
          ...asset,
          sourceFilename: source.fileName,
          mimeType: source.mimeType,
          byteLength: source.byteLength,
          revision,
          importedAt: new Date().toISOString(),
          diagnostics,
        } : asset);
        next.updatedAt = new Date().toISOString();
        if (!commitProject(next, `Relink ${existing.name}`)) {
          await deleteModelAssetSource(current.id, existing.id, revision);
          stored = null;
          return;
        }
        committed = true;
        setAssetStatuses((statuses) => ({ ...statuses, [existing.id]: { state: 'loading' } }));
        setModelImportNotice(null);
        addLog(`Relinked ${existing.name} · revision ${revision}`, 'success');
        showToast(`${existing.name} restored in every scene instance`);
        return;
      }

      const assetId = createNodeId('model-asset');
      const asset: ModelAssetRecord = {
        id: assetId,
        kind: 'model',
        name: modelDisplayName(source.fileName),
        sourceFilename: source.fileName,
        mimeType: source.mimeType,
        byteLength: source.byteLength,
        revision: 1,
        importedAt: new Date().toISOString(),
        diagnostics,
      };
      await putModelAssetSource(current.id, asset.id, asset.revision, source);
      stored = { projectId: current.id, assetId: asset.id, revision: asset.revision };
      const selected = getNode(projectRef.current, selectedId);
      const parentId = selected?.kind === 'group' ? selected.id : 'scene-root';
      const result = addModelAsset(projectRef.current, asset, parentId);
      if (!commitProject(result.project, `Import ${asset.name}`)) {
        await deleteModelAssetSource(current.id, asset.id, asset.revision);
        stored = null;
        return;
      }
      committed = true;
      setSelectedId(result.nodeId);
      setAssetStatuses((statuses) => ({ ...statuses, [asset.id]: { state: 'loading' } }));
      setModelImportNotice(null);
      setAddMenuOpen(false);
      markQuickStart('added');
      addLog(`Imported ${source.fileName} · ${diagnostics.meshes} meshes · ${formatTriangles(diagnostics.triangles)} triangles`, 'success');
      showToast(`${asset.name} added · ${diagnostics.meshes} mesh${diagnostics.meshes === 1 ? '' : 'es'}`);
    } catch (error) {
      if (stored && !committed) {
        void deleteModelAssetSource(stored.projectId, stored.assetId, stored.revision).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : 'This model could not be imported.';
      setModelImportNotice({ state: 'error', message });
      addLog(`Model import failed · ${message}`, 'warning');
      showToast('This model could not be imported');
    }
  }, [addLog, commitProject, markQuickStart, selectedId, showToast]);

  const handleImport = useCallback(async (file: File | undefined) => {
    if (!file || modeRef.current !== 'edit') return;
    try {
      const value: unknown = JSON.parse(await file.text());
      const gamePortable = readPortableGameProjectBundle(value);
      if (gamePortable) {
        const loaded = loadGameProjectDocument(gamePortable.project);
        if (!loaded.ok) throw new Error(loaded.errors[0] ?? 'Unsupported schema-v5 project package');
        for (const entry of gamePortable.sources) {
          const asset = loaded.project.assets.find((candidate) => candidate.kind === 'model' && candidate.id === entry.assetId);
          if (!asset || asset.revision !== entry.revision) {
            throw new Error(`Game project package source ${entry.assetId} does not match its asset metadata.`);
          }
        }
        for (const entry of gamePortable.sources) {
          await putModelAssetSource(loaded.project.id, entry.assetId, entry.revision, entry.source);
        }
        if (!commitGameProject(loaded.project, `Import ${file.name}`)) return;
        const legacy = createLegacySceneView(loaded.project);
        setSelectedId(legacy.nodes[0]?.id ?? null);
        setAssetStatuses({});
        addLog(`Imported schema-v5 package ${file.name}`, 'success');
        showToast(`Game project imported with ${gamePortable.sources.length} local model source${gamePortable.sources.length === 1 ? '' : 's'}`);
        return;
      }
      const portable = readPortableProjectBundle(value);
      if (!portable && typeof value === 'object' && value !== null && 'schemaVersion' in value && value.schemaVersion === 5) {
        const loaded = loadGameProjectDocument(value);
        if (!loaded.ok) throw new Error(loaded.errors[0] ?? 'Unsupported schema-v5 project');
        if (!commitGameProject(loaded.project, `Import ${file.name}`)) return;
        const legacy = createLegacySceneView(loaded.project);
        setSelectedId(legacy.nodes[0]?.id ?? null);
        setAssetStatuses({});
        addLog(`Imported ${file.name} as schema v5`, 'success');
        showToast('Schema v5 game project imported');
        return;
      }
      const result = loadProjectDocument(portable?.project ?? value);
      if (!result.ok) throw new Error(result.errors[0] ?? 'Unsupported project schema');
      if (portable) {
        for (const entry of portable.sources) {
          const asset = result.project.assets.find((candidate) => candidate.id === entry.assetId);
          if (!asset || asset.revision !== entry.revision) {
            throw new Error(`Project package source ${entry.assetId} does not match its asset metadata.`);
          }
        }
        for (const entry of portable.sources) {
          await putModelAssetSource(result.project.id, entry.assetId, entry.revision, entry.source);
        }
      }
      if (!commitProject(result.project, `Import ${file.name}`)) return;
      setSelectedId(result.project.nodes[0]?.id ?? null);
      setAssetStatuses({});
      addLog(`Imported ${file.name}`, 'success');
      const packagedModels = portable?.sources.length ?? 0;
      showToast(result.warnings.length
        ? `Project imported · ${result.warnings[0]}`
        : packagedModels
          ? `Project imported with ${packagedModels} model file${packagedModels === 1 ? '' : 's'}`
          : 'Project imported successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown import error';
      addLog(`Import failed · ${message}`, 'warning');
      showToast(`Import failed · ${message}`);
    }
  }, [addLog, commitGameProject, commitProject, showToast]);

  const resetStarter = useCallback(() => {
    if (modeRef.current !== 'edit') return;
    const next = createStarterProject();
    if (!commitProject(next, 'Create new starter project')) return;
    setSelectedId('player-core');
    setAssetStatuses({});
    showToast('New starter project created');
  }, [commitProject, showToast]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPERIENCE_KEY, experience);
    } catch {
      // Preferences remain session-only when browser storage is unavailable.
    }
  }, [experience]);

  useEffect(() => {
    try {
      localStorage.setItem(QUICK_START_KEY, JSON.stringify(quickStart));
    } catch {
      // Quick Start can still run for the current session.
    }
  }, [quickStart]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new ViewportEngine(canvas, {
      onSelect: setSelectedId,
      onTransformStart: () => {
        dragStartRef.current = cloneProject(projectRef.current);
        dragGameStartRef.current = structuredClone(gameProjectRef.current);
      },
      onTransformChange: (id, transform, final) => {
        if (modeRef.current !== 'edit') return;
        if (!final) {
          setProject((current) => {
            const next = updateNode(current, id, { transform });
            projectRef.current = next;
            return next;
          });
          setDirty(true);
          return;
        }
        const before = dragStartRef.current;
        const gameBefore = dragGameStartRef.current;
        if (before && gameBefore) {
          try {
            gameProjectRef.current = syncLegacySceneToV5(gameProjectRef.current, projectRef.current);
          } catch (error) {
            projectRef.current = before;
            gameProjectRef.current = gameBefore;
            setProject(before);
            addLog(error instanceof Error ? error.message : 'The transform could not be committed.', 'warning');
            dragStartRef.current = null;
            dragGameStartRef.current = null;
            return;
          }
          setUndoStack((entries) => [...entries, { document: before, gameDocument: gameBefore, label: 'Transform object' }].slice(-MAX_HISTORY));
          setRedoStack([]);
          dragStartRef.current = null;
          dragGameStartRef.current = null;
          const revision = bumpProjectRevision();
          addLog('Transform object');
          publishAssistantEvent({ type: 'project.changed', revision, label: 'Transform object', actor: 'human' });
          if (getNode(projectRef.current, id)?.kind === 'model') markQuickStart('styled');
        }
      },
      onStats: setStats,
      resolveAssetSource: getModelAssetSource,
      onAssetState: (_nodeId, assetId, state, message) => {
        setAssetStatuses((statuses) => ({ ...statuses, [assetId]: { state, message } }));
      },
      onRuntimeError: (message) => addLog(`Authored behavior failed · ${message}`, 'warning'),
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [addLog, bumpProjectRevision, markQuickStart, publishAssistantEvent]);

  useEffect(() => engineRef.current?.setDocument(project), [project]);
  useEffect(() => engineRef.current?.setSelected(selectedId), [selectedId]);
  useEffect(() => engineRef.current?.setTool(tool), [tool]);
  useEffect(() => engineRef.current?.setSpace(space), [space]);
  useEffect(() => engineRef.current?.setSnap(snap), [snap]);
  useEffect(() => engineRef.current?.setGridVisible(gridVisible), [gridVisible]);
  useEffect(() => engineRef.current?.setMode(mode), [mode]);
  useEffect(() => engineRef.current?.setViewMode(viewMode), [viewMode]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => saveProject(false), 1600);
    return () => window.clearTimeout(timer);
  }, [dirty, project, saveProject]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      const command = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape') {
        if (isTyping) return;
        event.preventDefault();
        setOpenMenu(null);
        setAddMenuOpen(false);
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        if (modeRef.current !== 'edit') stopPlay();
        return;
      }
      if (isTyping) return;
      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openCommandPalette();
        setCommandQuery('');
        return;
      }
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveProject();
        return;
      }
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (modeRef.current !== 'edit') return;
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (command && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        if (modeRef.current !== 'edit') return;
        duplicateSelected();
        return;
      }
      if (command && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        resetStarter();
        return;
      }
      if (command && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (modeRef.current === 'edit') importInputRef.current?.click();
        return;
      }
      if (command && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        buildWebGame();
        return;
      }
      if (command && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        if (modeRef.current === 'edit') startPlay(); else stopPlay();
        return;
      }
      if (command && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault();
        if (event.key === '1') setHierarchyOpen((open) => !open);
        if (event.key === '2') setInspectorOpen((open) => !open);
        if (event.key === '3') setBottomOpen((open) => !open);
        return;
      }
      if (command || editingDisabled) return;
      if (event.key === 'q' || event.key === 'Q') setTool('select');
      if (event.key === 'w' || event.key === 'W') setTool('translate');
      if (event.key === 'e' || event.key === 'E') setTool('rotate');
      if (event.key === 'r' || event.key === 'R') setTool('scale');
      if (event.key === 'f' || event.key === 'F') engineRef.current?.frameSelection();
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [buildWebGame, commandPaletteOpen, deleteSelected, duplicateSelected, editingDisabled, openCommandPalette, redo, resetStarter, saveProject, startPlay, stopPlay, undo]);

  const openAssistantPanel = useCallback(() => {
    setAssistantOpen(true);
    setInspectorOpen(false);
    setToast(null);
    if (window.innerWidth <= 960) {
      setHierarchyOpen(false);
      setBottomOpen(false);
    }
  }, []);

  const closeAssistantPanel = useCallback(() => setAssistantOpen(false), []);

  const commands = useMemo<CommandAction[]>(() => [
    { id: 'save', label: 'Save project', group: 'Project', shortcut: '⌘S', icon: <Save size={15} />, run: () => saveProject() },
    { id: 'collect-escape', label: 'New Collect & Escape game', group: 'Project', icon: <Sparkles size={15} />, disabled: editingDisabled, run: createCollectEscape },
    { id: 'export', label: 'Export editable project', group: 'Project', icon: <FileJson size={15} />, run: exportProject },
    { id: 'build', label: 'Build offline web game', group: 'Project', shortcut: '⌘B', icon: <Rocket size={15} />, run: buildWebGame },
    { id: 'legacy-build', label: 'Build legacy single-file HTML', group: 'Project', icon: <FileJson size={15} />, run: buildLegacyWebGame },
    { id: 'play', label: mode === 'edit' ? 'Enter Play mode' : 'Stop Play mode', group: 'Runtime', shortcut: '⌘P', icon: mode === 'edit' ? <Play size={15} /> : <Square size={14} />, run: mode === 'edit' ? startPlay : stopPlay },
    { id: 'preview', label: 'Open clean game preview', group: 'Runtime', icon: <Globe2 size={15} />, disabled: editingDisabled, run: enterPreview },
    { id: 'frame', label: 'Frame selected object', group: 'Viewport', shortcut: 'F', icon: <Crosshair size={15} />, disabled: editingDisabled, run: () => engineRef.current?.frameSelection() },
    { id: 'box', label: 'Create Box', group: 'Create', icon: <Box size={15} />, disabled: editingDisabled, run: () => createPrimitive('box') },
    { id: 'sphere', label: 'Create Sphere', group: 'Create', icon: <Circle size={15} />, disabled: editingDisabled, run: () => createPrimitive('sphere') },
    { id: 'group', label: 'Create Empty Group', group: 'Create', icon: <Layers3 size={15} />, disabled: editingDisabled, run: createEmptyGroup },
    { id: 'import-model', label: 'Import 3D model', group: 'Create', icon: <Upload size={15} />, disabled: editingDisabled, run: () => openModelPicker() },
    { id: 'hierarchy', label: 'Toggle Hierarchy panel', group: 'Window', icon: <PanelLeftOpen size={15} />, run: () => setHierarchyOpen((open) => !open) },
    { id: 'inspector', label: 'Toggle Inspector panel', group: 'Window', icon: <PanelRightOpen size={15} />, run: () => setInspectorOpen((open) => !open) },
    { id: 'project-panel', label: 'Toggle Project panel', group: 'Window', icon: <PanelBottomOpen size={15} />, run: () => setBottomOpen((open) => !open) },
    { id: 'game-authoring', label: 'Toggle Game Authoring workspace', group: 'Window', icon: <FileCode2 size={15} />, run: () => setGameAuthoringOpen((open) => !open) },
    { id: 'assistant', label: 'Open Studio Assistant', group: 'Window', icon: <Sparkles size={15} />, run: openAssistantPanel },
  ], [buildLegacyWebGame, buildWebGame, createCollectEscape, createEmptyGroup, createPrimitive, editingDisabled, enterPreview, exportProject, mode, openAssistantPanel, openModelPicker, saveProject, startPlay, stopPlay]);

  const filteredCommands = commands.filter((action) => action.label.toLowerCase().includes(commandQuery.toLowerCase()));
  const runCommand = (action: CommandAction) => {
    if (action.disabled) return;
    setCommandPaletteOpen(false);
    setCommandQuery('');
    action.run();
  };

  const closeMenus = () => {
    setOpenMenu(null);
    setAddMenuOpen(false);
  };

  const handleMenuOpenChange = (menu: ApplicationMenuName, open: boolean) => {
    setOpenMenu((current) => open ? menu : current === menu ? null : current);
    if (open) setAddMenuOpen(false);
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await viewportRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      showToast('Fullscreen is unavailable in this browser');
    }
  };

  const visibleMenus = experience === 'advanced'
    ? (['file', 'edit', 'object', 'window', 'help'] as const)
    : (['file', 'edit', 'object', 'help'] as const);

  const renderApplicationMenu = (menu: ApplicationMenuName) => {
    if (menu === 'file') {
      return (
        <>
          <MenubarGroup>
            <MenubarLabel className="menu-heading">Project</MenubarLabel>
            <MenuItem icon={<Sparkles size={14} />} label="New starter project" shortcut="⌘N" disabled={editingDisabled} onClick={() => { resetStarter(); closeMenus(); }} />
            <MenuItem icon={<Sparkles size={14} />} label="New Collect & Escape game" disabled={editingDisabled} onClick={() => { createCollectEscape(); closeMenus(); }} />
            <MenuItem icon={<FolderOpen size={14} />} label="Open project…" shortcut="⌘O" disabled={editingDisabled} onClick={() => { importInputRef.current?.click(); closeMenus(); }} />
            <MenuItem icon={<Save size={14} />} label="Save" shortcut="⌘S" onClick={() => { saveProject(); closeMenus(); }} />
          </MenubarGroup>
          <MenubarSeparator className="menu-separator" />
          <MenuItem icon={<FileJson size={14} />} label="Export editable project" onClick={() => { exportProject(); closeMenus(); }} />
          <MenuItem icon={<Rocket size={14} />} label="Build offline web game" shortcut="⌘B" onClick={() => { buildWebGame(); closeMenus(); }} />
          <MenuItem icon={<FileJson size={14} />} label="Build legacy single-file HTML" onClick={() => { buildLegacyWebGame(); closeMenus(); }} />
        </>
      );
    }

    if (menu === 'edit') {
      return (
        <>
          <MenuItem icon={<Undo2 size={14} />} label="Undo" shortcut="⌘Z" disabled={!undoStack.length || editingDisabled} onClick={() => { undo(); closeMenus(); }} />
          <MenuItem icon={<Redo2 size={14} />} label="Redo" shortcut="⇧⌘Z" disabled={!redoStack.length || editingDisabled} onClick={() => { redo(); closeMenus(); }} />
          <MenubarSeparator className="menu-separator" />
          <MenuItem icon={<Copy size={14} />} label="Duplicate" shortcut="⌘D" disabled={!selectedId || editingDisabled} onClick={() => { duplicateSelected(); closeMenus(); }} />
          <MenuItem icon={<Trash2 size={14} />} label="Delete" shortcut="⌫" danger disabled={!selectedId || selectedId === 'scene-root' || editingDisabled} onClick={() => { deleteSelected(); closeMenus(); }} />
        </>
      );
    }

    if (menu === 'object') {
      return (
        <>
          <MenuItem icon={<Layers3 size={14} />} label="Empty Group" disabled={editingDisabled} onClick={() => { createEmptyGroup(); closeMenus(); }} />
          <MenubarSeparator className="menu-separator" />
          <MenubarGroup>
            <MenubarLabel className="menu-heading">3D Object</MenubarLabel>
            {primitives.map((primitive) => <MenuItem key={primitive} icon={<PrimitiveIcon primitive={primitive} />} label={primitiveLabel(primitive)} disabled={editingDisabled} onClick={() => { createPrimitive(primitive); closeMenus(); }} />)}
          </MenubarGroup>
        </>
      );
    }

    if (menu === 'window') {
      return (
        <>
          <MenuItem icon={<PanelLeftOpen size={14} />} label={`${hierarchyOpen ? 'Hide' : 'Show'} Hierarchy`} shortcut="⌘1" onClick={() => { setHierarchyOpen((open) => !open); closeMenus(); }} />
          <MenuItem icon={<PanelRightOpen size={14} />} label={`${inspectorOpen ? 'Hide' : 'Show'} Inspector`} shortcut="⌘2" onClick={() => { setInspectorOpen((open) => !open); closeMenus(); }} />
          <MenuItem icon={<PanelBottomOpen size={14} />} label={`${bottomOpen ? 'Hide' : 'Show'} Project`} shortcut="⌘3" onClick={() => { setBottomOpen((open) => !open); closeMenus(); }} />
          <MenuItem icon={<FileCode2 size={14} />} label={`${gameAuthoringOpen ? 'Hide' : 'Show'} Game Authoring`} onClick={() => { setGameAuthoringOpen((open) => !open); closeMenus(); }} />
          <MenubarSeparator className="menu-separator" />
          <MenuItem icon={<Command size={14} />} label="Command palette" shortcut="⌘K" onClick={() => { openCommandPalette(); closeMenus(); }} />
        </>
      );
    }

    return (
      <MenubarGroup>
        <MenubarLabel className="menu-heading">ThreeJS Studio</MenubarLabel>
        <MenuItem icon={<Sparkles size={14} />} label="Resume Quick Start" onClick={() => { setQuickStart((current) => ({ ...current, dismissed: false })); changeExperience('essentials'); closeMenus(); }} />
        <MenuItem icon={<Command size={14} />} label="Keyboard shortcuts" onClick={() => { openCommandPalette(); closeMenus(); }} />
        <MenuItem icon={<Globe2 size={14} />} label="About this build" onClick={() => { showToast('ThreeJS Studio · threejs.studio · Editor foundation v0.2'); closeMenus(); }} />
      </MenubarGroup>
    );
  };

  const toggleMobilePanel = (panel: 'hierarchy' | 'inspector' | 'bottom') => {
    if (panel === 'hierarchy') {
      const next = !hierarchyOpen;
      setHierarchyOpen(next);
      if (next) { setInspectorOpen(false); setAssistantOpen(false); setBottomOpen(false); }
    } else if (panel === 'inspector') {
      const next = !inspectorOpen;
      setInspectorOpen(next);
      if (next) { setHierarchyOpen(false); setAssistantOpen(false); setBottomOpen(false); }
    } else {
      const next = !bottomOpen;
      setBottomOpen(next);
      if (next) { setHierarchyOpen(false); setInspectorOpen(false); setAssistantOpen(false); }
    }
  };

  const executeEditorHostTool = useCallback(async (
    toolName: AgentToolName,
    rawArguments: Record<string, unknown>,
    actor: EditorActor = 'assistant',
  ): Promise<EditorToolExecutionResult> => {
    const definition = getAgentToolDefinition(toolName);
    if (!definition || definition.host !== 'editor') {
      return { ok: false, changed: false, message: 'This tool is not handled by the live editor.', errors: [`${toolName} is not an editor-host tool.`] };
    }
    const errors = validateAgentToolArguments(toolName, rawArguments);
    if (errors.length) return { ok: false, changed: false, message: 'The tool arguments are invalid.', errors };
    const args = rawArguments;

    if (toolName === 'studio_get_editor_context') {
      return {
        ok: true,
        changed: false,
        message: `Editor is in ${modeRef.current} mode at revision ${projectRevisionRef.current}.`,
        errors: [],
        data: {
          project: { id: projectRef.current.id, name: projectRef.current.name, schemaVersion: projectRef.current.schemaVersion, revision: projectRevisionRef.current },
          selection: { selectedId, node: selectedId ? structuredClone(getNode(projectRef.current, selectedId) ?? null) : null },
          mode: modeRef.current,
          viewport: { viewMode, tool, space, snap, gridVisible },
          layout: { experience, hierarchyOpen, inspectorOpen, assistantOpen, bottomOpen, bottomTab, previewMode },
          history: { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, undoDepth: undoStack.length, redoDepth: redoStack.length },
          dirty,
          lastSaved,
        },
      };
    }

    if (toolName === 'studio_get_diagnostics') {
      const available = {
        editor: window.__THREEJS_STUDIO_DIAGNOSTICS__?.editor ?? { mode: modeRef.current, viewMode, selectedId, objectCount: projectRef.current.nodes.length, schemaVersion: projectRef.current.schemaVersion, assetCount: projectRef.current.assets.length },
        renderer: window.__THREEJS_STUDIO_DIAGNOSTICS__?.renderer ?? structuredClone(stats),
        assets: window.__THREEJS_STUDIO_DIAGNOSTICS__?.assets ?? { statuses: structuredClone(assetStatuses) },
        history: { revision: projectRevisionRef.current, undoDepth: undoStack.length, redoDepth: redoStack.length, dirty },
      };
      const sections = args.sections as Array<keyof typeof available> | undefined;
      const data = sections?.length
        ? Object.fromEntries(sections.map((section) => [section, available[section]]))
        : available;
      return { ok: true, changed: false, message: 'Read live editor diagnostics.', errors: [], data: structuredClone(data) };
    }

    if (toolName === 'studio_select_node') {
      const nodeId = args.nodeId as string | null;
      if (nodeId && !getNode(projectRef.current, nodeId)) {
        return { ok: false, changed: false, message: 'The requested node does not exist.', errors: [`Node "${nodeId}" does not exist.`] };
      }
      setSelectedId(nodeId);
      if (args.reveal === true) {
        setHierarchyOpen(true);
        setInspectorOpen(true);
        setAssistantOpen(false);
      }
      if (args.frame === true && nodeId) window.requestAnimationFrame(() => engineRef.current?.frameSelection());
      return { ok: true, changed: true, message: nodeId ? `Selected ${getNode(projectRef.current, nodeId)?.name ?? nodeId}.` : 'Cleared the editor selection.', errors: [], data: { selectedId: nodeId } };
    }

    if (toolName === 'studio_set_viewport') {
      if (args.viewMode) setViewMode(args.viewMode as ViewMode);
      if (args.tool) setTool(args.tool as EditorTool);
      if (args.space) setSpace(args.space as 'local' | 'world');
      if (typeof args.snap === 'boolean') setSnap(args.snap);
      if (typeof args.gridVisible === 'boolean') setGridVisible(args.gridVisible);
      if (args.cameraView) engineRef.current?.setCameraView(args.cameraView as 'perspective' | 'top' | 'right' | 'front');
      if (args.frameSelection === true) engineRef.current?.frameSelection();
      if (typeof args.fullscreen === 'boolean') {
        try {
          if (args.fullscreen && !document.fullscreenElement) await viewportRef.current?.requestFullscreen();
          if (!args.fullscreen && document.fullscreenElement) await document.exitFullscreen();
        } catch {
          return { ok: false, changed: false, message: 'Fullscreen is unavailable in this browser.', errors: ['The browser rejected the fullscreen request.'] };
        }
      }
      return { ok: true, changed: true, message: 'Updated the live viewport configuration.', errors: [], data: { ...args } };
    }

    if (toolName === 'studio_control_runtime') {
      const action = args.action as 'play' | 'pause' | 'resume' | 'step' | 'stop' | 'preview' | 'exit-preview';
      if (action === 'play') {
        if (modeRef.current !== 'edit') return { ok: false, changed: false, message: 'Runtime is already active.', errors: ['Play requires Edit mode.'] };
        if (!await startPlay()) {
          return { ok: false, changed: false, message: 'The runtime could not be started.', errors: ['Play initialization did not complete successfully.'] };
        }
      } else if (action === 'pause') {
        if (modeRef.current !== 'play') return { ok: false, changed: false, message: 'Runtime is not playing.', errors: ['Pause requires Play mode.'] };
        togglePause();
      } else if (action === 'resume') {
        if (modeRef.current !== 'paused') return { ok: false, changed: false, message: 'Runtime is not paused.', errors: ['Resume requires Paused mode.'] };
        togglePause();
      } else if (action === 'step') {
        if (modeRef.current !== 'paused') return { ok: false, changed: false, message: 'Runtime is not paused.', errors: ['Step requires Paused mode.'] };
        engineRef.current?.step();
      } else if (action === 'preview') {
        if (modeRef.current !== 'edit') return { ok: false, changed: false, message: 'Runtime is already active.', errors: ['Preview requires Edit mode.'] };
        if (!await enterPreview()) {
          return { ok: false, changed: false, message: 'Clean Preview could not be started.', errors: ['Preview initialization did not complete successfully.'] };
        }
      } else if (action === 'exit-preview') {
        if (!previewMode) return { ok: false, changed: false, message: 'Clean Preview is not active.', errors: ['Exit Preview requires an active clean preview.'] };
        stopPlay();
      } else {
        if (modeRef.current === 'edit') return { ok: false, changed: false, message: 'Runtime is already stopped.', errors: ['Stop requires an active runtime.'] };
        stopPlay();
      }
      return { ok: true, changed: true, message: `Runtime action completed: ${action}.`, errors: [], data: { action } };
    }

    if (toolName === 'studio_control_history') {
      const action = args.action as 'undo' | 'redo';
      if (modeRef.current !== 'edit') {
        return { ok: false, changed: false, message: 'History is locked while the runtime is active.', errors: ['Undo and redo require Edit mode.'] };
      }
      if (action === 'undo') {
        if (!undoStack.length) return { ok: false, changed: false, message: 'There is nothing to undo.', errors: ['Undo history is empty.'] };
        undo(actor);
      } else {
        if (!redoStack.length) return { ok: false, changed: false, message: 'There is nothing to redo.', errors: ['Redo history is empty.'] };
        redo(actor);
      }
      return { ok: true, changed: true, message: `${action === 'undo' ? 'Undid' : 'Redid'} one editor transaction.`, errors: [], data: { action } };
    }

    if (toolName === 'studio_get_console') {
      const level = args.level as ConsoleEntry['level'] | undefined;
      const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
      const limit = (args.limit as number | undefined) ?? 50;
      const entries = consoleEntries.filter((entry) => (!level || entry.level === level) && (!query || entry.message.toLowerCase().includes(query))).slice(-limit);
      return { ok: true, changed: false, message: `Read ${entries.length} console entr${entries.length === 1 ? 'y' : 'ies'}.`, errors: [], data: { entries: structuredClone(entries), total: entries.length } };
    }

    if (toolName === 'studio_clear_console') {
      setConsoleEntries([]);
      return { ok: true, changed: true, message: 'Cleared the editor console.', errors: [] };
    }

    if (toolName === 'studio_set_editor_layout') {
      if (args.experience) changeExperience(args.experience as ExperienceLevel);
      if (typeof args.hierarchyOpen === 'boolean') setHierarchyOpen(args.hierarchyOpen);
      if (typeof args.inspectorOpen === 'boolean') {
        setInspectorOpen(args.inspectorOpen);
        if (args.inspectorOpen) setAssistantOpen(false);
      }
      if (typeof args.bottomOpen === 'boolean') setBottomOpen(args.bottomOpen);
      if (args.bottomTab) setBottomTab(args.bottomTab as 'assets' | 'console');
      if (typeof args.quickStartOpen === 'boolean') setQuickStart((current) => ({ ...current, dismissed: !args.quickStartOpen }));
      if (typeof args.commandPaletteOpen === 'boolean') setCommandPaletteOpen(args.commandPaletteOpen);
      return { ok: true, changed: true, message: 'Updated the editor layout.', errors: [], data: { ...args } };
    }

    if (toolName === 'studio_save_project') {
      const saved = saveProject();
      return saved
        ? { ok: true, changed: true, message: 'Saved the project to browser storage.', errors: [] }
        : { ok: false, changed: false, message: 'Browser storage is unavailable.', errors: ['The project could not be saved to browser storage.'] };
    }
    if (toolName === 'studio_export_project') {
      const result = await exportProject(args.filename as string | undefined);
      return result.ok
        ? { ok: true, changed: true, message: result.message, errors: [] }
        : { ok: false, changed: false, message: 'The editable project could not be exported.', errors: [result.message] };
    }
    if (toolName === 'studio_build_project') {
      const result = await buildWebGame(args.filename as string | undefined);
      return result.ok
        ? { ok: true, changed: true, message: result.message, errors: [] }
        : { ok: false, changed: false, message: 'The standalone web build failed.', errors: [result.message] };
    }
    if (toolName === 'studio_request_project_import') {
      importInputRef.current?.click();
      return { ok: true, changed: true, message: 'Opened the project file picker for the user.', errors: [] };
    }
    if (toolName === 'studio_request_model_import') {
      const assetId = args.assetId as string | undefined;
      if (assetId && !projectRef.current.assets.some((asset) => asset.id === assetId)) {
        return { ok: false, changed: false, message: 'The requested model asset does not exist.', errors: [`Model asset "${assetId}" does not exist.`] };
      }
      openModelPicker(assetId);
      return { ok: true, changed: true, message: assetId ? 'Opened the model picker to relink the asset.' : 'Opened the model picker for the user.', errors: [] };
    }

    return { ok: false, changed: false, message: 'The editor tool is not implemented.', errors: [`${toolName} has no live editor handler.`] };
  }, [
    assetStatuses,
    assistantOpen,
    bottomOpen,
    bottomTab,
    buildWebGame,
    changeExperience,
    consoleEntries,
    dirty,
    enterPreview,
    experience,
    exportProject,
    gridVisible,
    hierarchyOpen,
    inspectorOpen,
    lastSaved,
    openModelPicker,
    previewMode,
    redo,
    redoStack,
    saveProject,
    selectedId,
    snap,
    space,
    startPlay,
    stats,
    stopPlay,
    togglePause,
    tool,
    undo,
    undoStack,
    viewMode,
  ]);

  const appendAssistantMessage = useCallback((message: Omit<AssistantMessage, 'id'>) => {
    setAssistantMessages((current) => [...current, { ...message, id: assistantId('message') }].slice(-80));
  }, []);

  const prepareAssistantCalls = useCallback(async ({
    title,
    description,
    toolCalls,
    source,
    proposalId,
  }: {
    title: string;
    description: string;
    toolCalls: StudioAgentToolCall[];
    source: PendingAssistantPlan['source'];
    proposalId?: string;
  }) => {
    if (!toolCalls.length) return { status: 'rejected' as const, errors: ['A tool plan must contain at least one call.'] };
    const definitions = toolCalls.map((call) => getAgentToolDefinition(call.name));
    if (definitions.some((definition) => !definition)) {
      return { status: 'rejected' as const, errors: ['The plan contains a tool outside the advertised capability manifest.'] };
    }
    const argumentErrors = toolCalls.flatMap((call) => validateAgentToolArguments(call.name, call.arguments));
    if (argumentErrors.length) return { status: 'rejected' as const, errors: argumentErrors };

    const editorCalls = toolCalls.filter((call) => getAgentToolDefinition(call.name)?.host === 'editor');
    const projectCalls = toolCalls.filter((call) => getAgentToolDefinition(call.name)?.host === 'project');
    if (editorCalls.length && projectCalls.length) {
      return { status: 'rejected' as const, errors: ['Project edits and live-editor actions must be reviewed as separate transactions.'] };
    }

    if (definitions.every((definition) => definition?.readOnly)) {
      if (projectCalls.length) {
        const batch = executeAgentToolBatch(projectRef.current, projectCalls);
        if (!batch.ok) return { status: 'rejected' as const, errors: batch.errors };
        const message = summarizeAgentBatch(batch);
        if (source === 'guided') appendAssistantMessage({ role: 'assistant', text: message });
        return { status: 'completed' as const, message, data: batch.results.map((result) => result.data) };
      }
      const results: EditorToolExecutionResult[] = [];
      try {
        const actor: EditorActor = source === 'bridge' ? 'integration' : 'assistant';
        for (const call of editorCalls) results.push(await executeEditorHostTool(call.name, call.arguments, actor));
      } catch (error) {
        return { status: 'rejected' as const, errors: [error instanceof Error ? error.message : 'The live editor read failed.'] };
      }
      const failed = results.find((result) => !result.ok);
      if (failed) return { status: 'rejected' as const, errors: failed.errors };
      const message = results.map((result) => result.message).join('\n');
      if (source === 'guided') appendAssistantMessage({ role: 'assistant', text: message });
      return { status: 'completed' as const, message, data: results.map((result) => result.data) };
    }

    if (pendingAssistantPlanRef.current) {
      return { status: 'rejected' as const, errors: ['Review or discard the current proposal before creating another one.'] };
    }

    if (editorCalls.length > 1) {
      return { status: 'rejected' as const, errors: ['Live-editor actions are proposed one at a time because session state cannot yet be rolled back atomically.'] };
    }

    const batch = projectCalls.length ? executeAgentToolBatch(projectRef.current, projectCalls) : undefined;
    if (batch && !batch.ok) return { status: 'rejected' as const, errors: batch.errors };
    if (batch && !batch.changed) {
      const message = summarizeAgentBatch(batch);
      if (source === 'guided') appendAssistantMessage({ role: 'assistant', text: message });
      return { status: 'completed' as const, message, data: batch.results.map((result) => result.data) };
    }

    const id = proposalId ?? assistantId('proposal');
    const plan: PendingAssistantPlan = {
      id,
      title,
      description,
      baseRevision: projectRevisionRef.current,
      source,
      toolCalls,
      ...(batch ? { batch } : {}),
      calls: toolCalls.map((call, index) => {
        const definition = definitions[index]!;
        const assessment = assessAgentToolCall(projectRef.current, call.name, call.arguments);
        const fileSideEffect = definition.scopes.some((scope) => scope.includes('local-files') || scope.includes('downloads'));
        const effect = definition.readOnly
          ? 'read'
          : fileSideEffect
            ? 'file'
            : assessment.level === 'destructive'
              ? 'destructive'
              : assessment.requiresApproval && assessment.level === 'moderate'
                ? 'sensitive'
                : 'write';
        return {
          name: call.name,
          title: definition.title,
          effect,
          summary: batch?.results[index]?.message ?? definition.description,
          arguments: structuredClone(call.arguments),
          ...(effect === 'sensitive' ? { reviewNote: assessment.reasons.join(' ') } : {}),
        };
      }),
    };
    pendingAssistantPlanRef.current = plan;
    setPendingAssistantPlan(plan);
    openAssistantPanel();
    publishAssistantEvent({ type: 'proposal.created', revision: plan.baseRevision, proposalId: id, label: title, actor: source === 'bridge' ? 'integration' : 'assistant' });
    return { status: 'approval_required' as const, proposalId: id, baseRevision: plan.baseRevision };
  }, [appendAssistantMessage, executeEditorHostTool, openAssistantPanel, publishAssistantEvent]);

  const submitAssistantPrompt = useCallback(async (prompt: string) => {
    appendAssistantMessage({ role: 'user', text: prompt });
    setAssistantBusy(true);
    try {
      const plan = await guidedStudioAgentProvider.plan({ project: projectRef.current, selectedId, prompt });
      if (!plan.ok || plan.kind === 'unsupported') {
        appendAssistantMessage({ role: 'assistant', status: 'warning', text: plan.description });
        return;
      }
      const result = await prepareAssistantCalls({ title: plan.title, description: plan.description, toolCalls: plan.calls, source: 'guided' });
      if (result.status === 'rejected') appendAssistantMessage({ role: 'assistant', status: 'warning', text: result.errors.join('\n') });
    } catch (error) {
      appendAssistantMessage({ role: 'assistant', status: 'warning', text: error instanceof Error ? error.message : 'The Guided Assistant could not prepare that request.' });
    } finally {
      setAssistantBusy(false);
    }
  }, [appendAssistantMessage, prepareAssistantCalls, selectedId]);

  const applyPendingAssistantPlan = useCallback(async () => {
    const plan = pendingAssistantPlan;
    if (!plan || assistantApplyInFlightRef.current) return;
    if (plan.baseRevision !== projectRevisionRef.current) {
      appendAssistantMessage({ role: 'assistant', status: 'warning', text: `This proposal was prepared for revision ${plan.baseRevision}, but the project is now at revision ${projectRevisionRef.current}. Discard it and ask me to review the current scene.` });
      return;
    }
    if ((plan.batch || plan.gameResult?.changed) && modeRef.current !== 'edit') {
      appendAssistantMessage({ role: 'assistant', status: 'warning', text: 'Stop Play mode before applying authored scene changes.' });
      return;
    }
    assistantApplyInFlightRef.current = plan.id;
    setAssistantBusy(true);
    try {
      if (plan.gameResult) {
        const actor: EditorActor = plan.source === 'bridge' ? 'integration' : 'assistant';
        if (plan.gameResult.changed) {
          const label = plan.gameResult.history?.label
            ? `${plan.source === 'bridge' ? 'Integration' : 'Studio Assistant'} · ${plan.gameResult.history.label}`
            : `${plan.source === 'bridge' ? 'Integration' : 'Studio Assistant'} · ${plan.title}`;
          if (!commitGameProject(plan.gameResult.project, label, actor)) return;
          setLastAssistantCommit({ revision: projectRevisionRef.current, label, actor });
          if (plan.gameResult.toolName === 'studio_create_collect_escape') {
            setSelectedId('entity.player');
            setAssetStatuses({});
            setExperience('advanced');
            setGameAuthoringOpen(true);
          }
        }
        appendAssistantMessage({
          role: 'tool',
          label: plan.source === 'bridge' ? 'Integration tool result' : 'Tool result',
          status: 'success',
          text: plan.gameResult.changed
            ? `${plan.gameResult.history?.label ?? plan.title} applied as one validated Undo step.`
            : `${plan.title} completed successfully; the project was already up to date.`,
        });
      } else if (plan.batch) {
        const actor: EditorActor = plan.source === 'bridge' ? 'integration' : 'assistant';
        const label = `${plan.source === 'bridge' ? 'Integration' : 'Studio Assistant'} · ${plan.title}`;
        if (!commitProject(plan.batch.nextProject, label, actor)) return;
        setLastAssistantCommit({ revision: projectRevisionRef.current, label, actor });
        if (plan.batch.selectedId) setSelectedId(plan.batch.selectedId);
        if (plan.toolCalls.some((call) => call.name === 'studio_create_primitive' || call.name === 'studio_add_model_instance')) markQuickStart('added');
        if (plan.toolCalls.some((call) => call.name === 'studio_update_node' || call.name === 'studio_update_world_settings')) markQuickStart('styled');
        appendAssistantMessage({ role: 'tool', label: plan.source === 'bridge' ? 'Integration tool result' : 'Tool result', status: 'success', text: `${plan.batch.messages.join(' ')} The complete plan is one Undo step.` });
      } else {
        const call = plan.toolCalls[0];
        const actor: EditorActor = plan.source === 'bridge' ? 'integration' : 'assistant';
        const result = call ? await executeEditorHostTool(call.name as AgentToolName, call.arguments, actor) : null;
        if (!result?.ok) {
          appendAssistantMessage({ role: 'tool', status: 'warning', text: result?.errors.join('\n') || 'The live editor action could not be applied.' });
          return;
        }
        appendAssistantMessage({ role: 'tool', status: 'success', text: result.message });
      }
      if (pendingAssistantPlanRef.current?.id === plan.id) {
        pendingAssistantPlanRef.current = null;
        setPendingAssistantPlan((current) => current?.id === plan.id ? null : current);
      }
      publishAssistantEvent({ type: 'proposal.applied', revision: projectRevisionRef.current, proposalId: plan.id, label: plan.title, actor: plan.source === 'bridge' ? 'integration' : 'assistant' });
    } catch (error) {
      appendAssistantMessage({ role: 'tool', status: 'warning', text: error instanceof Error ? error.message : 'The live editor action failed without changing the project.' });
    } finally {
      if (assistantApplyInFlightRef.current === plan.id) assistantApplyInFlightRef.current = null;
      setAssistantBusy(false);
    }
  }, [appendAssistantMessage, commitGameProject, commitProject, executeEditorHostTool, markQuickStart, pendingAssistantPlan, publishAssistantEvent]);

  const discardPendingAssistantPlan = useCallback(() => {
    if (!pendingAssistantPlan) return;
    if (assistantApplyInFlightRef.current === pendingAssistantPlan.id) return;
    appendAssistantMessage({ role: 'assistant', text: `Discarded “${pendingAssistantPlan.title}”. No changes were applied.` });
    publishAssistantEvent({ type: 'proposal.dismissed', revision: projectRevisionRef.current, proposalId: pendingAssistantPlan.id, label: pendingAssistantPlan.title, actor: pendingAssistantPlan.source === 'bridge' ? 'integration' : 'assistant' });
    pendingAssistantPlanRef.current = null;
    setPendingAssistantPlan(null);
  }, [appendAssistantMessage, pendingAssistantPlan, publishAssistantEvent]);

  const undoLastAssistantPlan = useCallback(() => {
    const marker = lastAssistantCommit;
    if (!marker || modeRef.current !== 'edit') return;
    if (marker.revision !== projectRevisionRef.current || undoStack.at(-1)?.label !== marker.label) return;
    undo(marker.actor);
    setLastAssistantCommit(null);
    appendAssistantMessage({ role: 'tool', status: 'success', text: 'Undid the complete Assistant plan in one history step.' });
  }, [appendAssistantMessage, lastAssistantCommit, undo, undoStack]);

  useEffect(() => {
    assistantSnapshotRef.current = () => ({
      revision: projectRevisionRef.current,
      project: structuredClone(gameProjectRef.current),
      legacySceneProjection: cloneProject(projectRef.current),
      selectedId,
      mode: modeRef.current,
      viewport: { viewMode, tool, space, snap, gridVisible },
      layout: { experience, hierarchyOpen, inspectorOpen, assistantOpen, bottomOpen, bottomTab, previewMode },
      history: { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 },
      renderer: structuredClone(stats),
    });
    assistantRequestRef.current = async (request) => {
      const requestId = request.requestId ?? assistantId('request');
      const definition = getAgentToolDefinition(request.tool);
      const args = request.arguments ?? {};
      if (!definition) {
        const gameDefinition = AGENT_GAME_CAPABILITY_MANIFEST.tools.find((entry) => entry.name === request.tool);
        if (!gameDefinition) return { status: 'rejected', requestId, errors: [`Unknown agent tool "${request.tool}".`] };
        const baseRevision = request.baseRevision ?? (typeof args.baseRevision === 'number' ? args.baseRevision : undefined);
        if (baseRevision === undefined) return { status: 'rejected', requestId, errors: ['Game-authoring requests require baseRevision.'], currentRevision: projectRevisionRef.current };
        const result = executeAgentGameTool(gameProjectRef.current, projectRevisionRef.current, request.tool, { ...args, baseRevision });
        if (!result.ok) return { status: 'rejected', requestId, errors: result.errors, currentRevision: projectRevisionRef.current };
        if (gameDefinition.approval === 'required') {
          if (pendingAssistantPlanRef.current) {
            return { status: 'rejected', requestId, errors: ['Review or discard the current proposal before creating another one.'] };
          }
          const assessment = assessAgentGameToolCall(request.tool);
          const id = `proposal-${requestId}`;
          const gameToolCall = {
            name: gameDefinition.name,
            arguments: structuredClone({ ...args, baseRevision }),
          };
          const destructive = gameDefinition.name === 'studio_delete_script'
            || gameDefinition.name === 'studio_create_collect_escape';
          const plan: PendingAssistantPlan = {
            id,
            title: gameDefinition.name === 'studio_create_collect_escape'
              ? 'Create Collect & Escape game'
              : gameDefinition.name === 'studio_delete_script'
                ? 'Delete behavior script'
                : 'Save behavior script',
            description: gameDefinition.description,
            baseRevision: projectRevisionRef.current,
            source: 'bridge',
            toolCalls: [gameToolCall],
            gameResult: result,
            calls: [{
              name: gameDefinition.name,
              title: gameDefinition.description,
              effect: destructive ? 'destructive' : 'sensitive',
              summary: result.history?.label ?? gameDefinition.description,
              arguments: gameToolCall.arguments,
              reviewNote: assessment.reasons.join(' '),
            }],
          };
          pendingAssistantPlanRef.current = plan;
          setPendingAssistantPlan(plan);
          openAssistantPanel();
          publishAssistantEvent({
            type: 'proposal.created',
            revision: plan.baseRevision,
            proposalId: id,
            label: plan.title,
            actor: 'integration',
          });
          return {
            status: 'approval_required',
            requestId,
            proposalId: id,
            currentRevision: projectRevisionRef.current,
            tool: gameDefinition.name,
            rationale: gameDefinition.description,
            preview: result.data,
          };
        }
        return { status: 'complete', requestId, result };
      }
      const errors = validateAgentToolArguments(request.tool, args);
      if (errors.length) return { status: 'rejected', requestId, errors };
      if (!definition.readOnly && request.baseRevision === undefined) {
        return { status: 'rejected', requestId, errors: ['Mutating requests require baseRevision.'], currentRevision: projectRevisionRef.current };
      }
      if (request.baseRevision !== undefined && request.baseRevision !== projectRevisionRef.current) {
        return { status: 'revision_conflict', requestId, baseRevision: request.baseRevision, currentRevision: projectRevisionRef.current, retryable: true };
      }
      const result = await prepareAssistantCalls({
        title: definition.title,
        description: definition.description,
        toolCalls: [{ name: definition.name, arguments: args }],
        source: 'bridge',
        proposalId: `proposal-${requestId}`,
      });
      return { ...result, requestId };
    };
  }, [assistantOpen, bottomOpen, bottomTab, experience, gridVisible, hierarchyOpen, inspectorOpen, openAssistantPanel, prepareAssistantCalls, previewMode, publishAssistantEvent, redoStack.length, selectedId, snap, space, stats, tool, undoStack.length, viewMode]);

  useEffect(() => {
    const bridge: ThreeJSStudioAgentBridge = {
      // V2 makes ProjectDocumentV5 authoritative in snapshot().project and
      // moves the former V4 shape to snapshot().legacySceneProjection.
      apiVersion: 2,
      manifest: () => structuredClone({ ...AGENT_CAPABILITY_MANIFEST, authoritativeProjectSchemaVersion: 5, gameAuthoring: AGENT_GAME_CAPABILITY_MANIFEST }),
      snapshot: () => assistantSnapshotRef.current(),
      request: (request) => assistantRequestRef.current(request),
      subscribe: (listener) => {
        if (typeof listener !== 'function') return () => undefined;
        assistantSubscribersRef.current.add(listener);
        return () => assistantSubscribersRef.current.delete(listener);
      },
    };
    window.__THREEJS_STUDIO_AGENT__ = bridge;
    window.__THREE_GAME_STUDIO_AGENT__ = bridge;
    return () => {
      if (window.__THREEJS_STUDIO_AGENT__ === bridge) delete window.__THREEJS_STUDIO_AGENT__;
      if (window.__THREE_GAME_STUDIO_AGENT__ === bridge) delete window.__THREE_GAME_STUDIO_AGENT__;
      assistantSubscribersRef.current.clear();
      pendingAssistantPlanRef.current = null;
      assistantApplyInFlightRef.current = null;
    };
  }, []);

  const canUndoLastAssistantPlan = Boolean(
    lastAssistantCommit &&
    mode === 'edit' &&
    lastAssistantCommit.revision === projectRevision &&
    undoStack.at(-1)?.label === lastAssistantCommit.label
  );

  return (
    <div
      className={`studio-app experience-${experience} mode-${mode} ${previewMode ? 'preview-mode' : ''} ${bottomOpen ? 'panel-bottom-open' : ''} ${hierarchyOpen ? 'panel-hierarchy-open' : ''} ${inspectorOpen ? 'panel-inspector-open' : ''} ${assistantOpen ? 'panel-agent-open' : ''}`}
      data-testid="studio-app"
      data-experience={experience}
      data-step={quickStartStep}
      data-runtime={runtimePreparing ? 'preparing' : mode === 'edit' ? 'edit' : 'playing'}
    >
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Boxes size={18} strokeWidth={1.8} /></span>
          <span className="brand-copy"><strong>ThreeJS</strong><span>Studio</span></span>
        </div>
        <Menubar className="app-menu-bar h-auto border-0 max-[720px]:hidden" aria-label="Application menu">
          {visibleMenus.map((menu) => (
            <MenubarMenu
              key={menu}
              open={openMenu === menu}
              onOpenChange={(open) => handleMenuOpenChange(menu, open)}
            >
              <MenubarTrigger className={openMenu === menu ? 'is-active' : ''}>
                {menu[0].toUpperCase() + menu.slice(1)}
              </MenubarTrigger>
              <MenubarContent className={`app-menu-popover menu-${menu} !static !top-auto !left-auto`}>
                {renderApplicationMenu(menu)}
              </MenubarContent>
            </MenubarMenu>
          ))}
        </Menubar>
        <div className="project-crumb">
          <span className={`save-state-dot ${dirty ? 'is-dirty' : ''}`} />
          <strong>{project.name}</strong>
          <span>/</span>
          <span>{project.sceneName}</span>
          {experience === 'advanced' ? <ChevronDown size={12} /> : null}
        </div>
        <div className="history-actions">
          <IconButton label={undoStack.length ? `Undo ${undoStack.at(-1)?.label}` : 'Nothing to undo'} compact disabled={!undoStack.length || editingDisabled} onClick={() => undo()}><Undo2 size={14} /></IconButton>
          <IconButton label={redoStack.length ? `Redo ${redoStack.at(-1)?.label}` : 'Nothing to redo'} compact disabled={!redoStack.length || editingDisabled} onClick={() => redo()}><Redo2 size={14} /></IconButton>
          <IconButton label="Save project" compact onClick={() => saveProject()} testId="save-project"><Save size={14} /></IconButton>
        </div>
        <div className="play-controls" aria-label="Play controls">
          {experience === 'essentials' ? (
            mode === 'edit'
              ? <button type="button" className="essential-play" onClick={startPlay} disabled={runtimePreparing} data-testid="play-button"><Play size={13} fill="currentColor" /> {runtimePreparing ? 'Preparing…' : 'Play'}</button>
              : <button type="button" className="essential-stop" onClick={stopPlay} data-testid="stop-button"><Square size={11} fill="currentColor" /> Stop</button>
          ) : (
            <>
              <IconButton label={runtimePreparing ? 'Preparing game runtime' : 'Play'} active={mode === 'play'} disabled={mode !== 'edit' || runtimePreparing} onClick={startPlay} testId="play-button"><Play size={14} fill={mode === 'play' ? 'currentColor' : 'none'} /></IconButton>
              <IconButton label={mode === 'paused' ? 'Resume' : 'Pause'} active={mode === 'paused'} disabled={mode === 'edit'} onClick={togglePause} testId="pause-button"><Pause size={14} fill={mode === 'paused' ? 'currentColor' : 'none'} /></IconButton>
              <IconButton label="Step one frame" disabled={mode !== 'paused'} onClick={() => engineRef.current?.step()}><StepForward size={14} /></IconButton>
              <IconButton label="Stop" disabled={mode === 'edit'} onClick={stopPlay} testId="stop-button"><Square size={12} fill={mode !== 'edit' ? 'currentColor' : 'none'} /></IconButton>
            </>
          )}
        </div>
        <div className="experience-switch" data-testid="experience-toggle" role="group" aria-label="Editor experience">
          <button type="button" className={experience === 'essentials' ? 'is-active' : ''} aria-pressed={experience === 'essentials'} onClick={() => changeExperience('essentials')}>Essentials</button>
          <button type="button" className={experience === 'advanced' ? 'is-active' : ''} aria-pressed={experience === 'advanced'} onClick={() => changeExperience('advanced')}>Advanced</button>
        </div>
        <div className="topbar-actions">
          <span className="autosave-state"><Check size={12} />{dirty ? 'Saving…' : lastSaved}</span>
          {experience === 'advanced' ? <button type="button" className="secondary-action" onClick={enterPreview}><Globe2 size={14} /><span>Preview</span></button> : null}
          <button
            type="button"
            className="primary-action"
            aria-label="Build offline web game"
            onClick={() => buildWebGame()}
            data-testid="build-button"
          >
            <Rocket size={14} />
            <span>Build</span>
          </button>
        </div>
      </header>

      <div className="workbench">
        <nav className="activity-rail" aria-label="Editor panels">
          <IconButton label="Main menu" compact className="compact-menu-trigger" onClick={() => setOpenMenu('file')}><Menu size={16} /></IconButton>
          <IconButton label="Scene hierarchy" active={hierarchyOpen} onClick={() => setHierarchyOpen((open) => { const next = !open; if (next && window.innerWidth <= 960) setAssistantOpen(false); return next; })}><Layers3 size={16} /></IconButton>
          {experience === 'advanced' ? <IconButton label="Project assets" active={bottomOpen && bottomTab === 'assets'} onClick={() => { setBottomOpen(true); setBottomTab('assets'); if (window.innerWidth <= 960) setAssistantOpen(false); }}><Package size={16} /></IconButton> : null}
          {experience === 'advanced' ? <IconButton label="Console" active={bottomOpen && bottomTab === 'console'} onClick={() => { setBottomOpen(true); setBottomTab('console'); if (window.innerWidth <= 960) setAssistantOpen(false); }}><Terminal size={16} /></IconButton> : null}
          {experience === 'advanced' ? <IconButton label="Game authoring" active={gameAuthoringOpen} onClick={() => { setGameAuthoringOpen((open) => !open); setAssistantOpen(false); }}><FileCode2 size={16} /></IconButton> : null}
          <IconButton label="Inspector" active={inspectorOpen && !assistantOpen} onClick={() => setInspectorOpen((open) => { const next = !open || assistantOpen; if (next) setAssistantOpen(false); return next; })}><SlidersHorizontal size={16} /></IconButton>
          <IconButton label={pendingAssistantPlan && !assistantOpen ? 'Studio Assistant · proposal awaiting review' : 'Studio Assistant'} active={assistantOpen} onClick={() => assistantOpen ? closeAssistantPanel() : openAssistantPanel()} testId="assistant-toggle"><span className="agent-trigger-icon"><Sparkles size={16} />{pendingAssistantPlan && !assistantOpen ? <i aria-hidden="true" /> : null}</span></IconButton>
          <span className="activity-spacer" />
          {experience === 'advanced' ? <IconButton label="Command palette" onClick={openCommandPalette}><Command size={16} /></IconButton> : null}
          <IconButton label="World settings" onClick={() => { setSelectedId('scene-root'); setInspectorOpen(true); setAssistantOpen(false); }}><Settings2 size={16} /></IconButton>
        </nav>

        {hierarchyOpen ? (
          <HierarchyPanel
            project={project}
            experience={experience}
            selectedId={selectedId}
            disabled={editingDisabled}
            onSelect={setSelectedId}
            onRename={(id, name) => {
              const node = getNode(projectRef.current, id);
              if (node) updateSceneNode({ ...node, name }, 'Rename object');
            }}
            onToggleVisible={(id) => {
              const node = getNode(projectRef.current, id);
              if (node) updateSceneNode({ ...node, visible: !node.visible }, `Toggle ${node.name} visibility`);
            }}
            onToggleLock={(id) => {
              const node = getNode(projectRef.current, id);
              if (node) updateSceneNode({ ...node, locked: !node.locked }, `Toggle ${node.name} lock`);
            }}
            onAdd={() => setAddMenuOpen((open) => !open)}
          />
        ) : null}

        <main className="workspace-main">
          <div
            className={`workspace-editor-surface ${gameAuthoringOpen ? 'is-covered' : ''}`}
            aria-hidden={gameAuthoringOpen || undefined}
            inert={gameAuthoringOpen || undefined}
          >
            <>
          <section className={`viewport-shell ${mode !== 'edit' ? 'is-running' : ''}`} aria-label="3D viewport">
            <div className="viewport-toolbar">
              <div className="toolbar-group add-object-wrap">
                <button type="button" className="toolbar-add" aria-label="Create object" disabled={editingDisabled} onClick={() => setAddMenuOpen((open) => !open)} data-testid="add-object"><Plus size={14} /><span>Create</span><ChevronDown size={11} /></button>
                {addMenuOpen ? (
                  <div className="viewport-add-menu">
                    <span>From file</span>
                    <button type="button" data-testid="import-model" onClick={() => openModelPicker()}><Upload size={15} /><span>Import 3D model…</span></button>
                    {project.assets.length ? <span>My models</span> : null}
                    {project.assets.slice(-5).reverse().map((asset) => <button type="button" key={asset.id} data-model-asset-id={asset.id} onClick={() => activateAsset(studioAssets.find((entry) => entry.id === asset.id)!)}><Boxes size={15} /><span>{asset.name}</span></button>)}
                    <span>Scene</span>
                    <button type="button" onClick={createEmptyGroup}><Layers3 size={15} /><span>Empty Group</span></button>
                    <span>3D Object</span>
                    {primitives.map((primitive) => <button type="button" key={primitive} onClick={() => createPrimitive(primitive)} data-testid={`create-${primitive}`}><PrimitiveIcon primitive={primitive} /><span>{primitiveLabel(primitive)}</span></button>)}
                  </div>
                ) : null}
              </div>
              <span className="toolbar-divider" />
              <div className="toolbar-group transform-tools" aria-label="Transform tools">
                <IconButton label="Select · Q" active={tool === 'select'} disabled={editingDisabled} onClick={() => setTool('select')} testId="tool-select"><MousePointer2 size={14} /></IconButton>
                <IconButton label="Move · W" active={tool === 'translate'} disabled={editingDisabled} onClick={() => setTool('translate')} testId="tool-translate"><Move3d size={14} /></IconButton>
                <IconButton label="Rotate · E" active={tool === 'rotate'} disabled={editingDisabled} onClick={() => setTool('rotate')} testId="tool-rotate"><Rotate3d size={14} /></IconButton>
                <IconButton label="Scale · R" active={tool === 'scale'} disabled={editingDisabled} onClick={() => setTool('scale')} testId="tool-scale"><Scaling size={14} /></IconButton>
              </div>
              {experience === 'advanced' ? (
                <>
                  <span className="toolbar-divider" />
                  <button type="button" className="toolbar-text-button" disabled={editingDisabled} onClick={() => setSpace((current) => current === 'world' ? 'local' : 'world')}>{space === 'world' ? 'Global' : 'Local'}<ChevronDown size={11} /></button>
                  <IconButton label="Toggle snapping" active={snap} disabled={editingDisabled} onClick={() => setSnap((value) => !value)}><Magnet size={14} /></IconButton>
                  <div className="viewport-tabs" role="tablist" aria-label="Viewport mode">
                    <button type="button" role="tab" aria-selected={viewMode === 'scene'} className={viewMode === 'scene' ? 'is-active' : ''} onClick={() => setViewMode('scene')}>Scene</button>
                    <button type="button" role="tab" aria-selected={viewMode === 'game'} className={viewMode === 'game' ? 'is-active' : ''} onClick={() => setViewMode('game')}>Game</button>
                  </div>
                </>
              ) : null}
              <div className="viewport-toolbar-right">
                {experience === 'advanced' ? <button type="button" className="toolbar-text-button camera-view-button" onClick={() => engineRef.current?.setCameraView('perspective')}><Camera size={13} /> Perspective<ChevronDown size={11} /></button> : null}
                {experience === 'advanced' ? <IconButton label="Toggle grid" active={gridVisible} disabled={viewMode === 'game'} onClick={() => setGridVisible((visible) => !visible)}><Grid3X3 size={14} /></IconButton> : null}
                {experience === 'advanced' ? <IconButton label="Frame selected · F" disabled={!selectedId || viewMode === 'game'} onClick={() => engineRef.current?.frameSelection()}><Crosshair size={14} /></IconButton> : null}
                <IconButton label="Fullscreen viewport" onClick={toggleFullscreen}><Maximize2 size={14} /></IconButton>
              </div>
            </div>
            <div className="viewport-canvas-wrap" ref={viewportRef}>
              <canvas ref={canvasRef} className="studio-canvas" aria-label="ThreeJS scene viewport" data-testid="scene-canvas" />
              <div className="viewport-context">
                <span>{viewMode === 'scene' ? 'Scene View' : 'Game Camera'}</span>
                <i />
                <span>{mode === 'edit' ? 'Edit mode' : mode === 'paused' ? 'Paused' : 'Live'}</span>
              </div>
              {modelImportNotice ? (
                <section className={`model-import-status is-${modelImportNotice.state}`} data-testid="model-import-status" data-asset-status={modelImportNotice.state}>
                  <span className="model-status-icon">{modelImportNotice.state === 'loading' ? <span className="model-status-spinner" /> : <Triangle size={14} />}</span>
                  <span><strong>{modelImportNotice.state === 'loading' ? 'Preparing model' : 'This model could not be imported'}</strong><small>{modelImportNotice.message}</small></span>
                  {modelImportNotice.state === 'error' ? <button type="button" onClick={() => openModelPicker()}>Choose another file</button> : null}
                  {modelImportNotice.state === 'error' ? <button type="button" className="model-status-close" aria-label="Dismiss model import error" onClick={() => setModelImportNotice(null)}><X size={13} /></button> : null}
                </section>
              ) : modelIssue ? (
                <section className="model-import-status is-missing" data-testid="model-import-status" data-asset-status={assetStatuses[modelIssue.id]?.state}>
                  <span className="model-status-icon"><Triangle size={14} /></span>
                  <span><strong>{modelIssue.name} needs its source file</strong><small>{assetStatuses[modelIssue.id]?.message ?? 'The model is still in your scene, but its local file is missing.'}</small></span>
                  <button type="button" data-testid="model-relink" onClick={() => openModelPicker(modelIssue.id)}>Relink model</button>
                </section>
              ) : null}
              {mode !== 'edit' && experience === 'advanced' ? <div className="playing-badge"><span /><strong>{mode === 'paused' ? 'PAUSED' : 'PLAYING'}</strong></div> : null}
              {mode !== 'edit' && experience === 'essentials' ? <div className="essential-runtime-banner" data-testid="runtime-banner"><span className="preview-live-dot" /><strong>Playing</strong><span>{movementControlsHint(project)} · Esc to return</span><button type="button" onClick={stopPlay}>Stop</button></div> : null}
              {viewMode === 'scene' && experience === 'advanced' ? (
                <div className="orientation-widget" aria-label="Camera orientation">
                  <button type="button" className="axis-y" aria-label="Top view" onClick={() => engineRef.current?.setCameraView('top')}>Y</button>
                  <button type="button" className="axis-x" aria-label="Right view" onClick={() => engineRef.current?.setCameraView('right')}>X</button>
                  <button type="button" className="axis-z" aria-label="Front view" onClick={() => engineRef.current?.setCameraView('front')}>Z</button>
                  <button type="button" className="axis-center" aria-label="Perspective view" onClick={() => engineRef.current?.setCameraView('perspective')} />
                </div>
              ) : null}
              {experience === 'advanced' ? <div className="viewport-stats"><span>{Math.round(stats.fps)} FPS</span><span>{stats.drawCalls} calls</span><span>{stats.triangles.toLocaleString()} tris</span></div> : null}
              {viewMode === 'game' && mode === 'edit' && experience === 'advanced' ? <div className="game-view-hint"><Camera size={13} /> Main Camera preview</div> : null}
              {experience === 'essentials' && mode === 'edit' && !quickStart.dismissed && !assistantOpen ? (
                <section className="quick-start-card" data-testid="quick-start" data-step={quickStartStep} aria-label="Quick Start">
                  <header>
                    <span className="quick-start-icon"><Sparkles size={15} /></span>
                    <span><strong>Quick Start</strong><small>{quickStartStep === 'complete' ? 'Ready to build' : `Step ${quickStartStep === 'add' ? 1 : quickStartStep === 'style' ? 2 : 3} of 3`}</small></span>
                    <button type="button" aria-label="Dismiss Quick Start" data-testid="quick-start-dismiss" onClick={() => setQuickStart((current) => ({ ...current, dismissed: true }))}><X size={13} /></button>
                  </header>
                  <div className="quick-start-progress" aria-hidden="true"><i className={quickStart.added ? 'is-done' : 'is-current'} /><i className={quickStart.styled ? 'is-done' : quickStart.added ? 'is-current' : ''} /><i className={quickStart.played ? 'is-done' : quickStart.styled ? 'is-current' : ''} /></div>
                  {quickStartStep === 'add' ? <><strong>Add your first object</strong><p>Start with a shape or bring in a self-contained GLB model.</p><button type="button" className="quick-start-action" onClick={() => setAddMenuOpen(true)}>Choose a shape</button><button type="button" className="quick-start-secondary" onClick={() => openModelPicker()}>Import a 3D model</button></> : null}
                  {quickStartStep === 'style' ? selectedNode?.kind === 'model' ? <><strong>Place your model</strong><p>Use Transform or Sizing in Details to fit the model into your world.</p><button type="button" className="quick-start-action" onClick={() => setInspectorOpen(true)}>Open model controls</button></> : <><strong>Make it yours</strong><p>Use Appearance in Details to change the selected shape’s color.</p><button type="button" className="quick-start-action" onClick={() => setInspectorOpen(true)}>Open color controls</button></> : null}
                  {quickStartStep === 'play' ? <><strong>Try your game</strong><p>Play runs every Motion component without changing your authored scene.</p><button type="button" className="quick-start-action" disabled={runtimePreparing} onClick={startPlay}><Play size={12} fill="currentColor" /> {runtimePreparing ? 'Preparing…' : 'Play the game'}</button></> : null}
                  {quickStartStep === 'complete' ? <><strong>Your first scene works</strong><p>Keep editing, switch to Advanced, or build a standalone web game.</p><button type="button" className="quick-start-action" onClick={() => buildWebGame()}><Rocket size={12} /> Build web game</button><button type="button" className="quick-start-secondary" onClick={() => setQuickStart((current) => ({ ...current, dismissed: true }))}>Continue editing</button></> : null}
                </section>
              ) : null}
            </div>
          </section>
          {experience === 'advanced' && bottomOpen ? (
            <BottomDock
              tab={bottomTab}
              onTabChange={setBottomTab}
              assets={studioAssets}
              selectedNode={selectedNode}
              assetStatuses={assetStatuses}
              entries={consoleEntries}
              onActivateAsset={activateAsset}
              onImportModel={() => openModelPicker()}
              onRelinkModel={openModelPicker}
              onClearConsole={() => setConsoleEntries([])}
              onClose={() => setBottomOpen(false)}
            />
          ) : null}
            </>
          </div>
          {gameAuthoringOpen ? (
            <div className="game-authoring-layer">
              <GameAuthoringWorkspace
                project={gameProjectRef.current}
                revision={projectRevision}
                readOnly={editingDisabled}
                onCommitProject={commitGameProject}
                onBuild={buildWebGame}
                onPlay={startPlay}
                onClose={() => setGameAuthoringOpen(false)}
              />
            </div>
          ) : null}
        </main>

        {assistantOpen ? (
          <AgentPanel
            open
            experience={experience}
            capabilityCount={AGENT_CAPABILITY_MANIFEST.tools.length + AGENT_GAME_CAPABILITY_MANIFEST.tools.length}
            revision={projectRevision}
            sceneName={project.sceneName}
            selectedName={selectedNode?.name}
            messages={assistantMessages}
            pendingPlan={pendingAssistantPlan}
            busy={assistantBusy}
            canApply={Boolean(pendingAssistantPlan && pendingAssistantPlan.baseRevision === projectRevision && (!(pendingAssistantPlan.batch || pendingAssistantPlan.gameResult?.changed) || mode === 'edit'))}
            applyBlockedReason={pendingAssistantPlan?.baseRevision !== projectRevision
              ? 'The project changed after this proposal was prepared. Discard it and request an updated plan.'
              : (pendingAssistantPlan?.batch || pendingAssistantPlan?.gameResult?.changed) && mode !== 'edit'
                ? 'Stop Play mode before applying authored scene changes.'
                : undefined}
            applyBlockedReasonCode={pendingAssistantPlan?.baseRevision !== projectRevision ? 'stale' : (pendingAssistantPlan?.batch || pendingAssistantPlan?.gameResult?.changed) && mode !== 'edit' ? 'play' : undefined}
            canUndoLast={canUndoLastAssistantPlan}
            onClose={closeAssistantPanel}
            onSubmit={submitAssistantPrompt}
            onApplyPlan={() => { void applyPendingAssistantPlan(); }}
            onDiscardPlan={discardPendingAssistantPlan}
            onUndoLast={undoLastAssistantPlan}
          />
        ) : inspectorOpen ? <InspectorPanel node={selectedNode} project={project} experience={experience} disabled={editingDisabled} assetStatuses={assetStatuses} onUpdate={updateSceneNode} onUpdateSettings={updateProjectSettings} onUpdateInputActions={updateInputActions} onManageInputActions={() => setSelectedId('scene-root')} onRelinkModel={openModelPicker} onDelete={deleteSelected} /> : null}
      </div>

      <footer className="statusbar">
        <div><span className="status-ready-dot" /><strong>Ready</strong><span>{mode === 'edit' ? 'Authoring' : 'Runtime'} · WebGL 2</span></div>
        <div className="statusbar-center"><span>{selectedNode ? selectedNode.name : 'No selection'}</span>{selectedNode ? <code>{selectedNode.kind}{selectedNode.primitive ? ` · ${selectedNode.primitive}` : ''}</code> : null}</div>
        <div><span>{project.nodes.length} objects</span>{experience === 'advanced' ? <><span>{stats.geometries} meshes</span><span>{stats.frameMs.toFixed(1)} ms</span><span>DPR {Math.min(window.devicePixelRatio, 2).toFixed(1)}×</span></> : <span>{dirty ? 'Saving changes…' : 'All changes saved'}</span>}</div>
      </footer>

      {previewMode ? (
        <div className="preview-chrome">
          <div><span className="preview-live-dot" /><strong>Game Preview</strong><span>{project.sceneName}</span></div>
          <button type="button" onClick={stopPlay}><X size={14} /> Exit Preview <kbd>Esc</kbd></button>
        </div>
      ) : null}

      <Dialog
        open={commandPaletteOpen}
        onOpenChange={(open) => {
          setCommandPaletteOpen(open);
          if (!open) setCommandQuery('');
        }}
      >
        <DialogContent
          className="command-backdrop !max-w-none !translate-x-0 !translate-y-0 !gap-0 !rounded-none !ring-0"
          showCloseButton={false}
          finalFocus={() => commandPaletteReturnFocusRef.current}
          aria-label="Command palette"
          style={{
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            display: 'flex',
            width: 'auto',
            maxWidth: 'none',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: 'max(10vh, 70px) 0 0',
            background: 'rgba(4, 7, 11, 0.62)',
            backdropFilter: 'blur(5px)',
            transform: 'none',
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCommandPaletteOpen(false);
          }}
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <CommandMenu
            className="command-palette !h-auto"
            style={{ width: 'min(560px, calc(100vw - 28px))' }}
            shouldFilter={false}
            loop
          >
            <div className="command-search [&_[data-slot=input-group-addon]]:hidden">
              <Command size={17} />
              <CommandInput
                autoFocus
                value={commandQuery}
                onValueChange={setCommandQuery}
                placeholder="Type a command or search…"
              />
              <kbd>Esc</kbd>
            </div>
            <CommandList className="command-list max-h-[360px]">
              {filteredCommands.map((action) => (
                <CommandItem
                  key={action.id}
                  value={action.label}
                  disabled={action.disabled}
                  className="!grid min-h-[42px] !grid-cols-[31px_1fr_auto] gap-2 rounded-[6px] px-[9px] py-1 [&>svg:last-child]:hidden"
                  onSelect={() => runCommand(action)}
                >
                  <span className="command-icon">{action.icon}</span>
                  <span className="flex min-w-0 flex-col gap-0.5"><strong>{action.label}</strong><small>{action.group}</small></span>
                  {action.shortcut ? <CommandShortcut><kbd>{action.shortcut}</kbd></CommandShortcut> : null}
                </CommandItem>
              ))}
              <CommandEmpty className="command-empty"><Command size={22} /><span>No commands found</span></CommandEmpty>
            </CommandList>
            <footer><span><kbd>↵</kbd> Run</span><span><kbd>↑↓</kbd> Navigate</span><span><kbd>Esc</kbd> Close</span></footer>
          </CommandMenu>
        </DialogContent>
      </Dialog>

      {toast ? <div className="toast" role="status"><span className="toast-icon"><Check size={13} /></span><span>{toast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={13} /></button></div> : null}

      <input
        ref={importInputRef}
        type="file"
        accept=".json,.tjsstudio"
        hidden
        data-testid="project-file-input"
        onChange={(event) => {
          void handleImport(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={modelInputRef}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        hidden
        data-testid="model-file-input"
        onChange={(event) => {
          const relinkAssetId = relinkAssetIdRef.current;
          relinkAssetIdRef.current = null;
          void handleModelImport(event.target.files?.[0], relinkAssetId);
          event.currentTarget.value = '';
        }}
      />
      {!bottomOpen && !assistantOpen ? <>
        <div className="mobile-recommendation"><Sparkles size={13} /><span>Desktop layout recommended for precise scene editing</span></div>
        <button type="button" className="mobile-panel-trigger mobile-left" onClick={() => toggleMobilePanel('hierarchy')} aria-label="Toggle objects"><Layers3 size={16} /></button>
        <button type="button" className="mobile-panel-trigger mobile-right" onClick={() => toggleMobilePanel('inspector')} aria-label="Toggle details"><SlidersHorizontal size={16} /></button>
        {experience === 'advanced' ? <button type="button" className="mobile-panel-trigger mobile-bottom" onClick={() => toggleMobilePanel('bottom')} aria-label="Toggle assets"><Package size={16} /></button> : null}
      </> : null}
      {!bottomOpen && !assistantOpen && !previewMode ? <button type="button" className="mobile-agent-trigger" onClick={openAssistantPanel} aria-label={pendingAssistantPlan ? 'Open Studio Assistant · proposal awaiting review' : 'Open Studio Assistant'} data-testid="assistant-mobile-trigger"><span className="agent-trigger-icon"><Sparkles size={18} />{pendingAssistantPlan ? <i aria-hidden="true" /> : null}</span></button> : null}
    </div>
  );
}
