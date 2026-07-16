import { expect, test, type Page } from '@playwright/test';

type StudioProjectSnapshot = {
  revision: number;
  project: {
    id: string;
    nodes: Array<{
      id: string;
      name: string;
      kind: string;
      transform: { position: [number, number, number] };
      material?: { color: string };
      components: Array<{ type: string }>;
    }>;
  };
};

type StudioCapabilityManifest = {
  protocol: string;
  protocolVersion: number;
  tools: Array<{ name: string; readOnly: boolean }>;
};

type StudioAgentBridge = {
  apiVersion: 1;
  manifest: () => StudioCapabilityManifest | Promise<StudioCapabilityManifest>;
  snapshot: () => StudioProjectSnapshot | Promise<StudioProjectSnapshot>;
  request: (request: {
    tool: string;
    arguments: Record<string, unknown>;
    baseRevision: number;
    requestId?: string;
  }) => unknown | Promise<unknown>;
  subscribe: (listener: (event: unknown) => void) => () => void;
};

async function openFresh(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('threejs-game-studio-assets');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.waitForFunction(() => (window as unknown as { __THREE_GAME_STUDIO_AGENT__?: StudioAgentBridge }).__THREE_GAME_STUDIO_AGENT__?.apiVersion === 1);
}

async function snapshot(page: Page): Promise<StudioProjectSnapshot> {
  return page.evaluate(async () => {
    const bridge = (window as unknown as { __THREE_GAME_STUDIO_AGENT__?: StudioAgentBridge }).__THREE_GAME_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    return await bridge.snapshot();
  });
}

async function openAssistant(page: Page) {
  const desktopToggle = page.getByTestId('assistant-toggle');
  const mobileToggle = page.getByTestId('assistant-mobile-trigger');
  if (await desktopToggle.isVisible()) await desktopToggle.click();
  else await mobileToggle.click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
}

test('Assistant proposal does not mutate until approval, applies atomically, and undoes in one step', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openFresh(page);
  const before = await snapshot(page);
  expect(before.project.nodes).toHaveLength(13);
  expect(before.project.nodes.some((node) => node.name === 'Enemy')).toBe(false);

  await openAssistant(page);
  await expect(page.getByTestId('assistant-panel')).toBeFocused();
  if (testInfo.project.name.includes('mobile')) {
    await expect(page.getByTestId('assistant-panel')).toHaveAttribute('aria-modal', 'true');
    await page.getByTestId('assistant-panel').press('Shift+Tab');
    await expect(page.getByTestId('assistant-input')).toBeFocused();
  }
  await page.getByTestId('assistant-input').fill('Add a coral box called Enemy beside Player Core and make it spin.');
  await page.getByTestId('assistant-send').click();

  const proposal = page.getByTestId('assistant-proposal');
  await expect(proposal).toBeVisible();
  await expect(page.getByTestId('assistant-tool-call')).toHaveCount(2);
  await expect(page.getByTestId('assistant-tool-call').nth(0)).toHaveAttribute('data-tool-name', 'studio_create_primitive');
  await expect(page.getByTestId('assistant-tool-call').nth(1)).toHaveAttribute('data-tool-name', 'studio_add_component');
  await expect(page.getByTestId('assistant-tool-call').nth(0).locator('.agent-call-values')).toContainText('Color: #f47f6b');
  await expect(page.getByTestId('assistant-tool-call').nth(0).locator('.agent-call-values')).toContainText('Transform Position: 2, 0.2, 0');

  const proposed = await snapshot(page);
  expect(proposed.revision).toBe(before.revision);
  expect(proposed.project.nodes).toEqual(before.project.nodes);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount)).toBe(13);

  await page.getByTestId('assistant-approve').click();
  await expect(proposal).toBeHidden();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount)).toBe(14);

  const applied = await snapshot(page);
  expect(applied.revision).toBeGreaterThan(before.revision);
  const enemy = applied.project.nodes.find((node) => node.name === 'Enemy');
  expect(enemy).toMatchObject({
    kind: 'mesh',
    transform: { position: [2, 0.2, 0] },
    material: { color: '#f47f6b' },
    components: [{ type: 'rotate' }],
  });

  // One Undo must remove both tool calls. If the calls entered history
  // separately, the object would remain after this first Undo.
  await page.getByTestId('assistant-undo').click();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount)).toBe(13);
  const undone = await snapshot(page);
  expect(undone.project.nodes.some((node) => node.name === 'Enemy')).toBe(false);
  expect(undone.revision).toBeGreaterThan(applied.revision);
  await page.getByRole('button', { name: 'Close Studio Assistant' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('assistant-panel')).toBeHidden();
  await expect(testInfo.project.name.includes('mobile') ? page.getByTestId('assistant-mobile-trigger') : page.getByTestId('assistant-toggle')).toBeFocused();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('prompt editing keeps native undo isolated from project history', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Keyboard history isolation only needs one browser pass.');
  await openFresh(page);
  await page.getByTestId('add-object').click();
  await page.getByTestId('create-box').click();
  const afterEdit = await snapshot(page);
  expect(afterEdit.project.nodes).toHaveLength(14);

  await openAssistant(page);
  const input = page.getByTestId('assistant-input');
  await input.fill('first draft');
  await input.press('Control+Z');

  const afterPromptUndo = await snapshot(page);
  expect(afterPromptUndo.revision).toBe(afterEdit.revision);
  expect(afterPromptUndo.project.nodes).toHaveLength(14);
});

