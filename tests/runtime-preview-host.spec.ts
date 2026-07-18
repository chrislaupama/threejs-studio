import { expect, test } from '@playwright/test';
import {
  RUNTIME_PREVIEW_ALLOW,
  RUNTIME_PREVIEW_CSP,
  RUNTIME_PREVIEW_SANDBOX,
  RUNTIME_PREVIEW_TRANSPORT,
  RUNTIME_PREVIEW_TRANSPORT_VERSION,
} from '../src/runtime/RuntimePreviewHost';

const identity = {
  sessionId: 'preview-session-1',
  revision: 17,
  buildHash: 'sha256-preview-build',
};

test('mounts an opaque network-dark iframe and drives typed lifecycle commands', async ({ page }) => {
  await page.goto('/');

  const mounted = await page.evaluate(async (runtimeIdentity) => {
    const modulePath = '/src/runtime/RuntimePreviewHost.ts';
    const { RuntimePreviewHost } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/runtime/RuntimePreviewHost');
    const container = document.createElement('section');
    container.id = 'runtime-preview-test-container';
    document.body.append(container);
    const diagnostics: Array<{ status: string; tick: number }> = [];
    const host = new RuntimePreviewHost({
      container,
      identity: runtimeIdentity,
      runtimeSource: `
        globalThis.__previewEvalBlocked = true;
        try {
          (0, eval)('1 + 1');
          globalThis.__previewEvalBlocked = false;
        } catch {}
      `,
      diagnosticsThrottleMs: 0,
      onDiagnostics: (snapshot) => diagnostics.push({ status: snapshot.status, tick: snapshot.tick }),
    });
    const ready = await host.mount();
    const iframe = host.element!;
    Object.assign(window, { __runtimePreviewHost: host, __runtimePreviewDiagnostics: diagnostics });
    return {
      readyStatus: ready.diagnostics.status,
      sandbox: iframe.getAttribute('sandbox'),
      allow: iframe.getAttribute('allow'),
      csp: iframe.getAttribute('csp'),
      frameName: iframe.name,
      title: iframe.title,
      parentCanReadDocument: iframe.contentDocument !== null,
    };
  }, identity);

  expect(mounted).toMatchObject({
    readyStatus: 'idle',
    sandbox: RUNTIME_PREVIEW_SANDBOX,
    allow: RUNTIME_PREVIEW_ALLOW,
    csp: RUNTIME_PREVIEW_CSP,
    title: 'Game preview',
    parentCanReadDocument: false,
  });
  expect(mounted.sandbox).not.toContain('allow-same-origin');

  const frame = page.frame({ name: mounted.frameName });
  expect(frame).not.toBeNull();
  const sandboxEvidence = await frame!.evaluate(async () => {
    const policy = document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')?.content;
    let parentDocumentBlocked = false;
    try {
      void parent.document.body;
    } catch {
      parentDocumentBlocked = true;
    }
    let networkBlocked = false;
    try {
      await fetch('https://example.invalid/runtime-preview-csp-probe');
    } catch {
      networkBlocked = true;
    }
    const evalBlocked = (globalThis as typeof globalThis & { __previewEvalBlocked?: boolean }).__previewEvalBlocked === true;
    return { policy, parentDocumentBlocked, networkBlocked, evalBlocked };
  });
  expect(sandboxEvidence).toEqual({
    policy: RUNTIME_PREVIEW_CSP,
    parentDocumentBlocked: true,
    networkBlocked: true,
    evalBlocked: true,
  });

  const acceptedSecondHandshake = await page.evaluate(async ({ runtimeIdentity, transport, version }) => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-threejs-studio-runtime-preview]')!;
    const channel = new MessageChannel();
    let accepted = false;
    channel.port1.onmessage = () => {
      accepted = true;
    };
    channel.port1.start();
    iframe.contentWindow!.postMessage({
      transport,
      transportVersion: version,
      type: 'runtime.handshake',
      handshakeId: iframe.name,
      ...runtimeIdentity,
    }, '*', [channel.port2]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    channel.port1.close();
    return accepted;
  }, {
    runtimeIdentity: identity,
    transport: RUNTIME_PREVIEW_TRANSPORT,
    version: RUNTIME_PREVIEW_TRANSPORT_VERSION,
  });
  expect(acceptedSecondHandshake).toBe(false);

  const lifecycle = await page.evaluate(async () => {
    const host = (window as unknown as Window & { __runtimePreviewHost: {
      start(): Promise<{ status: string }>;
      pause(): Promise<{ status: string }>;
      step(): Promise<{ status: string; tick: number }>;
      resume(): Promise<{ status: string }>;
      restart(): Promise<{ status: string; restartCount: number; tick: number }>;
      getDiagnostics(): { status: string } | null;
    } }).__runtimePreviewHost;
    const started = await host.start();
    const paused = await host.pause();
    const stepped = await host.step();
    const resumed = await host.resume();
    const restarted = await host.restart();
    return {
      started: started.status,
      paused: paused.status,
      stepped: { status: stepped.status, tick: stepped.tick },
      resumed: resumed.status,
      restarted: { status: restarted.status, restartCount: restarted.restartCount, tick: restarted.tick },
      latest: host.getDiagnostics()?.status,
    };
  });
  expect(lifecycle).toEqual({
    started: 'running',
    paused: 'paused',
    stepped: { status: 'paused', tick: 1 },
    resumed: 'running',
    restarted: { status: 'running', restartCount: 1, tick: 0 },
    latest: 'running',
  });

  await page.evaluate(async () => {
    const host = (window as unknown as Window & { __runtimePreviewHost: { dispose(): Promise<void> } }).__runtimePreviewHost;
    await host.dispose();
  });
  await expect(page.locator('[data-threejs-studio-runtime-preview]')).toHaveCount(0);
});

