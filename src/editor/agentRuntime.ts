import {
  assessAgentToolCall,
  executeAgentTool,
  getAgentToolDefinition,
  type AgentToolName,
  type AgentToolResult,
} from './agentTools';
import { getNode } from './project';
import type { GameplayComponent, PrimitiveType, ProjectDocument, SceneNode, Vec3 } from './types';

export interface StudioAgentToolCall {
  name: AgentToolName;
  arguments: Record<string, unknown>;
}

export interface GuidedAgentPlan {
  ok: boolean;
  kind: 'read' | 'proposal' | 'unsupported';
  title: string;
  description: string;
  calls: StudioAgentToolCall[];
  errors: string[];
}

export interface StudioAgentBatchResult {
  ok: boolean;
  nextProject: ProjectDocument;
  selectedId: string | null;
  changed: boolean;
  messages: string[];
  errors: string[];
  resolvedCalls: StudioAgentToolCall[];
  results: AgentToolResult[];
}

export interface StudioAgentProvider {
  id: string;
  name: string;
  kind: 'guided' | 'model' | 'mcp';
  plan(request: { project: ProjectDocument; selectedId: string | null; prompt: string }): Promise<GuidedAgentPlan>;
}

const primitives: PrimitiveType[] = ['box', 'sphere', 'capsule', 'cylinder', 'cone', 'plane', 'torus'];
const componentWords: Array<{ pattern: RegExp; type: GameplayComponent['type'] }> = [
  { pattern: /\b(spin|rotate|rotation)\b/i, type: 'rotate' },
  { pattern: /\b(float|hover|bob)\b/i, type: 'float' },
  { pattern: /\b(wasd|keyboard|player movement|move with)\b/i, type: 'keyboardMove' },
];
const namedColors: Record<string, string> = {
  coral: '#f47f6b',
  red: '#f47f6b',
  cyan: '#55ead7',
  teal: '#55ead7',
  violet: '#9b87f5',
  purple: '#9b87f5',
  blue: '#4f8cff',
  green: '#69dfad',
  yellow: '#f2bd67',
  gold: '#f2bd67',
  graphite: '#202a36',
  white: '#f2f6f6',
  black: '#111823',
};

function unsupported(message: string): GuidedAgentPlan {
  return { ok: false, kind: 'unsupported', title: 'I need a more specific request', description: message, calls: [], errors: [message] };
}

