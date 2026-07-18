import type { BuildBundleInput, BuildFileContents } from '../types';

/**
 * Inputs for the production runtime bundle. The Three.js module is supplied as
 * source so the resulting ZIP never relies on a bare import, CDN, or registry.
 */
export interface OfflineRuntimeBundleOptions {
  threeModuleSource: BuildFileContents;
  /** Required when threeModuleSource imports ./three.core.js or ./three.core.min.js. */
  threeCoreModuleSource?: BuildFileContents;
  /**
   * Optional self-contained Rapier ESM source. The default browser adapter
   * supplies @dimforge/rapier3d-compat so physics-enabled projects remain
   * network independent. Custom runtimes that never author physics may omit it.
   */
  rapierModuleSource?: BuildFileContents;
}

export type OfflineRuntimeBundle = BuildBundleInput;
