import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  validateUIDocument,
  type RuntimeUIController,
  type UIActionDispatch,
  type UIDiagnostic,
  type UIDocument,
  type UIEventDispatch,
  type UIElement,
  type UIJsonObject,
} from '../src/runtime-ui';

interface RuntimeUIHarness {
  controller: RuntimeUIController;
  events: UIEventDispatch[];
  actions: UIActionDispatch[];
  diagnostics: UIDiagnostic[];
  assets: { resolved: number; released: number };
  detachedButton?: HTMLButtonElement;
}

declare global {
  interface Window {
    __RUNTIME_UI_TEST__?: RuntimeUIHarness;
  }
}

const literal = <T extends string | number | boolean>(value: T) => ({ type: 'literal' as const, value });
const variable = <T extends string | number | boolean>(variableId: string, fallback?: T) => ({
  type: 'variable' as const,
  variableId,
  fallback,
});

const findElement = (element: UIElement, id: string): UIElement | undefined => {
  if (element.id === id) return element;
  if (element.type !== 'screen' && element.type !== 'stack' && element.type !== 'panel') return undefined;
  for (const child of element.children) {
    const match = findElement(child, id);
    if (match) return match;
  }
  return undefined;
};

const createRuntimeUIDocument = (): UIDocument => ({
  schemaVersion: 1,
  id: 'collect-escape.hud',
  variables: [
    { id: 'game.score', type: 'number', initialValue: 7 },
    { id: 'game.progress', type: 'number', initialValue: 25 },
    { id: 'game.restartDisabled', type: 'boolean', initialValue: false },
    { id: 'player.name', type: 'string', initialValue: '<img src=x onerror="window.__unsafe=1">' },
  ],
  breakpoints: [
    { id: 'mobile', maxWidth: 600 },
    { id: 'desktop', minWidth: 601 },
  ],
  localization: {
    defaultLocale: 'en',
    messages: {
      en: {
        'hud.label': 'Mission HUD',
        'hud.objective': 'Collect {count} energy orbs',
        'hud.collect': 'Collect orb',
      },
      'mi-NZ': {
        'hud.label': 'Whāinga',
        'hud.objective': 'Kohia ngā poi pūngao e {count}',
        'hud.collect': 'Kohia te poi',
      },
    },
  },
  root: {
    id: 'hud.screen',
    type: 'screen',
    label: { type: 'localization', key: 'hud.label' },
    layout: { type: 'flex', direction: 'row', align: 'start', gap: 12 },
    style: {
      safeArea: true,
      padding: 12,
      background: '#111827',
    },
    responsive: [{
      breakpointId: 'mobile',
      style: { background: '#18181b' },
      layout: { type: 'flex', direction: 'column', align: 'stretch', gap: 8 },
    }],
    focusOrder: ['hud.collect', 'hud.restart'],
    initialFocusId: 'hud.collect',
    children: [
      {
        id: 'hud.objective',
        type: 'text',
        element: 'h1',
        live: 'polite',
        value: {
          type: 'localization',
          key: 'hud.objective',
          parameters: { count: variable('game.score', 0) },
        },
        style: { fontSize: 24, margin: 0 },
      },
      {
        id: 'hud.safeText',
        type: 'text',
        value: variable('player.name', 'Player'),
      },
      {
        id: 'hud.orb',
        type: 'image',
        source: literal('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="16"%3E%3Ccircle cx="8" cy="8" r="6" fill="teal"/%3E%3C/svg%3E'),
        alt: literal('Energy orb'),
        fit: 'contain',
        style: { width: 32, height: 32 },
      },
      {
        id: 'hud.progress',
        type: 'progress',
        label: literal('Energy collected'),
        value: variable('game.progress', 0),
        minimum: 0,
        maximum: 100,
        showValue: false,
        style: { width: 180 },
      },
      {
        id: 'hud.controls',
        type: 'panel',
        role: 'region',
        label: literal('Mission controls'),
        layout: { type: 'grid', columns: 2, gap: 8 },
        style: {
          anchor: { top: 16, right: 16 },
          padding: 8,
          background: '#27272a',
        },
        children: [
          {
            id: 'hud.collect',
            type: 'button',
            label: { type: 'localization', key: 'hud.collect' },
            activations: [
              { type: 'event', eventId: 'game.collect', payload: { amount: 1 } },
              { type: 'action', actionId: 'player.interact' },
            ],
          },
          {
            id: 'hud.restart',
            type: 'button',
            label: literal('Restart'),
            disabled: variable('game.restartDisabled', false),
            activations: [{ type: 'event', eventId: 'game.restart' }],
          },
          {
            id: 'hud.prompt',
            type: 'inputPrompt',
            action: { type: 'action', actionId: 'player.interact' },
            fallback: 'E',
            label: literal('Interact'),
          },
        ],
      },
    ],
  },
});

