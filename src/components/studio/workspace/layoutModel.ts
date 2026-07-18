import {
  createDefaultEditorPreferences,
  normalizeEditorPreferences,
  updateWorkspacePanel,
  type EditorPreferences,
  type EditorPreferencesStorage,
  type EditorWorkspaceId,
} from '@/editor/editorPreferences';

export const STUDIO_WORKSPACE_LAYOUTS_KEY = 'threejs-studio:workspace-layouts:v1';

export const STUDIO_WORKSPACE_IDS = ['layout', 'scripting', 'debugging'] as const;
export type StudioWorkspaceId = typeof STUDIO_WORKSPACE_IDS[number];

export const STUDIO_PANEL_IDS = [
  'viewport',
  'hierarchy',
  'inspector',
  'assets',
  'console',
  'assistant',
  'scripts',
  'profiler',
] as const;
export type StudioPanelId = typeof STUDIO_PANEL_IDS[number];

export interface StudioPanelLayoutPreference {
  panelId: StudioPanelId;
  open: boolean;
  preferredSize: number;
}

export interface StudioWorkspaceStackNode {
  kind: 'stack';
  id: string;
  panelIds: StudioPanelId[];
  activePanelId: StudioPanelId;
}

export interface StudioWorkspaceSplitNode {
  kind: 'split';
  id: string;
  direction: 'horizontal' | 'vertical';
  children: StudioWorkspaceNode[];
  /** Percentage weights, keyed by child node id. */
  sizes: Record<string, number>;
}

export type StudioWorkspaceNode = StudioWorkspaceStackNode | StudioWorkspaceSplitNode;

export interface StudioWorkspaceLayout {
  version: 1;
  workspaceId: StudioWorkspaceId;
  root: StudioWorkspaceNode;
  panels: StudioPanelLayoutPreference[];
}

export interface StudioWorkspaceState {
  version: 1;
  activeWorkspace: StudioWorkspaceId;
  layouts: StudioWorkspaceLayout[];
}

const DEFAULT_PANEL_SIZES: Readonly<Record<StudioPanelId, number>> = {
  viewport: 640,
  hierarchy: 244,
  inspector: 310,
  assets: 218,
  console: 218,
  assistant: 330,
  scripts: 420,
  profiler: 280,
};

const DEFAULT_WORKSPACE_PANELS: Readonly<Record<StudioWorkspaceId, readonly StudioPanelId[]>> = {
  layout: ['viewport', 'hierarchy', 'inspector', 'assets', 'assistant'],
  scripting: ['hierarchy', 'scripts', 'console', 'inspector', 'assistant'],
  debugging: ['viewport', 'hierarchy', 'console', 'profiler', 'inspector', 'assistant'],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStudioWorkspaceId = (value: unknown): value is StudioWorkspaceId =>
  typeof value === 'string' && STUDIO_WORKSPACE_IDS.includes(value as StudioWorkspaceId);

export const isStudioPanelId = (value: unknown): value is StudioPanelId =>
  typeof value === 'string' && STUDIO_PANEL_IDS.includes(value as StudioPanelId);

const clampPreferredSize = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(1_200, Math.max(120, value)));
};

const normalizeWeights = (
  ids: readonly string[],
  supplied: Readonly<Record<string, number>>,
): Record<string, number> => {
  const positive = ids.map((id) => {
    const value = supplied[id];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
  });
  const total = positive.reduce((sum, value) => sum + value, 0);
  const normalized = Object.fromEntries(ids.map((id, index) => [
    id,
    Number(((positive[index] ?? 1) / total * 100).toFixed(4)),
  ]));
  const roundedTotal = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  const lastId = ids.at(-1);
  if (lastId) normalized[lastId] = Number((normalized[lastId] + 100 - roundedTotal).toFixed(4));
  return normalized;
};

const stack = (
  id: string,
  panelIds: readonly StudioPanelId[],
  activePanelId: StudioPanelId = panelIds[0]!,
): StudioWorkspaceStackNode => ({
  kind: 'stack',
  id,
  panelIds: [...panelIds],
  activePanelId,
});

const split = (
  id: string,
  direction: StudioWorkspaceSplitNode['direction'],
  children: readonly StudioWorkspaceNode[],
  sizes: readonly number[],
): StudioWorkspaceSplitNode => ({
  kind: 'split',
  id,
  direction,
  children: children.map(cloneWorkspaceNode),
  sizes: normalizeWeights(
    children.map((child) => child.id),
    Object.fromEntries(children.map((child, index) => [child.id, sizes[index] ?? 1])),
  ),
});

