import { expect, test } from '@playwright/test';
import {
  AGENT_ENGINE_CAPABILITY_MANIFEST,
  AGENT_ENGINE_TOOL_DEFINITIONS,
  AGENT_TOOL_DEFINITIONS,
  assessAgentEngineToolCall,
  executeAgentEngineTool,
  getAgentEngineToolDefinition,
  validateAgentEngineToolArguments,
  type AgentBuildActionDescriptor,
} from '../src/editor/agentTools';
import {
  PROJECT_COMMAND_PROTOCOL,
  PROJECT_COMMAND_PROTOCOL_VERSION,
  createInverseProjectCommandEnvelope,
  type ProjectCommandEnvelope,
  type ProjectCommandResult,
} from '../src/editor/projectCommands';
import { validateProjectDocumentV5 } from '../src/editor/projectV5';
import { createStarterProject } from '../src/editor/project';
import type { BuildProfileV5, ProjectDocumentV5 } from '../src/editor/types';

test('additive engine capability manifest preserves the stable v1 adapter and declares complete tool contracts', () => {
  expect(AGENT_TOOL_DEFINITIONS).toHaveLength(32);
  expect(AGENT_ENGINE_CAPABILITY_MANIFEST).toMatchObject({
    protocol: 'threejs-studio.engine-authoring',
    protocolVersion: 1,
    status: 'legacy-compatibility',
    sourceProjectSchemaVersion: 4,
    projectionSchemaVersion: 5,
    authoritativeProjectSchemaVersion: 5,
    supersededByProtocol: 'threejs-studio.game-authoring',
  });
  expect(AGENT_ENGINE_CAPABILITY_MANIFEST.guarantees.join(' ')).toContain(
    'ProjectDocumentV5 is the mounted editor source of truth',
  );
  expect(AGENT_ENGINE_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
    'studio_execute_project_commands',
    'studio_validate_v5_projection',
    'studio_get_v5_projection',
    'studio_list_build_profiles',
    'studio_prepare_build',
  ]);
  expect(new Set(AGENT_ENGINE_TOOL_DEFINITIONS.map((tool) => tool.name)).size).toBe(5);
  for (const tool of AGENT_ENGINE_TOOL_DEFINITIONS) {
    expect(tool).toMatchObject({
      description: expect.any(String),
      scopes: expect.any(Array),
      risk: {
        level: expect.any(String),
        approval: expect.any(String),
        reversible: expect.any(Boolean),
      },
      effect: {
        project: expect.stringMatching(/^(read|write)$/),
        history: expect.stringMatching(/^(none|single-commit)$/),
        external: expect.any(String),
      },
      availability: {
        host: 'project',
        sourceProjectSchemaVersions: [4],
        projectionSchemaVersion: 5,
        requirements: expect.any(Array),
        notes: expect.any(String),
      },
      inputSchema: { type: 'object' },
    });
    expect(tool.description.length).toBeGreaterThan(20);
    expect(tool.scopes.length).toBeGreaterThan(0);
  }
  expect(() => JSON.stringify(AGENT_ENGINE_CAPABILITY_MANIFEST)).not.toThrow();
  expect(getAgentEngineToolDefinition('studio_prepare_build')).toMatchObject({
    readOnly: true,
    effect: { external: 'prepared-build-request' },
  });
});

test('engine tool schemas require optimistic revisions and reject unsupported fields', () => {
  expect(validateAgentEngineToolArguments('studio_validate_v5_projection', { baseRevision: 7 })).toEqual([]);
  expect(validateAgentEngineToolArguments('studio_validate_v5_projection', {})).toContain(
    'arguments.baseRevision is required.',
  );
  expect(validateAgentEngineToolArguments('studio_prepare_build', {
    baseRevision: 7,
    profileId: 'build.web-production',
  })).toEqual([]);
  expect(validateAgentEngineToolArguments('studio_prepare_build', {
    baseRevision: 7,
    profileId: 'build.web-production',
    force: true,
  })).toContain('arguments.force is not supported.');
  expect(validateAgentEngineToolArguments('studio_engine_missing', {})).toEqual([
    'Unknown engine authoring tool "studio_engine_missing".',
  ]);
});

