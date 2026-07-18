import { expect, test } from '@playwright/test';
import { ScriptCompilerService } from '../src/scripting/compiler';
import {
  BehaviorDefinitionError,
  createEntityHandle,
  createDefaultBehaviorProperties,
  defineBehavior,
  isSerializableValue,
  validateSerializableValue,
  type EntityHandle,
  type SerializableValue,
} from '../src/scripting/sdk';
import {
  buildSandboxCsp,
  createSandboxConnectionMessage,
  createSandboxControlMessage,
  createSandboxDocument,
  createSandboxInitializeMessage,
  isSandboxMessage,
  SandboxPayloadValidationError,
  SCRIPT_SANDBOX_ATTRIBUTE,
  validateSandboxMessage,
} from '../src/scripting/sandbox';
import {
  createVirtualProjectSnapshot,
  normalizeVirtualPath,
  resolveVirtualImport,
  VirtualFileSystemError,
  VirtualProjectFileSystem,
} from '../src/scripting/virtualFileSystem';

async function sha256Hex(value: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('behavior definitions expose typed serializable properties and frozen metadata', () => {
  const behavior = defineBehavior({
    name: 'Mover',
    schema: {
      speed: { type: 'number', default: 4, min: 0, max: 20, step: 0.25 },
      enabled: { type: 'boolean', default: true },
      direction: { type: 'vec3', default: [1, 0, 0] },
      target: { type: 'entity', default: null },
      mode: { type: 'enum', default: 'walk', options: ['walk', 'run'] },
    },
    onFixedUpdate(context) {
      const distance = context.properties.speed * context.time.fixedDeltaSeconds;
      context.api.transforms.translate(context.self, [distance, 0, 0]);
    },
  });

  expect(behavior.apiVersion).toBe(1);
  expect(Object.isFrozen(behavior)).toBe(true);
  expect(Object.isFrozen(behavior.schema)).toBe(true);
  expect(Object.isFrozen(behavior.schema.direction.default)).toBe(true);
  expect(createDefaultBehaviorProperties(behavior.schema)).toEqual({
    speed: 4,
    enabled: true,
    direction: [1, 0, 0],
    target: null,
    mode: 'walk',
  });

  expect(() => defineBehavior({
    schema: {
      'bad name': { type: 'number', default: Number.NaN },
      tint: { type: 'color', default: 'teal' },
      mode: { type: 'enum', default: 'missing', options: ['walk'] },
    },
  })).toThrow(BehaviorDefinitionError);
  try {
    defineBehavior({ schema: { speed: { type: 'number', default: 30, max: 10 } } });
  } catch (error) {
    expect(error).toBeInstanceOf(BehaviorDefinitionError);
    expect((error as BehaviorDefinitionError).issues).toContainEqual(expect.objectContaining({
      code: 'INVALID_DEFAULT',
      path: 'schema.speed.default',
    }));
  }
});

test('behavior-facing handles and payloads stay structured-clone-safe plain data', () => {
  const handle: EntityHandle = createEntityHandle('player', 'level-1', 2);
  expect(Object.isFrozen(handle)).toBe(true);
  expect(structuredClone(handle)).toEqual(handle);
  expect(isSerializableValue(handle)).toBe(true);
  expect(isSerializableValue({ handle, velocity: [1, 0, -2], active: true })).toBe(true);
  expect(isSerializableValue({ value: Number.POSITIVE_INFINITY })).toBe(false);
  expect(isSerializableValue(new Date())).toBe(false);

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(isSerializableValue(cyclic)).toBe(false);
});

test('serializable payload validation rejects resource exhaustion with stable diagnostics', () => {
  const limits = { maxDepth: 2, maxNodes: 6, maxStringBytes: 5, maxTotalBytes: 12 };

  expect(validateSerializableValue([[[true]]], limits)).toEqual(expect.objectContaining({
    ok: false,
    diagnostic: expect.objectContaining({ code: 'SERIALIZABLE_MAX_DEPTH', path: '$[0][0][0]' }),
  }));
  expect(validateSerializableValue([1, 2, 3, 4, 5, 6], { ...limits, maxDepth: 4, maxTotalBytes: 100 })).toEqual(expect.objectContaining({
    ok: false,
    diagnostic: expect.objectContaining({ code: 'SERIALIZABLE_MAX_NODES' }),
  }));
  expect(validateSerializableValue('123456', { ...limits, maxTotalBytes: 100 })).toEqual(expect.objectContaining({
    ok: false,
    diagnostic: expect.objectContaining({ code: 'SERIALIZABLE_MAX_STRING_BYTES', path: '$' }),
  }));
  expect(validateSerializableValue(['abcd', 'efgh'], { ...limits, maxDepth: 4, maxNodes: 20, maxStringBytes: 20 })).toEqual(expect.objectContaining({
    ok: false,
    diagnostic: expect.objectContaining({ code: 'SERIALIZABLE_MAX_TOTAL_BYTES' }),
  }));

  const deepPayload: SerializableValue[] = [];
  let cursor = deepPayload;
  for (let index = 0; index < 70; index += 1) {
    const child: SerializableValue[] = [];
    cursor.push(child);
    cursor = child;
  }
  expect(() => createSandboxInitializeMessage('bounded-payload', 1, {
    projectRevision: 1,
    contentHash: '0'.repeat(64),
    moduleCode: '',
    projectSnapshot: deepPayload,
  })).toThrow(SandboxPayloadValidationError);
  try {
    createSandboxInitializeMessage('bounded-payload', 1, {
      projectRevision: 1,
      contentHash: '0'.repeat(64),
      moduleCode: '',
      projectSnapshot: deepPayload,
    });
  } catch (error) {
    expect(error).toMatchObject({ code: 'SERIALIZABLE_MAX_DEPTH' });
  }

  const baseMessage = createSandboxConnectionMessage('bounded-payload');
  const validation = validateSandboxMessage({ ...baseMessage, payload: [1, 2, 3, 4, 5], type: 'runtime.status' });
  expect(validation.ok).toBe(true);
  expect(isSandboxMessage({ ...baseMessage, payload: { value: Number.POSITIVE_INFINITY } })).toBe(false);
  expect(validateSandboxMessage({ ...baseMessage, payload: { value: Number.POSITIVE_INFINITY } })).toEqual(expect.objectContaining({
    ok: false,
    diagnostic: expect.objectContaining({ code: 'SERIALIZABLE_NON_FINITE_NUMBER', path: '$.payload["value"]' }),
  }));
});

test('virtual script files canonicalize, resolve locally, and snapshot without leaking mutation', () => {
  const fileSystem = new VirtualProjectFileSystem();
  fileSystem.writeFile('/src/main.ts', "import { speed } from './config'; export const value = speed;");
  fileSystem.writeFile('/src/config/index.ts', 'export const speed = 4;');
  const snapshot = fileSystem.snapshot();

  expect(normalizeVirtualPath('./main.ts', '/src')).toBe('/src/main.ts');
  expect(resolveVirtualImport(snapshot, './config', '/src/main.ts')).toBe('/src/config/index.ts');
  expect(snapshot.files.map((file) => file.path)).toEqual(['/src/config/index.ts', '/src/main.ts']);

  const read = fileSystem.readFile('/src/main.ts');
  expect(read).not.toBeNull();
  if (read) (read as { contents: string }).contents = 'changed outside the VFS';
  expect(fileSystem.readFile('/src/main.ts')?.contents).toContain('export const value');

  expect(() => normalizeVirtualPath('../../escape.ts', '/')).toThrow(VirtualFileSystemError);
  expect(() => fileSystem.writeFile('/src/remote.css', 'body{}')).toThrow(/must use one of/);
  expect(() => createVirtualProjectSnapshot([
    { path: '/src/main.ts', contents: '' },
    { path: 'src/./main.ts', contents: '' },
  ])).toThrow(/Duplicate/);
});

test('esbuild-wasm compiles a deterministic local bundle with diagnostics and last-known-good output', async () => {
  const snapshot = createVirtualProjectSnapshot([
    {
      path: '/src/main.ts',
      contents: [
        `import { defineBehavior } from '@threejs-studio/sdk';`,
        `import { speed } from './config';`,
        `export default defineBehavior({ schema: { speed: { type: 'number', default: speed } } });`,
      ].join('\n'),
    },
    { path: '/src/config.ts', contents: 'export const speed: number = 4;' },
  ], 7);
  const compiler = new ScriptCompilerService();
  const first = await compiler.compile({
    requestId: 'compile-1',
    projectRevision: 7,
    entryPath: '/src/main.ts',
    snapshot,
    mode: 'development',
  });

  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.dependencies).toEqual(['/src/config.ts', '/src/main.ts']);
  expect(first.javascript).toContain('defineBehavior');
  expect(first.javascript).not.toContain('@threejs-studio/sdk');
  expect(first.sourceMap).toContain('/src/main.ts');
  expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(first.semanticDiagnosticsIncluded).toBe(false);

  const reordered = createVirtualProjectSnapshot([...snapshot.files].reverse(), 7);
  const second = await compiler.compile({
    requestId: 'compile-2',
    projectRevision: 7,
    entryPath: '/src/main.ts',
    snapshot: reordered,
    mode: 'development',
  });
  expect(second.ok && second.contentHash).toBe(first.contentHash);

  const invalid = createVirtualProjectSnapshot([
    { path: '/src/main.ts', contents: `import value from 'unapproved-package'; export default value;` },
  ], 8);
  const failed = await compiler.compile({
    requestId: 'compile-3',
    projectRevision: 8,
    entryPath: '/src/main.ts',
    snapshot: invalid,
    mode: 'production',
  });
  expect(failed.ok).toBe(false);
  expect(failed.diagnostics).toContainEqual(expect.objectContaining({
    severity: 'error',
    source: 'vfs',
    code: 'UNSUPPORTED_IMPORT',
  }));
  expect(compiler.getLastSuccessfulResult()?.contentHash).toBe(first.contentHash);
});

