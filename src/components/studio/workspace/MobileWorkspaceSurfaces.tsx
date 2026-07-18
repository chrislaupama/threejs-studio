import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { StudioPanelId, StudioWorkspaceLayout } from './layoutModel';
import {
  DEFAULT_STUDIO_PANEL_REGISTRY,
  type StudioPanelDefinition,
  type StudioPanelRegistry,
} from './panelRegistry';
import { WorkspacePanel, type StudioPanelSlots } from './WorkspacePanel';

interface MobilePanelSurfaceProps {
  definition: StudioPanelDefinition;
  layout: StudioWorkspaceLayout;
  slots: StudioPanelSlots;
  registry: StudioPanelRegistry;
}

const mobileTrigger = (label: string) => (
  <Button
    variant="ghost"
    size="lg"
    className="min-h-11 min-w-11 flex-1 rounded-none px-2"
    aria-label={`Open ${label} panel`}
  />
);

function MobilePanelSurface({ definition, layout, slots, registry }: MobilePanelSurfaceProps) {
  const panel = (
    <WorkspacePanel
      panelId={definition.id}
      workspaceId={layout.workspaceId}
      slots={slots}
      registry={registry}
      mobile
      hideHeader
    />
  );

  if (definition.mobileSurface === 'bottom-drawer') {
    return (
      <Drawer showSwipeHandle>
        <DrawerTrigger render={mobileTrigger(definition.label)}>{definition.label}</DrawerTrigger>
        <DrawerContent className="h-[min(76dvh,42rem)]">
          <DrawerHeader className="border-b border-border pb-3 text-left">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DrawerTitle>{definition.label}</DrawerTitle>
                <DrawerDescription>{definition.description}</DrawerDescription>
              </div>
              <DrawerClose render={<Button variant="ghost" size="sm" />}>Close</DrawerClose>
            </div>
          </DrawerHeader>
          <div className="min-h-0 flex-1">{panel}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  const side = definition.mobileSurface === 'left-sheet' ? 'left' : 'right';
  return (
    <Sheet>
      <SheetTrigger render={mobileTrigger(definition.label)}>{definition.label}</SheetTrigger>
      <SheetContent side={side} className="w-[min(92vw,26rem)] sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{definition.label}</SheetTitle>
          <SheetDescription>{definition.description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1">{panel}</div>
      </SheetContent>
    </Sheet>
  );
}

export interface MobileWorkspaceSurfacesProps {
  layout: StudioWorkspaceLayout;
  slots: StudioPanelSlots;
  registry?: StudioPanelRegistry;
  leading?: ReactNode;
  className?: string;
}

export function MobileWorkspaceSurfaces({
  layout,
  slots,
  registry = DEFAULT_STUDIO_PANEL_REGISTRY,
  leading,
  className,
}: MobileWorkspaceSurfacesProps) {
  const openPanelIds = new Set(layout.panels.filter((panel) => panel.open).map((panel) => panel.panelId));
  const workspacePanels = registry.listForWorkspace(layout.workspaceId);
  const primary = workspacePanels.find((definition) => (
    definition.mobileSurface === 'primary' && openPanelIds.has(definition.id)
  )) ?? workspacePanels.find((definition) => (
    definition.region === 'center' && openPanelIds.has(definition.id)
  ));
  const surfaces = workspacePanels.filter((definition) => (
    definition.id !== primary?.id && openPanelIds.has(definition.id)
  ));

  return (
    <div className={cn('flex size-full min-h-0 flex-col bg-background md:hidden', className)}>
      {leading}
      <main className="min-h-0 flex-1" aria-label="Mobile workspace">
        {primary ? (
          <WorkspacePanel
            panelId={primary.id}
            workspaceId={layout.workspaceId}
            slots={slots}
            registry={registry}
            mobile
            hideHeader
          />
        ) : (
          <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Open an editor panel from the toolbar.
          </div>
        )}
      </main>
      <nav
        aria-label="Mobile editor panels"
        className="grid shrink-0 auto-cols-fr grid-flow-col overflow-x-auto border-t border-border bg-background p-1 pb-[max(.25rem,env(safe-area-inset-bottom))]"
      >
        {surfaces.map((definition) => (
          <MobilePanelSurface
            key={definition.id}
            definition={definition}
            layout={layout}
            slots={slots}
            registry={registry}
          />
        ))}
      </nav>
    </div>
  );
}

export function listMobileSurfacePanelIds(
  layout: StudioWorkspaceLayout,
  registry: StudioPanelRegistry = DEFAULT_STUDIO_PANEL_REGISTRY,
): StudioPanelId[] {
  const open = new Set(layout.panels.filter((panel) => panel.open).map((panel) => panel.panelId));
  return registry.listForWorkspace(layout.workspaceId)
    .filter((definition) => definition.mobileSurface !== 'primary' && open.has(definition.id))
    .map((definition) => definition.id);
}
