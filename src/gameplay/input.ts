export const DEFAULT_INPUT_CONTEXT_ID = 'default';

export type InputActionType = 'button' | 'axis1d' | 'axis2d';
export type InputActionPhase = 'started' | 'performed' | 'canceled';
export type InputActionStatePhase = 'waiting' | InputActionPhase;
export type InputBindingOutput = 'x' | 'y';

interface InputBindingBase {
  id: string;
  /** Output channel for axis2d actions. Other action types use x. */
  output?: InputBindingOutput;
  /** Multiplier applied after the device value and dead zone. */
  scale?: number;
  /** Normalized device dead zone in the range [0, 1). */
  deadZone?: number;
}

export interface KeyboardInputBinding extends InputBindingBase {
  device: 'keyboard';
  /** Physical KeyboardEvent.code supplied by a browser host adapter. */
  code: string;
}

export type PointerControl =
  | 'button'
  | 'positionX'
  | 'positionY'
  | 'deltaX'
  | 'deltaY'
  | 'wheelX'
  | 'wheelY';

export interface PointerInputBinding extends InputBindingBase {
  device: 'pointer';
  control: PointerControl;
  /** Required when control is button. */
  button?: number;
}

export type TouchControl = 'pressed' | 'positionX' | 'positionY' | 'deltaX' | 'deltaY';

export interface TouchInputBinding extends InputBindingBase {
  device: 'touch';
  control: TouchControl;
  /** Omit to read the strongest matching value from any active touch. */
  touchId?: number;
}

export interface GamepadInputBinding extends InputBindingBase {
  device: 'gamepad';
  gamepad: number;
  control: 'button' | 'axis';
  index: number;
}

export type InputBinding =
  | KeyboardInputBinding
  | PointerInputBinding
  | TouchInputBinding
  | GamepadInputBinding;

export interface InputContextDefinition {
  id: string;
  name: string;
  enabled?: boolean;
  priority?: number;
  /** Consume actuated physical controls before lower-priority contexts resolve. */
  consume?: boolean;
}

export interface InputActionDefinition {
  id: string;
  name: string;
  type: InputActionType;
  contextId?: string;
  enabled?: boolean;
  bindings: InputBinding[];
  /** Clamp axis2d magnitude to one. Defaults to true. */
  normalize?: boolean;
  /** Button actuation threshold. Defaults to 0.5. */
  activationThreshold?: number;
  /** Axis activation and change threshold. Defaults to 0.0001. */
  changeEpsilon?: number;
}

export interface InputActionMap {
  contexts?: InputContextDefinition[];
  actions: InputActionDefinition[];
}

/**
 * Stable, allocation-free state returned by InputRuntime. The object and value
 * tuple are updated in place, so callers must copy them before retaining a
 * historical sample.
 */
export interface InputActionState {
  readonly id: string;
  readonly type: InputActionType;
  readonly value: [number, number];
  active: boolean;
  phase: InputActionStatePhase;
  frame: number;
}

/** Valid until the next InputRuntime.update() call. */
export interface InputActionEvent {
  readonly actionId: string;
  phase: InputActionPhase;
  readonly value: [number, number];
  frame: number;
}

export interface InputRuntimeDiagnostics {
  frame: number;
  actionCount: number;
  activeActions: number;
  contextCount: number;
  enabledContexts: number;
  eventCount: number;
  keyboardKeys: number;
  activeTouches: number;
  connectedGamepads: number;
}

interface MutableInputActionState extends InputActionState {
  value: [number, number];
}

interface MutableInputActionEvent extends InputActionEvent {
  actionId: string;
  value: [number, number];
}

interface CompiledBinding {
  definition: InputBinding;
  sourceKey: string;
}

interface CompiledAction {
  definition: InputActionDefinition;
  bindings: CompiledBinding[];
  state: MutableInputActionState;
  enabled: boolean;
}

interface RuntimeContext {
  definition: Required<Pick<InputContextDefinition, 'id' | 'name' | 'enabled' | 'priority' | 'consume'>>;
  actionIndexes: number[];
  enabled: boolean;
  order: number;
}

