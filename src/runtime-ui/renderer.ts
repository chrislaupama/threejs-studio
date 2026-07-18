import type {
  UIActionDispatch,
  UIActivationBinding,
  UIBox,
  UIContainerLayout,
  UIDiagnostic,
  UIDocument,
  UIElement,
  UIEventDispatch,
  UIGridTrack,
  UILength,
  UILocalizationRequest,
  UINumberFormat,
  UIResponsiveOverride,
  UIResolvedAsset,
  UISafeAreaEdges,
  UIScalar,
  UIScalarBinding,
  UIStyle,
  UITextBinding,
} from './types';
import {
  UIValidationError,
  validateUIDocument,
  type UIValidationResult,
} from './validation';

export interface RuntimeUIOptions {
  target: HTMLElement;
  document: UIDocument;
  variables?: Record<string, UIScalar>;
  locale?: string;
  actionPrompts?: Record<string, string>;
  localize?: (request: UILocalizationRequest) => string | undefined;
  /**
   * Resolve an authored asset reference. A string result is borrowed. Return
   * UIResolvedAsset when the resolution owns resources such as a Blob URL so
   * the controller can release them deterministically.
   */
  resolveAssetUrl?: (source: string, elementId: string) => string | UIResolvedAsset;
  onEvent?: (event: UIEventDispatch) => void;
  onAction?: (action: UIActionDispatch) => void;
  onDiagnostic?: (diagnostic: UIDiagnostic) => void;
}

export type UIStateUpdateResult =
  | { ok: true }
  | { ok: false; code: 'DISPOSED' | 'UNKNOWN_VARIABLE' | 'TYPE_MISMATCH'; message: string };

export interface RuntimeUIController {
  readonly root: HTMLElement;
  getDocument(): UIDocument;
  getElement(id: string): HTMLElement | null;
  getVariable(id: string): UIScalar | undefined;
  setVariable(id: string, value: UIScalar): UIStateUpdateResult;
  setVariables(values: Record<string, UIScalar>): UIStateUpdateResult;
  setLocale(locale: string): void;
  setActionPrompt(actionId: string, prompt: string): void;
  updateDocument(document: UIDocument): UIValidationResult;
  refreshLayout(width?: number): void;
  focusElement(id: string): boolean;
  focusNext(direction?: 1 | -1, fromId?: string): boolean;
  dispose(): void;
}

let instanceCounter = 0;

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const scalarType = (value: UIScalar) => typeof value as 'string' | 'number' | 'boolean';