test('legacy schema-v4 projection reads validate a clone without claiming that v4 is authoritative', () => {
  const project = createStarterProject();
  const before = JSON.stringify(project);
  const readiness = executeAgentEngineTool<{
    valid: boolean;
    sourceSchemaVersion: number;
    projectionSchemaVersion: number;
    totals: { scenes: number; entities: number; buildProfiles: number };
    diagnostics: unknown[];
  }>(project, 11, 'studio_validate_v5_projection', { baseRevision: 11 });

  expect(readiness).toMatchObject({
    ok: true,
    changed: false,
    baseRevision: 11,
    revision: 11,
    errors: [],
    data: {
      valid: true,
      sourceSchemaVersion: 4,
      projectionSchemaVersion: 5,
      totals: { scenes: 1, entities: project.nodes.length, buildProfiles: 1 },
      diagnostics: [],
    },
  });

  const snapshot = executeAgentEngineTool<{ project: ProjectDocumentV5 }>(
    project,
    11,
    'studio_get_v5_projection',
    { baseRevision: 11 },
  );
  expect(snapshot.ok).toBe(true);
  expect(snapshot.data?.project).toMatchObject({
    schemaVersion: 5,
    id: project.id,
    startupSceneId: 'scene-main',
    defaultBuildProfileId: 'build.web-production',
  });
  expect(validateProjectDocumentV5(snapshot.data?.project)).toMatchObject({ ok: true });
  expect(JSON.stringify(project)).toBe(before);
  expect(snapshot.project).toEqual(project);
  expect(snapshot.project).not.toBe(project);
  expect(AGENT_ENGINE_TOOL_DEFINITIONS.find((tool) => tool.name === 'studio_get_v5_projection')?.availability.notes)
    .toContain('Authoritative schema-v5 mutations');
});

test('all engine reads reject stale revisions with structured stable errors', () => {
  const project = createStarterProject();
  for (const toolName of [
    'studio_validate_v5_projection',
    'studio_get_v5_projection',
    'studio_list_build_profiles',
    'studio_prepare_build',
  ] as const) {
    const result = executeAgentEngineTool(project, 9, toolName, { baseRevision: 8 });
    expect(result).toMatchObject({
      ok: false,
      changed: false,
      baseRevision: 9,
      revision: 9,
      errors: [{
        code: 'revision-conflict',
        expectedRevision: 8,
        actualRevision: 9,
      }],
      project,
    });
  }
});

test('build profile tools expose serializable configuration and prepare approval-gated editor actions', () => {
  const project = createStarterProject();
  const listed = executeAgentEngineTool<{
    defaultBuildProfileId: string;
    profiles: BuildProfileV5[];
  }>(project, 3, 'studio_list_build_profiles', { baseRevision: 3 });
  expect(listed).toMatchObject({
    ok: true,
    changed: false,
    data: {
      defaultBuildProfileId: 'build.web-production',
      profiles: [{
        id: 'build.web-production',
        target: 'web',
        mode: 'production',
        startupSceneId: 'scene-main',
      }],
    },
  });

  const prepared = executeAgentEngineTool<{ action: AgentBuildActionDescriptor }>(
    project,
    3,
    'studio_prepare_build',
    { baseRevision: 3 },
  );
  expect(prepared).toMatchObject({
    ok: true,
    changed: false,
    data: {
      action: {
        action: 'build-project-profile',
        projectId: project.id,
        projectRevision: 3,
        projectSchemaVersion: 5,
        profile: { id: 'build.web-production' },
        execution: {
          host: 'editor',
          approval: 'required',
          scope: 'project.build',
          createsExternalArtifact: true,
        },
      },
    },
  });
  expect(() => JSON.stringify(prepared.data)).not.toThrow();

  const missing = executeAgentEngineTool(project, 3, 'studio_prepare_build', {
    baseRevision: 3,
    profileId: 'build.missing',
  });
  expect(missing).toMatchObject({
    ok: false,
    changed: false,
    errors: [{ code: 'not-found', path: 'arguments.profileId' }],
    project,
  });
});

