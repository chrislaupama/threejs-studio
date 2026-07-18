import { Fragment, type ReactNode } from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { EditorPreferences } from '@/editor/editorPreferences';
import { cn } from '@/lib/utils';
import {
  STUDIO_WORKSPACE_IDS,
  activateStudioPanel,
  applyStudioWorkspaceStateToEditorPreferences,
  findStudioWorkspaceLayout,
  normalizeStudioWorkspaceState,
  resizeStudioSplit,
  selectStudioWorkspace,
  updateStudioWorkspaceLayout,
  type StudioPanelId,
  type StudioWorkspaceLayout,
  type StudioWorkspaceNode,
  type StudioWorkspaceSplitNode,
  type StudioWorkspaceStackNode,
  type StudioWorkspaceState,
} from './layoutModel';
import { MobileWorkspaceSurfaces } from './MobileWorkspaceSurfaces';
import {
  DEFAULT_STUDIO_PANEL_REGISTRY,
  STUDIO_WORKSPACE_LABELS,
  type StudioPanelRegistry,
} from './panelRegistry';
import { WorkspacePanel, type StudioPanelSlots } from './WorkspacePanel';

const workspaceIdSet = new Set<string>(STUDIO_WORKSPACE_IDS);

const getOpenPanels = (layout: StudioWorkspaceLayout): Set<StudioPanelId> => new Set(
  layout.panels.filter((panel) => panel.open).map((panel) => panel.panelId),
);

const hasOpenPanel = (node: StudioWorkspaceNode, openPanels: ReadonlySet<StudioPanelId>): boolean => (
  node.kind === 'stack'
    ? node.panelIds.some((panelId) => openPanels.has(panelId))
    : node.children.some((child) => hasOpenPanel(child, openPanels))
);

interface WorkspaceNodeViewProps {
  node: StudioWorkspaceNode;
  layout: StudioWorkspaceLayout;
  slots: StudioPanelSlots;
  registry: StudioPanelRegistry;
  onLayoutChange: (layout: StudioWorkspaceLayout) => void;
}

