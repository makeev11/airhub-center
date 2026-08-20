import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArrowRightLeft,
  CalendarDays,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  UserMinus,
  UsersRound,
} from "lucide-react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { currentAirhopStaffDataRuntime } from "@/features/booking/data/staffDataRuntime";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { familyBookings } from "@/features/booking/lib/bookingClients";
import { familyEnrollmentRows } from "@/features/booking/lib/bookingCommerceReadModels";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import {
  createBookingFormatters,
  formatChildAgeAndBirthDate,
} from "@/features/booking/lib/bookingLocale";
import type {
  BookingChild,
  BookingRepresentative,
} from "@/features/booking/model/bookingCore";
import { setBookingFamilyStatus } from "@/features/booking/model/bookingMutations";
import { isEnrollmentActiveOn } from "@/features/booking/model/bookingOperations";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { ChildFormDialog } from "@/features/booking/ui/ChildFormDialog";
import { EnrollmentDialog } from "@/features/booking/ui/EnrollmentDialog";
import {
  EnrollmentManagementDialog,
  type EnrollmentManagementMode,
} from "@/features/booking/ui/EnrollmentManagementDialog";
import { FamilyNameDialog } from "@/features/booking/ui/FamilyNameDialog";
import { RepresentativeFormDialog } from "@/features/booking/ui/RepresentativeFormDialog";
import { ServerFamilyDetailsScreen } from "@/features/booking/ui/ServerFamilyDetailsScreen";
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
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/PageHeader";