test('sandbox document defaults to an opaque origin, denied network, and serializable sequenced messages', async ({ page }) => {
  const sessionId = 'sandbox-test-1';
  const nonce = 'test_nonce_1234567890';
  const moduleCode = [
    `globalThis.postMessage({ type: 'worker.ready', payload: { exports: ['forged'] } });`,
    `globalThis.postMessage({ type: 'worker.error', payload: { code: 'FORGED', message: 'forged fatal' } });`,
    `globalThis.postMessage({ type: 'worker.response', payload: { value: 'forged status' } });`,
    `MessagePort.prototype.postMessage = () => globalThis.postMessage({ type: 'worker.ready', payload: { exports: ['prototype-forged'] } });`,
    `Object.keys = () => ['object-keys-forged'];`,
    `Array.prototype.sort = () => ['array-sort-forged'];`,
    `export const behaviorName = 'sandboxed';`,
    `export function onSandboxMessage() {`,
    `  return {`,
    `    documentType: typeof document,`,
    `    parentType: typeof parent,`,
    `    topType: typeof top,`,
    `    locationAssignType: typeof globalThis.location?.assign,`,
    `  };`,
    `}`,
  ].join('\n');
  const contentHash = await sha256Hex(moduleCode);
  const documentValue = createSandboxDocument({ sessionId, nonce, title: 'Script test' });
  const connection = createSandboxConnectionMessage(sessionId);
  const initialization = createSandboxInitializeMessage(sessionId, 1, {
    projectRevision: 1,
    contentHash,
    moduleCode,
    projectSnapshot: { sceneId: 'scene-1' },
  });
  const start = createSandboxControlMessage(sessionId, 2, 'start');
  const dispose = createSandboxControlMessage(sessionId, 3, 'dispose');

  expect(documentValue.sandbox).toBe(SCRIPT_SANDBOX_ATTRIBUTE);
  expect(documentValue.sandbox).not.toContain('allow-same-origin');
  expect(documentValue.csp).toBe(buildSandboxCsp(nonce));
  expect(documentValue.csp).toContain("connect-src 'none'");
  expect(documentValue.csp).toContain("default-src 'none'");
  expect(documentValue.csp).not.toContain("'unsafe-eval'");
  expect(documentValue.srcdoc).not.toContain('forged fatal');
  expect(isSandboxMessage(initialization)).toBe(true);
  expect(isSandboxMessage({ ...initialization, payload: { createdAt: new Date() } })).toBe(false);

  const result = await page.evaluate(async ({ sandboxDocument, connectMessageJson, initializeMessageJson, startMessageJson, disposeMessageJson }) => {
    const connectMessage = JSON.parse(connectMessageJson) as Record<string, unknown>;
    const initializeMessage = JSON.parse(initializeMessageJson) as Record<string, unknown>;
    const startMessage = JSON.parse(startMessageJson) as Record<string, unknown>;
    const disposeMessage = JSON.parse(disposeMessageJson) as Record<string, unknown>;
    const iframe = document.createElement('iframe');
    iframe.title = 'Game preview';
    iframe.setAttribute('sandbox', sandboxDocument.sandbox);
    iframe.referrerPolicy = sandboxDocument.referrerPolicy as ReferrerPolicy;
    iframe.setAttribute('allow', sandboxDocument.allow);

    const windowReady = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Timed out waiting for sandbox bootstrap.')), 5_000);
      const listener = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow || event.data?.type !== 'runtime.bootstrap-ready') return;
        window.clearTimeout(timeout);
        window.removeEventListener('message', listener);
        resolve();
      };
      window.addEventListener('message', listener);
    });
    iframe.srcdoc = sandboxDocument.srcdoc;
    document.body.append(iframe);
    await windowReady;

    let opaqueOrigin = false;
    try {
      void iframe.contentWindow?.document.body;
    } catch {
      opaqueOrigin = true;
    }

    const channel = new MessageChannel();
    const observedMessages: Array<Record<string, unknown>> = [];
    channel.port1.addEventListener('message', (event: MessageEvent<Record<string, unknown>>) => {
      observedMessages.push(event.data);
    });
    const nextPortMessage = (expectedType: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType}.`)), 5_000);
      const listener = (event: MessageEvent<Record<string, unknown>>) => {
        if (event.data?.type !== expectedType) return;
        window.clearTimeout(timeout);
        channel.port1.removeEventListener('message', listener);
        resolve(event.data);
      };
      channel.port1.addEventListener('message', listener);
      channel.port1.start();
    });

    const portReady = nextPortMessage('runtime.bootstrap-ready');
    iframe.contentWindow?.postMessage(connectMessage, '*', [channel.port2]);
    await portReady;
    const runtimeReady = nextPortMessage('runtime.ready');
    channel.port1.postMessage(initializeMessage);
    const readyMessage = await runtimeReady;
    const runtimeStatus = nextPortMessage('runtime.status');
    channel.port1.postMessage(startMessage);
    const statusMessage = await runtimeStatus;
    const disposeAck = nextPortMessage('runtime.dispose-ack');
    channel.port1.postMessage(disposeMessage);
    await disposeAck;

    channel.port1.close();
    iframe.remove();
    return {
      opaqueOrigin,
      readyPayload: readyMessage.payload,
      statusPayload: statusMessage.payload,
      observedTypes: observedMessages.map((message) => message.type),
      observedFatalCodes: observedMessages
        .filter((message) => message.type === 'runtime.fatal')
        .map((message) => (message.payload as { code?: unknown } | null)?.code),
    };
  }, {
    sandboxDocument: {
      sandbox: documentValue.sandbox,
      referrerPolicy: documentValue.referrerPolicy,
      allow: documentValue.allow,
      srcdoc: documentValue.srcdoc,
    },
    connectMessageJson: JSON.stringify(connection),
    initializeMessageJson: JSON.stringify(initialization),
    startMessageJson: JSON.stringify(start),
    disposeMessageJson: JSON.stringify(dispose),
  });

  expect(result.opaqueOrigin).toBe(true);
  expect(result.readyPayload).toEqual({ exports: ['behaviorName', 'onSandboxMessage'], contentHash });
  expect(result.statusPayload).toEqual({
    value: {
      documentType: 'undefined',
      parentType: 'undefined',
      topType: 'undefined',
      locationAssignType: 'undefined',
    },
  });
  expect(result.observedTypes).not.toContain('worker.ready');
  expect(result.observedTypes).not.toContain('worker.error');
  expect(result.observedTypes).not.toContain('worker.response');
  expect(result.observedFatalCodes).not.toContain('FORGED');
});

test('sandbox rejects a module whose approved content hash does not match its bytes', async ({ page }) => {
  const sessionId = 'sandbox-hash-mismatch';
  const sandboxDocument = createSandboxDocument({ sessionId, nonce: 'hash_mismatch_nonce_1234' });
  const connect = createSandboxConnectionMessage(sessionId);
  const initialize = createSandboxInitializeMessage(sessionId, 1, {
    projectRevision: 1,
    contentHash: await sha256Hex('export const approved = true;'),
    moduleCode: 'export const tampered = true;',
    projectSnapshot: {},
  });

  const fatal = await page.evaluate(async ({ documentValue, connectJson, initializeJson }) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', documentValue.sandbox);
    const bootstrapped = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('bootstrap timeout')), 5_000);
      const listener = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow || event.data?.type !== 'runtime.bootstrap-ready') return;
        window.clearTimeout(timeout);
        window.removeEventListener('message', listener);
        resolve();
      };
      window.addEventListener('message', listener);
    });
    iframe.srcdoc = documentValue.srcdoc;
    document.body.append(iframe);
    await bootstrapped;
    const channel = new MessageChannel();
    const next = (type: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`${type} timeout`)), 5_000);
      const listener = (event: MessageEvent<Record<string, unknown>>) => {
        if (event.data?.type !== type) return;
        window.clearTimeout(timeout);
        channel.port1.removeEventListener('message', listener);
        resolve(event.data);
      };
      channel.port1.addEventListener('message', listener);
      channel.port1.start();
    });
    const connected = next('runtime.bootstrap-ready');
    iframe.contentWindow?.postMessage(JSON.parse(connectJson), '*', [channel.port2]);
    await connected;
    const rejected = next('runtime.fatal');
    channel.port1.postMessage(JSON.parse(initializeJson));
    const message = await rejected;
    channel.port1.close();
    iframe.remove();
    return message.payload;
  }, {
    documentValue: { sandbox: sandboxDocument.sandbox, srcdoc: sandboxDocument.srcdoc },
    connectJson: JSON.stringify(connect),
    initializeJson: JSON.stringify(initialize),
  });

  expect(fatal).toEqual({
    code: 'CONTENT_HASH_MISMATCH',
    message: 'Authored module bytes do not match the approved SHA-256 digest.',
  });
});
