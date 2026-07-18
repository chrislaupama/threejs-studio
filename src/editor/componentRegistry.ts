import { createGameplayComponent } from './project';
import type { GameplayComponent, ProjectDocument } from './types';

export type RegisteredComponentType = GameplayComponent['type'];
export type RegisteredComponent<TType extends RegisteredComponentType> = Extract<GameplayComponent, { type: TType }>;

export type ComponentValidationCode =
  | 'invalid-component'
  | 'invalid-field'
  | 'missing-reference'
  | 'unsupported-version';

export interface ComponentValidationIssue {
  code: ComponentValidationCode;
  path: string;
  message: string;
}

export interface ComponentValidationContext {
  project?: Pick<ProjectDocument, 'inputActions'>;
  nodeId?: string;
}

export interface ComponentMigrationContext {
  componentId: string;
  defaultInputActionId?: string;
}

export type ComponentMigrationResult<TComponent extends GameplayComponent> =
  | {
      ok: true;
      component: TComponent;
      warnings: string[];
    }
  | {
      ok: false;
      errors: ComponentValidationIssue[];
    };

export type ComponentEditorControl = 'toggle' | 'number' | 'select' | 'input-action';

export interface ComponentEditorFieldDescriptor {
  key: string;
  label: string;
  control: ComponentEditorControl;
  description?: string;
  unit?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  options?: readonly { label: string; value: string }[];
}

export interface ComponentEditorDescriptor {
  essentialLabel: string;
  advancedLabel: string;
  description: string;
  iconKey: 'rotate' | 'float' | 'keyboard';
  category: 'motion' | 'input';
  fields: readonly ComponentEditorFieldDescriptor[];
}

export interface ComponentAIMetadata {
  title: string;
  description: string;
  readScopes: readonly string[];
  writeScopes: readonly string[];
  risk: 'low' | 'moderate';
  approval: 'none' | 'when-sensitive';
  sensitiveFields: readonly string[];
}

export interface ComponentDefinition<TType extends RegisteredComponentType> {
  type: TType;
  version: 1;
  runtimeKey: string;
  allowMultiple: boolean;
  conflicts: readonly RegisteredComponentType[];
  editor: ComponentEditorDescriptor;
  ai: ComponentAIMetadata;
  create: (componentId: string) => RegisteredComponent<TType>;
  validate: (
    component: unknown,
    context?: ComponentValidationContext,
  ) => ComponentValidationIssue[];
  migrate: (
    value: unknown,
    fromVersion: number,
    context: ComponentMigrationContext,
  ) => ComponentMigrationResult<RegisteredComponent<TType>>;
}

export type ComponentDefinitionMetadata<TType extends RegisteredComponentType = RegisteredComponentType> = Pick<
  ComponentDefinition<TType>,
  'type' | 'version' | 'runtimeKey' | 'allowMultiple' | 'conflicts' | 'editor' | 'ai'
>;

type ComponentDefinitionMap = {
  [TType in RegisteredComponentType]: ComponentDefinition<TType>;
};

const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const axes = ['x', 'y', 'z'] as const;
const planes = ['xz', 'xy'] as const;

function deepFreeze<TValue>(value: TValue): TValue {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationIssue(
  code: ComponentValidationCode,
  path: string,
  message: string,
): ComponentValidationIssue {
  return { code, path, message };
}

function validateBase(
  value: unknown,
  expectedType: RegisteredComponentType,
  allowedKeys: readonly string[],
): { record: Record<string, unknown> | null; issues: ComponentValidationIssue[] } {
  if (!isRecord(value)) {
    return {
      record: null,
      issues: [validationIssue('invalid-component', '', 'Component must be a serializable object.')],
    };
  }

  const issues: ComponentValidationIssue[] = [];
  if (value.type !== expectedType) {
    issues.push(validationIssue('invalid-field', 'type', `Component type must be "${expectedType}".`));
  }
  if (typeof value.id !== 'string' || !stableIdPattern.test(value.id)) {
    issues.push(validationIssue('invalid-field', 'id', 'Component id must be a stable identifier.'));
  }
  if (typeof value.enabled !== 'boolean') {
    issues.push(validationIssue('invalid-field', 'enabled', 'Component enabled must be a boolean.'));
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      issues.push(validationIssue('invalid-field', key, `Field "${key}" is not supported by ${expectedType}.`));
    }
  }
  return { record: value, issues };
}

function validateFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  issues: ComponentValidationIssue[],
  minimum?: number,
) {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(validationIssue('invalid-field', key, `${key} must be a finite number.`));
  } else if (minimum !== undefined && value < minimum) {
    issues.push(validationIssue('invalid-field', key, `${key} must be at least ${minimum}.`));
  }
}

function createWithId<TType extends RegisteredComponentType>(
  type: TType,
  componentId: string,
): RegisteredComponent<TType> {
  return { ...createGameplayComponent(type), id: componentId } as RegisteredComponent<TType>;
}

function migrateBase(
  value: unknown,
  type: RegisteredComponentType,
  fromVersion: number,
  context: ComponentMigrationContext,
): { record: Record<string, unknown>; warnings: string[] } | ComponentMigrationResult<GameplayComponent> {
  if (!Number.isInteger(fromVersion) || fromVersion < 0 || fromVersion > 1) {
    return {
      ok: false,
      errors: [validationIssue('unsupported-version', '', `Component schema version ${fromVersion} is not supported.`)],
    };
  }
  if (!stableIdPattern.test(context.componentId)) {
    return {
      ok: false,
      errors: [validationIssue('invalid-field', 'id', 'Migration componentId must be a stable identifier.')],
    };
  }
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [validationIssue('invalid-component', '', 'Migrated component must be an object.')],
    };
  }
  const warnings: string[] = [];
  if (fromVersion === 0) warnings.push(`Migrated ${type} component metadata from definition v0 to v1.`);
  return { record: value, warnings };
}

const enabledField: ComponentEditorFieldDescriptor = {
  key: 'enabled',
  label: 'Active',
  control: 'toggle',
  description: 'Run this component while the game is playing.',
};

const speedField: ComponentEditorFieldDescriptor = {
  key: 'speed',
  label: 'Speed',
  control: 'number',
  step: 0.1,
};

const axisField: ComponentEditorFieldDescriptor = {
  key: 'axis',
  label: 'Axis',
  control: 'select',
  options: axes.map((axis) => ({ label: `${axis.toUpperCase()} axis`, value: axis })),
};

const commonAI = {
  readScopes: ['gameplay.read'] as const,
  writeScopes: ['gameplay.write'] as const,
  risk: 'low' as const,
  approval: 'none' as const,
  sensitiveFields: [] as const,
};

const rotateDefinition: ComponentDefinition<'rotate'> = {
  type: 'rotate',
  version: 1,
  runtimeKey: 'motion.rotate.v1',
  allowMultiple: true,
  conflicts: [],
  editor: {
    essentialLabel: 'Spin',
    advancedLabel: 'Rotate Component',
    description: 'Spin continuously while the game is playing.',
    iconKey: 'rotate',
    category: 'motion',
    fields: [enabledField, speedField, axisField],
  },
  ai: {
    ...commonAI,
    title: 'Rotate component',
    description: 'Continuously rotates a scene node around one authored axis.',
  },
  create: (componentId) => createWithId('rotate', componentId),
  validate: (value) => {
    const { record, issues } = validateBase(value, 'rotate', ['id', 'type', 'enabled', 'speed', 'axis']);
    if (!record) return issues;
    validateFiniteNumber(record, 'speed', issues);
    if (!axes.includes(record.axis as (typeof axes)[number])) {
      issues.push(validationIssue('invalid-field', 'axis', 'axis must be x, y, or z.'));
    }
    return issues;
  },
  migrate: (value, fromVersion, context) => {
    const base = migrateBase(value, 'rotate', fromVersion, context);
    if ('ok' in base) return base as ComponentMigrationResult<RegisteredComponent<'rotate'>>;
    const component: RegisteredComponent<'rotate'> = {
      id: context.componentId,
      type: 'rotate',
      enabled: typeof base.record.enabled === 'boolean' ? base.record.enabled : true,
      speed: typeof base.record.speed === 'number' ? base.record.speed : 0.8,
      axis: axes.includes(base.record.axis as (typeof axes)[number])
        ? base.record.axis as RegisteredComponent<'rotate'>['axis']
        : 'y',
    };
    const issues = rotateDefinition.validate(component);
    return issues.length ? { ok: false, errors: issues } : { ok: true, component, warnings: base.warnings };
  },
};

