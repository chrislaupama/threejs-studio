import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker.js?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';

interface MonacoWorkerEnvironment {
  getWorker(moduleId: string, label: string): Worker;
}

type MonacoGlobal = typeof globalThis & {
  MonacoEnvironment?: MonacoWorkerEnvironment;
};

/**
 * Monaco does not discover Vite worker URLs automatically. Register explicit
 * worker constructors before importing the editor so language services never
 * fall back to the UI thread.
 */
export function configureMonacoEnvironment() {
  const target = globalThis as MonacoGlobal;
  if (target.MonacoEnvironment?.getWorker) return;
  target.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === 'json') return new JsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
      if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
      return new EditorWorker();
    },
  };
}
