export type BuildProfile = 'development' | 'preview' | 'production';

export type BuildFileContents = string | Uint8Array | ArrayBuffer;

export type BuildCompression = 'auto' | 'store' | 'deflate';

export interface BuildFileInput {
  /** A relative path within this input's namespace (runtime, scripts, project, or assets). */
  path: string;
  contents: BuildFileContents;
  mediaType?: string;
  compression?: BuildCompression;
}

export interface BuildBundleInput {
  /** Relative module path that exports a named `boot` function or a default boot function. */
  entry: string;
  files: readonly BuildFileInput[];
  /** Exact SHA-256 of an authored entry module, when this bundle carries behavior code. */
  contentHash?: string;
  /** Authoring revision used to compile an authored entry module. */
  projectRevision?: number;
}

export interface LegacySingleHtmlProfileMetadata {
  format: 'legacy-single-html';
  availability: 'external-exporter';
  offline: false;
  networkIndependent: false;
  recommended: false;
}

export interface OfflineZipProfileMetadata {
  format: 'offline-zip';
  offline: true;
  networkIndependent: true;
  compressionLevel: 0 | 6 | 9;
  sourceMaps: 'external' | 'none';
  diagnostics: boolean;
}

export interface BuildProfileMetadata {
  id: BuildProfile;
  label: string;
  offlineZip: OfflineZipProfileMetadata;
  /**
   * The existing single-HTML exporter remains available outside this module. It is
   * intentionally described here so callers do not mistake it for an offline build.
   */
  legacySingleHtml: LegacySingleHtmlProfileMetadata;
}

function defineProfile(profile: BuildProfileMetadata): BuildProfileMetadata {
  Object.freeze(profile.offlineZip);
  Object.freeze(profile.legacySingleHtml);
  return Object.freeze(profile);
}

export const BUILD_PROFILES: Readonly<Record<BuildProfile, BuildProfileMetadata>> = Object.freeze({
  development: defineProfile({
    id: 'development',
    label: 'Development',
    offlineZip: {
      format: 'offline-zip',
      offline: true,
      networkIndependent: true,
      compressionLevel: 0,
      sourceMaps: 'external',
      diagnostics: true,
    },
    legacySingleHtml: {
      format: 'legacy-single-html',
      availability: 'external-exporter',
      offline: false,
      networkIndependent: false,
      recommended: false,
    },
  }),
  preview: defineProfile({
    id: 'preview',
    label: 'Preview',
    offlineZip: {
      format: 'offline-zip',
      offline: true,
      networkIndependent: true,
      compressionLevel: 6,
      sourceMaps: 'external',
      diagnostics: true,
    },
    legacySingleHtml: {
      format: 'legacy-single-html',
      availability: 'external-exporter',
      offline: false,
      networkIndependent: false,
      recommended: false,
    },
  }),
  production: defineProfile({
    id: 'production',
    label: 'Production',
    offlineZip: {
      format: 'offline-zip',
      offline: true,
      networkIndependent: true,
      compressionLevel: 9,
      sourceMaps: 'none',
      diagnostics: false,
    },
    legacySingleHtml: {
      format: 'legacy-single-html',
      availability: 'external-exporter',
      offline: false,
      networkIndependent: false,
      recommended: false,
    },
  }),
});

export type BuildProgressStage = 'validating' | 'assembling' | 'hashing' | 'compressing' | 'complete';

export interface BuildProgress {
  stage: BuildProgressStage;
  /** Overall build completion from zero to one. */
  ratio: number;
  completed: number;
  total: number;
  path?: string;
}

export interface BuildRequest {
  profile: BuildProfile;
  projectName: string;
  title?: string;
  filename?: string;
  runtime: BuildBundleInput;
  scripts?: BuildBundleInput;
  project: BuildFileInput;
  assets?: readonly BuildFileInput[];
  signal?: AbortSignal;
  onProgress?: (progress: BuildProgress) => void;
}

export type BuildManifestFileKind = 'generated' | 'runtime' | 'script' | 'project' | 'asset';

export interface BuildManifestFile {
  path: string;
  kind: BuildManifestFileKind;
  mediaType: string;
  bytes: number;
  sha256: string;
}

export interface BuildManifest {
  format: 'threejs-studio-offline-build';
  formatVersion: 1;
  profile: BuildProfile;
  profileMetadata: BuildProfileMetadata;
  entrypoint: 'index.html';
  bootstrap: 'bootstrap.js';
  project: string;
  runtimeEntry: string;
  scriptEntry: string | null;
  assetBase: 'assets/';
  offline: true;
  networkDependencies: readonly [];
  contentSecurityPolicy: string;
  security: {
    networkPolicy: 'deny';
    authoredScriptExecution: 'disabled-pending-opaque-sandbox' | 'opaque-sandbox';
    projectAuthoringSource: 'omitted' | 'included';
  };
  hashAlgorithm: 'SHA-256';
  files: readonly BuildManifestFile[];
}

export interface BuildResult {
  profile: BuildProfile;
  format: 'offline-zip';
  filename: string;
  archive: Uint8Array;
  byteLength: number;
  archiveSha256: string;
  manifestSha256: string;
  manifest: BuildManifest;
}
