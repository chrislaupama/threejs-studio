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
  isProjectDocument,
  removeNode,
  updateNode,
} from './editor/project';
import type {
  ConsoleEntry,
  EditorMode,
  EditorTool,
  PrimitiveType,
  ProjectDocument,
  RendererStats,
  SceneNode,
  StudioAsset,
  ViewMode,
} from './editor/types';
import { ViewportEngine } from './editor/ViewportEngine';

const STORAGE_KEY = 'threejs-game-studio:project:v1';
const MAX_HISTORY = 60;

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
  run: () => void;
}

function loadInitialProject() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (isProjectDocument(parsed)) return parsed;
    }
  } catch {
    // The starter project is a safe recovery path for malformed or blocked storage.
  }
  return createStarterProject();
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
  const [selectedId, setSelectedId] = useState<string | null>('player-core');
  const [tool, setTool] = useState<EditorTool>('translate');
  const [mode, setMode] = useState<EditorMode>('edit');
  const [viewMode, setViewMode] = useState<ViewMode>('scene');
  const [space, setSpace] = useState<'local' | 'world'>('world');
  const [snap, setSnap] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [hierarchyOpen, setHierarchyOpen] = useState(() => window.innerWidth > 960);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 960);
  const [bottomOpen, setBottomOpen] = useState(() => window.innerWidth > 720);
  const [bottomTab, setBottomTab] = useState<'assets' | 'console'>('assets');
  const [previewMode, setPreviewMode] = useState(false);
  const [openMenu, setOpenMenu] = useState<'file' | 'edit' | 'object' | 'window' | 'help' | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState('Loaded');
  const [toast, setToast] = useState<string | null>('Starter scene ready — select an object to begin.');
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

  const addLog = useCallback((message: string, level: ConsoleEntry['level'] = 'info') => {
    setConsoleEntries((entries) => [
      ...entries,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, level, message, time: nowLabel() },
    ].slice(-120));
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  const commitProject = useCallback((next: ProjectDocument, label: string) => {
    const previous = cloneProject(projectRef.current);
    setUndoStack((entries) => [...entries, { document: previous, label }].slice(-MAX_HISTORY));
    setRedoStack([]);
    projectRef.current = next;
    setProject(next);
    setDirty(true);
    addLog(label);
  }, [addLog]);

  const updateSceneNode = useCallback((node: SceneNode, label: string) => {
    commitProject(updateNode(projectRef.current, node.id, () => node), label);
  }, [commitProject]);

  const undo = useCallback(() => {
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
    const currentSelection = getNode(projectRef.current, selectedId);
    const parentId = currentSelection?.kind === 'group' ? currentSelection.id : 'scene-root';
    const result = addPrimitive(projectRef.current, primitive, parentId, color);
    commitProject(result.project, `Create ${primitiveLabel(primitive)}`);
    setSelectedId(result.nodeId);
    setAddMenuOpen(false);
    showToast(`${primitiveLabel(primitive)} added to ${getNode(result.project, parentId)?.name ?? 'scene'}`);
  }, [commitProject, selectedId, showToast]);

  const createEmptyGroup = useCallback(() => {
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
    });
    next.updatedAt = new Date().toISOString();
    commitProject(next, 'Create Empty Group');
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
    setMode('play');
    setViewMode('game');
    addLog('Entered Play mode', 'success');
  }, [addLog]);

  const stopPlay = useCallback(() => {
    setMode('edit');
    setViewMode('scene');
    setPreviewMode(false);
    addLog('Stopped Play mode · authoring scene restored');
  }, [addLog]);

  const togglePause = useCallback(() => {
    setMode((current) => current === 'paused' ? 'play' : current === 'play' ? 'paused' : current);
  }, []);

  const enterPreview = useCallback(() => {
    setPreviewMode(true);
    setViewMode('game');
    setMode('play');
    addLog('Fullscreen game preview started', 'success');
  }, [addLog]);

  const activateAsset = useCallback((asset: StudioAsset) => {
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
      commitProject(applyMaterial(projectRef.current, node.id, asset.color), `Apply ${asset.name}`);
      showToast(`${asset.name} applied to ${node.name}`);
      return;
    }
    setSelectedId('scene-root');
    showToast('MainWorld is already the active scene');
  }, [commitProject, createPrimitive, selectedId, showToast]);

  const handleImport = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const value: unknown = JSON.parse(await file.text());
      if (!isProjectDocument(value)) throw new Error('Unsupported project schema');
      commitProject(value, `Import ${file.name}`);
      setSelectedId(value.nodes[0]?.id ?? null);
      addLog(`Imported ${file.name}`, 'success');
      showToast('Project imported successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown import error';
      addLog(`Import failed · ${message}`, 'warning');
      showToast('That file is not a valid studio project');
    }
  }, [addLog, commitProject, showToast]);

  const resetStarter = useCallback(() => {
    const next = createStarterProject();
    commitProject(next, 'Create new starter project');
    setSelectedId('player-core');
    showToast('New starter project created');
  }, [commitProject, showToast]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new ViewportEngine(canvas, {
      onSelect: setSelectedId,
      onTransformStart: () => {
        dragStartRef.current = cloneProject(projectRef.current);
      },
      onTransformChange: (id, transform, final) => {
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
      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
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
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (command && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (isTyping || command || editingDisabled) return;
      if (event.key === 'q' || event.key === 'Q') setTool('select');
      if (event.key === 'w' || event.key === 'W') setTool('translate');
      if (event.key === 'e' || event.key === 'E') setTool('rotate');
      if (event.key === 'r' || event.key === 'R') setTool('scale');
      if (event.key === 'f' || event.key === 'F') engineRef.current?.frameSelection();
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected();
      if (event.key === 'Escape') {
        setOpenMenu(null);
        setAddMenuOpen(false);
        setCommandPaletteOpen(false);
        if (previewMode) stopPlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelected, duplicateSelected, editingDisabled, previewMode, redo, saveProject, stopPlay, undo]);

  const commands = useMemo<CommandAction[]>(() => [
    { id: 'save', label: 'Save project', group: 'Project', shortcut: '⌘S', icon: <Save size={15} />, run: () => saveProject() },
    { id: 'export', label: 'Export editable project', group: 'Project', icon: <FileJson size={15} />, run: exportProject },
    { id: 'build', label: 'Build web game', group: 'Project', shortcut: '⌘B', icon: <Rocket size={15} />, run: buildWebGame },
    { id: 'play', label: 'Enter Play mode', group: 'Runtime', shortcut: '⌘P', icon: <Play size={15} />, run: startPlay },
    { id: 'preview', label: 'Open clean game preview', group: 'Runtime', icon: <Globe2 size={15} />, run: enterPreview },
    { id: 'frame', label: 'Frame selected object', group: 'Viewport', shortcut: 'F', icon: <Crosshair size={15} />, run: () => engineRef.current?.frameSelection() },
    { id: 'box', label: 'Create Box', group: 'Create', icon: <Box size={15} />, run: () => createPrimitive('box') },
    { id: 'sphere', label: 'Create Sphere', group: 'Create', icon: <Circle size={15} />, run: () => createPrimitive('sphere') },
    { id: 'group', label: 'Create Empty Group', group: 'Create', icon: <Layers3 size={15} />, run: createEmptyGroup },
    { id: 'hierarchy', label: 'Toggle Hierarchy panel', group: 'Window', icon: <PanelLeftOpen size={15} />, run: () => setHierarchyOpen((open) => !open) },
    { id: 'inspector', label: 'Toggle Inspector panel', group: 'Window', icon: <PanelRightOpen size={15} />, run: () => setInspectorOpen((open) => !open) },
    { id: 'project-panel', label: 'Toggle Project panel', group: 'Window', icon: <PanelBottomOpen size={15} />, run: () => setBottomOpen((open) => !open) },
  ], [buildWebGame, createEmptyGroup, createPrimitive, enterPreview, exportProject, saveProject, startPlay]);

  const filteredCommands = commands.filter((action) => action.label.toLowerCase().includes(commandQuery.toLowerCase()));
  const runCommand = (action: CommandAction) => {
    setCommandPaletteOpen(false);
    setCommandQuery('');
    action.run();
  };

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

  return (
    <div className={`studio-app mode-${mode} ${previewMode ? 'preview-mode' : ''}`} data-testid="studio-app">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Boxes size={18} strokeWidth={1.8} /></span>
          <span className="brand-copy"><strong>ThreeJS</strong><span>Game Studio</span></span>
        </div>
        <nav className="app-menu-bar" aria-label="Application menu">
          {(['file', 'edit', 'object', 'window', 'help'] as const).map((menu) => (
            <button type="button" key={menu} className={openMenu === menu ? 'is-active' : ''} onClick={() => toggleMenu(menu)}>{menu[0].toUpperCase() + menu.slice(1)}</button>
          ))}
        </nav>
        <div className="project-crumb">
          <span className={`save-state-dot ${dirty ? 'is-dirty' : ''}`} />
          <strong>{project.name}</strong>
          <span>/</span>
          <span>{project.sceneName}</span>
          <ChevronDown size={12} />
        </div>
        <div className="history-actions">
          <IconButton label={undoStack.length ? `Undo ${undoStack.at(-1)?.label}` : 'Nothing to undo'} compact disabled={!undoStack.length || editingDisabled} onClick={undo}><Undo2 size={14} /></IconButton>
          <IconButton label={redoStack.length ? `Redo ${redoStack.at(-1)?.label}` : 'Nothing to redo'} compact disabled={!redoStack.length || editingDisabled} onClick={redo}><Redo2 size={14} /></IconButton>
          <IconButton label="Save project" compact onClick={() => saveProject()} testId="save-project"><Save size={14} /></IconButton>
        </div>
        <div className="play-controls" aria-label="Play controls">
          <IconButton label="Play" active={mode === 'play'} disabled={mode !== 'edit'} onClick={startPlay} testId="play-button"><Play size={14} fill={mode === 'play' ? 'currentColor' : 'none'} /></IconButton>
          <IconButton label={mode === 'paused' ? 'Resume' : 'Pause'} active={mode === 'paused'} disabled={mode === 'edit'} onClick={togglePause} testId="pause-button"><Pause size={14} fill={mode === 'paused' ? 'currentColor' : 'none'} /></IconButton>
          <IconButton label="Step one frame" disabled={mode !== 'paused'} onClick={() => engineRef.current?.step()}><StepForward size={14} /></IconButton>
          <IconButton label="Stop" disabled={mode === 'edit'} onClick={stopPlay} testId="stop-button"><Square size={12} fill={mode !== 'edit' ? 'currentColor' : 'none'} /></IconButton>
        </div>
        <div className="topbar-actions">
          <span className="autosave-state"><Check size={12} />{dirty ? 'Saving…' : lastSaved}</span>
          <button type="button" className="secondary-action" onClick={enterPreview}><Globe2 size={14} /><span>Preview</span></button>
          <button type="button" className="primary-action" onClick={buildWebGame} data-testid="build-button"><Rocket size={14} /><span>Build</span></button>
        </div>
      </header>

      {openMenu ? <button type="button" className="menu-scrim" aria-label="Close menu" onClick={closeMenus} /> : null}
      {openMenu === 'file' ? (
        <div className="app-menu-popover menu-file">
          <span className="menu-heading">Project</span>
          <MenuItem icon={<Sparkles size={14} />} label="New starter project" shortcut="⌘N" onClick={() => { resetStarter(); closeMenus(); }} />
          <MenuItem icon={<FolderOpen size={14} />} label="Open project…" shortcut="⌘O" onClick={() => { importInputRef.current?.click(); closeMenus(); }} />
          <MenuItem icon={<Save size={14} />} label="Save" shortcut="⌘S" onClick={() => { saveProject(); closeMenus(); }} />
          <div className="menu-separator" />
          <MenuItem icon={<FileJson size={14} />} label="Export editable project" onClick={() => { exportProject(); closeMenus(); }} />
          <MenuItem icon={<Rocket size={14} />} label="Build web game" shortcut="⌘B" onClick={() => { buildWebGame(); closeMenus(); }} />
        </div>
      ) : null}
      {openMenu === 'edit' ? (
        <div className="app-menu-popover menu-edit">
          <MenuItem icon={<Undo2 size={14} />} label="Undo" shortcut="⌘Z" disabled={!undoStack.length} onClick={() => { undo(); closeMenus(); }} />
          <MenuItem icon={<Redo2 size={14} />} label="Redo" shortcut="⇧⌘Z" disabled={!redoStack.length} onClick={() => { redo(); closeMenus(); }} />
          <div className="menu-separator" />
          <MenuItem icon={<Copy size={14} />} label="Duplicate" shortcut="⌘D" disabled={!selectedId || editingDisabled} onClick={() => { duplicateSelected(); closeMenus(); }} />
          <MenuItem icon={<Trash2 size={14} />} label="Delete" shortcut="⌫" danger disabled={!selectedId || selectedId === 'scene-root' || editingDisabled} onClick={() => { deleteSelected(); closeMenus(); }} />
        </div>
      ) : null}
      {openMenu === 'object' ? (
        <div className="app-menu-popover menu-object">
          <MenuItem icon={<Layers3 size={14} />} label="Empty Group" onClick={() => { createEmptyGroup(); closeMenus(); }} />
          <div className="menu-separator" />
          <span className="menu-heading">3D Object</span>
          {primitives.map((primitive) => <MenuItem key={primitive} icon={<PrimitiveIcon primitive={primitive} />} label={primitiveLabel(primitive)} onClick={() => { createPrimitive(primitive); closeMenus(); }} />)}
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
          <MenuItem icon={<Command size={14} />} label="Keyboard shortcuts" onClick={() => { setCommandPaletteOpen(true); closeMenus(); }} />
          <MenuItem icon={<Globe2 size={14} />} label="About this build" onClick={() => { showToast('ThreeJS Game Studio · Editor foundation v0.1'); closeMenus(); }} />
        </div>
      ) : null}

      <div className="workbench">
        <nav className="activity-rail" aria-label="Editor panels">
          <IconButton label="Main menu" compact className="compact-menu-trigger" onClick={() => setOpenMenu('file')}><Menu size={16} /></IconButton>
          <IconButton label="Scene hierarchy" active={hierarchyOpen} onClick={() => setHierarchyOpen((open) => !open)}><Layers3 size={16} /></IconButton>
          <IconButton label="Project assets" active={bottomOpen && bottomTab === 'assets'} onClick={() => { setBottomOpen(true); setBottomTab('assets'); }}><Package size={16} /></IconButton>
          <IconButton label="Console" active={bottomOpen && bottomTab === 'console'} onClick={() => { setBottomOpen(true); setBottomTab('console'); }}><Terminal size={16} /></IconButton>
          <IconButton label="Inspector" active={inspectorOpen} onClick={() => setInspectorOpen((open) => !open)}><SlidersHorizontal size={16} /></IconButton>
          <span className="activity-spacer" />
          <IconButton label="Command palette" onClick={() => setCommandPaletteOpen(true)}><Command size={16} /></IconButton>
          <IconButton label="Studio settings" onClick={() => showToast('Project settings are available in the Inspector when the scene root is selected')}><Settings2 size={16} /></IconButton>
        </nav>

        {hierarchyOpen ? (
          <HierarchyPanel
            project={project}
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
              <span className="toolbar-divider" />
              <button type="button" className="toolbar-text-button" disabled={editingDisabled} onClick={() => setSpace((current) => current === 'world' ? 'local' : 'world')}>{space === 'world' ? 'Global' : 'Local'}<ChevronDown size={11} /></button>
              <IconButton label="Toggle snapping" active={snap} disabled={editingDisabled} onClick={() => setSnap((value) => !value)}><Magnet size={14} /></IconButton>
              <div className="viewport-tabs" role="tablist" aria-label="Viewport mode">
                <button type="button" role="tab" aria-selected={viewMode === 'scene'} className={viewMode === 'scene' ? 'is-active' : ''} onClick={() => setViewMode('scene')}>Scene</button>
                <button type="button" role="tab" aria-selected={viewMode === 'game'} className={viewMode === 'game' ? 'is-active' : ''} onClick={() => setViewMode('game')}>Game</button>
              </div>
              <div className="viewport-toolbar-right">
                <button type="button" className="toolbar-text-button camera-view-button" onClick={() => engineRef.current?.setCameraView('perspective')}><Camera size={13} /> Perspective<ChevronDown size={11} /></button>
                <IconButton label="Toggle grid" active={gridVisible} disabled={viewMode === 'game'} onClick={() => setGridVisible((visible) => !visible)}><Grid3X3 size={14} /></IconButton>
                <IconButton label="Frame selected · F" disabled={!selectedId || viewMode === 'game'} onClick={() => engineRef.current?.frameSelection()}><Crosshair size={14} /></IconButton>
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
              {mode !== 'edit' ? <div className="playing-badge"><span /><strong>{mode === 'paused' ? 'PAUSED' : 'PLAYING'}</strong></div> : null}
              {viewMode === 'scene' ? (
                <div className="orientation-widget" aria-label="Camera orientation">
                  <button type="button" className="axis-y" aria-label="Top view" onClick={() => engineRef.current?.setCameraView('top')}>Y</button>
                  <button type="button" className="axis-x" aria-label="Right view" onClick={() => engineRef.current?.setCameraView('right')}>X</button>
                  <button type="button" className="axis-z" aria-label="Front view" onClick={() => engineRef.current?.setCameraView('front')}>Z</button>
                  <button type="button" className="axis-center" aria-label="Perspective view" onClick={() => engineRef.current?.setCameraView('perspective')} />
                </div>
              ) : null}
              <div className="viewport-stats"><span>{Math.round(stats.fps)} FPS</span><span>{stats.drawCalls} calls</span><span>{stats.triangles.toLocaleString()} tris</span></div>
              {viewMode === 'game' && mode === 'edit' ? <div className="game-view-hint"><Camera size={13} /> Main Camera preview</div> : null}
            </div>
          </section>
          {bottomOpen ? (
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

        {inspectorOpen ? <InspectorPanel node={selectedNode} project={project} disabled={editingDisabled} onUpdate={updateSceneNode} onDelete={deleteSelected} /> : null}
      </div>

      <footer className="statusbar">
        <div><span className="status-ready-dot" /><strong>Ready</strong><span>{mode === 'edit' ? 'Authoring' : 'Runtime'} · WebGL 2</span></div>
        <div className="statusbar-center"><span>{selectedNode ? selectedNode.name : 'No selection'}</span>{selectedNode ? <code>{selectedNode.kind}{selectedNode.primitive ? ` · ${selectedNode.primitive}` : ''}</code> : null}</div>
        <div><span>{project.nodes.length} objects</span><span>{stats.geometries} meshes</span><span>{stats.frameMs.toFixed(1)} ms</span><span>DPR {Math.min(window.devicePixelRatio, 2).toFixed(1)}×</span></div>
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
            <label className="command-search"><Command size={17} /><input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="Type a command or search…" onKeyDown={(event) => { if (event.key === 'Enter' && filteredCommands[0]) runCommand(filteredCommands[0]); if (event.key === 'Escape') setCommandPaletteOpen(false); }} /><kbd>Esc</kbd></label>
            <div className="command-list">
              {filteredCommands.map((action, index) => <button type="button" key={action.id} className={index === 0 ? 'is-highlighted' : ''} onClick={() => runCommand(action)}><span className="command-icon">{action.icon}</span><span><strong>{action.label}</strong><small>{action.group}</small></span>{action.shortcut ? <kbd>{action.shortcut}</kbd> : null}</button>)}
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
      <button type="button" className="mobile-panel-trigger mobile-left" onClick={() => setHierarchyOpen((open) => !open)} aria-label="Toggle hierarchy"><Layers3 size={16} /></button>
      <button type="button" className="mobile-panel-trigger mobile-right" onClick={() => setInspectorOpen((open) => !open)} aria-label="Toggle inspector"><SlidersHorizontal size={16} /></button>
      <button type="button" className="mobile-panel-trigger mobile-bottom" onClick={() => setBottomOpen((open) => !open)} aria-label="Toggle assets"><Package size={16} /></button>
      <button type="button" className="mobile-import-trigger" onClick={() => importInputRef.current?.click()} aria-label="Import project"><Upload size={16} /></button>
    </div>
  );
}
