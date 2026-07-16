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
  };
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeStudioDiagnostics;
}
