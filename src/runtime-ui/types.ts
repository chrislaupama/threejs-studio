export type UIJsonPrimitive = string | number | boolean | null;

export interface UIJsonObject {
  [key: string]: UIJsonValue;
}

export type UIJsonValue = UIJsonPrimitive | UIJsonObject | UIJsonValue[];
export type UIScalar = string | number | boolean;

export interface UILiteralBinding<T extends UIScalar = UIScalar> {
  type: 'literal';
  value: T;
}

export interface UINumberFormat {
  style?: 'decimal' | 'integer' | 'percent';
  minimumIntegerDigits?: number;
  maximumFractionDigits?: number;
  prefix?: string;
  suffix?: string;
}

export interface UIVariableBinding<T extends UIScalar = UIScalar> {
  type: 'variable';
  variableId: string;
  fallback?: T;
  numberFormat?: UINumberFormat;
}

export type UIScalarBinding = UILiteralBinding | UIVariableBinding;

export interface UILocalizationBinding {
  type: 'localization';
  key: string;
  fallback?: string;
  parameters?: Record<string, UIScalarBinding>;
}

export type UITextBinding =
  | UILiteralBinding<string>
  | UIVariableBinding<UIScalar>
  | UILocalizationBinding;

export type UINumberBinding = UILiteralBinding<number> | UIVariableBinding<number>;
export type UIBooleanBinding = UILiteralBinding<boolean> | UIVariableBinding<boolean>;

export interface UIEventBinding {
  type: 'event';
  eventId: string;
  payload?: UIJsonObject;
}

export interface UIActionBinding {
  type: 'action';
  actionId: string;
  phase?: 'pressed' | 'released';
}

export type UIActivationBinding = UIEventBinding | UIActionBinding;

export type UILengthUnit = 'px' | '%' | 'rem' | 'em' | 'vw' | 'vh' | 'vmin' | 'vmax';
export type UILength =
  | number
  | `${number}${UILengthUnit}`
  | 'auto'
  | 'min-content'
  | 'max-content'
  | 'fit-content';
export type UIGridTrack = UILength | `${number}fr`;

export interface UIBoxEdges {
  top?: UILength;
  right?: UILength;
  bottom?: UILength;
  left?: UILength;
}

export type UIBox = UILength | UIBoxEdges;

export interface UIAnchor {
  top?: UILength;
  right?: UILength;
  bottom?: UILength;
  left?: UILength;
  centerX?: boolean;
  centerY?: boolean;
}

export interface UISafeAreaEdges {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
}

export type UISafeArea = boolean | UISafeAreaEdges;

export interface UIStyle {
  anchor?: UIAnchor;
  safeArea?: UISafeArea;
  width?: UILength;
  height?: UILength;
  minWidth?: UILength;
  minHeight?: UILength;
  maxWidth?: UILength;
  maxHeight?: UILength;
  padding?: UIBox;
  margin?: UIBox;
  gap?: UILength;
  color?: string;
  background?: string;
  borderColor?: string;
  borderWidth?: UILength;
  borderRadius?: UILength;
  boxShadow?: string;
  opacity?: number;
  zIndex?: number;
  overflow?: 'visible' | 'hidden' | 'auto' | 'scroll';
  pointerEvents?: 'auto' | 'none';
  textAlign?: 'left' | 'center' | 'right';
  fontFamily?: string;
  fontSize?: UILength;
  fontWeight?: number;
  fontVariantNumeric?: 'normal' | 'tabular-nums';
  lineHeight?: number | UILength;
  letterSpacing?: UILength;
  overflowWrap?: 'normal' | 'break-word' | 'anywhere';
  whiteSpace?: 'normal' | 'nowrap' | 'pre-line';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  alignSelf?: 'auto' | 'start' | 'center' | 'end' | 'stretch';
  justifySelf?: 'auto' | 'start' | 'center' | 'end' | 'stretch';
}

export interface UIFlexLayout {
  type: 'flex';
  direction?: 'row' | 'column';
  wrap?: 'nowrap' | 'wrap';
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
  gap?: UILength;
}

export interface UIGridLayout {
  type: 'grid';
  columns: number | UIGridTrack[];
  rows?: UIGridTrack[];
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'stretch' | 'space-between' | 'space-around' | 'space-evenly';
  gap?: UILength;
}