interface TouchState {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

interface GamepadState {
  buttons: Float32Array;
  axes: Float32Array;
}

const DEFAULT_CHANGE_EPSILON = 0.0001;
const DEFAULT_BUTTON_THRESHOLD = 0.5;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateBinding(binding: InputBinding, action: InputActionDefinition, path: string, errors: string[]) {
  if (!binding.id.trim()) errors.push(`${path}.id must be a non-empty string.`);
  if (binding.output !== undefined && binding.output !== 'x' && binding.output !== 'y') {
    errors.push(`${path}.output must be "x" or "y".`);
  }
  if (action.type === 'axis2d' && binding.output === undefined) {
    errors.push(`${path}.output is required for axis2d actions.`);
  }
  if (binding.scale !== undefined && !isFiniteNumber(binding.scale)) {
    errors.push(`${path}.scale must be finite.`);
  }
  if (binding.deadZone !== undefined && (!isFiniteNumber(binding.deadZone) || binding.deadZone < 0 || binding.deadZone >= 1)) {
    errors.push(`${path}.deadZone must be in the range [0, 1).`);
  }

  if (binding.device === 'keyboard') {
    if (!binding.code.trim()) errors.push(`${path}.code must be a non-empty string.`);
    return;
  }
  if (binding.device === 'pointer') {
    if (binding.control === 'button' && (!Number.isInteger(binding.button) || (binding.button ?? -1) < 0)) {
      errors.push(`${path}.button must be a non-negative integer for pointer button bindings.`);
    }
    return;
  }
  if (binding.device === 'touch') {
    if (binding.touchId !== undefined && (!Number.isInteger(binding.touchId) || binding.touchId < 0)) {
      errors.push(`${path}.touchId must be a non-negative integer.`);
    }
    return;
  }
  if (!Number.isInteger(binding.gamepad) || binding.gamepad < 0) {
    errors.push(`${path}.gamepad must be a non-negative integer.`);
  }
  if (!Number.isInteger(binding.index) || binding.index < 0) {
    errors.push(`${path}.index must be a non-negative integer.`);
  }
}

/** Validate a serializable map without reading DOM or device globals. */
export function validateInputActionMap(map: InputActionMap): string[] {
  const errors: string[] = [];
  const contextIds = new Set<string>([DEFAULT_INPUT_CONTEXT_ID]);
  const actionIds = new Set<string>();
  const bindingIds = new Set<string>();

  for (const [index, context] of (map.contexts ?? []).entries()) {
    const path = `contexts[${index}]`;
    if (!context.id.trim()) errors.push(`${path}.id must be a non-empty string.`);
    if (!context.name.trim()) errors.push(`${path}.name must be a non-empty string.`);
    if (contextIds.has(context.id) && context.id !== DEFAULT_INPUT_CONTEXT_ID) {
      errors.push(`${path}.id duplicates context "${context.id}".`);
    } else if (context.id === DEFAULT_INPUT_CONTEXT_ID && (map.contexts ?? []).slice(0, index).some((entry) => entry.id === context.id)) {
      errors.push(`${path}.id duplicates context "${context.id}".`);
    }
    contextIds.add(context.id);
    if (context.priority !== undefined && !isFiniteNumber(context.priority)) {
      errors.push(`${path}.priority must be finite.`);
    }
  }

  for (const [actionIndex, action] of map.actions.entries()) {
    const path = `actions[${actionIndex}]`;
    if (!action.id.trim()) errors.push(`${path}.id must be a non-empty string.`);
    if (!action.name.trim()) errors.push(`${path}.name must be a non-empty string.`);
    if (actionIds.has(action.id)) errors.push(`${path}.id duplicates action "${action.id}".`);
    actionIds.add(action.id);
    const contextId = action.contextId ?? DEFAULT_INPUT_CONTEXT_ID;
    if (!contextIds.has(contextId)) errors.push(`${path}.contextId references missing context "${contextId}".`);
    if (action.activationThreshold !== undefined && (
      !isFiniteNumber(action.activationThreshold) || action.activationThreshold < 0 || action.activationThreshold > 1
    )) {
      errors.push(`${path}.activationThreshold must be in the range [0, 1].`);
    }
    if (action.changeEpsilon !== undefined && (!isFiniteNumber(action.changeEpsilon) || action.changeEpsilon < 0)) {
      errors.push(`${path}.changeEpsilon must be finite and non-negative.`);
    }
    for (const [bindingIndex, binding] of action.bindings.entries()) {
      const bindingPath = `${path}.bindings[${bindingIndex}]`;
      if (bindingIds.has(binding.id)) errors.push(`${bindingPath}.id duplicates binding "${binding.id}".`);
      bindingIds.add(binding.id);
      validateBinding(binding, action, bindingPath, errors);
    }
  }

  return errors;
}

function bindingSourceKey(binding: InputBinding): string {
  if (binding.device === 'keyboard') return `keyboard:${binding.code}`;
  if (binding.device === 'pointer') {
    return binding.control === 'button'
      ? `pointer:button:${binding.button ?? 0}`
      : `pointer:${binding.control}`;
  }
  if (binding.device === 'touch') return `touch:${binding.control}`;
  return `gamepad:${binding.gamepad}:${binding.control}:${binding.index}`;
}

function applyDeadZone(value: number, deadZone = 0): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) return 0;
  if (deadZone === 0 || magnitude > 1) return value;
  return Math.sign(value) * ((magnitude - deadZone) / (1 - deadZone));
}

