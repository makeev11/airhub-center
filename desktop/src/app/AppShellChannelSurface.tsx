import type * as React from "react";
import * as BuzzTheme from "@/app/BuzzThemeSurfaces";
import { MainInsetProvider } from "@/shared/layout/MainInsetContext";
import { chromeCssVarDefaults } from "@/shared/layout/chromeLayout";
import { SidebarInset } from "@/shared/ui/sidebar";

type AppShellChannelSurfaceProps = {
  children: React.ReactNode;
  mainInsetRef: React.RefObject<HTMLElement | null>;
};

export function AppShellChannelSurface({
  children,
  mainInsetRef,
}: AppShellChannelSurfaceProps) {
  return (
    <MainInsetProvider mainInsetRef={mainInsetRef}>
      <SidebarInset
        ref={mainInsetRef}
        className="isolate z-0 min-h-0 min-w-0 overflow-hidden bg-sidebar"
        data-buzz-glass-inset
        data-buzz-shadow-viewport
        style={chromeCssVarDefaults as React.CSSProperties}
      >
        <BuzzTheme.ContentSurface>{children}</BuzzTheme.ContentSurface>
      </SidebarInset>
    </MainInsetProvider>
  );
}
