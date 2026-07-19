import { defineGameplayEvent } from '../gameplay/events';
import type { InputActionMap } from '../gameplay/input';
import type { PhysicsRigidBodyDefinition } from '../gameplay/physics';
import type { UIDocument } from '../runtime-ui/types';
import { STUDIO_SDK_MODULE_ID } from '../scripting/studioSdkContract';
import type {
  DataAssetRecordV5,
  EntityV5,
  InputActionV5,
  JsonValueV5,
  MaterialData,
  ProjectDocumentV5,
  ProjectEventV5,
  ProjectVariableV5,
  ScriptAssetRecordV5,
  TransformData,
  UIDocumentV5,
  UIElementV5,
} from '../editor/types';

export const COLLECT_ESCAPE_TEMPLATE_VERSION = 1;
export const COLLECT_ESCAPE_PROJECT_ID = 'project.collect-escape';
export const COLLECT_ESCAPE_SCENE_ID = 'scene.collect-escape';
export const COLLECT_ESCAPE_INPUT_MAP_ID = 'input.collect-escape';
export const COLLECT_ESCAPE_BUILD_PROFILE_ID = 'build.collect-escape.web-production';
export const COLLECT_ESCAPE_SCRIPT_ASSET_ID = 'asset.script.collect-escape';
export const COLLECT_ESCAPE_RUNTIME_ASSET_ID = 'asset.runtime.collect-escape';
export const COLLECT_ESCAPE_RUNTIME_UI_ASSET_ID = 'asset.ui.collect-escape.hud';
export const COLLECT_ESCAPE_SOURCE_MAP_ASSET_ID = 'asset.sources.collect-escape';
export const COLLECT_ESCAPE_RUNTIME_UI_DOCUMENT_ID = 'ui.collect-escape.hud';

export const COLLECT_ESCAPE_PICKUP_IDS = [
  'entity.pickup.1',
  'entity.pickup.2',
  'entity.pickup.3',
  'entity.pickup.4',
  'entity.pickup.5',
] as const;

const AUTHORED_AT = '2026-07-18T00:00:00.000Z';
const PLAYER_ENTITY_ID = 'entity.player';
const EXIT_ENTITY_ID = 'entity.exit';
const WORLD_LAYER_ID = 'layer.world';
const PLAYER_LAYER_ID = 'layer.player';
const PICKUP_LAYER_ID = 'layer.pickup';
const EXIT_LAYER_ID = 'layer.exit';

const WORLD_GROUP = 0x0001;
const PLAYER_GROUP = 0x0002;
const PICKUP_GROUP = 0x0004;
const EXIT_GROUP = 0x0008;