function growFloatArray(current: Float32Array, index: number): Float32Array {
  if (index < current.length) return current;
  let length = Math.max(4, current.length);
  while (length <= index) length *= 2;
  const next = new Float32Array(length);
  next.set(current);
  return next;
}

/**
 * Host-agnostic, allocation-conscious action resolver. Browser event adapters,
 * touch UI, and gamepad polling feed values through the setter methods; the
 * simulation calls update exactly once per game tick.
 */
export class InputRuntime {
  private readonly actions: CompiledAction[];
  private readonly actionsById = new Map<string, CompiledAction>();
  private readonly contexts: RuntimeContext[];
  private readonly contextsById = new Map<string, RuntimeContext>();
  private readonly keyboard = new Map<string, number>();
  private readonly pointerButtons = new Map<number, number>();
  private pointerX = 0;
  private pointerY = 0;
  private pointerDeltaX = 0;
  private pointerDeltaY = 0;
  private wheelX = 0;
  private wheelY = 0;
  private readonly touches = new Map<number, TouchState>();
  private readonly gamepads = new Map<number, GamepadState>();
  private readonly consumedSources = new Set<string>();
  private readonly contextSources = new Set<string>();
  private readonly eventBuffer: MutableInputActionEvent[];
  private currentEventCount = 0;
  private currentFrame = 0;

  constructor(map: InputActionMap) {
    const errors = validateInputActionMap(map);
    if (errors.length > 0) throw new TypeError(`Invalid InputActionMap:\n${errors.join('\n')}`);

    const contextDefinitions = (map.contexts ?? []).map((context, order): RuntimeContext => ({
      definition: {
        id: context.id,
        name: context.name,
        enabled: context.enabled ?? true,
        priority: context.priority ?? 0,
        consume: context.consume ?? false,
      },
      enabled: context.enabled ?? true,
      actionIndexes: [],
      order,
    }));
    if (!contextDefinitions.some((context) => context.definition.id === DEFAULT_INPUT_CONTEXT_ID)) {
      contextDefinitions.push({
        definition: {
          id: DEFAULT_INPUT_CONTEXT_ID,
          name: 'Default',
          enabled: true,
          priority: 0,
          consume: false,
        },
        enabled: true,
        actionIndexes: [],
        order: contextDefinitions.length,
      });
    }

    this.actions = map.actions.map((action): CompiledAction => {
      const definition: InputActionDefinition = {
        ...action,
        bindings: action.bindings.map((binding) => ({ ...binding })),
      };
      const state: MutableInputActionState = {
        id: definition.id,
        type: definition.type,
        value: [0, 0],
        active: false,
        phase: 'waiting',
        frame: 0,
      };
      const compiled = {
        definition,
        bindings: definition.bindings.map((binding) => ({
          definition: binding,
          sourceKey: bindingSourceKey(binding),
        })),
        state,
        enabled: definition.enabled ?? true,
      };
      this.actionsById.set(definition.id, compiled);
      return compiled;
    });

    for (const context of contextDefinitions) this.contextsById.set(context.definition.id, context);
    for (const [index, action] of this.actions.entries()) {
      this.contextsById.get(action.definition.contextId ?? DEFAULT_INPUT_CONTEXT_ID)!.actionIndexes.push(index);
    }
    this.contexts = contextDefinitions.sort((left, right) =>
      right.definition.priority - left.definition.priority || left.order - right.order,
    );

    this.eventBuffer = Array.from({ length: Math.max(1, this.actions.length * 2) }, (): MutableInputActionEvent => ({
      actionId: '',
      phase: 'performed',
      value: [0, 0],
      frame: 0,
    }));
  }

