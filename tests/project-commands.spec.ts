import { expect, test } from '@playwright/test';
import {
  COMPONENT_DEFINITION_METADATA,
  COMPONENT_DEFINITIONS,
  getComponentDefinition,
  migrateRegisteredComponent,
  validateRegisteredComponent,
} from '../src/editor/componentRegistry';
import {
  PROJECT_COMMAND_PROTOCOL,
  PROJECT_COMMAND_PROTOCOL_VERSION,
  createInverseProjectCommandEnvelope,
  executeProjectCommandEnvelope,
  isProjectCommandEnvelope,
  type ProjectCommand,
  type ProjectCommandEnvelope,
} from '../src/editor/projectCommands';
import { createStarterProject } from '../src/editor/project';
import type { ProjectDocument } from '../src/editor/types';

function envelope(
  project: ProjectDocument,
  commands: ProjectCommand[],
  baseRevision = 4,
  id = 'command-envelope.test',
): ProjectCommandEnvelope {
  return {
    protocol: PROJECT_COMMAND_PROTOCOL,
    protocolVersion: PROJECT_COMMAND_PROTOCOL_VERSION,
    id,
    projectId: project.id,
    baseRevision,
    label: 'Project command test',
    commands,
  };
}

test('component registry publishes typed serializable metadata and current defaults', () => {
  expect(Object.keys(COMPONENT_DEFINITIONS)).toEqual(['rotate', 'float', 'keyboardMove']);
  expect(COMPONENT_DEFINITION_METADATA.map((definition) => definition.type)).toEqual([
    'rotate',
    'float',
    'keyboardMove',
  ]);
  expect(() => JSON.stringify(COMPONENT_DEFINITION_METADATA)).not.toThrow();

  const rotate = getComponentDefinition('rotate');
  expect(rotate).toMatchObject({
    version: 1,
    runtimeKey: 'motion.rotate.v1',
    allowMultiple: true,
    conflicts: [],
    editor: { essentialLabel: 'Spin', category: 'motion' },
    ai: { risk: 'low', approval: 'none' },
  });
  expect(rotate.create('component.rotate.test')).toEqual({
    id: 'component.rotate.test',
    type: 'rotate',
    enabled: true,
    speed: 0.8,
    axis: 'y',
  });
  expect(rotate.validate(rotate.create('component.rotate.test'))).toEqual([]);
});

test('component validators reject unknown fields and references while migrations normalize legacy values', () => {
  const project = createStarterProject();
  expect(validateRegisteredComponent({
    id: 'component.move.test',
    type: 'keyboardMove',
    enabled: true,
    speed: 3,
    plane: 'xz',
    actionId: 'missing.action',
    editorOnlyValue: true,
  }, { project })).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'missing-reference', path: 'actionId' }),
    expect.objectContaining({ code: 'invalid-field', path: 'editorOnlyValue' }),
  ]));

  const migrated = migrateRegisteredComponent('float', {
    enabled: true,
    speed: 1.5,
    amplitude: 0.75,
    axis: 'z',
  }, 0, { componentId: 'component.float.migrated' });
  expect(migrated).toEqual({
    ok: true,
    component: {
      id: 'component.float.migrated',
      type: 'float',
      enabled: true,
      speed: 1.5,
      distance: 0.75,
      axis: 'z',
      phase: 0,
    },
    warnings: ['Migrated float component metadata from definition v0 to v1.'],
  });

  expect(migrateRegisteredComponent('rotate', {}, 2, { componentId: 'component.future' })).toEqual({
    ok: false,
    errors: [expect.objectContaining({ code: 'unsupported-version' })],
  });
});

