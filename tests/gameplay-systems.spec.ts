import { expect, test } from '@playwright/test';
import {
  InputRuntime,
  validateInputActionMap,
  type InputActionMap,
} from '../src/gameplay/input';
import {
  PHYSICS_FIXED_DELTA,
  PhysicsWorld,
  packCollisionGroups,
  validatePhysicsBodies,
  type PhysicsRigidBodyDefinition,
} from '../src/gameplay/physics';

function eventPhases(runtime: InputRuntime) {
  const phases: string[] = [];
  runtime.forEachEvent((event) => phases.push(`${event.actionId}:${event.phase}`));
  return phases;
}

test('InputRuntime resolves generalized actions and emits reusable lifecycle events', () => {
  const map: InputActionMap = {
    contexts: [{ id: 'gameplay', name: 'Gameplay' }],
    actions: [
      {
        id: 'jump',
        name: 'Jump',
        type: 'button',
        contextId: 'gameplay',
        bindings: [{ id: 'jump-space', device: 'keyboard', code: 'Space' }],
      },
      {
        id: 'move',
        name: 'Move',
        type: 'axis2d',
        contextId: 'gameplay',
        bindings: [
          { id: 'move-right', device: 'keyboard', code: 'KeyD', output: 'x', scale: 1 },
          { id: 'move-forward', device: 'keyboard', code: 'KeyW', output: 'y', scale: 1 },
        ],
      },
    ],
  };
  const runtime = new InputRuntime(map);
  const jumpState = runtime.getActionState('jump');

  runtime.setKeyboardKey('Space', true);
  expect(runtime.update()).toBe(2);
  expect(eventPhases(runtime)).toEqual(['jump:started', 'jump:performed']);
  expect(jumpState).toMatchObject({ active: true, phase: 'performed', value: [1, 0] });
  const firstEventSlot = runtime.eventAt(0);

  expect(runtime.update()).toBe(0);
  expect(runtime.getActionState('jump')).toBe(jumpState);
  runtime.setKeyboardKey('Space', false);
  expect(runtime.update()).toBe(1);
  expect(eventPhases(runtime)).toEqual(['jump:canceled']);
  expect(runtime.eventAt(0)).toBe(firstEventSlot);
  expect(jumpState).toMatchObject({ active: false, phase: 'canceled', value: [0, 0] });

  runtime.setKeyboardKey('KeyW', true);
  runtime.setKeyboardKey('KeyD', true);
  runtime.update();
  const move = runtime.getActionState('move');
  expect(move?.value[0]).toBeCloseTo(Math.SQRT1_2);
  expect(move?.value[1]).toBeCloseTo(Math.SQRT1_2);
  expect(Math.hypot(...(move?.value ?? [0, 0]))).toBeCloseTo(1);
  expect(runtime.getDiagnostics()).toMatchObject({ actionCount: 2, activeActions: 1, keyboardKeys: 2 });
});

test('InputRuntime supports pointer, touch, gamepad, transient values, and context consumption', () => {
  const runtime = new InputRuntime({
    contexts: [
      { id: 'gameplay', name: 'Gameplay', priority: 0 },
      { id: 'menu', name: 'Menu', priority: 100, consume: true, enabled: false },
    ],
    actions: [
      {
        id: 'gameplay.move',
        name: 'Gameplay Move',
        type: 'axis1d',
        contextId: 'gameplay',
        bindings: [{ id: 'gameplay-w', device: 'keyboard', code: 'KeyW' }],
      },
      {
        id: 'look',
        name: 'Look',
        type: 'axis2d',
        contextId: 'gameplay',
        normalize: false,
        bindings: [
          { id: 'look-x', device: 'pointer', control: 'deltaX', output: 'x', scale: 0.25 },
          { id: 'look-y', device: 'pointer', control: 'deltaY', output: 'y', scale: 0.25 },
        ],
      },
      {
        id: 'touch.fire',
        name: 'Touch Fire',
        type: 'button',
        contextId: 'gameplay',
        bindings: [{ id: 'touch-pressed', device: 'touch', control: 'pressed' }],
      },
      {
        id: 'throttle',
        name: 'Throttle',
        type: 'axis1d',
        contextId: 'gameplay',
        bindings: [{ id: 'pad-axis', device: 'gamepad', gamepad: 0, control: 'axis', index: 1, deadZone: 0.2 }],
      },
      {
        id: 'menu.up',
        name: 'Menu Up',
        type: 'button',
        contextId: 'menu',
        bindings: [{ id: 'menu-w', device: 'keyboard', code: 'KeyW' }],
      },
    ],
  });

  runtime.setKeyboardKey('KeyW', true);
  runtime.addPointerDelta(2, -3);
  runtime.setTouch(7, 0.2, 0.4);
  runtime.setGamepadAxis(0, 1, 0.6);
  runtime.update();
  expect(runtime.getActionState('gameplay.move')?.value[0]).toBe(1);
  expect(runtime.getActionState('look')?.value).toEqual([0.5, -0.75]);
  expect(runtime.getActionState('touch.fire')?.active).toBe(true);
  expect(runtime.getActionState('throttle')?.value[0]).toBeCloseTo(0.5);

  runtime.update();
  expect(runtime.getActionState('look')?.value).toEqual([0, 0]);
  expect(eventPhases(runtime)).toContain('look:canceled');

  runtime.setContextEnabled('menu', true);
  runtime.update();
  expect(runtime.getActionState('menu.up')?.active).toBe(true);
  expect(runtime.getActionState('gameplay.move')?.active).toBe(false);
  expect(eventPhases(runtime)).toEqual(expect.arrayContaining(['menu.up:started', 'menu.up:performed', 'gameplay.move:canceled']));

  runtime.setContextEnabled('menu', false);
  runtime.removeTouch(7);
  runtime.removeGamepad(0);
  runtime.update();
  expect(runtime.getActionState('gameplay.move')?.active).toBe(true);
  expect(runtime.getActionState('menu.up')?.active).toBe(false);
  expect(runtime.getDiagnostics()).toMatchObject({ activeTouches: 0, connectedGamepads: 0 });
});

