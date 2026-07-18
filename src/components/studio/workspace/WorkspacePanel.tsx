import type { ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { StudioPanelId, StudioWorkspaceId } from './layoutModel';
import {
  DEFAULT_STUDIO_PANEL_REGISTRY,
  type StudioPanelDefinition,
  type StudioPanelRegistry,
} from './panelRegistry';

export interface StudioPanelRenderContext {
  panelId: StudioPanelId;
  workspaceId: StudioWorkspaceId;
  mobile: boolean;
}

export type StudioPanelSlot = ReactNode | ((context: StudioPanelRenderContext) => ReactNode);
export type StudioPanelSlots = Partial<Record<StudioPanelId, StudioPanelSlot>>;

export interface WorkspacePanelProps {
  panelId: StudioPanelId;
  workspaceId: StudioWorkspaceId;
  slots: StudioPanelSlots;
  registry?: StudioPanelRegistry;
  mobile?: boolean;
  hideHeader?: boolean;
  className?: string;
}

export function resolveStudioPanelSlot(
  slot: StudioPanelSlot | undefined,
  context: StudioPanelRenderContext,
): ReactNode {
  return typeof slot === 'function' ? slot(context) : slot;
}

const missingPanel = (definition: StudioPanelDefinition) => (
  <div className="flex min-h-24 items-center justify-center p-4 text-center text-xs text-muted-foreground">
    Provide the {definition.label} panel through the workspace slot map.
  </div>
);

export function WorkspacePanel({
  panelId,
  workspaceId,
  slots,
  registry = DEFAULT_STUDIO_PANEL_REGISTRY,
  mobile = false,
  hideHeader = false,
  className,
}: WorkspacePanelProps) {
  const definition = registry.get(panelId);
  if (!definition) return null;
  const content = resolveStudioPanelSlot(slots[panelId], { panelId, workspaceId, mobile })
    ?? missingPanel(definition);
  const body = definition.scrollable
    ? <ScrollArea className="min-h-0 flex-1">{content}</ScrollArea>
    : <div className="min-h-0 flex-1 overflow-hidden">{content}</div>;

  return (
    <section
      aria-label={definition.label}
      data-panel-id={panelId}
      data-workspace-id={workspaceId}
      className={cn('flex size-full min-h-0 min-w-0 flex-col bg-background', className)}
    >
      {!hideHeader && (
        <header className="flex h-8 shrink-0 items-center border-b border-border bg-muted/35 px-2">
          <h2 className="truncate font-heading text-xs font-medium text-foreground">
            {definition.label}
          </h2>
        </header>
      )}
      {body}
    </section>
  );
}
