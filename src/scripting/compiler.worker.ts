/// <reference lib="webworker" />

import wasmURL from 'esbuild-wasm/esbuild.wasm?url';
import { createWorkerScriptCompiler } from './compiler';
import { installScriptCompilerWorker, ScriptCompilerWorkerController, type ScriptCompilerWorkerScope } from './compilerWorker';

const compiler = createWorkerScriptCompiler(wasmURL);
const controller = new ScriptCompilerWorkerController(compiler);

installScriptCompilerWorker(globalThis as unknown as ScriptCompilerWorkerScope, controller);
