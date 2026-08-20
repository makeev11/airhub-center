import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import {
  minimumTariffTransitionDate,
  nextEnrollmentBillingDate,
} from "@/features/booking/lib/bookingEnrollmentTransitions";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import {
  endEnrollment,
  transitionEnrollmentTariff,
} from "@/features/booking/model/bookingCommerce";
import type { WeeklyScheduleSelection } from "@/features/booking/model/bookingCore";
import { AirHopDateInput } from "@/features/booking/ui/AirHopDateInput";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
import { WeeklySchedulePicker } from "@/features/booking/ui/WeeklySchedulePicker";
import { deriveWeeklySlotOptions } from "@/features/booking/ui/weeklySchedulePickerModel";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export type EnrollmentManagementMode = "tariff" | "end";

export function EnrollmentManagementDialog({
  enrollmentId,
  mode,
  onOpenChange,
  onSaved,
  open,
}: {
  enrollmentId: string | null;
  mode: EnrollmentManagementMode;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
  open: boolean;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const locale = workspace?.organization.locale ?? "ru-RU";
  const messages = getBookingAdminMessages(locale);
  const formatters = createBookingFormatters(locale);
  const enrollment = workspace?.enrollments.find(
    (candidate) => candidate.id === enrollmentId,
  );
  const child = workspace?.children.find(
    (candidate) => candidate.id === enrollment?.childId,
  );
  const group = workspace?.groups.find(
    (candidate) => candidate.id === enrollment?.groupId,
  );
  const currentTariff =
    enrollment?.assignmentState === "configured"
      ? workspace?.tariffs.find(
          (candidate) => candidate.id === enrollment.tariffId,
        )
      : undefined;
  const currentDate = workspace
    ? organizationLocalDateTime(workspace.organization.timeZone, new Date())
        .date
    : "";
  const [tariffId, setTariffId] = React.useState("");
  const [effectiveDate, setEffectiveDate] = React.useState("");
  const [weeklySelections, setWeeklySelections] = React.useState<
    WeeklyScheduleSelection[]
  >([]);
  const [endDate, setEndDate] = React.useState("");
  const [cancelExpectedPayments, setCancelExpectedPayments] =
    React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (
      !open ||
      !workspace ||
      !enrollment ||
      enrollment.assignmentState !== "configured" ||
      !currentTariff
    ) {
      return;
    }
    const paymentDay =
      currentTariff.paymentDayOfMonth ??
      workspace.organization.paymentDayOfMonth;
    const minimumDate = minimumTariffTransitionDate(
      enrollment.startDate,
      currentDate,
    );
    const nextBillingDate = nextEnrollmentBillingDate(currentDate, paymentDay);
    const defaultTransitionDate =
      enrollment.endDate && nextBillingDate > enrollment.endDate
        ? minimumDate
        : nextBillingDate;
    setTariffId("");
    setEffectiveDate(defaultTransitionDate);
    setWeeklySelections(enrollment.weeklyScheduleSelections);
    setEndDate(enrollment.endDate ?? currentDate);
    setCancelExpectedPayments(false);
    setError(null);
  }, [currentDate, currentTariff, enrollment, open, workspace]);

  if (
    !workspace ||
    !enrollment ||
    enrollment.assignmentState !== "configured" ||
    !child ||
    !group ||
    !currentTariff
  ) {
    return null;
  }

  const availableTariffs = workspace.tariffs
    .filter(
      (tariff) => tariff.status === "active" && tariff.id !== currentTariff.id,
    )
    .sort((left, right) =>
      left.name.localeCompare(right.name, workspace.organization.locale),
    );
  const selectedTariff = availableTariffs.find(
    (tariff) => tariff.id === tariffId,
  );
  const slotOptions = deriveWeeklySlotOptions(workspace, group.id);
  const minimumEffectiveDate = minimumTariffTransitionDate(
    enrollment.startDate,
    currentDate,
  );
  const expectedPayments = workspace.paymentExpectations.filter(
    (payment) =>
      payment.enrollmentId === enrollment.id && payment.status === "expected",
  );
  const replacesFuturePayment = expectedPayments.some(
    (payment) => payment.dueDate >= effectiveDate,
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (mode === "tariff") {
        if (
          !selectedTariff ||
          !effectiveDate ||
          effectiveDate < minimumEffectiveDate ||
          (enrollment.endDate !== undefined &&
            effectiveDate > enrollment.endDate) ||
          !weeklySelections.length ||
          weeklySelections.length > selectedTariff.weeklyScheduleLimit
        ) {
          setError(messages.enrollmentActionFailed);
          return;
        }
        await booking.save((current) =>
          transitionEnrollmentTariff(current, {
            enrollmentId: enrollment.id,
            tariffId: selectedTariff.id,
            weeklyScheduleSelections: weeklySelections,
            effectiveDate,
            newEnrollmentId: `enrollment-${crypto.randomUUID()}`,
            newPaymentId: `payment-${crypto.randomUUID()}`,
            actorId: "buzz-staff",
            occurredAt: new Date().toISOString(),
          }),
        );
        onSaved(messages.enrollmentTariffChanged);
      } else {
        if (
          !endDate ||
          endDate < currentDate ||
          endDate < enrollment.startDate ||
          (enrollment.endDate !== undefined && endDate > enrollment.endDate)
        ) {
          setError(messages.enrollmentActionFailed);
          return;
        }
        await booking.save((current) =>
          endEnrollment(current, enrollment.id, {
            endDate,
            cancelExpectedPayments,
            actorId: "buzz-staff",
            occurredAt: new Date().toISOString(),
          }),
        );
        onSaved(messages.enrollmentEndedSuccess);
      }
      onOpenChange(false);
    } catch {
      setError(messages.enrollmentActionFailed);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:w-full"
        data-testid="airhop-enrollment-management-dialog"
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-5 py-5 pr-12 text-left sm:px-6">
          <DialogTitle>
            {mode === "tariff"
              ? messages.enrollmentChangeTariffTitle
              : messages.enrollmentEndTitle}
          </DialogTitle>
          <DialogDescription>
            {mode === "tariff"
              ? messages.enrollmentChangeTariffDescription
              : messages.enrollmentEndDescription}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={(event) => void submit(event)}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="rounded-xl border border-border/70 bg-muted/40 p-4 text-sm">
              <p className="font-semibold">
                {child.displayName} · {group.name}
              </p>
              <p className="mt-1 text-muted-foreground">
                {messages.enrollmentCurrentTariff}: {currentTariff.name} ·{" "}
                {formatters.money(
                  currentTariff.priceMinor,
                  currentTariff.currency,
                )}
              </p>
            </div>

            {mode === "tariff" ? (
              <>
                <label
                  className="grid gap-1.5 text-sm"
                  htmlFor="airhop-enrollment-new-tariff"
                >
                  <span className="font-medium">
                    {messages.enrollmentNewTariff}
                  </span>
                  <BookingSelect
                    data-testid="airhop-enrollment-new-tariff"
                    id="airhop-enrollment-new-tariff"
                    onChange={(event) => {
                      const nextTariff = availableTariffs.find(
                        (tariff) => tariff.id === event.target.value,
                      );
                      setTariffId(event.target.value);
                      if (nextTariff) {
                        setWeeklySelections((current) =>
                          current.slice(0, nextTariff.weeklyScheduleLimit),
                        );
                      }
                    }}
                    value={tariffId}
                    wrapperClassName="w-full"
                  >
                    <option value="">—</option>
                    {availableTariffs.map((tariff) => (
                      <option key={tariff.id} value={tariff.id}>
                        {tariff.name} ·{" "}
                        {formatters.money(tariff.priceMinor, tariff.currency)}
                      </option>
                    ))}
                  </BookingSelect>
                </label>

                <label
                  className="grid gap-1.5 text-sm"
                  htmlFor="airhop-enrollment-effective-date"
                >
                  <span className="font-medium">
                    {messages.enrollmentEffectiveDate}
                  </span>
                  <AirHopDateInput
                    data-testid="airhop-enrollment-effective-date"
                    id="airhop-enrollment-effective-date"
                    locale={locale}
                    max={enrollment.endDate}
                    min={minimumEffectiveDate}
                    onChange={setEffectiveDate}
                    value={effectiveDate}
                  />
                  <span className="text-xs text-muted-foreground">
                    {messages.enrollmentEffectiveDateHint}
                  </span>
                </label>

                <div className="grid gap-1.5 text-sm">
                  <span className="font-medium">
                    {messages.enrollmentSchedule}
                  </span>
                  <WeeklySchedulePicker
                    locale={locale}
                    maxSelections={selectedTariff?.weeklyScheduleLimit ?? 1}
                    onChange={setWeeklySelections}
                    options={slotOptions}
                    value={weeklySelections}
                  />
                </div>

                {selectedTariff && effectiveDate ? (
                  <Alert>
                    <AlertDescription className="space-y-1">
                      <p className="font-medium text-foreground">
                        {messages.enrollmentNewPayment(
                          formatters.money(
                            selectedTariff.priceMinor,
                            selectedTariff.currency,
                          ),
                          formatters.date(effectiveDate),
                        )}
                      </p>
                      {replacesFuturePayment ? (
                        <p>{messages.enrollmentFuturePaymentReplaced}</p>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </>
            ) : (
              <>
                <label
                  className="grid gap-1.5 text-sm"
                  htmlFor="airhop-enrollment-end-date"
                >
                  <span className="font-medium">
                    {messages.enrollmentEndDate}
                  </span>
                  <AirHopDateInput
                    data-testid="airhop-enrollment-end-date"
                    id="airhop-enrollment-end-date"
                    locale={locale}
                    max={enrollment.endDate}
                    min={currentDate}
                    onChange={setEndDate}
                    value={endDate}
                  />
                </label>
                {expectedPayments.length ? (
                  <label
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 p-4"
                    htmlFor="airhop-enrollment-cancel-payment"
                  >
                    <Checkbox
                      checked={cancelExpectedPayments}
                      className="mt-0.5"
                      id="airhop-enrollment-cancel-payment"
                      onCheckedChange={(checked) =>
                        setCancelExpectedPayments(checked === true)
                      }
                    />
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium">
                        {messages.enrollmentCancelExpectedPayment}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {messages.enrollmentCancelExpectedPaymentHint}
                      </span>
                    </span>
                  </label>
                ) : null}
              </>
            )}

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/70 px-5 py-4 sm:px-6">
            <Button
              disabled={booking.isSaving}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {messages.cancel}
            </Button>
            <Button disabled={booking.isSaving} type="submit">
              {booking.isSaving
                ? messages.saving
                : mode === "tariff"
                  ? messages.enrollmentConfirmTariffChange
                  : messages.enrollmentConfirmEnd}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
