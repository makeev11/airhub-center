import {
  Check,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  MapPin,
} from "lucide-react";

import type { PublicBookingCatalog } from "@/features/booking/data/publicBookingService";
import type { PublicBookingMessages } from "@/features/booking/lib/publicBookingLocale";
import type { PublicBookingOccurrence } from "@/features/booking/lib/publicBookingAvailability";
import { cn } from "@/shared/lib/cn";

export function PublicBookingBranchSelector({
  branchId,
  branches,
  isLoading,
  messages,
  occurrences,
  onOpenChange,
  onSelect,
  open,
}: {
  branchId: string;
  branches: PublicBookingCatalog["branches"];
  isLoading: boolean;
  messages: PublicBookingMessages;
  occurrences: PublicBookingOccurrence[];
  onOpenChange: (open: boolean) => void;
  onSelect: (branchId: string) => void;
  open: boolean;
}) {
  const selectedBranch = branches.find((branch) => branch.id === branchId);

  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="text-sm font-medium">{messages.chooseBranch}</legend>
      {!open && selectedBranch ? (
        <button
          className="flex min-h-16 w-full min-w-0 items-center gap-3 rounded-2xl border border-primary bg-primary/10 p-4 text-left transition-colors hover:bg-primary/15 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="airhop-public-selected-branch"
          onClick={() => onOpenChange(true)}
          type="button"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <MapPin className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold">
              {selectedBranch.name}
            </span>
            <span className="mt-1 block break-words text-xs text-muted-foreground">
              {selectedBranch.address}
            </span>
          </span>
          <span className="shrink-0 text-xs font-medium text-primary">
            {messages.changeBranch}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </button>
      ) : (
        <div className="grid gap-2">
          {branches.map((branch) => {
            const branchOptions = occurrences.filter(
              (occurrence) => occurrence.branchId === branch.id,
            );
            const available = branchOptions.some(
              (occurrence) => occurrence.available,
            );
            return (
              <button
                aria-pressed={branchId === branch.id}
                className={cn(
                  "flex min-h-16 w-full min-w-0 items-center gap-3 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  branchId === branch.id
                    ? "border-primary bg-primary/10"
                    : "border-border/70 bg-background/70 hover:bg-muted/60",
                )}
                data-testid={`airhop-public-branch-${branch.id}`}
                key={branch.id}
                onClick={() => onSelect(branch.id)}
                type="button"
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                    branchId === branch.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background",
                  )}
                >
                  {branchId === branch.id ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold">
                    {branch.name}
                  </span>
                  <span className="mt-1 block break-words text-xs text-muted-foreground">
                    {branch.address}
                  </span>
                </span>
                <span
                  className={cn(
                    "inline-flex max-w-32 shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-right text-2xs font-semibold leading-4",
                    isLoading
                      ? "bg-muted text-muted-foreground"
                      : available
                        ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {isLoading ? (
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                  ) : available ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : null}
                  {isLoading
                    ? messages.branchAvailabilityLoading
                    : available
                      ? messages.branchAvailable
                      : messages.branchUnavailable}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

export function PublicBookingAgeSelector({
  ageYears,
  messages,
  onSelect,
}: {
  ageYears: string;
  messages: PublicBookingMessages;
  onSelect: (ageYears: number) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="text-sm font-medium">{messages.childAge}</legend>
      <div className="grid grid-cols-3 gap-2 min-[320px]:grid-cols-4 sm:grid-cols-8">
        {Array.from({ length: 18 }, (_, age) => age).map((age) => (
          <button
            aria-label={messages.ageYears(age)}
            aria-pressed={ageYears === String(age)}
            className={cn(
              "min-h-11 rounded-xl border text-sm font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              ageYears === String(age)
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/70 bg-background/70 hover:bg-muted/60",
            )}
            data-testid={`airhop-public-age-${age}`}
            key={age}
            onClick={() => onSelect(age)}
            type="button"
          >
            {age === 0 ? "< 1" : age}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
