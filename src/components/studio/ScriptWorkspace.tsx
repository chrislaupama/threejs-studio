import { FileCode2, Plus, Save, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface ScriptWorkspaceFile {
  id: string;
  path: string;
  language: 'typescript' | 'javascript';
  source: string;
  dirty?: boolean;
}

export interface ScriptWorkspaceDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  fileId?: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface ScriptWorkspaceProps {
  files: ScriptWorkspaceFile[];
  activeFileId: string | null;
  diagnostics: ScriptWorkspaceDiagnostic[];
  readOnly?: boolean;
  onSelectFile: (fileId: string) => void;
  onCreateFile: () => void;
  onCloseFile?: (fileId: string) => void;
  onChangeFile: (fileId: string, source: string) => void;
  onSaveFile: (fileId: string) => void;
  onOpenDiagnostic?: (diagnostic: ScriptWorkspaceDiagnostic) => void;
}

const studioSdkDeclaration = `
declare module '@threejs-studio/runtime' {
  export type Vec3 = readonly [number, number, number];
  export interface BehaviorContext {
    readonly entityId: string;
    readonly time: { readonly delta: number; readonly fixedDelta: number; readonly elapsed: number };
    input: { value(actionId: string): number | Vec3; pressed(actionId: string): boolean };
    variables: { get(name: string): unknown; set(name: string, value: unknown): void };
    events: { emit(name: string, payload?: Record<string, unknown>): void };
    transform: { position(): Vec3; setPosition(value: Vec3): void; translate(value: Vec3): void };
  }
  export interface BehaviorDefinition {
    schema?: Record<string, unknown>;
    onStart?(context: BehaviorContext): void;
    onFixedUpdate?(context: BehaviorContext): void;
    onUpdate?(context: BehaviorContext): void;
    onEvent?(context: BehaviorContext, event: { name: string; payload?: Record<string, unknown> }): void;
    onDestroy?(context: BehaviorContext): void;
  }
  export function defineBehavior(definition: BehaviorDefinition): BehaviorDefinition;
}
`;

interface MonacoTypeScriptApi {
  typescriptDefaults: {
    setCompilerOptions(options: Record<string, unknown>): void;
    addExtraLib(source: string, path: string): { dispose(): void };
  };
  ModuleKind: { ESNext: number };
  ModuleResolutionKind: { NodeJs: number };
  ScriptTarget: { ES2022: number };
}

function diagnosticLocation(diagnostic: ScriptWorkspaceDiagnostic) {
  if (!diagnostic.line) return '';
  return `${diagnostic.line}:${diagnostic.column ?? 1}`;
}

export function ScriptWorkspace({
  files,
  activeFileId,
  diagnostics,
  readOnly = false,
  onSelectFile,
  onCreateFile,
  onCloseFile,
  onChangeFile,
  onSaveFile,
  onOpenDiagnostic,
}: ScriptWorkspaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const changeHandlerRef = useRef(onChangeFile);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const activeFile = files.find((file) => file.id === activeFileId) ?? null;
  const activeSourceRef = useRef(activeFile?.source ?? '');
  const activeIdRef = useRef(activeFile?.id ?? null);

  changeHandlerRef.current = onChangeFile;
  activeSourceRef.current = activeFile?.source ?? '';
  activeIdRef.current = activeFile?.id ?? null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !activeFile) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    let disposeEditor: (() => void) | undefined;
    setLoading(true);
    setLoadError(null);

    void import('./monacoEnvironment').then(({ configureMonacoEnvironment }) => {
      configureMonacoEnvironment();
      return Promise.all([
        import('monaco-editor'),
        import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
      ]);
    }).then(([monaco]) => {
      if (cancelled) return;
      const typescript = (monaco.languages as unknown as { typescript: MonacoTypeScriptApi }).typescript;
      typescript.typescriptDefaults.setCompilerOptions({
        allowNonTsExtensions: true,
        module: typescript.ModuleKind.ESNext,
        moduleResolution: typescript.ModuleResolutionKind.NodeJs,
        strict: true,
        target: typescript.ScriptTarget.ES2022,
        noEmit: true,
      });
      const sdk = typescript.typescriptDefaults.addExtraLib(
        studioSdkDeclaration,
        'file:///node_modules/@threejs-studio/runtime/index.d.ts',
      );
      const uri = monaco.Uri.parse(`file:///${activeFile.path.replace(/^\/+/, '')}`);
      const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(
        activeFile.source,
        activeFile.language,
        uri,
      );
      if (model.getValue() !== activeFile.source) model.setValue(activeFile.source);
      const editor = monaco.editor.create(host, {
        model,
        automaticLayout: true,
        readOnly,
        minimap: { enabled: false },
        fontFamily: '"Geist Mono Variable", ui-monospace, monospace',
        fontSize: 12,
        lineHeight: 19,
        padding: { top: 10 },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 2,
        theme: 'vs-dark',
        ariaLabel: `Script editor for ${activeFile.path}`,
      });
      const contentSubscription = editor.onDidChangeModelContent(() => {
        const fileId = activeIdRef.current;
        if (fileId) changeHandlerRef.current(fileId, editor.getValue());
      });
      disposeEditor = () => {
        contentSubscription.dispose();
        editor.dispose();
        sdk.dispose();
      };
      setLoading(false);
      editor.focus();
    }).catch((error: unknown) => {
      if (cancelled) return;
      setLoading(false);
      setLoadError(error instanceof Error ? error.message : 'The code editor could not be loaded.');
    });

    return () => {
      cancelled = true;
      disposeEditor?.();
    };
  }, [activeFile?.id, activeFile?.language, activeFile?.path, readOnly]);

  useEffect(() => {
    if (!activeFile || loading) return;
    void import('monaco-editor').then((monaco) => {
      const model = monaco.editor.getModel(monaco.Uri.parse(`file:///${activeFile.path.replace(/^\/+/, '')}`));
      if (model && model.getValue() !== activeFile.source) model.setValue(activeFile.source);
    });
  }, [activeFile?.source, activeFile?.path, loading]);

  const diagnosticCounts = useMemo(() => diagnostics.reduce((counts, diagnostic) => ({
    ...counts,
    [diagnostic.severity]: counts[diagnostic.severity] + 1,
  }), { error: 0, warning: 0, info: 0 }), [diagnostics]);

  return (
    <section className="flex min-h-0 flex-1 bg-background text-foreground" aria-label="Scripts workspace">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card/40">
        <header className="flex h-9 items-center justify-between px-2">
          <strong className="font-heading text-xs">Scripts</strong>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Create script" onClick={onCreateFile} disabled={readOnly}>
            <Plus />
          </Button>
        </header>
        <Separator />
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-1">
            {files.map((file) => (
              <button
                type="button"
                key={file.id}
                className={`group flex h-7 w-full items-center gap-2 px-2 text-left text-xs hover:bg-muted ${file.id === activeFileId ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                onClick={() => onSelectFile(file.id)}
                aria-current={file.id === activeFileId ? 'page' : undefined}
              >
                <FileCode2 className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
                {file.dirty ? <span className="size-1.5 rounded-full bg-[var(--studio-brand)]" aria-label="Unsaved" /> : null}
              </button>
            ))}
            {!files.length ? (
              <div className="grid min-h-32 place-items-center px-4 text-center text-xs text-muted-foreground">
                <span>No scripts yet. Create a behavior to start programming your game.</span>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-9 items-center border-b border-border bg-card/30">
          <div className="flex min-w-0 flex-1 overflow-x-auto">
            {files.map((file) => (
              <div
                key={file.id}
                className={`flex h-9 min-w-32 max-w-56 items-center border-r border-border text-xs ${file.id === activeFileId ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}
              >
                <button
                  type="button"
                  className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left"
                  onClick={() => onSelectFile(file.id)}
                  aria-current={file.id === activeFileId ? 'page' : undefined}
                >
                  <span className="min-w-0 flex-1 truncate">{file.path.split('/').at(-1)}</span>
                  {file.dirty ? <span className="text-[var(--studio-brand)]" aria-label="Unsaved">●</span> : null}
                </button>
                {onCloseFile ? (
                  <button
                    type="button"
                    aria-label={`Close ${file.path}`}
                    className="mr-1 grid size-6 shrink-0 place-items-center hover:bg-muted"
                    onClick={() => onCloseFile(file.id)}
                  ><X className="size-3" /></button>
                ) : null}
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!activeFile || readOnly}
            onClick={() => activeFile && onSaveFile(activeFile.id)}
          >
            <Save data-icon="inline-start" /> Save
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Search scripts">
            <Search />
          </Button>
        </header>

        <div className="relative min-h-48 flex-1 bg-[#0d1015]">
          {!activeFile ? (
            <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Open or create a script.</div>
          ) : null}
          {activeFile ? <div ref={hostRef} className="absolute inset-0" /> : null}
          {loading && activeFile ? <div className="absolute inset-0 grid place-items-center bg-background/70"><Spinner className="size-5" /></div> : null}
          {loadError ? (
            <Alert variant="destructive" className="absolute inset-x-4 top-4">
              <AlertTitle>Code editor unavailable</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <Tabs defaultValue="problems" className="h-40 gap-0 border-t border-border bg-card/30">
          <TabsList variant="line" className="h-8 px-2">
            <TabsTrigger value="problems">Problems <Badge variant={diagnosticCounts.error ? 'destructive' : 'secondary'}>{diagnostics.length}</Badge></TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
          </TabsList>
          <TabsContent value="problems" className="min-h-0 overflow-auto px-2 pb-2">
            {diagnostics.map((diagnostic, index) => (
              <button
                type="button"
                key={`${diagnostic.code ?? diagnostic.severity}-${index}`}
                className="flex min-h-7 w-full items-start gap-2 px-2 py-1 text-left hover:bg-muted"
                onClick={() => onOpenDiagnostic?.(diagnostic)}
              >
                <Badge variant={diagnostic.severity === 'error' ? 'destructive' : 'outline'}>{diagnostic.severity}</Badge>
                <span className="min-w-0 flex-1 text-xs">{diagnostic.message}</span>
                <code className="text-[10px] text-muted-foreground">{diagnosticLocation(diagnostic)}</code>
              </button>
            ))}
            {!diagnostics.length ? <div className="px-2 py-3 text-xs text-muted-foreground">No script problems.</div> : null}
          </TabsContent>
          <TabsContent value="output" className="px-4 py-3 text-muted-foreground">Compile and runtime output appears in the Console panel.</TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
