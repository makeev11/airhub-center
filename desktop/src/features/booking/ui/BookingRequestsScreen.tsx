import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarDays, Inbox, MapPin, Phone, UserRound } from "lucide-react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { currentStaffBookingQueueRuntime } from "@/features/booking/data/staffBookingQueueRuntime";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  bookingRequestRows,
  type BookingQueueRow,
  type BookingRequestRow,
} from "@/features/booking/lib/bookingClients";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { ServerBookingRequestsScreen } from "@/features/booking/ui/ServerBookingRequestsScreen";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";

type RequestFilter =
  | "all"
  | "attention"
  | "pending"
  | "confirmed"
  | "processed";

type Decision = {
  row: BookingQueueRow;
  status: "confirmed" | "rejected";
};

function statusLabel(
  row: BookingRequestRow,
  messages: ReturnType<typeof getBookingAdminMessages>,
): string {
  if (row.kind === "intake") {
    if (row.request.status === "new") return messages.requestStatusIntakeNew;
    if (row.request.status === "converted") {
      return messages.requestStatusIntakeConverted;
    }
    return messages.requestStatusIntakeClosed;
  }
  switch (row.booking.status) {
    case "pending_confirmation":
      return messages.requestStatusPending;
    case "confirmed":
      return messages.requestStatusConfirmed;
    case "rejected":
      return messages.requestStatusRejected;
    case "cancelled_by_parent":
      return messages.requestStatusCancelledByParent;
    case "cancelled_by_center":
      return messages.requestStatusCancelledByCenter;
  }
}

