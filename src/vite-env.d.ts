/// <reference types="vite/client" />

interface ThreeStudioDiagnostics {
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
    transforms: Record<string, {
      position: number[];
      rotation: number[];
      scale: number[];
    }>;
  };
}

interface ThreeGameStudioAgentRequest {
  tool: string;
  arguments?: Record<string, unknown>;
  baseRevision?: number;
  requestId?: string;
}

interface ThreeGameStudioAgentEvent {
  type: 'proposal.created' | 'proposal.applied' | 'proposal.dismissed' | 'project.changed';
  revision: number;
  label?: string;
  proposalId?: string;
  actor?: 'human' | 'assistant' | 'integration';
}

interface ThreeGameStudioAgentBridge {
  apiVersion: 1;
  manifest(): unknown;
  snapshot(): unknown;
  request(request: ThreeGameStudioAgentRequest): Promise<unknown>;
  subscribe(listener: (event: ThreeGameStudioAgentEvent) => void): () => void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeStudioDiagnostics;
  __THREE_GAME_STUDIO_AGENT__?: ThreeGameStudioAgentBridge;
}
