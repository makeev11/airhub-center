import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { isMacPlatform } from "@/shared/lib/platform";
import { useIsFullscreen } from "@/shared/lib/useIsFullscreen";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { topChromeBackdrop } from "@/shared/layout/chromeLayout";
import { useOptionalSidebar } from "@/shared/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

type AppTopChromeProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  hasCommunityRail?: boolean;
};

// Fixed px on purpose (button box + glyph): these controls sit beside the
// native macOS traffic lights, which ignore the app's Cmd +/- text zoom, so
// the row must not grow or shrink with the rem scale. Deliberate exception
// to the rem-first rule.
const TOP_CHROME_ICON_BUTTON_CLASS =
  "h-[28px] w-[28px] cursor-pointer rounded-[6px] text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-[16px]";
const HISTORY_ICON_BUTTON_CLASS =
  "h-[28px] w-[28px] cursor-pointer rounded-[6px] text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-[16px]";

function TopChromeControlTooltip({
  children,
  label,
  shortcut,
  testId,
}: {
  children: React.ReactNode;
  label: string;
  shortcut: string[];
  testId: string;
}) {
  return (
    <Tooltip delayDuration={1_500}>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-pointer has-[button:disabled]:cursor-default">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent
        align="center"
        className="rounded-lg bg-neutral-950 px-3 py-2.5 text-white shadow-xl"
        data-testid={testId}
        side="bottom"
        sideOffset={8}
      >
        <div className="grid gap-2">
          <span className="text-sm font-semibold leading-none">{label}</span>
          <span className="flex items-center gap-1">
            {shortcut.map((key) => (
              <kbd
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-black/70 px-1.5 font-mono text-xs font-semibold text-white ring-1 ring-white/15"
                key={key}
              >
                {key}
              </kbd>
            ))}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function preventTopChromeWheel(event: WheelEvent) {
  event.preventDefault();
}

function TopChromeSidebarTrigger() {
  const isRussian = useAirHopLocale() === "ru-RU";
  const isMac = isMacPlatform();
  const sidebar = useOptionalSidebar();
  const label = sidebar?.open
    ? isRussian
      ? "Скрыть боковую панель"
      : "Hide sidebar"
    : isRussian
      ? "Показать боковую панель"
      : "Show sidebar";

  return (
    <TopChromeControlTooltip
      label={label}
      shortcut={isMac ? ["⌘", "S"] : ["Ctrl", "S"]}
      testId="top-chrome-sidebar-tooltip"
    >
      <Button
        aria-label={label}
        className={TOP_CHROME_ICON_BUTTON_CLASS}
        data-sidebar="trigger"
        disabled={!sidebar}
        onClick={() => {
          sidebar?.toggleSidebar();
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        {sidebar?.open ? <PanelLeftClose /> : <PanelLeftOpen />}
        <span className="sr-only">{label}</span>
      </Button>
    </TopChromeControlTooltip>
  );
}

export function AppTopChrome({
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  hasCommunityRail = false,
}: AppTopChromeProps) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const topChromeRef = React.useRef<HTMLDivElement>(null);
  const isFullscreen = useIsFullscreen();
  const isMac = isMacPlatform();
  // On macOS the traffic-light buttons overlay the chrome (see
  // `trafficLightPosition` in `tauri.conf.json`), so the nav row clears their
  // x-position. When the community rail is present it already occupies the far
  // left, so the nav row only needs to clear the lights past the rail edge
  // rather than the full offset. In fullscreen those buttons hide.
  //
  // Fixed px on purpose: the native traffic lights do not scale with the app's
  // Cmd +/- text zoom (rem), so rem-based clearance shrinks under them when
  // zoomed out. This is a deliberate exception to the rem-first rule.
  const macChrome = isMac && !isFullscreen;
  const navRowPaddingClass = macChrome
    ? hasCommunityRail
      ? "pl-[32px]"
      : "pl-[88px]"
    : "pl-3";
  const navRowAlignmentClass = macChrome ? "translate-y-[3px]" : null;

  React.useEffect(() => {
    const topChrome = topChromeRef.current;
    if (!topChrome) {
      return;
    }

    const options = { capture: true, passive: false };
    topChrome.addEventListener("wheel", preventTopChromeWheel, options);
    return () => {
      topChrome.removeEventListener("wheel", preventTopChromeWheel, options);
    };
  }, []);

  return (
    <div
      ref={topChromeRef}
      className={cn(
        "relative z-45 flex shrink-0 cursor-default select-none items-center bg-sidebar pr-3 text-sidebar-foreground",
        topChromeBackdrop.height,
        navRowPaddingClass,
      )}
      data-tauri-drag-region
      data-testid="app-top-chrome"
    >
      <div className={cn("flex items-center gap-1", navRowAlignmentClass)}>
        <TopChromeSidebarTrigger />
        <TopChromeControlTooltip
          label={isRussian ? "Назад в истории" : "Back in history"}
          shortcut={isMac ? ["⌘", "["] : ["Alt", "←"]}
          testId="global-back-tooltip"
        >
          <Button
            aria-label={isRussian ? "Назад в истории" : "Back in history"}
            className={HISTORY_ICON_BUTTON_CLASS}
            data-testid="global-back"
            disabled={!canGoBack}
            onClick={onGoBack}
            size="icon"
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
        </TopChromeControlTooltip>
        <TopChromeControlTooltip
          label={isRussian ? "Вперёд по истории" : "Forward in history"}
          shortcut={isMac ? ["⌘", "]"] : ["Alt", "→"]}
          testId="global-forward-tooltip"
        >
          <Button
            aria-label={isRussian ? "Вперёд по истории" : "Forward in history"}
            className={HISTORY_ICON_BUTTON_CLASS}
            data-testid="global-forward"
            disabled={!canGoForward}
            onClick={onGoForward}
            size="icon"
            variant="ghost"
          >
            <ChevronRight />
          </Button>
        </TopChromeControlTooltip>
      </div>
    </div>
  );
}
