/**
 * Canonical authored-script contract.
 *
 * Runtime-facing TypeScript types, Monaco's ambient declaration, esbuild's
 * allowlisted runtime shim, and starter sources all originate here so the
 * public module name and context shape cannot drift independently.
 */
export const STUDIO_SDK_MODULE_ID = '@threejs-studio/sdk' as const;
export const STUDIO_SDK_DECLARATION_URI = 'file:///node_modules/@threejs-studio/sdk/index.d.ts' as const;
export const BEHAVIOR_API_VERSION = 1 as const;

export type SerializablePrimitive = null | boolean | number | string;
export type SerializableValue =
  | SerializablePrimitive
  | SerializableValue[]
  | { [key: string]: SerializableValue };

/**
 * Resource limits applied while accepting data across the authored-script
 * boundary. Keeping these limits explicit prevents otherwise-valid JSON from
 * exhausting the editor through excessive depth, breadth, or string data.
 */
export interface SerializableValueLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_SERIALIZABLE_VALUE_LIMITS: Readonly<SerializableValueLimits> = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxStringBytes: 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
});

export type SerializableValueDiagnosticCode =
  | 'SERIALIZABLE_INVALID_TYPE'
  | 'SERIALIZABLE_NON_FINITE_NUMBER'
  | 'SERIALIZABLE_NON_PLAIN_OBJECT'
  | 'SERIALIZABLE_CYCLE'
  | 'SERIALIZABLE_ARRAY_HOLE'
  | 'SERIALIZABLE_MAX_DEPTH'
  | 'SERIALIZABLE_MAX_NODES'
  | 'SERIALIZABLE_MAX_STRING_BYTES'
  | 'SERIALIZABLE_MAX_TOTAL_BYTES'
  | 'SERIALIZABLE_ACCESS_ERROR';