test('isolates throwing diagnostics callbacks from ready, result, and disposal progress', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async (runtimeIdentity) => {
    const modulePath = '/src/runtime/RuntimePreviewHost.ts';
    const { RuntimePreviewHost } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/runtime/RuntimePreviewHost');
    const container = document.createElement('section');
    document.body.append(container);
    let diagnosticsCalls = 0;
    const host = new RuntimePreviewHost({
      container,
      identity: runtimeIdentity,
      diagnosticsThrottleMs: 0,
      onDiagnostics: () => {
        diagnosticsCalls += 1;
        throw new Error('Host diagnostics observer failed intentionally.');
      },
    });

    const ready = await host.mount();
    const started = await host.start();
    await host.dispose();
    return {
      ready: ready.diagnostics.status,
      started: started.status,
      diagnosticsCalls,
      lifecycleStatus: host.lifecycleStatus,
      iframeRemoved: host.element === null,
    };
  }, identity);

  expect(result).toMatchObject({
    ready: 'idle',
    started: 'running',
    lifecycleStatus: 'disposed',
    iframeRemoved: true,
  });
  expect(result.diagnosticsCalls).toBeGreaterThanOrEqual(3);
});

test('settles command and ready promises before invoking throwing runtime-error callbacks', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async (runtimeIdentity) => {
    const modulePath = '/src/runtime/RuntimePreviewHost.ts';
    const { RuntimePreviewHost } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/runtime/RuntimePreviewHost');

    const commandContainer = document.createElement('section');
    document.body.append(commandContainer);
    let commandErrorCalls = 0;
    const commandHost = new RuntimePreviewHost({
      container: commandContainer,
      identity: runtimeIdentity,
      runtimeSource: `
        globalThis.__THREEJS_STUDIO_PREVIEW_RUNTIME_FACTORY__ = () => ({
          start: () => { throw new Error('Intentional command failure.'); },
        });
      `,
      onRuntimeError: () => {
        commandErrorCalls += 1;
        throw new Error('Host runtime-error observer failed intentionally.');
      },
    });
    await commandHost.mount();
    const commandResult = await commandHost.start().then(
      () => 'resolved',
      (error: { code?: string }) => error.code ?? 'unknown',
    );
    await commandHost.dispose();

    const initializationContainer = document.createElement('section');
    document.body.append(initializationContainer);
    let initializationErrorCalls = 0;
    const initializationHost = new RuntimePreviewHost({
      container: initializationContainer,
      identity: { ...runtimeIdentity, sessionId: `${runtimeIdentity.sessionId}-initialization` },
      runtimeSource: `
        globalThis.__THREEJS_STUDIO_PREVIEW_RUNTIME_FACTORY__ = () => {
          throw new Error('Intentional initialization failure.');
        };
      `,
      onRuntimeError: () => {
        initializationErrorCalls += 1;
        throw new Error('Host fatal-error observer failed intentionally.');
      },
    });
    const initializationResult = await initializationHost.mount().then(
      () => 'resolved',
      (error: { code?: string }) => error.code ?? 'unknown',
    );

    return {
      commandResult,
      commandErrorCalls,
      commandStatus: commandHost.lifecycleStatus,
      initializationResult,
      initializationErrorCalls,
      initializationStatus: initializationHost.lifecycleStatus,
      initializationIframeRemoved: initializationHost.element === null,
    };
  }, identity);

  expect(result).toEqual({
    commandResult: 'runtime_error',
    commandErrorCalls: 1,
    commandStatus: 'disposed',
    initializationResult: 'runtime_error',
    initializationErrorCalls: 1,
    initializationStatus: 'disposed',
    initializationIframeRemoved: true,
  });
});