test('Advanced review exposes validated arguments and elevates destructive approval', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Advanced approval semantics only need one browser pass.');
  await openFresh(page);
  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
  await openAssistant(page);
  await expect(page.getByTestId('assistant-context')).toContainText('MainWorld · Player Core');

  await page.getByTestId('assistant-input').fill('Delete the selected object');
  await page.getByTestId('assistant-send').click();

  const proposal = page.getByTestId('assistant-proposal');
  await expect(proposal).toHaveAttribute('data-risk', 'high-attention');
  await expect(page.getByTestId('assistant-approve')).toContainText('Apply destructive change');
  await proposal.getByText('Validated arguments').click();
  await expect(proposal.locator('pre')).toContainText('player-core');
  await page.getByTestId('assistant-dismiss').click();

  await page.getByTestId('assistant-input').fill('{"tool":"studio_update_node","arguments":{"nodeId":"main-camera","camera":{"fov":60}}}');
  await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-proposal')).toHaveAttribute('data-risk', 'high-attention');
  await expect(page.getByTestId('assistant-approve')).toContainText('Apply sensitive change');
  await expect(page.locator('.agent-call-review-note')).toContainText('framing or lighting');
  await page.getByTestId('assistant-dismiss').click();
});

test('browser bridge exposes manifest and snapshot while routing mutations through visible approval', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'The browser bridge contract only needs one browser pass.');
  await openFresh(page);

  const contract = await page.evaluate(async () => {
    const bridge = (window as unknown as { __THREE_GAME_STUDIO_AGENT__?: StudioAgentBridge }).__THREE_GAME_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    const unsubscribe = bridge.subscribe(() => undefined);
    const manifest = await bridge.manifest();
    const current = await bridge.snapshot();
    unsubscribe();
    return {
      apiVersion: bridge.apiVersion,
      manifest,
      current,
      methods: {
        manifest: typeof bridge.manifest,
        snapshot: typeof bridge.snapshot,
        request: typeof bridge.request,
        subscribe: typeof bridge.subscribe,
        unsubscribe: typeof unsubscribe,
      },
    };
  });

  expect(contract).toMatchObject({
    apiVersion: 1,
    methods: {
      manifest: 'function',
      snapshot: 'function',
      request: 'function',
      subscribe: 'function',
      unsubscribe: 'function',
    },
    manifest: {
      protocol: 'threejs-game-studio.authoring',
      protocolVersion: 1,
      tools: expect.arrayContaining([
        expect.objectContaining({ name: 'studio_get_project_summary', readOnly: true }),
        expect.objectContaining({ name: 'studio_create_primitive', readOnly: false }),
      ]),
    },
    current: {
      revision: expect.any(Number),
      project: { nodes: expect.any(Array) },
    },
  });

  const readResult = await page.evaluate(async ({ baseRevision }) => {
    const bridge = (window as unknown as { __THREE_GAME_STUDIO_AGENT__?: StudioAgentBridge }).__THREE_GAME_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    return bridge.request({
      tool: 'studio_get_project_summary',
      arguments: {},
      baseRevision,
      requestId: 'qa-read-summary',
    });
  }, { baseRevision: contract.current.revision });
  expect(readResult).toMatchObject({ status: 'completed', requestId: 'qa-read-summary' });
  await expect(page.getByTestId('assistant-proposal')).toHaveCount(0);

  const mutationResults = await page.evaluate(async ({ baseRevision }) => {
    const bridge = (window as unknown as { __THREE_GAME_STUDIO_AGENT__?: StudioAgentBridge }).__THREE_GAME_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    return Promise.all([
      bridge.request({
        tool: 'studio_create_primitive',
        arguments: { primitive: 'sphere', name: 'Bridge Probe', color: '#55ead7' },
        baseRevision,
        requestId: 'qa-propose-sphere',
      }),
      bridge.request({
        tool: 'studio_create_primitive',
        arguments: { primitive: 'box', name: 'Orphaned Probe', color: '#f47f6b' },
        baseRevision,
        requestId: 'qa-concurrent-box',
      }),
    ]);
  }, { baseRevision: contract.current.revision });
  const mutationResult = mutationResults[0];
  expect(mutationResult).toMatchObject({
    status: 'approval_required',
    requestId: 'qa-propose-sphere',
    proposalId: expect.any(String),
  });
  expect(mutationResults[1]).toMatchObject({
    status: 'rejected',
    requestId: 'qa-concurrent-box',
    errors: expect.arrayContaining([expect.stringContaining('Review or discard')]),
  });

  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  const proposal = page.getByTestId('assistant-proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal).toHaveAttribute('data-proposal-id', (mutationResult as { proposalId: string }).proposalId);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount)).toBe(13);

  // A human edit after planning makes the proposal stale. The Assistant must
  // preserve the human change and refuse to apply the old bridge plan.
  await page.getByTestId('add-object').click();
  await page.getByTestId('create-box').click();
  await expect(page.getByTestId('assistant-approve')).toBeDisabled();
  await expect(page.getByTestId('assistant-stale')).toBeVisible();

  await page.getByTestId('assistant-dismiss').click();
  await expect(proposal).toBeHidden();
  const afterDismiss = await snapshot(page);
  expect(afterDismiss.revision).toBeGreaterThan(contract.current.revision);
  expect(afterDismiss.project.nodes.some((node) => node.name === 'Bridge Probe')).toBe(false);
  expect(afterDismiss.project.nodes).toHaveLength(14);

  // A host action may remain async after Apply. Its proposal stays reserved,
  // Discard is disabled, and a new caller cannot orphan the in-flight review.
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.viewport-canvas-wrap');
    if (!viewport) throw new Error('Viewport wrapper is unavailable.');
    let resolveFullscreen: (() => void) | undefined;
    const pendingFullscreen = new Promise<void>((resolve) => { resolveFullscreen = resolve; });
    (window as unknown as { __resolveStudioFullscreen?: () => void }).__resolveStudioFullscreen = () => resolveFullscreen?.();
    Object.defineProperty(viewport, 'requestFullscreen', { configurable: true, value: () => pendingFullscreen });
  });
  const asyncHostResult = await page.evaluate(async ({ baseRevision }) => {
    const bridge = (window as unknown as { __THREE_GAME_STUDIO_AGENT__?: StudioAgentBridge }).__THREE_GAME_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    return bridge.request({ tool: 'studio_set_viewport', arguments: { fullscreen: true }, baseRevision, requestId: 'qa-async-fullscreen' });
  }, { baseRevision: afterDismiss.revision });
  expect(asyncHostResult).toMatchObject({ status: 'approval_required', requestId: 'qa-async-fullscreen' });
  await page.getByTestId('assistant-approve').click();
  await expect(page.getByTestId('assistant-dismiss')).toBeDisabled();
  const duringApplyResult = await page.evaluate(async ({ baseRevision }) => {
    const bridge = (window as unknown as { __THREE_GAME_STUDIO_AGENT__?: StudioAgentBridge }).__THREE_GAME_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    return bridge.request({ tool: 'studio_create_group', arguments: { name: 'Must Wait' }, baseRevision, requestId: 'qa-during-apply' });
  }, { baseRevision: afterDismiss.revision });
  expect(duringApplyResult).toMatchObject({
    status: 'rejected',
    requestId: 'qa-during-apply',
    errors: expect.arrayContaining([expect.stringContaining('Review or discard')]),
  });
  await page.evaluate(() => (window as unknown as { __resolveStudioFullscreen?: () => void }).__resolveStudioFullscreen?.());
  await expect(page.getByTestId('assistant-proposal')).toBeHidden();
});

