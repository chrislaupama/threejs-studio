import { expect, test } from '@playwright/test';
import {
  AGENT_CAPABILITY_MANIFEST,
  AGENT_TOOL_DEFINITIONS,
  assessAgentToolCall,
  executeAgentTool,
  getAgentToolDefinition,
  validateAgentToolArguments,
} from '../src/editor/agentTools';
import { createStarterProject, loadProjectDocument } from '../src/editor/project';
import type { GameplayComponent, ModelAssetRecord, SceneNode } from '../src/editor/types';

const triangleAsset: ModelAssetRecord = {
  id: 'asset-triangle',
  kind: 'model',
  name: 'Triangle',
  sourceFilename: 'triangle.glb',
  mimeType: 'model/gltf-binary',
  byteLength: 996,
  revision: 1,
  importedAt: '2026-07-17T00:00:00.000Z',
  diagnostics: {
    meshes: 1,
    triangles: 1,
    materials: 1,
    textures: 0,
    animationNames: [],
    bounds: { min: [-0.5, 0, 0], max: [0.5, 1, 0], size: [1, 1, 0], center: [0, 0.5, 0] },
    warnings: [],
  },
};

test('agent capability manifest is stable, namespaced, and MCP-ready', () => {
  expect(AGENT_CAPABILITY_MANIFEST).toMatchObject({
    protocol: 'threejs-game-studio.authoring',
    protocolVersion: 1,
    projectSchemaVersion: 3,
  });
  expect(AGENT_CAPABILITY_MANIFEST.domains.map((domain) => domain.id)).toEqual(
    expect.arrayContaining([
      'scene',
      'materials',
      'gameplay',
      'world',
      'model-assets',
      'lights-cameras',
      'editor-context',
      'editor-selection',
      'viewport',
      'runtime',
      'history',
      'console',
      'project-io',
    ]),
  );
  expect(AGENT_TOOL_DEFINITIONS).toHaveLength(29);
  expect(new Set(AGENT_TOOL_DEFINITIONS.map((tool) => tool.name)).size).toBe(AGENT_TOOL_DEFINITIONS.length);
  for (const tool of AGENT_TOOL_DEFINITIONS) {
    expect(tool.name).toMatch(/^studio_/);
    expect(['project', 'editor']).toContain(tool.host);
    expect(tool.inputSchema).toMatchObject({ type: 'object' });
    expect(tool.risk).toMatchObject({
      level: expect.any(String),
      approval: expect.any(String),
      reversible: expect.any(Boolean),
    });
  }
  expect(getAgentToolDefinition('studio_delete_node')).toMatchObject({
    host: 'project',
    readOnly: false,
    risk: { level: 'destructive', approval: 'required' },
  });
  expect(getAgentToolDefinition('studio_reset_project')).toMatchObject({
    host: 'project',
    readOnly: false,
    risk: { level: 'destructive', approval: 'required', reversible: true },
  });
  const editorTools = AGENT_TOOL_DEFINITIONS.filter((tool) => tool.host === 'editor');
  expect(editorTools).toHaveLength(14);
  expect(editorTools.map((tool) => tool.name)).toEqual([
    'studio_get_editor_context',
    'studio_get_diagnostics',
    'studio_select_node',
    'studio_set_viewport',
    'studio_control_runtime',
    'studio_control_history',
    'studio_get_console',
    'studio_clear_console',
    'studio_set_editor_layout',
    'studio_save_project',
    'studio_export_project',
    'studio_build_project',
    'studio_request_project_import',
    'studio_request_model_import',
  ]);
  expect(getAgentToolDefinition('studio_request_project_import')).toMatchObject({
    host: 'editor',
    category: 'project-io',
    risk: { level: 'destructive', approval: 'required', reversible: false },
  });
});