const floatDefinition: ComponentDefinition<'float'> = {
  type: 'float',
  version: 1,
  runtimeKey: 'motion.float.v1',
  allowMultiple: true,
  conflicts: [],
  editor: {
    essentialLabel: 'Float',
    advancedLabel: 'Float Component',
    description: 'Gently bob along one axis while playing.',
    iconKey: 'float',
    category: 'motion',
    fields: [
      enabledField,
      speedField,
      axisField,
      { key: 'distance', label: 'Distance', control: 'number', unit: 'm', minimum: 0, step: 0.05 },
      { key: 'phase', label: 'Phase', control: 'number', unit: 'rad', step: 0.1 },
    ],
  },
  ai: {
    ...commonAI,
    title: 'Float component',
    description: 'Moves a scene node back and forth along one axis.',
  },
  create: (componentId) => createWithId('float', componentId),
  validate: (value) => {
    const { record, issues } = validateBase(value, 'float', ['id', 'type', 'enabled', 'speed', 'distance', 'axis', 'phase']);
    if (!record) return issues;
    validateFiniteNumber(record, 'speed', issues);
    validateFiniteNumber(record, 'distance', issues, 0);
    validateFiniteNumber(record, 'phase', issues);
    if (!axes.includes(record.axis as (typeof axes)[number])) {
      issues.push(validationIssue('invalid-field', 'axis', 'axis must be x, y, or z.'));
    }
    return issues;
  },
  migrate: (value, fromVersion, context) => {
    const base = migrateBase(value, 'float', fromVersion, context);
    if ('ok' in base) return base as ComponentMigrationResult<RegisteredComponent<'float'>>;
    const legacyDistance = base.record.distance ?? base.record.amplitude;
    const component: RegisteredComponent<'float'> = {
      id: context.componentId,
      type: 'float',
      enabled: typeof base.record.enabled === 'boolean' ? base.record.enabled : true,
      speed: typeof base.record.speed === 'number' ? base.record.speed : 1,
      distance: typeof legacyDistance === 'number' ? legacyDistance : 0.25,
      axis: axes.includes(base.record.axis as (typeof axes)[number])
        ? base.record.axis as RegisteredComponent<'float'>['axis']
        : 'y',
      phase: typeof base.record.phase === 'number' ? base.record.phase : 0,
    };
    const issues = floatDefinition.validate(component);
    return issues.length ? { ok: false, errors: issues } : { ok: true, component, warnings: base.warnings };
  },
};

