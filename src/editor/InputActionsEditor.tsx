import { Keyboard, Link2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createAxis2dInputAction,
  createDefaultMoveInputAction,
  DEFAULT_MOVE_ACTION_ID,
} from './inputActions';
import type { InputAction, KeyboardInputBinding, ProjectDocument } from './types';

type ExperienceLevel = 'essentials' | 'advanced';

interface InputActionsEditorProps {
  project: ProjectDocument;
  experience: ExperienceLevel;
  disabled: boolean;
  onChange: (next: InputAction[], label: string) => void;
}

const PRIMARY_KEY_OPTIONS = [
  { code: 'KeyW', label: 'W' },
  { code: 'KeyA', label: 'A' },
  { code: 'KeyS', label: 'S' },
  { code: 'KeyD', label: 'D' },
  { code: 'ArrowUp', label: 'Up arrow' },
  { code: 'ArrowLeft', label: 'Left arrow' },
  { code: 'ArrowDown', label: 'Down arrow' },
  { code: 'ArrowRight', label: 'Right arrow' },
  { code: 'KeyI', label: 'I' },
  { code: 'KeyJ', label: 'J' },
  { code: 'KeyK', label: 'K' },
  { code: 'KeyL', label: 'L' },
] as const;

const primaryCodes = new Set<string>(PRIMARY_KEY_OPTIONS.map((option) => option.code));
const KEY_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
  ...PRIMARY_KEY_OPTIONS,
  ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
    .map((letter) => ({ code: `Key${letter}`, label: letter }))
    .filter((option) => !primaryCodes.has(option.code)),
  ...[...'0123456789'].map((digit) => ({ code: `Digit${digit}`, label: digit })),
  { code: 'Space', label: 'Space' },
  { code: 'Enter', label: 'Enter' },
  { code: 'ShiftLeft', label: 'Left Shift' },
  { code: 'ShiftRight', label: 'Right Shift' },
  { code: 'ControlLeft', label: 'Left Ctrl' },
  { code: 'ControlRight', label: 'Right Ctrl' },
];

const DIRECTION_GROUPS: Array<{
  axis: KeyboardInputBinding['axis'];
  scale: KeyboardInputBinding['scale'];
  label: string;
}> = [
  { axis: 'y', scale: 1, label: 'Forward' },
  { axis: 'x', scale: -1, label: 'Left' },
  { axis: 'y', scale: -1, label: 'Back' },
  { axis: 'x', scale: 1, label: 'Right' },
];

function keyLabel(code: string) {
  const known = KEY_OPTIONS.find((entry) => entry.code === code)?.label;
  if (known) return known.replace(' arrow', '');
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  return code;
}

function actionReferences(project: ProjectDocument, actionId: string) {
  return project.nodes.flatMap((node) => node.components
    .filter((component) => component.type === 'keyboardMove' && component.actionId === actionId)
    .map(() => node.name));
}

function createBinding(action: InputAction): KeyboardInputBinding | null {
  const usedCodes = new Set(action.bindings.map((binding) => binding.code));
  const code = KEY_OPTIONS.find((option) => !usedCodes.has(option.code))?.code;
  if (!code) return null;
  const direction = DIRECTION_GROUPS[action.bindings.length % DIRECTION_GROUPS.length];
  const uniquePart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${action.bindings.length}`;
  return {
    id: `binding-${uniquePart}`,
    code,
    axis: direction.axis,
    scale: direction.scale,
  };
}

function nextActionName(actions: InputAction[]) {
  let index = actions.length + 1;
  let name = `Movement ${index}`;
  const names = new Set(actions.map((action) => action.name.toLocaleLowerCase()));
  while (names.has(name.toLocaleLowerCase())) {
    index += 1;
    name = `Movement ${index}`;
  }
  return name;
}

function ActionNameField({
  action,
  disabled,
  existingNames,
  onCommit,
}: {
  action: InputAction;
  disabled: boolean;
  existingNames: string[];
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(action.name);
  const [error, setError] = useState<string | null>(null);
  const cancelNextBlur = useRef(false);

  useEffect(() => {
    setDraft(action.name);
    setError(null);
  }, [action.name]);

  const commit = () => {
    if (cancelNextBlur.current) {
      cancelNextBlur.current = false;
      return;
    }
    const name = draft.trim();
    if (!name) {
      setDraft(action.name);
      setError('Action name is required.');
      return;
    }
    if (existingNames.some((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setDraft(action.name);
      setError('That action name is already in use.');
      return;
    }
    setError(null);
    if (name !== action.name) onCommit(name);
  };

  return (
    <span className="input-action-name-field">
      <input
        type="text"
        value={draft}
        disabled={disabled}
        title={`Rename ${action.name}`}
        aria-label={`Action name for ${action.name}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `input-action-name-error-${action.id}` : undefined}
        data-testid="input-action-name"
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelNextBlur.current = true;
            setDraft(action.name);
            setError(null);
            event.currentTarget.blur();
          }
        }}
      />
      {error ? <small id={`input-action-name-error-${action.id}`} role="status">{error}</small> : null}
    </span>
  );
}

