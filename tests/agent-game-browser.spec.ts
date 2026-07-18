import { expect, test, type Page } from '@playwright/test';

interface V5ProjectSnapshot {
  revision: number;
  project: {
    schemaVersion: 5;
    id: string;
    name: string;
    startupSceneId: string;
    scenes: Array<{ id: string; name: string }>;
    entities: Array<{ id: string; name: string }>;
    assets: Array<{ id: string; kind: string; name: string }>;
    inputMaps: Array<{ id: string; actions: Array<{ id: string }> }>;
    ui: { documents: Array<{ id: string }> };
  };
}

async function openFresh(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await Promise.all(['threejs-studio-assets', 'threejs-game-studio-assets'].map((databaseName) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    })));
  });
  await page.reload();
  await page.waitForFunction(() => (window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.waitForFunction(() => window.__THREEJS_STUDIO_AGENT__?.apiVersion === 2);
}

async function snapshot(page: Page): Promise<V5ProjectSnapshot> {
  return page.evaluate(async () => {
    const bridge = window.__THREEJS_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    return await bridge.snapshot() as V5ProjectSnapshot;
  });
}

test('authoritative V5 game tool requires review, applies visibly, and restores the prior project in one Undo', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The V5 bridge approval contract needs one desktop browser pass.');
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openFresh(page);
  const before = await snapshot(page);
  expect(before.project).toMatchObject({ schemaVersion: 5 });
  expect(before.project.name).not.toBe('Collect & Escape');

  const proposalResult = await page.evaluate(async ({ baseRevision }) => {
    const bridge = window.__THREEJS_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    return bridge.request({
      tool: 'studio_create_collect_escape',
      arguments: {},
      baseRevision,
      requestId: 'qa-create-collect-escape-v5',
    });
  }, { baseRevision: before.revision });

  expect(proposalResult).toMatchObject({
    status: 'approval_required',
    requestId: 'qa-create-collect-escape-v5',
    proposalId: 'proposal-qa-create-collect-escape-v5',
    currentRevision: before.revision,
    tool: 'studio_create_collect_escape',
  });

  const proposal = page.getByTestId('assistant-proposal');
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await expect(proposal).toBeVisible();
  await expect(proposal).toHaveAttribute('data-proposal-id', 'proposal-qa-create-collect-escape-v5');
  await expect(proposal).toHaveAttribute('data-base-revision', String(before.revision));
  await expect(proposal).toHaveAttribute('data-risk', 'high-attention');
  await expect(proposal).toContainText('Create Collect & Escape game');
  await expect(page.getByTestId('assistant-tool-call')).toHaveAttribute('data-tool-name', 'studio_create_collect_escape');
  await expect(page.getByTestId('assistant-approve')).toContainText('Apply destructive change');

  const whileAwaitingApproval = await snapshot(page);
  expect(whileAwaitingApproval.revision).toBe(before.revision);
  expect(whileAwaitingApproval.project).toEqual(before.project);

  await page.getByTestId('assistant-approve').click();
  await expect(proposal).toBeHidden();
  await expect(page.getByTestId('game-authoring-workspace')).toBeVisible();

  const applied = await snapshot(page);
  expect(applied.revision).toBeGreaterThan(before.revision);
  expect(applied.project).toMatchObject({
    schemaVersion: 5,
    name: 'Collect & Escape',
    startupSceneId: 'scene.collect-escape',
  });
  expect(applied.project.scenes).toContainEqual(expect.objectContaining({ id: 'scene.collect-escape' }));
  expect(applied.project.entities).toContainEqual(expect.objectContaining({ id: 'entity.player' }));
  expect(applied.project.assets).toContainEqual(expect.objectContaining({ id: 'asset.script.collect-escape', kind: 'script' }));
  expect(applied.project.inputMaps.flatMap((map) => map.actions).map((action) => action.id)).toEqual(expect.arrayContaining([
    'move',
    'restart',
  ]));
  expect(applied.project.ui.documents).toContainEqual(expect.objectContaining({ id: 'ui.collect-escape.hud' }));

  // Reapplying the deterministic template is an approval-required no-op. It
  // must still complete through the V5 game-tool path without entering the
  // unrelated legacy editor executor or creating a history entry.
  const noOpProposalResult = await page.evaluate(async ({ baseRevision }) => {
    const bridge = window.__THREEJS_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    return bridge.request({
      tool: 'studio_create_collect_escape',
      arguments: {},
      baseRevision,
      requestId: 'qa-create-collect-escape-v5-no-op',
    });
  }, { baseRevision: applied.revision });
  expect(noOpProposalResult).toMatchObject({
    status: 'approval_required',
    requestId: 'qa-create-collect-escape-v5-no-op',
  });
  await page.getByTestId('assistant-approve').click();
  await expect(proposal).toBeHidden();
  await expect(page.getByTestId('assistant-panel')).toContainText('project was already up to date');
  const afterNoOp = await snapshot(page);
  expect(afterNoOp.revision).toBe(applied.revision);
  expect(afterNoOp.project).toEqual(applied.project);

  await expect(page.getByTestId('assistant-undo')).toBeVisible();
  await page.getByTestId('assistant-undo').click();
  const undone = await snapshot(page);
  expect(undone.revision).toBeGreaterThan(applied.revision);
  expect(undone.project).toEqual(before.project);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