function readColor(prompt: string) {
  const hex = prompt.match(/#[0-9a-f]{6}\b/i)?.[0];
  if (hex) return hex.toLowerCase();
  return Object.entries(namedColors).find(([name]) => new RegExp(`\\b${name}\\b`, 'i').test(prompt))?.[1];
}

function readVec3(prompt: string): Vec3 | undefined {
  const match = prompt.match(/(?:\bto\b|\bat\b|position(?:ed)?\s*(?:to|at)?)\s*\(?\s*x?\s*(-?\d+(?:\.\d+)?)\s*[, ]+\s*y?\s*(-?\d+(?:\.\d+)?)\s*[, ]+\s*z?\s*(-?\d+(?:\.\d+)?)\s*\)?/i);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function selectedNode(project: ProjectDocument, selectedId: string | null): SceneNode | undefined {
  return getNode(project, selectedId);
}

function findNamedNode(project: ProjectDocument, name: string): SceneNode | undefined {
  const normalized = name.trim().replace(/[.!?]+$/, '').toLowerCase();
  return project.nodes.find((node) => node.name.toLowerCase() === normalized)
    ?? project.nodes.find((node) => node.name.toLowerCase().includes(normalized));
}

function parseJsonCalls(prompt: string): StudioAgentToolCall[] | null {
  if (!prompt.trim().startsWith('{') && !prompt.trim().startsWith('[')) return null;
  try {
    const parsed = JSON.parse(prompt) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && 'calls' in parsed && Array.isArray((parsed as { calls?: unknown }).calls)
        ? (parsed as { calls: unknown[] }).calls
        : [parsed];
    const calls: StudioAgentToolCall[] = [];
    for (const value of values) {
      if (!value || typeof value !== 'object') return null;
      const record = value as Record<string, unknown>;
      const name = record.tool ?? record.name;
      const args = record.arguments ?? record.args ?? {};
      if (typeof name !== 'string' || !getAgentToolDefinition(name) || !args || typeof args !== 'object' || Array.isArray(args)) return null;
      calls.push({ name: name as AgentToolName, arguments: args as Record<string, unknown> });
    }
    return calls;
  } catch {
    return null;
  }
}

function createPlan(project: ProjectDocument, prompt: string): GuidedAgentPlan | null {
  const primitive = primitives.find((value) => new RegExp(`\\b${value}\\b`, 'i').test(prompt));
  if (!primitive || !/\b(add|create|place|make)\b/i.test(prompt)) return null;
  const color = readColor(prompt);
  const name = prompt.match(/\b(?:called|named)\s+["']?(.+?)["']?(?=\s+(?:beside|next to|at|and|with)\b|[.!?]*$)/i)?.[1]?.trim();
  const besideName = prompt.match(/\b(?:beside|next to)\s+["']?(.+?)["']?(?=\s+and\b|[.!?]*$)/i)?.[1]?.trim();
  const beside = besideName ? findNamedNode(project, besideName) : undefined;
  const requestedPosition = readVec3(prompt);
  const position: Vec3 | undefined = requestedPosition ?? (beside
    ? [beside.transform.position[0] + 2, beside.transform.position[1], beside.transform.position[2]]
    : undefined);
  const calls: StudioAgentToolCall[] = [{
    name: 'studio_create_primitive',
    arguments: {
      primitive,
      ...(name ? { name } : {}),
      ...(color ? { color } : {}),
      ...(position ? { transform: { position } } : {}),
    },
  }];
  const requestedComponent = componentWords.find(({ pattern }) => pattern.test(prompt))?.type;
  if (requestedComponent) calls.push({ name: 'studio_add_component', arguments: { nodeId: '@last', type: requestedComponent } });
  const title = `Create ${name ?? `${color ? 'styled ' : ''}${primitive}`}`;
  const details = [color ? `use ${color}` : '', position ? `place at ${position.join(', ')}` : '', requestedComponent ? `add ${requestedComponent}` : ''].filter(Boolean);
  return {
    ok: true,
    kind: 'proposal',
    title,
    description: `${calls.length} validated, reversible change${calls.length === 1 ? '' : 's'} will be committed as one Undo step${details.length ? `: ${details.join('; ')}` : ''}.`,
    calls,
    errors: [],
  };
}

export function planGuidedAgentPrompt(project: ProjectDocument, selectedId: string | null, prompt: string): GuidedAgentPlan {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) return unsupported('Describe a scene, world, or gameplay change first.');

  const jsonCalls = parseJsonCalls(cleanPrompt);
  if (jsonCalls) {
    const readOnly = jsonCalls.every((call) => getAgentToolDefinition(call.name)?.readOnly);
    return {
      ok: true,
      kind: readOnly ? 'read' : 'proposal',
      title: readOnly ? 'Inspect project' : 'Apply structured tool plan',
      description: `${jsonCalls.length} typed tool call${jsonCalls.length === 1 ? '' : 's'} parsed from JSON.`,
      calls: jsonCalls,
      errors: [],
    };
  }

  if (/\b(summarize|summary|explain (?:my |the )?scene|what is in)\b/i.test(cleanPrompt)) {
    return { ok: true, kind: 'read', title: 'Summarize project', description: 'Read project, scene, asset, and gameplay totals.', calls: [{ name: 'studio_get_project_summary', arguments: {} }], errors: [] };
  }
  if (/\b(list|show|find)\b.*\b(objects?|nodes?|scene)\b/i.test(cleanPrompt)) {
    return { ok: true, kind: 'read', title: 'List scene objects', description: 'Read compact scene hierarchy information.', calls: [{ name: 'studio_list_nodes', arguments: {} }], errors: [] };
  }
  if (/\b(reset|new|fresh)\b.*\b(project|starter|scene)\b/i.test(cleanPrompt)) {
    return { ok: true, kind: 'proposal', title: 'Create a new starter project', description: 'Replace the complete open project with the starter scene as one reversible editor transaction.', calls: [{ name: 'studio_reset_project', arguments: {} }], errors: [] };
  }

  const creation = createPlan(project, cleanPrompt);
  if (creation) return creation;

  const selected = selectedNode(project, selectedId);
  const targetName = cleanPrompt.match(/\b(?:object|node)\s+["']?(.+?)["']?(?=\s+(?:to|at|and|with)\b|[.!?]*$)/i)?.[1];
  const target = targetName ? findNamedNode(project, targetName) : selected;

  if (/\b(move|position)\b/i.test(cleanPrompt)) {
    const position = readVec3(cleanPrompt);
    if (!target) return unsupported('Select an object or name the object you want to move.');
    if (!position) return unsupported('Give the new position as three numbers, for example “Move selected to 0, 2, 0”.');
    return { ok: true, kind: 'proposal', title: `Move ${target.name}`, description: `Set the position to ${position.join(', ')} as one undoable edit.`, calls: [{ name: 'studio_update_node', arguments: { nodeId: target.id, transform: { position } } }], errors: [] };
  }

  if (/\b(rename|call)\b/i.test(cleanPrompt)) {
    const name = cleanPrompt.match(/\b(?:to|as)\s+["']?(.+?)["']?[.!?]*$/i)?.[1]?.trim();
    if (!target) return unsupported('Select an object before renaming it.');
    if (!name) return unsupported('Tell me the new name, for example “Rename selected to Enemy”.');
    return { ok: true, kind: 'proposal', title: `Rename ${target.name}`, description: `Rename the selected object to ${name}.`, calls: [{ name: 'studio_update_node', arguments: { nodeId: target.id, name } }], errors: [] };
  }

  const component = componentWords.find(({ pattern }) => pattern.test(cleanPrompt))?.type;
  if (component && /\b(add|make|give)\b/i.test(cleanPrompt)) {
    if (!target) return unsupported('Select an object before adding gameplay behavior.');
    return { ok: true, kind: 'proposal', title: `Add ${component} to ${target.name}`, description: 'Add one gameplay component using safe defaults.', calls: [{ name: 'studio_add_component', arguments: { nodeId: target.id, type: component } }], errors: [] };
  }

  const color = readColor(cleanPrompt);
  if (/\b(background|world color)\b/i.test(cleanPrompt) && color) {
    return { ok: true, kind: 'proposal', title: 'Change world background', description: `Set the world background to ${color}.`, calls: [{ name: 'studio_update_world_settings', arguments: { changes: { background: color } } }], errors: [] };
  }

  if (color && /\b(color|colour|material|make)\b/i.test(cleanPrompt)) {
    if (!target) return unsupported('Select a primitive mesh before changing its material.');
    if (target.kind !== 'mesh') return unsupported(`${target.name} does not have an editable primitive material.`);
    return { ok: true, kind: 'proposal', title: `Recolor ${target.name}`, description: `Set its material color to ${color}.`, calls: [{ name: 'studio_update_node', arguments: { nodeId: target.id, material: { color } } }], errors: [] };
  }

  if (/\b(duplicate|copy)\b/i.test(cleanPrompt)) {
    if (!target) return unsupported('Select an object before duplicating it.');
    return { ok: true, kind: 'proposal', title: `Duplicate ${target.name}`, description: 'Create one undoable copy with fresh stable IDs.', calls: [{ name: 'studio_duplicate_node', arguments: { nodeId: target.id } }], errors: [] };
  }

  if (/\b(delete|remove)\b/i.test(cleanPrompt)) {
    if (!target) return unsupported('Select an object before deleting it.');
    return { ok: true, kind: 'proposal', title: `Delete ${target.name}`, description: 'This removes the selected object and descendants. Undo remains available.', calls: [{ name: 'studio_delete_node', arguments: { nodeId: target.id } }], errors: [] };
  }

  if (/\b(hide|show|lock|unlock)\b/i.test(cleanPrompt)) {
    if (!target) return unsupported('Select an object before changing visibility or lock state.');
    const argumentsValue: Record<string, unknown> = { nodeId: target.id };
    if (/\bhide\b/i.test(cleanPrompt)) argumentsValue.visible = false;
    if (/\bshow\b/i.test(cleanPrompt)) argumentsValue.visible = true;
    if (/\bunlock\b/i.test(cleanPrompt)) argumentsValue.locked = false;
    else if (/\block\b/i.test(cleanPrompt)) argumentsValue.locked = true;
    return { ok: true, kind: 'proposal', title: `Update ${target.name}`, description: 'Apply the requested editor state as one undoable change.', calls: [{ name: 'studio_update_node', arguments: argumentsValue }], errors: [] };
  }

  return unsupported('The Guided Assistant currently understands scene summaries, starter-project reset, object creation, transforms, materials, behaviors, visibility, duplication, deletion, and world backgrounds. A model-backed provider will use the same broader capability manifest.');
}

export function executeAgentToolBatch(project: ProjectDocument, calls: StudioAgentToolCall[]): StudioAgentBatchResult {
  let nextProject = project;
  let selectedId: string | null = null;
  const messages: string[] = [];
  const results: AgentToolResult[] = [];
  const resolvedCalls: StudioAgentToolCall[] = [];

  for (const call of calls) {
    const args = structuredClone(call.arguments);
    if (args.nodeId === '@last') {
      if (!selectedId) {
        return { ok: false, nextProject: project, selectedId: null, changed: false, messages: [], errors: [`${call.name} needs the result of an earlier scene tool.`], resolvedCalls: [], results: [] };
      }
      args.nodeId = selectedId;
    }
    const resolvedCall = { ...call, arguments: args };
    const result = executeAgentTool(nextProject, resolvedCall.name, resolvedCall.arguments);
    resolvedCalls.push(resolvedCall);
    results.push(result);
    if (!result.ok) {
      return { ok: false, nextProject: project, selectedId: null, changed: false, messages: [], errors: result.errors, resolvedCalls, results };
    }
    nextProject = result.nextProject;
    selectedId = result.selectedId ?? selectedId;
    messages.push(result.message);
  }

  return {
    ok: true,
    nextProject,
    selectedId,
    changed: results.some((result) => result.changed),
    messages,
    errors: [],
    resolvedCalls,
    results,
  };
}

export function planRequiresExplicitApproval(project: ProjectDocument, calls: StudioAgentToolCall[]) {
  return calls.some((call) => assessAgentToolCall(project, call.name, call.arguments).requiresApproval);
}

export const guidedStudioAgentProvider: StudioAgentProvider = {
  id: 'guided-local-tools',
  name: 'Guided Assistant',
  kind: 'guided',
  async plan({ project, selectedId, prompt }) {
    return planGuidedAgentPrompt(project, selectedId, prompt);
  },
};