test('serializable gameplay definitions reject dangling contexts and invalid physics shapes', () => {
  expect(validateInputActionMap({
    actions: [{
      id: 'look',
      name: 'Look',
      type: 'axis2d',
      contextId: 'missing',
      bindings: [{ id: 'look-x', device: 'pointer', control: 'deltaX' }],
    }],
  })).toEqual(expect.arrayContaining([
    'actions[0].contextId references missing context "missing".',
    'actions[0].bindings[0].output is required for axis2d actions.',
  ]));

  const invalidBodies: PhysicsRigidBodyDefinition[] = [{
    id: 'ball',
    type: 'dynamic',
    colliders: [{ id: 'ball-shape', shape: { type: 'sphere', radius: 0 } }],
  }];
  expect(validatePhysicsBodies(invalidBodies)).toContain(
    'bodies[0].colliders[0].shape.radius must be finite and greater than zero.',
  );
  expect(packCollisionGroups({ memberships: 0x0001, filter: 0x0002 })).toBe(0x00010002);
});

test('PhysicsWorld lazily runs fixed Rapier steps, queues collisions, resets, and disposes', async () => {
  const groups = { memberships: 0x0001, filter: 0x0001 };
  const bodies: PhysicsRigidBodyDefinition[] = [
    {
      id: 'ground',
      type: 'fixed',
      position: [0, -0.5, 0],
      colliders: [{
        id: 'ground-shape',
        shape: { type: 'box', halfExtents: [4, 0.5, 4] },
        collisionGroups: groups,
      }],
    },
    {
      id: 'checkpoint',
      type: 'fixed',
      position: [0, 1.5, 0],
      colliders: [{
        id: 'checkpoint-sensor',
        shape: { type: 'sphere', radius: 0.75 },
        sensor: true,
        collisionGroups: groups,
      }],
    },
    {
      id: 'ball',
      type: 'dynamic',
      position: [0, 3, 0],
      ccd: true,
      colliders: [{
        id: 'ball-shape',
        shape: { type: 'sphere', radius: 0.25 },
        restitution: 0,
        friction: 0.6,
        collisionGroups: groups,
      }],
    },
  ];
  const physics = new PhysicsWorld({ bodies });
  expect(physics.initialized).toBe(false);
  const initialized = await Promise.all([physics.initialize(), physics.initialize()]);
  expect(initialized).toEqual([physics, physics]);
  expect(physics.getDiagnostics()).toMatchObject({
    initialized: true,
    fixedDelta: PHYSICS_FIXED_DELTA,
    bodyCount: 3,
    colliderCount: 3,
    sensorCount: 1,
    ccdBodyCount: 1,
  });

  expect(physics.step(PHYSICS_FIXED_DELTA / 2)).toBe(0);
  expect(physics.step(PHYSICS_FIXED_DELTA / 2)).toBe(1);
  for (let index = 0; index < 180; index += 1) physics.step(PHYSICS_FIXED_DELTA);

  const collisionPairs = new Set<string>();
  let sawSensor = false;
  const drained = physics.drainCollisionEvents((event) => {
    collisionPairs.add([event.colliderAId, event.colliderBId].sort().join(':'));
    sawSensor ||= event.sensor;
  });
  expect(drained).toBeGreaterThan(0);
  expect(sawSensor).toBe(true);
  expect(collisionPairs).toContain('ball-shape:checkpoint-sensor');
  expect(collisionPairs).toContain('ball-shape:ground-shape');
  expect(physics.getBodyTransform('ball')?.position[1]).toBeLessThan(1);

  physics.reset();
  expect(physics.getBodyTransform('ball')?.position).toEqual([0, 3, 0]);
  expect(physics.collisionEventCount).toBe(0);
  expect(physics.getDiagnostics()).toMatchObject({ totalSteps: 0, bodyCount: 3, colliderCount: 3 });

  expect(physics.removeRigidBody('checkpoint')).toBe(true);
  expect(physics.getDiagnostics()).toMatchObject({ bodyCount: 2, colliderCount: 2, sensorCount: 0 });
  physics.dispose();
  expect(physics.getDiagnostics()).toMatchObject({ initialized: false, disposed: true, bodyCount: 0, colliderCount: 0 });
  expect(() => physics.step(PHYSICS_FIXED_DELTA)).toThrow('PhysicsWorld has been disposed.');
});
