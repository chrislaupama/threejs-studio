import { expect, test } from '@playwright/test';
import { createCollectEscapeProject } from '../src/templates/collectEscape';
import { deleteProjectScript, listProjectScripts, upsertProjectScript } from '../src/editor/gameAuthoring';
import { validateProjectDocumentV5 } from '../src/editor/projectV5';

test('script authoring operations are validated, serializable, and atomic', () => {
  const original = createCollectEscapeProject();
  const existing = listProjectScripts(original)[0]!;
  const updated = upsertProjectScript(original, {
    assetId: existing.assetId,
    path: existing.path,
    source: `${existing.source}\n// edited`,
    timestamp: '2026-07-18T01:00:00.000Z',
  });
  expect(updated.ok).toBe(true);
  if (!updated.ok) return;
  expect(listProjectScripts(updated.project)[0]).toMatchObject({ revision: existing.revision + 1, source: expect.stringContaining('// edited') });
  expect(listProjectScripts(original)[0]!.source).not.toContain('// edited');
  expect(validateProjectDocumentV5(updated.project).ok).toBe(true);
  expect(() => JSON.stringify(updated)).not.toThrow();

  const rejected = upsertProjectScript(updated.project, {
    assetId: existing.assetId,
    path: 'https://example.com/escape.ts',
    source: 'export default {}',
    timestamp: '2026-07-18T01:01:00.000Z',
  });
  expect(rejected).toMatchObject({ ok: false, changed: false, project: updated.project });
});

test('script creation and deletion retain the source catalog contract', () => {
  const original = createCollectEscapeProject();
  const created = upsertProjectScript(original, {
    assetId: 'asset.script.enemy',
    path: 'scripts/enemy.ts',
    source: 'export default {}',
    timestamp: '2026-07-18T02:00:00.000Z',
  });
  if (!created.ok) throw new Error(created.errors.join(' '));
  expect(listProjectScripts(created.project).map((script) => script.path)).toContain('scripts/enemy.ts');
  const removed = deleteProjectScript(created.project, 'asset.script.enemy', '2026-07-18T02:01:00.000Z');
  expect(removed.ok).toBe(true);
  if (removed.ok) expect(listProjectScripts(removed.project).map((script) => script.path)).not.toContain('scripts/enemy.ts');
});
