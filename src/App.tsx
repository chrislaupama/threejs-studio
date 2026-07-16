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
import { BottomDock, HierarchyPanel, IconButton, InspectorPanel, primitiveLabel } from './editor/components';
import {
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
  ConsoleEntry,
  EditorMode,
  EditorTool,
  PrimitiveType,
  ProjectDocument,
  ProjectSettings,
  RendererStats,
  SceneNode,
  StudioAsset,
  ViewMode,
} from './editor/types';
import { ViewportEngine } from './editor/ViewportEngine';

const STORAGE_KEY = 'threejs-game-studio:project:v2';
const LEGACY_STORAGE_KEY = 'threejs-game-studio:project:v1';
const EXPERIENCE_KEY = 'threejs-game-studio:experience';
const QUICK_START_KEY = 'threejs-game-studio:quick-start';
const MAX_HISTORY = 60;

type ExperienceLevel = 'essentials' | 'advanced';
type QuickStartStep = 'add' | 'style' | 'play' | 'complete';

interface QuickStartProgress {
  added: boolean;
  styled: boolean;
  played: boolean;
  dismissed: boolean;
}

interface HistoryEntry {
  document: ProjectDocument;
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

function loadInitialProject() {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const result = loadProjectDocument(JSON.parse(saved) as unknown);
        if (result.ok) {
          if (key === LEGACY_STORAGE_KEY) localStorage.setItem(STORAGE_KEY, JSON.stringify(result.project));
          return result.project;
        }
      }
    } catch {
      // Try the next recovery source before falling back to the starter scene.
    }
  }
  return createStarterProject();
}

function loadExperience(): ExperienceLevel {
  try {
    return localStorage.getItem(EXPERIENCE_KEY) === 'advanced' ? 'advanced' : 'essentials';
  } catch {
    return 'essentials';
  }
}