test('browser bridge routes runtime lifecycle and full project reset through explicit approval', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Representative editor-host execution only needs one browser pass.');
  await openFresh(page);
  const before = await snapshot(page);

  const request = async (tool: string, argumentsValue: Record<string, unknown>, requestId: string) => page.evaluate(async ({ toolName, args, baseRevision, id }) => {
    const bridge = (window as unknown as { __THREE_GAME_STUDIO_AGENT__?: StudioAgentBridge }).__THREE_GAME_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    return bridge.request({ tool: toolName, arguments: args, baseRevision, requestId: id });
  }, { toolName: tool, args: argumentsValue, baseRevision: before.revision, id: requestId });

  expect(await request('studio_control_runtime', { action: 'play' }, 'qa-runtime-play')).toMatchObject({
    status: 'approval_required',
    requestId: 'qa-runtime-play',
  });
  await page.getByTestId('assistant-approve').click();
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-runtime', 'playing');
  expect((await snapshot(page)).revision).toBe(before.revision);

  expect(await request('studio_control_runtime', { action: 'stop' }, 'qa-runtime-stop')).toMatchObject({
    status: 'approval_required',
    requestId: 'qa-runtime-stop',
  });
  await page.getByTestId('assistant-approve').click();
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-runtime', 'edit');

  expect(await request('studio_reset_project', {}, 'qa-reset-project')).toMatchObject({
    status: 'approval_required',
    requestId: 'qa-reset-project',
  });
  await page.getByTestId('assistant-approve').click();
  const reset = await snapshot(page);
  expect(reset.revision).toBeGreaterThan(before.revision);
  expect(reset.project.nodes).toHaveLength(13);
  expect(reset.project.id).not.toBe(before.project.id);

  await page.keyboard.press('Control+Z');
  const restored = await snapshot(page);
  expect(restored.project.id).toBe(before.project.id);
  expect(restored.revision).toBeGreaterThan(reset.revision);
});
