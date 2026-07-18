import { expect, test } from '@playwright/test';
import {
  AGENT_GAME_CAPABILITY_MANIFEST,
  assessAgentGameToolCall,
  executeAgentGameTool,
} from '../src/editor/agentTools';
import { listProjectScripts, upsertProjectScript } from '../src/editor/gameAuthoring';
import { createCollectEscapeProject } from '../src/templates/collectEscape';

test('human and agent script paths produce the same v5 document and one-step inverse', () => {
  const project = createCollectEscapeProject();
  const script = listProjectScripts(project)[0]!;
  const input = {
    assetId: script.assetId,
    path: script.path,
    source: `${script.source}\n// parity`,
    timestamp: '2026-07-18T05:00:00.000Z',
  };
  const human = upsertProjectScript(project, input);
  if (!human.ok) throw new Error(human.errors.join(' '));
  const agent = executeAgentGameTool(project, 9, 'studio_upsert_script', { baseRevision: 9, ...input });
  expect(agent).toMatchObject({ ok: true, changed: true, revision: 10, project: human.project });
  expect(agent.history?.inverse).toEqual(project);
  expect(assessAgentGameToolCall('studio_upsert_script')).toMatchObject({ requiresApproval: true, reversible: true });
});

test('v5 game tools reject stale revisions and prepare builds without external effects', () => {
  const project = createCollectEscapeProject();
  expect(executeAgentGameTool(project, 4, 'studio_list_scripts', { baseRevision: 3 })).toMatchObject({
    ok: false, changed: false, revision: 4, errors: [{ code: 'revision-conflict' }],
  });
  const prepared = executeAgentGameTool<{ action: Record<string, unknown> }>(project, 4, 'studio_prepare_game_build', { baseRevision: 4 });
  expect(prepared).toMatchObject({ ok: true, changed: false, data: { action: { type: 'build.offline-zip', approval: 'required' } } });
  expect(AGENT_GAME_CAPABILITY_MANIFEST).toMatchObject({
    status: 'authoritative',
    projectSchemaVersion: 5,
    projectDocument: 'ProjectDocumentV5',
    projectDocumentRole: 'source-of-truth',
    legacyCompatibilityProtocol: 'threejs-studio.engine-authoring',
  });
  expect(AGENT_GAME_CAPABILITY_MANIFEST.tools.every((tool) => tool.availability.schemaVersion === 5)).toBe(true);
  expect(AGENT_GAME_CAPABILITY_MANIFEST.tools.find((tool) => tool.name === 'studio_prepare_game_build')).toMatchObject({
    effect: 'prepared-external-action',
    approval: 'none',
  });
  expect(assessAgentGameToolCall('studio_prepare_game_build')).toMatchObject({
    level: 'read',
    approval: 'none',
    reversible: true,
    requiresApproval: false,
  });
  expect(() => JSON.stringify(AGENT_GAME_CAPABILITY_MANIFEST)).not.toThrow();
});

test('Collect & Escape project replacement is explicit, validated, and undoable', () => {
  const project = createCollectEscapeProject();
  project.name = 'Temporary Project';
  const result = executeAgentGameTool(project, 2, 'studio_create_collect_escape', { baseRevision: 2 });
  expect(result).toMatchObject({ ok: true, changed: true, revision: 3, project: { name: 'Collect & Escape' } });
  expect(result.history?.inverse.name).toBe('Temporary Project');
  expect(assessAgentGameToolCall('studio_create_collect_escape').requiresApproval).toBe(true);
});
