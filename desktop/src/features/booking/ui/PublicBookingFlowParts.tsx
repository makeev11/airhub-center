import { ChevronDown, MapPin } from "lucide-react";
import type * as React from "react";

import type { PublicBookingMessages } from "@/features/booking/lib/publicBookingLocale";
import type { PublicBookingPurpose } from "@/features/booking/model/bookingCore";
import type { PublicApplicantValidationIssue } from "@/features/booking/model/publicBooking";
import { AIRHOP_MARK_PATH } from "@/shared/brand/airhopBrand";
import { cn } from "@/shared/lib/cn";

export function PublicBookingHeader({
  messages,
  mode,
  organizationName,
  purpose,
  stepNumber,
}: {
  messages: PublicBookingMessages;
  mode: "standalone" | "embedded";
  organizationName: string;
  purpose: PublicBookingPurpose;
  stepNumber: number;
}) {
  return (
    <header
      className={cn(
        "mx-auto w-full max-w-3xl pb-4 sm:pb-5",
        mode === "embedded" && "pr-14",
      )}
      data-testid="airhop-public-header"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p
          className="min-w-0 break-words text-xs font-semibold uppercase tracking-widest text-primary"
          data-testid="airhop-public-eyebrow"
        >
          {messages.standaloneEyebrow(organizationName)}
        </p>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {messages.stepProgress(stepNumber, 5)}
        </span>
      </div>
      {stepNumber === 1 ? (
        <div className="mt-3">
          <p className="text-xl font-semibold tracking-tight sm:text-3xl">
            {messages.bookingTitle[purpose]}
          </p>
          {mode === "standalone" ? (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {messages.bookingDescription[purpose]}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${(stepNumber / 5) * 100}%` }}
        />
      </div>
    </header>
  );
}

export function PublicBookingBranchContext({
  address,
  branchLabel,
  branchName,
  changeLabel,
  onChange,
}: {
  address: string;
  branchLabel: string;
  branchName: string;
  changeLabel: string;
  onChange: () => void;
}) {
  return (
    <button
      className="sticky top-0 z-10 mb-3 flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-background/95 px-3 py-2 text-left text-xs shadow-sm backdrop-blur-sm transition-colors hover:bg-muted/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="airhop-public-branch-context"
      onClick={onChange}
      type="button"
    >
      <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 break-words leading-5">
        <span className="font-semibold">
          {branchLabel}: {branchName}
        </span>{" "}
        · {address}
      </p>
      <span className="shrink-0 font-medium text-primary">{changeLabel}</span>
      <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
    </button>
  );
}

export function FieldError({
  issue,
  issues,
  messages,
}: {
  issue: PublicApplicantValidationIssue;
  issues: readonly PublicApplicantValidationIssue[];
  messages: PublicBookingMessages;
}) {
  return issues.includes(issue) ? (
    <p className="text-xs text-destructive" role="alert">
      {messages.applicantErrors[issue]}
    </p>
  ) : null;
}

export function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b border-border/50 py-3 last:border-b-0 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

export function PublicBookingFooter({
  messages,
}: {
  messages: PublicBookingMessages;
}) {
  return (
    <footer
      className="mx-auto mt-3 flex w-full max-w-3xl shrink-0 items-center text-xs text-muted-foreground"
      data-testid="airhop-public-footer"
    >
      <span className="flex items-center gap-1.5 opacity-75">
        <img
          alt=""
          aria-hidden="true"
          className="h-5 w-5 shrink-0 rounded-full"
          data-testid="airhop-public-brand-mark"
          decoding="async"
          height="20"
          src={AIRHOP_MARK_PATH}
          width="20"
        />
        {messages.poweredByBrand}
      </span>
    </footer>
  );
}