const cloneWorkspaceNode = (node: StudioWorkspaceNode): StudioWorkspaceNode => node.kind === 'stack'
  ? { ...node, panelIds: [...node.panelIds] }
  : {
      ...node,
      children: node.children.map(cloneWorkspaceNode),
      sizes: { ...node.sizes },
    };

const createDefaultRoot = (workspaceId: StudioWorkspaceId): StudioWorkspaceNode => {
  if (workspaceId === 'scripting') {
    const center = split('scripting-center', 'vertical', [
      stack('scripting-code', ['scripts']),
      stack('scripting-console', ['console']),
    ], [68, 32]);
    return split('scripting-root', 'horizontal', [
      stack('scripting-left', ['hierarchy']),
      center,
      stack('scripting-right', ['inspector', 'assistant']),
    ], [18, 60, 22]);
  }

  if (workspaceId === 'debugging') {
    const center = split('debugging-center', 'vertical', [
      stack('debugging-viewport', ['viewport']),
      stack('debugging-output', ['console', 'profiler']),
    ], [70, 30]);
    return split('debugging-root', 'horizontal', [
      stack('debugging-left', ['hierarchy']),
      center,
      stack('debugging-right', ['inspector', 'assistant']),
    ], [18, 60, 22]);
  }

  const center = split('layout-center', 'vertical', [
    stack('layout-viewport', ['viewport']),
    stack('layout-assets', ['assets']),
  ], [72, 28]);
  return split('layout-root', 'horizontal', [
    stack('layout-left', ['hierarchy']),
    center,
    stack('layout-right', ['inspector', 'assistant']),
  ], [18, 60, 22]);
};

export function createDefaultStudioWorkspaceLayout(
  workspaceId: StudioWorkspaceId,
): StudioWorkspaceLayout {
  return {
    version: 1,
    workspaceId,
    root: createDefaultRoot(workspaceId),
    panels: DEFAULT_WORKSPACE_PANELS[workspaceId].map((panelId) => ({
      panelId,
      open: true,
      preferredSize: DEFAULT_PANEL_SIZES[panelId],
    })),
  };
}

export function createDefaultStudioWorkspaceState(): StudioWorkspaceState {
  return {
    version: 1,
    activeWorkspace: 'layout',
    layouts: STUDIO_WORKSPACE_IDS.map(createDefaultStudioWorkspaceLayout),
  };
}

interface ParseContext {
  nodeIds: Set<string>;
  panelIds: Set<StudioPanelId>;
}

const parseWorkspaceNode = (
  value: unknown,
  context: ParseContext,
  depth = 0,
): StudioWorkspaceNode | null => {
  if (!isRecord(value) || depth > 8 || typeof value.id !== 'string' || !value.id.trim()) return null;
  if (context.nodeIds.has(value.id)) return null;
  context.nodeIds.add(value.id);

  if (value.kind === 'stack') {
    if (!Array.isArray(value.panelIds)) return null;
    const panelIds = value.panelIds.filter(isStudioPanelId);
    if (panelIds.length === 0 || panelIds.length !== value.panelIds.length) return null;
    if (new Set(panelIds).size !== panelIds.length) return null;
    if (panelIds.some((panelId) => context.panelIds.has(panelId))) return null;
    panelIds.forEach((panelId) => context.panelIds.add(panelId));
    if (!isStudioPanelId(value.activePanelId) || !panelIds.includes(value.activePanelId)) return null;
    return { kind: 'stack', id: value.id, panelIds, activePanelId: value.activePanelId };
  }

  if (value.kind !== 'split' || (value.direction !== 'horizontal' && value.direction !== 'vertical')) {
    return null;
  }
  if (!Array.isArray(value.children) || value.children.length < 2 || value.children.length > 6) return null;
  const children: StudioWorkspaceNode[] = [];
  for (const childValue of value.children) {
    const child = parseWorkspaceNode(childValue, context, depth + 1);
    if (!child) return null;
    children.push(child);
  }
  const suppliedSizes = isRecord(value.sizes)
    ? Object.fromEntries(Object.entries(value.sizes).filter((entry): entry is [string, number] => (
        typeof entry[1] === 'number'
      )))
    : {};
  return {
    kind: 'split',
    id: value.id,
    direction: value.direction,
    children,
    sizes: normalizeWeights(children.map((child) => child.id), suppliedSizes),
  };
};