  get frame() {
    return this.currentFrame;
  }

  get eventCount() {
    return this.currentEventCount;
  }

  getActionState(actionId: string): Readonly<InputActionState> | undefined {
    return this.actionsById.get(actionId)?.state;
  }

  eventAt(index: number): Readonly<InputActionEvent> | undefined {
    return index >= 0 && index < this.currentEventCount ? this.eventBuffer[index] : undefined;
  }

  forEachEvent(listener: (event: Readonly<InputActionEvent>) => void) {
    for (let index = 0; index < this.currentEventCount; index += 1) listener(this.eventBuffer[index]);
  }

  setContextEnabled(contextId: string, enabled: boolean): boolean {
    const context = this.contextsById.get(contextId);
    if (!context) return false;
    context.enabled = enabled;
    return true;
  }

  setActionEnabled(actionId: string, enabled: boolean): boolean {
    const action = this.actionsById.get(actionId);
    if (!action) return false;
    action.enabled = enabled;
    return true;
  }

  setKeyboardKey(code: string, pressed: boolean) {
    if (pressed) this.keyboard.set(code, 1);
    else this.keyboard.delete(code);
  }

  setPointerButton(button: number, pressed: boolean | number) {
    if (!Number.isInteger(button) || button < 0) throw new TypeError('Pointer button must be a non-negative integer.');
    if (typeof pressed === 'number' && !Number.isFinite(pressed)) throw new TypeError('Pointer button value must be finite.');
    const value = typeof pressed === 'boolean' ? (pressed ? 1 : 0) : Math.max(0, Math.min(1, pressed));
    if (value === 0) this.pointerButtons.delete(button);
    else this.pointerButtons.set(button, value);
  }

  setPointerPosition(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Pointer position must be finite.');
    this.pointerX = x;
    this.pointerY = y;
  }