test('treats post-ready iframe navigation as a fatal transport failure', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async (runtimeIdentity) => {
    const modulePath = '/src/runtime/RuntimePreviewHost.ts';
    const { RuntimePreviewHost } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/runtime/RuntimePreviewHost');
    const container = document.createElement('section');
    document.body.append(container);
    const errorCodes: string[] = [];
    const host = new RuntimePreviewHost({
      container,
      identity: runtimeIdentity,
      onRuntimeError: (error) => errorCodes.push(error.code),
    });
    await host.mount();
    const iframe = host.element!;
    iframe.srcdoc = '<!doctype html><title>unexpected navigation</title>';

    const deadline = performance.now() + 2_000;
    while (host.lifecycleStatus !== 'disposed' && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return {
      lifecycleStatus: host.lifecycleStatus,
      iframeRemoved: host.element === null,
      errorCodes,
    };
  }, identity);

  expect(result).toEqual({
    lifecycleStatus: 'disposed',
    iframeRemoved: true,
    errorCodes: ['runtime_frame_navigated'],
  });
  await expect(page.locator('[data-threejs-studio-runtime-preview]')).toHaveCount(0);
});

test('rejects stale identity and sequence messages while throttling diagnostics', async ({ page }) => {
  await page.goto('/');
  const captureSource = `
    addEventListener('message', (event) => {
      if (event.data && event.data.transport === '${RUNTIME_PREVIEW_TRANSPORT}' && event.ports.length === 1) {
        globalThis.__previewTestPort = event.ports[0];
        globalThis.__previewTestIdentity = {
          sessionId: event.data.sessionId,
          revision: event.data.revision,
          buildHash: event.data.buildHash,
        };
      }
    }, { once: true });
  `;

  const frameName = await page.evaluate(async ({ runtimeIdentity, source }) => {
    const modulePath = '/src/runtime/RuntimePreviewHost.ts';
    const { RuntimePreviewHost } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/runtime/RuntimePreviewHost');
    const container = document.createElement('section');
    document.body.append(container);
    const issues: Array<{ code: string }> = [];
    const diagnostics: Array<{ status: string; tick: number }> = [];
    const host = new RuntimePreviewHost({
      container,
      identity: runtimeIdentity,
      runtimeSource: source,
      diagnosticsThrottleMs: 500,
      onProtocolIssue: (issue) => issues.push({ code: issue.code }),
      onDiagnostics: (snapshot) => diagnostics.push({ status: snapshot.status, tick: snapshot.tick }),
    });
    await host.mount();
    Object.assign(window, {
      __runtimePreviewHost: host,
      __runtimePreviewIssues: issues,
      __runtimePreviewDiagnostics: diagnostics,
    });
    return host.element!.name;
  }, { runtimeIdentity: identity, source: captureSource });

  const frame = page.frame({ name: frameName });
  expect(frame).not.toBeNull();
  await frame!.evaluate(({ transport, version }) => {
    const runtimeGlobal = globalThis as typeof globalThis & {
      __previewTestPort: MessagePort;
      __previewTestIdentity: { sessionId: string; revision: number; buildHash: string };
    };
    const runtimeIdentity = runtimeGlobal.__previewTestIdentity;
    const errorMessage = {
      protocol: 'threejs-studio.runtime',
      protocolVersion: 1,
      ...runtimeIdentity,
      type: 'runtime.error',
      requestId: null,
      code: 'test_message',
      message: 'Sequence probe.',
      fatal: false,
    };
    runtimeGlobal.__previewTestPort.postMessage({
      transport,
      transportVersion: version,
      sequence: 1,
      ...runtimeIdentity,
      message: errorMessage,
    });
    runtimeGlobal.__previewTestPort.postMessage({
      transport,
      transportVersion: version,
      sequence: 2,
      ...runtimeIdentity,
      revision: runtimeIdentity.revision + 1,
      message: { ...errorMessage, revision: runtimeIdentity.revision + 1 },
    });
  }, { transport: RUNTIME_PREVIEW_TRANSPORT, version: RUNTIME_PREVIEW_TRANSPORT_VERSION });

  const result = await page.evaluate(async () => {
    const testWindow = window as unknown as Window & {
      __runtimePreviewHost: {
        start(): Promise<{ status: string }>;
        pause(): Promise<{ status: string }>;
        step(): Promise<{ tick: number }>;
        dispose(): Promise<void>;
      };
      __runtimePreviewIssues: Array<{ code: string }>;
      __runtimePreviewDiagnostics: Array<{ status: string; tick: number }>;
    };
    const started = await testWindow.__runtimePreviewHost.start();
    await testWindow.__runtimePreviewHost.pause();
    const stepped = await testWindow.__runtimePreviewHost.step();
    await new Promise((resolve) => setTimeout(resolve, 550));
    const snapshot = {
      status: started.status,
      tick: stepped.tick,
      issues: testWindow.__runtimePreviewIssues.map(({ code }) => code),
      diagnostics: [...testWindow.__runtimePreviewDiagnostics],
    };
    await testWindow.__runtimePreviewHost.dispose();
    return snapshot;
  });

  expect(result.status).toBe('running');
  expect(result.tick).toBe(1);
  expect(result.issues).toEqual(['stale_sequence', 'identity_mismatch']);
  // Ready plus three result/diagnostic pairs would produce seven callbacks
  // without coalescing; the host must deliver fewer snapshots.
  expect(result.diagnostics.length).toBeLessThan(7);
  expect(result.diagnostics.at(-1)).toEqual({ status: 'paused', tick: 1 });
  await expect(page.locator('[data-threejs-studio-runtime-preview]')).toHaveCount(0);
});

