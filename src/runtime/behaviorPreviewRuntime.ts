import type { ProjectDocumentV5 } from '../editor/types';
import type { SerializableValue } from '../scripting/sdk';

export interface CompiledBehaviorPreview {
  moduleCode: string;
  contentHash: string;
  projectRevision: number;
}

interface BehaviorPreviewSnapshot {
  self: { id: string; sceneId: string; generation: number };
  component: { id: string; entityId: string; generation: number };
  properties: Record<string, SerializableValue>;
  variables: Record<string, SerializableValue>;
  entities: Array<{
    id: string;
    sceneId: string;
    generation: number;
    tags: string[];
    transform: {
      position: [number, number, number];
      rotation: [number, number, number, number];
      scale: [number, number, number];
    };
  }>;
  input: Record<string, boolean | number | [number, number]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function quaternionFromEuler([x, y, z]: [number, number, number]): [number, number, number, number] {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

export function createBehaviorPreviewSnapshot(
  project: ProjectDocumentV5 | Record<string, unknown>,
): BehaviorPreviewSnapshot {
  const record = project as Record<string, unknown>;
  const assets = Array.isArray(record.assets) ? record.assets as ProjectDocumentV5['assets'] : [];
  const entities = Array.isArray(record.entities) ? record.entities as ProjectDocumentV5['entities'] : [];
  const variables = Array.isArray(record.variables) ? record.variables as ProjectDocumentV5['variables'] : [];
  const startupSceneId = typeof record.startupSceneId === 'string' ? record.startupSceneId : 'scene.runtime';
  type DataAsset = Extract<ProjectDocumentV5['assets'][number], { kind: 'data' }>;
  const runtimeAsset = assets.find((asset) => (
    asset.kind === 'data'
    && isRecord(asset.value)
    && asset.value.format === 'threejs-studio.runtime-bindings.v1'
  )) as DataAsset | undefined;
  const bindings = runtimeAsset && isRecord(runtimeAsset.value) && Array.isArray(runtimeAsset.value.componentBindings)
    ? runtimeAsset.value.componentBindings
    : [];
  const scriptBinding = bindings.find((binding: unknown) => isRecord(binding) && binding.type === 'scriptBehavior');
  const entityId = isRecord(scriptBinding) && typeof scriptBinding.entityId === 'string'
    ? scriptBinding.entityId
    : entities[0]?.id ?? 'entity.runtime';
  const entity = entities.find((entry) => entry.id === entityId) ?? entities[0];
  const sceneId = entity?.sceneId ?? startupSceneId;
  const properties = isRecord(scriptBinding) && isRecord(scriptBinding.properties)
    ? structuredClone(scriptBinding.properties) as Record<string, SerializableValue>
    : {};

  return {
    self: { id: entityId, sceneId, generation: 0 },
    component: {
      id: isRecord(scriptBinding) && typeof scriptBinding.id === 'string'
        ? scriptBinding.id
        : 'component.authored-behavior',
      entityId,
      generation: 0,
    },
    properties,
    variables: Object.fromEntries(variables.map((variable) => [
      variable.id,
      structuredClone(variable.defaultValue) as SerializableValue,
    ])),
    entities: entities.map((entry) => ({
      id: entry.id,
      sceneId: entry.sceneId,
      generation: 0,
      tags: [...entry.tags],
      transform: {
        position: [...entry.transform.position],
        rotation: quaternionFromEuler(entry.transform.rotation),
        scale: [...entry.transform.scale],
      },
    })),
    input: {},
  };
}

function authoredBehaviorWorker() {
  const post = Function.prototype.call.bind(MessagePort.prototype.postMessage);
  const addPortListener = Function.prototype.call.bind(MessagePort.prototype.addEventListener);
  const startPort = Function.prototype.call.bind(MessagePort.prototype.start);
  const closePort = Function.prototype.call.bind(MessagePort.prototype.close);
  const objectKeys = Object.keys.bind(Object);
  const objectEntries = Object.entries.bind(Object);
  const defineProperty = Object.defineProperty.bind(Object);
  const getPrototypeOf = Object.getPrototypeOf.bind(Object);
  const plainObjectPrototype = Object.prototype;
  const hasOwn = Object.hasOwn.bind(Object);
  const freeze = Object.freeze.bind(Object);
  const fromEntries = Object.fromEntries.bind(Object);
  const arrayIsArray = Array.isArray.bind(Array);
  const arrayMap = Function.prototype.call.bind(Array.prototype.map);
  const arraySort = Function.prototype.call.bind(Array.prototype.sort);
  const arrayPush = Function.prototype.call.bind(Array.prototype.push);
  const arrayShift = Function.prototype.call.bind(Array.prototype.shift);
  const arrayFind = Function.prototype.call.bind(Array.prototype.find);
  const arrayFilter = Function.prototype.call.bind(Array.prototype.filter);
  const arrayIncludes = Function.prototype.call.bind(Array.prototype.includes);
  const stringSlice = Function.prototype.call.bind(String.prototype.slice);
  const toNumber = Number;
  const numberIsFinite = Number.isFinite.bind(Number);
  const objectIs = Object.is.bind(Object);
  const toString = String;
  const mathMax = Math.max.bind(Math);
  const parse = JSON.parse.bind(JSON);
  const stringify = JSON.stringify.bind(JSON);
  const createUrl = URL.createObjectURL.bind(URL);
  const revokeUrl = URL.revokeObjectURL.bind(URL);
  const setTimer = globalThis.setInterval.bind(globalThis);
  const clearTimer = globalThis.clearInterval.bind(globalThis);
  const now = performance.now.bind(performance);
  const closeWorker = globalThis.close.bind(globalThis);
  let trustedPort: MessagePort | null = null;
  let moduleUrl: string | null = null;
  let interval: number | null = null;
  let definition: Record<string, unknown> | null = null;
  let status = 'idle';
  let tick = 0;
  let totalDurationMs = 0;
  let lastDurationMs = 0;
  let variables: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let initialVariables: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let commandSequence = 0;
  let timerSequence = 0;
  let context: Record<string, unknown> | null = null;

  const safeMessage = (error: unknown, fallback: string) => {
    try {
      return stringSlice((
        typeof error === 'object'
        && error !== null
        && typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : fallback
      ), 0, 4096);
    } catch {
      return fallback;
    }
  };

  const cloneSerializable = (value: unknown) => {
    const active = new Set<object>();
    let nodes = 0;
    const visit = (entry: unknown, depth: number): unknown => {
      nodes += 1;
      if (nodes > 20_000 || depth > 32) throw new TypeError('Behavior value exceeds sandbox limits.');
      if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return entry;
      if (typeof entry === 'number') {
        if (!numberIsFinite(entry)) throw new TypeError('Behavior numbers must be finite.');
        return objectIs(entry, -0) ? 0 : entry;
      }
      if (typeof entry !== 'object') throw new TypeError('Behavior values must be serializable.');
      if (active.has(entry)) throw new TypeError('Behavior values cannot contain cycles.');
      const prototype = getPrototypeOf(entry);
      if (!arrayIsArray(entry) && prototype !== plainObjectPrototype && prototype !== null) {
        throw new TypeError('Behavior values must contain only plain objects and arrays.');
      }
      active.add(entry);
      let result: unknown;
      if (arrayIsArray(entry)) {
        result = arrayMap(entry, (child: unknown, index: number) => {
          if (!hasOwn(entry, index)) throw new TypeError('Behavior arrays cannot be sparse.');
          return visit(child, depth + 1);
        });
      } else {
        result = fromEntries(arrayMap(objectEntries(entry), ([key, child]: [string, unknown]) => [
          key,
          visit(child, depth + 1),
        ]));
      }
      active.delete(entry);
      return result;
    };
    return visit(value, 0);
  };

  const receipt = () => freeze({ commandId: `behavior-command-${++commandSequence}` });
  const command = (type: string, payload: unknown = null) => {
    const record = receipt();
    const commands = (snapshot.commands ??= []) as unknown[];
    if (commands.length >= 2_048) arrayShift(commands);
    arrayPush(commands, { commandId: record.commandId, type, payload: cloneSerializable(payload) });
    return record;
  };
  const entities = () => arrayIsArray(snapshot.entities) ? snapshot.entities as Array<Record<string, unknown>> : [];
  const entityHandle = (entity: Record<string, unknown>) => freeze({
    id: toString(entity.id),
    sceneId: toString(entity.sceneId),
    generation: toNumber(entity.generation ?? 0),
  });
  const findEntity = (id: string) => arrayFind(
    entities(),
    (entity: Record<string, unknown>) => entity.id === id,
  ) as Record<string, unknown> | undefined;
  const time = {
    fixedDeltaSeconds: 1 / 60,
    deltaSeconds: 1 / 60,
    elapsedSeconds: 0,
    tick: 0,
    frame: 0,
  };

  const api = freeze({
    input: freeze({
      get: (actionId: string) => cloneSerializable(
        isRecord(snapshot.input) && hasOwn(snapshot.input, actionId)
          ? (snapshot.input as Record<string, unknown>)[actionId]
          : [0, 0],
      ),
    }),
    transforms: freeze({
      get: (target?: { id?: unknown }) => {
        const entity = findEntity(toString(target?.id ?? (snapshot.self as Record<string, unknown>)?.id ?? ''));
        return entity && isRecord(entity.transform) ? cloneSerializable(entity.transform) : null;
      },
      set: (target: { id?: unknown }, update: unknown) => command('transforms.set', { entityId: toString(target.id), update }),
      translate: (target: { id?: unknown }, delta: unknown) => command('transforms.translate', { entityId: toString(target.id), delta }),
    }),
    physics: freeze({
      applyImpulse: (target: { id?: unknown }, impulse: unknown) => command('physics.applyImpulse', { entityId: toString(target.id), impulse }),
      setLinearVelocity: (target: { id?: unknown }, velocity: unknown) => command('physics.setLinearVelocity', { entityId: toString(target.id), velocity }),
    }),
    variables: freeze({
      get: (name: string) => hasOwn(variables, name) ? cloneSerializable(variables[name]) : undefined,
      set: (name: string, value: unknown) => {
        variables[name] = cloneSerializable(value);
        return receipt();
      },
    }),
    events: freeze({
      emit: (channelId: string, payload: unknown = null) => command('events.emit', { channelId, payload }),
    }),
    entities: freeze({
      findById: (id: string) => {
        const entity = findEntity(id);
        return entity ? entityHandle(entity) : null;
      },
      findByTag: (tag: string) => arrayMap(
        arrayFilter(
          entities(),
          (entity: Record<string, unknown>) => (
            arrayIsArray(entity.tags) && arrayIncludes(entity.tags, tag)
          ),
        ),
        entityHandle,
      ),
      spawn: (prefabId: string, transform?: unknown) => {
        const id = `runtime-entity-${++commandSequence}`;
        command('entities.spawn', { id, prefabId, transform: transform ?? null });
        return freeze({ id, sceneId: toString((snapshot.self as Record<string, unknown>)?.sceneId ?? ''), generation: 0 });
      },
      destroy: (target: { id?: unknown }) => command('entities.destroy', { entityId: toString(target.id) }),
    }),
    timers: freeze({
      after: (seconds: number, channelId: string, payload: unknown = null) => {
        const timerId = `behavior-timer-${++timerSequence}`;
        command('timers.after', { timerId, seconds, channelId, payload });
        return timerId;
      },
      cancel: (timerId: string) => command('timers.cancel', { timerId }),
    }),
    ui: freeze({
      setText: (elementId: string, text: string) => command('ui.setText', { elementId, text }),
      setVisible: (elementId: string, visible: boolean) => command('ui.setVisible', { elementId, visible }),
      setProgress: (elementId: string, value: number) => command('ui.setProgress', { elementId, value }),
    }),
    audio: freeze({
      play: (cueId: string, options: unknown = null) => command('audio.play', { cueId, options }),
      stop: (playbackId: string) => command('audio.stop', { playbackId }),
    }),
    scenes: freeze({
      load: (sceneId: string) => command('scenes.load', { sceneId }),
      restart: () => command('scenes.restart'),
    }),
    log: freeze({
      info: (message: string, details: unknown = null) => command('log.info', { message, details }),
      warn: (message: string, details: unknown = null) => command('log.warn', { message, details }),
      error: (message: string, details: unknown = null) => command('log.error', { message, details }),
    }),
  });

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !arrayIsArray(value);
  }

  const updateContext = () => {
    time.tick = tick;
    time.frame = tick;
    time.elapsedSeconds = tick / 60;
  };
  const invoke = (hookName: string, ...args: unknown[]) => {
    const hook = definition?.[hookName];
    if (typeof hook !== 'function') return;
    const started = now();
    const result = hook(context, ...args);
    lastDurationMs = mathMax(0, now() - started);
    totalDurationMs += lastDurationMs;
    if (result !== undefined) {
      let thenable = false;
      try {
        thenable = result !== null
          && (typeof result === 'object' || typeof result === 'function')
          && typeof (result as { then?: unknown }).then === 'function';
      } catch {
        thenable = true;
      }
      if (thenable) throw new TypeError('Behavior hooks must be synchronous.');
    }
  };
  const fixedUpdate = () => {
    if (status !== 'running' && status !== 'paused') return;
    tick += 1;
    updateContext();
    invoke('onFixedUpdate');
    invoke('onUpdate');
    if (trustedPort && tick % 6 === 0) {
      post(trustedPort, { type: 'worker.diagnostics', value: state() });
    }
  };
  const stopInterval = () => {
    if (interval !== null) clearTimer(interval);
    interval = null;
  };
  const startInterval = () => {
    stopInterval();
    interval = setTimer(() => {
      try {
        fixedUpdate();
      } catch (error) {
        status = 'failed';
        stopInterval();
        if (trustedPort) post(trustedPort, { type: 'worker.fatal', payload: {
          code: 'BEHAVIOR_HOOK_FAILED',
          message: safeMessage(error, 'Behavior update failed.'),
        } });
      }
    }, 1000 / 60) as unknown as number;
  };
  const state = () => ({
    status,
    tick,
    variables: cloneSerializable(variables),
    commands: cloneSerializable(snapshot.commands ?? []),
    lastDurationMs,
    totalDurationMs,
  });
  const control = (action: string) => {
    if (action === 'start') {
      if (status !== 'idle') throw new Error('Authored behavior can only start while idle.');
      status = 'running';
      invoke('onStart');
      startInterval();
    } else if (action === 'pause') {
      if (status !== 'running') throw new Error('Authored behavior can only pause while running.');
      status = 'paused';
      stopInterval();
    } else if (action === 'resume') {
      if (status !== 'paused') throw new Error('Authored behavior can only resume while paused.');
      status = 'running';
      startInterval();
    } else if (action === 'step') {
      if (status !== 'paused') throw new Error('Authored behavior can only step while paused.');
      fixedUpdate();
    } else if (action === 'restart') {
      stopInterval();
      if (status !== 'idle') invoke('onDestroy', 'hot-reload');
      variables = parse(stringify(initialVariables));
      snapshot.commands = [];
      tick = 0;
      status = 'running';
      updateContext();
      invoke('onStart');
      startInterval();
    } else if (action === 'dispose') {
      stopInterval();
      if (status !== 'disposed' && status !== 'idle') invoke('onDestroy', 'runtime-stopped');
      status = 'disposed';
    } else {
      throw new Error(`Unsupported authored behavior control "${action}".`);
    }
    return state();
  };
  const cleanup = () => {
    stopInterval();
    if (moduleUrl) revokeUrl(moduleUrl);
    moduleUrl = null;
    if (trustedPort) closePort(trustedPort);
    trustedPort = null;
  };

  const connect = (event: MessageEvent<Record<string, unknown>>) => {
    const message = event.data;
    const port = event.ports[0];
    if (trustedPort || !port || !isRecord(message) || message.type !== 'initialize' || typeof message.moduleCode !== 'string') return;
    trustedPort = port;
    snapshot = isRecord(message.snapshot) ? message.snapshot : {};
    snapshot.commands = [];
    initialVariables = isRecord(snapshot.variables) ? cloneSerializable(snapshot.variables) as Record<string, unknown> : {};
    variables = parse(stringify(initialVariables));
    const suppliedProperties = isRecord(snapshot.properties) ? snapshot.properties : {};
    const self = isRecord(snapshot.self) ? freeze(cloneSerializable(snapshot.self)) : freeze({ id: 'entity.runtime', sceneId: '', generation: 0 });
    const component = isRecord(snapshot.component)
      ? freeze(cloneSerializable(snapshot.component))
      : freeze({ id: 'component.authored-behavior', entityId: toString((self as Record<string, unknown>).id), generation: 0 });
    addPortListener(trustedPort, 'message', ((portEvent: MessageEvent<Record<string, unknown>>) => {
      const request = portEvent.data;
      if (!isRecord(request) || typeof request.requestId !== 'string' || typeof request.action !== 'string') return;
      try {
        const value = control(request.action);
        post(trustedPort!, { type: 'worker.result', requestId: request.requestId, value });
        if (request.action === 'dispose') {
          cleanup();
          closeWorker();
        }
      } catch (error) {
        status = 'failed';
        stopInterval();
        post(trustedPort!, {
          type: 'worker.error',
          requestId: request.requestId,
          code: 'BEHAVIOR_HOOK_FAILED',
          message: safeMessage(error, 'Behavior hook failed.'),
        });
      }
    }) as EventListener);
    startPort(trustedPort);
    moduleUrl = createUrl(new Blob([message.moduleCode], { type: 'text/javascript' }));
    void globalThis.__THREEJS_STUDIO_DYNAMIC_IMPORT__!(moduleUrl).then((moduleValue: Record<string, unknown>) => {
      definition = isRecord(moduleValue.default) ? moduleValue.default : null;
      if (!definition) throw new TypeError('Authored behavior module must export a default behavior definition.');
      const defaults = isRecord(definition.schema)
        ? fromEntries(arrayMap(objectEntries(definition.schema), ([key, descriptor]: [string, unknown]) => [
          key,
          isRecord(descriptor) ? cloneSerializable(descriptor.default) : null,
        ]))
        : {};
      properties = { ...defaults, ...cloneSerializable(suppliedProperties) as Record<string, unknown> };
      const contextValue: Record<string, unknown> = {
        self,
        component,
        properties: freeze(properties),
        api,
      };
      defineProperty(contextValue, 'time', {
        enumerable: true,
        configurable: false,
        get: () => freeze({ ...time }),
      });
      context = freeze(contextValue);
      post(trustedPort!, {
        type: 'worker.ready',
        exports: arraySort(objectKeys(moduleValue)),
        behaviorName: typeof definition.name === 'string' ? definition.name : 'Authored Behavior',
      });
    }).catch((error: unknown) => {
      status = 'failed';
      post(trustedPort!, {
        type: 'worker.fatal',
        payload: { code: 'MODULE_LOAD_FAILED', message: safeMessage(error, 'Behavior module failed to load.') },
      });
    });
    globalThis.removeEventListener('message', connect);
  };

  globalThis.addEventListener('message', connect);
}

function authoredBehaviorPreviewBootstrap(configuration: {
  moduleCode: string;
  contentHash: string;
  projectRevision: number;
  snapshot: BehaviorPreviewSnapshot;
  workerSource: string;
}) {
  const createUrl = URL.createObjectURL.bind(URL);
  const revokeUrl = URL.revokeObjectURL.bind(URL);
  const baseDiagnostics = (identity: { sessionId: string; revision: number; buildHash: string }) => ({
    ...identity,
    status: 'idle',
    fixedHz: 60,
    fixedDeltaSeconds: 1 / 60,
    maxCatchUpSteps: 5,
    tick: 0,
    frame: 0,
    restartCount: 0,
    simulationTimeSeconds: 0,
    accumulatorSeconds: 0,
    totalDroppedSeconds: 0,
    catchUpClampCount: 0,
    lastAdvance: { frameDeltaSeconds: 0, fixedSteps: 0, droppedSeconds: 0, interpolationAlpha: 0 },
    systems: [{
      id: 'authored-behavior',
      stage: 'scripts-graphs',
      fixedUpdateCalls: 0,
      renderCalls: 0,
      lastDurationMs: 0,
      totalDurationMs: 0,
    }],
    lastFailure: null,
  });

  globalThis.__THREEJS_STUDIO_PREVIEW_RUNTIME_FACTORY__ = async (
    identity: { sessionId: string; revision: number; buildHash: string },
  ) => {
    if (identity.revision !== configuration.projectRevision || identity.buildHash !== configuration.contentHash) {
      throw new Error('Authored behavior identity does not match the compiled module.');
    }
    const workerUrl = createUrl(new Blob([
      `(${configuration.workerSource})()`,
    ], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl, { name: 'threejs-studio-authored-behavior' });
    const channel = new MessageChannel();
    const pending = new Map<string, {
      resolve(value: Record<string, unknown>): void;
      reject(error: Error): void;
    }>();
    let requestSequence = 0;
    let diagnostics = baseDiagnostics(identity);
    let restartCount = 0;
    let fatalError: Error | null = null;
    const diagnosticsListeners = new Set<(value: Record<string, unknown>) => void>();

    const applyWorkerState = (value: Record<string, unknown>, action?: string) => {
      if (action === 'restart') restartCount += 1;
      const tick = typeof value.tick === 'number' ? value.tick : diagnostics.tick;
      const status = typeof value.status === 'string' ? value.status : diagnostics.status;
      const lastDurationMs = typeof value.lastDurationMs === 'number' ? value.lastDurationMs : 0;
      const totalDurationMs = typeof value.totalDurationMs === 'number' ? value.totalDurationMs : 0;
      diagnostics = {
        ...diagnostics,
        status,
        tick,
        frame: tick,
        restartCount,
        simulationTimeSeconds: tick / 60,
        lastAdvance: {
          frameDeltaSeconds: action === 'step' ? 0 : 1 / 60,
          fixedSteps: action === 'step' ? 1 : 0,
          droppedSeconds: 0,
          interpolationAlpha: 0,
        },
        systems: [{
          id: 'authored-behavior',
          stage: 'scripts-graphs',
          fixedUpdateCalls: tick,
          renderCalls: 0,
          lastDurationMs,
          totalDurationMs,
        }],
      };
      globalThis.__THREEJS_STUDIO_AUTHORED_BEHAVIOR_STATUS__ = {
        ...value,
        contentHash: configuration.contentHash,
      };
      for (const listener of diagnosticsListeners) {
        try {
          listener(diagnostics);
        } catch {
          // Diagnostics observers cannot interrupt authored behavior progress.
        }
      }
      return diagnostics;
    };

    const ready = new Promise<void>((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => reject(new Error('Authored behavior Worker timed out.')), 5_000);
      channel.port1.addEventListener('message', (event: MessageEvent<Record<string, unknown>>) => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'worker.ready') {
          globalThis.clearTimeout(timeout);
          globalThis.__THREEJS_STUDIO_AUTHORED_BEHAVIOR_STATUS__ = {
            status: 'ready',
            exports: message.exports,
            behaviorName: message.behaviorName,
            contentHash: configuration.contentHash,
          };
          resolve();
          return;
        }
        if (message.type === 'worker.fatal') {
          const payload = message.payload as { message?: unknown } | undefined;
          fatalError = new Error(typeof payload?.message === 'string' ? payload.message : 'Authored behavior failed.');
          globalThis.__THREEJS_STUDIO_AUTHORED_BEHAVIOR_STATUS__ = {
            status: 'failed',
            message: fatalError.message,
            contentHash: configuration.contentHash,
          };
          reject(fatalError);
          for (const request of pending.values()) request.reject(fatalError);
          pending.clear();
          return;
        }
        if (message.type === 'worker.diagnostics' && message.value && typeof message.value === 'object') {
          applyWorkerState(message.value as Record<string, unknown>);
          return;
        }
        if (typeof message.requestId !== 'string') return;
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        if (message.type === 'worker.error') {
          request.reject(new Error(typeof message.message === 'string' ? message.message : 'Authored behavior command failed.'));
        } else if (message.type === 'worker.result' && message.value && typeof message.value === 'object') {
          request.resolve(message.value as Record<string, unknown>);
        }
      });
      channel.port1.start();
      worker.addEventListener('error', (event) => {
        globalThis.clearTimeout(timeout);
        reject(new Error(event.message || 'Authored behavior Worker crashed.'));
      }, { once: true });
    });
    worker.postMessage({
      type: 'initialize',
      moduleCode: configuration.moduleCode,
      snapshot: configuration.snapshot,
    }, [channel.port2]);
    await ready;

