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
import { currentAirhopStaffDataRuntime } from "@/features/booking/data/staffDataRuntime";
import {
  createHttpStaffPaymentService,
  type StaffPaymentMutation,
  type StaffPaymentQueue,
  type StaffPaymentService,
} from "@/features/booking/data/staffPaymentService";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  paymentQueueRows,
  paymentDisplayState,
  type PaymentDisplayState,
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
  type PaymentActionRow,
  type PaymentActionValues,
} from "@/features/booking/ui/PaymentActionDialog";
import type {
  BookingOrganization,
  PaymentExpectation,
} from "@/features/booking/model/bookingCore";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";

type PaymentFilter = "open" | "paid" | "cancelled";
type PaymentRow = {
  payment: PaymentExpectation;
  displayState: PaymentDisplayState;
  family: { id: string; displayName: string };
  child: { id: string; displayName: string };
  enrollment: { id: string };
  group: { id: string; name: string };
};
type PaymentAction = { mode: PaymentActionMode; row: PaymentRow };
type ExecutePaymentAction = (
  mode: PaymentActionMode,
  row: PaymentActionRow,
  values: PaymentActionValues,
) => Promise<void>;

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
  organization,
  row,
}: {
  onAction: (mode: PaymentActionMode, row: PaymentRow) => void;
  organization: BookingOrganization;
  row: PaymentRow;
}) {
  const navigate = useNavigate();
  const messages = getBookingAdminMessages(organization.locale);
  const formatters = createBookingFormatters(organization.locale);
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
              onClick={() => onAction("due_date", row)}
              size="sm"
              variant="outline"
            >
              <CalendarClock />
              {messages.paymentMoveDueDate}
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

function PaymentsContent({
  executeAction,
  organization,
  rows,
}: {
  executeAction?: ExecutePaymentAction;
  organization: BookingOrganization;
  rows: PaymentRow[];
}) {
  const messages = getBookingAdminMessages(organization.locale);
  const [filter, setFilter] = React.useState<PaymentFilter>("open");
  const [query, setQuery] = React.useState("");
  const [action, setAction] = React.useState<PaymentAction | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase(organization.locale);
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
      .toLocaleLowerCase(organization.locale)
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
        {executeAction ? null : <BookingFeedbackBanners />}
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
                organization={organization}
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
        locale={organization.locale}
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
                : mode === "due_date"
                  ? messages.paymentDueDateUpdated
                  : mode === "cancel"
                    ? messages.paymentCancelledSuccess
                    : messages.paymentRestoredSuccess,
          );
        }}
        open={action !== null}
        onExecute={executeAction}
        row={action?.row ?? null}
      />
    </>
  );
}

function PaymentsFrame({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: string;
}) {
  const messages = getBookingAdminMessages(locale);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
        <PageHeader
          description={messages.paymentsDescription}
          title={messages.paymentsTitle}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">{children}</div>
    </div>
  );
}

function WorkspacePaymentsContent() {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const currentDate = organizationLocalDateTime(
    workspace.organization.timeZone,
    new Date(),
  ).date;
  return (
    <PaymentsContent
      organization={workspace.organization}
      rows={paymentQueueRows(workspace, currentDate)}
    />
  );
}

function WorkspacePaymentsScreen() {
  const booking = useBookingWorkspace();
  const locale = booking.workspace?.organization.locale ?? "ru-RU";

  return (
    <PaymentsFrame locale={locale}>
      <BookingWorkspaceGate>
        {() => <WorkspacePaymentsContent />}
      </BookingWorkspaceGate>
    </PaymentsFrame>
  );
}

function paymentMutation(
  mode: PaymentActionMode,
  values: PaymentActionValues,
): StaffPaymentMutation {
  if (mode === "paid") return { action: "mark_paid" };
  if (mode === "amount" && values.amountMinor !== undefined) {
    return { action: "change_amount", amountMinor: values.amountMinor };
  }
  if (mode === "due_date" && values.dueDate && values.reason) {
    return {
      action: "move_due_date",
      dueDate: values.dueDate,
      reason: values.reason,
    };
  }
  if (mode === "cancel" && values.reason) {
    return { action: "cancel", reason: values.reason };
  }
  if (mode === "restore" && values.reason) {
    return { action: "restore", reason: values.reason };
  }
  throw new Error("Incomplete AirHub payment command");
}

function serverPaymentRows(queue: StaffPaymentQueue): PaymentRow[] {
  const currentDate = organizationLocalDateTime(
    queue.organization.timeZone,
    new Date(),
  ).date;
  return queue.items.map((item) => ({
    ...item,
    displayState: paymentDisplayState(item.payment, currentDate),
  }));
}

function ServerPaymentsScreen() {
  const booking = useBookingWorkspace();
  const [service] = React.useState<StaffPaymentService>(() =>
    createHttpStaffPaymentService(),
  );
  const [queue, setQueue] = React.useState<StaffPaymentQueue | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = React.useState<Error | null>(null);
  const messages = getBookingAdminMessages(
    queue?.organization.locale ??
      booking.workspace?.organization.locale ??
      "ru-RU",
  );
  const load = React.useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      setQueue(await service.listPayments());
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      setStatus("error");
      throw cause;
    }
  }, [service]);

  React.useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const executeAction = React.useCallback<ExecutePaymentAction>(
    async (mode, row, values) => {
      if (!row.payment.version) {
        throw new Error("AirHub payment version is unavailable");
      }
      await service.mutatePayment({
        paymentId: row.payment.id,
        expectedVersion: row.payment.version,
        mutation: paymentMutation(mode, values),
      });
      await load();
    },
    [load, service],
  );

  const locale =
    queue?.organization.locale ??
    booking.workspace?.organization.locale ??
    "ru-RU";
  return (
    <PaymentsFrame locale={locale}>
      {status === "loading" && !queue ? (
        <Card className="space-y-2 p-8 text-center">
          <h2 className="text-lg font-semibold">{messages.loadingTitle}</h2>
          <p className="text-sm text-muted-foreground">
            {messages.loadingDescription}
          </p>
        </Card>
      ) : status === "error" || !queue ? (
        <Alert variant="destructive">
          <AlertDescription className="space-y-3">
            <p>{error?.message ?? messages.loadErrorDescription}</p>
            <Button onClick={() => void load()} size="sm" variant="outline">
              {messages.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <PaymentsContent
          executeAction={executeAction}
          organization={queue.organization}
          rows={serverPaymentRows(queue)}
        />
      )}
    </PaymentsFrame>
  );
}

/** Uses PostgreSQL payment commands in Tauri and isolated demo state in previews. */
export function PaymentsScreen() {
  return currentAirhopStaffDataRuntime() === "server" ? (
    <ServerPaymentsScreen />
  ) : (
    <WorkspacePaymentsScreen />
  );
}