const mountFixture = async (page: Page, uiDocument = createRuntimeUIDocument()) => {
  await page.goto('/');
  await page.evaluate(async (fixtureJson) => {
    const fixture = JSON.parse(fixtureJson) as UIDocument;
    document.body.replaceChildren();
    document.documentElement.style.width = '100%';
    document.documentElement.style.height = '100%';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
    document.body.style.margin = '0';
    const host = document.createElement('main');
    host.id = 'runtime-ui-host';
    host.style.position = 'relative';
    host.style.width = '100%';
    host.style.height = '100%';
    document.body.append(host);

    const moduleUrl = '/src/runtime-ui/index.ts';
    const runtimeUI = await import(moduleUrl) as typeof import('../src/runtime-ui');
    const events: UIEventDispatch[] = [];
    const actions: UIActionDispatch[] = [];
    const diagnostics: UIDiagnostic[] = [];
    const assets = { resolved: 0, released: 0 };
    const controller = runtimeUI.mountRuntimeUI({
      target: host,
      document: fixture,
      actionPrompts: { 'player.interact': 'E' },
      onEvent: (event) => events.push(event),
      onAction: (action) => actions.push(action),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      resolveAssetUrl: (source) => {
        assets.resolved += 1;
        return {
          url: source,
          dispose: () => { assets.released += 1; },
        };
      },
    });
    window.__RUNTIME_UI_TEST__ = { controller, events, actions, diagnostics, assets };
  }, JSON.stringify(uiDocument));
};

test('UIDocument is JSON-round-trippable and rejects invalid references atomically', () => {
  const uiDocument = createRuntimeUIDocument();
  const result = validateUIDocument(uiDocument);
  expect(result).toEqual({ ok: true, document: uiDocument });

  const roundTrip = JSON.parse(JSON.stringify(uiDocument)) as unknown;
  expect(validateUIDocument(roundTrip).ok).toBe(true);

  const invalid = structuredClone(uiDocument) as unknown as {
    root: { focusOrder: string[]; children: Array<Record<string, unknown>> };
  };
  invalid.root.focusOrder.push('hud.missing');
  invalid.root.children.push({
    id: 'hud.objective',
    type: 'text',
    value: { type: 'variable', variableId: 'missing.variable' },
    style: { background: 'url(https://unexpected.example/image.png)' },
  });
  const invalidResult = validateUIDocument(invalid);
  expect(invalidResult.ok).toBe(false);
  if (!invalidResult.ok) {
    expect(invalidResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DUPLICATE_ID', path: 'root.children[5].id' }),
      expect.objectContaining({ code: 'MISSING_REFERENCE', path: 'root.children[5].value.variableId' }),
      expect.objectContaining({ code: 'INVALID_VALUE', path: 'root.children[5].style.background' }),
      expect.objectContaining({ code: 'MISSING_REFERENCE', path: 'root.focusOrder[2]' }),
    ]));
  }
});