export function normalizeStudioWorkspaceLayout(
  value: unknown,
  workspaceId: StudioWorkspaceId,
): StudioWorkspaceLayout {
  const fallback = createDefaultStudioWorkspaceLayout(workspaceId);
  if (!isRecord(value) || value.workspaceId !== workspaceId) return fallback;
  const context: ParseContext = { nodeIds: new Set(), panelIds: new Set() };
  const root = parseWorkspaceNode(value.root, context);
  if (!root) return fallback;

  const suppliedPanels = Array.isArray(value.panels) ? value.panels : [];
  const panels = [...context.panelIds].map((panelId) => {
    const supplied = suppliedPanels.find((item) => isRecord(item) && item.panelId === panelId);
    return {
      panelId,
      open: !isRecord(supplied) || typeof supplied.open !== 'boolean' ? true : supplied.open,
      preferredSize: clampPreferredSize(
        isRecord(supplied) ? supplied.preferredSize : undefined,
        DEFAULT_PANEL_SIZES[panelId],
      ),
    };
  });
  return { version: 1, workspaceId, root, panels };
}

export function normalizeStudioWorkspaceState(value: unknown): StudioWorkspaceState {
  const fallback = createDefaultStudioWorkspaceState();
  if (!isRecord(value)) return fallback;
  const suppliedLayouts = Array.isArray(value.layouts) ? value.layouts : [];
  return {
    version: 1,
    activeWorkspace: isStudioWorkspaceId(value.activeWorkspace) ? value.activeWorkspace : 'layout',
    layouts: STUDIO_WORKSPACE_IDS.map((workspaceId) => normalizeStudioWorkspaceLayout(
      suppliedLayouts.find((layout) => isRecord(layout) && layout.workspaceId === workspaceId),
      workspaceId,
    )),
  };
}

export function loadStudioWorkspaceState(
  storage?: EditorPreferencesStorage,
  preferences?: EditorPreferences,
): StudioWorkspaceState {
  const fromPreferences = preferences
    ? createStudioWorkspaceStateFromEditorPreferences(preferences)
    : createDefaultStudioWorkspaceState();
  if (!storage) return fromPreferences;
  try {
    const serialized = storage.getItem(STUDIO_WORKSPACE_LAYOUTS_KEY);
    if (!serialized) return fromPreferences;
    const loaded = normalizeStudioWorkspaceState(JSON.parse(serialized));
    return preferences ? mergeEditorPreferencesIntoStudioWorkspace(loaded, preferences) : loaded;
  } catch {
    return fromPreferences;
  }
}

export function saveStudioWorkspaceState(
  state: StudioWorkspaceState,
  storage?: EditorPreferencesStorage,
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  storage?.setItem(STUDIO_WORKSPACE_LAYOUTS_KEY, JSON.stringify(normalized));
  return normalized;
}

const updateNode = (
  node: StudioWorkspaceNode,
  nodeId: string,
  updater: (node: StudioWorkspaceNode) => StudioWorkspaceNode,
): StudioWorkspaceNode => {
  if (node.id === nodeId) return updater(node);
  if (node.kind === 'stack') return node;
  return { ...node, children: node.children.map((child) => updateNode(child, nodeId, updater)) };
};

export function selectStudioWorkspace(
  state: StudioWorkspaceState,
  workspaceId: StudioWorkspaceId,
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  return normalized.activeWorkspace === workspaceId
    ? normalized
    : { ...normalized, activeWorkspace: workspaceId };
}

export function activateStudioPanel(
  layout: StudioWorkspaceLayout,
  stackId: string,
  panelId: StudioPanelId,
): StudioWorkspaceLayout {
  const normalized = normalizeStudioWorkspaceLayout(layout, layout.workspaceId);
  return {
    ...normalized,
    root: updateNode(normalized.root, stackId, (node) => node.kind === 'stack' && node.panelIds.includes(panelId)
      ? { ...node, activePanelId: panelId }
      : node),
  };
}

export function setStudioPanelOpen(
  layout: StudioWorkspaceLayout,
  panelId: StudioPanelId,
  open: boolean,
): StudioWorkspaceLayout {
  const normalized = normalizeStudioWorkspaceLayout(layout, layout.workspaceId);
  if (!normalized.panels.some((panel) => panel.panelId === panelId)) return normalized;
  return {
    ...normalized,
    panels: normalized.panels.map((panel) => panel.panelId === panelId
      ? { ...panel, open }
      : panel),
  };
}