  addPointerDelta(deltaX: number, deltaY: number) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) throw new TypeError('Pointer delta must be finite.');
    this.pointerDeltaX += deltaX;
    this.pointerDeltaY += deltaY;
  }

  addWheelDelta(deltaX: number, deltaY: number) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) throw new TypeError('Wheel delta must be finite.');
    this.wheelX += deltaX;
    this.wheelY += deltaY;
  }

  setTouch(touchId: number, x: number, y: number) {
    if (!Number.isInteger(touchId) || touchId < 0) throw new TypeError('Touch id must be a non-negative integer.');
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Touch position must be finite.');
    const current = this.touches.get(touchId);
    if (current) {
      current.deltaX += x - current.x;
      current.deltaY += y - current.y;
      current.x = x;
      current.y = y;
    } else {
      this.touches.set(touchId, { x, y, deltaX: 0, deltaY: 0 });
    }
  }

  removeTouch(touchId: number) {
    if (!Number.isInteger(touchId) || touchId < 0) return;
    this.touches.delete(touchId);
  }

  setGamepadButton(gamepad: number, button: number, value: number) {
    if (!Number.isInteger(gamepad) || gamepad < 0 || !Number.isInteger(button) || button < 0) {
      throw new TypeError('Gamepad and button indexes must be non-negative integers.');
    }
    if (!Number.isFinite(value)) throw new TypeError('Gamepad button value must be finite.');
    const state = this.getOrCreateGamepad(gamepad);
    state.buttons = growFloatArray(state.buttons, button);
    state.buttons[button] = Math.max(0, Math.min(1, value));
  }

  setGamepadAxis(gamepad: number, axis: number, value: number) {
    if (!Number.isInteger(gamepad) || gamepad < 0 || !Number.isInteger(axis) || axis < 0) {
      throw new TypeError('Gamepad and axis indexes must be non-negative integers.');
    }
    if (!Number.isFinite(value)) throw new TypeError('Gamepad axis value must be finite.');
    const state = this.getOrCreateGamepad(gamepad);
    state.axes = growFloatArray(state.axes, axis);
    state.axes[axis] = Math.max(-1, Math.min(1, value));
  }

  removeGamepad(gamepad: number) {
    this.gamepads.delete(gamepad);
  }

  releaseAll() {
    this.keyboard.clear();
    this.pointerButtons.clear();
    this.pointerDeltaX = 0;
    this.pointerDeltaY = 0;
    this.wheelX = 0;
    this.wheelY = 0;
    this.touches.clear();
    this.gamepads.clear();
  }

  reset() {
    this.releaseAll();
    this.currentFrame = 0;
    this.currentEventCount = 0;
    for (const action of this.actions) {
      action.enabled = action.definition.enabled ?? true;
      action.state.value[0] = 0;
      action.state.value[1] = 0;
      action.state.active = false;
      action.state.phase = 'waiting';
      action.state.frame = 0;
    }
    for (const context of this.contexts) context.enabled = context.definition.enabled;
  }

  /** Resolve every action and return the number of emitted phase events. */
  update(): number {
    this.currentFrame += 1;
    this.currentEventCount = 0;
    this.consumedSources.clear();

    for (const context of this.contexts) {
      this.contextSources.clear();
      for (const actionIndex of context.actionIndexes) {
        const action = this.actions[actionIndex];
        if (!context.enabled || !action.enabled) {
          this.commitAction(action, 0, 0);
          continue;
        }
        this.resolveAction(action, context.definition.consume);
      }
      if (context.enabled && context.definition.consume) {
        for (const source of this.contextSources) this.consumedSources.add(source);
      }
    }

    this.clearTransientValues();
    return this.currentEventCount;
  }

  getDiagnostics(): InputRuntimeDiagnostics {
    let activeActions = 0;
    let enabledContexts = 0;
    for (const action of this.actions) if (action.state.active) activeActions += 1;
    for (const context of this.contexts) if (context.enabled) enabledContexts += 1;
    return {
      frame: this.currentFrame,
      actionCount: this.actions.length,
      activeActions,
      contextCount: this.contexts.length,
      enabledContexts,
      eventCount: this.currentEventCount,
      keyboardKeys: this.keyboard.size,
      activeTouches: this.touches.size,
      connectedGamepads: this.gamepads.size,
    };
  }

  private getOrCreateGamepad(gamepad: number): GamepadState {
    let state = this.gamepads.get(gamepad);
    if (!state) {
      state = { buttons: new Float32Array(4), axes: new Float32Array(4) };
      this.gamepads.set(gamepad, state);
    }
    return state;
  }

  private resolveAction(action: CompiledAction, consume: boolean) {
    let x = 0;
    let y = 0;
    let button = 0;

    for (const binding of action.bindings) {
      if (this.consumedSources.has(binding.sourceKey)) continue;
      const value = this.readBinding(binding.definition);
      const contribution = value * (binding.definition.scale ?? 1);
      if (Math.abs(contribution) <= (action.definition.changeEpsilon ?? DEFAULT_CHANGE_EPSILON)) continue;
      if (consume) this.contextSources.add(binding.sourceKey);
      if (action.definition.type === 'button') {
        button = Math.max(button, Math.abs(contribution));
      } else if (action.definition.type === 'axis1d') {
        x += contribution;
      } else if ((binding.definition.output ?? 'x') === 'y') {
        y += contribution;
      } else {
        x += contribution;
      }
    }

    if (action.definition.type === 'button') x = Math.max(0, Math.min(1, button));
    else x = Math.max(-1, Math.min(1, x));
    if (action.definition.type === 'axis2d') {
      y = Math.max(-1, Math.min(1, y));
      const magnitude = Math.hypot(x, y);
      if (action.definition.normalize !== false && magnitude > 1) {
        x /= magnitude;
        y /= magnitude;
      }
    } else {
      y = 0;
    }
    this.commitAction(action, x, y);
  }

  private readBinding(binding: InputBinding): number {
    let value = 0;
    if (binding.device === 'keyboard') {
      value = this.keyboard.get(binding.code) ?? 0;
    } else if (binding.device === 'pointer') {
      if (binding.control === 'button') value = this.pointerButtons.get(binding.button ?? 0) ?? 0;
      else if (binding.control === 'positionX') value = this.pointerX;
      else if (binding.control === 'positionY') value = this.pointerY;
      else if (binding.control === 'deltaX') value = this.pointerDeltaX;
      else if (binding.control === 'deltaY') value = this.pointerDeltaY;
      else if (binding.control === 'wheelX') value = this.wheelX;
      else value = this.wheelY;
    } else if (binding.device === 'touch') {
      value = this.readTouchBinding(binding);
    } else {
      const gamepad = this.gamepads.get(binding.gamepad);
      if (gamepad) {
        value = binding.control === 'button'
          ? gamepad.buttons[binding.index] ?? 0
          : gamepad.axes[binding.index] ?? 0;
      }
    }
    return applyDeadZone(value, binding.deadZone);
  }

  private readTouchBinding(binding: TouchInputBinding): number {
    let strongest = 0;
    for (const [touchId, touch] of this.touches) {
      if (binding.touchId !== undefined && binding.touchId !== touchId) continue;
      let value: number;
      if (binding.control === 'pressed') value = 1;
      else if (binding.control === 'positionX') value = touch.x;
      else if (binding.control === 'positionY') value = touch.y;
      else if (binding.control === 'deltaX') value = touch.deltaX;
      else value = touch.deltaY;
      if (Math.abs(value) > Math.abs(strongest)) strongest = value;
    }
    return strongest;
  }

  private commitAction(action: CompiledAction, x: number, y: number) {
    const state = action.state;
    const wasActive = state.active;
    const epsilon = action.definition.changeEpsilon ?? DEFAULT_CHANGE_EPSILON;
    const active = action.definition.type === 'button'
      ? x >= (action.definition.activationThreshold ?? DEFAULT_BUTTON_THRESHOLD)
      : Math.hypot(x, y) > epsilon;
    const changed = Math.abs(x - state.value[0]) > epsilon || Math.abs(y - state.value[1]) > epsilon;

    state.value[0] = x;
    state.value[1] = y;
    state.active = active;
    state.frame = this.currentFrame;

    if (!wasActive && active) {
      this.emitEvent(action.definition.id, 'started', x, y);
      this.emitEvent(action.definition.id, 'performed', x, y);
      state.phase = 'performed';
    } else if (wasActive && !active) {
      this.emitEvent(action.definition.id, 'canceled', x, y);
      state.phase = 'canceled';
    } else if (active && changed) {
      this.emitEvent(action.definition.id, 'performed', x, y);
      state.phase = 'performed';
    } else {
      state.phase = active ? 'performed' : 'waiting';
    }
  }

  private emitEvent(actionId: string, phase: InputActionPhase, x: number, y: number) {
    const event = this.eventBuffer[this.currentEventCount];
    event.actionId = actionId;
    event.phase = phase;
    event.value[0] = x;
    event.value[1] = y;
    event.frame = this.currentFrame;
    this.currentEventCount += 1;
  }

  private clearTransientValues() {
    this.pointerDeltaX = 0;
    this.pointerDeltaY = 0;
    this.wheelX = 0;
    this.wheelY = 0;
    for (const touch of this.touches.values()) {
      touch.deltaX = 0;
      touch.deltaY = 0;
    }
  }
}