export type UIContainerLayout = UIFlexLayout | UIGridLayout;

export interface UIResponsiveOverride {
  breakpointId: string;
  style?: UIStyle;
  layout?: UIContainerLayout;
}

export type UIElementType = 'screen' | 'stack' | 'panel' | 'text' | 'image' | 'button' | 'progress' | 'inputPrompt';

export interface UIElementBase {
  id: string;
  type: UIElementType;
  visible?: UIBooleanBinding;
  style?: UIStyle;
  responsive?: UIResponsiveOverride[];
}

export interface UIScreenElement extends UIElementBase {
  type: 'screen';
  label?: UITextBinding;
  layout?: UIContainerLayout;
  children: UIElement[];
  focusOrder?: string[];
  initialFocusId?: string;
}

export interface UIStackElement extends UIElementBase {
  type: 'stack';
  direction: 'row' | 'column';
  wrap?: 'nowrap' | 'wrap';
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
  gap?: UILength;
  children: UIElement[];
}

export interface UIPanelElement extends UIElementBase {
  type: 'panel';
  label?: UITextBinding;
  role?: 'group' | 'region' | 'status' | 'alert';
  live?: 'off' | 'polite' | 'assertive';
  layout?: UIContainerLayout;
  children: UIElement[];
}

export interface UITextElement extends UIElementBase {
  type: 'text';
  value: UITextBinding;
  element?: 'span' | 'p' | 'h1' | 'h2' | 'h3';
  live?: 'off' | 'polite' | 'assertive';
}

export interface UIImageElement extends UIElementBase {
  type: 'image';
  source: UITextBinding;
  alt: UITextBinding;
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  loading?: 'eager' | 'lazy';
}

export interface UIButtonElement extends UIElementBase {
  type: 'button';
  label: UITextBinding;
  ariaLabel?: UITextBinding;
  disabled?: UIBooleanBinding;
  activations: UIActivationBinding[];
}

export interface UIProgressElement extends UIElementBase {
  type: 'progress';
  label: UITextBinding;
  value: UINumberBinding;
  minimum?: number;
  maximum?: number;
  valueText?: UITextBinding;
  showValue?: boolean;
}

export interface UIInputPromptElement extends UIElementBase {
  type: 'inputPrompt';
  action: UIActionBinding;
  label?: UITextBinding;
  fallback?: string;
}

export type UIElement =
  | UIScreenElement
  | UIStackElement
  | UIPanelElement
  | UITextElement
  | UIImageElement
  | UIButtonElement
  | UIProgressElement
  | UIInputPromptElement;

export interface UIVariableDefinition {
  id: string;
  type: 'string' | 'number' | 'boolean';
  initialValue: UIScalar;
}

export interface UIBreakpoint {
  id: string;
  minWidth?: number;
  maxWidth?: number;
}

export interface UILocalizationCatalog {
  defaultLocale: string;
  messages: Record<string, Record<string, string>>;
}

export interface UIDocument {
  schemaVersion: 1;
  id: string;
  variables?: UIVariableDefinition[];
  breakpoints?: UIBreakpoint[];
  localization?: UILocalizationCatalog;
  root: UIScreenElement;
}

export interface UIEventDispatch {
  eventId: string;
  payload?: UIJsonObject;
  sourceElementId: string;
}

export interface UIActionDispatch {
  actionId: string;
  phase: 'pressed' | 'released';
  sourceElementId: string;
}

export interface UILocalizationRequest {
  locale: string;
  key: string;
  fallback?: string;
  parameters: Record<string, UIScalar>;
}

export interface UIDiagnostic {
  code: 'CALLBACK_ERROR' | 'LOCALIZATION_ERROR' | 'ASSET_RESOLUTION_ERROR';
  message: string;
  elementId?: string;
}

export interface UIResolvedAsset {
  /**
   * URL assigned to the runtime element. Returning a plain string from the
   * resolver is treated as a borrowed URL; returning this handle transfers
   * ownership of any associated cleanup to the runtime UI controller.
   */
  url: string;
  /**
   * Called exactly once after this resolved URL is replaced, the document is
   * rerendered, or the controller is disposed. Resolvers that create Blob URLs
   * should revoke them here. The callback should release only this resolution.
   */
  dispose?: () => void;
}