export function resizeStudioSplit(
  layout: StudioWorkspaceLayout,
  splitId: string,
  changedSizes: Readonly<Record<string, number>>,
): StudioWorkspaceLayout {
  const normalized = normalizeStudioWorkspaceLayout(layout, layout.workspaceId);
  return {
    ...normalized,
    root: updateNode(normalized.root, splitId, (node) => {
      if (node.kind !== 'split') return node;
      const childIds = node.children.map((child) => child.id);
      const changedIds = childIds.filter((id) => {
        const size = changedSizes[id];
        return typeof size === 'number' && Number.isFinite(size) && size > 0;
      });
      if (changedIds.length === 0) return node;
      const unchangedIds = childIds.filter((id) => !changedIds.includes(id));
      const unchangedTotal = unchangedIds.reduce((sum, id) => sum + (node.sizes[id] ?? 0), 0);
      const available = Math.max(1, 100 - unchangedTotal);
      const changedTotal = changedIds.reduce((sum, id) => sum + (changedSizes[id] ?? 0), 0);
      const merged = { ...node.sizes };
      changedIds.forEach((id) => {
        merged[id] = (changedSizes[id] ?? 0) / changedTotal * available;
      });
      return { ...node, sizes: normalizeWeights(childIds, merged) };
    }),
  };
}

export function updateStudioWorkspaceLayout(
  state: StudioWorkspaceState,
  layout: StudioWorkspaceLayout,
): StudioWorkspaceState {
  const normalizedState = normalizeStudioWorkspaceState(state);
  const normalizedLayout = normalizeStudioWorkspaceLayout(layout, layout.workspaceId);
  return {
    ...normalizedState,
    layouts: normalizedState.layouts.map((candidate) => candidate.workspaceId === normalizedLayout.workspaceId
      ? normalizedLayout
      : candidate),
  };
}

const toStudioWorkspaceId = (workspaceId: EditorWorkspaceId): StudioWorkspaceId =>
  isStudioWorkspaceId(workspaceId) ? workspaceId : 'layout';

export function createStudioWorkspaceStateFromEditorPreferences(
  preferences: EditorPreferences,
): StudioWorkspaceState {
  return mergeEditorPreferencesIntoStudioWorkspace(
    createDefaultStudioWorkspaceState(),
    preferences,
  );
}

export function mergeEditorPreferencesIntoStudioWorkspace(
  state: StudioWorkspaceState,
  preferences: EditorPreferences,
): StudioWorkspaceState {
  const normalizedState = normalizeStudioWorkspaceState(state);
  const normalizedPreferences = normalizeEditorPreferences(preferences);
  return {
    ...normalizedState,
    activeWorkspace: toStudioWorkspaceId(normalizedPreferences.activeWorkspace),
    layouts: normalizedState.layouts.map((layout) => {
      const editorWorkspace = normalizedPreferences.workspaces.find((item) => item.id === layout.workspaceId);
      if (!editorWorkspace) return layout;
      return {
        ...layout,
        panels: layout.panels.map((panel) => {
          if (panel.panelId === 'viewport') return panel;
          const editorPanel = editorWorkspace.panels.find((item) => item.id === panel.panelId);
          return editorPanel
            ? { ...panel, open: editorPanel.open, preferredSize: editorPanel.size }
            : panel;
        }),
      };
    }),
  };
}

const isEditorPanelId = (
  panelId: StudioPanelId,
): panelId is Exclude<StudioPanelId, 'viewport'> => panelId !== 'viewport';

export function applyStudioWorkspaceStateToEditorPreferences(
  state: StudioWorkspaceState,
  preferences: EditorPreferences = createDefaultEditorPreferences(),
): EditorPreferences {
  const normalizedState = normalizeStudioWorkspaceState(state);
  let next: EditorPreferences = {
    ...normalizeEditorPreferences(preferences),
    activeWorkspace: normalizedState.activeWorkspace,
  };
  normalizedState.layouts.forEach((layout) => {
    layout.panels.forEach((panel) => {
      if (!isEditorPanelId(panel.panelId)) return;
      next = updateWorkspacePanel(next, layout.workspaceId, panel.panelId, {
        open: panel.open,
        size: panel.preferredSize,
      });
    });
  });
  return next;
}

export function findStudioWorkspaceLayout(
  state: StudioWorkspaceState,
  workspaceId: StudioWorkspaceId = state.activeWorkspace,
): StudioWorkspaceLayout {
  const normalized = normalizeStudioWorkspaceState(state);
  return normalized.layouts.find((layout) => layout.workspaceId === workspaceId)
    ?? createDefaultStudioWorkspaceLayout(workspaceId);
}

export function listStudioPanelIds(node: StudioWorkspaceNode): StudioPanelId[] {
  return node.kind === 'stack'
    ? [...node.panelIds]
    : node.children.flatMap(listStudioPanelIds);
}