    const command = async (action: string) => {
      if (fatalError) throw fatalError;
      const requestId = `behavior-${++requestSequence}`;
      const value = await new Promise<Record<string, unknown>>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        channel.port1.postMessage({ requestId, action });
      });
      const updatedDiagnostics = applyWorkerState(value, action);
      if (action === 'dispose') {
        channel.port1.close();
        worker.terminate();
        revokeUrl(workerUrl);
      }
      return updatedDiagnostics;
    };

    return {
      start: () => command('start'),
      pause: () => command('pause'),
      resume: () => command('resume'),
      step: () => command('step'),
      restart: () => command('restart'),
      dispose: () => command('dispose'),
      getDiagnostics: () => diagnostics,
      subscribeDiagnostics: (listener: (value: Record<string, unknown>) => void) => {
        diagnosticsListeners.add(listener);
        return () => diagnosticsListeners.delete(listener);
      },
    };
  };
}

declare global {
  // These values exist only inside the opaque preview frame.
  // eslint-disable-next-line no-var
  var __THREEJS_STUDIO_PREVIEW_RUNTIME_FACTORY__: ((identity: {
    sessionId: string;
    revision: number;
    buildHash: string;
  }) => Promise<unknown>) | undefined;
  // eslint-disable-next-line no-var
  var __THREEJS_STUDIO_AUTHORED_BEHAVIOR_STATUS__: unknown;
  // Build-time placeholder replaced with native import() in the serialized Worker.
  // eslint-disable-next-line no-var
  var __THREEJS_STUDIO_DYNAMIC_IMPORT__: ((specifier: string) => Promise<Record<string, unknown>>) | undefined;
}