test('registered schemas validate editor-host requests before live bridge execution', () => {
  expect(validateAgentToolArguments('studio_control_runtime', { action: 'play' })).toEqual([]);
  expect(validateAgentToolArguments('studio_set_viewport', { viewMode: 'scene', gridVisible: true })).toEqual([]);
  expect(validateAgentToolArguments('studio_get_diagnostics', { sections: ['renderer', 'assets'] })).toEqual([]);
  expect(validateAgentToolArguments('studio_export_project', { filename: 'my-game.tjsstudio.json' })).toEqual([]);

  expect(validateAgentToolArguments('studio_control_runtime', {})).toContain('arguments.action is required.');
  expect(validateAgentToolArguments('studio_control_runtime', { action: 'launch' })).toContain(
    'arguments.action must be one of: play, pause, resume, step, stop, preview, exit-preview.',
  );
  expect(validateAgentToolArguments('studio_control_runtime', { action: 'play', force: true })).toContain(
    'arguments.force is not supported.',
  );
  expect(validateAgentToolArguments('studio_set_viewport', {})).toContain('arguments must contain at least 1 properties.');
  expect(validateAgentToolArguments('studio_get_console', { limit: 121 })).toContain('arguments.limit must be at most 120.');
  expect(validateAgentToolArguments('studio_get_diagnostics', { sections: ['assets', 'assets'] })).toContain(
    'arguments.sections must not contain duplicate items.',
  );
  expect(validateAgentToolArguments('studio_get_diagnostics', { sections: ['network'] })).toContain(
    'arguments.sections[0] must be one of: editor, renderer, assets, history.',
  );
  expect(validateAgentToolArguments('studio_export_project', { filename: '../escape.json' })).toContain(
    'arguments.filename does not match the required format.',
  );
  expect(validateAgentToolArguments('studio_missing', {})).toContain('Unknown agent tool "studio_missing".');

  const project = createStarterProject();
  const bridgeOnly = executeAgentTool(project, 'studio_get_editor_context', {});
  expect(bridgeOnly).toMatchObject({
    ok: false,
    changed: false,
    label: 'Get editor context',
    errors: ['Editor-host tool "studio_get_editor_context" requires the live editor bridge and cannot run through executeAgentTool().'],
  });
  expect(bridgeOnly.nextProject).toEqual(project);

  const rejectedBeforeBridge = executeAgentTool(project, 'studio_control_runtime', { action: 'launch' });
  expect(rejectedBeforeBridge.errors).toContain('arguments.action must be one of: play, pause, resume, step, stop, preview, exit-preview.');
  expect(rejectedBeforeBridge.errors.some((error) => error.includes('live editor bridge'))).toBe(false);
});

test('inspection tools summarize, list, get, and search without mutating their input', () => {
  const project = createStarterProject();
  const before = JSON.stringify(project);

  const summary = executeAgentTool<{
    totals: { nodes: number; assets: number; components: number };
    byKind: Record<string, number>;
  }>(project, 'studio_get_project_summary');
  expect(summary.ok).toBe(true);
  expect(summary.changed).toBe(false);
  expect(summary.data?.totals).toEqual({ nodes: project.nodes.length, assets: 0, components: 3 });
  expect(summary.data?.byKind.mesh).toBeGreaterThan(0);

  const listed = executeAgentTool<{ nodes: Array<{ id: string }>; total: number }>(project, 'studio_list_nodes', {
    parentId: 'player-rig',
    recursive: true,
    kinds: ['mesh'],
  });
  expect(listed.ok).toBe(true);
  expect(listed.data?.nodes.map((node) => node.id)).toEqual(['player-core', 'player-ring']);

  const got = executeAgentTool<{ node: SceneNode; childIds: string[] }>(project, 'studio_get_node', { nodeId: 'player-rig' });
  expect(got.ok).toBe(true);
  expect(got.selectedId).toBe('player-rig');
  expect(got.data?.childIds).toEqual(['player-core', 'player-ring']);

  const searched = executeAgentTool<{ nodes: Array<{ id: string }>; total: number }>(project, 'studio_search_nodes', {
    query: 'player',
    componentType: 'float',
  });
  expect(searched.ok).toBe(true);
  expect(searched.data).toMatchObject({ nodes: [{ id: 'player-core' }], total: 1 });

  expect(JSON.stringify(project)).toBe(before);
  expect(summary.nextProject).not.toBe(project);
  expect(summary.nextProject).toEqual(project);
});