const cssLength = (value: UILength | UIGridTrack): string => (
  typeof value === 'number' ? `${value}px` : value
);

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const baseStyles = (instanceId: string) => `
[data-runtime-ui-root="${instanceId}"],
[data-runtime-ui-root="${instanceId}"] * {
  box-sizing: border-box;
}
[data-runtime-ui-root="${instanceId}"] {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  color: #f4f4f5;
  font-family: ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
[data-runtime-ui-root="${instanceId}"] [data-ui-type="screen"] {
  position: relative;
  width: 100%;
  height: 100%;
  isolation: isolate;
}
[data-runtime-ui-root="${instanceId}"] button[data-ui-type="button"] {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid currentColor;
  border-radius: 8px;
  padding: 8px 14px;
  color: inherit;
  background: rgb(24 24 27 / 0.88);
  font: inherit;
  cursor: pointer;
  pointer-events: auto;
  overflow-wrap: anywhere;
  transition: filter 100ms ease;
}
[data-runtime-ui-root="${instanceId}"] button[data-ui-type="button"]:hover:not(:disabled) {
  filter: brightness(1.12);
}
[data-runtime-ui-root="${instanceId}"] button[data-ui-type="button"]:active:not(:disabled) {
  filter: brightness(0.88);
}
[data-runtime-ui-root="${instanceId}"] button[data-ui-type="button"]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
[data-runtime-ui-root="${instanceId}"] button[data-ui-type="button"]:focus-visible {
  outline: 3px solid #5eead4;
  outline-offset: 3px;
}
[data-runtime-ui-root="${instanceId}"] [data-ui-type="image"] {
  display: block;
}
[data-runtime-ui-root="${instanceId}"] [data-ui-type="progress"] {
  position: relative;
  min-width: 120px;
  min-height: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(63 63 70 / 0.72);
}
[data-runtime-ui-root="${instanceId}"] [data-ui-progress-fill] {
  width: 0;
  height: 100%;
  background: #2dd4bf;
  transition: width 120ms linear;
}
[data-runtime-ui-root="${instanceId}"] [data-ui-progress-value] {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding-inline: 6px;
  font-variant-numeric: tabular-nums;
  font-size: 0.75rem;
  line-height: 1;
}
[data-runtime-ui-root="${instanceId}"] [data-ui-type="inputPrompt"] {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
[data-runtime-ui-root="${instanceId}"] [data-ui-input-key] {
  min-width: 2rem;
  min-height: 2rem;
  display: inline-grid;
  place-items: center;
  padding: 0.25rem 0.5rem;
  border: 1px solid currentColor;
  border-radius: 0.4rem;
  background: rgb(24 24 27 / 0.88);
  font: inherit;
  font-weight: 700;
}
@media (prefers-reduced-motion: reduce) {
  [data-runtime-ui-root="${instanceId}"] * {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;

class DOMRuntimeUIController implements RuntimeUIController {
  readonly root: HTMLElement;

  private uiDocument: UIDocument;
  private readonly target: HTMLElement;
  private readonly ownerDocument: Document;
  private readonly ownerWindow: Window & typeof globalThis;
  private readonly instanceId: string;
  private readonly elements = new Map<string, HTMLElement>();
  private readonly elementDefinitions = new Map<string, UIElement>();
  private readonly variables = new Map<string, UIScalar>();
  private readonly actionPrompts = new Map<string, string>();
  private readonly assetCleanups = new Map<string, () => void>();
  private readonly cleanups: Array<() => void> = [];
  private readonly localizeCallback?: RuntimeUIOptions['localize'];
  private readonly resolveAssetUrlCallback?: RuntimeUIOptions['resolveAssetUrl'];
  private readonly eventCallback?: RuntimeUIOptions['onEvent'];
  private readonly actionCallback?: RuntimeUIOptions['onAction'];
  private readonly diagnosticCallback?: RuntimeUIOptions['onDiagnostic'];
  private locale: string;
  private resizeObserver?: ResizeObserver;
  private disposed = false;

  constructor(options: RuntimeUIOptions) {
    const validation = validateUIDocument(options.document);
    if (!validation.ok) throw new UIValidationError(validation.issues);

    this.target = options.target;
    this.ownerDocument = options.target.ownerDocument;
    const ownerWindow = this.ownerDocument.defaultView;
    if (!ownerWindow) throw new Error('Runtime UI target must belong to a window.');
    this.ownerWindow = ownerWindow as Window & typeof globalThis;
    this.instanceId = `runtime-ui-${++instanceCounter}`;
    this.uiDocument = cloneJson(options.document);
    this.localizeCallback = options.localize;
    this.resolveAssetUrlCallback = options.resolveAssetUrl;
    this.eventCallback = options.onEvent;
    this.actionCallback = options.onAction;
    this.diagnosticCallback = options.onDiagnostic;
    this.locale = options.locale ?? this.uiDocument.localization?.defaultLocale ?? 'en';

    this.root = this.ownerDocument.createElement('div');
    this.root.dataset.runtimeUiRoot = this.instanceId;
    this.root.setAttribute('data-runtime-ui-document', this.uiDocument.id);
    this.root.addEventListener('keydown', this.handleRootKeyDown);
    this.target.append(this.root);

    this.initializeVariables(options.variables);
    Object.entries(options.actionPrompts ?? {}).forEach(([actionId, prompt]) => this.actionPrompts.set(actionId, prompt));
    this.render(true);

    const ResizeObserverConstructor = (
      this.ownerWindow as unknown as { ResizeObserver?: typeof ResizeObserver }
    ).ResizeObserver;
    if (ResizeObserverConstructor) {
      const resizeObserver = new ResizeObserverConstructor(() => this.refreshLayout());
      this.resizeObserver = resizeObserver;
      resizeObserver.observe(this.target);
    } else {
      this.ownerWindow.addEventListener('resize', this.handleWindowResize);
    }
  }

  getDocument(): UIDocument {
    return cloneJson(this.uiDocument);
  }

  getElement(id: string): HTMLElement | null {
    return this.elements.get(id) ?? null;
  }

  getVariable(id: string): UIScalar | undefined {
    return this.variables.get(id);
  }

  setVariable(id: string, value: UIScalar): UIStateUpdateResult {
    const validation = this.validateVariableUpdate(id, value);
    if (!validation.ok) return validation;
    this.variables.set(id, value);
    this.updateState();
    return { ok: true };
  }

  setVariables(values: Record<string, UIScalar>): UIStateUpdateResult {
    if (this.disposed) return { ok: false, code: 'DISPOSED', message: 'Runtime UI controller is disposed.' };
    for (const [id, value] of Object.entries(values)) {
      const validation = this.validateVariableUpdate(id, value);
      if (!validation.ok) return validation;
    }
    Object.entries(values).forEach(([id, value]) => this.variables.set(id, value));
    this.updateState();
    return { ok: true };
  }

  setLocale(locale: string): void {
    if (this.disposed || this.locale === locale) return;
    this.locale = locale;
    this.updateState();
  }

  setActionPrompt(actionId: string, prompt: string): void {
    if (this.disposed) return;
    this.actionPrompts.set(actionId, prompt);
    this.updateState();
  }

  updateDocument(document: UIDocument): UIValidationResult {
    const validation = validateUIDocument(document);
    if (!validation.ok) return validation;
    if (this.disposed) {
      return {
        ok: false,
        issues: [{
          path: '$',
          code: 'INVALID_STRUCTURE',
          message: 'Runtime UI controller is disposed.',
        }],
      };
    }

    const previousVariables = new Map(this.variables);
    const activeElement = this.ownerDocument.activeElement;
    const focusWasInside = activeElement !== null && this.root.contains(activeElement);
    const activeId = this.findElementId(activeElement);
    this.uiDocument = cloneJson(document);
    this.variables.clear();
    this.uiDocument.variables?.forEach((definition) => {
      const previous = previousVariables.get(definition.id);
      this.variables.set(
        definition.id,
        previous !== undefined && scalarType(previous) === definition.type ? previous : definition.initialValue,
      );
    });
    this.render(false);
    if (focusWasInside && (!activeId || !this.focusElement(activeId))) this.focusInitialElement();
    return { ok: true, document };
  }

  refreshLayout(width?: number): void {
    if (this.disposed) return;
    const measuredWidth = width ?? this.target.getBoundingClientRect().width ?? this.ownerWindow.innerWidth;
    const layoutWidth = measuredWidth > 0 ? measuredWidth : this.ownerWindow.innerWidth;
    this.elementDefinitions.forEach((element, id) => {
      const dom = this.elements.get(id);
      if (dom) this.applyElementStyle(dom, element, layoutWidth);
    });
  }

  focusElement(id: string): boolean {
    if (this.disposed) return false;
    const element = this.elements.get(id);
    if (!element || !this.isFocusable(element)) return false;
    element.focus();
    return this.ownerDocument.activeElement === element;
  }

  focusNext(direction: 1 | -1 = 1, fromId?: string): boolean {
    if (this.disposed) return false;
    const order = this.getFocusableOrder();
    if (order.length === 0) return false;
    const activeId = fromId ?? this.findElementId(this.ownerDocument.activeElement);
    const activeIndex = activeId ? order.indexOf(activeId) : -1;
    const nextIndex = activeIndex < 0
      ? (direction === 1 ? 0 : order.length - 1)
      : (activeIndex + direction + order.length) % order.length;
    return this.focusElement(order[nextIndex]!);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.ownerWindow.removeEventListener('resize', this.handleWindowResize);
    this.root.removeEventListener('keydown', this.handleRootKeyDown);
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    this.releaseAllAssets();
    this.elements.clear();
    this.elementDefinitions.clear();
    this.variables.clear();
    this.actionPrompts.clear();
    this.root.remove();
  }

  private initializeVariables(overrides?: Record<string, UIScalar>) {
    this.uiDocument.variables?.forEach((definition) => this.variables.set(definition.id, definition.initialValue));
    Object.entries(overrides ?? {}).forEach(([id, value]) => {
      if (this.validateVariableUpdate(id, value).ok) this.variables.set(id, value);
    });
  }

  private validateVariableUpdate(id: string, value: UIScalar): UIStateUpdateResult {
    if (this.disposed) return { ok: false, code: 'DISPOSED', message: 'Runtime UI controller is disposed.' };
    const definition = this.uiDocument.variables?.find((candidate) => candidate.id === id);
    if (!definition) return { ok: false, code: 'UNKNOWN_VARIABLE', message: `Variable "${id}" is not defined.` };
    if (scalarType(value) !== definition.type || (typeof value === 'number' && !Number.isFinite(value))) {
      return { ok: false, code: 'TYPE_MISMATCH', message: `Variable "${id}" requires a finite ${definition.type}.` };
    }
    return { ok: true };
  }

  private render(useInitialFocus: boolean) {
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    this.releaseAllAssets();
    this.elements.clear();
    this.elementDefinitions.clear();
    this.root.replaceChildren();
    this.root.setAttribute('data-runtime-ui-document', this.uiDocument.id);

    const styleElement = this.ownerDocument.createElement('style');
    styleElement.dataset.runtimeUiStyles = this.instanceId;
    styleElement.textContent = baseStyles(this.instanceId);
    this.root.append(styleElement, this.createElement(this.uiDocument.root));
    this.refreshLayout();
    if (useInitialFocus) this.focusInitialElement();
  }

  private createElement(element: UIElement): HTMLElement {
    let dom: HTMLElement;
    switch (element.type) {
      case 'screen':
        dom = this.ownerDocument.createElement('section');
        element.children.forEach((child) => dom.append(this.createElement(child)));
        break;
      case 'stack':
        dom = this.ownerDocument.createElement('div');
        element.children.forEach((child) => dom.append(this.createElement(child)));
        break;
      case 'panel':
        dom = this.ownerDocument.createElement('section');
        element.children.forEach((child) => dom.append(this.createElement(child)));
        break;
      case 'text':
        dom = this.ownerDocument.createElement(element.element ?? 'span');
        break;
      case 'image':
        dom = this.ownerDocument.createElement('img');
        break;
      case 'button': {
        const button = this.ownerDocument.createElement('button');
        button.type = 'button';
        const activate = () => this.activateBindings(element.id, element.activations);
        button.addEventListener('click', activate);
        this.cleanups.push(() => button.removeEventListener('click', activate));
        dom = button;
        break;
      }
      case 'progress': {
        dom = this.ownerDocument.createElement('div');
        const fill = this.ownerDocument.createElement('div');
        fill.dataset.uiProgressFill = '';
        fill.setAttribute('aria-hidden', 'true');
        const value = this.ownerDocument.createElement('span');
        value.dataset.uiProgressValue = '';
        value.setAttribute('aria-hidden', 'true');
        dom.append(fill, value);
        break;
      }
      case 'inputPrompt': {
        dom = this.ownerDocument.createElement('div');
        const key = this.ownerDocument.createElement('kbd');
        key.dataset.uiInputKey = '';
        const label = this.ownerDocument.createElement('span');
        label.dataset.uiInputLabel = '';
        dom.append(key, label);
        break;
      }
    }

    dom.dataset.uiId = element.id;
    dom.dataset.uiType = element.type;
    this.elements.set(element.id, dom);
    this.elementDefinitions.set(element.id, element);
    this.syncElementState(dom, element);
    return dom;
  }

  private updateState() {
    const activeId = this.findElementId(this.ownerDocument.activeElement);
    this.elementDefinitions.forEach((element, id) => {
      const dom = this.elements.get(id);
      if (dom) this.syncElementState(dom, element);
    });
    if (activeId) {
      const active = this.elements.get(activeId);
      if (active && !this.isFocusable(active)) this.focusNext(1, activeId);
    }
  }

  private syncElementState(dom: HTMLElement, element: UIElement) {
    const visible = element.visible === undefined || this.resolveBoolean(element.visible);
    dom.hidden = !visible;
    if (!visible) dom.setAttribute('aria-hidden', 'true');
    else dom.removeAttribute('aria-hidden');

    switch (element.type) {
      case 'screen': {
        const label = element.label ? this.resolveText(element.label) : '';
        this.setAccessibleLabel(dom, label);
        break;
      }
      case 'stack':
        break;
      case 'panel': {
        if (element.role) dom.setAttribute('role', element.role);
        else dom.removeAttribute('role');
        if (element.live) dom.setAttribute('aria-live', element.live);
        else dom.removeAttribute('aria-live');
        const label = element.label ? this.resolveText(element.label) : '';
        this.setAccessibleLabel(dom, label);
        break;
      }
      case 'text':
        dom.textContent = this.resolveText(element.value);
        if (element.live) dom.setAttribute('aria-live', element.live);
        else dom.removeAttribute('aria-live');
        break;
      case 'image': {
        const image = dom as HTMLImageElement;
        const source = this.resolveText(element.source);
        image.alt = this.resolveText(element.alt);
        image.loading = element.loading ?? 'eager';
        if (image.dataset.uiSource !== source) {
          this.releaseAsset(element.id);
          image.dataset.uiSource = source;
          const resolved = this.resolveAssetSource(source, element.id);
          image.src = resolved.url;
          if (resolved.dispose) this.assetCleanups.set(element.id, resolved.dispose);
        }
        break;
      }
      case 'button': {
        const button = dom as HTMLButtonElement;
        button.textContent = this.resolveText(element.label);
        button.disabled = element.disabled ? this.resolveBoolean(element.disabled) : false;
        const ariaLabel = element.ariaLabel ? this.resolveText(element.ariaLabel) : '';
        if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
        else button.removeAttribute('aria-label');
        break;
      }
      case 'progress': {
        const minimum = element.minimum ?? 0;
        const maximum = element.maximum ?? 100;
        const rawValue = this.resolveNumber(element.value);
        const value = Math.min(maximum, Math.max(minimum, rawValue));
        const percent = maximum === minimum ? 0 : ((value - minimum) / (maximum - minimum)) * 100;
        dom.setAttribute('role', 'progressbar');
        dom.setAttribute('aria-label', this.resolveText(element.label));
        dom.setAttribute('aria-valuemin', String(minimum));
        dom.setAttribute('aria-valuemax', String(maximum));
        dom.setAttribute('aria-valuenow', String(value));
        if (element.valueText) dom.setAttribute('aria-valuetext', this.resolveText(element.valueText));
        else dom.removeAttribute('aria-valuetext');
        const fill = dom.querySelector<HTMLElement>('[data-ui-progress-fill]');
        const output = dom.querySelector<HTMLElement>('[data-ui-progress-value]');
        if (fill) fill.style.width = `${percent}%`;
        if (output) {
          output.hidden = !element.showValue;
          output.textContent = `${Math.round(percent)}%`;
        }
        break;
      }
      case 'inputPrompt': {
        const prompt = this.resolveActionPrompt(element.action.actionId, element.fallback);
        const label = element.label ? this.resolveText(element.label) : '';
        dom.setAttribute('role', 'group');
        const key = dom.querySelector<HTMLElement>('[data-ui-input-key]');
        const output = dom.querySelector<HTMLElement>('[data-ui-input-label]');
        if (key) key.textContent = prompt;
        if (output) {
          output.textContent = label;
          output.hidden = label.length === 0;
        }
        dom.setAttribute('aria-label', label ? `${prompt}: ${label}` : prompt);
        break;
      }
    }
  }

  private resolveScalar(binding: UIScalarBinding): UIScalar {
    if (binding.type === 'literal') return binding.value;
    return this.variables.get(binding.variableId) ?? binding.fallback ?? '';
  }

  private resolveText(binding: UITextBinding): string {
    if (binding.type === 'localization') {
      const parameters = Object.fromEntries(
        Object.entries(binding.parameters ?? {}).map(([name, value]) => [name, this.resolveScalar(value)]),
      );
      const request: UILocalizationRequest = {
        locale: this.locale,
        key: binding.key,
        fallback: binding.fallback,
        parameters,
      };
      let localized: string | undefined;
      if (this.localizeCallback) {
        try {
          localized = this.localizeCallback(request);
        } catch (error) {
          this.reportDiagnostic('LOCALIZATION_ERROR', errorMessage(error));
        }
      }
      localized ??= this.uiDocument.localization?.messages[this.locale]?.[binding.key];
      localized ??= this.uiDocument.localization?.messages[this.uiDocument.localization.defaultLocale]?.[binding.key];
      localized ??= binding.fallback ?? binding.key;
      return localized.replace(/\{([A-Za-z][A-Za-z0-9._:-]*)\}/g, (match, name: string) => (
        Object.hasOwn(parameters, name) ? String(parameters[name]) : match
      ));
    }
    const value = this.resolveScalar(binding);
    if (typeof value === 'number') return this.formatNumber(value, binding.type === 'variable' ? binding.numberFormat : undefined);
    return String(value);
  }

  private resolveNumber(binding: Extract<UIElement, { type: 'progress' }>['value']): number {
    const value = this.resolveScalar(binding);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private resolveBoolean(binding: NonNullable<UIElement['visible']>): boolean {
    return this.resolveScalar(binding) === true;
  }

  private formatNumber(value: number, format?: UINumberFormat): string {
    if (!format) return String(value);
    try {
      const style = format.style ?? 'decimal';
      const formatted = new Intl.NumberFormat(this.locale, {
        style: style === 'percent' ? 'percent' : 'decimal',
        minimumIntegerDigits: format.minimumIntegerDigits,
        maximumFractionDigits: style === 'integer' ? 0 : format.maximumFractionDigits,
      }).format(value);
      return `${format.prefix ?? ''}${formatted}${format.suffix ?? ''}`;
    } catch {
      return `${format.prefix ?? ''}${value}${format.suffix ?? ''}`;
    }
  }

  private resolveActionPrompt(actionId: string, fallback?: string): string {
    return this.actionPrompts.get(actionId) ?? fallback ?? actionId;
  }

  private resolveAssetSource(source: string, elementId: string): UIResolvedAsset {
    if (!this.resolveAssetUrlCallback) return { url: source };
    try {
      const resolved = this.resolveAssetUrlCallback(source, elementId);
      return typeof resolved === 'string' ? { url: resolved } : resolved;
    } catch (error) {
      this.reportDiagnostic('ASSET_RESOLUTION_ERROR', errorMessage(error), elementId);
      return { url: '' };
    }
  }

  private releaseAsset(elementId: string) {
    const cleanup = this.assetCleanups.get(elementId);
    if (!cleanup) return;
    this.assetCleanups.delete(elementId);
    try {
      cleanup();
    } catch (error) {
      this.reportDiagnostic('ASSET_RESOLUTION_ERROR', errorMessage(error), elementId);
    }
  }

  private releaseAllAssets() {
    [...this.assetCleanups.keys()].forEach((elementId) => this.releaseAsset(elementId));
  }

  private setAccessibleLabel(element: HTMLElement, label: string) {
    if (label) element.setAttribute('aria-label', label);
    else element.removeAttribute('aria-label');
  }

  private activateBindings(sourceElementId: string, bindings: UIActivationBinding[]) {
    if (this.disposed) return;
    for (const binding of bindings) {
      if (this.disposed) break;
      if (binding.type === 'event') {
        this.invokeCallback(
          () => this.eventCallback?.({
            eventId: binding.eventId,
            payload: binding.payload ? cloneJson(binding.payload) : undefined,
            sourceElementId,
          }),
          sourceElementId,
        );
      } else {
        this.invokeCallback(
          () => this.actionCallback?.({
            actionId: binding.actionId,
            phase: binding.phase ?? 'pressed',
            sourceElementId,
          }),
          sourceElementId,
        );
      }
    }
  }

  private invokeCallback(callback: () => void, elementId: string) {
    try {
      callback();
    } catch (error) {
      this.reportDiagnostic('CALLBACK_ERROR', errorMessage(error), elementId);
    }
  }

  private reportDiagnostic(code: UIDiagnostic['code'], message: string, elementId?: string) {
    try {
      this.diagnosticCallback?.({ code, message, elementId });
    } catch {
      // Diagnostics must not destabilize the game loop.
    }
  }

  private getResponsiveOverrides(element: UIElement, width: number): UIResponsiveOverride[] {
    const breakpoints = new Map(this.uiDocument.breakpoints?.map((breakpoint) => [breakpoint.id, breakpoint]) ?? []);
    return (element.responsive ?? []).filter((override) => {
      const breakpoint = breakpoints.get(override.breakpointId);
      if (!breakpoint) return false;
      return (breakpoint.minWidth === undefined || width >= breakpoint.minWidth)
        && (breakpoint.maxWidth === undefined || width <= breakpoint.maxWidth);
    });
  }

  private applyElementStyle(dom: HTMLElement, element: UIElement, width: number) {
    dom.style.cssText = '';
    let style: UIStyle = { ...(element.style ?? {}) };
    let layout = this.getBaseLayout(element);
    this.getResponsiveOverrides(element, width).forEach((override) => {
      if (override.style) style = { ...style, ...override.style };
      if (override.layout) layout = override.layout;
    });

    if (element.type === 'screen') {
      dom.style.position = 'relative';
      dom.style.width = '100%';
      dom.style.height = '100%';
    }
    if (element.type === 'image') (dom as HTMLImageElement).style.objectFit = element.fit ?? 'contain';
    this.applyStyleProperties(dom, style);
    if (layout) this.applyLayout(dom, layout);
  }

  private getBaseLayout(element: UIElement): UIContainerLayout | undefined {
    if (element.type === 'screen' || element.type === 'panel') return element.layout;
    if (element.type === 'stack') {
      return {
        type: 'flex',
        direction: element.direction,
        wrap: element.wrap,
        align: element.align,
        justify: element.justify,
        gap: element.gap,
      };
    }
    return undefined;
  }

  private applyStyleProperties(dom: HTMLElement, style: UIStyle) {
    const properties: Array<[keyof UIStyle, string]> = [
      ['width', 'width'],
      ['height', 'height'],
      ['minWidth', 'min-width'],
      ['minHeight', 'min-height'],
      ['maxWidth', 'max-width'],
      ['maxHeight', 'max-height'],
      ['gap', 'gap'],
      ['borderWidth', 'border-width'],
      ['borderRadius', 'border-radius'],
      ['fontSize', 'font-size'],
      ['letterSpacing', 'letter-spacing'],
    ];
    properties.forEach(([key, property]) => {
      const value = style[key];
      if (typeof value === 'string' || typeof value === 'number') dom.style.setProperty(property, cssLength(value as UILength));
    });
    this.applyBox(dom, 'padding', style.padding);
    this.applyBox(dom, 'margin', style.margin);
    if (style.color !== undefined) dom.style.color = style.color;
    if (style.background !== undefined) dom.style.background = style.background;
    if (style.borderColor !== undefined) dom.style.borderColor = style.borderColor;
    if (style.boxShadow !== undefined) dom.style.boxShadow = style.boxShadow;
    if (style.opacity !== undefined) dom.style.opacity = String(style.opacity);
    if (style.zIndex !== undefined) dom.style.zIndex = String(style.zIndex);
    if (style.overflow !== undefined) dom.style.overflow = style.overflow;
    if (style.pointerEvents !== undefined) dom.style.pointerEvents = style.pointerEvents;
    if (style.textAlign !== undefined) dom.style.textAlign = style.textAlign;
    if (style.fontFamily !== undefined) dom.style.fontFamily = style.fontFamily;
    if (style.fontWeight !== undefined) dom.style.fontWeight = String(style.fontWeight);
    if (style.fontVariantNumeric !== undefined) dom.style.fontVariantNumeric = style.fontVariantNumeric;
    if (style.lineHeight !== undefined) dom.style.lineHeight = typeof style.lineHeight === 'number' ? String(style.lineHeight) : cssLength(style.lineHeight);
    if (style.overflowWrap !== undefined) dom.style.overflowWrap = style.overflowWrap;
    if (style.whiteSpace !== undefined) dom.style.whiteSpace = style.whiteSpace;
    if (style.textTransform !== undefined) dom.style.textTransform = style.textTransform;
    if (style.alignSelf !== undefined) dom.style.alignSelf = style.alignSelf;
    if (style.justifySelf !== undefined) dom.style.justifySelf = style.justifySelf;
    if (style.anchor) this.applyAnchor(dom, style.anchor);
    if (style.safeArea) this.applySafeArea(dom, style.safeArea, style.padding);
  }

  private applyBox(dom: HTMLElement, property: 'padding' | 'margin', box?: UIBox) {
    if (box === undefined) return;
    if (typeof box === 'number' || typeof box === 'string') {
      dom.style.setProperty(property, cssLength(box));
      return;
    }
    (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
      const value = box[edge];
      if (value !== undefined) dom.style.setProperty(`${property}-${edge}`, cssLength(value));
    });
  }

  private applyAnchor(dom: HTMLElement, anchor: NonNullable<UIStyle['anchor']>) {
    dom.style.position = 'absolute';
    (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
      const value = anchor[edge];
      if (value !== undefined) dom.style.setProperty(edge, cssLength(value));
    });
    const transforms: string[] = [];
    if (anchor.centerX) {
      dom.style.left = '50%';
      transforms.push('translateX(-50%)');
    }
    if (anchor.centerY) {
      dom.style.top = '50%';
      transforms.push('translateY(-50%)');
    }
    if (transforms.length > 0) dom.style.transform = transforms.join(' ');
  }

  private applySafeArea(dom: HTMLElement, safeArea: NonNullable<UIStyle['safeArea']>, padding?: UIBox) {
    const edges: UISafeAreaEdges = typeof safeArea === 'boolean'
      ? { top: safeArea, right: safeArea, bottom: safeArea, left: safeArea }
      : safeArea;
    const paddingEdges = this.expandBox(padding);
    (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
      if (!edges[edge]) return;
      const base = paddingEdges[edge] === undefined ? '0px' : cssLength(paddingEdges[edge]!);
      dom.style.setProperty(`padding-${edge}`, `max(${base}, env(safe-area-inset-${edge}, 0px))`);
    });
  }

  private expandBox(box?: UIBox): Record<'top' | 'right' | 'bottom' | 'left', UILength | undefined> {
    if (box === undefined) return { top: undefined, right: undefined, bottom: undefined, left: undefined };
    if (typeof box === 'number' || typeof box === 'string') return { top: box, right: box, bottom: box, left: box };
    return { top: box.top, right: box.right, bottom: box.bottom, left: box.left };
  }

  private applyLayout(dom: HTMLElement, layout: UIContainerLayout) {
    dom.style.display = layout.type;
    if (layout.type === 'flex') {
      dom.style.flexDirection = layout.direction ?? 'row';
      dom.style.flexWrap = layout.wrap ?? 'nowrap';
      if (layout.align) dom.style.alignItems = layout.align;
      if (layout.justify) dom.style.justifyContent = layout.justify;
      if (layout.gap !== undefined) dom.style.gap = cssLength(layout.gap);
      return;
    }
    dom.style.gridTemplateColumns = typeof layout.columns === 'number'
      ? `repeat(${layout.columns}, minmax(0, 1fr))`
      : layout.columns.map(cssLength).join(' ');
    if (layout.rows) dom.style.gridTemplateRows = layout.rows.map(cssLength).join(' ');
    if (layout.align) dom.style.alignItems = layout.align;
    if (layout.justify) dom.style.justifyContent = layout.justify;
    if (layout.gap !== undefined) dom.style.gap = cssLength(layout.gap);
  }

  private getFocusableOrder(): string[] {
    const explicit = this.uiDocument.root.focusOrder ?? [];
    const ordered = [...explicit];
    this.elements.forEach((element, id) => {
      if (element instanceof this.ownerWindow.HTMLButtonElement && !ordered.includes(id)) ordered.push(id);
    });
    return ordered.filter((id) => {
      const element = this.elements.get(id);
      return element ? this.isFocusable(element) : false;
    });
  }

  private isFocusable(element: HTMLElement): boolean {
    if (!(element instanceof this.ownerWindow.HTMLButtonElement) || element.disabled) return false;
    let candidate: HTMLElement | null = element;
    while (candidate && candidate !== this.root) {
      if (candidate.hidden) return false;
      candidate = candidate.parentElement;
    }
    return this.root.contains(element);
  }

  private focusInitialElement() {
    const initialFocusId = this.uiDocument.root.initialFocusId;
    if (initialFocusId) this.focusElement(initialFocusId);
  }

  private findElementId(element: Element | null): string | undefined {
    if (!(element instanceof this.ownerWindow.HTMLElement)) return undefined;
    return element.dataset.uiId;
  }

  private readonly handleWindowResize = () => this.refreshLayout();

  private readonly handleRootKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof this.ownerWindow.HTMLButtonElement)) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusNext(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusNext(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const first = this.getFocusableOrder()[0];
      if (first) this.focusElement(first);
    } else if (event.key === 'End') {
      event.preventDefault();
      const order = this.getFocusableOrder();
      const last = order.at(-1);
      if (last) this.focusElement(last);
    }
  };
}

export const mountRuntimeUI = (options: RuntimeUIOptions): RuntimeUIController => (
  new DOMRuntimeUIController(options)
);
