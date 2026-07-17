/// <reference types="vite/client" />

interface ThreeJSStudioDiagnostics {
  frame: number;
  elapsed: number;
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
  editor: {
    mode: 'edit' | 'play' | 'paused';
    viewMode: 'scene' | 'game';
    selectedId: string | null;
    objectCount: number;
    schemaVersion: number;
    assetCount: number;
  };
  assets: {
    statesByNode: Record<string, 'checking' | 'loading' | 'ready' | 'missing' | 'error'>;
    readyInstances: number;
    missingInstances: number;
    failedInstances: number;
    cachedModels: number;
  };
  runtime: {
    tick: number;
    fixedDelta: number;
    input: {
      pressedCodes: string[];
      actions: Record<string, [number, number]>;
    };
    transforms: Record<string, {
      position: number[];
      rotation: number[];
      scale: number[];
    }>;
  };
}

interface ThreeJSStudioAgentRequest {
  tool: string;
  arguments?: Record<string, unknown>;
  baseRevision?: number;
  requestId?: string;
}

interface ThreeJSStudioAgentEvent {
  type: 'proposal.created' | 'proposal.applied' | 'proposal.dismissed' | 'project.changed';
  revision: number;
  label?: string;
  proposalId?: string;
  actor?: 'human' | 'assistant' | 'integration';
}

interface ThreeJSStudioAgentBridge {
  apiVersion: 1;
  manifest(): unknown;
  snapshot(): unknown;
  request(request: ThreeJSStudioAgentRequest): Promise<unknown>;
  subscribe(listener: (event: ThreeJSStudioAgentEvent) => void): () => void;
}

interface Window {
  __THREEJS_STUDIO_DIAGNOSTICS__?: ThreeJSStudioDiagnostics;
  /** @deprecated Use __THREEJS_STUDIO_DIAGNOSTICS__. */
  __THREE_GAME_DIAGNOSTICS__?: ThreeJSStudioDiagnostics;
  __THREEJS_STUDIO_AGENT__?: ThreeJSStudioAgentBridge;
  /** @deprecated Use __THREEJS_STUDIO_AGENT__. */
  __THREE_GAME_STUDIO_AGENT__?: ThreeJSStudioAgentBridge;
}