const identityTransform = (position: [number, number, number] = [0, 0, 0]): TransformData => ({
  position,
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

const material = (
  color: string,
  options: Partial<Pick<MaterialData, 'emissive' | 'emissiveIntensity' | 'metalness' | 'roughness'>> = {},
): MaterialData => ({
  color,
  emissive: options.emissive ?? '#000000',
  emissiveIntensity: options.emissiveIntensity ?? 0,
  metalness: options.metalness ?? 0,
  roughness: options.roughness ?? 0.72,
});

const mesh = (
  id: string,
  name: string,
  primitive: NonNullable<EntityV5['primitive']>,
  position: [number, number, number],
  scale: [number, number, number],
  color: string,
  tags: string[],
  layers: string[],
  parentId = 'entity.world',
): EntityV5 => ({
  id,
  sceneId: COLLECT_ESCAPE_SCENE_ID,
  name,
  kind: 'mesh',
  parentId,
  active: true,
  visible: true,
  locked: false,
  tags,
  layers,
  transform: { position, rotation: [0, 0, 0], scale },
  primitive,
  material: material(color),
  components: [],
  castShadow: true,
  receiveShadow: true,
});

/**
 * The source catalog is a durable, JSON-only companion to ScriptAssetRecordV5.
 * ScriptAssetRecordV5 currently stores source metadata rather than source text,
 * so the template places editable text in a versioned data asset and connects
 * it through scriptAssetId + entryPoint. Import/build transactions can replace
 * both records atomically without inventing a browser object or object URL.
 */
export const COLLECT_ESCAPE_BEHAVIOR_SOURCE = String.raw`import { defineBehavior } from '${STUDIO_SDK_MODULE_ID}';

type RoundState = 'playing' | 'won' | 'failed';

export default defineBehavior({
  name: 'Collect & Escape Controller',
  description: 'Moves the player, tracks pickups and time, and owns round flow.',
  schema: {
    moveSpeed: { type: 'number', default: 5.5, min: 0 },
    pickupTarget: { type: 'number', default: 5, min: 1, step: 1 },
    roundSeconds: { type: 'number', default: 60, min: 1 },
  },

  onStart(ctx) {
    ctx.api.variables.set('score', 0);
    ctx.api.variables.set('pickupsRemaining', ctx.properties.pickupTarget);
    ctx.api.variables.set('timeRemaining', ctx.properties.roundSeconds);
    ctx.api.variables.set('roundState', 'playing' satisfies RoundState);
    ctx.api.variables.set('gameOver', false);
    ctx.api.variables.set('exitUnlocked', false);
    ctx.api.events.emit('round.started', { seconds: ctx.properties.roundSeconds });
  },

  onFixedUpdate(ctx) {
    if (ctx.api.variables.get('roundState') !== 'playing') return;

    const value = ctx.api.input.get('move');
    const axis = Array.isArray(value) ? value : [0, 0];
    const magnitude = Math.hypot(axis[0], axis[1]);
    const x = magnitude > 1 ? axis[0] / magnitude : axis[0];
    const y = magnitude > 1 ? axis[1] / magnitude : axis[1];
    const player = ctx.api.entities.findById('entity.player');
    if (player) {
      const distance = ctx.properties.moveSpeed * ctx.time.fixedDeltaSeconds;
      ctx.api.transforms.translate(player, [x * distance, 0, y * distance]);
    }

    const previous = Number(ctx.api.variables.get('timeRemaining') ?? 0);
    const remaining = Math.max(0, previous - ctx.time.fixedDeltaSeconds);
    ctx.api.variables.set('timeRemaining', remaining);
    if (remaining === 0) fail(ctx, 'Time expired');
  },

  onCollisionEnter(ctx, collision) {
    if (ctx.api.variables.get('roundState') !== 'playing') return;
    const other = collision.other.id;

    if (other.startsWith('entity.pickup.')) {
      ctx.api.entities.destroy(collision.other);
      const score = Number(ctx.api.variables.get('score') ?? 0) + 1;
      const remaining = Math.max(0, ctx.properties.pickupTarget - score);
      ctx.api.variables.set('score', score);
      ctx.api.variables.set('pickupsRemaining', remaining);
      ctx.api.events.emit('pickup.collected', { pickup: other, score });
      ctx.api.audio.play('pickup', { volume: 0.75 });
      if (remaining === 0) {
        ctx.api.variables.set('exitUnlocked', true);
        ctx.api.variables.set('statusMessage', 'Exit unlocked — reach the portal!');
      }
      return;
    }

    if (other === 'entity.exit') {
      ctx.api.events.emit('exit.reached', {});
      if (ctx.api.variables.get('exitUnlocked') !== true) {
        ctx.api.variables.set('statusMessage', 'Collect every energy shard first.');
        return;
      }
      ctx.api.variables.set('roundState', 'won' satisfies RoundState);
      ctx.api.variables.set('gameOver', true);
      ctx.api.variables.set('statusMessage', 'Escaped!');
      ctx.api.events.emit('round.won', {
        score: Number(ctx.api.variables.get('score') ?? 0),
        timeRemaining: Number(ctx.api.variables.get('timeRemaining') ?? 0),
      });
    }
  },

  onAction(ctx, action) {
    if (action.actionId === 'restart' && action.phase === 'started') restart(ctx);
  },

  onEvent(ctx, event) {
    if (event.channelId === 'round.restart') restart(ctx);
  },
});

function fail(ctx: Parameters<NonNullable<Parameters<typeof defineBehavior>[0]['onStart']>>[0], reason: string) {
  ctx.api.variables.set('roundState', 'failed' satisfies RoundState);
  ctx.api.variables.set('gameOver', true);
  ctx.api.variables.set('statusMessage', reason);
  ctx.api.events.emit('round.failed', { reason });
}

function restart(ctx: Parameters<NonNullable<Parameters<typeof defineBehavior>[0]['onStart']>>[0]) {
  ctx.api.scenes.restart();
}
`;

export const COLLECT_ESCAPE_RUNTIME_UI: UIDocument = {
  schemaVersion: 1,
  id: COLLECT_ESCAPE_RUNTIME_UI_DOCUMENT_ID,
  variables: [
    { id: 'score', type: 'number', initialValue: 0 },
    { id: 'timeRemaining', type: 'number', initialValue: 60 },
    { id: 'statusMessage', type: 'string', initialValue: 'Collect 5 energy shards, then reach the portal.' },
    { id: 'gameOver', type: 'boolean', initialValue: false },
    { id: 'touchAvailable', type: 'boolean', initialValue: false },
  ],
  breakpoints: [
    { id: 'mobile', maxWidth: 767 },
    { id: 'desktop', minWidth: 768 },
  ],
  localization: {
    defaultLocale: 'en',
    messages: {
      en: {
        'hud.title': 'COLLECT & ESCAPE',
        'hud.objective': 'Collect 5 energy shards, then reach the portal.',
        'hud.restart': 'Restart round',
      },
    },
  },
  root: {
    id: 'hud.root',
    type: 'screen',
    label: { type: 'localization', key: 'hud.title' },
    layout: { type: 'flex', direction: 'column', justify: 'space-between', align: 'stretch' },
    focusOrder: ['hud.restart', 'touch.left', 'touch.up', 'touch.down', 'touch.right'],
    style: {
      safeArea: true,
      padding: '1rem',
      color: '#f8fafc',
      fontFamily: 'system-ui, sans-serif',
      pointerEvents: 'none',
    },
    children: [
      {
        id: 'hud.top',
        type: 'panel',
        role: 'region',
        label: { type: 'literal', value: 'Round status' },
        layout: { type: 'flex', direction: 'row', justify: 'space-between', align: 'center', gap: '0.75rem' },
        style: {
          padding: '0.75rem',
          background: 'rgba(9, 14, 25, 0.82)',
          borderColor: 'rgba(103, 232, 249, 0.55)',
          borderWidth: '1px',
          borderRadius: '0.75rem',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
          pointerEvents: 'auto',
        },
        responsive: [
          {
            breakpointId: 'mobile',
            style: { padding: '0.6rem', gap: '0.5rem', fontSize: '0.875rem' },
            layout: { type: 'flex', direction: 'column', align: 'stretch', gap: '0.5rem' },
          },
        ],
        children: [
          {
            id: 'hud.score',
            type: 'text',
            element: 'h2',
            live: 'polite',
            value: {
              type: 'variable',
              variableId: 'score',
              fallback: 0,
              numberFormat: { style: 'integer', prefix: 'Shards ', suffix: ' / 5' },
            },
            style: { fontWeight: 700, letterSpacing: '0.04em' },
          },
          {
            id: 'hud.timer',
            type: 'progress',
            label: { type: 'literal', value: 'Time remaining' },
            value: { type: 'variable', variableId: 'timeRemaining', fallback: 60 },
            minimum: 0,
            maximum: 60,
            valueText: {
              type: 'variable',
              variableId: 'timeRemaining',
              fallback: 60,
              numberFormat: { style: 'integer', suffix: ' seconds' },
            },
            showValue: true,
            style: { minWidth: '12rem', color: '#67e8f9' },
            responsive: [{ breakpointId: 'mobile', style: { width: '100%', minWidth: 0 } }],
          },
        ],
      },
      {
        id: 'hud.center',
        type: 'stack',
        direction: 'column',
        align: 'center',
        gap: '0.75rem',
        style: { alignSelf: 'center', maxWidth: '38rem', textAlign: 'center', pointerEvents: 'auto' },
        children: [
          {
            id: 'hud.objective',
            type: 'text',
            element: 'p',
            value: { type: 'localization', key: 'hud.objective' },
            style: {
              padding: '0.6rem',
              background: 'rgba(9, 14, 25, 0.74)',
              borderRadius: '0.5rem',
              fontWeight: 600,
            },
          },
          {
            id: 'hud.status',
            type: 'panel',
            role: 'status',
            live: 'polite',
            label: { type: 'literal', value: 'Game status' },
            layout: { type: 'flex', direction: 'column', align: 'center', gap: '0.65rem' },
            style: {
              padding: '0.75rem',
              background: 'rgba(9, 14, 25, 0.88)',
              borderColor: '#22d3ee',
              borderWidth: '1px',
              borderRadius: '0.75rem',
            },
            children: [
              {
                id: 'hud.statusText',
                type: 'text',
                element: 'p',
                live: 'polite',
                value: { type: 'variable', variableId: 'statusMessage', fallback: 'Find the energy shards.' },
                style: { fontWeight: 650 },
              },
              {
                id: 'hud.restart',
                type: 'button',
                label: { type: 'localization', key: 'hud.restart' },
                ariaLabel: { type: 'literal', value: 'Restart Collect and Escape' },
                visible: { type: 'variable', variableId: 'gameOver', fallback: false },
                activations: [{ type: 'action', actionId: 'restart', phase: 'pressed' }],
                style: {
                  minWidth: '11rem',
                  minHeight: '44px',
                  padding: '0.75rem',
                  color: '#082f49',
                  background: '#67e8f9',
                  borderRadius: '0.5rem',
                  fontWeight: 750,
                  pointerEvents: 'auto',
                },
              },
            ],
          },
        ],
      },
      {
        id: 'hud.bottom',
        type: 'panel',
        role: 'region',
        label: { type: 'literal', value: 'Controls' },
        layout: { type: 'flex', direction: 'row', align: 'end', justify: 'space-between', gap: '1rem' },
        style: { pointerEvents: 'auto' },
        children: [
          {
            id: 'hud.keyboardHints',
            type: 'stack',
            direction: 'row',
            gap: '0.75rem',
            responsive: [{ breakpointId: 'mobile', style: { opacity: 0 } }],
            children: [
              {
                id: 'hint.move',
                type: 'inputPrompt',
                action: { type: 'action', actionId: 'move' },
                label: { type: 'literal', value: 'Move' },
                fallback: 'WASD / Left stick',
              },
              {
                id: 'hint.restart',
                type: 'inputPrompt',
                action: { type: 'action', actionId: 'restart' },
                label: { type: 'literal', value: 'Restart' },
                fallback: 'R',
              },
            ],
          },
          {
            id: 'hud.touchControls',
            type: 'panel',
            role: 'group',
            label: { type: 'literal', value: 'Touch movement controls' },
            visible: { type: 'variable', variableId: 'touchAvailable', fallback: false },
            layout: { type: 'grid', columns: 3, rows: ['56px', '56px'], gap: '0.4rem' },
            style: { width: '11rem', pointerEvents: 'auto' },
            children: [
              {
                id: 'touch.left',
                type: 'button',
                label: { type: 'literal', value: '←' },
                ariaLabel: { type: 'literal', value: 'Move left' },
                activations: [{ type: 'action', actionId: 'move.left', phase: 'pressed' }],
                style: { minWidth: '56px', minHeight: '56px', background: 'rgba(15, 23, 42, 0.9)', borderRadius: '0.75rem', fontSize: '1.4rem' },
              },
              {
                id: 'touch.up',
                type: 'button',
                label: { type: 'literal', value: '↑' },
                ariaLabel: { type: 'literal', value: 'Move forward' },
                activations: [{ type: 'action', actionId: 'move.up', phase: 'pressed' }],
                style: { minWidth: '56px', minHeight: '56px', background: 'rgba(15, 23, 42, 0.9)', borderRadius: '0.75rem', fontSize: '1.4rem' },
              },
              {
                id: 'touch.right',
                type: 'button',
                label: { type: 'literal', value: '→' },
                ariaLabel: { type: 'literal', value: 'Move right' },
                activations: [{ type: 'action', actionId: 'move.right', phase: 'pressed' }],
                style: { minWidth: '56px', minHeight: '56px', background: 'rgba(15, 23, 42, 0.9)', borderRadius: '0.75rem', fontSize: '1.4rem' },
              },
              {
                id: 'touch.down',
                type: 'button',
                label: { type: 'literal', value: '↓' },
                ariaLabel: { type: 'literal', value: 'Move backward' },
                activations: [{ type: 'action', actionId: 'move.down', phase: 'pressed' }],
                style: { minWidth: '56px', minHeight: '56px', background: 'rgba(15, 23, 42, 0.9)', borderRadius: '0.75rem', fontSize: '1.4rem' },
              },
            ],
          },
        ],
      },
    ],
  },
};

const v5InputActions: InputActionV5[] = [
  {
    id: 'move',
    name: 'Move',
    type: 'axis2d',
    deadZone: 0.16,
    bindings: [
      { id: 'binding.move.w', device: 'keyboard', code: 'KeyW', axis: 'y', scale: -1 },
      { id: 'binding.move.s', device: 'keyboard', code: 'KeyS', axis: 'y', scale: 1 },
      { id: 'binding.move.a', device: 'keyboard', code: 'KeyA', axis: 'x', scale: -1 },
      { id: 'binding.move.d', device: 'keyboard', code: 'KeyD', axis: 'x', scale: 1 },
      { id: 'binding.move.arrow-up', device: 'keyboard', code: 'ArrowUp', axis: 'y', scale: -1 },
      { id: 'binding.move.arrow-down', device: 'keyboard', code: 'ArrowDown', axis: 'y', scale: 1 },
      { id: 'binding.move.arrow-left', device: 'keyboard', code: 'ArrowLeft', axis: 'x', scale: -1 },
      { id: 'binding.move.arrow-right', device: 'keyboard', code: 'ArrowRight', axis: 'x', scale: 1 },
      { id: 'binding.move.gamepad-x', device: 'gamepad', control: 'axis.0', gamepadIndex: 0, axis: 'x', scale: 1 },
      { id: 'binding.move.gamepad-y', device: 'gamepad', control: 'axis.1', gamepadIndex: 0, axis: 'y', scale: 1 },
      { id: 'binding.move.touch-x', device: 'touch', control: 'joystick.x', axis: 'x', scale: 1 },
      { id: 'binding.move.touch-y', device: 'touch', control: 'joystick.y', axis: 'y', scale: 1 },
    ],
  },
  ...(['up', 'down', 'left', 'right'] as const).map((direction): InputActionV5 => ({
    id: `move.${direction}`,
    name: `Move ${direction}`,
    type: 'button',
    deadZone: 0,
    bindings: [{ id: `binding.move.${direction}.touch`, device: 'touch', control: `virtual.move.${direction}` }],
  })),
  {
    id: 'interact',
    name: 'Interact',
    type: 'button',
    deadZone: 0,
    bindings: [
      { id: 'binding.interact.keyboard', device: 'keyboard', code: 'KeyE' },
      { id: 'binding.interact.pointer', device: 'pointer', control: 'primary' },
      { id: 'binding.interact.gamepad', device: 'gamepad', control: 'button.0', gamepadIndex: 0 },
      { id: 'binding.interact.touch', device: 'touch', control: 'primary' },
    ],
  },
  {
    id: 'restart',
    name: 'Restart',
    type: 'button',
    deadZone: 0,
    bindings: [
      { id: 'binding.restart.keyboard', device: 'keyboard', code: 'KeyR' },
      { id: 'binding.restart.gamepad', device: 'gamepad', control: 'button.9', gamepadIndex: 0 },
      { id: 'binding.restart.touch', device: 'touch', control: 'restart' },
    ],
  },
];

export const COLLECT_ESCAPE_INPUT_ACTION_MAP: InputActionMap = {
  contexts: [{ id: 'gameplay', name: 'Gameplay', enabled: true, priority: 100, consume: true }],
  actions: [
    {
      id: 'move',
      name: 'Move',
      type: 'axis2d',
      contextId: 'gameplay',
      normalize: true,
      activationThreshold: 0.001,
      bindings: [
        { id: 'runtime.move.w', device: 'keyboard', code: 'KeyW', output: 'y', scale: -1 },
        { id: 'runtime.move.s', device: 'keyboard', code: 'KeyS', output: 'y', scale: 1 },
        { id: 'runtime.move.a', device: 'keyboard', code: 'KeyA', output: 'x', scale: -1 },
        { id: 'runtime.move.d', device: 'keyboard', code: 'KeyD', output: 'x', scale: 1 },
        { id: 'runtime.move.up', device: 'keyboard', code: 'ArrowUp', output: 'y', scale: -1 },
        { id: 'runtime.move.down', device: 'keyboard', code: 'ArrowDown', output: 'y', scale: 1 },
        { id: 'runtime.move.left', device: 'keyboard', code: 'ArrowLeft', output: 'x', scale: -1 },
        { id: 'runtime.move.right', device: 'keyboard', code: 'ArrowRight', output: 'x', scale: 1 },
        { id: 'runtime.move.pad-x', device: 'gamepad', gamepad: 0, control: 'axis', index: 0, output: 'x', scale: 1, deadZone: 0.16 },
        { id: 'runtime.move.pad-y', device: 'gamepad', gamepad: 0, control: 'axis', index: 1, output: 'y', scale: 1, deadZone: 0.16 },
        { id: 'runtime.move.touch-x', device: 'touch', control: 'deltaX', output: 'x', scale: 0.02, deadZone: 0.05 },
        { id: 'runtime.move.touch-y', device: 'touch', control: 'deltaY', output: 'y', scale: 0.02, deadZone: 0.05 },
      ],
    },
    ...(['up', 'down', 'left', 'right'] as const).map((direction) => ({
      id: `move.${direction}`,
      name: `Move ${direction}`,
      type: 'button' as const,
      contextId: 'gameplay',
      bindings: [],
    })),
    {
      id: 'interact',
      name: 'Interact',
      type: 'button',
      contextId: 'gameplay',
      bindings: [
        { id: 'runtime.interact.key', device: 'keyboard', code: 'KeyE' },
        { id: 'runtime.interact.pointer', device: 'pointer', control: 'button', button: 0 },
        { id: 'runtime.interact.pad', device: 'gamepad', gamepad: 0, control: 'button', index: 0 },
        { id: 'runtime.interact.touch', device: 'touch', control: 'pressed' },
      ],
    },
    {
      id: 'restart',
      name: 'Restart',
      type: 'button',
      contextId: 'gameplay',
      bindings: [
        { id: 'runtime.restart.key', device: 'keyboard', code: 'KeyR' },
        { id: 'runtime.restart.pad', device: 'gamepad', gamepad: 0, control: 'button', index: 9 },
      ],
    },
  ],
};

const pickupPositions: Array<[number, number, number]> = [
  [-7, 0.65, 5],
  [6.5, 0.65, 4],
  [-5.5, 0.65, -2],
  [5.5, 0.65, -3.5],
  [0, 0.65, -5.2],
];

export const COLLECT_ESCAPE_PHYSICS_BODIES: PhysicsRigidBodyDefinition[] = [
  {
    id: 'physics.player',
    type: 'kinematicPosition',
    position: [0, 0.8, 6],
    linearDamping: 8,
    ccd: true,
    colliders: [{
      id: 'collider.player',
      shape: { type: 'capsule', halfHeight: 0.4, radius: 0.35 },
      friction: 0,
      collisionGroups: { memberships: PLAYER_GROUP, filter: WORLD_GROUP | PICKUP_GROUP | EXIT_GROUP },
      emitCollisionEvents: true,
    }],
  },
  {
    id: 'physics.ground',
    type: 'fixed',
    position: [0, -0.25, 0],
    colliders: [{
      id: 'collider.ground',
      shape: { type: 'box', halfExtents: [10, 0.25, 8] },
      friction: 0.9,
      collisionGroups: { memberships: WORLD_GROUP, filter: PLAYER_GROUP },
    }],
  },
  ...([
    ['south', [0, 1, 8], [10, 1, 0.25]],
    ['east', [10, 1, 0], [0.25, 1, 8]],
    ['west', [-10, 1, 0], [0.25, 1, 8]],
    ['north-left', [-6, 1, -8], [4, 1, 0.25]],
    ['north-right', [6, 1, -8], [4, 1, 0.25]],
    ['obstacle-a', [-2.5, 0.65, 1.5], [2.25, 0.65, 0.45]],
    ['obstacle-b', [3.75, 0.65, -0.25], [0.45, 0.65, 2.25]],
  ] as const).map(([name, position, halfExtents]): PhysicsRigidBodyDefinition => ({
    id: `physics.${name}`,
    type: 'fixed',
    position: [...position],
    colliders: [{
      id: `collider.${name}`,
      shape: { type: 'box', halfExtents: [...halfExtents] },
      friction: 0.65,
      collisionGroups: { memberships: WORLD_GROUP, filter: PLAYER_GROUP },
    }],
  })),
  ...COLLECT_ESCAPE_PICKUP_IDS.map((_, index): PhysicsRigidBodyDefinition => ({
    id: `physics.pickup.${index + 1}`,
    type: 'fixed',
    position: [...pickupPositions[index]!],
    colliders: [{
      id: `collider.pickup.${index + 1}`,
      shape: { type: 'sphere', radius: 0.48 },
      sensor: true,
      collisionGroups: { memberships: PICKUP_GROUP, filter: PLAYER_GROUP },
      emitCollisionEvents: true,
    }],
  })),
  {
    id: 'physics.exit',
    type: 'fixed',
    position: [0, 1, -7.65],
    colliders: [{
      id: 'collider.exit',
      shape: { type: 'box', halfExtents: [1.25, 1, 0.3] },
      sensor: true,
      collisionGroups: { memberships: EXIT_GROUP, filter: PLAYER_GROUP },
      emitCollisionEvents: true,
    }],
  },
];

export const COLLECT_ESCAPE_EVENT_DEFINITIONS = [
  defineGameplayEvent({ id: 'round.started', version: 1, fields: { seconds: { schema: { type: 'number', minimum: 1 } } } }),
  defineGameplayEvent({
    id: 'pickup.collected',
    version: 1,
    fields: {
      pickup: { schema: { type: 'string', pattern: '^entity\\.pickup\\.[1-5]$' } },
      score: { schema: { type: 'number', integer: true, minimum: 1, maximum: 5 } },
    },
  }),
  defineGameplayEvent({ id: 'exit.reached', version: 1, fields: {} }),
  defineGameplayEvent({
    id: 'round.won',
    version: 1,
    fields: {
      score: { schema: { type: 'number', integer: true, minimum: 5 } },
      timeRemaining: { schema: { type: 'number', minimum: 0, maximum: 60 } },
    },
  }),
  defineGameplayEvent({ id: 'round.failed', version: 1, fields: { reason: { schema: { type: 'string', minimumLength: 1 } } } }),
  defineGameplayEvent({ id: 'round.restart', version: 1, fields: {} }),
] as const;

export interface CollectEscapeRuntimeComponentBinding {
  id: string;
  entityId: string;
  type: 'physicsBody' | 'characterController' | 'scriptBehavior' | 'runtimeUI';
  definitionId?: string;
  assetId?: string;
  properties?: Record<string, JsonValueV5>;
}

export interface CollectEscapeRuntimeManifest {
  schemaVersion: 1;
  format: 'threejs-studio.runtime-bindings.v1';
  fixedDeltaSeconds: number;
  maxCatchUpTicks: number;
  systemOrder: readonly string[];
  physics: {
    gravity: [number, number, number];
    bodies: PhysicsRigidBodyDefinition[];
  };
  input: InputActionMap;
  componentBindings: CollectEscapeRuntimeComponentBinding[];
  rules: {
    roundSeconds: number;
    pickupTarget: number;
    playerSpawn: [number, number, number];
    resetEventId: string;
  };
}

export const COLLECT_ESCAPE_RUNTIME_MANIFEST: CollectEscapeRuntimeManifest = {
  schemaVersion: 1,
  format: 'threejs-studio.runtime-bindings.v1',
  fixedDeltaSeconds: 1 / 60,
  maxCatchUpTicks: 5,
  systemOrder: ['input', 'scripts', 'physics', 'collisions', 'gameState', 'animation', 'audio', 'camera', 'ui', 'render'],
  physics: { gravity: [0, -9.81, 0], bodies: COLLECT_ESCAPE_PHYSICS_BODIES },
  input: COLLECT_ESCAPE_INPUT_ACTION_MAP,
  componentBindings: [
    ...COLLECT_ESCAPE_PHYSICS_BODIES.map((body) => ({
      id: `component.${body.id}`,
      entityId: body.id.replace('physics.', 'entity.'),
      type: 'physicsBody' as const,
      definitionId: body.id,
    })),
    {
      id: 'component.character-controller.player',
      entityId: PLAYER_ENTITY_ID,
      type: 'characterController',
      definitionId: 'physics.player',
      properties: {
        offset: 0.02,
        snapToGround: 0.35,
        maxSlopeClimbAngleDegrees: 45,
        minSlopeSlideAngleDegrees: 50,
        autostep: { maxHeight: 0.35, minWidth: 0.2, includeDynamicBodies: false },
      },
    },
    {
      id: 'component.script.collect-escape-controller',
      entityId: 'entity.game-controller',
      type: 'scriptBehavior',
      assetId: COLLECT_ESCAPE_SCRIPT_ASSET_ID,
      properties: { moveSpeed: 5.5, pickupTarget: 5, roundSeconds: 60 },
    },
    {
      id: 'component.ui.collect-escape-hud',
      entityId: 'entity.hud',
      type: 'runtimeUI',
      assetId: COLLECT_ESCAPE_RUNTIME_UI_ASSET_ID,
    },
  ],
  rules: {
    roundSeconds: 60,
    pickupTarget: 5,
    playerSpawn: [0, 0.8, 6],
    resetEventId: 'round.restart',
  },
};

const variables: ProjectVariableV5[] = [
  { id: 'score', name: 'Score', type: 'number', scope: 'session', defaultValue: 0 },
  { id: 'pickupsRemaining', name: 'Pickups Remaining', type: 'number', scope: 'session', defaultValue: 5 },
  { id: 'timeRemaining', name: 'Time Remaining', type: 'number', scope: 'session', defaultValue: 60 },
  { id: 'roundState', name: 'Round State', type: 'string', scope: 'session', defaultValue: 'playing' },
  { id: 'statusMessage', name: 'Status Message', type: 'string', scope: 'session', defaultValue: 'Collect 5 energy shards, then reach the portal.' },
  { id: 'gameOver', name: 'Game Over', type: 'boolean', scope: 'session', defaultValue: false },
  { id: 'exitUnlocked', name: 'Exit Unlocked', type: 'boolean', scope: 'session', defaultValue: false },
  { id: 'touchAvailable', name: 'Touch Available', type: 'boolean', scope: 'session', defaultValue: false },
  { id: 'playerSpawn', name: 'Player Spawn', type: 'vec3', scope: 'project', defaultValue: [0, 0.8, 6] },
  { id: 'bestTimeRemaining', name: 'Best Time Remaining', type: 'number', scope: 'save', defaultValue: 0 },
];

const projectEvents: ProjectEventV5[] = [
  { id: 'round.started', name: 'Round Started', payload: [{ id: 'seconds', name: 'Seconds', type: 'number', required: true }] },
  {
    id: 'pickup.collected',
    name: 'Pickup Collected',
    payload: [
      { id: 'pickup', name: 'Pickup', type: 'entity', required: true },
      { id: 'score', name: 'Score', type: 'number', required: true },
    ],
  },
  { id: 'exit.reached', name: 'Exit Reached', payload: [] },
  {
    id: 'round.won',
    name: 'Round Won',
    payload: [
      { id: 'score', name: 'Score', type: 'number', required: true },
      { id: 'timeRemaining', name: 'Time Remaining', type: 'number', required: true },
    ],
  },
  { id: 'round.failed', name: 'Round Failed', payload: [{ id: 'reason', name: 'Reason', type: 'string', required: true }] },
  { id: 'round.restart', name: 'Restart Round', payload: [] },
];

const runtimeUiElements: UIElementV5[] = [
  {
    id: 'ui.hud.root',
    parentId: null,
    type: 'container',
    name: 'HUD Root',
    active: true,
    properties: { runtimeAssetId: COLLECT_ESCAPE_RUNTIME_UI_ASSET_ID, layout: 'safe-area-screen', responsive: true },
  },
  {
    id: 'ui.hud.score',
    parentId: 'ui.hud.root',
    type: 'text',
    name: 'Score',
    active: true,
    properties: { variableId: 'score', prefix: 'Shards ', suffix: ' / 5', live: 'polite' },
  },
  {
    id: 'ui.hud.timer',
    parentId: 'ui.hud.root',
    type: 'progress',
    name: 'Countdown',
    active: true,
    properties: { variableId: 'timeRemaining', minimum: 0, maximum: 60, label: 'Time remaining' },
  },
  {
    id: 'ui.hud.status',
    parentId: 'ui.hud.root',
    type: 'text',
    name: 'Round Status',
    active: true,
    properties: { variableId: 'statusMessage', live: 'polite' },
  },
  {
    id: 'ui.hud.restart',
    parentId: 'ui.hud.root',
    type: 'button',
    name: 'Restart',
    active: true,
    properties: { eventId: 'round.restart', visibleVariableId: 'gameOver', accessibleName: 'Restart Collect and Escape' },
  },
  {
    id: 'ui.hud.touch',
    parentId: 'ui.hud.root',
    type: 'input',
    name: 'Touch Controls',
    active: true,
    properties: { actionIds: ['move.left', 'move.up', 'move.down', 'move.right'], minimumTargetPixels: 56, visibleVariableId: 'touchAvailable' },
  },
];

const uiDocument: UIDocumentV5 = {
  id: COLLECT_ESCAPE_RUNTIME_UI_DOCUMENT_ID,
  name: 'Collect & Escape HUD',
  sceneId: COLLECT_ESCAPE_SCENE_ID,
  rootElementIds: ['ui.hud.root'],
  elements: runtimeUiElements,
};

const scriptAsset: ScriptAssetRecordV5 = {
  assetVersion: 1,
  id: COLLECT_ESCAPE_SCRIPT_ASSET_ID,
  kind: 'script',
  name: 'Collect & Escape Controller',
  revision: 1,
  createdAt: AUTHORED_AT,
  updatedAt: AUTHORED_AT,
  tags: ['template', 'gameplay', 'behavior'],
  source: {
    filename: 'scripts/collectEscape.ts',
    mimeType: 'text/typescript',
    byteLength: new TextEncoder().encode(COLLECT_ESCAPE_BEHAVIOR_SOURCE).byteLength,
  },
  language: 'typescript',
  runtime: 'worker',
  entryPoint: 'scripts/collectEscape.ts',
};

const jsonValue = (value: unknown): JsonValueV5 => JSON.parse(JSON.stringify(value)) as JsonValueV5;

const dataAsset = (id: string, name: string, tags: string[], value: unknown): DataAssetRecordV5 => ({
  assetVersion: 1,
  id,
  kind: 'data',
  name,
  revision: 1,
  createdAt: AUTHORED_AT,
  updatedAt: AUTHORED_AT,
  tags,
  value: jsonValue(value),
});

const pickupEntities: EntityV5[] = COLLECT_ESCAPE_PICKUP_IDS.map((id, index) => ({
  ...mesh(
    id,
    `Energy Shard ${index + 1}`,
    'torus',
    pickupPositions[index]!,
    [0.42, 0.42, 0.42],
    '#67e8f9',
    ['pickup', 'collectible'],
    [PICKUP_LAYER_ID],
  ),
  material: material('#67e8f9', { emissive: '#0891b2', emissiveIntensity: 1.8, metalness: 0.2, roughness: 0.25 }),
  components: [
    { id: `component.pickup.${index + 1}.rotate`, type: 'rotate', enabled: true, speed: 1.4, axis: 'y' },
    { id: `component.pickup.${index + 1}.float`, type: 'float', enabled: true, speed: 1.5, distance: 0.14, axis: 'y', phase: index * 0.7 },
  ],
}));

const entities: EntityV5[] = [
  {
    id: 'entity.world',
    sceneId: COLLECT_ESCAPE_SCENE_ID,
    name: 'Collect & Escape',
    kind: 'group',
    parentId: null,
    active: true,
    visible: true,
    locked: false,
    tags: ['world', 'template'],
    layers: [WORLD_LAYER_ID],
    transform: identityTransform(),
    components: [],
  },
  mesh('entity.ground', 'Arena Floor', 'box', [0, -0.25, 0], [20, 0.5, 16], '#111827', ['world', 'walkable'], [WORLD_LAYER_ID]),
  mesh('entity.south', 'South Wall', 'box', [0, 1, 8], [20, 2, 0.5], '#263449', ['world', 'collision'], [WORLD_LAYER_ID]),
  mesh('entity.east', 'East Wall', 'box', [10, 1, 0], [0.5, 2, 16], '#263449', ['world', 'collision'], [WORLD_LAYER_ID]),
  mesh('entity.west', 'West Wall', 'box', [-10, 1, 0], [0.5, 2, 16], '#263449', ['world', 'collision'], [WORLD_LAYER_ID]),
  mesh('entity.north-left', 'North Wall Left', 'box', [-6, 1, -8], [8, 2, 0.5], '#263449', ['world', 'collision'], [WORLD_LAYER_ID]),
  mesh('entity.north-right', 'North Wall Right', 'box', [6, 1, -8], [8, 2, 0.5], '#263449', ['world', 'collision'], [WORLD_LAYER_ID]),
  mesh('entity.obstacle-a', 'Low Barrier', 'box', [-2.5, 0.65, 1.5], [4.5, 1.3, 0.9], '#334155', ['world', 'collision', 'obstacle'], [WORLD_LAYER_ID]),
  mesh('entity.obstacle-b', 'Tall Barrier', 'box', [3.75, 0.65, -0.25], [0.9, 1.3, 4.5], '#334155', ['world', 'collision', 'obstacle'], [WORLD_LAYER_ID]),
  {
    ...mesh(PLAYER_ENTITY_ID, 'Player', 'capsule', [0, 0.8, 6], [0.75, 1.6, 0.75], '#f8fafc', ['player', 'controllable'], [PLAYER_LAYER_ID]),
    material: material('#f8fafc', { emissive: '#164e63', emissiveIntensity: 0.35, metalness: 0.15, roughness: 0.4 }),
    components: [{ id: 'component.player.move', type: 'keyboardMove', enabled: true, speed: 5.5, plane: 'xz', actionId: 'move' }],
  },
  ...pickupEntities,
  {
    ...mesh(EXIT_ENTITY_ID, 'Escape Portal', 'torus', [0, 1, -7.65], [1.5, 1.5, 0.35], '#22d3ee', ['exit', 'objective', 'sensor'], [EXIT_LAYER_ID]),
    material: material('#22d3ee', { emissive: '#06b6d4', emissiveIntensity: 2.2, metalness: 0.4, roughness: 0.2 }),
    components: [{ id: 'component.exit.rotate', type: 'rotate', enabled: true, speed: 0.65, axis: 'z' }],
  },
  {
    id: 'entity.camera',
    sceneId: COLLECT_ESCAPE_SCENE_ID,
    name: 'Gameplay Camera',
    kind: 'camera',
    parentId: 'entity.world',
    active: true,
    visible: true,
    locked: false,
    tags: ['camera', 'gameplay'],
    layers: [WORLD_LAYER_ID],
    transform: { position: [0, 11, 13], rotation: [-0.58, 0, 0], scale: [1, 1, 1] },
    camera: { fov: 52, near: 0.1, far: 100, primary: true },
    components: [],
  },
  {
    id: 'entity.sun',
    sceneId: COLLECT_ESCAPE_SCENE_ID,
    name: 'Key Light',
    kind: 'light',
    parentId: 'entity.world',
    active: true,
    visible: true,
    locked: false,
    tags: ['lighting'],
    layers: [WORLD_LAYER_ID],
    transform: { position: [6, 12, 7], rotation: [-0.8, 0.55, 0], scale: [1, 1, 1] },
    light: { type: 'directional', color: '#e0f2fe', intensity: 3.2, distance: 0, castShadow: true },
    components: [],
  },
  {
    id: 'entity.fill',
    sceneId: COLLECT_ESCAPE_SCENE_ID,
    name: 'Portal Fill',
    kind: 'light',
    parentId: 'entity.world',
    active: true,
    visible: true,
    locked: false,
    tags: ['lighting', 'portal'],
    layers: [WORLD_LAYER_ID],
    transform: identityTransform([0, 2.5, -6.4]),
    light: { type: 'point', color: '#22d3ee', intensity: 5, distance: 9, castShadow: false },
    components: [],
  },
  {
    id: 'entity.game-controller',
    sceneId: COLLECT_ESCAPE_SCENE_ID,
    name: 'Game Controller',
    kind: 'group',
    parentId: 'entity.world',
    active: true,
    visible: true,
    locked: true,
    tags: ['gameplay', 'script-host'],
    layers: [WORLD_LAYER_ID],
    transform: identityTransform(),
    components: [],
  },
  {
    id: 'entity.hud',
    sceneId: COLLECT_ESCAPE_SCENE_ID,
    name: 'Runtime HUD',
    kind: 'ui',
    parentId: 'entity.world',
    active: true,
    visible: true,
    locked: true,
    tags: ['ui', 'hud'],
    layers: [WORLD_LAYER_ID],
    transform: identityTransform(),
    components: [],
  },
];

const baseProject: ProjectDocumentV5 = {
  schemaVersion: 5,
  id: COLLECT_ESCAPE_PROJECT_ID,
  name: 'Collect & Escape',
  updatedAt: AUTHORED_AT,
  startupSceneId: COLLECT_ESCAPE_SCENE_ID,
  scenes: [{
    id: COLLECT_ESCAPE_SCENE_ID,
    name: 'Neon Escape Arena',
    version: 1,
    rootEntityIds: ['entity.world'],
    settings: {
      background: '#050914',
      fogColor: '#071426',
      fogNear: 18,
      fogFar: 48,
      fogEnabled: true,
      exposure: 1.05,
      gridSize: 24,
      gridDivisions: 24,
      shadows: true,
    },
    tags: ['gameplay', 'template', 'collect-escape'],
  }],
  entities,
  prefabs: [],
  assets: [
    scriptAsset,
    dataAsset(COLLECT_ESCAPE_SOURCE_MAP_ASSET_ID, 'Collect & Escape Sources', ['source', 'typescript'], {
      format: 'threejs-studio.source-catalog.v1',
      scriptAssetId: COLLECT_ESCAPE_SCRIPT_ASSET_ID,
      files: { 'scripts/collectEscape.ts': COLLECT_ESCAPE_BEHAVIOR_SOURCE },
    }),
    dataAsset(COLLECT_ESCAPE_RUNTIME_ASSET_ID, 'Collect & Escape Runtime Bindings', ['runtime', 'gameplay', 'physics'], COLLECT_ESCAPE_RUNTIME_MANIFEST),
    dataAsset(COLLECT_ESCAPE_RUNTIME_UI_ASSET_ID, 'Collect & Escape Runtime HUD', ['runtime-ui', 'hud', 'accessible'], COLLECT_ESCAPE_RUNTIME_UI),
  ],
  layers: [
    { id: WORLD_LAYER_ID, name: 'World', collisionMask: [PLAYER_LAYER_ID] },
    { id: PLAYER_LAYER_ID, name: 'Player', collisionMask: [WORLD_LAYER_ID, PICKUP_LAYER_ID, EXIT_LAYER_ID] },
    { id: PICKUP_LAYER_ID, name: 'Pickups', collisionMask: [PLAYER_LAYER_ID] },
    { id: EXIT_LAYER_ID, name: 'Exit', collisionMask: [PLAYER_LAYER_ID] },
  ],
  inputMaps: [{
    id: COLLECT_ESCAPE_INPUT_MAP_ID,
    name: 'Collect & Escape Gameplay',
    version: 1,
    enabled: true,
    priority: 100,
    actions: v5InputActions,
  }],
  variables,
  events: projectEvents,
  ui: { startupDocumentId: uiDocument.id, documents: [uiDocument] },
  buildProfiles: [{
    id: COLLECT_ESCAPE_BUILD_PROFILE_ID,
    name: 'Offline Web Production',
    target: 'web',
    mode: 'production',
    startupSceneId: COLLECT_ESCAPE_SCENE_ID,
    quality: 'auto',
    basePath: './',
    offline: true,
  }],
  defaultBuildProfileId: COLLECT_ESCAPE_BUILD_PROFILE_ID,
  permissions: {
    network: { policy: 'deny', origins: [] },
    localFiles: 'none',
    storage: 'local',
    clipboard: false,
    fullscreen: true,
    pointerLock: false,
    gamepad: true,
    microphone: false,
    camera: false,
  },
};

export interface CollectEscapeTemplate {
  templateVersion: typeof COLLECT_ESCAPE_TEMPLATE_VERSION;
  project: ProjectDocumentV5;
  behaviorSources: Record<string, string>;
  runtimeManifest: CollectEscapeRuntimeManifest;
  runtimeUI: UIDocument;
}

/** Returns an isolated authoring document so Play can clone it without mutation. */
export function createCollectEscapeProject(): ProjectDocumentV5 {
  return structuredClone(baseProject);
}

/** Returns every production input needed by the editor, compiler, runtime, and builder. */
export function createCollectEscapeTemplate(): CollectEscapeTemplate {
  return {
    templateVersion: COLLECT_ESCAPE_TEMPLATE_VERSION,
    project: createCollectEscapeProject(),
    behaviorSources: { 'scripts/collectEscape.ts': COLLECT_ESCAPE_BEHAVIOR_SOURCE },
    runtimeManifest: structuredClone(COLLECT_ESCAPE_RUNTIME_MANIFEST),
    runtimeUI: structuredClone(COLLECT_ESCAPE_RUNTIME_UI),
  };
}
