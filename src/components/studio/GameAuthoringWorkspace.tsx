import { Braces, Gamepad2, LayoutTemplate, PackageCheck, Play, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listProjectScripts, upsertProjectScript } from '@/editor/gameAuthoring';
import type { ProjectDocumentV5 } from '@/editor/types';
import { DEFAULT_BEHAVIOR_SOURCE } from '@/scripting/studioSdkContract';
import {
  ScriptWorkspace,
  type ScriptWorkspaceDiagnostic,
  type ScriptWorkspaceFile,
} from './ScriptWorkspace';

interface DraftScript extends ScriptWorkspaceFile {
  assetId: string;
  originalSource: string;
}

export interface GameAuthoringWorkspaceProps {
  project: ProjectDocumentV5;
  revision: number;
  readOnly?: boolean;
  onCommitProject: (project: ProjectDocumentV5, label: string) => boolean;
  onBuild: () => void | Promise<unknown>;
  onPlay: () => void;
  onClose: () => void;
}

function draftsFromProject(project: ProjectDocumentV5): DraftScript[] {
  return listProjectScripts(project).map((script) => ({
    id: script.assetId,
    assetId: script.assetId,
    path: script.path,
    language: script.language,
    source: script.source,
    originalSource: script.source,
    dirty: false,
  }));
}

