import * as React from "react";
import { CheckCircle2, Moon, Sun, SunMoon } from "lucide-react";

import {
  BookingWorkspaceProvider,
  useBookingWorkspace,
} from "@/features/booking/data/BookingWorkspaceProvider";
import { createHttpBookingSettingsRepository } from "@/features/booking/data/httpBookingSettingsRepository";
import { currentAirhopStaffDataRuntime } from "@/features/booking/data/staffDataRuntime";
import type { PublicBookingAppearance } from "@/features/booking/model/bookingCore";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { PublicBookingShell } from "@/features/booking/ui/PublicBookingShell";
import type { AppearanceMessages } from "@/features/settings/lib/appearanceLocale";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

const APPEARANCE_OPTIONS = [
  { value: "automatic" as const, Icon: SunMoon },
  { value: "light" as const, Icon: Sun },
  { value: "dark" as const, Icon: Moon },
];

function WidgetPreview({
  appearance,
  messages,
  organizationName,
}: {
  appearance: PublicBookingAppearance;
  messages: AppearanceMessages;
  organizationName: string;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-3 text-sm font-medium">{messages.widgetPreview}</p>
      <div className="h-80 overflow-hidden rounded-2xl border border-border/70 bg-muted/20 p-2 shadow-sm">
        <PublicBookingShell
          appearance={appearance}
          mode="embedded"
          testId="airhop-appearance-widget-preview"
        >
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden text-left">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {messages.widgetHeading} · {organizationName}
              </p>
              <span className="shrink-0 text-xs text-muted-foreground">
                {messages.widgetStep}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/5 rounded-full bg-primary" />
            </div>
            <div className="min-h-0 flex-1 rounded-2xl border border-border bg-card p-4 text-card-foreground">
              <h3 className="text-lg font-semibold">
                {messages.widgetHeading}
              </h3>
              <p className="mt-4 text-xs font-medium text-muted-foreground">
                {messages.widgetAge}
              </p>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {["< 1", "3", "5", "7"].map((age, index) => (
                  <span
                    className={cn(
                      "flex min-h-9 items-center justify-center rounded-lg border text-xs font-medium",
                      index === 2
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background",
                    )}
                    key={age}
                  >
                    {age}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </PublicBookingShell>
      </div>
    </div>
  );
}

function BookingWidgetAppearanceContent({
  messages,
}: {
  messages: AppearanceMessages;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const persisted = workspace?.organization.publicBooking.appearance;
  const [appearance, setAppearance] = React.useState<PublicBookingAppearance>(
    persisted ?? "automatic",
  );
  const [saved, setSaved] = React.useState(false);
  const sourceRevisionRef = React.useRef(workspace?.revision);

  React.useEffect(() => {
    if (!workspace || sourceRevisionRef.current === workspace.revision) return;
    sourceRevisionRef.current = workspace.revision;
    setAppearance(workspace.organization.publicBooking.appearance);
  }, [workspace]);

  const dirty = persisted !== undefined && appearance !== persisted;
  const save = async () => {
    setSaved(false);
    try {
      await booking.save((current) => {
        const { revision: _revision, ...draft } = current;
        return {
          ...draft,
          organization: {
            ...current.organization,
            publicBooking: {
              ...current.organization.publicBooking,
              appearance,
            },
          },
        };
      });
      setSaved(true);
    } catch {
      // BookingFeedbackBanners exposes repository and revision failures.
    }
  };

  return (
    <BookingWorkspaceGate>
      {(readyWorkspace) => (
        <div className="space-y-6" data-testid="appearance-widget-settings">
          <BookingFeedbackBanners />
          <p className="text-sm text-muted-foreground">
            {messages.widgetDescription}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {APPEARANCE_OPTIONS.map(({ value, Icon }) => {
              const label =
                value === "automatic"
                  ? messages.widgetAutomatic
                  : value === "light"
                    ? messages.widgetLight
                    : messages.widgetDark;
              return (
                <button
                  aria-pressed={appearance === value}
                  className={cn(
                    "flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                    appearance === value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                  data-testid={`appearance-widget-${value}`}
                  key={value}
                  onClick={() => {
                    setSaved(false);
                    setAppearance(value);
                  }}
                  type="button"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
          <WidgetPreview
            appearance={appearance}
            messages={messages}
            organizationName={readyWorkspace.organization.name}
          />
          <div className="flex items-center justify-end gap-3">
            {saved ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                {messages.widgetSaved}
              </span>
            ) : null}
            <Button
              data-testid="appearance-widget-save"
              disabled={!dirty || booking.isSaving}
              onClick={() => void save()}
              type="button"
            >
              {booking.isSaving ? messages.widgetSaving : messages.widgetSave}
            </Button>
          </div>
        </div>
      )}
    </BookingWorkspaceGate>
  );
}

function ServerBookingWidgetAppearance({
  messages,
}: {
  messages: AppearanceMessages;
}) {
  const [repository] = React.useState(() =>
    createHttpBookingSettingsRepository(),
  );
  return (
    <BookingWorkspaceProvider repository={repository}>
      <BookingWidgetAppearanceContent messages={messages} />
    </BookingWorkspaceProvider>
  );
}

export function BookingWidgetAppearanceSettings({
  messages,
}: {
  messages: AppearanceMessages;
}) {
  return currentAirhopStaffDataRuntime() === "server" ? (
    <ServerBookingWidgetAppearance messages={messages} />
  ) : (
    <BookingWidgetAppearanceContent messages={messages} />
  );
}
