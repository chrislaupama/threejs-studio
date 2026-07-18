import threeCoreModuleSource from '../../../node_modules/three/build/three.core.min.js?raw';
import threeModuleSource from '../../../node_modules/three/build/three.module.min.js?raw';
import rapierModuleSource from '../../../node_modules/@dimforge/rapier3d-compat/rapier.mjs?raw';
import { createOfflineRuntimeBundle } from './createOfflineRuntimeBundle';

/** Browser/Vite adapter embedding version-locked local Three.js and Rapier modules. */
export function createDefaultOfflineRuntimeBundle() {
  return createOfflineRuntimeBundle({ threeModuleSource, threeCoreModuleSource, rapierModuleSource });
}
