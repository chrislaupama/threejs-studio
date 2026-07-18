import type { BuildFileInput } from '../types';
import { OFFLINE_RUNTIME_ENTRY_SOURCE, OFFLINE_RUNTIME_STYLES_SOURCE } from './source';
import type { OfflineRuntimeBundle, OfflineRuntimeBundleOptions } from './types';

export const OFFLINE_RUNTIME_ENTRY_PATH = 'main.js';
export const OFFLINE_RUNTIME_THREE_PATH = 'vendor/three.module.js';
export const OFFLINE_RUNTIME_THREE_CORE_PATH = 'vendor/three.core.js';
export const OFFLINE_RUNTIME_THREE_CORE_MIN_PATH = 'vendor/three.core.min.js';
export const OFFLINE_RUNTIME_RAPIER_PATH = 'vendor/rapier.mjs';
export const OFFLINE_RUNTIME_STYLES_PATH = 'runtime.css';

const TEXT_DECODER = new TextDecoder();
const MODULE_SPECIFIER_PATTERN = /\b(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/gu;

function cloneContents(contents: OfflineRuntimeBundleOptions['threeModuleSource']) {
  if (typeof contents === 'string') return contents;
  if (contents instanceof Uint8Array) return new Uint8Array(contents);
  return contents.slice(0);
}

function contentsText(contents: OfflineRuntimeBundleOptions['threeModuleSource']): string {
  if (typeof contents === 'string') return contents;
  return TEXT_DECODER.decode(contents instanceof Uint8Array ? contents : new Uint8Array(contents));
}

function moduleSpecifiers(moduleSource: OfflineRuntimeBundleOptions['threeModuleSource']) {
  return [...contentsText(moduleSource).matchAll(MODULE_SPECIFIER_PATTERN)].map((match) => match[1]);
}

function localThreeDependency(moduleSource: OfflineRuntimeBundleOptions['threeModuleSource']) {
  const specifiers = moduleSpecifiers(moduleSource);
  const unsupported = specifiers.find((specifier) => specifier !== './three.core.js' && specifier !== './three.core.min.js');
  if (unsupported) {
    throw new TypeError(`The embedded Three.js module contains an unsupported dependency ${JSON.stringify(unsupported)}.`);
  }
  if (specifiers.includes('./three.core.js')) return OFFLINE_RUNTIME_THREE_CORE_PATH;
  if (specifiers.includes('./three.core.min.js')) return OFFLINE_RUNTIME_THREE_CORE_MIN_PATH;
  return null;
}

/**
 * Produces the complete runtime namespace consumed by buildOfflineZip.
 * Three.js is embedded as a local sibling module, making every import in the
 * runtime resolvable from the archive with the network disabled.
 */
export function createOfflineRuntimeBundle(options: OfflineRuntimeBundleOptions): OfflineRuntimeBundle {
  const threeModuleSource = cloneContents(options.threeModuleSource);
  const corePath = localThreeDependency(threeModuleSource);
  if (corePath && options.threeCoreModuleSource === undefined) {
    throw new TypeError(`The embedded Three.js module imports ${JSON.stringify(`./${corePath.slice('vendor/'.length)}`)} but no core module source was supplied.`);
  }
  if (options.threeCoreModuleSource !== undefined && localThreeDependency(options.threeCoreModuleSource)) {
    throw new TypeError('The embedded Three.js core module must not contain another module dependency.');
  }
  const files: BuildFileInput[] = [
    {
      path: OFFLINE_RUNTIME_ENTRY_PATH,
      contents: OFFLINE_RUNTIME_ENTRY_SOURCE,
      mediaType: 'text/javascript; charset=utf-8',
      compression: 'deflate',
    },
    {
      path: OFFLINE_RUNTIME_THREE_PATH,
      contents: threeModuleSource,
      mediaType: 'text/javascript; charset=utf-8',
      compression: 'deflate',
    },
    {
      path: OFFLINE_RUNTIME_STYLES_PATH,
      contents: OFFLINE_RUNTIME_STYLES_SOURCE,
      mediaType: 'text/css; charset=utf-8',
      compression: 'deflate',
    },
  ];
  if (corePath && options.threeCoreModuleSource !== undefined) {
    files.push({
      path: corePath,
      contents: cloneContents(options.threeCoreModuleSource),
      mediaType: 'text/javascript; charset=utf-8',
      compression: 'deflate',
    });
  }
  if (options.rapierModuleSource !== undefined) {
    const rapierModuleSource = cloneContents(options.rapierModuleSource);
    const rapierDependencies = moduleSpecifiers(rapierModuleSource);
    if (rapierDependencies.length > 0) {
      throw new TypeError(`The embedded Rapier compatibility module must be self-contained; found ${JSON.stringify(rapierDependencies[0])}.`);
    }
    files.push({
      path: OFFLINE_RUNTIME_RAPIER_PATH,
      contents: rapierModuleSource,
      mediaType: 'text/javascript; charset=utf-8',
      compression: 'deflate',
    });
  }
  return Object.freeze({
    entry: OFFLINE_RUNTIME_ENTRY_PATH,
    files: Object.freeze(files.map((file) => Object.freeze(file))),
  });
}