test('scene tools create, configure, duplicate, and delete complete hierarchies immutably', () => {
  const original = createStarterProject();
  const before = JSON.stringify(original);
  const groupResult = executeAgentTool<{ node: SceneNode }>(original, 'studio_create_group', {
    name: 'AI Encounter',
    parentId: null,
    transform: { position: [3, 0, -2] },
  });
  expect(groupResult.ok).toBe(true);
  expect(groupResult.changed).toBe(true);
  const groupId = groupResult.selectedId;
  expect(groupId).toBeTruthy();
  expect(groupResult.data?.node).toMatchObject({ name: 'AI Encounter', parentId: null });
  if (!groupId) throw new Error('Expected a group id.');

  const primitiveResult = executeAgentTool<{ node: SceneNode }>(groupResult.nextProject, 'studio_create_primitive', {
    primitive: 'sphere',
    parentId: groupId,
    name: 'Encounter Core',
    transform: { position: [0, 2, 0], scale: [1.5, 1.5, 1.5] },
    material: { color: '#112233', roughness: 0.2, metalness: 0.8, emissive: '#55ead7', emissiveIntensity: 0.5 },
    castShadow: false,
  });
  expect(primitiveResult.ok).toBe(true);
  const primitiveId = primitiveResult.selectedId;
  if (!primitiveId) throw new Error('Expected a primitive id.');
  expect(primitiveResult.data?.node).toMatchObject({
    name: 'Encounter Core',
    parentId: groupId,
    transform: { position: [0, 2, 0], scale: [1.5, 1.5, 1.5] },
    material: { color: '#112233', roughness: 0.2, metalness: 0.8 },
    castShadow: false,
  });

  const updated = executeAgentTool(primitiveResult.nextProject, 'studio_update_node', {
    nodeId: primitiveId,
    name: 'Encounter Beacon',
    visible: false,
    locked: true,
    transform: { rotation: [0, 1.5, 0] },
    material: { color: '#abcdef', roughness: 0.65 },
    receiveShadow: false,
  });
  expect(updated.ok).toBe(true);
  expect(updated.nextProject.nodes.find((node) => node.id === primitiveId)).toMatchObject({
    name: 'Encounter Beacon',
    visible: false,
    locked: true,
    transform: { rotation: [0, 1.5, 0] },
    material: { color: '#abcdef', roughness: 0.65 },
    receiveShadow: false,
  });

  const duplicate = executeAgentTool<{ nodeId: string }>(updated.nextProject, 'studio_duplicate_node', { nodeId: groupId });
  expect(duplicate.ok).toBe(true);
  expect(duplicate.nextProject.nodes).toHaveLength(updated.nextProject.nodes.length + 2);
  expect(duplicate.nextProject.nodes.find((node) => node.id === duplicate.selectedId)?.name).toBe('AI Encounter Copy');

  const deleted = executeAgentTool<{ deletedId: string; descendantCount: number }>(duplicate.nextProject, 'studio_delete_node', { nodeId: groupId });
  expect(deleted.ok).toBe(true);
  expect(deleted.data).toEqual({ deletedId: groupId, descendantCount: 1 });
  expect(deleted.nextProject.nodes.some((node) => node.id === groupId || node.id === primitiveId)).toBe(false);
  expect(deleted.nextProject.nodes.some((node) => node.id === duplicate.selectedId)).toBe(true);
  expect(loadProjectDocument(deleted.nextProject).ok).toBe(true);
  const reset = executeAgentTool(deleted.nextProject, 'studio_reset_project', {});
  expect(reset).toMatchObject({ ok: true, changed: true, selectedId: 'player-core' });
  expect(reset.nextProject.nodes).toHaveLength(13);
  expect(reset.nextProject.id).not.toBe(deleted.nextProject.id);
  expect(JSON.stringify(original)).toBe(before);
});