function loadQuickStart(): QuickStartProgress {
  try {
    const value = JSON.parse(localStorage.getItem(QUICK_START_KEY) ?? '{}') as Partial<QuickStartProgress>;
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

function MenuItem({ icon, label, shortcut, disabled, danger, onClick }: MenuItemProps) {
  return (
    <button type="button" className={`menu-item ${danger ? 'is-danger' : ''}`} disabled={disabled} onClick={onClick}>
      <span className="menu-item-icon">{icon}</span>
      <span>{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
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
  const [project, setProject] = useState<ProjectDocument>(loadInitialProject);
  const projectRef = useRef(project);
  const [experience, setExperience] = useState<ExperienceLevel>(loadExperience);
  const [quickStart, setQuickStart] = useState<QuickStartProgress>(loadQuickStart);
  const [selectedId, setSelectedId] = useState<string | null>('player-core');
  const [tool, setTool] = useState<EditorTool>('translate');
  const [mode, setMode] = useState<EditorMode>('edit');
  const modeRef = useRef<EditorMode>('edit');
  const [viewMode, setViewMode] = useState<ViewMode>('scene');
  const [space, setSpace] = useState<'local' | 'world'>('world');
  const [snap, setSnap] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [hierarchyOpen, setHierarchyOpen] = useState(() => window.innerWidth > 960);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 960);
  const [bottomOpen, setBottomOpen] = useState(() => experience === 'advanced' && window.innerWidth > 720);
  const [bottomTab, setBottomTab] = useState<'assets' | 'console'>('assets');
  const [previewMode, setPreviewMode] = useState(false);
  const [openMenu, setOpenMenu] = useState<'file' | 'edit' | 'object' | 'window' | 'help' | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState('Loaded');
  const [toast, setToast] = useState<string | null>('Starter scene ready — add a shape or adjust Player Core.');
  const [stats, setStats] = useState<RendererStats>({ fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 });
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([
    { id: 'boot-1', level: 'success', message: 'Editor runtime initialized', time: nowLabel() },
    { id: 'boot-2', level: 'info', message: 'MainWorld loaded · 13 objects', time: nowLabel() },
    { id: 'boot-3', level: 'info', message: 'WebGL renderer ready · ACES tone mapping · soft shadows', time: nowLabel() },
  ]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ViewportEngine | null>(null);
  const dragStartRef = useRef<ProjectDocument | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedNode = getNode(project, selectedId);
  const editingDisabled = mode !== 'edit';
  const quickStartStep = getQuickStartStep(quickStart);

  const addLog = useCallback((message: string, level: ConsoleEntry['level'] = 'info') => {
    setConsoleEntries((entries) => [
      ...entries,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, level, message, time: nowLabel() },
    ].slice(-120));
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
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

  const commitProject = useCallback((next: ProjectDocument, label: string) => {
    if (modeRef.current !== 'edit') {
      showToast('Stop Play mode before editing the scene');
      return false;
    }
    const previous = cloneProject(projectRef.current);
    setUndoStack((entries) => [...entries, { document: previous, label }].slice(-MAX_HISTORY));
    setRedoStack([]);
    projectRef.current = next;
    setProject(next);
    setDirty(true);
    addLog(label);
    return true;
  }, [addLog, showToast]);

  const updateSceneNode = useCallback((node: SceneNode, label: string) => {
    if (!commitProject(updateNode(projectRef.current, node.id, () => node), label)) return;
    if (label === 'Change material color' || label.startsWith('Apply ')) markQuickStart('styled');
  }, [commitProject, markQuickStart]);

  const updateProjectSettings = useCallback((settings: ProjectSettings, label: string) => {
    const next = cloneProject(projectRef.current);
    next.settings = settings;
    next.updatedAt = new Date().toISOString();
    commitProject(next, label);
  }, [commitProject]);

  const undo = useCallback(() => {
    if (modeRef.current !== 'edit') return;
    const entry = undoStack.at(-1);
    if (!entry) return;
    const current = cloneProject(projectRef.current);
    const restored = cloneProject(entry.document);
    setUndoStack((entries) => entries.slice(0, -1));
    setRedoStack((entries) => [...entries, { document: current, label: entry.label }].slice(-MAX_HISTORY));
    projectRef.current = restored;
    setProject(restored);
    setDirty(true);
    if (selectedId && !getNode(restored, selectedId)) setSelectedId(null);
    addLog(`Undo · ${entry.label}`);
  }, [addLog, selectedId, undoStack]);

  const redo = useCallback(() => {
    if (modeRef.current !== 'edit') return;
    const entry = redoStack.at(-1);
    if (!entry) return;
    const current = cloneProject(projectRef.current);
    const restored = cloneProject(entry.document);
    setRedoStack((entries) => entries.slice(0, -1));
    setUndoStack((entries) => [...entries, { document: current, label: entry.label }].slice(-MAX_HISTORY));
    projectRef.current = restored;
    setProject(restored);
    setDirty(true);
    addLog(`Redo · ${entry.label}`);
  }, [addLog, redoStack]);

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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projectRef.current));
      setDirty(false);
      setLastSaved('Saved just now');
      if (announce) {
        addLog('Project saved to this browser', 'success');
        showToast('Project saved locally');
      }
    } catch {
      addLog('Browser storage is unavailable; export a project file instead', 'warning');
      showToast('Could not save locally');
    }
  }, [addLog, showToast]);

  const exportProject = useCallback(() => {
    const current = projectRef.current;
    downloadTextFile(JSON.stringify(current, null, 2), `${safeFilename(current.name)}.tjsstudio.json`);
    addLog('Editable project package exported', 'success');
    showToast('Project file exported');
  }, [addLog, showToast]);

  const buildWebGame = useCallback(() => {
    const current = projectRef.current;
    downloadTextFile(buildRuntimeHtml(current), `${safeFilename(current.name)}-web.html`, 'text/html');
    addLog('Standalone web build generated', 'success');
    showToast('Web game built · single HTML file');
  }, [addLog, showToast]);

  const startPlay = useCallback(() => {
    if (modeRef.current !== 'edit') return;
    modeRef.current = 'play';
    setMode('play');
    setViewMode('game');
    markQuickStart('played');
    addLog('Entered Play mode', 'success');
  }, [addLog, markQuickStart]);

  const stopPlay = useCallback(() => {
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

  const enterPreview = useCallback(() => {
    if (modeRef.current !== 'edit') return;
    setPreviewMode(true);
    setViewMode('game');
    modeRef.current = 'play';
    setMode('play');
    markQuickStart('played');
    addLog('Fullscreen game preview started', 'success');
  }, [addLog, markQuickStart]);

  const activateAsset = useCallback((asset: StudioAsset) => {
    if (modeRef.current !== 'edit') return;
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

  const handleImport = useCallback(async (file: File | undefined) => {
    if (!file || modeRef.current !== 'edit') return;
    try {
      const value: unknown = JSON.parse(await file.text());
      const result = loadProjectDocument(value);
      if (!result.ok) throw new Error(result.errors[0] ?? 'Unsupported project schema');
      if (!commitProject(result.project, `Import ${file.name}`)) return;
      setSelectedId(result.project.nodes[0]?.id ?? null);
      addLog(`Imported ${file.name}`, 'success');
      showToast(result.warnings.length ? `Project imported · ${result.warnings[0]}` : 'Project imported successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown import error';
      addLog(`Import failed · ${message}`, 'warning');
      showToast(`Import failed · ${message}`);
    }
  }, [addLog, commitProject, showToast]);

  const resetStarter = useCallback(() => {
    if (modeRef.current !== 'edit') return;
    const next = createStarterProject();
    if (!commitProject(next, 'Create new starter project')) return;
    setSelectedId('player-core');
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
        if (before) {
          setUndoStack((entries) => [...entries, { document: before, label: 'Transform object' }].slice(-MAX_HISTORY));
          setRedoStack([]);
          dragStartRef.current = null;
          addLog('Transform object');
        }
      },
      onStats: setStats,
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [addLog]);

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
      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
        setCommandQuery('');
        setCommandIndex(0);
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
      if (isTyping || command || editingDisabled) return;
      if (event.key === 'q' || event.key === 'Q') setTool('select');
      if (event.key === 'w' || event.key === 'W') setTool('translate');
      if (event.key === 'e' || event.key === 'E') setTool('rotate');
      if (event.key === 'r' || event.key === 'R') setTool('scale');
      if (event.key === 'f' || event.key === 'F') engineRef.current?.frameSelection();
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [buildWebGame, commandPaletteOpen, deleteSelected, duplicateSelected, editingDisabled, redo, resetStarter, saveProject, startPlay, stopPlay, undo]);

  const commands = useMemo<CommandAction[]>(() => [
    { id: 'save', label: 'Save project', group: 'Project', shortcut: '⌘S', icon: <Save size={15} />, run: () => saveProject() },
    { id: 'export', label: 'Export editable project', group: 'Project', icon: <FileJson size={15} />, run: exportProject },
    { id: 'build', label: 'Build web game', group: 'Project', shortcut: '⌘B', icon: <Rocket size={15} />, run: buildWebGame },
    { id: 'play', label: mode === 'edit' ? 'Enter Play mode' : 'Stop Play mode', group: 'Runtime', shortcut: '⌘P', icon: mode === 'edit' ? <Play size={15} /> : <Square size={14} />, run: mode === 'edit' ? startPlay : stopPlay },
    { id: 'preview', label: 'Open clean game preview', group: 'Runtime', icon: <Globe2 size={15} />, disabled: editingDisabled, run: enterPreview },
    { id: 'frame', label: 'Frame selected object', group: 'Viewport', shortcut: 'F', icon: <Crosshair size={15} />, disabled: editingDisabled, run: () => engineRef.current?.frameSelection() },
    { id: 'box', label: 'Create Box', group: 'Create', icon: <Box size={15} />, disabled: editingDisabled, run: () => createPrimitive('box') },
    { id: 'sphere', label: 'Create Sphere', group: 'Create', icon: <Circle size={15} />, disabled: editingDisabled, run: () => createPrimitive('sphere') },
    { id: 'group', label: 'Create Empty Group', group: 'Create', icon: <Layers3 size={15} />, disabled: editingDisabled, run: createEmptyGroup },
    { id: 'hierarchy', label: 'Toggle Hierarchy panel', group: 'Window', icon: <PanelLeftOpen size={15} />, run: () => setHierarchyOpen((open) => !open) },
    { id: 'inspector', label: 'Toggle Inspector panel', group: 'Window', icon: <PanelRightOpen size={15} />, run: () => setInspectorOpen((open) => !open) },
    { id: 'project-panel', label: 'Toggle Project panel', group: 'Window', icon: <PanelBottomOpen size={15} />, run: () => setBottomOpen((open) => !open) },
  ], [buildWebGame, createEmptyGroup, createPrimitive, editingDisabled, enterPreview, exportProject, mode, saveProject, startPlay, stopPlay]);

  const filteredCommands = commands.filter((action) => action.label.toLowerCase().includes(commandQuery.toLowerCase()));
  const runCommand = (action: CommandAction) => {
    if (action.disabled) return;
    setCommandPaletteOpen(false);
    setCommandQuery('');
    action.run();
  };

  useEffect(() => setCommandIndex(0), [commandPaletteOpen, commandQuery]);

  const closeMenus = () => {
    setOpenMenu(null);
    setAddMenuOpen(false);
  };

  const toggleMenu = (menu: NonNullable<typeof openMenu>) => {
    setOpenMenu((current) => current === menu ? null : menu);
    setAddMenuOpen(false);
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

  const toggleMobilePanel = (panel: 'hierarchy' | 'inspector' | 'bottom') => {
    if (panel === 'hierarchy') {
      const next = !hierarchyOpen;
      setHierarchyOpen(next);
      if (next) { setInspectorOpen(false); setBottomOpen(false); }
    } else if (panel === 'inspector') {
      const next = !inspectorOpen;
      setInspectorOpen(next);
      if (next) { setHierarchyOpen(false); setBottomOpen(false); }
    } else {
      const next = !bottomOpen;
      setBottomOpen(next);
      if (next) { setHierarchyOpen(false); setInspectorOpen(false); }
    }
  };

  return (
    <div
      className={`studio-app experience-${experience} mode-${mode} ${previewMode ? 'preview-mode' : ''}`}
      data-testid="studio-app"
      data-experience={experience}
      data-step={quickStartStep}
      data-runtime={mode === 'edit' ? 'edit' : 'playing'}
    >
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Boxes size={18} strokeWidth={1.8} /></span>
          <span className="brand-copy"><strong>ThreeJS</strong><span>Game Studio</span></span>
        </div>
        <nav className="app-menu-bar" aria-label="Application menu">
          {visibleMenus.map((menu) => (
            <button type="button" key={menu} className={openMenu === menu ? 'is-active' : ''} onClick={() => toggleMenu(menu)}>{menu[0].toUpperCase() + menu.slice(1)}</button>
          ))}
        </nav>
        <div className="project-crumb">
          <span className={`save-state-dot ${dirty ? 'is-dirty' : ''}`} />
          <strong>{project.name}</strong>
          <span>/</span>
          <span>{project.sceneName}</span>
          {experience === 'advanced' ? <ChevronDown size={12} /> : null}
        </div>
        <div className="history-actions">
          <IconButton label={undoStack.length ? `Undo ${undoStack.at(-1)?.label}` : 'Nothing to undo'} compact disabled={!undoStack.length || editingDisabled} onClick={undo}><Undo2 size={14} /></IconButton>
          <IconButton label={redoStack.length ? `Redo ${redoStack.at(-1)?.label}` : 'Nothing to redo'} compact disabled={!redoStack.length || editingDisabled} onClick={redo}><Redo2 size={14} /></IconButton>
          <IconButton label="Save project" compact onClick={() => saveProject()} testId="save-project"><Save size={14} /></IconButton>
        </div>
        <div className="play-controls" aria-label="Play controls">
          {experience === 'essentials' ? (
            mode === 'edit'
              ? <button type="button" className="essential-play" onClick={startPlay} data-testid="play-button"><Play size={13} fill="currentColor" /> Play</button>
              : <button type="button" className="essential-stop" onClick={stopPlay} data-testid="stop-button"><Square size={11} fill="currentColor" /> Stop</button>
          ) : (
            <>
              <IconButton label="Play" active={mode === 'play'} disabled={mode !== 'edit'} onClick={startPlay} testId="play-button"><Play size={14} fill={mode === 'play' ? 'currentColor' : 'none'} /></IconButton>
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
          <button type="button" className="primary-action" onClick={buildWebGame} data-testid="build-button"><Rocket size={14} /><span>Build</span></button>
        </div>
      </header>

      {openMenu ? <button type="button" className="menu-scrim" aria-label="Close menu" onClick={closeMenus} /> : null}
      {openMenu === 'file' ? (
        <div className="app-menu-popover menu-file">
          <span className="menu-heading">Project</span>
          <MenuItem icon={<Sparkles size={14} />} label="New starter project" shortcut="⌘N" disabled={editingDisabled} onClick={() => { resetStarter(); closeMenus(); }} />
          <MenuItem icon={<FolderOpen size={14} />} label="Open project…" shortcut="⌘O" disabled={editingDisabled} onClick={() => { importInputRef.current?.click(); closeMenus(); }} />
          <MenuItem icon={<Save size={14} />} label="Save" shortcut="⌘S" onClick={() => { saveProject(); closeMenus(); }} />
          <div className="menu-separator" />
          <MenuItem icon={<FileJson size={14} />} label="Export editable project" onClick={() => { exportProject(); closeMenus(); }} />
          <MenuItem icon={<Rocket size={14} />} label="Build web game" shortcut="⌘B" onClick={() => { buildWebGame(); closeMenus(); }} />
        </div>
      ) : null}
      {openMenu === 'edit' ? (
        <div className="app-menu-popover menu-edit">
          <MenuItem icon={<Undo2 size={14} />} label="Undo" shortcut="⌘Z" disabled={!undoStack.length || editingDisabled} onClick={() => { undo(); closeMenus(); }} />
          <MenuItem icon={<Redo2 size={14} />} label="Redo" shortcut="⇧⌘Z" disabled={!redoStack.length || editingDisabled} onClick={() => { redo(); closeMenus(); }} />
          <div className="menu-separator" />
          <MenuItem icon={<Copy size={14} />} label="Duplicate" shortcut="⌘D" disabled={!selectedId || editingDisabled} onClick={() => { duplicateSelected(); closeMenus(); }} />
          <MenuItem icon={<Trash2 size={14} />} label="Delete" shortcut="⌫" danger disabled={!selectedId || selectedId === 'scene-root' || editingDisabled} onClick={() => { deleteSelected(); closeMenus(); }} />
        </div>
      ) : null}
      {openMenu === 'object' ? (
        <div className="app-menu-popover menu-object">
          <MenuItem icon={<Layers3 size={14} />} label="Empty Group" disabled={editingDisabled} onClick={() => { createEmptyGroup(); closeMenus(); }} />
          <div className="menu-separator" />
          <span className="menu-heading">3D Object</span>
          {primitives.map((primitive) => <MenuItem key={primitive} icon={<PrimitiveIcon primitive={primitive} />} label={primitiveLabel(primitive)} disabled={editingDisabled} onClick={() => { createPrimitive(primitive); closeMenus(); }} />)}
        </div>
      ) : null}
      {openMenu === 'window' ? (
        <div className="app-menu-popover menu-window">
          <MenuItem icon={<PanelLeftOpen size={14} />} label={`${hierarchyOpen ? 'Hide' : 'Show'} Hierarchy`} shortcut="⌘1" onClick={() => { setHierarchyOpen((open) => !open); closeMenus(); }} />
          <MenuItem icon={<PanelRightOpen size={14} />} label={`${inspectorOpen ? 'Hide' : 'Show'} Inspector`} shortcut="⌘2" onClick={() => { setInspectorOpen((open) => !open); closeMenus(); }} />
          <MenuItem icon={<PanelBottomOpen size={14} />} label={`${bottomOpen ? 'Hide' : 'Show'} Project`} shortcut="⌘3" onClick={() => { setBottomOpen((open) => !open); closeMenus(); }} />
          <div className="menu-separator" />
          <MenuItem icon={<Command size={14} />} label="Command palette" shortcut="⌘K" onClick={() => { setCommandPaletteOpen(true); closeMenus(); }} />
        </div>
      ) : null}
      {openMenu === 'help' ? (
        <div className="app-menu-popover menu-help">
          <span className="menu-heading">ThreeJS Game Studio</span>
          <MenuItem icon={<Sparkles size={14} />} label="Resume Quick Start" onClick={() => { setQuickStart((current) => ({ ...current, dismissed: false })); changeExperience('essentials'); closeMenus(); }} />
          <MenuItem icon={<Command size={14} />} label="Keyboard shortcuts" onClick={() => { setCommandPaletteOpen(true); closeMenus(); }} />
          <MenuItem icon={<Globe2 size={14} />} label="About this build" onClick={() => { showToast('ThreeJS Game Studio · Editor foundation v0.2'); closeMenus(); }} />
        </div>
      ) : null}

      <div className="workbench">
        <nav className="activity-rail" aria-label="Editor panels">
          <IconButton label="Main menu" compact className="compact-menu-trigger" onClick={() => setOpenMenu('file')}><Menu size={16} /></IconButton>
          <IconButton label="Scene hierarchy" active={hierarchyOpen} onClick={() => setHierarchyOpen((open) => !open)}><Layers3 size={16} /></IconButton>
          {experience === 'advanced' ? <IconButton label="Project assets" active={bottomOpen && bottomTab === 'assets'} onClick={() => { setBottomOpen(true); setBottomTab('assets'); }}><Package size={16} /></IconButton> : null}
          {experience === 'advanced' ? <IconButton label="Console" active={bottomOpen && bottomTab === 'console'} onClick={() => { setBottomOpen(true); setBottomTab('console'); }}><Terminal size={16} /></IconButton> : null}
          <IconButton label="Inspector" active={inspectorOpen} onClick={() => setInspectorOpen((open) => !open)}><SlidersHorizontal size={16} /></IconButton>
          <span className="activity-spacer" />
          {experience === 'advanced' ? <IconButton label="Command palette" onClick={() => setCommandPaletteOpen(true)}><Command size={16} /></IconButton> : null}
          <IconButton label="World settings" onClick={() => { setSelectedId('scene-root'); setInspectorOpen(true); }}><Settings2 size={16} /></IconButton>
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
          <section className={`viewport-shell ${mode !== 'edit' ? 'is-running' : ''}`} aria-label="3D viewport">
            <div className="viewport-toolbar">
              <div className="toolbar-group add-object-wrap">
                <button type="button" className="toolbar-add" disabled={editingDisabled} onClick={() => setAddMenuOpen((open) => !open)} data-testid="add-object"><Plus size={14} /><span>Create</span><ChevronDown size={11} /></button>
                {addMenuOpen ? (
                  <div className="viewport-add-menu">
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
              {mode !== 'edit' && experience === 'advanced' ? <div className="playing-badge"><span /><strong>{mode === 'paused' ? 'PAUSED' : 'PLAYING'}</strong></div> : null}
              {mode !== 'edit' && experience === 'essentials' ? <div className="essential-runtime-banner" data-testid="runtime-banner"><span className="preview-live-dot" /><strong>Playing</strong><span>Use WASD or arrow keys · Esc to return</span><button type="button" onClick={stopPlay}>Stop</button></div> : null}
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
              {experience === 'essentials' && mode === 'edit' && !quickStart.dismissed ? (
                <section className="quick-start-card" data-testid="quick-start" data-step={quickStartStep} aria-label="Quick Start">
                  <header>
                    <span className="quick-start-icon"><Sparkles size={15} /></span>
                    <span><strong>Quick Start</strong><small>{quickStartStep === 'complete' ? 'Ready to build' : `Step ${quickStartStep === 'add' ? 1 : quickStartStep === 'style' ? 2 : 3} of 3`}</small></span>
                    <button type="button" aria-label="Dismiss Quick Start" data-testid="quick-start-dismiss" onClick={() => setQuickStart((current) => ({ ...current, dismissed: true }))}><X size={13} /></button>
                  </header>
                  <div className="quick-start-progress" aria-hidden="true"><i className={quickStart.added ? 'is-done' : 'is-current'} /><i className={quickStart.styled ? 'is-done' : quickStart.added ? 'is-current' : ''} /><i className={quickStart.played ? 'is-done' : quickStart.styled ? 'is-current' : ''} /></div>
                  {quickStartStep === 'add' ? <><strong>Add your first shape</strong><p>Choose a shape and it will appear in the scene, ready to edit.</p><button type="button" className="quick-start-action" onClick={() => setAddMenuOpen(true)}>Choose a shape</button></> : null}
                  {quickStartStep === 'style' ? <><strong>Make it yours</strong><p>Use Appearance in Details to change the selected shape’s color.</p><button type="button" className="quick-start-action" onClick={() => setInspectorOpen(true)}>Open color controls</button></> : null}
                  {quickStartStep === 'play' ? <><strong>Try your game</strong><p>Play runs every Motion component without changing your authored scene.</p><button type="button" className="quick-start-action" onClick={startPlay}><Play size={12} fill="currentColor" /> Play the game</button></> : null}
                  {quickStartStep === 'complete' ? <><strong>Your first scene works</strong><p>Keep editing, switch to Advanced, or build a standalone web game.</p><button type="button" className="quick-start-action" onClick={buildWebGame}><Rocket size={12} /> Build web game</button><button type="button" className="quick-start-secondary" onClick={() => setQuickStart((current) => ({ ...current, dismissed: true }))}>Continue editing</button></> : null}
                </section>
              ) : null}
            </div>
          </section>
          {experience === 'advanced' && bottomOpen ? (
            <BottomDock
              tab={bottomTab}
              onTabChange={setBottomTab}
              assets={BUILT_IN_ASSETS}
              selectedNode={selectedNode}
              entries={consoleEntries}
              onActivateAsset={activateAsset}
              onClearConsole={() => setConsoleEntries([])}
              onClose={() => setBottomOpen(false)}
            />
          ) : null}
        </main>

        {inspectorOpen ? <InspectorPanel node={selectedNode} project={project} experience={experience} disabled={editingDisabled} onUpdate={updateSceneNode} onUpdateSettings={updateProjectSettings} onDelete={deleteSelected} /> : null}
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

      {commandPaletteOpen ? (
        <div className="command-backdrop" role="presentation" onMouseDown={() => setCommandPaletteOpen(false)}>
          <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
            <label className="command-search"><Command size={17} /><input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="Type a command or search…" onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setCommandIndex((index) => filteredCommands.length ? (index + 1) % filteredCommands.length : 0); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setCommandIndex((index) => filteredCommands.length ? (index - 1 + filteredCommands.length) % filteredCommands.length : 0); }
              if (event.key === 'Enter' && filteredCommands[commandIndex]) runCommand(filteredCommands[commandIndex]);
              if (event.key === 'Escape') setCommandPaletteOpen(false);
            }} /><kbd>Esc</kbd></label>
            <div className="command-list">
              {filteredCommands.map((action, index) => <button type="button" key={action.id} className={index === commandIndex ? 'is-highlighted' : ''} disabled={action.disabled} aria-current={index === commandIndex ? 'true' : undefined} onMouseEnter={() => setCommandIndex(index)} onClick={() => runCommand(action)}><span className="command-icon">{action.icon}</span><span><strong>{action.label}</strong><small>{action.group}</small></span>{action.shortcut ? <kbd>{action.shortcut}</kbd> : null}</button>)}
              {filteredCommands.length === 0 ? <div className="command-empty"><Command size={22} /><span>No commands found</span></div> : null}
            </div>
            <footer><span><kbd>↵</kbd> Run</span><span><kbd>↑↓</kbd> Navigate</span><span><kbd>Esc</kbd> Close</span></footer>
          </section>
        </div>
      ) : null}

      {toast ? <div className="toast" role="status"><span className="toast-icon"><Check size={13} /></span><span>{toast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={13} /></button></div> : null}

      <input
        ref={importInputRef}
        type="file"
        accept=".json,.tjsstudio"
        hidden
        onChange={(event) => {
          void handleImport(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      <div className="mobile-recommendation"><Sparkles size={13} /><span>Desktop layout recommended for precise scene editing</span></div>
      <button type="button" className="mobile-panel-trigger mobile-left" onClick={() => toggleMobilePanel('hierarchy')} aria-label="Toggle objects"><Layers3 size={16} /></button>
      <button type="button" className="mobile-panel-trigger mobile-right" onClick={() => toggleMobilePanel('inspector')} aria-label="Toggle details"><SlidersHorizontal size={16} /></button>
      {experience === 'advanced' ? <button type="button" className="mobile-panel-trigger mobile-bottom" onClick={() => toggleMobilePanel('bottom')} aria-label="Toggle assets"><Package size={16} /></button> : null}
      {experience === 'advanced' ? <button type="button" className="mobile-import-trigger" onClick={() => importInputRef.current?.click()} aria-label="Import project"><Upload size={16} /></button> : null}
    </div>
  );
}