function RequestsContent() {
  const booking = useBookingWorkspace();
  const navigate = useNavigate();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const [filter, setFilter] = React.useState<RequestFilter>("pending");
  const [query, setQuery] = React.useState("");
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const rows = bookingRequestRows(workspace);
  const normalizedQuery = query
    .trim()
    .toLocaleLowerCase(workspace.organization.locale);
  const queryDigits = query.replace(/\D/g, "");
  const visibleRows = rows.filter((row) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "attention" && row.requiresAttention) ||
      (filter === "pending" &&
        (row.kind === "intake"
          ? row.request.status === "new"
          : row.booking.status === "pending_confirmation")) ||
      (filter === "confirmed" &&
        row.kind === "booking" &&
        row.booking.status === "confirmed") ||
      (filter === "processed" &&
        (row.kind === "intake"
          ? row.request.status !== "new"
          : row.booking.status !== "pending_confirmation" &&
            row.booking.status !== "confirmed"));
    if (!matchesFilter) return false;
    if (!normalizedQuery && !queryDigits) return true;
    const text = [
      row.child.displayName,
      row.representative.displayName,
      row.family.displayName,
      row.groupName,
      row.branchName,
    ]
      .join(" ")
      .toLocaleLowerCase(workspace.organization.locale);
    return (
      text.includes(normalizedQuery) ||
      (queryDigits.length > 0 &&
        row.representative.phoneNormalized
          .replace(/\D/g, "")
          .includes(queryDigits))
    );
  });

  const submitDecision = async () => {
    if (!decision) return;
    try {
      await booking.decideBooking(decision.row.booking.id, decision.status);
      setSuccessMessage(
        decision.status === "confirmed"
          ? messages.requestConfirmed
          : messages.requestRejected,
      );
      setDecision(null);
    } catch {
      // Shared feedback banner exposes repository and revision failures.
    }
  };

  const filterOptions: Array<{ value: RequestFilter; label: string }> = [
    { value: "pending", label: messages.requestFilterPending },
    { value: "attention", label: messages.requestFilterAttention },
    { value: "confirmed", label: messages.requestFilterConfirmed },
    { value: "processed", label: messages.requestFilterProcessed },
    { value: "all", label: messages.requestFilterAll },
  ];

  return (
    <>
      <div className="space-y-4">
        <BookingFeedbackBanners />
        {successMessage ? (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-3 rounded-xl border border-border/70 bg-card p-3 sm:p-4">
          <Input
            aria-label={messages.requestSearch}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={messages.requestSearch}
            value={query}
          />
          <fieldset className="flex max-w-full gap-2 overflow-x-auto pb-1">
            <legend className="sr-only">{messages.requestsTitle}</legend>
            {filterOptions.map((option) => (
              <Button
                aria-pressed={filter === option.value}
                className="shrink-0"
                key={option.value}
                onClick={() => setFilter(option.value)}
                size="sm"
                variant={filter === option.value ? "default" : "outline"}
              >
                {option.label}
              </Button>
            ))}
          </fieldset>
        </div>

        {!visibleRows.length ? (
          <Card className="space-y-3 p-8 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {messages.noRequestsTitle}
            </h2>
            <p className="text-sm text-muted-foreground">
              {messages.noRequestsDescription}
            </p>
          </Card>
        ) : (
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            {visibleRows.map((row) => (
              <Card
                className="min-w-0 space-y-4 p-4 sm:p-5"
                data-testid={`airhop-request-${row.kind === "booking" ? row.booking.id : row.request.id}`}
                key={row.kind === "booking" ? row.booking.id : row.request.id}
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold">
                      {row.child.displayName}
                    </h2>
                    <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <UserRound className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {row.representative.displayName}
                      </span>
                    </p>
                  </div>
                  <Badge
                    variant={
                      row.kind === "intake"
                        ? row.request.status === "new"
                          ? "warning"
                          : "secondary"
                        : row.booking.status === "confirmed"
                          ? "success"
                          : row.booking.status === "rejected"
                            ? "destructive"
                            : "secondary"
                    }
                  >
                    {statusLabel(row, messages)}
                  </Badge>
                </div>

                <div className="grid min-w-0 gap-2 text-sm">
                  <p className="min-w-0 font-medium">
                    {row.groupName ?? messages.requestNeedsLesson}
                  </p>
                  {row.kind === "booking" ? (
                    <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
                      <CalendarDays className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {new Intl.DateTimeFormat(
                          workspace.organization.locale,
                          {
                            weekday: "short",
                            day: "numeric",
                            month: "long",
                          },
                        ).format(new Date(`${row.date}T12:00:00Z`))}
                        , {row.startTime}
                      </span>
                    </p>
                  ) : null}
                  {row.branchName ? (
                    <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
                      <MapPin className="h-4 w-4 shrink-0" />
                      <span className="truncate">{row.branchName}</span>
                    </p>
                  ) : null}
                  <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {row.representative.phoneDisplay}
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {row.kind === "booking" && row.booking.transferRequest ? (
                    <Badge variant="warning">
                      {messages.requestTransferPending}
                    </Badge>
                  ) : null}
                  {row.requiresAttention &&
                  row.kind === "booking" &&
                  row.booking.status !== "pending_confirmation" &&
                  !row.booking.transferRequest ? (
                    <Badge variant="warning">
                      {messages.requestPossibleDuplicate}
                    </Badge>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
                  {row.kind === "booking" &&
                  row.booking.status === "pending_confirmation" ? (
                    <>
                      <Button
                        data-testid={`confirm-airhop-request-${row.booking.id}`}
                        onClick={() =>
                          setDecision({ row, status: "confirmed" })
                        }
                        size="sm"
                      >
                        {messages.requestConfirm}
                      </Button>
                      <Button
                        onClick={() => setDecision({ row, status: "rejected" })}
                        size="sm"
                        variant="outline"
                      >
                        {messages.requestReject}
                      </Button>
                    </>
                  ) : null}
                  <Button
                    onClick={() =>
                      void navigate({
                        to: "/booking/clients/$familyId",
                        params: { familyId: row.family.id },
                      })
                    }
                    size="sm"
                    variant="ghost"
                  >
                    {messages.requestOpenFamily}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
        open={decision !== null}
      >
        <AlertDialogContent data-testid="airhop-request-decision-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {decision?.status === "confirmed"
                ? messages.requestConfirm
                : messages.requestReject}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {decision
                ? `${decision.row.child.displayName} · ${decision.row.groupName} · ${decision.row.date}, ${decision.row.startTime}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={booking.isSaving}
              onClick={(event) => {
                event.preventDefault();
                void submitDecision();
              }}
            >
              {booking.isSaving
                ? messages.saving
                : decision?.status === "confirmed"
                  ? messages.requestConfirm
                  : messages.requestReject}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function WorkspaceBookingRequestsScreen() {
  const booking = useBookingWorkspace();
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
        <PageHeader
          description={messages.requestsDescription}
          title={messages.requestsTitle}
        />
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6">
        <BookingWorkspaceGate>{() => <RequestsContent />}</BookingWorkspaceGate>
      </div>
    </div>
  );
}

/** Selects one queue source without merging server rows into demo storage. */
export function BookingRequestsScreen() {
  if (currentStaffBookingQueueRuntime() === "server") {
    return <ServerBookingRequestsScreen />;
  }
  return <WorkspaceBookingRequestsScreen />;
}
