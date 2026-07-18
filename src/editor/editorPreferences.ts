export const EDITOR_PREFERENCES_KEY = 'threejs-studio:editor-preferences:v1';

export type EditorTheme = 'dark' | 'light' | 'system';
export type EditorDensity = 'compact' | 'comfortable';
export type EditorWorkspaceId = 'layout' | 'scripting' | 'animation' | 'ui' | 'debugging';
export type EditorPanelId =
  | 'hierarchy'
  | 'inspector'
  | 'assets'
  | 'console'
  | 'assistant'
  | 'scripts'
  | 'animation'
  | 'runtime-ui'
  | 'profiler';

export interface EditorPanelPreference {
  id: EditorPanelId;
  open: boolean;
  size: number;
}

export interface EditorWorkspacePreference {
  id: EditorWorkspaceId;
  panels: EditorPanelPreference[];
}

export interface EditorKeymapPreference {
  commandPalette: string;
  play: string;
  stop: string;
  undo: string;
  redo: string;
}

export interface EditorPreferences {
  version: 1;
  theme: EditorTheme;
  density: EditorDensity;
  activeWorkspace: EditorWorkspaceId;
  workspaces: EditorWorkspacePreference[];
  keymap: EditorKeymapPreference;
}

export interface EditorPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const workspaceIds: readonly EditorWorkspaceId[] = ['layout', 'scripting', 'animation', 'ui', 'debugging'];
const panelIds: readonly EditorPanelId[] = [
  'hierarchy',
  'inspector',
  'assets',
  'console',
  'assistant',
  'scripts',
  'animation',
  'runtime-ui',
  'profiler',
];

const defaultPanelSizes: Readonly<Record<EditorPanelId, number>> = {
  hierarchy: 244,
  inspector: 310,
  assets: 218,
  console: 218,
  assistant: 330,
  scripts: 420,
  animation: 280,
  'runtime-ui': 320,
  profiler: 280,
};

const workspacePanels: Readonly<Record<EditorWorkspaceId, readonly EditorPanelId[]>> = {
  layout: ['hierarchy', 'inspector', 'assets'],
  scripting: ['hierarchy', 'scripts', 'console', 'inspector'],
  animation: ['hierarchy', 'animation', 'inspector'],
  ui: ['hierarchy', 'runtime-ui', 'inspector'],
  debugging: ['hierarchy', 'console', 'profiler', 'inspector'],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clampPanelSize = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(720, Math.max(160, value)));
};

const defaultWorkspace = (id: EditorWorkspaceId): EditorWorkspacePreference => ({
  id,
  panels: workspacePanels[id].map((panelId) => ({
    id: panelId,
    open: true,
    size: defaultPanelSizes[panelId],
  })),
});

export function createDefaultEditorPreferences(): EditorPreferences {
  return {
    version: 1,
    theme: 'dark',
    density: 'compact',
    activeWorkspace: 'layout',
    workspaces: workspaceIds.map(defaultWorkspace),
    keymap: {
      commandPalette: 'Mod+K',
      play: 'Mod+Enter',
      stop: 'Escape',
      undo: 'Mod+Z',
      redo: 'Mod+Shift+Z',
    },
  };
}

export function normalizeEditorPreferences(value: unknown): EditorPreferences {
  const defaults = createDefaultEditorPreferences();
  if (!isRecord(value)) return defaults;

  const theme: EditorTheme = value.theme === 'light' || value.theme === 'system' ? value.theme : 'dark';
  const density: EditorDensity = value.density === 'comfortable' ? 'comfortable' : 'compact';
  const activeWorkspace = workspaceIds.includes(value.activeWorkspace as EditorWorkspaceId)
    ? value.activeWorkspace as EditorWorkspaceId
    : defaults.activeWorkspace;
  const suppliedWorkspaces = Array.isArray(value.workspaces) ? value.workspaces : [];
  const workspaces = workspaceIds.map((workspaceId) => {
    const fallback = defaultWorkspace(workspaceId);
    const supplied = suppliedWorkspaces.find((entry) => isRecord(entry) && entry.id === workspaceId);
    if (!isRecord(supplied) || !Array.isArray(supplied.panels)) return fallback;
    const suppliedPanels = supplied.panels;
    return {
      id: workspaceId,
      panels: fallback.panels.map((panel) => {
        const candidate = suppliedPanels.find((entry) => isRecord(entry) && entry.id === panel.id);
        return isRecord(candidate)
          ? {
              id: panel.id,
              open: typeof candidate.open === 'boolean' ? candidate.open : panel.open,
              size: clampPanelSize(candidate.size, panel.size),
            }
          : panel;
      }),
    };
  });
  const keymapValue = isRecord(value.keymap) ? value.keymap : {};
  const keymap = Object.fromEntries(Object.entries(defaults.keymap).map(([key, fallback]) => [
    key,
    typeof keymapValue[key] === 'string' && keymapValue[key].trim() ? keymapValue[key] : fallback,
  ])) as unknown as EditorKeymapPreference;

  return { version: 1, theme, density, activeWorkspace, workspaces, keymap };
}

export function loadEditorPreferences(storage?: EditorPreferencesStorage): EditorPreferences {
  if (!storage) return createDefaultEditorPreferences();
  try {
    const serialized = storage.getItem(EDITOR_PREFERENCES_KEY);
    return normalizeEditorPreferences(serialized ? JSON.parse(serialized) : null);
  } catch {
    return createDefaultEditorPreferences();
  }
}

export function saveEditorPreferences(
  preferences: EditorPreferences,
  storage?: EditorPreferencesStorage,
): EditorPreferences {
  const normalized = normalizeEditorPreferences(preferences);
  if (!storage) return normalized;
  storage.setItem(EDITOR_PREFERENCES_KEY, JSON.stringify(normalized));
  return normalized;
}

export function updateWorkspacePanel(
  preferences: EditorPreferences,
  workspaceId: EditorWorkspaceId,
  panelId: EditorPanelId,
  changes: Partial<Pick<EditorPanelPreference, 'open' | 'size'>>,
): EditorPreferences {
  const normalized = normalizeEditorPreferences(preferences);
  if (!panelIds.includes(panelId)) return normalized;
  return {
    ...normalized,
    workspaces: normalized.workspaces.map((workspace) => workspace.id !== workspaceId
      ? workspace
      : {
          ...workspace,
          panels: workspace.panels.map((panel) => panel.id !== panelId
            ? panel
            : {
                ...panel,
                open: typeof changes.open === 'boolean' ? changes.open : panel.open,
                size: changes.size === undefined ? panel.size : clampPanelSize(changes.size, panel.size),
              }),
        }),
  };
}