test('validation bounds sparse arrays, deep payloads, and default-locale gaps', () => {
  const sparse = createRuntimeUIDocument();
  sparse.root.children = Array(1) as UIElement[];
  const sparseResult = validateUIDocument(sparse);
  expect(sparseResult.ok).toBe(false);
  if (!sparseResult.ok) {
    expect(sparseResult.issues).toContainEqual(expect.objectContaining({
      code: 'NOT_SERIALIZABLE',
      path: '$.root.children[0]',
    }));
  }

  const deep = createRuntimeUIDocument();
  const collect = findElement(deep.root, 'hud.collect');
  if (!collect || collect.type !== 'button') throw new Error('Missing collect button fixture.');
  let payload: UIJsonObject = { final: true };
  for (let depth = 0; depth < 140; depth += 1) payload = { next: payload };
  collect.activations = [{ type: 'event', eventId: 'game.deep', payload }];
  let deepResult: ReturnType<typeof validateUIDocument> | undefined;
  expect(() => { deepResult = validateUIDocument(deep); }).not.toThrow();
  expect(deepResult?.ok).toBe(false);
  if (deepResult && !deepResult.ok) {
    expect(deepResult.issues.some((issue) => issue.code === 'LIMIT_EXCEEDED')).toBe(true);
  }

  const asymmetric = createRuntimeUIDocument();
  delete asymmetric.localization!.messages.en!['hud.collect'];
  const asymmetricResult = validateUIDocument(asymmetric);
  expect(asymmetricResult.ok).toBe(false);
  if (!asymmetricResult.ok) {
    expect(asymmetricResult.issues).toContainEqual(expect.objectContaining({
      code: 'MISSING_REFERENCE',
      path: 'root.children[4].children[0].label.key',
    }));
  }
});

test('mount and hot reload preserve gameplay focus without explicit initial focus', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (fixtureJson) => {
    document.body.replaceChildren();
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    canvas.tabIndex = 0;
    const host = document.createElement('main');
    host.style.position = 'relative';
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.append(canvas, host);
    canvas.focus();

    const moduleUrl = '/src/runtime-ui/index.ts';
    const runtimeUI = await import(moduleUrl) as typeof import('../src/runtime-ui');
    const uiDocument = JSON.parse(fixtureJson) as UIDocument;
    delete uiDocument.root.initialFocusId;
    const controller = runtimeUI.mountRuntimeUI({ target: host, document: uiDocument });
    const canvasFocusedAfterMount = document.activeElement === canvas;

    const updated = controller.getDocument();
    updated.root.style = { ...updated.root.style, background: '#101114' };
    const updateResult = controller.updateDocument(updated);
    const canvasFocusedAfterUpdate = document.activeElement === canvas;
    const explicitFocusWorked = controller.focusNext();
    const focusedElementId = (document.activeElement as HTMLElement | null)?.dataset.uiId;
    controller.dispose();

    return {
      canvasFocusedAfterMount,
      canvasFocusedAfterUpdate,
      updateOk: updateResult.ok,
      explicitFocusWorked,
      focusedElementId,
    };
  }, JSON.stringify(createRuntimeUIDocument()));

  expect(result).toEqual({
    canvasFocusedAfterMount: true,
    canvasFocusedAfterUpdate: true,
    updateOk: true,
    explicitFocusWorked: true,
    focusedElementId: 'hud.collect',
  });
});