test('disposal rejects pending work, removes the iframe, and ignores late messages', async ({ page }) => {
  await page.goto('/');
  const hangingRuntimeSource = `
    addEventListener('message', (event) => {
      if (event.data && event.data.transport === '${RUNTIME_PREVIEW_TRANSPORT}' && event.ports.length === 1) {
        globalThis.__previewTestPort = event.ports[0];
        globalThis.__previewTestIdentity = {
          sessionId: event.data.sessionId,
          revision: event.data.revision,
          buildHash: event.data.buildHash,
        };
      }
    }, { once: true });
    globalThis.__THREEJS_STUDIO_PREVIEW_RUNTIME_FACTORY__ = () => ({
      pause: () => new Promise(() => {}),
    });
  `;

  const frameName = await page.evaluate(async ({ runtimeIdentity, source }) => {
    const modulePath = '/src/runtime/RuntimePreviewHost.ts';
    const { RuntimePreviewHost } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/runtime/RuntimePreviewHost');
    const container = document.createElement('section');
    document.body.append(container);
    const issues: Array<{ code: string }> = [];
    const host = new RuntimePreviewHost({
      container,
      identity: runtimeIdentity,
      runtimeSource: source,
      commandTimeoutMs: 2_000,
      onProtocolIssue: (issue) => issues.push({ code: issue.code }),
    });
    await host.mount();
    await host.start();
    Object.assign(window, { __runtimePreviewHost: host, __runtimePreviewIssues: issues });
    return host.element!.name;
  }, { runtimeIdentity: identity, source: hangingRuntimeSource });

  const frame = page.frame({ name: frameName });
  expect(frame).not.toBeNull();
  await frame!.evaluate(({ transport, version }) => {
    const runtimeGlobal = globalThis as typeof globalThis & {
      __previewTestPort: MessagePort;
      __previewTestIdentity: { sessionId: string; revision: number; buildHash: string };
    };
    const runtimeIdentity = runtimeGlobal.__previewTestIdentity;
    setTimeout(() => runtimeGlobal.__previewTestPort.postMessage({
      transport,
      transportVersion: version,
      sequence: 999,
      ...runtimeIdentity,
      message: {
        protocol: 'threejs-studio.runtime',
        protocolVersion: 1,
        ...runtimeIdentity,
        type: 'runtime.error',
        requestId: null,
        code: 'late_message',
        message: 'This message must be ignored after disposal.',
        fatal: false,
      },
    }), 250);
  }, { transport: RUNTIME_PREVIEW_TRANSPORT, version: RUNTIME_PREVIEW_TRANSPORT_VERSION });

  const cleanup = await page.evaluate(async () => {
    const testWindow = window as unknown as Window & {
      __runtimePreviewHost: {
        pause(): Promise<unknown>;
        dispose(): Promise<void>;
        readonly lifecycleStatus: string;
      };
      __runtimePreviewIssues: Array<{ code: string }>;
    };
    const pending = testWindow.__runtimePreviewHost.pause().then(
      () => 'resolved',
      (error: { code?: string }) => error.code ?? 'unknown',
    );
    await testWindow.__runtimePreviewHost.dispose();
    const pendingResult = await pending;
    await new Promise((resolve) => setTimeout(resolve, 350));
    return {
      pendingResult,
      lifecycleStatus: testWindow.__runtimePreviewHost.lifecycleStatus,
      issues: [...testWindow.__runtimePreviewIssues],
    };
  });

  expect(cleanup).toEqual({ pendingResult: 'disposed', lifecycleStatus: 'disposed', issues: [] });
  await expect(page.locator('[data-threejs-studio-runtime-preview]')).toHaveCount(0);
});
