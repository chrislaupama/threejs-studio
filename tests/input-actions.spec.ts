import { expect, test } from '@playwright/test';
import {
  DEFAULT_MOVE_ACTION_ID,
  addInputAction,
  createAxis2dInputAction,
  createDefaultInputActions,
  createKeyboardInputBinding,
  deleteInputAction,
  getInputActionReferences,
  isInputShortcutChord,
  isInputActionReferenced,
  resolveAxis2dAction,
  resolveInputAction,
  updateInputAction,
} from '../src/editor/inputActions';
import { buildRuntimeHtml, createStarterProject, loadProjectDocument, updateNode } from '../src/editor/project';

test('default move action is stable, isolated, and resolves normalized keyboard vectors', () => {
  const first = createDefaultInputActions();
  const second = createDefaultInputActions();
  expect(first).toEqual(second);
  expect(first).not.toBe(second);
  expect(first[0]?.id).toBe(DEFAULT_MOVE_ACTION_ID);
  expect(first[0]?.bindings.map((binding) => binding.code)).toEqual([
    'KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  ]);

  first[0]!.bindings[0]!.code = 'KeyQ';
  expect(second[0]?.bindings[0]?.code).toBe('KeyA');

  const project = createStarterProject();
  const diagonal = resolveInputAction(project, DEFAULT_MOVE_ACTION_ID, new Set(['KeyW', 'KeyD']));
  expect(diagonal[0]).toBeCloseTo(Math.SQRT1_2);
  expect(diagonal[1]).toBeCloseTo(Math.SQRT1_2);
  expect(Math.hypot(...diagonal)).toBeCloseTo(1);
  expect(resolveInputAction(project, DEFAULT_MOVE_ACTION_ID, new Set(['KeyA', 'KeyD']))).toEqual([0, 0]);
  expect(resolveInputAction(project, 'missing.action', new Set(['KeyW']))).toEqual([0, 0]);
});

test('single modifier bindings remain playable while browser shortcut chords stay isolated', () => {
  const event = (code: string, flags: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>> = {}) => ({
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...flags,
  });

  expect(isInputShortcutChord(event('ControlLeft', { ctrlKey: true }))).toBe(false);
  expect(isInputShortcutChord(event('AltRight', { altKey: true }))).toBe(false);
  expect(isInputShortcutChord(event('MetaLeft', { metaKey: true }))).toBe(false);
  expect(isInputShortcutChord(event('KeyW', { ctrlKey: true }))).toBe(true);
  expect(isInputShortcutChord(event('ControlLeft', { ctrlKey: true, altKey: true }))).toBe(true);
});

test('pure input action helpers add, update, reference-check, and safely delete actions', () => {
  const original = createStarterProject();
  const before = JSON.stringify(original);
  const dash = createAxis2dInputAction({
    id: 'player.dash',
    name: 'Dash direction',
    bindings: [createKeyboardInputBinding('KeyL', 'x', 1, 'player.dash.key-l')],
  });
  const added = addInputAction(original, dash);
  expect(added).not.toBeNull();
  expect(JSON.stringify(original)).toBe(before);
  expect(added?.inputActions).toHaveLength(2);
  expect(addInputAction(added!, { ...dash, id: 'player.other' })).toBeNull();

  const updated = updateInputAction(added!, dash.id, {
    name: 'Aim direction',
    bindings: [createKeyboardInputBinding('KeyJ', 'x', -1, 'player.dash.key-j')],
  });
  expect(updated?.inputActions.find((action) => action.id === dash.id)).toMatchObject({
    id: dash.id,
    name: 'Aim direction',
    type: 'axis2d',
    bindings: [{ code: 'KeyJ', axis: 'x', scale: -1 }],
  });

  const referenced = updateNode(updated!, 'player-rig', (node) => ({
    ...node,
    components: node.components.map((component) => (
      component.type === 'keyboardMove' ? { ...component, actionId: dash.id } : component
    )),
  }));
  expect(getInputActionReferences(referenced, dash.id)).toEqual([
    { nodeId: 'player-rig', nodeName: 'Player Rig', componentId: 'player-move' },
  ]);
  expect(isInputActionReferenced(referenced, dash.id)).toBe(true);
  expect(deleteInputAction(referenced, dash.id)).toBeNull();

  const removed = deleteInputAction(updated!, dash.id);
  expect(removed?.inputActions.some((action) => action.id === dash.id)).toBe(false);
  expect(updated?.inputActions.some((action) => action.id === dash.id)).toBe(true);
});

test('axis resolver clamps duplicate directions and ignores unbound codes', () => {
  const action = createAxis2dInputAction({
    id: 'test.move',
    name: 'Test Move',
    bindings: [
      createKeyboardInputBinding('KeyW', 'y', 1, 'test.move.w'),
      createKeyboardInputBinding('ArrowUp', 'y', 1, 'test.move.up'),
      createKeyboardInputBinding('KeyA', 'x', -1, 'test.move.a'),
    ],
  });
  expect(resolveAxis2dAction(action, new Set(['KeyW', 'ArrowUp']))).toEqual([0, 1]);
  expect(resolveAxis2dAction(action, new Set(['Space']))).toEqual([0, 0]);
  const diagonal = resolveAxis2dAction(action, new Set(['ArrowUp', 'KeyA']));
  expect(diagonal[0]).toBeCloseTo(-Math.SQRT1_2);
  expect(diagonal[1]).toBeCloseTo(Math.SQRT1_2);
});

test('schema validation rejects invalid or duplicate actions, bindings, and dangling component references', () => {
  const duplicate = createStarterProject();
  duplicate.inputActions.push({
    ...structuredClone(duplicate.inputActions[0]!),
    id: 'player.look',
    name: ' move ',
  });
  const duplicateResult = loadProjectDocument(duplicate);
  expect(duplicateResult.ok).toBe(false);
  if (!duplicateResult.ok) {
    expect(duplicateResult.errors).toContain('inputActions[1].name duplicates input action name "move".');
    expect(duplicateResult.errors.some((error) => error.includes('duplicates binding id'))).toBe(true);
  }

  const malformed = createStarterProject() as unknown as Record<string, unknown>;
  const actions = malformed.inputActions as Array<Record<string, unknown>>;
  actions[0]!.id = 'bad action id';
  actions[0]!.name = '   ';
  const bindings = actions[0]!.bindings as Array<Record<string, unknown>>;
  bindings[0] = { id: '', code: 'Key A', axis: 'z', scale: 0 };
  bindings.push({ id: 'unique-binding', code: 'KeyD', axis: 'x', scale: 1 });
  const malformedResult = loadProjectDocument(malformed);
  expect(malformedResult.ok).toBe(false);
  if (!malformedResult.ok) {
    expect(malformedResult.errors).toEqual(expect.arrayContaining([
      'inputActions[0].id must be a non-empty stable identifier.',
      'inputActions[0].name must not be empty.',
      'inputActions[0].bindings[0].id must be a non-empty stable identifier.',
      'inputActions[0].bindings[0].code must be a supported KeyboardEvent.code identifier.',
      'inputActions[0].bindings[0].axis must be "x" or "y".',
      'inputActions[0].bindings[0].scale must be -1 or 1.',
      'inputActions[0].bindings[8].code duplicates keyboard binding "KeyD" in this action.',
    ]));
  }

  const dangling = createStarterProject();
  const player = dangling.nodes.find((node) => node.id === 'player-rig')!;
  player.components = player.components.map((component) => (
    component.type === 'keyboardMove' ? { ...component, actionId: 'missing.move' } : component
  ));
  const danglingResult = loadProjectDocument(dangling);
  expect(danglingResult.ok).toBe(false);
  if (!danglingResult.ok) {
    expect(danglingResult.errors).toContain('nodes[7].components[0].actionId references missing input action "missing.move".');
  }
});

test('standalone runtime consumes authored KeyboardEvent.code bindings and clears transient input', () => {
  const project = createStarterProject();
  const rebound = updateInputAction(project, DEFAULT_MOVE_ACTION_ID, {
    bindings: [
      createKeyboardInputBinding('KeyJ', 'x', -1, 'player.move.key-j'),
      createKeyboardInputBinding('KeyL', 'x', 1, 'player.move.key-l'),
      createKeyboardInputBinding('KeyI', 'y', 1, 'player.move.key-i'),
      createKeyboardInputBinding('KeyK', 'y', -1, 'player.move.key-k'),
    ],
  });
  expect(rebound).not.toBeNull();
  const html = buildRuntimeHtml(rebound!);
  expect(html).toContain('project.inputActions');
  expect(html).toContain('event.code');
  expect(html).toContain("event.ctrlKey&&event.code!=='ControlLeft'&&event.code!=='ControlRight'");
  expect(html).toContain('resolveAction(component.actionId)');
  expect(html).toContain('visibilitychange');
  expect(html).toContain('document.hidden');
  expect(html).toContain('KeyI');
  expect(html).not.toContain('event.key.toLowerCase');
  expect(html).not.toContain("const moveKeys=new Set(['w'");
});
