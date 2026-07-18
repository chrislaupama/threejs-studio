import { expect, test } from '@playwright/test';
import {
  EDITOR_PREFERENCES_KEY,
  createDefaultEditorPreferences,
  loadEditorPreferences,
  normalizeEditorPreferences,
  saveEditorPreferences,
  updateWorkspacePanel,
} from '../src/editor/editorPreferences';

test('editor preferences are local, versioned, complete, and normalized', () => {
  const defaults = createDefaultEditorPreferences();
  expect(defaults.theme).toBe('dark');
  expect(defaults.density).toBe('compact');
  expect(defaults.workspaces.map((workspace) => workspace.id)).toEqual([
    'layout', 'scripting', 'animation', 'ui', 'debugging',
  ]);

  const normalized = normalizeEditorPreferences({
    version: 99,
    theme: 'light',
    density: 'comfortable',
    activeWorkspace: 'scripting',
    workspaces: [{ id: 'scripting', panels: [{ id: 'scripts', open: false, size: 4_000 }] }],
    keymap: { play: 'F6' },
  });
  expect(normalized.version).toBe(1);
  expect(normalized.activeWorkspace).toBe('scripting');
  expect(normalized.workspaces.find((workspace) => workspace.id === 'scripting')?.panels
    .find((panel) => panel.id === 'scripts')).toEqual({ id: 'scripts', open: false, size: 720 });
  expect(normalized.keymap.play).toBe('F6');
  expect(normalized.keymap.undo).toBe('Mod+Z');
});

test('editor preferences persist independently and panel changes are immutable', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const defaults = createDefaultEditorPreferences();
  const next = updateWorkspacePanel(defaults, 'layout', 'hierarchy', { open: false, size: 360 });
  expect(next).not.toBe(defaults);
  expect(defaults.workspaces[0]?.panels[0]?.open).toBe(true);

  saveEditorPreferences(next, storage);
  expect(values.has(EDITOR_PREFERENCES_KEY)).toBe(true);
  expect(loadEditorPreferences(storage)).toEqual(next);

  values.set(EDITOR_PREFERENCES_KEY, '{broken');
  expect(loadEditorPreferences(storage)).toEqual(defaults);
});
