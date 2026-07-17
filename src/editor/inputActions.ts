import type { InputAction, KeyboardInputBinding, ProjectDocument } from './types';

export const DEFAULT_MOVE_ACTION_ID = 'player.move';
export const KEYBOARD_CODE_PATTERN_SOURCE = '^(?:Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|(?:Alt|Control|Meta|Shift|OS)(?:Left|Right)|F(?:[1-9]|1[0-9]|2[0-4])|Numpad(?:[0-9]|Add|Backspace|Clear|ClearEntry|Comma|Decimal|Divide|Enter|Equal|Hash|MemoryAdd|MemoryClear|MemoryRecall|MemoryStore|MemorySubtract|Multiply|ParenLeft|ParenRight|Star|Subtract)|AudioVolume(?:Down|Mute|Up)|Browser(?:Back|Favorites|Forward|Home|Refresh|Search|Stop)|Launch(?:App1|App2|Mail)|Media(?:PlayPause|Select|Stop|TrackNext|TrackPrevious)|Abort|Again|Backquote|Backslash|Backspace|BracketLeft|BracketRight|CapsLock|Comma|ContextMenu|Convert|Copy|Cut|Delete|Eject|End|Enter|Equal|Escape|Find|Fn|FnLock|Help|Home|Hyper|Info|Insert|IntlBackslash|IntlRo|IntlYen|KanaMode|Lang[1-5]|Minus|NonConvert|NumLock|Open|PageDown|PageUp|Paste|Pause|Period|Power|PrintScreen|Props|Quote|ScrollLock|Select|Semicolon|Slash|Sleep|Space|Super|Tab|Undo|WakeUp)$';
export const KEYBOARD_CODE_PATTERN = new RegExp(KEYBOARD_CODE_PATTERN_SOURCE);

const DEFAULT_MOVE_BINDINGS: KeyboardInputBinding[] = [
  { id: 'player.move.key-a', code: 'KeyA', axis: 'x', scale: -1 },
  { id: 'player.move.key-d', code: 'KeyD', axis: 'x', scale: 1 },
  { id: 'player.move.key-w', code: 'KeyW', axis: 'y', scale: 1 },
  { id: 'player.move.key-s', code: 'KeyS', axis: 'y', scale: -1 },
  { id: 'player.move.arrow-left', code: 'ArrowLeft', axis: 'x', scale: -1 },
  { id: 'player.move.arrow-right', code: 'ArrowRight', axis: 'x', scale: 1 },
  { id: 'player.move.arrow-up', code: 'ArrowUp', axis: 'y', scale: 1 },
  { id: 'player.move.arrow-down', code: 'ArrowDown', axis: 'y', scale: -1 },
];

function createId(prefix: string) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}.${suffix}`;
}

function cloneProject(project: ProjectDocument): ProjectDocument {
  return structuredClone(project);
}

function touchProject(project: ProjectDocument) {
  project.updatedAt = new Date().toISOString();
  return project;
}

export function createKeyboardInputBinding(
  code: string,
  axis: KeyboardInputBinding['axis'],
  scale: KeyboardInputBinding['scale'],
  id = createId('binding'),
): KeyboardInputBinding {
  return { id, code, axis, scale };
}

export function createDefaultMoveInputAction(): InputAction {
  return {
    id: DEFAULT_MOVE_ACTION_ID,
    name: 'Move',
    type: 'axis2d',
    bindings: structuredClone(DEFAULT_MOVE_BINDINGS),
  };
}

export function createDefaultInputActions(): InputAction[] {
  return [createDefaultMoveInputAction()];
}

export function createAxis2dInputAction({
  id = createId('input'),
  name = 'New Move Action',
  bindings = [],
}: {
  id?: string;
  name?: string;
  bindings?: KeyboardInputBinding[];
} = {}): InputAction {
  return { id, name, type: 'axis2d', bindings: structuredClone(bindings) };
}

export function addInputAction(project: ProjectDocument, action: InputAction): ProjectDocument | null {
  const name = action.name.trim().toLowerCase();
  if (
    project.inputActions.some((candidate) => candidate.id === action.id) ||
    project.inputActions.some((candidate) => candidate.name.trim().toLowerCase() === name)
  ) {
    return null;
  }
  const next = cloneProject(project);
  next.inputActions.push(structuredClone(action));
  return touchProject(next);
}

export function updateInputAction(
  project: ProjectDocument,
  actionId: string,
  update: Partial<Pick<InputAction, 'name' | 'bindings'>> | ((action: InputAction) => InputAction),
): ProjectDocument | null {
  const index = project.inputActions.findIndex((action) => action.id === actionId);
  if (index < 0) return null;
  const current = structuredClone(project.inputActions[index]);
  const updated = typeof update === 'function'
    ? update(current)
    : { ...current, ...update, bindings: update.bindings ? structuredClone(update.bindings) : current.bindings };
  const duplicateName = project.inputActions.some(
    (action) => action.id !== actionId && action.name.trim().toLowerCase() === updated.name.trim().toLowerCase(),
  );
  if (duplicateName) return null;
  const next = cloneProject(project);
  next.inputActions[index] = {
    ...structuredClone(updated),
    id: actionId,
    type: 'axis2d',
  };
  return touchProject(next);
}

export interface InputActionReference {
  nodeId: string;
  nodeName: string;
  componentId: string;
}

export function getInputActionReferences(project: ProjectDocument, actionId: string): InputActionReference[] {
  return project.nodes.flatMap((node) => node.components.flatMap((component) => (
    component.type === 'keyboardMove' && component.actionId === actionId
      ? [{ nodeId: node.id, nodeName: node.name, componentId: component.id }]
      : []
  )));
}

export function isInputActionReferenced(project: ProjectDocument, actionId: string) {
  return getInputActionReferences(project, actionId).length > 0;
}

export function deleteInputAction(project: ProjectDocument, actionId: string): ProjectDocument | null {
  if (!project.inputActions.some((action) => action.id === actionId) || isInputActionReferenced(project, actionId)) return null;
  const next = cloneProject(project);
  next.inputActions = next.inputActions.filter((action) => action.id !== actionId);
  return touchProject(next);
}

export function getInputActionCodes(actions: readonly InputAction[]): Set<string> {
  return new Set(actions.flatMap((action) => action.bindings.map((binding) => binding.code)));
}

export function isInputShortcutChord({
  code,
  metaKey,
  ctrlKey,
  altKey,
}: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>) {
  const isOwnModifier = (prefix: 'Meta' | 'Control' | 'Alt') => code === `${prefix}Left` || code === `${prefix}Right`;
  return (
    (metaKey && !isOwnModifier('Meta')) ||
    (ctrlKey && !isOwnModifier('Control')) ||
    (altKey && !isOwnModifier('Alt'))
  );
}

export function resolveAxis2dAction(action: InputAction, pressedCodes: ReadonlySet<string>): [number, number] {
  let x = 0;
  let y = 0;
  for (const binding of action.bindings) {
    if (!pressedCodes.has(binding.code)) continue;
    if (binding.axis === 'x') x += binding.scale;
    else y += binding.scale;
  }
  x = Math.max(-1, Math.min(1, x));
  y = Math.max(-1, Math.min(1, y));
  const length = Math.hypot(x, y);
  return length > 1 ? [x / length, y / length] : [x, y];
}

export function resolveInputAction(
  project: Pick<ProjectDocument, 'inputActions'>,
  actionId: string,
  pressedCodes: ReadonlySet<string>,
): [number, number] {
  const action = project.inputActions.find((candidate) => candidate.id === actionId);
  return action ? resolveAxis2dAction(action, pressedCodes) : [0, 0];
}