test('atomic command batches commit once with patch metadata and an executable inverse snapshot', () => {
  const original = createStarterProject();
  const request = envelope(original, [
    {
      id: 'create-crate',
      type: 'node.createPrimitive',
      primitive: 'box',
      nodeId: 'game.crate',
      color: '#123456',
    },
    {
      id: 'float-crate',
      type: 'component.add',
      nodeId: 'game.crate',
      componentType: 'float',
      componentId: 'game.crate.float',
      values: { speed: 2, distance: 0.5, axis: 'z', phase: 0.25 },
    },
    {
      id: 'change-world',
      type: 'world.updateSettings',
      changes: { background: '#223344', exposure: 1.25 },
    },
  ]);

  expect(isProjectCommandEnvelope(request)).toBe(true);
  const parsedRequest: unknown = JSON.parse(JSON.stringify(request));
  const result = executeProjectCommandEnvelope(original, 4, parsedRequest);

  expect(result).toMatchObject({
    ok: true,
    envelopeId: request.id,
    baseRevision: 4,
    revision: 5,
    changed: true,
    errors: [],
  });
  expect(result.project.nodes.find((node) => node.id === 'game.crate')).toMatchObject({
    kind: 'mesh',
    primitive: 'box',
    material: { color: '#123456' },
    components: [{
      id: 'game.crate.float',
      type: 'float',
      enabled: true,
      speed: 2,
      distance: 0.5,
      axis: 'z',
      phase: 0.25,
    }],
  });
  expect(result.project.settings).toMatchObject({ background: '#223344', exposure: 1.25 });
  expect(result.applied).toHaveLength(3);
  expect(result.patch).toMatchObject({
    format: 'json-pointer-v1',
    truncated: false,
    affected: {
      nodeIds: ['game.crate'],
      componentIds: ['game.crate.float'],
      worldSettings: true,
    },
  });
  expect(result.patch?.changedPaths.length).toBeGreaterThan(0);
  expect(result.inverse).toMatchObject({
    kind: 'project-document-snapshot',
    targetProjectId: original.id,
    expectedBaseRevision: 5,
    snapshotRevision: 4,
    document: original,
  });
  expect(() => JSON.stringify(result)).not.toThrow();

  const inverseEnvelope = createInverseProjectCommandEnvelope(result.inverse!, 'command-envelope.undo');
  const undone = executeProjectCommandEnvelope(result.project, result.revision, inverseEnvelope);
  expect(undone).toMatchObject({ ok: true, changed: true, baseRevision: 5, revision: 6 });
  expect(undone.project).toEqual(original);
});

test('optimistic revision conflicts return stable errors without changing the project', () => {
  const project = createStarterProject();
  const request = envelope(project, [{
    id: 'stale-world-change',
    type: 'world.updateSettings',
    changes: { background: '#334455' },
  }], 3);
  const result = executeProjectCommandEnvelope(project, 4, request);

  expect(result).toMatchObject({
    ok: false,
    changed: false,
    revision: 4,
    project,
    applied: [],
    errors: [{
      code: 'revision-conflict',
      expectedRevision: 3,
      actualRevision: 4,
    }],
    patch: null,
    inverse: null,
  });
});

test('a failing later command discards every earlier mutation in the batch', () => {
  const project = createStarterProject();
  const request = envelope(project, [
    {
      id: 'temporary-node',
      type: 'node.createPrimitive',
      primitive: 'sphere',
      nodeId: 'temporary.node',
    },
    {
      id: 'delete-root',
      type: 'node.delete',
      nodeId: 'scene-root',
    },
  ]);
  const result = executeProjectCommandEnvelope(project, 4, request);

  expect(result).toMatchObject({
    ok: false,
    changed: false,
    revision: 4,
    project,
    applied: [],
    errors: [{
      code: 'conflict',
      commandIndex: 1,
      commandId: 'delete-root',
    }],
  });
  expect(result.project.nodes.some((node) => node.id === 'temporary.node')).toBe(false);
});

test('component reference validation and strict command schemas fail atomically', () => {
  const project = createStarterProject();
  const missingAction = envelope(project, [{
    id: 'invalid-move',
    type: 'component.add',
    nodeId: 'player-core',
    componentType: 'keyboardMove',
    componentId: 'component.invalid-move',
    values: { actionId: 'missing.action' },
  }]);
  const missingActionResult = executeProjectCommandEnvelope(project, 4, missingAction);
  expect(missingActionResult).toMatchObject({
    ok: false,
    changed: false,
    errors: [{ code: 'validation-failed', commandId: 'invalid-move' }],
  });
  expect(missingActionResult.errors[0]?.details).toContain('actionId: Input Action "missing.action" does not exist.');

  const untypedRequest = {
    ...envelope(project, [{
      id: 'strict-world',
      type: 'world.updateSettings',
      changes: { background: '#334455' },
    }]),
    commands: [{
      id: 'strict-world',
      type: 'world.updateSettings',
      changes: { background: '#334455' },
      callback: 'not permitted',
    }],
  };
  const strictResult = executeProjectCommandEnvelope(project, 4, untypedRequest);
  expect(strictResult).toMatchObject({
    ok: false,
    changed: false,
    errors: [{ code: 'invalid-command', commandId: 'strict-world' }],
  });
  expect(strictResult.errors[0]?.path).toBe('/commands/0/callback');
});

test('duplicate command ids are rejected before execution', () => {
  const project = createStarterProject();
  const request = envelope(project, [
    { id: 'same-command', type: 'world.updateSettings', changes: { exposure: 1.1 } },
    { id: 'same-command', type: 'world.updateSettings', changes: { exposure: 1.2 } },
  ]);
  const result = executeProjectCommandEnvelope(project, 4, request);
  expect(result).toMatchObject({
    ok: false,
    changed: false,
    applied: [],
    errors: [{ code: 'duplicate-command-id', commandIndex: 1, commandId: 'same-command' }],
  });
});
