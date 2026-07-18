import type { PropsWithChildren } from 'react';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export function EditorUIProvider({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      storageKey="threejs-studio:theme"
      disableTransitionOnChange
    >
      {/* Generated Base UI overlays portal to document.body so every editor surface shares one stack. */}
      <TooltipProvider delay={450}>
        {children}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