export interface SerializableValueDiagnostic {
  readonly code: SerializableValueDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export type SerializableValueValidationResult =
  | Readonly<{
    readonly ok: true;
    readonly nodeCount: number;
    readonly totalBytes: number;
  }>
  | Readonly<{
    readonly ok: false;
    readonly nodeCount: number;
    readonly totalBytes: number;
    readonly diagnostic: SerializableValueDiagnostic;
  }>;

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

interface PropertyMetadata {
  readonly label?: string;
  readonly description?: string;
  readonly group?: string;
}

export interface NumberPropertyDefinition extends PropertyMetadata {
  readonly type: 'number';
  readonly default: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface BooleanPropertyDefinition extends PropertyMetadata {
  readonly type: 'boolean';
  readonly default: boolean;
}

export interface StringPropertyDefinition extends PropertyMetadata {
  readonly type: 'string';
  readonly default: string;
  readonly maxLength?: number;
  readonly multiline?: boolean;
}

export interface ColorPropertyDefinition extends PropertyMetadata {
  readonly type: 'color';
  readonly default: string;
}

export interface EnumPropertyDefinition extends PropertyMetadata {
  readonly type: 'enum';
  readonly default: string;
  readonly options: readonly string[];
}

export interface Vec2PropertyDefinition extends PropertyMetadata {
  readonly type: 'vec2';
  readonly default: Vec2;
  readonly min?: number;
  readonly max?: number;
}

export interface Vec3PropertyDefinition extends PropertyMetadata {
  readonly type: 'vec3';
  readonly default: Vec3;
  readonly min?: number;
  readonly max?: number;
}

export interface EntityPropertyDefinition extends PropertyMetadata {
  readonly type: 'entity';
  readonly default: string | null;
}

export interface AssetPropertyDefinition extends PropertyMetadata {
  readonly type: 'asset';
  readonly default: string | null;
  readonly assetKinds?: readonly string[];
}

export type BehaviorPropertyDefinition =
  | NumberPropertyDefinition
  | BooleanPropertyDefinition
  | StringPropertyDefinition
  | ColorPropertyDefinition
  | EnumPropertyDefinition
  | Vec2PropertyDefinition
  | Vec3PropertyDefinition
  | EntityPropertyDefinition
  | AssetPropertyDefinition;

export type BehaviorPropertySchema = Readonly<Record<string, BehaviorPropertyDefinition>>;

export type InferBehaviorProperty<TDefinition extends BehaviorPropertyDefinition> =
  TDefinition extends NumberPropertyDefinition ? number
    : TDefinition extends BooleanPropertyDefinition ? boolean
      : TDefinition extends StringPropertyDefinition | ColorPropertyDefinition | EnumPropertyDefinition ? string
        : TDefinition extends Vec2PropertyDefinition ? Vec2
          : TDefinition extends Vec3PropertyDefinition ? Vec3
            : TDefinition extends EntityPropertyDefinition | AssetPropertyDefinition ? string | null
              : never;

export type InferBehaviorProperties<TSchema extends BehaviorPropertySchema> = Readonly<{
  [TKey in keyof TSchema]: InferBehaviorProperty<TSchema[TKey]>;
}>;

/** Serializable, generation-aware references are the only authored handles. */
export interface EntityHandle {
  readonly kind: 'entity';
  readonly id: string;
  readonly sceneId: string;
  readonly generation: number;
}

export interface ComponentHandle {
  readonly kind: 'component';
  readonly id: string;
  readonly entityId: string;
  readonly generation: number;
}

export interface AssetHandle {
  readonly kind: 'asset';
  readonly id: string;
  readonly assetKind: string;
  readonly revision: number;
}

export interface TransformSnapshot {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

export interface TransformUpdate {
  readonly position?: Vec3;
  readonly rotation?: Quat;
  readonly scale?: Vec3;
}

export type InputActionValue = boolean | number | Vec2;

export interface BehaviorTime {
  readonly tick: number;
  readonly fixedDeltaSeconds: number;
  readonly simulationTimeSeconds: number;
  readonly frameDeltaSeconds: number;
  readonly interpolationAlpha: number;
}

export interface BehaviorActionEvent {
  readonly actionId: string;
  readonly phase: 'started' | 'performed' | 'cancelled';
  readonly value: InputActionValue;
}

export interface BehaviorChannelEvent {
  readonly channelId: string;
  readonly source: EntityHandle | null;
  readonly payload: SerializableValue;
}

export interface BehaviorCollisionEvent {
  readonly other: EntityHandle;
  readonly selfColliderId: string;
  readonly otherColliderId: string;
  readonly sensor: boolean;
  readonly point: Vec3 | null;
  readonly normal: Vec3 | null;
}

export interface BehaviorCommandReceipt {
  readonly commandId: string;
}

export interface BehaviorRuntimeApi {
  readonly input: {
    get(actionId: string): InputActionValue;
  };
  readonly transforms: {
    get(target?: EntityHandle): TransformSnapshot | null;
    set(target: EntityHandle, update: TransformUpdate): BehaviorCommandReceipt;
    translate(target: EntityHandle, delta: Vec3): BehaviorCommandReceipt;
  };
  readonly physics: {
    applyImpulse(target: EntityHandle, impulse: Vec3): BehaviorCommandReceipt;
    setLinearVelocity(target: EntityHandle, velocity: Vec3): BehaviorCommandReceipt;
  };
  readonly variables: {
    get(name: string): SerializableValue | undefined;
    set(name: string, value: SerializableValue): BehaviorCommandReceipt;
  };
  readonly events: {
    emit(channelId: string, payload?: SerializableValue): BehaviorCommandReceipt;
  };
  readonly entities: {
    findById(entityId: string): EntityHandle | null;
    findByTag(tag: string): readonly EntityHandle[];
    spawn(prefabId: string, transform?: TransformUpdate): EntityHandle;
    destroy(target: EntityHandle): BehaviorCommandReceipt;
  };
  readonly timers: {
    after(seconds: number, channelId: string, payload?: SerializableValue): string;
    cancel(timerId: string): BehaviorCommandReceipt;
  };
  readonly ui: {
    setText(elementId: string, text: string): BehaviorCommandReceipt;
    setVisible(elementId: string, visible: boolean): BehaviorCommandReceipt;
    setProgress(elementId: string, value: number): BehaviorCommandReceipt;
  };
  readonly audio: {
    play(cueId: string, options?: Readonly<{ volume?: number; pitch?: number; loop?: boolean }>): BehaviorCommandReceipt;
    stop(playbackId: string): BehaviorCommandReceipt;
  };
  readonly scenes: {
    load(sceneId: string): BehaviorCommandReceipt;
    restart(): BehaviorCommandReceipt;
  };
  readonly log: {
    info(message: string, details?: SerializableValue): void;
    warn(message: string, details?: SerializableValue): void;
    error(message: string, details?: SerializableValue): void;
  };
}

export interface BehaviorContext<TProperties extends Readonly<Record<string, unknown>>> {
  readonly self: EntityHandle;
  readonly component: ComponentHandle;
  readonly properties: TProperties;
  readonly time: BehaviorTime;
  readonly api: BehaviorRuntimeApi;
}

export type BehaviorDestroyReason = 'entity-destroyed' | 'component-disabled' | 'scene-unloaded' | 'runtime-stopped' | 'hot-reload';

export interface BehaviorDefinition<TSchema extends BehaviorPropertySchema = BehaviorPropertySchema> {
  readonly apiVersion?: typeof BEHAVIOR_API_VERSION;
  readonly name?: string;
  readonly description?: string;
  readonly schema: TSchema;
  readonly onStart?: (context: BehaviorContext<InferBehaviorProperties<TSchema>>) => void;
  readonly onFixedUpdate?: (context: BehaviorContext<InferBehaviorProperties<TSchema>>) => void;
  readonly onUpdate?: (context: BehaviorContext<InferBehaviorProperties<TSchema>>) => void;
  readonly onAction?: (
    context: BehaviorContext<InferBehaviorProperties<TSchema>>,
    event: BehaviorActionEvent,
  ) => void;
  readonly onEvent?: (
    context: BehaviorContext<InferBehaviorProperties<TSchema>>,
    event: BehaviorChannelEvent,
  ) => void;
  readonly onCollisionEnter?: (
    context: BehaviorContext<InferBehaviorProperties<TSchema>>,
    event: BehaviorCollisionEvent,
  ) => void;
  readonly onCollisionExit?: (
    context: BehaviorContext<InferBehaviorProperties<TSchema>>,
    event: BehaviorCollisionEvent,
  ) => void;
  readonly onDestroy?: (
    context: BehaviorContext<InferBehaviorProperties<TSchema>>,
    reason: BehaviorDestroyReason,
  ) => void;
}

export interface BehaviorSchemaIssue {
  readonly code:
    | 'INVALID_DEFINITION'
    | 'INVALID_SCHEMA'
    | 'INVALID_PROPERTY_NAME'
    | 'INVALID_PROPERTY_DEFINITION'
    | 'INVALID_DEFAULT'
    | 'INVALID_CONSTRAINT'
    | 'UNSUPPORTED_API_VERSION';
  readonly path: string;
  readonly message: string;
}

/** Runtime source bundled for the compiler's allowlisted virtual SDK module. */
export const STUDIO_SDK_RUNTIME_MODULE_SOURCE = `
export const BEHAVIOR_API_VERSION = ${BEHAVIOR_API_VERSION};
export function defineBehavior(definition) {
  return Object.freeze({ ...definition, apiVersion: BEHAVIOR_API_VERSION });
}
`;

/** Ambient module installed into Monaco's TypeScript worker. */
export const STUDIO_SDK_DECLARATION = `
declare module '${STUDIO_SDK_MODULE_ID}' {
  export const BEHAVIOR_API_VERSION: ${BEHAVIOR_API_VERSION};

  export type SerializablePrimitive = null | boolean | number | string;
  export type SerializableValue =
    | SerializablePrimitive
    | SerializableValue[]
    | { [key: string]: SerializableValue };
  export type Vec2 = readonly [number, number];
  export type Vec3 = readonly [number, number, number];
  export type Quat = readonly [number, number, number, number];

  interface PropertyMetadata {
    readonly label?: string;
    readonly description?: string;
    readonly group?: string;
  }
  export interface NumberPropertyDefinition extends PropertyMetadata {
    readonly type: 'number';
    readonly default: number;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
  }
  export interface BooleanPropertyDefinition extends PropertyMetadata {
    readonly type: 'boolean';
    readonly default: boolean;
  }
  export interface StringPropertyDefinition extends PropertyMetadata {
    readonly type: 'string';
    readonly default: string;
    readonly maxLength?: number;
    readonly multiline?: boolean;
  }
  export interface ColorPropertyDefinition extends PropertyMetadata {
    readonly type: 'color';
    readonly default: string;
  }
  export interface EnumPropertyDefinition extends PropertyMetadata {
    readonly type: 'enum';
    readonly default: string;
    readonly options: readonly string[];
  }
  export interface Vec2PropertyDefinition extends PropertyMetadata {
    readonly type: 'vec2';
    readonly default: Vec2;
    readonly min?: number;
    readonly max?: number;
  }
  export interface Vec3PropertyDefinition extends PropertyMetadata {
    readonly type: 'vec3';
    readonly default: Vec3;
    readonly min?: number;
    readonly max?: number;
  }
  export interface EntityPropertyDefinition extends PropertyMetadata {
    readonly type: 'entity';
    readonly default: string | null;
  }
  export interface AssetPropertyDefinition extends PropertyMetadata {
    readonly type: 'asset';
    readonly default: string | null;
    readonly assetKinds?: readonly string[];
  }
  export type BehaviorPropertyDefinition =
    | NumberPropertyDefinition
    | BooleanPropertyDefinition
    | StringPropertyDefinition
    | ColorPropertyDefinition
    | EnumPropertyDefinition
    | Vec2PropertyDefinition
    | Vec3PropertyDefinition
    | EntityPropertyDefinition
    | AssetPropertyDefinition;
  export type BehaviorPropertySchema = Readonly<Record<string, BehaviorPropertyDefinition>>;
  export type InferBehaviorProperty<TDefinition extends BehaviorPropertyDefinition> =
    TDefinition extends NumberPropertyDefinition ? number
      : TDefinition extends BooleanPropertyDefinition ? boolean
        : TDefinition extends StringPropertyDefinition | ColorPropertyDefinition | EnumPropertyDefinition ? string
          : TDefinition extends Vec2PropertyDefinition ? Vec2
            : TDefinition extends Vec3PropertyDefinition ? Vec3
              : TDefinition extends EntityPropertyDefinition | AssetPropertyDefinition ? string | null
                : never;
  export type InferBehaviorProperties<TSchema extends BehaviorPropertySchema> = Readonly<{
    [TKey in keyof TSchema]: InferBehaviorProperty<TSchema[TKey]>;
  }>;

  export interface EntityHandle {
    readonly kind: 'entity';
    readonly id: string;
    readonly sceneId: string;
    readonly generation: number;
  }
  export interface ComponentHandle {
    readonly kind: 'component';
    readonly id: string;
    readonly entityId: string;
    readonly generation: number;
  }
  export interface AssetHandle {
    readonly kind: 'asset';
    readonly id: string;
    readonly assetKind: string;
    readonly revision: number;
  }
  export interface TransformSnapshot {
    readonly position: Vec3;
    readonly rotation: Quat;
    readonly scale: Vec3;
  }
  export interface TransformUpdate {
    readonly position?: Vec3;
    readonly rotation?: Quat;
    readonly scale?: Vec3;
  }
  export type InputActionValue = boolean | number | Vec2;
  export interface BehaviorTime {
    readonly tick: number;
    readonly fixedDeltaSeconds: number;
    readonly simulationTimeSeconds: number;
    readonly frameDeltaSeconds: number;
    readonly interpolationAlpha: number;
  }
  export interface BehaviorActionEvent {
    readonly actionId: string;
    readonly phase: 'started' | 'performed' | 'cancelled';
    readonly value: InputActionValue;
  }
  export interface BehaviorChannelEvent {
    readonly channelId: string;
    readonly source: EntityHandle | null;
    readonly payload: SerializableValue;
  }
  export interface BehaviorCollisionEvent {
    readonly other: EntityHandle;
    readonly selfColliderId: string;
    readonly otherColliderId: string;
    readonly sensor: boolean;
    readonly point: Vec3 | null;
    readonly normal: Vec3 | null;
  }
  export interface BehaviorCommandReceipt {
    readonly commandId: string;
  }
  export interface BehaviorRuntimeApi {
    readonly input: { get(actionId: string): InputActionValue };
    readonly transforms: {
      get(target?: EntityHandle): TransformSnapshot | null;
      set(target: EntityHandle, update: TransformUpdate): BehaviorCommandReceipt;
      translate(target: EntityHandle, delta: Vec3): BehaviorCommandReceipt;
    };
    readonly physics: {
      applyImpulse(target: EntityHandle, impulse: Vec3): BehaviorCommandReceipt;
      setLinearVelocity(target: EntityHandle, velocity: Vec3): BehaviorCommandReceipt;
    };
    readonly variables: {
      get(name: string): SerializableValue | undefined;
      set(name: string, value: SerializableValue): BehaviorCommandReceipt;
    };
    readonly events: {
      emit(channelId: string, payload?: SerializableValue): BehaviorCommandReceipt;
    };
    readonly entities: {
      findById(entityId: string): EntityHandle | null;
      findByTag(tag: string): readonly EntityHandle[];
      spawn(prefabId: string, transform?: TransformUpdate): EntityHandle;
      destroy(target: EntityHandle): BehaviorCommandReceipt;
    };
    readonly timers: {
      after(seconds: number, channelId: string, payload?: SerializableValue): string;
      cancel(timerId: string): BehaviorCommandReceipt;
    };
    readonly ui: {
      setText(elementId: string, text: string): BehaviorCommandReceipt;
      setVisible(elementId: string, visible: boolean): BehaviorCommandReceipt;
      setProgress(elementId: string, value: number): BehaviorCommandReceipt;
    };
    readonly audio: {
      play(cueId: string, options?: Readonly<{ volume?: number; pitch?: number; loop?: boolean }>): BehaviorCommandReceipt;
      stop(playbackId: string): BehaviorCommandReceipt;
    };
    readonly scenes: {
      load(sceneId: string): BehaviorCommandReceipt;
      restart(): BehaviorCommandReceipt;
    };
    readonly log: {
      info(message: string, details?: SerializableValue): void;
      warn(message: string, details?: SerializableValue): void;
      error(message: string, details?: SerializableValue): void;
    };
  }
  export interface BehaviorContext<TProperties extends Readonly<Record<string, unknown>>> {
    readonly self: EntityHandle;
    readonly component: ComponentHandle;
    readonly properties: TProperties;
    readonly time: BehaviorTime;
    readonly api: BehaviorRuntimeApi;
  }
  export type BehaviorDestroyReason =
    | 'entity-destroyed'
    | 'component-disabled'
    | 'scene-unloaded'
    | 'runtime-stopped'
    | 'hot-reload';
  export interface BehaviorDefinition<TSchema extends BehaviorPropertySchema = BehaviorPropertySchema> {
    readonly apiVersion?: typeof BEHAVIOR_API_VERSION;
    readonly name?: string;
    readonly description?: string;
    readonly schema: TSchema;
    readonly onStart?: (context: BehaviorContext<InferBehaviorProperties<TSchema>>) => void;
    readonly onFixedUpdate?: (context: BehaviorContext<InferBehaviorProperties<TSchema>>) => void;
    readonly onUpdate?: (context: BehaviorContext<InferBehaviorProperties<TSchema>>) => void;
    readonly onAction?: (
      context: BehaviorContext<InferBehaviorProperties<TSchema>>,
      event: BehaviorActionEvent,
    ) => void;
    readonly onEvent?: (
      context: BehaviorContext<InferBehaviorProperties<TSchema>>,
      event: BehaviorChannelEvent,
    ) => void;
    readonly onCollisionEnter?: (
      context: BehaviorContext<InferBehaviorProperties<TSchema>>,
      event: BehaviorCollisionEvent,
    ) => void;
    readonly onCollisionExit?: (
      context: BehaviorContext<InferBehaviorProperties<TSchema>>,
      event: BehaviorCollisionEvent,
    ) => void;
    readonly onDestroy?: (
      context: BehaviorContext<InferBehaviorProperties<TSchema>>,
      reason: BehaviorDestroyReason,
    ) => void;
  }

  export function defineBehavior<const TSchema extends BehaviorPropertySchema>(
    definition: BehaviorDefinition<TSchema>,
  ): Readonly<BehaviorDefinition<TSchema>>;
}
`;

/** Exact source used whenever the editor creates a new behavior. */
export const DEFAULT_BEHAVIOR_SOURCE = `import { defineBehavior } from '${STUDIO_SDK_MODULE_ID}';

export default defineBehavior({
  name: 'New Behavior',
  schema: {},
  onStart(ctx) {
    ctx.api.log.info('Behavior started', { entityId: ctx.self.id });
  },
  onFixedUpdate(_ctx) {},
});
`;
