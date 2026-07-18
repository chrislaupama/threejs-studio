import type {
  Collider,
  ColliderHandle,
  EventQueue,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat';

export const PHYSICS_FIXED_DELTA = 1 / 60;

export type PhysicsVector3 = [number, number, number];
export type PhysicsQuaternion = [number, number, number, number];
export type PhysicsBodyType = 'dynamic' | 'fixed' | 'kinematicPosition' | 'kinematicVelocity';

export interface PhysicsCollisionGroups {
  /** 16-bit membership mask. */
  memberships: number;
  /** 16-bit interaction filter mask. */
  filter: number;
}

export type PhysicsColliderShape =
  | { type: 'box'; halfExtents: PhysicsVector3 }
  | { type: 'sphere'; radius: number }
  | { type: 'capsule'; halfHeight: number; radius: number }
  | { type: 'cylinder'; halfHeight: number; radius: number }
  | { type: 'cone'; halfHeight: number; radius: number };

export interface PhysicsColliderDefinition {
  id: string;
  shape: PhysicsColliderShape;
  position?: PhysicsVector3;
  rotation?: PhysicsQuaternion;
  sensor?: boolean;
  friction?: number;
  restitution?: number;
  density?: number;
  collisionGroups?: PhysicsCollisionGroups;
  solverGroups?: PhysicsCollisionGroups;
  /** Defaults to true so contacts and sensor intersections reach the wrapper queue. */
  emitCollisionEvents?: boolean;
}

export interface PhysicsRigidBodyDefinition {
  id: string;
  type: PhysicsBodyType;
  enabled?: boolean;
  position?: PhysicsVector3;
  rotation?: PhysicsQuaternion;
  linearVelocity?: PhysicsVector3;
  angularVelocity?: PhysicsVector3;
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  canSleep?: boolean;
  ccd?: boolean;
  colliders: PhysicsColliderDefinition[];
}

export interface PhysicsWorldOptions {
  gravity?: PhysicsVector3;
  bodies?: PhysicsRigidBodyDefinition[];
  /** Frame delta clamp. Defaults to 0.25 seconds. */
  maxFrameDelta?: number;
  /** Fixed steps allowed per update before excess time is dropped. Defaults to 8. */
  maxSubSteps?: number;
  /** Wrapper collision events retained until drained. Defaults to 2048. */
  maxCollisionEvents?: number;
}

export interface PhysicsTransform {
  position: PhysicsVector3;
  rotation: PhysicsQuaternion;
}

/** Valid until the wrapper collision queue is drained and reused. */
export interface PhysicsCollisionEvent {
  colliderAId: string;
  colliderBId: string;
  bodyAId: string | null;
  bodyBId: string | null;
  started: boolean;
  sensor: boolean;
  step: number;
}

export interface PhysicsWorldDiagnostics {
  initialized: boolean;
  disposed: boolean;
  engine: 'rapier';
  fixedDelta: number;
  maxFrameDelta: number;
  maxSubSteps: number;
  lastSubSteps: number;
  totalSteps: number;
  accumulator: number;
  interpolationAlpha: number;
  droppedTime: number;
  bodyCount: number;
  colliderCount: number;
  sensorCount: number;
  ccdBodyCount: number;
  collisionEventCount: number;
  droppedCollisionEvents: number;
  gravity: PhysicsVector3;
}

type RapierModule = typeof import('@dimforge/rapier3d-compat');

interface BodyRecord {
  body: RigidBody;
  colliderIds: string[];
}

interface ColliderRecord {
  collider: Collider;
  bodyId: string;
  sensor: boolean;
}

interface MutablePhysicsCollisionEvent extends PhysicsCollisionEvent {}

let sharedRapierPromise: Promise<RapierModule> | null = null;

async function loadRapier(): Promise<RapierModule> {
  if (!sharedRapierPromise) {
    sharedRapierPromise = import('@dimforge/rapier3d-compat')
      .then(async (rapier) => {
        await rapier.init();
        return rapier;
      })
      .catch((error: unknown) => {
        sharedRapierPromise = null;
        throw error;
      });
  }
  return sharedRapierPromise;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateVector(value: readonly number[] | undefined, length: number, path: string, errors: string[]) {
  if (value === undefined) return;
  if (value.length !== length || value.some((entry) => !isFiniteNumber(entry))) {
    errors.push(`${path} must contain ${length} finite numbers.`);
  }
}

function validateGroups(groups: PhysicsCollisionGroups | undefined, path: string, errors: string[]) {
  if (!groups) return;
  if (!Number.isInteger(groups.memberships) || groups.memberships < 0 || groups.memberships > 0xffff) {
    errors.push(`${path}.memberships must be a 16-bit unsigned integer.`);
  }
  if (!Number.isInteger(groups.filter) || groups.filter < 0 || groups.filter > 0xffff) {
    errors.push(`${path}.filter must be a 16-bit unsigned integer.`);
  }
}

function validatePositive(value: number, path: string, errors: string[]) {
  if (!isFiniteNumber(value) || value <= 0) errors.push(`${path} must be finite and greater than zero.`);
}

export function validatePhysicsBodyDefinition(definition: PhysicsRigidBodyDefinition): string[] {
  const errors: string[] = [];
  if (!definition.id.trim()) errors.push('id must be a non-empty string.');
  validateVector(definition.position, 3, 'position', errors);
  validateVector(definition.rotation, 4, 'rotation', errors);
  validateVector(definition.linearVelocity, 3, 'linearVelocity', errors);
  validateVector(definition.angularVelocity, 3, 'angularVelocity', errors);
  if (definition.gravityScale !== undefined && !isFiniteNumber(definition.gravityScale)) errors.push('gravityScale must be finite.');
  if (definition.linearDamping !== undefined && (!isFiniteNumber(definition.linearDamping) || definition.linearDamping < 0)) {
    errors.push('linearDamping must be finite and non-negative.');
  }
  if (definition.angularDamping !== undefined && (!isFiniteNumber(definition.angularDamping) || definition.angularDamping < 0)) {
    errors.push('angularDamping must be finite and non-negative.');
  }

  const colliderIds = new Set<string>();
  for (const [index, collider] of definition.colliders.entries()) {
    const path = `colliders[${index}]`;
    if (!collider.id.trim()) errors.push(`${path}.id must be a non-empty string.`);
    if (colliderIds.has(collider.id)) errors.push(`${path}.id duplicates collider "${collider.id}".`);
    colliderIds.add(collider.id);
    validateVector(collider.position, 3, `${path}.position`, errors);
    validateVector(collider.rotation, 4, `${path}.rotation`, errors);
    if (collider.friction !== undefined && (!isFiniteNumber(collider.friction) || collider.friction < 0)) {
      errors.push(`${path}.friction must be finite and non-negative.`);
    }
    if (collider.restitution !== undefined && (
      !isFiniteNumber(collider.restitution) || collider.restitution < 0 || collider.restitution > 1
    )) {
      errors.push(`${path}.restitution must be in the range [0, 1].`);
    }
    if (collider.density !== undefined && (!isFiniteNumber(collider.density) || collider.density < 0)) {
      errors.push(`${path}.density must be finite and non-negative.`);
    }
    validateGroups(collider.collisionGroups, `${path}.collisionGroups`, errors);
    validateGroups(collider.solverGroups, `${path}.solverGroups`, errors);

    if (collider.shape.type === 'box') {
      validateVector(collider.shape.halfExtents, 3, `${path}.shape.halfExtents`, errors);
      collider.shape.halfExtents.forEach((value, axis) => validatePositive(value, `${path}.shape.halfExtents[${axis}]`, errors));
    } else if (collider.shape.type === 'sphere') {
      validatePositive(collider.shape.radius, `${path}.shape.radius`, errors);
    } else {
      validatePositive(collider.shape.halfHeight, `${path}.shape.halfHeight`, errors);
      validatePositive(collider.shape.radius, `${path}.shape.radius`, errors);
    }
  }
  return errors;
}

export function validatePhysicsBodies(definitions: readonly PhysicsRigidBodyDefinition[]): string[] {
  const errors: string[] = [];
  const bodyIds = new Set<string>();
  const colliderIds = new Set<string>();
  for (const [index, definition] of definitions.entries()) {
    const path = `bodies[${index}]`;
    if (bodyIds.has(definition.id)) errors.push(`${path}.id duplicates body "${definition.id}".`);
    bodyIds.add(definition.id);
    for (const error of validatePhysicsBodyDefinition(definition)) errors.push(`${path}.${error}`);
    for (const [colliderIndex, collider] of definition.colliders.entries()) {
      if (colliderIds.has(collider.id)) {
        errors.push(`${path}.colliders[${colliderIndex}].id duplicates project collider "${collider.id}".`);
      }
      colliderIds.add(collider.id);
    }
  }
  return errors;
}

export function packCollisionGroups(groups: PhysicsCollisionGroups): number {
  return (((groups.memberships & 0xffff) << 16) | (groups.filter & 0xffff)) >>> 0;
}

function normalizedQuaternion(value: PhysicsQuaternion | undefined) {
  const source = value ?? [0, 0, 0, 1];
  const length = Math.hypot(source[0], source[1], source[2], source[3]);
  if (length <= Number.EPSILON) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: source[0] / length, y: source[1] / length, z: source[2] / length, w: source[3] / length };
}

function vectorObject(value: PhysicsVector3 | undefined, fallback: PhysicsVector3 = [0, 0, 0]) {
  const source = value ?? fallback;
  return { x: source[0], y: source[1], z: source[2] };
}

function cloneBodyDefinition(definition: PhysicsRigidBodyDefinition): PhysicsRigidBodyDefinition {
  return structuredClone(definition);
}

/**
 * Lazy Rapier owner with a deterministic 60 Hz accumulator. Rapier types stay
 * behind this runtime boundary; project-facing definitions remain serializable.
 */
export class PhysicsWorld {
  private rapier: RapierModule | null = null;
  private world: World | null = null;
  private eventQueue: EventQueue | null = null;
  private initializationPromise: Promise<this> | null = null;
  private readonly bodyDefinitions = new Map<string, PhysicsRigidBodyDefinition>();
  private readonly bodies = new Map<string, BodyRecord>();
  private readonly bodyIdsByHandle = new Map<number, string>();
  private readonly colliders = new Map<string, ColliderRecord>();
  private readonly colliderIdsByHandle = new Map<number, string>();
  private readonly collisionEvents: MutablePhysicsCollisionEvent[] = [];
  private collisionEventCountValue = 0;
  private accumulatorValue = 0;
  private totalStepsValue = 0;
  private lastSubStepsValue = 0;
  private droppedTimeValue = 0;
  private droppedCollisionEventsValue = 0;
  private disposedValue = false;
  private readonly maxFrameDelta: number;
  private readonly maxSubSteps: number;
  private readonly maxCollisionEvents: number;
  private gravity: PhysicsVector3;

  constructor(options: PhysicsWorldOptions = {}) {
    this.gravity = [...(options.gravity ?? [0, -9.81, 0])] as PhysicsVector3;
    this.maxFrameDelta = options.maxFrameDelta ?? 0.25;
    this.maxSubSteps = options.maxSubSteps ?? 8;
    this.maxCollisionEvents = options.maxCollisionEvents ?? 2048;
    if (!this.gravity.every(isFiniteNumber)) throw new TypeError('Physics gravity must contain three finite numbers.');
    if (!isFiniteNumber(this.maxFrameDelta) || this.maxFrameDelta <= 0) throw new TypeError('maxFrameDelta must be greater than zero.');
    if (!Number.isInteger(this.maxSubSteps) || this.maxSubSteps < 1) throw new TypeError('maxSubSteps must be a positive integer.');
    if (!Number.isInteger(this.maxCollisionEvents) || this.maxCollisionEvents < 1) {
      throw new TypeError('maxCollisionEvents must be a positive integer.');
    }
    const definitions = options.bodies ?? [];
    const errors = validatePhysicsBodies(definitions);
    if (errors.length > 0) throw new TypeError(`Invalid physics bodies:\n${errors.join('\n')}`);
    for (const definition of definitions) this.bodyDefinitions.set(definition.id, cloneBodyDefinition(definition));
  }

  get initialized() {
    return this.world !== null;
  }

  get disposed() {
    return this.disposedValue;
  }

  get collisionEventCount() {
    return this.collisionEventCountValue;
  }

  get interpolationAlpha() {
    return this.accumulatorValue / PHYSICS_FIXED_DELTA;
  }

  async initialize(): Promise<this> {
    this.assertNotDisposed();
    if (this.world) return this;
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.initializeRuntime();
    try {
      return await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  addRigidBody(definition: PhysicsRigidBodyDefinition): string {
    this.requireWorld();
    if (this.bodyDefinitions.has(definition.id)) throw new Error(`Physics body "${definition.id}" already exists.`);
    for (const collider of definition.colliders) {
      if (this.colliders.has(collider.id)) throw new Error(`Physics collider "${collider.id}" already exists.`);
    }
    const errors = validatePhysicsBodyDefinition(definition);
    if (errors.length > 0) throw new TypeError(`Invalid physics body "${definition.id}":\n${errors.join('\n')}`);
    const copy = cloneBodyDefinition(definition);
    this.createBodyRuntime(copy);
    this.bodyDefinitions.set(copy.id, copy);
    return copy.id;
  }

  removeRigidBody(bodyId: string): boolean {
    const world = this.requireWorld();
    const record = this.bodies.get(bodyId);
    if (!record) return false;
    for (const colliderId of record.colliderIds) {
      const collider = this.colliders.get(colliderId);
      if (collider) this.colliderIdsByHandle.delete(collider.collider.handle);
      this.colliders.delete(colliderId);
    }
    this.bodyIdsByHandle.delete(record.body.handle);
    world.removeRigidBody(record.body);
    this.bodies.delete(bodyId);
    this.bodyDefinitions.delete(bodyId);
    return true;
  }

  /** Restore every registered body to its serialized initial definition. */
  reset(definitions?: readonly PhysicsRigidBodyDefinition[]) {
    this.requireWorld();
    const nextDefinitions = definitions
      ? definitions.map(cloneBodyDefinition)
      : [...this.bodyDefinitions.values()].map(cloneBodyDefinition);
    const errors = validatePhysicsBodies(nextDefinitions);
    if (errors.length > 0) throw new TypeError(`Invalid physics bodies:\n${errors.join('\n')}`);

    this.bodyDefinitions.clear();
    for (const definition of nextDefinitions) this.bodyDefinitions.set(definition.id, definition);
    this.freeRuntimeResources();
    this.createRuntimeResources();
    for (const definition of this.bodyDefinitions.values()) this.createBodyRuntime(definition);
    this.accumulatorValue = 0;
    this.totalStepsValue = 0;
    this.lastSubStepsValue = 0;
    this.droppedTimeValue = 0;
    this.droppedCollisionEventsValue = 0;
    this.clearCollisionEvents();
  }

  /** Advance using fixed 1/60 steps and return the number of substeps run. */
  step(deltaSeconds: number): number {
    const world = this.requireWorld();
    const eventQueue = this.eventQueue!;
    if (!isFiniteNumber(deltaSeconds) || deltaSeconds < 0) throw new TypeError('Physics delta must be finite and non-negative.');

    const clampedDelta = Math.min(deltaSeconds, this.maxFrameDelta);
    this.droppedTimeValue += deltaSeconds - clampedDelta;
    this.accumulatorValue += clampedDelta;
    let subSteps = 0;
    while (this.accumulatorValue + Number.EPSILON >= PHYSICS_FIXED_DELTA && subSteps < this.maxSubSteps) {
      world.timestep = PHYSICS_FIXED_DELTA;
      world.step(eventQueue);
      this.totalStepsValue += 1;
      eventQueue.drainCollisionEvents(this.captureCollisionEvent);
      this.accumulatorValue -= PHYSICS_FIXED_DELTA;
      subSteps += 1;
    }
    if (this.accumulatorValue >= PHYSICS_FIXED_DELTA) {
      const retained = this.accumulatorValue % PHYSICS_FIXED_DELTA;
      this.droppedTimeValue += this.accumulatorValue - retained;
      this.accumulatorValue = retained;
    }
    this.lastSubStepsValue = subSteps;
    return subSteps;
  }

  collisionEventAt(index: number): Readonly<PhysicsCollisionEvent> | undefined {
    return index >= 0 && index < this.collisionEventCountValue ? this.collisionEvents[index] : undefined;
  }

  drainCollisionEvents(listener: (event: Readonly<PhysicsCollisionEvent>) => void): number {
    const count = this.collisionEventCountValue;
    for (let index = 0; index < count; index += 1) listener(this.collisionEvents[index]);
    this.collisionEventCountValue = 0;
    return count;
  }

  clearCollisionEvents() {
    this.collisionEventCountValue = 0;
    this.eventQueue?.clear();
  }

  getBodyTransform(bodyId: string, target?: PhysicsTransform): PhysicsTransform | null {
    const record = this.bodies.get(bodyId);
    if (!record) return null;
    const result = target ?? { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const position = record.body.translation();
    const rotation = record.body.rotation();
    result.position[0] = position.x;
    result.position[1] = position.y;
    result.position[2] = position.z;
    result.rotation[0] = rotation.x;
    result.rotation[1] = rotation.y;
    result.rotation[2] = rotation.z;
    result.rotation[3] = rotation.w;
    return result;
  }

  setBodyTranslation(bodyId: string, position: PhysicsVector3, wakeUp = true): boolean {
    const body = this.bodies.get(bodyId)?.body;
    if (!body) return false;
    body.setTranslation(vectorObject(position), wakeUp);
    return true;
  }

  setBodyRotation(bodyId: string, rotation: PhysicsQuaternion, wakeUp = true): boolean {
    const body = this.bodies.get(bodyId)?.body;
    if (!body) return false;
    body.setRotation(normalizedQuaternion(rotation), wakeUp);
    return true;
  }

  setLinearVelocity(bodyId: string, velocity: PhysicsVector3, wakeUp = true): boolean {
    const body = this.bodies.get(bodyId)?.body;
    if (!body) return false;
    body.setLinvel(vectorObject(velocity), wakeUp);
    return true;
  }

  applyImpulse(bodyId: string, impulse: PhysicsVector3, wakeUp = true): boolean {
    const body = this.bodies.get(bodyId)?.body;
    if (!body) return false;
    body.applyImpulse(vectorObject(impulse), wakeUp);
    return true;
  }

  setKinematicTarget(bodyId: string, position: PhysicsVector3, rotation?: PhysicsQuaternion): boolean {
    const body = this.bodies.get(bodyId)?.body;
    if (!body) return false;
    body.setNextKinematicTranslation(vectorObject(position));
    if (rotation) body.setNextKinematicRotation(normalizedQuaternion(rotation));
    return true;
  }

  setGravity(gravity: PhysicsVector3) {
    const world = this.requireWorld();
    if (!gravity.every(isFiniteNumber)) throw new TypeError('Physics gravity must contain three finite numbers.');
    this.gravity = [...gravity] as PhysicsVector3;
    world.gravity = vectorObject(this.gravity);
  }

  getDiagnostics(): PhysicsWorldDiagnostics {
    let sensorCount = 0;
    let ccdBodyCount = 0;
    for (const collider of this.colliders.values()) if (collider.sensor) sensorCount += 1;
    for (const definition of this.bodyDefinitions.values()) if (definition.ccd) ccdBodyCount += 1;
    return {
      initialized: this.world !== null,
      disposed: this.disposedValue,
      engine: 'rapier',
      fixedDelta: PHYSICS_FIXED_DELTA,
      maxFrameDelta: this.maxFrameDelta,
      maxSubSteps: this.maxSubSteps,
      lastSubSteps: this.lastSubStepsValue,
      totalSteps: this.totalStepsValue,
      accumulator: this.accumulatorValue,
      interpolationAlpha: this.interpolationAlpha,
      droppedTime: this.droppedTimeValue,
      bodyCount: this.bodies.size,
      colliderCount: this.colliders.size,
      sensorCount,
      ccdBodyCount,
      collisionEventCount: this.collisionEventCountValue,
      droppedCollisionEvents: this.droppedCollisionEventsValue,
      gravity: [...this.gravity] as PhysicsVector3,
    };
  }

  dispose() {
    if (this.disposedValue) return;
    this.freeRuntimeResources();
    this.bodyDefinitions.clear();
    this.collisionEvents.length = 0;
    this.collisionEventCountValue = 0;
    this.disposedValue = true;
  }

  private async initializeRuntime(): Promise<this> {
    this.rapier = await loadRapier();
    this.assertNotDisposed();
    this.createRuntimeResources();
    try {
      for (const definition of this.bodyDefinitions.values()) this.createBodyRuntime(definition);
    } catch (error) {
      this.freeRuntimeResources();
      throw error;
    }
    return this;
  }

  private createRuntimeResources() {
    if (!this.rapier) throw new Error('Rapier has not been initialized.');
    this.world = new this.rapier.World(vectorObject(this.gravity));
    this.world.timestep = PHYSICS_FIXED_DELTA;
    this.eventQueue = new this.rapier.EventQueue(true);
    this.bodies.clear();
    this.bodyIdsByHandle.clear();
    this.colliders.clear();
    this.colliderIdsByHandle.clear();
  }

  private freeRuntimeResources() {
    this.eventQueue?.free();
    this.world?.free();
    this.eventQueue = null;
    this.world = null;
    this.bodies.clear();
    this.bodyIdsByHandle.clear();
    this.colliders.clear();
    this.colliderIdsByHandle.clear();
  }

  private createBodyRuntime(definition: PhysicsRigidBodyDefinition) {
    const world = this.requireWorld();
    const rapier = this.rapier!;
    let descriptor;
    if (definition.type === 'fixed') descriptor = rapier.RigidBodyDesc.fixed();
    else if (definition.type === 'kinematicPosition') descriptor = rapier.RigidBodyDesc.kinematicPositionBased();
    else if (definition.type === 'kinematicVelocity') descriptor = rapier.RigidBodyDesc.kinematicVelocityBased();
    else descriptor = rapier.RigidBodyDesc.dynamic();

    const position = definition.position ?? [0, 0, 0];
    descriptor.setTranslation(position[0], position[1], position[2]);
    descriptor.setRotation(normalizedQuaternion(definition.rotation));
    descriptor.setEnabled(definition.enabled ?? true);
    descriptor.setGravityScale(definition.gravityScale ?? 1);
    descriptor.setLinearDamping(definition.linearDamping ?? 0);
    descriptor.setAngularDamping(definition.angularDamping ?? 0);
    descriptor.setCanSleep(definition.canSleep ?? true);
    descriptor.setCcdEnabled(definition.ccd ?? false);
    descriptor.setUserData({ id: definition.id });
    if (definition.linearVelocity) descriptor.setLinvel(...definition.linearVelocity);
    if (definition.angularVelocity) descriptor.setAngvel(vectorObject(definition.angularVelocity));

    const body = world.createRigidBody(descriptor);
    const colliderIds: string[] = [];
    try {
      for (const definitionCollider of definition.colliders) {
        const colliderDescriptor = this.createColliderDescriptor(definitionCollider);
        const collider = world.createCollider(colliderDescriptor, body);
        colliderIds.push(definitionCollider.id);
        this.colliders.set(definitionCollider.id, {
          collider,
          bodyId: definition.id,
          sensor: definitionCollider.sensor ?? false,
        });
        this.colliderIdsByHandle.set(collider.handle, definitionCollider.id);
      }
    } catch (error) {
      for (const colliderId of colliderIds) {
        const collider = this.colliders.get(colliderId);
        if (collider) this.colliderIdsByHandle.delete(collider.collider.handle);
        this.colliders.delete(colliderId);
      }
      world.removeRigidBody(body);
      throw error;
    }
    this.bodies.set(definition.id, { body, colliderIds });
    this.bodyIdsByHandle.set(body.handle, definition.id);
  }

  private createColliderDescriptor(definition: PhysicsColliderDefinition) {
    const rapier = this.rapier!;
    const shape = definition.shape;
    let descriptor;
    if (shape.type === 'box') descriptor = rapier.ColliderDesc.cuboid(...shape.halfExtents);
    else if (shape.type === 'sphere') descriptor = rapier.ColliderDesc.ball(shape.radius);
    else if (shape.type === 'capsule') descriptor = rapier.ColliderDesc.capsule(shape.halfHeight, shape.radius);
    else if (shape.type === 'cylinder') descriptor = rapier.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
    else descriptor = rapier.ColliderDesc.cone(shape.halfHeight, shape.radius);

    const position = definition.position ?? [0, 0, 0];
    descriptor.setTranslation(position[0], position[1], position[2]);
    descriptor.setRotation(normalizedQuaternion(definition.rotation));
    descriptor.setSensor(definition.sensor ?? false);
    descriptor.setFriction(definition.friction ?? 0.5);
    descriptor.setRestitution(definition.restitution ?? 0);
    descriptor.setDensity(definition.density ?? 1);
    if (definition.collisionGroups) descriptor.setCollisionGroups(packCollisionGroups(definition.collisionGroups));
    if (definition.solverGroups) descriptor.setSolverGroups(packCollisionGroups(definition.solverGroups));
    if (definition.emitCollisionEvents !== false) descriptor.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
    return descriptor;
  }

  private readonly captureCollisionEvent = (handleA: ColliderHandle, handleB: ColliderHandle, started: boolean) => {
    const colliderAId = this.colliderIdsByHandle.get(handleA);
    const colliderBId = this.colliderIdsByHandle.get(handleB);
    if (!colliderAId || !colliderBId) return;
    if (this.collisionEventCountValue >= this.maxCollisionEvents) {
      this.droppedCollisionEventsValue += 1;
      return;
    }
    const colliderA = this.colliders.get(colliderAId)!;
    const colliderB = this.colliders.get(colliderBId)!;
    let event = this.collisionEvents[this.collisionEventCountValue];
    if (!event) {
      event = {
        colliderAId: '',
        colliderBId: '',
        bodyAId: null,
        bodyBId: null,
        started: false,
        sensor: false,
        step: 0,
      };
      this.collisionEvents.push(event);
    }
    event.colliderAId = colliderAId;
    event.colliderBId = colliderBId;
    event.bodyAId = colliderA.bodyId;
    event.bodyBId = colliderB.bodyId;
    event.started = started;
    event.sensor = colliderA.sensor || colliderB.sensor;
    event.step = this.totalStepsValue;
    this.collisionEventCountValue += 1;
  };

  private requireWorld(): World {
    this.assertNotDisposed();
    if (!this.world) throw new Error('PhysicsWorld is not initialized. Await initialize() before using it.');
    return this.world;
  }

  private assertNotDisposed() {
    if (this.disposedValue) throw new Error('PhysicsWorld has been disposed.');
  }
}
