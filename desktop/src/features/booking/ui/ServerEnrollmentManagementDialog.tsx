import * as React from "react";

import {
  createHttpStaffEnrollmentService,
  StaffEnrollmentApiError,
  type StaffEnrollmentMutation,
} from "@/features/booking/data/staffEnrollmentService";
import type { StaffFamilyDetail } from "@/features/booking/data/staffFamilyDetailService";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import type { BookingWorkspace } from "@/features/booking/model/bookingCore";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
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

type Enrollment = StaffFamilyDetail["enrollments"][number];

/** Server-backed lifecycle and future-tariff controls for one enrollment. */
export function ServerEnrollmentManagementDialog({
  enrollment,
  onOpenChange,
  onSaved,
  open,
  workspace,
}: {
  enrollment: Enrollment | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  workspace: BookingWorkspace;
}) {
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const formatters = createBookingFormatters(workspace.organization.locale);
  const service = React.useMemo(() => createHttpStaffEnrollmentService(), []);
  const [tariffId, setTariffId] = React.useState("");
  const [confirmingEnd, setConfirmingEnd] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTariffId("");
    setConfirmingEnd(false);
    setError(null);
  }, [open]);

  const compatibleTariffs = React.useMemo(
    () =>
      workspace.tariffs
        .filter(
          (tariff) =>
            tariff.status === "active" &&
            tariff.id !== enrollment?.tariff?.id &&
            tariff.weeklyScheduleLimit >= (enrollment?.schedule.length ?? 0),
        )
        .sort((left, right) =>
          left.name.localeCompare(right.name, workspace.organization.locale),
        ),
    [enrollment, workspace.organization.locale, workspace.tariffs],
  );

  const mutate = async (mutation: StaffEnrollmentMutation) => {
    if (!enrollment) return;
    setIsSaving(true);
    setError(null);
    try {
      await service.mutate({
        enrollmentId: enrollment.id,
        expectedVersion: enrollment.version,
        mutation,
      });
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof StaffEnrollmentApiError
          ? cause.message
          : messages.enrollmentManagementFailed,
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!enrollment) return null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid="airhop-enrollment-management-dialog">
        <DialogHeader>
          <DialogTitle>{messages.enrollmentManagementTitle}</DialogTitle>
          <DialogDescription>
            {confirmingEnd
              ? messages.enrollmentEndDescription
              : messages.enrollmentManagementDescription(enrollment.groupName)}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {confirmingEnd ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            {messages.enrollmentEndWarning}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4 text-sm">
              <p className="font-medium">{enrollment.groupName}</p>
              <p className="mt-1 text-muted-foreground">
                {enrollment.tariff
                  ? `${messages.enrollmentCurrentTariff}: ${enrollment.tariff.name} · ${formatters.money(
                      enrollment.tariff.priceMinor,
                      enrollment.tariff.currency,
                    )}`
                  : messages.enrollmentNeedsAssignment}
              </p>
            </div>
            {enrollment.status !== "ended" && enrollment.tariff ? (
              <div className="grid gap-2">
                <span className="text-sm font-medium">
                  {messages.enrollmentChangeTariff}
                </span>
                <div className="flex min-w-0 gap-2">
                  <BookingSelect
                    aria-label={messages.enrollmentChangeTariff}
                    className="min-w-0"
                    disabled={isSaving || compatibleTariffs.length === 0}
                    onChange={(event) => setTariffId(event.target.value)}
                    value={tariffId}
                    wrapperClassName="min-w-0 flex-1"
                  >
                    <option value="">
                      {compatibleTariffs.length
                        ? messages.enrollmentSelectTariff
                        : messages.enrollmentNoCompatibleTariffs}
                    </option>
                    {compatibleTariffs.map((tariff) => (
                      <option key={tariff.id} value={tariff.id}>
                        {tariff.name} ·{" "}
                        {formatters.money(tariff.priceMinor, tariff.currency)}
                      </option>
                    ))}
                  </BookingSelect>
                  <Button
                    disabled={isSaving || !tariffId}
                    onClick={() =>
                      void mutate({ action: "change_tariff", tariffId })
                    }
                    type="button"
                    variant="outline"
                  >
                    {messages.save}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {messages.enrollmentTariffFutureOnly}
                </p>
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter>
          {confirmingEnd ? (
            <>
              <Button
                disabled={isSaving}
                onClick={() => setConfirmingEnd(false)}
                type="button"
                variant="outline"
              >
                {messages.cancel}
              </Button>
              <Button
                disabled={isSaving}
                onClick={() => void mutate({ action: "end" })}
                type="button"
                variant="destructive"
              >
                {isSaving ? messages.saving : messages.enrollmentEnd}
              </Button>
            </>
          ) : (
            <>
              {enrollment.status === "active" ? (
                <Button
                  disabled={isSaving}
                  onClick={() => void mutate({ action: "pause" })}
                  type="button"
                  variant="outline"
                >
                  {messages.enrollmentPause}
                </Button>
              ) : null}
              {enrollment.status === "paused" ? (
                <Button
                  disabled={isSaving}
                  onClick={() => void mutate({ action: "resume" })}
                  type="button"
                >
                  {messages.enrollmentResume}
                </Button>
              ) : null}
              {enrollment.status !== "ended" ? (
                <Button
                  disabled={isSaving}
                  onClick={() => setConfirmingEnd(true)}
                  type="button"
                  variant="destructive"
                >
                  {messages.enrollmentEnd}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