function WorkspaceStackView({
  node,
  layout,
  slots,
  registry,
  onLayoutChange,
}: WorkspaceNodeViewProps & { node: StudioWorkspaceStackNode }) {
  const openPanels = getOpenPanels(layout);
  const panelIds = node.panelIds.filter((panelId) => openPanels.has(panelId));
  if (panelIds.length === 0) return null;
  const activePanelId = panelIds.includes(node.activePanelId) ? node.activePanelId : panelIds[0]!;

  return (
    <Tabs
      value={activePanelId}
      onValueChange={(value) => {
        if (typeof value === 'string' && panelIds.includes(value as StudioPanelId)) {
          onLayoutChange(activateStudioPanel(layout, node.id, value as StudioPanelId));
        }
      }}
      className="size-full min-h-0 gap-0 overflow-hidden border border-border bg-background"
    >
      <TabsList
        variant="line"
        aria-label={`${node.id} panels`}
        className="h-8 w-full shrink-0 justify-start overflow-x-auto border-b border-border bg-muted/30 px-1"
      >
        {panelIds.map((panelId) => (
          <TabsTrigger key={panelId} value={panelId} className="min-w-fit px-2">
            {registry.get(panelId)?.label ?? panelId}
          </TabsTrigger>
        ))}
      </TabsList>
      {panelIds.map((panelId) => (
        <TabsContent key={panelId} value={panelId} className="min-h-0 overflow-hidden">
          <WorkspacePanel
            panelId={panelId}
            workspaceId={layout.workspaceId}
            slots={slots}
            registry={registry}
            hideHeader
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function WorkspaceSplitView({
  node,
  layout,
  slots,
  registry,
  onLayoutChange,
}: WorkspaceNodeViewProps & { node: StudioWorkspaceSplitNode }) {
  const openPanels = getOpenPanels(layout);
  const visibleChildren = node.children.filter((child) => hasOpenPanel(child, openPanels));
  if (visibleChildren.length === 0) return null;
  if (visibleChildren.length === 1) {
    return (
      <WorkspaceNodeView
        node={visibleChildren[0]!}
        layout={layout}
        slots={slots}
        registry={registry}
        onLayoutChange={onLayoutChange}
      />
    );
  }

  const visibleWeight = visibleChildren.reduce((sum, child) => sum + (node.sizes[child.id] ?? 1), 0);
  const defaultLayout = Object.fromEntries(visibleChildren.map((child) => [
    child.id,
    (node.sizes[child.id] ?? 1) / visibleWeight * 100,
  ]));

  return (
    <ResizablePanelGroup
      id={node.id}
      orientation={node.direction}
      defaultLayout={defaultLayout}
      onLayoutChanged={(sizes, meta) => {
        if (meta.isUserInteraction) onLayoutChange(resizeStudioSplit(layout, node.id, sizes));
      }}
      className="size-full min-h-0 min-w-0"
      resizeTargetMinimumSize={{ coarse: 36, fine: 8 }}
    >
      {visibleChildren.map((child, index) => (
        <Fragment key={child.id}>
          <ResizablePanel id={child.id} minSize="8%" className="min-h-0 min-w-0">
            <WorkspaceNodeView
              node={child}
              layout={layout}
              slots={slots}
              registry={registry}
              onLayoutChange={onLayoutChange}
            />
          </ResizablePanel>
          {index < visibleChildren.length - 1 && (
            <ResizableHandle
              withHandle
              aria-label={`Resize ${child.id} and ${visibleChildren[index + 1]?.id ?? 'next'} panels`}
            />
          )}
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

function WorkspaceNodeView(props: WorkspaceNodeViewProps) {
  return props.node.kind === 'stack'
    ? <WorkspaceStackView {...props} node={props.node} />
    : <WorkspaceSplitView {...props} node={props.node} />;
}

export interface StudioWorkspaceShellProps {
  state: StudioWorkspaceState;
  slots: StudioPanelSlots;
  onStateChange: (state: StudioWorkspaceState) => void;
  registry?: StudioPanelRegistry;
  preferences?: EditorPreferences;
  onPreferencesChange?: (preferences: EditorPreferences) => void;
  toolbar?: ReactNode;
  className?: string;
}

export function StudioWorkspaceShell({
  state,
  slots,
  onStateChange,
  registry = DEFAULT_STUDIO_PANEL_REGISTRY,
  preferences,
  onPreferencesChange,
  toolbar,
  className,
}: StudioWorkspaceShellProps) {
  const normalizedState = normalizeStudioWorkspaceState(state);
  const activeLayout = findStudioWorkspaceLayout(normalizedState);
  const emitState = (next: StudioWorkspaceState) => {
    onStateChange(next);
    if (preferences && onPreferencesChange) {
      onPreferencesChange(applyStudioWorkspaceStateToEditorPreferences(next, preferences));
    }
  };
  const updateLayout = (layout: StudioWorkspaceLayout) => emitState(
    updateStudioWorkspaceLayout(normalizedState, layout),
  );

  return (
    <Tabs
      value={activeLayout.workspaceId}
      onValueChange={(value) => {
        if (typeof value === 'string' && workspaceIdSet.has(value)) {
          emitState(selectStudioWorkspace(normalizedState, value as StudioWorkspaceLayout['workspaceId']));
        }
      }}
      className={cn('size-full min-h-0 gap-0 overflow-hidden bg-background text-foreground', className)}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-1">
        <TabsList variant="line" aria-label="Editor workspace" className="h-8 shrink-0">
          {STUDIO_WORKSPACE_IDS.map((workspaceId) => (
            <TabsTrigger key={workspaceId} value={workspaceId} className="px-2.5">
              {STUDIO_WORKSPACE_LABELS[workspaceId]}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-w-0 flex-1">{toolbar}</div>
      </header>
      {normalizedState.layouts.map((layout) => (
        <TabsContent
          key={layout.workspaceId}
          value={layout.workspaceId}
          className="min-h-0 overflow-hidden"
        >
          <div className="hidden size-full min-h-0 p-1 md:block">
            <WorkspaceNodeView
              node={layout.root}
              layout={layout}
              slots={slots}
              registry={registry}
              onLayoutChange={updateLayout}
            />
          </div>
          <MobileWorkspaceSurfaces layout={layout} slots={slots} registry={registry} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