function EssentialsControls({
  project,
  disabled,
  onChange,
}: {
  project: ProjectDocument;
  disabled: boolean;
  onChange: InputActionsEditorProps['onChange'];
}) {
  const actions = project.inputActions;
  const movementComponent = project.nodes.flatMap((node) => node.components)
    .find((component) => component.id === 'player-move' && component.type === 'keyboardMove')
    ?? project.nodes.flatMap((node) => node.components).find((component) => component.type === 'keyboardMove');
  const actionId = movementComponent?.type === 'keyboardMove' ? movementComponent.actionId : undefined;
  const moveAction = actions.find((action) => action.id === actionId)
    ?? actions.find((action) => action.id === DEFAULT_MOVE_ACTION_ID);
  const defaultMoveAction = useMemo(() => createDefaultMoveInputAction(), []);
  const bindingShape = (action: InputAction) => action.bindings.map(({ code, axis, scale }) => ({ code, axis, scale }));
  const defaultsActive = moveAction && JSON.stringify(bindingShape(moveAction)) === JSON.stringify(bindingShape(defaultMoveAction));

  const restoreDefaults = () => {
    const restored = moveAction ? {
      ...moveAction,
      bindings: defaultMoveAction.bindings.map((binding, index) => ({
        ...binding,
        id: moveAction.bindings[index]?.id ?? `${moveAction.id}.${binding.code.toLocaleLowerCase()}`,
      })),
    } : createDefaultMoveInputAction();
    const next = moveAction
      ? actions.map((action) => action.id === moveAction.id ? restored : action)
      : [restored, ...actions];
    onChange(next, 'Restore player movement controls');
  };

  return (
    <div className="controls-preset" data-testid="input-actions-editor">
      <div className="controls-preset-heading">
        <span className="controls-preset-icon"><Keyboard size={16} /></span>
        <span>
          <strong>Player movement</strong>
          <small>{moveAction ? moveAction.name : 'Default movement is not set up'}</small>
        </span>
        {moveAction ? <i>2D</i> : null}
      </div>

      {moveAction ? (
        <div className="controls-direction-grid" aria-label="Player movement keys">
          {DIRECTION_GROUPS.map((direction) => {
            const bindings = moveAction.bindings.filter((binding) => binding.axis === direction.axis && binding.scale === direction.scale);
            return (
              <div className="controls-direction" key={`${direction.axis}-${direction.scale}`}>
                <small>{direction.label}</small>
                <span className="key-badge-list">
                  {bindings.length ? bindings.map((binding) => <kbd key={binding.id} title={binding.code}>{keyLabel(binding.code)}</kbd>) : <em>Not set</em>}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="controls-empty">Restore the starter controls to move objects with the Player movement action.</p>
      )}

      <button
        type="button"
        className="controls-reset"
        disabled={disabled || Boolean(defaultsActive)}
        data-testid="reset-move-controls"
        onClick={restoreDefaults}
      >
        <RotateCcw size={13} />
        {defaultsActive ? 'Using defaults' : 'Restore defaults'}
      </button>
    </div>
  );
}

function AdvancedControls({
  project,
  disabled,
  onChange,
}: Omit<InputActionsEditorProps, 'experience'>) {
  const updateAction = (actionId: string, update: (action: InputAction) => InputAction, label: string) => {
    onChange(project.inputActions.map((action) => action.id === actionId ? update(action) : action), label);
  };

  const addAction = () => {
    const action = createAxis2dInputAction({ name: nextActionName(project.inputActions) });
    onChange([...project.inputActions, action], 'Add input action');
  };

  return (
    <div className="input-actions-advanced" data-testid="input-actions-editor">
      <p className="component-description">Named actions keep gameplay behavior independent from individual keyboard keys.</p>

      <div className="input-action-list">
        {project.inputActions.map((action) => {
          const references = actionReferences(project, action.id);
          const isReferenced = references.length > 0;
          const referenceDescription = isReferenced ? `Used by ${references.join(', ')}` : 'Not used by a scene object';

          return (
            <section className="input-action-card" data-testid="input-action-card" data-action-id={action.id} key={action.id}>
              <header className="input-action-header">
                <span className="input-action-type" title="Two-axis value">2D</span>
                <ActionNameField
                  action={action}
                  disabled={disabled}
                  existingNames={project.inputActions.filter((candidate) => candidate.id !== action.id).map((candidate) => candidate.name)}
                  onCommit={(name) => updateAction(action.id, (current) => ({ ...current, name }), 'Rename input action')}
                />
                {isReferenced ? (
                  <span className="input-action-reference" title={referenceDescription}>
                    <Link2 size={11} />
                    {references.length === 1 ? references[0] : `${references.length} uses`}
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={isReferenced ? `Cannot delete ${action.name}; ${referenceDescription}` : `Delete ${action.name}`}
                  title={isReferenced ? referenceDescription : `Delete ${action.name}`}
                  disabled={disabled || isReferenced}
                  data-testid="delete-input-action"
                  data-action-id={action.id}
                  onClick={() => onChange(project.inputActions.filter((candidate) => candidate.id !== action.id), 'Delete input action')}
                >
                  <Trash2 size={12} />
                </button>
              </header>

              <div className="input-action-meta">
                <span>{action.bindings.length} key{action.bindings.length === 1 ? '' : 's'}</span>
                <code>{action.id}</code>
              </div>

              {action.bindings.length ? (
                <div className="input-binding-list">
                  <div className="input-binding-labels" aria-hidden="true"><span>Key</span><span>Axis</span><span>Value</span><span /></div>
                  {action.bindings.map((binding) => {
                    const options = KEY_OPTIONS.some((option) => option.code === binding.code)
                      ? KEY_OPTIONS
                      : [{ code: binding.code, label: binding.code }, ...KEY_OPTIONS];
                    return (
                      <div className="input-binding-row" data-binding-id={binding.id} key={binding.id}>
                        <select
                          value={binding.code}
                          disabled={disabled}
                          aria-label={`Keyboard key for ${action.name}`}
                          data-testid="input-binding-code"
                          data-binding-id={binding.id}
                          onChange={(event) => updateAction(action.id, (current) => ({
                            ...current,
                            bindings: current.bindings.map((candidate) => candidate.id === binding.id ? { ...candidate, code: event.target.value } : candidate),
                          }), 'Change input key')}
                        >
                          {options.map((option) => (
                            <option
                              value={option.code}
                              key={option.code}
                              disabled={option.code !== binding.code && action.bindings.some((candidate) => candidate.id !== binding.id && candidate.code === option.code)}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={binding.axis}
                          disabled={disabled}
                          aria-label={`Axis for ${keyLabel(binding.code)} in ${action.name}`}
                          data-testid="input-binding-axis"
                          data-binding-id={binding.id}
                          onChange={(event) => updateAction(action.id, (current) => ({
                            ...current,
                            bindings: current.bindings.map((candidate) => candidate.id === binding.id ? { ...candidate, axis: event.target.value as KeyboardInputBinding['axis'] } : candidate),
                          }), 'Change input axis')}
                        >
                          <option value="x">X</option>
                          <option value="y">Y</option>
                        </select>
                        <select
                          value={binding.scale}
                          disabled={disabled}
                          aria-label={`Scale for ${keyLabel(binding.code)} in ${action.name}`}
                          data-testid="input-binding-scale"
                          data-binding-id={binding.id}
                          onChange={(event) => updateAction(action.id, (current) => ({
                            ...current,
                            bindings: current.bindings.map((candidate) => candidate.id === binding.id ? { ...candidate, scale: Number(event.target.value) as KeyboardInputBinding['scale'] } : candidate),
                          }), 'Change input scale')}
                        >
                          <option value={-1}>−1</option>
                          <option value={1}>+1</option>
                        </select>
                        <button
                          type="button"
                          aria-label={`Remove ${keyLabel(binding.code)} binding from ${action.name}`}
                          title="Remove binding"
                          disabled={disabled}
                          data-testid="delete-input-binding"
                          data-binding-id={binding.id}
                          onClick={() => updateAction(action.id, (current) => ({ ...current, bindings: current.bindings.filter((candidate) => candidate.id !== binding.id) }), 'Remove input binding')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="input-bindings-empty">No keys assigned. Add a binding before using this action.</p>}

              <button
                type="button"
                className="input-add-binding"
                disabled={disabled || !KEY_OPTIONS.some((option) => !action.bindings.some((binding) => binding.code === option.code))}
                title={!KEY_OPTIONS.some((option) => !action.bindings.some((binding) => binding.code === option.code)) ? 'Every available keyboard key is already assigned.' : 'Add key binding'}
                data-testid="add-input-binding"
                data-action-id={action.id}
                onClick={() => updateAction(action.id, (current) => {
                  const binding = createBinding(current);
                  return binding ? { ...current, bindings: [...current.bindings, binding] } : current;
                }, 'Add input binding')}
              >
                <Plus size={12} /> Add key binding
              </button>
            </section>
          );
        })}
      </div>

      {!project.inputActions.length ? <p className="controls-empty">No movement actions yet. Create one, then assign it to a movement component.</p> : null}

      <button type="button" className="input-add-action" disabled={disabled} data-testid="add-input-action" onClick={addAction}>
        <Plus size={13} /> Add movement action
      </button>
    </div>
  );
}

export function InputActionsEditor({ project, experience, disabled, onChange }: InputActionsEditorProps) {
  return (
    <details className="component controls-component" open>
      <summary>
        <span className="component-heading">
          <span><Keyboard size={14} /></span>
          <strong>{experience === 'essentials' ? 'Controls' : 'Input Actions'}</strong>
        </span>
      </summary>
      <div className="component-body">
        {experience === 'essentials'
          ? <EssentialsControls project={project} disabled={disabled} onChange={onChange} />
          : <AdvancedControls project={project} disabled={disabled} onChange={onChange} />}
      </div>
    </details>
  );
}
