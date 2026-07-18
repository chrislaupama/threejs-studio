import type {
  UIActionBinding,
  UIActivationBinding,
  UIAnchor,
  UIBooleanBinding,
  UIBox,
  UIBreakpoint,
  UIContainerLayout,
  UIDocument,
  UIElement,
  UIJsonValue,
  UILength,
  UILocalizationBinding,
  UINumberBinding,
  UINumberFormat,
  UIResponsiveOverride,
  UISafeArea,
  UIScalarBinding,
  UIStyle,
  UITextBinding,
  UIVariableBinding,
} from './types';

export interface UIValidationIssue {
  path: string;
  code:
    | 'INVALID_TYPE'
    | 'INVALID_VALUE'
    | 'DUPLICATE_ID'
    | 'MISSING_REFERENCE'
    | 'TYPE_MISMATCH'
    | 'INVALID_STRUCTURE'
    | 'LIMIT_EXCEEDED'
    | 'NOT_SERIALIZABLE';
  message: string;
}

export type UIValidationResult =
  | { ok: true; document: UIDocument }
  | { ok: false; issues: UIValidationIssue[] };

export class UIValidationError extends Error {
  readonly issues: UIValidationIssue[];

  constructor(issues: UIValidationIssue[]) {
    super(`Invalid runtime UI document: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    this.name = 'UIValidationError';
    this.issues = issues;
  }
}

const MAX_ELEMENTS = 1_000;
const MAX_DEPTH = 32;
const MAX_JSON_DEPTH = 128;
const MAX_JSON_NODES = 20_000;
const MAX_STRING_LENGTH = 8_192;
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const LENGTH_PATTERN = /^-?(?:\d+|\d*\.\d+)(?:px|%|rem|em|vw|vh|vmin|vmax)$/;
const GRID_TRACK_PATTERN = /^(?:\d+|\d*\.\d+)fr$/;
const FORBIDDEN_CSS_PATTERN = /[;{}]|url\s*\(|expression\s*\(/i;

type ScalarType = 'string' | 'number' | 'boolean';

interface ValidationContext {
  issues: UIValidationIssue[];
  variables: Map<string, ScalarType>;
  breakpoints: Set<string>;
  elementIds: Set<string>;
  focusableIds: Set<string>;
  focusReferences: Array<{ path: string; id: string; initial: boolean }>;
  localizationKeys: Set<string>;
  hasLocalization: boolean;
  elementCount: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const scalarTypeOf = (value: unknown): ScalarType | null => {
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return type;
  return null;
};

const addIssue = (
  context: ValidationContext,
  path: string,
  code: UIValidationIssue['code'],
  message: string,
) => context.issues.push({ path, code, message });

const validateSerializable = (
  value: unknown,
  issues: UIValidationIssue[],
  path: string,
  ancestors: Set<object>,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): value is UIJsonValue => {
  budget.nodes += 1;
  if (depth > MAX_JSON_DEPTH) {
    issues.push({ path, code: 'LIMIT_EXCEEDED', message: `JSON data may not exceed ${MAX_JSON_DEPTH} levels.` });
    return false;
  }
  if (budget.nodes > MAX_JSON_NODES) {
    issues.push({ path, code: 'LIMIT_EXCEEDED', message: `UI document may not exceed ${MAX_JSON_NODES} JSON values.` });
    return false;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return true;
    issues.push({ path, code: 'NOT_SERIALIZABLE', message: 'Numbers must be finite.' });
    return false;
  }
  if (typeof value !== 'object') {
    issues.push({ path, code: 'NOT_SERIALIZABLE', message: 'Values must contain JSON data only.' });
    return false;
  }
  if (ancestors.has(value)) {
    issues.push({ path, code: 'NOT_SERIALIZABLE', message: 'Circular references are not serializable.' });
    return false;
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    issues.push({ path, code: 'NOT_SERIALIZABLE', message: 'Objects must be plain JSON objects.' });
    return false;
  }

  ancestors.add(value);
  let valid = true;
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_NODES) {
      issues.push({ path, code: 'LIMIT_EXCEEDED', message: `Arrays may not exceed ${MAX_JSON_NODES} entries.` });
      ancestors.delete(value);
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        issues.push({ path: `${path}[${index}]`, code: 'NOT_SERIALIZABLE', message: 'Sparse arrays are not supported.' });
        valid = false;
        continue;
      }
      if (!validateSerializable(value[index], issues, `${path}[${index}]`, ancestors, depth + 1, budget)) valid = false;
    }
  } else {
    Object.entries(value).forEach(([key, item]) => {
      if (!validateSerializable(item, issues, `${path}.${key}`, ancestors, depth + 1, budget)) valid = false;
    });
  }
  ancestors.delete(value);
  return valid;
};

const validateIdentifier = (context: ValidationContext, value: unknown, path: string, label: string) => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    addIssue(context, path, 'INVALID_VALUE', `${label} must be a stable identifier beginning with a letter.`);
    return false;
  }
  return true;
};

const validateString = (
  context: ValidationContext,
  value: unknown,
  path: string,
  label: string,
  allowEmpty = false,
) => {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0) || value.length > MAX_STRING_LENGTH) {
    addIssue(context, path, 'INVALID_VALUE', `${label} must be ${allowEmpty ? 'a' : 'a non-empty'} bounded string.`);
    return false;
  }
  return true;
};

const isLength = (value: unknown, allowGridTrack = false): value is UILength => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  if (value === 'auto' || value === 'min-content' || value === 'max-content' || value === 'fit-content') return true;
  if (LENGTH_PATTERN.test(value)) return true;
  return allowGridTrack && GRID_TRACK_PATTERN.test(value);
};

const validateLength = (
  context: ValidationContext,
  value: unknown,
  path: string,
  allowGridTrack = false,
) => {
  if (!isLength(value, allowGridTrack)) {
    addIssue(context, path, 'INVALID_VALUE', 'Expected a finite pixel number or supported CSS length.');
    return false;
  }
  return true;
};

const validateSafeCss = (context: ValidationContext, value: unknown, path: string) => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 512
    || FORBIDDEN_CSS_PATTERN.test(value)
    || /[\u0000-\u001f]/.test(value)
  ) {
    addIssue(context, path, 'INVALID_VALUE', 'Expected a bounded CSS value without URLs or rule delimiters.');
  }
};

const validateNumberFormat = (context: ValidationContext, value: unknown, path: string) => {
  if (!isRecord(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'Number format must be an object.');
    return;
  }
  const format = value as unknown as UINumberFormat;
  if (format.style !== undefined && !['decimal', 'integer', 'percent'].includes(format.style)) {
    addIssue(context, `${path}.style`, 'INVALID_VALUE', 'Unsupported number format style.');
  }
  if (
    format.minimumIntegerDigits !== undefined
    && (!Number.isInteger(format.minimumIntegerDigits) || format.minimumIntegerDigits < 1 || format.minimumIntegerDigits > 21)
  ) addIssue(context, `${path}.minimumIntegerDigits`, 'INVALID_VALUE', 'Must be an integer from 1 to 21.');
  if (
    format.maximumFractionDigits !== undefined
    && (!Number.isInteger(format.maximumFractionDigits) || format.maximumFractionDigits < 0 || format.maximumFractionDigits > 20)
  ) addIssue(context, `${path}.maximumFractionDigits`, 'INVALID_VALUE', 'Must be an integer from 0 to 20.');
  if (format.prefix !== undefined) validateString(context, format.prefix, `${path}.prefix`, 'Prefix', true);
  if (format.suffix !== undefined) validateString(context, format.suffix, `${path}.suffix`, 'Suffix', true);
};

const validateVariableBinding = (
  context: ValidationContext,
  value: Record<string, unknown>,
  path: string,
  acceptedTypes: ScalarType[],
) => {
  const binding = value as unknown as UIVariableBinding;
  if (!validateIdentifier(context, binding.variableId, `${path}.variableId`, 'Variable ID')) return;
  const definitionType = context.variables.get(binding.variableId);
  if (!definitionType) {
    addIssue(context, `${path}.variableId`, 'MISSING_REFERENCE', `Variable "${binding.variableId}" is not defined.`);
  } else if (!acceptedTypes.includes(definitionType)) {
    addIssue(context, `${path}.variableId`, 'TYPE_MISMATCH', `Variable "${binding.variableId}" is ${definitionType}, not ${acceptedTypes.join(' or ')}.`);
  }
  if (binding.fallback !== undefined) {
    const fallbackType = scalarTypeOf(binding.fallback);
    if (!fallbackType || !acceptedTypes.includes(fallbackType)) {
      addIssue(context, `${path}.fallback`, 'TYPE_MISMATCH', `Fallback must be ${acceptedTypes.join(' or ')}.`);
    }
  }
  if (binding.numberFormat !== undefined) {
    if (definitionType !== 'number') {
      addIssue(context, `${path}.numberFormat`, 'TYPE_MISMATCH', 'Number formatting requires a numeric variable.');
    } else {
      validateNumberFormat(context, binding.numberFormat, `${path}.numberFormat`);
    }
  }
};

const validateScalarBinding = (
  context: ValidationContext,
  value: unknown,
  path: string,
  acceptedTypes: ScalarType[],
) => {
  if (!isRecord(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'Binding must be an object.');
    return;
  }
  const binding = value as unknown as UIScalarBinding;
  if (binding.type === 'literal') {
    const literalType = scalarTypeOf(binding.value);
    if (!literalType || !acceptedTypes.includes(literalType)) {
      addIssue(context, `${path}.value`, 'TYPE_MISMATCH', `Literal must be ${acceptedTypes.join(' or ')}.`);
    }
    return;
  }
  if (binding.type === 'variable') {
    validateVariableBinding(context, value, path, acceptedTypes);
    return;
  }
  addIssue(context, `${path}.type`, 'INVALID_VALUE', 'Expected a literal or variable binding.');
};

const validateLocalizationBinding = (
  context: ValidationContext,
  binding: UILocalizationBinding,
  path: string,
) => {
  if (validateString(context, binding.key, `${path}.key`, 'Localization key')) {
    if (!context.localizationKeys.has(binding.key) && binding.fallback === undefined) {
      addIssue(
        context,
        `${path}.key`,
        'MISSING_REFERENCE',
        context.hasLocalization
          ? `Localization key "${binding.key}" is missing and has no fallback.`
          : `Localization binding "${binding.key}" requires a catalog or fallback.`,
      );
    }
  }
  if (binding.fallback !== undefined) validateString(context, binding.fallback, `${path}.fallback`, 'Fallback', true);
  if (binding.parameters !== undefined) {
    if (!isRecord(binding.parameters)) {
      addIssue(context, `${path}.parameters`, 'INVALID_TYPE', 'Localization parameters must be an object.');
    } else {
      Object.entries(binding.parameters).forEach(([name, parameter]) => {
        if (!IDENTIFIER_PATTERN.test(name)) {
          addIssue(context, `${path}.parameters.${name}`, 'INVALID_VALUE', 'Parameter names must be stable identifiers.');
        }
        validateScalarBinding(context, parameter, `${path}.parameters.${name}`, ['string', 'number', 'boolean']);
      });
    }
  }
};

const validateTextBinding = (context: ValidationContext, value: unknown, path: string) => {
  if (!isRecord(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'Text binding must be an object.');
    return;
  }
  const binding = value as unknown as UITextBinding;
  if (binding.type === 'localization') {
    validateLocalizationBinding(context, binding, path);
    return;
  }
  validateScalarBinding(context, value, path, ['string', 'number', 'boolean']);
};

const validateBooleanBinding = (context: ValidationContext, value: unknown, path: string) => {
  validateScalarBinding(context, value as UIBooleanBinding, path, ['boolean']);
};

const validateNumberBinding = (context: ValidationContext, value: unknown, path: string) => {
  validateScalarBinding(context, value as UINumberBinding, path, ['number']);
};

const validateAnchor = (context: ValidationContext, value: unknown, path: string) => {
  if (!isRecord(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'Anchor must be an object.');
    return;
  }
  const anchor = value as unknown as UIAnchor;
  (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
    if (anchor[edge] !== undefined) validateLength(context, anchor[edge], `${path}.${edge}`);
  });
  if (anchor.centerX !== undefined && typeof anchor.centerX !== 'boolean') {
    addIssue(context, `${path}.centerX`, 'INVALID_TYPE', 'centerX must be boolean.');
  }
  if (anchor.centerY !== undefined && typeof anchor.centerY !== 'boolean') {
    addIssue(context, `${path}.centerY`, 'INVALID_TYPE', 'centerY must be boolean.');
  }
  if (anchor.centerX && (anchor.left !== undefined || anchor.right !== undefined)) {
    addIssue(context, path, 'INVALID_STRUCTURE', 'centerX cannot be combined with left or right anchors.');
  }
  if (anchor.centerY && (anchor.top !== undefined || anchor.bottom !== undefined)) {
    addIssue(context, path, 'INVALID_STRUCTURE', 'centerY cannot be combined with top or bottom anchors.');
  }
};

const validateBox = (context: ValidationContext, value: unknown, path: string) => {
  if (isLength(value)) return;
  if (!isRecord(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'Box spacing must be a length or edge object.');
    return;
  }
  const box = value as unknown as UIBox;
  if (typeof box !== 'object') return;
  (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
    if (box[edge] !== undefined) validateLength(context, box[edge], `${path}.${edge}`);
  });
};

const validateSafeArea = (context: ValidationContext, value: unknown, path: string) => {
  if (typeof value === 'boolean') return;
  if (!isRecord(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'Safe area must be boolean or an edge object.');
    return;
  }
  const safeArea = value as unknown as UISafeArea;
  if (typeof safeArea === 'boolean') return;
  (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
    if (safeArea[edge] !== undefined && typeof safeArea[edge] !== 'boolean') {
      addIssue(context, `${path}.${edge}`, 'INVALID_TYPE', 'Safe-area edges must be boolean.');
    }
  });
};

const validateStyle = (context: ValidationContext, value: unknown, path: string) => {
  if (!isRecord(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'Style must be an object.');
    return;
  }
  const style = value as unknown as UIStyle;
  if (style.anchor !== undefined) validateAnchor(context, style.anchor, `${path}.anchor`);
  if (style.safeArea !== undefined) validateSafeArea(context, style.safeArea, `${path}.safeArea`);
  (['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'gap', 'borderWidth', 'borderRadius', 'fontSize', 'letterSpacing'] as const)
    .forEach((property) => {
      if (style[property] !== undefined) validateLength(context, style[property], `${path}.${property}`);
    });
  if (style.lineHeight !== undefined && typeof style.lineHeight !== 'number') {
    validateLength(context, style.lineHeight, `${path}.lineHeight`);
  } else if (typeof style.lineHeight === 'number' && (!Number.isFinite(style.lineHeight) || style.lineHeight < 0)) {
    addIssue(context, `${path}.lineHeight`, 'INVALID_VALUE', 'Line height must be non-negative and finite.');
  }
  if (style.padding !== undefined) validateBox(context, style.padding, `${path}.padding`);
  if (style.margin !== undefined) validateBox(context, style.margin, `${path}.margin`);
  (['color', 'background', 'borderColor', 'boxShadow', 'fontFamily'] as const).forEach((property) => {
    if (style[property] !== undefined) validateSafeCss(context, style[property], `${path}.${property}`);
  });
  if (style.opacity !== undefined && (!Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1)) {
    addIssue(context, `${path}.opacity`, 'INVALID_VALUE', 'Opacity must be between 0 and 1.');
  }
  if (style.zIndex !== undefined && (!Number.isInteger(style.zIndex) || Math.abs(style.zIndex) > 1_000_000)) {
    addIssue(context, `${path}.zIndex`, 'INVALID_VALUE', 'zIndex must be a bounded integer.');
  }
  if (style.fontWeight !== undefined && (!Number.isInteger(style.fontWeight) || style.fontWeight < 1 || style.fontWeight > 1_000)) {
    addIssue(context, `${path}.fontWeight`, 'INVALID_VALUE', 'Font weight must be an integer from 1 to 1000.');
  }
  const enumValues: Array<[unknown, string, string[]]> = [
    [style.overflow, `${path}.overflow`, ['visible', 'hidden', 'auto', 'scroll']],
    [style.pointerEvents, `${path}.pointerEvents`, ['auto', 'none']],
    [style.textAlign, `${path}.textAlign`, ['left', 'center', 'right']],
    [style.fontVariantNumeric, `${path}.fontVariantNumeric`, ['normal', 'tabular-nums']],
    [style.overflowWrap, `${path}.overflowWrap`, ['normal', 'break-word', 'anywhere']],
    [style.whiteSpace, `${path}.whiteSpace`, ['normal', 'nowrap', 'pre-line']],
    [style.textTransform, `${path}.textTransform`, ['none', 'uppercase', 'lowercase', 'capitalize']],
    [style.alignSelf, `${path}.alignSelf`, ['auto', 'start', 'center', 'end', 'stretch']],
    [style.justifySelf, `${path}.justifySelf`, ['auto', 'start', 'center', 'end', 'stretch']],
  ];
  enumValues.forEach(([property, propertyPath, allowed]) => {
    if (property !== undefined && (typeof property !== 'string' || !allowed.includes(property))) {
      addIssue(context, propertyPath, 'INVALID_VALUE', `Expected one of: ${allowed.join(', ')}.`);
    }
  });
};

const validateLayout = (context: ValidationContext, value: unknown, path: string) => {
  if (!isRecord(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'Layout must be an object.');
    return;
  }
  const layout = value as unknown as UIContainerLayout;
  if (layout.type === 'flex') {
    const enumValues: Array<[unknown, string, string[]]> = [
      [layout.direction, `${path}.direction`, ['row', 'column']],
      [layout.wrap, `${path}.wrap`, ['nowrap', 'wrap']],
      [layout.align, `${path}.align`, ['start', 'center', 'end', 'stretch']],
      [layout.justify, `${path}.justify`, ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly']],
    ];
    enumValues.forEach(([property, propertyPath, allowed]) => {
      if (property !== undefined && (typeof property !== 'string' || !allowed.includes(property))) {
        addIssue(context, propertyPath, 'INVALID_VALUE', `Expected one of: ${allowed.join(', ')}.`);
      }
    });
    if (layout.gap !== undefined) validateLength(context, layout.gap, `${path}.gap`);
    return;
  }
  if (layout.type === 'grid') {
    if (typeof layout.columns === 'number') {
      if (!Number.isInteger(layout.columns) || layout.columns < 1 || layout.columns > 24) {
        addIssue(context, `${path}.columns`, 'INVALID_VALUE', 'Grid columns must be an integer from 1 to 24.');
      }
    } else if (Array.isArray(layout.columns) && layout.columns.length > 0) {
      layout.columns.forEach((track, index) => validateLength(context, track, `${path}.columns[${index}]`, true));
    } else {
      addIssue(context, `${path}.columns`, 'INVALID_VALUE', 'Grid columns must be a count or non-empty track list.');
    }
    if (layout.rows !== undefined) {
      if (!Array.isArray(layout.rows) || layout.rows.length === 0) {
        addIssue(context, `${path}.rows`, 'INVALID_VALUE', 'Grid rows must be a non-empty track list.');
      } else {
        layout.rows.forEach((track, index) => validateLength(context, track, `${path}.rows[${index}]`, true));
      }
    }
    if (layout.gap !== undefined) validateLength(context, layout.gap, `${path}.gap`);
    const enumValues: Array<[unknown, string, string[]]> = [
      [layout.align, `${path}.align`, ['start', 'center', 'end', 'stretch']],
      [layout.justify, `${path}.justify`, ['start', 'center', 'end', 'stretch', 'space-between', 'space-around', 'space-evenly']],
    ];
    enumValues.forEach(([property, propertyPath, allowed]) => {
      if (property !== undefined && (typeof property !== 'string' || !allowed.includes(property))) {
        addIssue(context, propertyPath, 'INVALID_VALUE', `Expected one of: ${allowed.join(', ')}.`);
      }
    });
    return;
  }
  addIssue(context, `${path}.type`, 'INVALID_VALUE', 'Layout type must be "flex" or "grid".');
};

const validateResponsive = (context: ValidationContext, value: unknown, path: string) => {
  if (!Array.isArray(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'Responsive overrides must be an array.');
    return;
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      addIssue(context, entryPath, 'INVALID_TYPE', 'Responsive override must be an object.');
      return;
    }
    const override = entry as unknown as UIResponsiveOverride;
    if (validateIdentifier(context, override.breakpointId, `${entryPath}.breakpointId`, 'Breakpoint ID')) {
      if (!context.breakpoints.has(override.breakpointId)) {
        addIssue(context, `${entryPath}.breakpointId`, 'MISSING_REFERENCE', `Breakpoint "${override.breakpointId}" is not defined.`);
      }
      if (seen.has(override.breakpointId)) {
        addIssue(context, `${entryPath}.breakpointId`, 'DUPLICATE_ID', `Breakpoint "${override.breakpointId}" is overridden more than once.`);
      }
      seen.add(override.breakpointId);
    }
    if (override.style === undefined && override.layout === undefined) {
      addIssue(context, entryPath, 'INVALID_STRUCTURE', 'Responsive override must contain style or layout.');
    }
    if (override.style !== undefined) validateStyle(context, override.style, `${entryPath}.style`);
    if (override.layout !== undefined) validateLayout(context, override.layout, `${entryPath}.layout`);
  });
};

const validateActivation = (context: ValidationContext, value: unknown, path: string) => {
  if (!isRecord(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'Activation binding must be an object.');
    return;
  }
  const binding = value as unknown as UIActivationBinding;
  if (binding.type === 'event') {
    validateIdentifier(context, binding.eventId, `${path}.eventId`, 'Event ID');
    if (binding.payload !== undefined && !isRecord(binding.payload)) {
      addIssue(context, `${path}.payload`, 'INVALID_TYPE', 'Event payload must be a JSON object.');
    }
    return;
  }
  if (binding.type === 'action') {
    validateIdentifier(context, binding.actionId, `${path}.actionId`, 'Action ID');
    if (binding.phase !== undefined && binding.phase !== 'pressed' && binding.phase !== 'released') {
      addIssue(context, `${path}.phase`, 'INVALID_VALUE', 'Action phase must be pressed or released.');
    }
    return;
  }
  addIssue(context, `${path}.type`, 'INVALID_VALUE', 'Activation type must be event or action.');
};

const validateActionBinding = (context: ValidationContext, value: unknown, path: string) => {
  if (!isRecord(value) || value.type !== 'action') {
    addIssue(context, path, 'INVALID_TYPE', 'Expected an action binding.');
    return;
  }
  validateActivation(context, value as unknown as UIActionBinding, path);
};

const validateElement = (
  context: ValidationContext,
  value: unknown,
  path: string,
  depth: number,
  isRoot: boolean,
) => {
  if (depth > MAX_DEPTH) {
    addIssue(context, path, 'LIMIT_EXCEEDED', `UI nesting may not exceed ${MAX_DEPTH} levels.`);
    return;
  }
  if (!isRecord(value)) {
    addIssue(context, path, 'INVALID_TYPE', 'UI element must be an object.');
    return;
  }
  context.elementCount += 1;
  if (context.elementCount > MAX_ELEMENTS) {
    if (context.elementCount === MAX_ELEMENTS + 1) {
      addIssue(context, path, 'LIMIT_EXCEEDED', `UI document may not exceed ${MAX_ELEMENTS} elements.`);
    }
    return;
  }

  const element = value as unknown as UIElement;
  if (validateIdentifier(context, element.id, `${path}.id`, 'Element ID')) {
    if (context.elementIds.has(element.id)) {
      addIssue(context, `${path}.id`, 'DUPLICATE_ID', `Element ID "${element.id}" is duplicated.`);
    }
    context.elementIds.add(element.id);
  }
  if (typeof element.type !== 'string' || !['screen', 'stack', 'panel', 'text', 'image', 'button', 'progress', 'inputPrompt'].includes(element.type)) {
    addIssue(context, `${path}.type`, 'INVALID_VALUE', 'Unsupported UI element type.');
    return;
  }
  if (element.type === 'screen' && !isRoot) {
    addIssue(context, path, 'INVALID_STRUCTURE', 'Screen elements may only appear at the document root.');
  }
  if (element.visible !== undefined) validateBooleanBinding(context, element.visible, `${path}.visible`);
  if (element.style !== undefined) validateStyle(context, element.style, `${path}.style`);
  if (element.responsive !== undefined) validateResponsive(context, element.responsive, `${path}.responsive`);

  const validateChildren = (children: unknown) => {
    if (!Array.isArray(children)) {
      addIssue(context, `${path}.children`, 'INVALID_TYPE', 'Container children must be an array.');
      return;
    }
    children.forEach((child, index) => validateElement(context, child, `${path}.children[${index}]`, depth + 1, false));
  };

  switch (element.type) {
    case 'screen':
      if (element.label !== undefined) validateTextBinding(context, element.label, `${path}.label`);
      if (element.layout !== undefined) validateLayout(context, element.layout, `${path}.layout`);
      validateChildren(element.children);
      if (element.focusOrder !== undefined) {
        if (!Array.isArray(element.focusOrder)) {
          addIssue(context, `${path}.focusOrder`, 'INVALID_TYPE', 'Focus order must be an array of element IDs.');
        } else {
          const seenFocus = new Set<string>();
          element.focusOrder.forEach((id, index) => {
            if (typeof id !== 'string' || !IDENTIFIER_PATTERN.test(id)) {
              addIssue(context, `${path}.focusOrder[${index}]`, 'INVALID_VALUE', 'Focus references must be stable IDs.');
            } else {
              if (seenFocus.has(id)) addIssue(context, `${path}.focusOrder[${index}]`, 'DUPLICATE_ID', `Focus ID "${id}" is duplicated.`);
              seenFocus.add(id);
              context.focusReferences.push({ path: `${path}.focusOrder[${index}]`, id, initial: false });
            }
          });
        }
      }
      if (element.initialFocusId !== undefined) {
        if (validateIdentifier(context, element.initialFocusId, `${path}.initialFocusId`, 'Initial focus ID')) {
          context.focusReferences.push({ path: `${path}.initialFocusId`, id: element.initialFocusId, initial: true });
        }
      }
      break;
    case 'stack':
      if (!['row', 'column'].includes(element.direction)) addIssue(context, `${path}.direction`, 'INVALID_VALUE', 'Stack direction must be row or column.');
      if (element.wrap !== undefined && !['nowrap', 'wrap'].includes(element.wrap)) addIssue(context, `${path}.wrap`, 'INVALID_VALUE', 'Invalid stack wrapping.');
      if (element.align !== undefined && !['start', 'center', 'end', 'stretch'].includes(element.align)) addIssue(context, `${path}.align`, 'INVALID_VALUE', 'Invalid stack alignment.');
      if (element.justify !== undefined && !['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'].includes(element.justify)) addIssue(context, `${path}.justify`, 'INVALID_VALUE', 'Invalid stack justification.');
      if (element.gap !== undefined) validateLength(context, element.gap, `${path}.gap`);
      validateChildren(element.children);
      break;
    case 'panel':
      if (element.label !== undefined) validateTextBinding(context, element.label, `${path}.label`);
      if (element.role !== undefined && !['group', 'region', 'status', 'alert'].includes(element.role)) addIssue(context, `${path}.role`, 'INVALID_VALUE', 'Invalid panel role.');
      if (element.role === 'region' && element.label === undefined) addIssue(context, `${path}.label`, 'INVALID_STRUCTURE', 'Region panels require an accessible label.');
      if (element.live !== undefined && !['off', 'polite', 'assertive'].includes(element.live)) addIssue(context, `${path}.live`, 'INVALID_VALUE', 'Invalid live-region mode.');
      if (element.layout !== undefined) validateLayout(context, element.layout, `${path}.layout`);
      validateChildren(element.children);
      break;
    case 'text':
      validateTextBinding(context, element.value, `${path}.value`);
      if (element.element !== undefined && !['span', 'p', 'h1', 'h2', 'h3'].includes(element.element)) addIssue(context, `${path}.element`, 'INVALID_VALUE', 'Invalid semantic text element.');
      if (element.live !== undefined && !['off', 'polite', 'assertive'].includes(element.live)) addIssue(context, `${path}.live`, 'INVALID_VALUE', 'Invalid live-region mode.');
      break;
    case 'image':
      validateTextBinding(context, element.source, `${path}.source`);
      validateTextBinding(context, element.alt, `${path}.alt`);
      if (element.fit !== undefined && !['contain', 'cover', 'fill', 'none', 'scale-down'].includes(element.fit)) addIssue(context, `${path}.fit`, 'INVALID_VALUE', 'Invalid image fit.');
      if (element.loading !== undefined && !['eager', 'lazy'].includes(element.loading)) addIssue(context, `${path}.loading`, 'INVALID_VALUE', 'Invalid image loading mode.');
      break;
    case 'button':
      context.focusableIds.add(element.id);
      validateTextBinding(context, element.label, `${path}.label`);
      if (element.ariaLabel !== undefined) validateTextBinding(context, element.ariaLabel, `${path}.ariaLabel`);
      if (element.disabled !== undefined) validateBooleanBinding(context, element.disabled, `${path}.disabled`);
      if (!Array.isArray(element.activations) || element.activations.length === 0) {
        addIssue(context, `${path}.activations`, 'INVALID_STRUCTURE', 'Buttons require at least one activation binding.');
      } else {
        element.activations.forEach((activation, index) => validateActivation(context, activation, `${path}.activations[${index}]`));
      }
      break;
    case 'progress': {
      validateTextBinding(context, element.label, `${path}.label`);
      validateNumberBinding(context, element.value, `${path}.value`);
      if (element.valueText !== undefined) validateTextBinding(context, element.valueText, `${path}.valueText`);
      const minimum = element.minimum ?? 0;
      const maximum = element.maximum ?? 100;
      if (!Number.isFinite(minimum)) addIssue(context, `${path}.minimum`, 'INVALID_VALUE', 'Progress minimum must be finite.');
      if (!Number.isFinite(maximum) || maximum <= minimum) addIssue(context, `${path}.maximum`, 'INVALID_VALUE', 'Progress maximum must be finite and greater than minimum.');
      if (element.showValue !== undefined && typeof element.showValue !== 'boolean') addIssue(context, `${path}.showValue`, 'INVALID_TYPE', 'showValue must be boolean.');
      break;
    }
    case 'inputPrompt':
      validateActionBinding(context, element.action, `${path}.action`);
      if (element.label !== undefined) validateTextBinding(context, element.label, `${path}.label`);
      if (element.fallback !== undefined) validateString(context, element.fallback, `${path}.fallback`, 'Prompt fallback', true);
      break;
  }
};

const validateVariables = (context: ValidationContext, value: unknown) => {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    addIssue(context, 'variables', 'INVALID_TYPE', 'Variables must be an array.');
    return;
  }
  value.forEach((entry, index) => {
    const path = `variables[${index}]`;
    if (!isRecord(entry)) {
      addIssue(context, path, 'INVALID_TYPE', 'Variable definition must be an object.');
      return;
    }
    const id = entry.id;
    const type = entry.type;
    if (validateIdentifier(context, id, `${path}.id`, 'Variable ID') && typeof id === 'string') {
      if (context.variables.has(id)) addIssue(context, `${path}.id`, 'DUPLICATE_ID', `Variable ID "${id}" is duplicated.`);
    }
    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
      addIssue(context, `${path}.type`, 'INVALID_VALUE', 'Variable type must be string, number, or boolean.');
      return;
    }
    if (typeof id === 'string') context.variables.set(id, type);
    if (scalarTypeOf(entry.initialValue) !== type || (typeof entry.initialValue === 'number' && !Number.isFinite(entry.initialValue))) {
      addIssue(context, `${path}.initialValue`, 'TYPE_MISMATCH', `Initial value must be a finite ${type}.`);
    }
  });
};

const validateBreakpoints = (context: ValidationContext, value: unknown) => {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    addIssue(context, 'breakpoints', 'INVALID_TYPE', 'Breakpoints must be an array.');
    return;
  }
  value.forEach((entry, index) => {
    const path = `breakpoints[${index}]`;
    if (!isRecord(entry)) {
      addIssue(context, path, 'INVALID_TYPE', 'Breakpoint must be an object.');
      return;
    }
    const breakpoint = entry as unknown as UIBreakpoint;
    if (validateIdentifier(context, breakpoint.id, `${path}.id`, 'Breakpoint ID')) {
      if (context.breakpoints.has(breakpoint.id)) addIssue(context, `${path}.id`, 'DUPLICATE_ID', `Breakpoint ID "${breakpoint.id}" is duplicated.`);
      context.breakpoints.add(breakpoint.id);
    }
    if (breakpoint.minWidth === undefined && breakpoint.maxWidth === undefined) {
      addIssue(context, path, 'INVALID_STRUCTURE', 'Breakpoint requires minWidth or maxWidth.');
    }
    if (breakpoint.minWidth !== undefined && (!Number.isFinite(breakpoint.minWidth) || breakpoint.minWidth < 0)) {
      addIssue(context, `${path}.minWidth`, 'INVALID_VALUE', 'minWidth must be non-negative and finite.');
    }
    if (breakpoint.maxWidth !== undefined && (!Number.isFinite(breakpoint.maxWidth) || breakpoint.maxWidth < 0)) {
      addIssue(context, `${path}.maxWidth`, 'INVALID_VALUE', 'maxWidth must be non-negative and finite.');
    }
    if (
      breakpoint.minWidth !== undefined
      && breakpoint.maxWidth !== undefined
      && breakpoint.minWidth > breakpoint.maxWidth
    ) addIssue(context, path, 'INVALID_STRUCTURE', 'Breakpoint minWidth may not exceed maxWidth.');
  });
};

const validateLocalization = (context: ValidationContext, value: unknown) => {
  if (value === undefined) return;
  if (!isRecord(value)) {
    addIssue(context, 'localization', 'INVALID_TYPE', 'Localization catalog must be an object.');
    return;
  }
  context.hasLocalization = true;
  if (!validateString(context, value.defaultLocale, 'localization.defaultLocale', 'Default locale')) return;
  const defaultLocale = value.defaultLocale as string;
  if (!isRecord(value.messages)) {
    addIssue(context, 'localization.messages', 'INVALID_TYPE', 'Localization messages must be an object.');
    return;
  }
  Object.entries(value.messages).forEach(([locale, messages]) => {
    const localePath = `localization.messages.${locale}`;
    if (!/^[A-Za-z0-9-]{1,35}$/.test(locale)) addIssue(context, localePath, 'INVALID_VALUE', 'Locale key is invalid.');
    if (!isRecord(messages)) {
      addIssue(context, localePath, 'INVALID_TYPE', 'Locale messages must be an object.');
      return;
    }
    Object.entries(messages).forEach(([key, message]) => {
      if (
        validateString(context, message, `${localePath}.${key}`, 'Localized message', true)
        && locale === defaultLocale
      ) context.localizationKeys.add(key);
    });
  });
  if (!(defaultLocale in value.messages)) {
    addIssue(context, 'localization.defaultLocale', 'MISSING_REFERENCE', 'Default locale does not exist in messages.');
  }
};

export const validateUIDocument = (value: unknown): UIValidationResult => {
  const serializationIssues: UIValidationIssue[] = [];
  if (!validateSerializable(value, serializationIssues, '$', new Set())) {
    return { ok: false, issues: serializationIssues };
  }
  const context: ValidationContext = {
    issues: serializationIssues,
    variables: new Map(),
    breakpoints: new Set(),
    elementIds: new Set(),
    focusableIds: new Set(),
    focusReferences: [],
    localizationKeys: new Set(),
    hasLocalization: false,
    elementCount: 0,
  };
  if (!isRecord(value)) {
    addIssue(context, '$', 'INVALID_TYPE', 'UI document must be an object.');
    return { ok: false, issues: context.issues };
  }
  if (value.schemaVersion !== 1) addIssue(context, 'schemaVersion', 'INVALID_VALUE', 'Runtime UI schema version must be 1.');
  validateIdentifier(context, value.id, 'id', 'Document ID');
  validateVariables(context, value.variables);
  validateBreakpoints(context, value.breakpoints);
  validateLocalization(context, value.localization);
  if (!isRecord(value.root) || value.root.type !== 'screen') {
    addIssue(context, 'root', 'INVALID_STRUCTURE', 'Document root must be a screen element.');
  } else {
    validateElement(context, value.root, 'root', 0, true);
  }
  context.focusReferences.forEach((reference) => {
    if (!context.focusableIds.has(reference.id)) {
      addIssue(
        context,
        reference.path,
        'MISSING_REFERENCE',
        `${reference.initial ? 'Initial focus' : 'Focus order'} ID "${reference.id}" must reference a button.`,
      );
    }
  });
  return context.issues.length === 0
    ? { ok: true, document: value as unknown as UIDocument }
    : { ok: false, issues: context.issues };
};
