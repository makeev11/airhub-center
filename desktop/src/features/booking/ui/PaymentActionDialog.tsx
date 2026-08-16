import * as React from "react";

import { createStaffActionContext } from "@/features/booking/actions/airhopActionContext";
import { executeAirhopAction } from "@/features/booking/actions/airhopActionService";
import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import {
  majorMoneyInput,
  parseMajorMoneyInput,
} from "@/features/booking/lib/bookingAdmin";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import type { PaymentQueueRow } from "@/features/booking/lib/bookingCommerceReadModels";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

export type PaymentActionMode = "amount" | "paid" | "cancel" | "restore";

export function PaymentActionDialog({
  mode,
  onOpenChange,
  onSaved,
  open,
  row,
}: {
  mode: PaymentActionMode;
  onOpenChange: (open: boolean) => void;
  onSaved: (mode: PaymentActionMode) => void;
  open: boolean;
  row: PaymentQueueRow | null;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const locale = workspace?.organization.locale ?? "ru-RU";
  const messages = getBookingAdminMessages(locale);
  const formatters = createBookingFormatters(locale);
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !row) return;
    setAmount(majorMoneyInput(row.payment.amountMinor, row.payment.currency));
    setReason("");
    setError(null);
  }, [open, row]);

  if (!row) return null;

  const title =
    mode === "amount"
      ? messages.paymentAmountTitle
      : mode === "paid"
        ? messages.paymentPaidTitle
        : mode === "cancel"
          ? messages.paymentCancelTitle
          : messages.paymentRestoreTitle;
  const description =
    mode === "amount"
      ? messages.paymentAmountDescription
      : mode === "paid"
        ? messages.paymentPaidDescription
        : mode === "cancel"
          ? messages.paymentCancelDescription
          : messages.paymentRestoreDescription;
  const confirmLabel =
    mode === "amount"
      ? messages.paymentConfirmAmount
      : mode === "paid"
        ? messages.paymentConfirmPaid
        : mode === "cancel"
          ? messages.paymentConfirmCancel
          : messages.paymentConfirmRestore;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspace) return;
    const parsedAmount =
      mode === "amount"
        ? parseMajorMoneyInput(amount, row.payment.currency)
        : null;
    if (mode === "amount" && parsedAmount === null) {
      setError(messages.paymentInvalidAmount);
      return;
    }
    if ((mode === "cancel" || mode === "restore") && !reason.trim()) {
      setError(messages.paymentReasonRequired);
      return;
    }
    setError(null);
    try {
      await booking.save(
        (current) =>
          executeAirhopAction(
            current,
            mode === "amount"
              ? {
                  type: "UpdatePaymentAmount",
                  paymentId: row.payment.id,
                  amountMinor: parsedAmount as number,
                }
              : {
                  type: "SetPaymentStatus",
                  paymentId: row.payment.id,
                  status:
                    mode === "paid"
                      ? "paid"
                      : mode === "cancel"
                        ? "cancelled"
                        : "expected",
                  ...(mode === "cancel" || mode === "restore"
                    ? { internalReason: reason.trim() }
                    : {}),
                },
            { userId: "buzz-staff", surface: "staff_ui" },
            createStaffActionContext(new Date().toISOString(), () =>
              crypto.randomUUID(),
            ),
          ).draft,
      );
      onSaved(mode);
      onOpenChange(false);
    } catch {
      setError(messages.paymentActionFailed);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0"
        data-testid="airhop-payment-action-dialog"
      >
        <DialogHeader className="px-5 pt-5 pr-12 sm:px-6 sm:pt-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-col" onSubmit={submit}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-1 sm:px-6">
            <div className="rounded-xl border border-border/70 bg-muted/40 p-4 text-sm">
              <p className="font-semibold">
                {messages.paymentActionSummary(
                  row.child.displayName,
                  formatters.money(
                    row.payment.amountMinor,
                    row.payment.currency,
                  ),
                  formatters.date(row.payment.dueDate),
                )}
              </p>
              <p className="mt-1 text-muted-foreground">
                {row.group.name} · {row.payment.tariffNameSnapshot}
              </p>
            </div>

            {mode === "amount" ? (
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="airhop-payment-amount"
                >
                  {messages.paymentAmount}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    id="airhop-payment-amount"
                    inputMode="decimal"
                    onChange={(event) => setAmount(event.target.value)}
                    value={amount}
                  />
                  <span className="text-sm font-medium text-muted-foreground">
                    {row.payment.currency}
                  </span>
                </div>
              </div>
            ) : null}

            {mode === "cancel" || mode === "restore" ? (
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="airhop-payment-reason"
                >
                  {messages.paymentCancelReason}
                </label>
                <Textarea
                  autoFocus
                  id="airhop-payment-reason"
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={messages.paymentCancelReasonPlaceholder}
                  rows={4}
                  value={reason}
                />
              </div>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="mt-4 shrink-0 border-t border-border/70 px-5 py-4 sm:px-6">
            <Button
              disabled={booking.isSaving}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {messages.cancel}
            </Button>
            <Button disabled={booking.isSaving} type="submit">
              {booking.isSaving ? messages.saving : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