export function GameAuthoringWorkspace({
  project,
  revision,
  readOnly = false,
  onCommitProject,
  onBuild,
  onPlay,
  onClose,
}: GameAuthoringWorkspaceProps) {
  const [files, setFiles] = useState<DraftScript[]>(() => draftsFromProject(project));
  const [activeFileId, setActiveFileId] = useState<string | null>(() => files[0]?.id ?? null);
  const [pendingSaveId, setPendingSaveId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ScriptWorkspaceDiagnostic[]>([]);

  useEffect(() => {
    const next = draftsFromProject(project);
    setFiles(next);
    setActiveFileId((current) => next.some((file) => file.id === current) ? current : next[0]?.id ?? null);
  }, [project.id, project.updatedAt]);

  const projectScripts = useMemo(() => listProjectScripts(project), [project]);
  const pendingFile = files.find((file) => file.id === pendingSaveId) ?? null;

  const createFile = () => {
    let index = 1;
    while (files.some((file) => file.path === `scripts/behavior${index}.ts`)) index += 1;
    const id = `asset.script.behavior-${index}`;
    const next: DraftScript = {
      id,
      assetId: id,
      path: `scripts/behavior${index}.ts`,
      language: 'typescript',
      source: DEFAULT_BEHAVIOR_SOURCE,
      originalSource: '',
      dirty: true,
    };
    setFiles((current) => [...current, next]);
    setActiveFileId(id);
  };

  const confirmSave = () => {
    if (!pendingFile) return;
    const result = upsertProjectScript(project, {
      assetId: pendingFile.assetId,
      path: pendingFile.path,
      source: pendingFile.source,
      timestamp: new Date().toISOString(),
    });
    if (!result.ok) {
      setDiagnostics(result.errors.map((message) => ({ severity: 'error', message, fileId: pendingFile.id })));
      setPendingSaveId(null);
      return;
    }
    if (onCommitProject(result.project, `Update script · ${pendingFile.path}`)) {
      setDiagnostics([]);
    }
    setPendingSaveId(null);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background text-foreground" aria-label="Game authoring workspace" data-testid="game-authoring-workspace">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card/40 px-3">
        <div className="min-w-0 flex-1">
          <strong className="font-heading text-sm">Game Authoring</strong>
          <span className="ml-3 text-[10px] text-muted-foreground">Schema v5 · revision {revision}</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onPlay}><Play data-icon="inline-start" /> Play</Button>
        <Button type="button" size="sm" onClick={() => void onBuild()}><PackageCheck data-icon="inline-start" /> Build</Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close game authoring workspace" onClick={onClose}><X /></Button>
      </header>

      <Tabs defaultValue="scripts" className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="h-9 w-full shrink-0 justify-start rounded-none border-b border-border bg-card/20 px-2">
          <TabsTrigger value="scripts"><Braces /> Scripts <Badge variant="secondary">{projectScripts.length}</Badge></TabsTrigger>
          <TabsTrigger value="input"><Gamepad2 /> Input <Badge variant="secondary">{project.inputMaps.flatMap((map) => map.actions).length}</Badge></TabsTrigger>
          <TabsTrigger value="ui"><LayoutTemplate /> Game UI <Badge variant="secondary">{project.ui.documents.length}</Badge></TabsTrigger>
          <TabsTrigger value="build"><PackageCheck /> Build</TabsTrigger>
        </TabsList>

        <TabsContent value="scripts" className="min-h-0 flex-1">
          <ScriptWorkspace
            files={files}
            activeFileId={activeFileId}
            diagnostics={diagnostics}
            readOnly={readOnly}
            onSelectFile={setActiveFileId}
            onCreateFile={createFile}
            onChangeFile={(fileId, source) => setFiles((current) => current.map((file) => file.id === fileId
              ? { ...file, source, dirty: source !== file.originalSource }
              : file))}
            onSaveFile={setPendingSaveId}
          />
        </TabsContent>

        <TabsContent value="input" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="grid gap-3 p-4 lg:grid-cols-2">
              {project.inputMaps.map((map) => (
                <Card key={map.id}>
                  <CardHeader><CardTitle>{map.name}</CardTitle><CardDescription>{map.enabled ? 'Enabled' : 'Disabled'} · priority {map.priority}</CardDescription></CardHeader>
                  <CardContent className="grid gap-2">
                    {map.actions.map((action) => (
                      <div key={action.id} className="flex min-h-9 items-center gap-2 border border-border px-3">
                        <strong className="min-w-0 flex-1 truncate text-xs">{action.name}</strong>
                        <Badge variant="outline">{action.type}</Badge>
                        <span className="text-[10px] text-muted-foreground">{action.bindings.length} bindings</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="ui" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="grid gap-3 p-4 lg:grid-cols-2">
              {project.ui.documents.map((document) => (
                <Card key={document.id}>
                  <CardHeader><CardTitle>{document.name}</CardTitle><CardDescription>{document.sceneId ? `Scene ${document.sceneId}` : 'Global game UI'}</CardDescription></CardHeader>
                  <CardContent><span className="text-xs text-muted-foreground">{document.elements.length} accessible runtime elements · {document.rootElementIds.length} roots</span></CardContent>
                </Card>
              ))}
              {!project.ui.documents.length ? <Card><CardHeader><CardTitle>No game UI yet</CardTitle><CardDescription>Runtime UI is serializable DOM/CSS and remains independent from shadcn.</CardDescription></CardHeader></Card> : null}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="build" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="grid gap-3 p-4 lg:grid-cols-3">
              {project.buildProfiles.map((profile) => (
                <Card key={profile.id} className={profile.id === project.defaultBuildProfileId ? 'ring-1 ring-[var(--studio-brand)]' : ''}>
                  <CardHeader><CardTitle>{profile.name}</CardTitle><CardDescription>{profile.target} · {profile.mode} · {profile.quality} quality</CardDescription></CardHeader>
                  <CardContent className="grid gap-3">
                    <div className="flex gap-2"><Badge variant={profile.offline ? 'default' : 'outline'}>{profile.offline ? 'Offline' : 'Networked'}</Badge><Badge variant="outline">{profile.basePath}</Badge></div>
                    {profile.id === project.defaultBuildProfileId ? <Button type="button" size="sm" onClick={() => void onBuild()}><PackageCheck data-icon="inline-start" /> Build default</Button> : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <AlertDialog open={Boolean(pendingFile)} onOpenChange={(open) => { if (!open) setPendingSaveId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply executable code change?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingFile ? `${pendingFile.path} will become script revision ${(projectScripts.find((script) => script.assetId === pendingFile.assetId)?.revision ?? 0) + 1}. The change is validated, autosaved, and one-step undoable.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>Save behavior</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