export function createAuthoredBehaviorPreviewSource(
  compiled: CompiledBehaviorPreview,
  snapshot: BehaviorPreviewSnapshot,
): string {
  if (!/^[a-f0-9]{64}$/iu.test(compiled.contentHash)) {
    throw new TypeError('Compiled behavior contentHash must be a SHA-256 hex digest.');
  }
  if (!Number.isSafeInteger(compiled.projectRevision) || compiled.projectRevision < 0) {
    throw new RangeError('Compiled behavior projectRevision must be a non-negative safe integer.');
  }
  // Keep native import() out of the build-time function AST. Vite/Rolldown wrap
  // non-literal imports in page-local helpers, and those closures do not exist
  // after this body is serialized into an isolated Worker.
  const workerSource = authoredBehaviorWorker.toString().replace(
    /globalThis\.__THREEJS_STUDIO_DYNAMIC_IMPORT__\(([$\w]+)\)/gu,
    'import($1)',
  );
  if (workerSource.includes('__THREEJS_STUDIO_DYNAMIC_IMPORT__')) {
    throw new Error('The authored behavior Worker contains an unresolved import placeholder.');
  }
  const configuration = {
    ...compiled,
    snapshot,
    workerSource,
  };
  return `(${authoredBehaviorPreviewBootstrap.toString()})(${JSON.stringify(configuration)});`;
}
