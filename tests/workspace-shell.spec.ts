import { expect, test } from '@playwright/test';
import { createDefaultEditorPreferences } from '../src/editor/editorPreferences';
import {
  DEFAULT_STUDIO_PANEL_DEFINITIONS,
  STUDIO_PANEL_IDS,
  STUDIO_WORKSPACE_IDS,
  STUDIO_WORKSPACE_LAYOUTS_KEY,
  activateStudioPanel,
  applyStudioWorkspaceStateToEditorPreferences,
  createDefaultStudioWorkspaceState,
  createStudioPanelRegistry,
  createStudioWorkspaceStateFromEditorPreferences,
  findStudioWorkspaceLayout,
  listMobileSurfacePanelIds,
  listStudioPanelIds,
  loadStudioWorkspaceState,
  normalizeStudioWorkspaceState,
  resizeStudioSplit,
  saveStudioWorkspaceState,
  selectStudioWorkspace,
  setStudioPanelOpen,
  updateStudioWorkspaceLayout,
  type StudioWorkspaceNode,
  type StudioWorkspaceSplitNode,
} from '../src/components/studio/workspace';

const listNodes = (node: StudioWorkspaceNode): StudioWorkspaceNode[] => [
  node,
  ...(node.kind === 'split' ? node.children.flatMap(listNodes) : []),
];

const findSplit = (node: StudioWorkspaceNode, id: string): StudioWorkspaceSplitNode | undefined => (
  listNodes(node).find((candidate): candidate is StudioWorkspaceSplitNode => (
    candidate.kind === 'split' && candidate.id === id
  ))
);

test('default Studio workspaces are complete, unique, and serializable', () => {
  const state = createDefaultStudioWorkspaceState();
  expect(state.activeWorkspace).toBe('layout');
  expect(state.layouts.map((layout) => layout.workspaceId)).toEqual(STUDIO_WORKSPACE_IDS);
  expect(() => JSON.stringify(state)).not.toThrow();

  state.layouts.forEach((layout) => {
    const nodes = listNodes(layout.root);
    const nodeIds = nodes.map((node) => node.id);
    const panelIds = listStudioPanelIds(layout.root);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(new Set(panelIds).size).toBe(panelIds.length);
    expect(panelIds.every((panelId) => STUDIO_PANEL_IDS.includes(panelId))).toBe(true);
    nodes.filter((node): node is StudioWorkspaceSplitNode => node.kind === 'split').forEach((split) => {
      const sizeTotal = Object.values(split.sizes).reduce((sum, value) => sum + value, 0);
      expect(sizeTotal).toBeCloseTo(100, 3);
      expect(Object.keys(split.sizes).sort()).toEqual(split.children.map((child) => child.id).sort());
    });
  });
});

test('workspace normalization rejects duplicate topology and repairs sizes', () => {
  const defaults = createDefaultStudioWorkspaceState();
  const broken = structuredClone(defaults);
  const layout = broken.layouts[0]!;
  if (layout.root.kind !== 'split') throw new Error('Expected split root');
  layout.root.children[1]!.id = layout.root.children[0]!.id;
  const normalizedBroken = normalizeStudioWorkspaceState(broken);
  expect(normalizedBroken.layouts[0]).toEqual(defaults.layouts[0]);

  const unbalanced = structuredClone(defaults);
  const root = unbalanced.layouts[0]!.root;
  if (root.kind !== 'split') throw new Error('Expected split root');
  root.sizes = Object.fromEntries(root.children.map((child, index) => [child.id, index + 1]));
  const normalized = normalizeStudioWorkspaceState(unbalanced);
  const normalizedRoot = normalized.layouts[0]!.root;
  if (normalizedRoot.kind !== 'split') throw new Error('Expected split root');
  expect(Object.values(normalizedRoot.sizes).reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 3);
});