test('project command capability commits atomically and returns one executable history inverse', () => {
  const project = createStarterProject();
  const before = JSON.stringify(project);
  const envelope: ProjectCommandEnvelope = {
    protocol: PROJECT_COMMAND_PROTOCOL,
    protocolVersion: PROJECT_COMMAND_PROTOCOL_VERSION,
    id: 'agent-v5.transaction',
    projectId: project.id,
    baseRevision: 7,
    label: 'Create AI-authored checkpoint',
    commands: [
      {
        id: 'agent-v5.create-checkpoint',
        type: 'node.createPrimitive',
        primitive: 'cylinder',
        nodeId: 'game.checkpoint',
        color: '#44ccaa',
      },
      {
        id: 'agent-v5.float-checkpoint',
        type: 'component.add',
        nodeId: 'game.checkpoint',
        componentType: 'float',
        componentId: 'game.checkpoint.float',
        values: { speed: 1.5, distance: 0.4, axis: 'y', phase: 0 },
      },
    ],
  };

  const applied = executeAgentEngineTool<ProjectCommandResult>(
    project,
    7,
    'studio_execute_project_commands',
    { envelope },
  );
  expect(applied).toMatchObject({
    ok: true,
    changed: true,
    baseRevision: 7,
    revision: 8,
    errors: [],
    history: {
      strategy: 'commit-project-command-result',
      label: envelope.label,
      patch: { format: 'json-pointer-v1' },
      inverse: {
        kind: 'project-document-snapshot',
        expectedBaseRevision: 8,
        snapshotRevision: 7,
      },
    },
  });
  expect(applied.project.nodes.find((node) => node.id === 'game.checkpoint')).toMatchObject({
    kind: 'mesh',
    primitive: 'cylinder',
    components: [{ id: 'game.checkpoint.float', type: 'float' }],
  });
  expect(JSON.stringify(project)).toBe(before);

  const undoEnvelope = createInverseProjectCommandEnvelope(applied.history!.inverse, 'agent-v5.undo');
  const undone = executeAgentEngineTool<ProjectCommandResult>(
    applied.project,
    applied.revision,
    'studio_execute_project_commands',
    { envelope: undoEnvelope },
  );
  expect(undone).toMatchObject({ ok: true, changed: true, baseRevision: 8, revision: 9 });
  expect(undone.project).toEqual(project);
});

test('command failures are stable, atomic, and assessed for sensitive approval', () => {
  const project = createStarterProject();
  const envelope: ProjectCommandEnvelope = {
    protocol: PROJECT_COMMAND_PROTOCOL,
    protocolVersion: PROJECT_COMMAND_PROTOCOL_VERSION,
    id: 'agent-v5.atomic-failure',
    projectId: project.id,
    baseRevision: 4,
    label: 'Unsafe mixed transaction',
    commands: [
      {
        id: 'agent-v5.temporary',
        type: 'node.createPrimitive',
        primitive: 'box',
        nodeId: 'temporary.agent-node',
      },
      { id: 'agent-v5.delete-root', type: 'node.delete', nodeId: 'scene-root' },
    ],
  };
  const assessment = assessAgentEngineToolCall(project, 'studio_execute_project_commands', { envelope });
  expect(assessment).toMatchObject({
    level: 'destructive',
    approval: 'required',
    requiresApproval: true,
  });
  expect(assessment.reasons).toContain('The transaction deletes a scene hierarchy subtree.');

  const failed = executeAgentEngineTool(project, 4, 'studio_execute_project_commands', { envelope });
  expect(failed).toMatchObject({
    ok: false,
    changed: false,
    revision: 4,
    errors: [{ code: 'conflict', commandId: 'agent-v5.delete-root', commandIndex: 1 }],
    project,
  });
  expect(failed.project.nodes.some((node) => node.id === 'temporary.agent-node')).toBe(false);

  const stale = executeAgentEngineTool(project, 5, 'studio_execute_project_commands', { envelope });
  expect(stale).toMatchObject({
    ok: false,
    changed: false,
    revision: 5,
    errors: [{ code: 'revision-conflict', expectedRevision: 4, actualRevision: 5 }],
    project,
  });
});