test('renders accessible bound UI and updates variables, locale, prompts, and breakpoints', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await mountFixture(page);

  await expect(page.getByRole('region', { name: 'Mission HUD' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Collect 7 energy orbs' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Energy orb' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Energy collected' })).toHaveAttribute('aria-valuenow', '25');
  await expect(page.getByText('<img src=x onerror="window.__unsafe=1">', { exact: true })).toBeVisible();
  expect(await page.locator('img').count()).toBe(1);

  const updates = await page.evaluate(() => {
    const controller = window.__RUNTIME_UI_TEST__!.controller;
    return {
      invalid: controller.setVariables({ 'game.score': 9, 'game.progress': 'wrong' }),
      valuesAfterInvalid: [controller.getVariable('game.score'), controller.getVariable('game.progress')],
      valid: controller.setVariables({
        'game.score': 42,
        'game.progress': 75,
        'player.name': 'Aroha',
      }),
    };
  });
  expect(updates.invalid).toMatchObject({ ok: false, code: 'TYPE_MISMATCH' });
  expect(updates.valuesAfterInvalid).toEqual([7, 25]);
  expect(updates.valid).toEqual({ ok: true });
  await expect(page.getByRole('heading', { name: 'Collect 42 energy orbs' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Energy collected' })).toHaveAttribute('aria-valuenow', '75');
  await expect(page.locator('[data-ui-progress-fill]')).toHaveAttribute('style', /width: 75%/);
  await expect(page.getByText('Aroha', { exact: true })).toBeVisible();

  await page.evaluate(() => {
    const controller = window.__RUNTIME_UI_TEST__!.controller;
    controller.setLocale('mi-NZ');
    controller.setActionPrompt('player.interact', 'X');
    controller.refreshLayout(500);
  });
  await expect(page.getByRole('region', { name: 'Whāinga' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Kohia ngā poi pūngao e 42' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'X: Interact' })).toBeVisible();

  const mobileStyles = await page.evaluate(() => {
    const controller = window.__RUNTIME_UI_TEST__!.controller;
    const screen = controller.getElement('hud.screen')!;
    const panel = controller.getElement('hud.controls')!;
    const image = controller.getElement('hud.orb')!;
    return {
      direction: screen.style.flexDirection,
      background: screen.style.background,
      safeTop: screen.style.paddingTop,
      panelDisplay: panel.style.display,
      panelColumns: panel.style.gridTemplateColumns,
      panelPosition: panel.style.position,
      panelTop: panel.style.top,
      panelRight: panel.style.right,
      imageFit: image.style.objectFit,
    };
  });
  expect(mobileStyles).toMatchObject({
    direction: 'column',
    background: 'rgb(24, 24, 27)',
    panelDisplay: 'grid',
    panelColumns: 'repeat(2, minmax(0px, 1fr))',
    panelPosition: 'absolute',
    panelTop: '16px',
    panelRight: '16px',
    imageFit: 'contain',
  });
  expect(mobileStyles.safeTop).toContain('env(safe-area-inset-top');

  await page.evaluate(() => window.__RUNTIME_UI_TEST__!.controller.refreshLayout(900));
  expect(await page.evaluate(() => window.__RUNTIME_UI_TEST__!.controller.getElement('hud.screen')!.style.flexDirection)).toBe('row');

  const accessibility = await new AxeBuilder({ page }).include('[data-runtime-ui-root]').analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([]);
  expect(await page.evaluate(() => window.__RUNTIME_UI_TEST__!.diagnostics)).toEqual([]);
  expect(await page.evaluate(() => window.__RUNTIME_UI_TEST__!.assets)).toEqual({ resolved: 1, released: 0 });
  expect(errors).toEqual([]);
});

test('uses native keyboard activation, explicit game focus order, and cleans up completely', async ({ page }) => {
  await mountFixture(page);
  const collect = page.getByRole('button', { name: 'Collect orb' });
  const restart = page.getByRole('button', { name: 'Restart' });

  await expect(collect).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(restart).toBeFocused();
  await page.keyboard.press('Home');
  await expect(collect).toBeFocused();
  await page.keyboard.press('End');
  await expect(restart).toBeFocused();
  await page.keyboard.press('Enter');

  await collect.focus();
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__RUNTIME_UI_TEST__!.events)).toEqual([
    { eventId: 'game.restart', sourceElementId: 'hud.restart' },
    { eventId: 'game.collect', payload: { amount: 1 }, sourceElementId: 'hud.collect' },
  ]);
  expect(await page.evaluate(() => window.__RUNTIME_UI_TEST__!.actions)).toEqual([
    { actionId: 'player.interact', phase: 'pressed', sourceElementId: 'hud.collect' },
  ]);

  await restart.focus();
  await page.evaluate(() => window.__RUNTIME_UI_TEST__!.controller.setVariable('game.restartDisabled', true));
  await expect(restart).toBeDisabled();
  await expect(collect).toBeFocused();

  const focusResult = await page.evaluate(() => {
    const harness = window.__RUNTIME_UI_TEST__!;
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    canvas.tabIndex = 0;
    document.body.prepend(canvas);
    canvas.focus();
    const nextDocument = harness.controller.getDocument();
    nextDocument.root.style = { ...nextDocument.root.style, background: '#101114' };
    const update = harness.controller.updateDocument(nextDocument);
    return { updateOk: update.ok, canvasStillFocused: document.activeElement === canvas };
  });
  expect(focusResult.updateOk).toBe(true);
  expect(focusResult.canvasStillFocused).toBe(true);

  const invalidUpdate = await page.evaluate(() => {
    const harness = window.__RUNTIME_UI_TEST__!;
    const invalid = harness.controller.getDocument() as unknown as { root: { focusOrder: string[] } };
    invalid.root.focusOrder = ['missing.button'];
    return harness.controller.updateDocument(invalid as unknown as UIDocument);
  });
  expect(invalidUpdate.ok).toBe(false);
  await expect(collect).toHaveText('Collect orb');

  const sparseUpdate = await page.evaluate(() => {
    const harness = window.__RUNTIME_UI_TEST__!;
    const invalid = harness.controller.getDocument();
    invalid.root.children = Array(1) as UIElement[];
    return harness.controller.updateDocument(invalid).ok;
  });
  expect(sparseUpdate).toBe(false);

  const disposeResult = await page.evaluate(() => {
    const harness = window.__RUNTIME_UI_TEST__!;
    harness.detachedButton = harness.controller.getElement('hud.collect') as HTMLButtonElement;
    const before = harness.events.length;
    harness.controller.dispose();
    harness.detachedButton.click();
    harness.controller.dispose();
    return {
      roots: document.querySelectorAll('[data-runtime-ui-root]').length,
      eventCountBefore: before,
      eventCountAfter: harness.events.length,
      assets: harness.assets,
      update: harness.controller.setVariable('game.score', 100),
    };
  });
  expect(disposeResult).toEqual({
    roots: 0,
    eventCountBefore: 2,
    eventCountAfter: 2,
    assets: { resolved: 2, released: 2 },
    update: { ok: false, code: 'DISPOSED', message: 'Runtime UI controller is disposed.' },
  });
});

test('stops a multi-binding activation when its first callback disposes the controller', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (fixtureJson) => {
    document.body.replaceChildren();
    const host = document.createElement('main');
    host.style.position = 'relative';
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.append(host);
    const moduleUrl = '/src/runtime-ui/index.ts';
    const runtimeUI = await import(moduleUrl) as typeof import('../src/runtime-ui');
    const uiDocument = JSON.parse(fixtureJson) as UIDocument;
    const sequence: string[] = [];
    let controller: RuntimeUIController;
    controller = runtimeUI.mountRuntimeUI({
      target: host,
      document: uiDocument,
      onEvent: () => {
        sequence.push('event');
        controller.dispose();
      },
      onAction: () => sequence.push('action'),
    });
    controller.getElement('hud.collect')!.click();
    return {
      sequence,
      roots: document.querySelectorAll('[data-runtime-ui-root]').length,
    };
  }, JSON.stringify(createRuntimeUIDocument()));
  expect(result).toEqual({ sequence: ['event'], roots: 0 });
});