function FamilyDetailsContent({ familyId }: { familyId: string }) {
  const booking = useBookingWorkspace();
  const navigate = useNavigate();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const formatters = createBookingFormatters(workspace.organization.locale);
  const currentDate = organizationLocalDateTime(
    workspace.organization.timeZone,
    new Date(),
  ).date;
  const family = workspace.families.find(
    (candidate) => candidate.id === familyId,
  );
  const [representativeTarget, setRepresentativeTarget] =
    React.useState<BookingRepresentative | null>(null);
  const [representativeOpen, setRepresentativeOpen] = React.useState(false);
  const [childTarget, setChildTarget] = React.useState<BookingChild | null>(
    null,
  );
  const [childOpen, setChildOpen] = React.useState(false);
  const [enrollmentChildId, setEnrollmentChildId] = React.useState<
    string | null
  >(null);
  const [enrollmentManagement, setEnrollmentManagement] = React.useState<{
    enrollmentId: string;
    mode: EnrollmentManagementMode;
  } | null>(null);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [success, setSuccess] = React.useState<string | null>(null);
  if (!family) {
    return (
      <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
        <UsersRound className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {messages.familyNotFoundTitle}
        </h2>
        <p className="text-sm text-muted-foreground">
          {messages.familyNotFoundDescription}
        </p>
      </Card>
    );
  }
  const representatives = workspace.representatives.filter(
    (representative) => representative.familyId === family.id,
  );
  const children = workspace.children.filter(
    (child) => child.familyId === family.id,
  );
  const history = familyBookings(workspace, family.id);
  const enrollments = familyEnrollmentRows(workspace, family.id, currentDate);
  const entityIds = new Set([
    ...representatives.map((representative) => representative.id),
    ...children.map((child) => child.id),
  ]);
  const hasDuplicate = workspace.duplicateCandidates.some(
    (candidate) =>
      candidate.status === "pending" &&
      (entityIds.has(candidate.newEntityId) ||
        entityIds.has(candidate.existingEntityId)),
  );

  const setStatus = async (status: "active" | "archived") => {
    try {
      await booking.save((current) =>
        setBookingFamilyStatus(
          current,
          family.id,
          status,
          new Date().toISOString(),
        ),
      );
      setSuccess(
        status === "active" ? messages.familyRestored : messages.familyArchived,
      );
      setArchiveOpen(false);
    } catch {
      // Shared feedback explains the failure.
    }
  };

  return (
    <>
      <div className="space-y-4">
        <BookingFeedbackBanners />
        {success ? (
          <Alert>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}
        {hasDuplicate ? (
          <Alert>
            <AlertTitle>{messages.familyPossibleDuplicate}</AlertTitle>
            <AlertDescription>
              {messages.requestPossibleDuplicate}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <Card className="min-w-0 space-y-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {messages.familyRepresentatives}
              </h2>
              <Button
                onClick={() => {
                  setRepresentativeTarget(null);
                  setRepresentativeOpen(true);
                }}
                size="sm"
                variant="outline"
              >
                <Plus /> {messages.addRepresentative}
              </Button>
            </div>
            {representatives.map((representative) => (
              <button
                className="flex w-full min-w-0 items-start justify-between gap-3 rounded-xl border border-border/70 p-3 text-left hover:bg-accent/40"
                data-testid={`airhop-representative-${representative.id}`}
                key={representative.id}
                onClick={() => {
                  setRepresentativeTarget(representative);
                  setRepresentativeOpen(true);
                }}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {representative.displayName}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" /> {representative.phoneDisplay}
                  </span>
                </span>
                {representative.id === family.primaryRepresentativeId ? (
                  <Badge variant="secondary">
                    {messages.familyPrimaryContact}
                  </Badge>
                ) : null}
              </button>
            ))}
          </Card>

          <Card className="min-w-0 space-y-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {messages.familyChildren}
              </h2>
              <Button
                data-testid="airhop-add-child"
                onClick={() => {
                  setChildTarget(null);
                  setChildOpen(true);
                }}
                size="sm"
                variant="outline"
              >
                <Plus /> {messages.addChild}
              </Button>
            </div>
            {children.map((child) => {
              const childEnrollments = enrollments.filter(
                (row) => row.child.id === child.id,
              );
              return (
                <article
                  className="min-w-0 space-y-3 rounded-xl border border-border/70 p-3"
                  data-testid={`airhop-child-${child.id}`}
                  key={child.id}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{child.displayName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatChildAgeAndBirthDate({
                          birthDate: child.birthDate,
                          onDate: currentDate,
                          locale: workspace.organization.locale,
                        })}
                      </p>
                      {child.note ? (
                        <p className="mt-2 text-sm">{child.note}</p>
                      ) : null}
                    </div>
                    <Button
                      aria-label={`${messages.edit}: ${child.displayName}`}
                      onClick={() => {
                        setChildTarget(child);
                        setChildOpen(true);
                      }}
                      size="icon"
                      variant="ghost"
                    >
                      <Pencil />
                    </Button>
                  </div>

                  <section
                    className="space-y-2 border-t border-border/70 pt-3"
                    data-testid={`airhop-child-enrollments-${child.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {messages.familyEnrollments}
                      </h3>
                      {family.status === "active" &&
                      child.status === "active" ? (
                        <Button
                          data-testid={`airhop-enroll-child-${child.id}`}
                          onClick={() => setEnrollmentChildId(child.id)}
                          size="sm"
                          variant="outline"
                        >
                          <Plus /> {messages.familyEnrollChild}
                        </Button>
                      ) : null}
                    </div>
                    {childEnrollments.map((row) => {
                      const activeNow = isEnrollmentActiveOn(
                        row.enrollment,
                        currentDate,
                      );
                      const scheduled =
                        row.enrollment.status === "active" &&
                        row.enrollment.startDate > currentDate;
                      const ended =
                        row.enrollment.status === "ended" ||
                        (row.enrollment.endDate !== undefined &&
                          row.enrollment.endDate < currentDate);
                      const hasFutureSegment = workspace.enrollments.some(
                        (candidate) =>
                          candidate.id !== row.enrollment.id &&
                          candidate.status === "active" &&
                          candidate.childId === row.enrollment.childId &&
                          candidate.groupId === row.enrollment.groupId &&
                          candidate.startDate > currentDate,
                      );
                      const canManage =
                        row.enrollment.assignmentState === "configured" &&
                        activeNow &&
                        row.enrollment.endDate === undefined &&
                        !hasFutureSegment;
                      const schedule =
                        row.enrollment.assignmentState === "configured"
                          ? row.enrollment.weeklyScheduleSelections
                              .map((selection) => {
                                const rule = workspace.recurrenceRules.find(
                                  ({ id }) => id === selection.recurrenceRuleId,
                                );
                                return `${formatters.weekdayName(selection.weekday)}${
                                  rule
                                    ? `, ${rule.startTime}–${rule.endTime}`
                                    : ""
                                }`;
                              })
                              .join(" · ")
                          : messages.enrollmentNeedsAssignment;
                      const payment = row.openPayment;
                      const paymentLabel = payment
                        ? payment.displayState === "overdue"
                          ? messages.paymentOverdue
                          : messages.paymentExpected
                        : null;
                      return (
                        <div
                          className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm"
                          key={row.enrollment.id}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium">{row.group.name}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {row.tariff
                                  ? `${row.tariff.name} · ${formatters.money(row.tariff.priceMinor, row.tariff.currency)}`
                                  : messages.enrollmentNeedsAssignment}
                              </p>
                            </div>
                            <Badge
                              variant={activeNow ? "success" : "secondary"}
                            >
                              {activeNow
                                ? messages.active
                                : scheduled
                                  ? messages.enrollmentScheduled
                                  : ended
                                    ? messages.enrollmentEnded
                                    : messages.archived}
                            </Badge>
                          </div>
                          <p className="text-xs leading-5">{schedule}</p>
                          <p className="text-xs text-muted-foreground">
                            {messages.enrollmentStarts(
                              formatters.date(row.enrollment.startDate),
                            )}
                          </p>
                          {row.enrollment.endDate ? (
                            <p className="text-xs text-muted-foreground">
                              {messages.enrollmentEnds(
                                formatters.date(row.enrollment.endDate),
                              )}
                            </p>
                          ) : null}
                          {payment && paymentLabel ? (
                            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                              <Badge
                                variant={
                                  payment.displayState === "overdue"
                                    ? "destructive"
                                    : "outline"
                                }
                              >
                                {paymentLabel}
                              </Badge>
                              <span className="text-xs font-medium">
                                {messages.paymentDueSummary(
                                  formatters.money(
                                    payment.payment.amountMinor,
                                    payment.payment.currency,
                                  ),
                                  formatters.date(payment.payment.dueDate),
                                )}
                              </span>
                            </div>
                          ) : null}
                          {canManage ? (
                            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-2">
                              <Button
                                data-testid={`airhop-change-tariff-${row.enrollment.id}`}
                                onClick={() =>
                                  setEnrollmentManagement({
                                    enrollmentId: row.enrollment.id,
                                    mode: "tariff",
                                  })
                                }
                                size="sm"
                                variant="outline"
                              >
                                <ArrowRightLeft />
                                {messages.enrollmentChangeTariff}
                              </Button>
                              <Button
                                data-testid={`airhop-end-enrollment-${row.enrollment.id}`}
                                onClick={() =>
                                  setEnrollmentManagement({
                                    enrollmentId: row.enrollment.id,
                                    mode: "end",
                                  })
                                }
                                size="sm"
                                variant="ghost"
                              >
                                <UserMinus />
                                {messages.enrollmentEnd}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </section>
                </article>
              );
            })}
          </Card>
        </div>

        <Card className="min-w-0 space-y-4 p-4 sm:p-5">
          <h2 className="text-lg font-semibold">{messages.familyHistory}</h2>
          {!history.length ? (
            <p className="text-sm text-muted-foreground">
              {messages.noRequestsTitle}
            </p>
          ) : (
            <div className="grid gap-2">
              {history.map((row) => (
                <button
                  className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 p-3 text-left hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
                  key={row.booking.id}
                  onClick={() => void navigate({ to: "/booking/requests" })}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {row.child.displayName} · {row.groupName}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarDays className="h-4 w-4" /> {row.date},{" "}
                      {row.startTime} · {row.branchName}
                    </span>
                  </span>
                  <Badge
                    variant={
                      row.booking.status === "confirmed"
                        ? "success"
                        : "secondary"
                    }
                  >
                    {row.booking.status === "confirmed"
                      ? messages.requestStatusConfirmed
                      : row.booking.status === "pending_confirmation"
                        ? messages.requestStatusPending
                        : messages.requestFilterProcessed}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="flex justify-end">
          {family.status === "active" ? (
            <Button onClick={() => setArchiveOpen(true)} variant="outline">
              <Archive /> {messages.archive}
            </Button>
          ) : (
            <Button
              disabled={booking.isSaving}
              onClick={() => void setStatus("active")}
              variant="outline"
            >
              <RotateCcw /> {messages.restore}
            </Button>
          )}
        </div>
      </div>

      <RepresentativeFormDialog
        familyId={family.id}
        onOpenChange={setRepresentativeOpen}
        onSaved={() => setSuccess(messages.representativeSaved)}
        open={representativeOpen}
        representative={representativeTarget}
      />
      <ChildFormDialog
        child={childTarget}
        familyId={family.id}
        onOpenChange={setChildOpen}
        onSaved={() => setSuccess(messages.childSaved)}
        open={childOpen}
      />
      <EnrollmentDialog
        initialChildId={enrollmentChildId ?? undefined}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEnrollmentChildId(null);
        }}
        onSaved={() => setSuccess(messages.enrollmentCreated)}
        open={enrollmentChildId !== null}
      />
      <EnrollmentManagementDialog
        enrollmentId={enrollmentManagement?.enrollmentId ?? null}
        mode={enrollmentManagement?.mode ?? "tariff"}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEnrollmentManagement(null);
        }}
        onSaved={setSuccess}
        open={enrollmentManagement !== null}
      />
      <AlertDialog onOpenChange={setArchiveOpen} open={archiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {messages.familyArchiveTitle(family.displayName)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {messages.familyArchiveDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={booking.isSaving}
              onClick={(event) => {
                event.preventDefault();
                void setStatus("archived");
              }}
            >
              {booking.isSaving ? messages.saving : messages.archive}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function WorkspaceFamilyDetailsScreen({ familyId }: { familyId: string }) {
  const booking = useBookingWorkspace();
  const [familyNameOpen, setFamilyNameOpen] = React.useState(false);
  const family = booking.workspace?.families.find(
    (candidate) => candidate.id === familyId,
  );
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
        <PageHeader
          action={
            family ? (
              <Button
                data-testid="airhop-edit-family-name"
                onClick={() => setFamilyNameOpen(true)}
                size="sm"
                variant="outline"
              >
                <Pencil /> {messages.edit}
              </Button>
            ) : null
          }
          description={
            family?.status === "archived"
              ? messages.archived
              : messages.clientsDescription
          }
          title={family?.displayName ?? messages.family}
        />
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6">
        <BookingWorkspaceGate>
          {() => <FamilyDetailsContent familyId={familyId} />}
        </BookingWorkspaceGate>
      </div>
      {family ? (
        <FamilyNameDialog
          family={family}
          onOpenChange={setFamilyNameOpen}
          open={familyNameOpen}
        />
      ) : null}
    </div>
  );
}

/** Selects one family-card source without merging server and demo entities. */
export function FamilyDetailsScreen({ familyId }: { familyId: string }) {
  if (currentAirhopStaffDataRuntime() === "server") {
    return <ServerFamilyDetailsScreen familyId={familyId} />;
  }
  return <WorkspaceFamilyDetailsScreen familyId={familyId} />;
}