test('gameplay, world, and existing-model tools cover non-visual authoring domains', () => {
  const project = createStarterProject();
  const added = executeAgentTool<{ component: GameplayComponent }>(project, 'studio_add_component', {
    nodeId: 'platform',
    type: 'rotate',
    settings: { enabled: true, speed: -1.25, axis: 'z' },
  });
  expect(added.ok).toBe(true);
  expect(added.data?.component).toMatchObject({ type: 'rotate', speed: -1.25, axis: 'z' });
  const componentId = added.data?.component.id;
  if (!componentId) throw new Error('Expected a component id.');

  const changedComponent = executeAgentTool<{ component: GameplayComponent }>(added.nextProject, 'studio_update_component', {
    nodeId: 'platform',
    componentId,
    changes: { speed: 2, axis: 'x', enabled: false },
  });
  expect(changedComponent.ok).toBe(true);
  expect(changedComponent.data?.component).toMatchObject({ id: componentId, speed: 2, axis: 'x', enabled: false });

  const removed = executeAgentTool(changedComponent.nextProject, 'studio_remove_component', { nodeId: 'platform', componentId });
  expect(removed.ok).toBe(true);
  expect(removed.nextProject.nodes.find((node) => node.id === 'platform')?.components).toHaveLength(0);

  const world = executeAgentTool(removed.nextProject, 'studio_update_world_settings', {
    changes: {
      background: '#102030',
      fogEnabled: false,
      exposure: 1.5,
      gridSize: 64,
      gridDivisions: 32,
      shadows: false,
    },
  });
  expect(world.ok).toBe(true);
  expect(world.nextProject.settings).toMatchObject({
    background: '#102030',
    fogEnabled: false,
    exposure: 1.5,
    gridSize: 64,
    gridDivisions: 32,
    shadows: false,
  });

  const withAsset = structuredClone(world.nextProject);
  withAsset.assets.push(triangleAsset);
  const model = executeAgentTool<{ node: SceneNode }>(withAsset, 'studio_add_model_instance', {
    assetId: triangleAsset.id,
    name: 'AI Triangle',
    transform: { position: [4, 1, -3] },
    fitMode: 'original',
    targetSize: 5,
    receiveShadow: false,
  });
  expect(model.ok).toBe(true);
  expect(model.data?.node).toMatchObject({
    name: 'AI Triangle',
    kind: 'model',
    transform: { position: [4, 1, -3] },
    model: { assetId: triangleAsset.id, fitMode: 'original', targetSize: 5 },
    receiveShadow: false,
  });
  expect(withAsset.nodes.some((node) => node.kind === 'model')).toBe(false);
});

test('invalid calls are atomic and contextual risk metadata identifies approval boundaries', () => {
  const project = createStarterProject();
  const before = JSON.stringify(project);

  const malformedTransform = executeAgentTool(project, 'studio_update_node', {
    nodeId: 'platform',
    transform: { position: [1, 2] },
  });
  expect(malformedTransform.ok).toBe(false);
  expect(malformedTransform.changed).toBe(false);
  expect(malformedTransform.errors).toContain('arguments.transform.position must contain exactly three finite numbers.');

  const wrongDomain = executeAgentTool(project, 'studio_update_node', {
    nodeId: 'environment',
    material: { color: '#ffffff' },
  });
  expect(wrongDomain.ok).toBe(false);
  expect(wrongDomain.errors).toContain('arguments.material can only update mesh nodes.');

  const wrongComponentField = executeAgentTool(project, 'studio_add_component', {
    nodeId: 'platform',
    type: 'rotate',
    settings: { plane: 'xz' },
  });
  expect(wrongComponentField.ok).toBe(false);
  expect(wrongComponentField.errors).toContain('arguments.settings.plane is not supported.');

  const invalidFog = executeAgentTool(project, 'studio_update_world_settings', {
    changes: { fogNear: 90, fogFar: 20 },
  });
  expect(invalidFog.ok).toBe(false);
  expect(invalidFog.errors).toContain('Fog end distance must be greater than fog start distance.');

  const rootDelete = executeAgentTool(project, 'studio_delete_node', { nodeId: 'scene-root' });
  expect(rootDelete.ok).toBe(false);
  expect(rootDelete.errors).toContain('The scene root cannot be deleted.');

  const unknown = executeAgentTool(project, 'studio_make_everything_awesome', {});
  expect(unknown.ok).toBe(false);
  expect(unknown.errors[0]).toContain('Unknown agent tool');

  const noOp = executeAgentTool(project, 'studio_update_node', { nodeId: 'platform', name: 'Hero Platform' });
  expect(noOp).toMatchObject({ ok: true, changed: false, selectedId: 'platform' });
  expect(noOp.nextProject.updatedAt).toBe(project.updatedAt);

  expect(assessAgentToolCall(project, 'studio_get_node', { nodeId: 'scene-root' })).toMatchObject({
    requiresApproval: false,
    level: 'read',
  });
  expect(assessAgentToolCall(project, 'studio_update_node', { nodeId: 'scene-root', locked: false })).toMatchObject({
    requiresApproval: true,
    approval: 'required',
    reasons: expect.arrayContaining(['MainWorld is locked in the editor.', 'The call targets the scene root.']),
  });
  expect(assessAgentToolCall(project, 'studio_delete_node', { nodeId: 'player-rig' })).toMatchObject({
    requiresApproval: true,
    level: 'destructive',
  });
  expect(JSON.stringify(project)).toBe(before);
});
