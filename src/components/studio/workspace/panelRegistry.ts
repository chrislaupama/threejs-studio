import type { StudioPanelId, StudioWorkspaceId } from './layoutModel';

export type StudioPanelRegion = 'left' | 'center' | 'right' | 'bottom';
export type StudioMobilePanelSurface = 'primary' | 'left-sheet' | 'right-sheet' | 'bottom-drawer';

export interface StudioPanelDefinition {
  id: StudioPanelId;
  label: string;
  description: string;
  region: StudioPanelRegion;
  mobileSurface: StudioMobilePanelSurface;
  workspaces: readonly StudioWorkspaceId[];
  scrollable: boolean;
}

export interface StudioPanelRegistry {
  get(panelId: StudioPanelId): StudioPanelDefinition | undefined;
  has(panelId: StudioPanelId): boolean;
  list(): readonly StudioPanelDefinition[];
  listForWorkspace(workspaceId: StudioWorkspaceId): readonly StudioPanelDefinition[];
}

export const DEFAULT_STUDIO_PANEL_DEFINITIONS: readonly StudioPanelDefinition[] = [
  {
    id: 'viewport',
    label: 'Viewport',
    description: 'Scene and game rendering surface.',
    region: 'center',
    mobileSurface: 'primary',
    workspaces: ['layout', 'debugging'],
    scrollable: false,
  },
  {
    id: 'hierarchy',
    label: 'Objects',
    description: 'Scene hierarchy and entity selection.',
    region: 'left',
    mobileSurface: 'left-sheet',
    workspaces: ['layout', 'scripting', 'debugging'],
    scrollable: true,
  },
  {
    id: 'inspector',
    label: 'Details',
    description: 'Inspector for the current selection.',
    region: 'right',
    mobileSurface: 'right-sheet',
    workspaces: ['layout', 'scripting', 'debugging'],
    scrollable: true,
  },
  {
    id: 'assets',
    label: 'Assets',
    description: 'Project files, assets, and import status.',
    region: 'bottom',
    mobileSurface: 'bottom-drawer',
    workspaces: ['layout'],
    scrollable: true,
  },
  {
    id: 'console',
    label: 'Console',
    description: 'Editor and runtime diagnostics.',
    region: 'bottom',
    mobileSurface: 'bottom-drawer',
    workspaces: ['scripting', 'debugging'],
    scrollable: false,
  },
  {
    id: 'assistant',
    label: 'Assistant',
    description: 'AI authoring plans, approvals, and tool results.',
    region: 'right',
    mobileSurface: 'right-sheet',
    workspaces: ['layout', 'scripting', 'debugging'],
    scrollable: true,
  },
  {
    id: 'scripts',
    label: 'Scripts',
    description: 'Project behavior scripts and compiler diagnostics.',
    region: 'center',
    mobileSurface: 'bottom-drawer',
    workspaces: ['scripting'],
    scrollable: false,
  },
  {
    id: 'profiler',
    label: 'Profiler',
    description: 'Frame, render, physics, script, and asset budgets.',
    region: 'bottom',
    mobileSurface: 'bottom-drawer',
    workspaces: ['debugging'],
    scrollable: true,
  },
];

export function createStudioPanelRegistry(
  definitions: readonly StudioPanelDefinition[] = DEFAULT_STUDIO_PANEL_DEFINITIONS,
): StudioPanelRegistry {
  const byId = new Map<StudioPanelId, StudioPanelDefinition>();
  definitions.forEach((definition) => {
    if (byId.has(definition.id)) {
      throw new Error(`Duplicate Studio panel definition: ${definition.id}`);
    }
    if (!definition.label.trim() || !definition.description.trim()) {
      throw new Error(`Studio panel ${definition.id} requires a label and description.`);
    }
    byId.set(definition.id, Object.freeze({
      ...definition,
      workspaces: Object.freeze([...definition.workspaces]),
    }));
  });
  const snapshot = Object.freeze([...byId.values()]);
  return Object.freeze({
    get: (panelId: StudioPanelId) => byId.get(panelId),
    has: (panelId: StudioPanelId) => byId.has(panelId),
    list: () => snapshot,
    listForWorkspace: (workspaceId: StudioWorkspaceId) => snapshot.filter((definition) => (
      definition.workspaces.includes(workspaceId)
    )),
  });
}

export const DEFAULT_STUDIO_PANEL_REGISTRY = createStudioPanelRegistry();

export const STUDIO_WORKSPACE_LABELS: Readonly<Record<StudioWorkspaceId, string>> = {
  layout: 'Layout',
  scripting: 'Scripting',
  debugging: 'Debugging',
};
