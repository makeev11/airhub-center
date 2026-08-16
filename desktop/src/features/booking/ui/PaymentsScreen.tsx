import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Banknote,
  CalendarClock,
  CircleCheck,
  RotateCcw,
  Search,
} from "lucide-react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  paymentQueueRows,
  type PaymentDisplayState,
  type PaymentQueueRow,
} from "@/features/booking/lib/bookingCommerceReadModels";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import {
  PaymentActionDialog,
  type PaymentActionMode,
} from "@/features/booking/ui/PaymentActionDialog";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";

type PaymentFilter = "open" | "paid" | "cancelled";
type PaymentAction = { mode: PaymentActionMode; row: PaymentQueueRow };

function paymentStateLabel(
  state: PaymentDisplayState,
  messages: ReturnType<typeof getBookingAdminMessages>,
) {
  if (state === "overdue") return messages.paymentOverdue;
  if (state === "expected") return messages.paymentExpected;
  if (state === "paid") return messages.paymentPaid;
  return messages.paymentCancelled;
}

function PaymentCard({
  onAction,
  row,
}: {
  onAction: (mode: PaymentActionMode, row: PaymentQueueRow) => void;
  row: PaymentQueueRow;
}) {
  const booking = useBookingWorkspace();
  const navigate = useNavigate();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const formatters = createBookingFormatters(workspace.organization.locale);
  const isOpen =
    row.displayState === "expected" || row.displayState === "overdue";

  return (
    <Card
      className="min-w-0 space-y-4 p-4 sm:p-5"
      data-testid={`airhop-payment-${row.payment.id}`}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-base font-semibold">
              {row.child.displayName}
            </h2>
            <Badge
              variant={
                row.displayState === "overdue"
                  ? "destructive"
                  : row.displayState === "paid"
                    ? "success"
                    : "outline"
              }
            >
              {paymentStateLabel(row.displayState, messages)}
            </Badge>
          </div>
          <button
            className="mt-1 text-left text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() =>
              void navigate({
                to: "/booking/clients/$familyId",
                params: { familyId: row.family.id },
              })
            }
            type="button"
          >
            {row.family.displayName}
          </button>
        </div>
        <p className="shrink-0 text-lg font-semibold tabular-nums">
          {formatters.money(row.payment.amountMinor, row.payment.currency)}
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">
            {messages.paymentGroup}
          </dt>
          <dd className="mt-0.5 font-medium">{row.group.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {messages.paymentTariff}
          </dt>
          <dd className="mt-0.5 font-medium">
            {row.payment.tariffNameSnapshot}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {messages.paymentDueDate}
          </dt>
          <dd className="mt-0.5 font-medium">
            {formatters.date(row.payment.dueDate)}
          </dd>
        </div>
        {row.payment.internalReason ? (
          <div>
            <dt className="text-xs text-muted-foreground">
              {messages.paymentCancelReason}
            </dt>
            <dd className="mt-0.5 break-words">{row.payment.internalReason}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
        {isOpen ? (
          <>
            <Button onClick={() => onAction("paid", row)} size="sm">
              <CircleCheck />
              {messages.paymentMarkPaid}
            </Button>
            <Button
              onClick={() => onAction("amount", row)}
              size="sm"
              variant="outline"
            >
              {messages.paymentChangeAmount}
            </Button>
            <Button
              onClick={() => onAction("cancel", row)}
              size="sm"
              variant="ghost"
            >
              {messages.paymentCancel}
            </Button>
          </>
        ) : (
          <Button
            onClick={() => onAction("restore", row)}
            size="sm"
            variant="outline"
          >
            <RotateCcw />
            {row.displayState === "paid"
              ? messages.paymentReopen
              : messages.paymentRestore}
          </Button>
        )}
      </div>
    </Card>
  );
}

function PaymentsContent() {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const currentDate = organizationLocalDateTime(
    workspace.organization.timeZone,
    new Date(),
  ).date;
  const [filter, setFilter] = React.useState<PaymentFilter>("open");
  const [query, setQuery] = React.useState("");
  const [action, setAction] = React.useState<PaymentAction | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const rows = paymentQueueRows(workspace, currentDate);
  const normalizedQuery = query
    .trim()
    .toLocaleLowerCase(workspace.organization.locale);
  const visibleRows = rows.filter((row) => {
    const matchesFilter =
      filter === "open"
        ? row.displayState === "expected" || row.displayState === "overdue"
        : row.displayState === filter;
    if (!matchesFilter) return false;
    if (!normalizedQuery) return true;
    return [
      row.child.displayName,
      row.family.displayName,
      row.group.name,
      row.payment.tariffNameSnapshot,
    ]
      .join(" ")
      .toLocaleLowerCase(workspace.organization.locale)
      .includes(normalizedQuery);
  });
  const counts = {
    open: rows.filter(
      (row) =>
        row.displayState === "expected" || row.displayState === "overdue",
    ).length,
    paid: rows.filter((row) => row.displayState === "paid").length,
    cancelled: rows.filter((row) => row.displayState === "cancelled").length,
  };
  const filters: Array<{ value: PaymentFilter; label: string }> = [
    { value: "open", label: messages.paymentFilterOpen },
    { value: "paid", label: messages.paymentFilterPaid },
    { value: "cancelled", label: messages.paymentFilterCancelled },
  ];

  return (
    <>
      <div className="space-y-4" data-testid="airhop-payments">
        <BookingFeedbackBanners />
        {successMessage ? (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-3 rounded-xl border border-border/70 bg-card p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={messages.paymentSearch}
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={messages.paymentSearch}
              value={query}
            />
          </div>
          <fieldset className="flex max-w-full gap-2 overflow-x-auto pb-1">
            <legend className="sr-only">{messages.paymentsTitle}</legend>
            {filters.map((option) => (
              <Button
                aria-pressed={filter === option.value}
                className="shrink-0"
                key={option.value}
                onClick={() => setFilter(option.value)}
                size="sm"
                variant={filter === option.value ? "default" : "outline"}
              >
                {option.label} · {counts[option.value]}
              </Button>
            ))}
          </fieldset>
        </div>

        {visibleRows.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {visibleRows.map((row) => (
              <PaymentCard
                key={row.payment.id}
                onAction={(mode, selectedRow) =>
                  setAction({ mode, row: selectedRow })
                }
                row={row}
              />
            ))}
          </div>
        ) : (
          <Card className="space-y-3 p-8 text-center">
            {filter === "open" ? (
              <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
            ) : (
              <Banknote className="mx-auto h-8 w-8 text-muted-foreground" />
            )}
            <h2 className="text-lg font-semibold">
              {filter === "open"
                ? messages.paymentNoOpenTitle
                : messages.paymentNoHistoryTitle}
            </h2>
            <p className="text-sm text-muted-foreground">
              {filter === "open"
                ? messages.paymentNoOpenDescription
                : messages.paymentNoHistoryDescription}
            </p>
          </Card>
        )}
      </div>

      <PaymentActionDialog
        mode={action?.mode ?? "paid"}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        onSaved={(mode) => {
          setSuccessMessage(
            mode === "paid"
              ? messages.paymentPaidSuccess
              : mode === "amount"
                ? messages.paymentAmountUpdated
                : mode === "cancel"
                  ? messages.paymentCancelledSuccess
                  : messages.paymentRestoredSuccess,
          );
        }}
        open={action !== null}
        row={action?.row ?? null}
      />
    </>
  );
}

export function PaymentsScreen() {
  const booking = useBookingWorkspace();
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
        <PageHeader
          description={messages.paymentsDescription}
          title={messages.paymentsTitle}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <BookingWorkspaceGate>{() => <PaymentsContent />}</BookingWorkspaceGate>
      </div>
    </div>
  );
}