test('tab, visibility, workspace, and resize operations are immutable', () => {
  const state = createDefaultStudioWorkspaceState();
  const layout = findStudioWorkspaceLayout(state, 'layout');
  const activated = activateStudioPanel(layout, 'layout-right', 'assistant');
  expect(activated).not.toBe(layout);
  expect(layout.root).not.toEqual(activated.root);
  expect(listNodes(activated.root).find((node) => node.id === 'layout-right')).toMatchObject({
    kind: 'stack',
    activePanelId: 'assistant',
  });

  const hidden = setStudioPanelOpen(activated, 'assets', false);
  expect(hidden.panels.find((panel) => panel.panelId === 'assets')?.open).toBe(false);
  expect(activated.panels.find((panel) => panel.panelId === 'assets')?.open).toBe(true);
  expect(listMobileSurfacePanelIds(hidden)).not.toContain('assets');

  const resized = resizeStudioSplit(hidden, 'layout-root', {
    'layout-left': 30,
    'layout-center': 50,
    'layout-right': 20,
  });
  const resizedRoot = findSplit(resized.root, 'layout-root');
  expect(resizedRoot?.sizes).toMatchObject({
    'layout-left': 30,
    'layout-center': 50,
    'layout-right': 20,
  });
  expect(findSplit(hidden.root, 'layout-root')?.sizes).not.toEqual(resizedRoot?.sizes);

  const updated = updateStudioWorkspaceLayout(state, resized);
  const selected = selectStudioWorkspace(updated, 'debugging');
  expect(selected.activeWorkspace).toBe('debugging');
  expect(state.activeWorkspace).toBe('layout');
});

test('split-tree storage round trips and corrupt data falls back safely', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const state = selectStudioWorkspace(createDefaultStudioWorkspaceState(), 'scripting');
  const saved = saveStudioWorkspaceState(state, storage);
  expect(values.has(STUDIO_WORKSPACE_LAYOUTS_KEY)).toBe(true);
  expect(loadStudioWorkspaceState(storage)).toEqual(saved);

  values.set(STUDIO_WORKSPACE_LAYOUTS_KEY, '{not-json');
  expect(loadStudioWorkspaceState(storage)).toEqual(createDefaultStudioWorkspaceState());
});

test('workspace state synchronizes local panel preferences without project data', () => {
  const preferences = createDefaultEditorPreferences();
  const configuredPreferences = {
    ...preferences,
    activeWorkspace: 'scripting' as const,
    workspaces: preferences.workspaces.map((workspace) => workspace.id !== 'scripting'
      ? workspace
      : {
          ...workspace,
          panels: workspace.panels.map((panel) => panel.id === 'scripts'
            ? { ...panel, open: false, size: 612 }
            : panel),
        }),
  };
  const state = createStudioWorkspaceStateFromEditorPreferences(configuredPreferences);
  expect(state.activeWorkspace).toBe('scripting');
  const scripting = findStudioWorkspaceLayout(state, 'scripting');
  expect(scripting.panels.find((panel) => panel.panelId === 'scripts')).toEqual({
    panelId: 'scripts',
    open: false,
    preferredSize: 612,
  });

  const nextScripting = setStudioPanelOpen(scripting, 'scripts', true);
  const nextState = updateStudioWorkspaceLayout(state, nextScripting);
  const synced = applyStudioWorkspaceStateToEditorPreferences(nextState, configuredPreferences);
  expect(synced.activeWorkspace).toBe('scripting');
  expect(synced.workspaces.find((workspace) => workspace.id === 'scripting')?.panels
    .find((panel) => panel.id === 'scripts')).toEqual({ id: 'scripts', open: true, size: 612 });
});

test('panel registry is deterministic and rejects duplicate definitions', () => {
  const registry = createStudioPanelRegistry();
  expect(registry.listForWorkspace('layout').map((panel) => panel.id)).toContain('viewport');
  expect(registry.listForWorkspace('scripting').map((panel) => panel.id)).toContain('scripts');
  expect(registry.listForWorkspace('debugging').map((panel) => panel.id)).toContain('profiler');
  expect(registry.list()).toBe(registry.list());

  expect(() => createStudioPanelRegistry([
    DEFAULT_STUDIO_PANEL_DEFINITIONS[0]!,
    DEFAULT_STUDIO_PANEL_DEFINITIONS[0]!,
  ])).toThrow(/Duplicate Studio panel definition/);
});