const keyboardMoveDefinition: ComponentDefinition<'keyboardMove'> = {
  type: 'keyboardMove',
  version: 1,
  runtimeKey: 'input.axis-move.v1',
  allowMultiple: true,
  conflicts: [],
  editor: {
    essentialLabel: 'Player movement',
    advancedLabel: 'Input Move Component',
    description: 'Move this object with a named two-axis control action.',
    iconKey: 'keyboard',
    category: 'input',
    fields: [
      enabledField,
      { ...speedField, minimum: 0 },
      {
        key: 'plane',
        label: 'Movement plane',
        control: 'select',
        options: [
          { label: 'Ground (X / Z)', value: 'xz' },
          { label: 'Screen (X / Y)', value: 'xy' },
        ],
      },
      {
        key: 'actionId',
        label: 'Controls',
        control: 'input-action',
        description: 'Stable project Input Action reference.',
      },
    ],
  },
  ai: {
    title: 'Input move component',
    description: 'Moves a scene node using a named two-axis Input Action.',
    readScopes: ['gameplay.read', 'input.read'],
    writeScopes: ['gameplay.write'],
    risk: 'moderate',
    approval: 'when-sensitive',
    sensitiveFields: ['actionId'],
  },
  create: (componentId) => createWithId('keyboardMove', componentId),
  validate: (value, context) => {
    const { record, issues } = validateBase(value, 'keyboardMove', ['id', 'type', 'enabled', 'speed', 'plane', 'actionId']);
    if (!record) return issues;
    validateFiniteNumber(record, 'speed', issues, 0);
    if (!planes.includes(record.plane as (typeof planes)[number])) {
      issues.push(validationIssue('invalid-field', 'plane', 'plane must be xz or xy.'));
    }
    if (typeof record.actionId !== 'string' || !stableIdPattern.test(record.actionId)) {
      issues.push(validationIssue('invalid-field', 'actionId', 'actionId must be a stable identifier.'));
    } else if (context?.project && !context.project.inputActions.some((action) => action.id === record.actionId)) {
      issues.push(validationIssue('missing-reference', 'actionId', `Input Action "${record.actionId}" does not exist.`));
    }
    return issues;
  },
  migrate: (value, fromVersion, context) => {
    const base = migrateBase(value, 'keyboardMove', fromVersion, context);
    if ('ok' in base) return base as ComponentMigrationResult<RegisteredComponent<'keyboardMove'>>;
    const component: RegisteredComponent<'keyboardMove'> = {
      id: context.componentId,
      type: 'keyboardMove',
      enabled: typeof base.record.enabled === 'boolean' ? base.record.enabled : true,
      speed: typeof base.record.speed === 'number' ? base.record.speed : 3.5,
      plane: planes.includes(base.record.plane as (typeof planes)[number])
        ? base.record.plane as RegisteredComponent<'keyboardMove'>['plane']
        : 'xz',
      actionId: typeof base.record.actionId === 'string'
        ? base.record.actionId
        : context.defaultInputActionId ?? 'player.move',
    };
    const issues = keyboardMoveDefinition.validate(component);
    return issues.length ? { ok: false, errors: issues } : { ok: true, component, warnings: base.warnings };
  },
};

export const COMPONENT_DEFINITIONS: Readonly<ComponentDefinitionMap> = Object.freeze({
  rotate: deepFreeze(rotateDefinition),
  float: deepFreeze(floatDefinition),
  keyboardMove: deepFreeze(keyboardMoveDefinition),
});

export const COMPONENT_DEFINITION_METADATA: readonly ComponentDefinitionMetadata[] = Object.freeze(
  Object.values(COMPONENT_DEFINITIONS).map((definition) => deepFreeze({
    type: definition.type,
    version: definition.version,
    runtimeKey: definition.runtimeKey,
    allowMultiple: definition.allowMultiple,
    conflicts: [...definition.conflicts],
    editor: structuredClone(definition.editor),
    ai: structuredClone(definition.ai),
  })),
);

export function isRegisteredComponentType(value: unknown): value is RegisteredComponentType {
  return typeof value === 'string' && Object.hasOwn(COMPONENT_DEFINITIONS, value);
}

export function getComponentDefinition<TType extends RegisteredComponentType>(
  type: TType,
): ComponentDefinition<TType> {
  return COMPONENT_DEFINITIONS[type];
}

export function validateRegisteredComponent(
  component: unknown,
  context?: ComponentValidationContext,
): ComponentValidationIssue[] {
  if (!isRecord(component) || !isRegisteredComponentType(component.type)) {
    return [validationIssue('invalid-component', 'type', 'Component type is not registered.')];
  }
  return getComponentDefinition(component.type).validate(component, context);
}

export function migrateRegisteredComponent<TType extends RegisteredComponentType>(
  type: TType,
  value: unknown,
  fromVersion: number,
  context: ComponentMigrationContext,
): ComponentMigrationResult<RegisteredComponent<TType>> {
  return getComponentDefinition(type).migrate(value, fromVersion, context);
}
