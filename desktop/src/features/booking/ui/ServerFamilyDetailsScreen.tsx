import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Archive,
  AlertTriangle,
  CalendarDays,
  Database,
  LoaderCircle,
  MessageCircleCheck,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Star,
  UsersRound,
} from "lucide-react";

import {
  createHttpStaffFamilyCommandService,
  StaffFamilyCommandApiError,
} from "@/features/booking/data/staffFamilyCommandService";
import {
  createHttpStaffFamilyLifecycleService,
  StaffFamilyLifecycleApiError,
} from "@/features/booking/data/staffFamilyLifecycleService";
import type { StaffFamilyDetail } from "@/features/booking/data/staffFamilyDetailService";
import { useStaffFamilyDetail } from "@/features/booking/data/useStaffFamilyDetail";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { getStaffFamilyCommandMessages } from "@/features/booking/lib/staffFamilyCommandLocale";
import {
  createBookingFormatters,
  formatChildAgeAndBirthDate,
} from "@/features/booking/lib/bookingLocale";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
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
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/PageHeader";
import { ServerRepresentativeFormDialog } from "@/features/booking/ui/ServerRepresentativeFormDialog";
import {
  ServerChildFormDialog,
  ServerFamilyFormDialog,
} from "@/features/booking/ui/ServerFamilyEntityForms";

function bookingStatusLabel(
  status: StaffFamilyDetail["bookings"][number]["status"],
  messages: ReturnType<typeof getBookingAdminMessages>,
): string {
  switch (status) {
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

function enrollmentStatusLabel(
  status: StaffFamilyDetail["enrollments"][number]["status"],
  messages: ReturnType<typeof getBookingAdminMessages>,
): string {
  if (status === "active") return messages.active;
  if (status === "paused") return messages.familyEnrollmentPaused;
  return messages.familyEnrollmentEnded;
}

type MemberLifecycleTarget =
  | {
      kind: "representative";
      member: StaffFamilyDetail["representatives"][number];
      status: "active" | "archived";
    }
  | {
      kind: "child";
      member: StaffFamilyDetail["children"][number];
      status: "active" | "archived";
    };

function CenteredState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <Card className="max-w-lg space-y-3 p-6 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center text-muted-foreground">
          {icon}
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {action ? <div className="pt-1">{action}</div> : null}
      </Card>
    </div>
  );
}

function FamilyContent({
  detail,
  reload,
}: {
  detail: StaffFamilyDetail;
  reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const messages = getBookingAdminMessages(detail.organization.locale);
  const commandMessages = getStaffFamilyCommandMessages(
    detail.organization.locale,
  );
  const formatters = createBookingFormatters(detail.organization.locale);
  const childById = new Map(detail.children.map((child) => [child.id, child]));
  const [representativeTarget, setRepresentativeTarget] = React.useState<
    StaffFamilyDetail["representatives"][number] | null
  >(null);
  const [representativeDialogOpen, setRepresentativeDialogOpen] =
    React.useState(false);
  const [childTarget, setChildTarget] = React.useState<
    StaffFamilyDetail["children"][number] | null
  >(null);
  const [childDialogOpen, setChildDialogOpen] = React.useState(false);
  const commandService = React.useMemo(
    () => createHttpStaffFamilyCommandService(),
    [],
  );
  const [memberLifecycleTarget, setMemberLifecycleTarget] =
    React.useState<MemberLifecycleTarget | null>(null);
  const [memberLifecycleError, setMemberLifecycleError] = React.useState<
    string | null
  >(null);
  const [isChangingMemberStatus, setIsChangingMemberStatus] =
    React.useState(false);
  const [primaryTarget, setPrimaryTarget] = React.useState<
    StaffFamilyDetail["representatives"][number] | null
  >(null);
  const [primaryError, setPrimaryError] = React.useState<string | null>(null);
  const [isChangingPrimary, setIsChangingPrimary] = React.useState(false);

  const changeMemberStatus = async () => {
    if (!memberLifecycleTarget) return;
    setIsChangingMemberStatus(true);
    setMemberLifecycleError(null);
    try {
      if (memberLifecycleTarget.kind === "representative") {
        await commandService.setRepresentativeStatus({
          familyId: detail.family.id,
          representativeId: memberLifecycleTarget.member.id,
          expectedVersion: memberLifecycleTarget.member.version,
          status: memberLifecycleTarget.status,
        });
      } else {
        await commandService.setChildStatus({
          familyId: detail.family.id,
          childId: memberLifecycleTarget.member.id,
          expectedVersion: memberLifecycleTarget.member.version,
          status: memberLifecycleTarget.status,
        });
      }
      toast.success(
        memberLifecycleTarget.status === "active"
          ? commandMessages.memberRestored
          : commandMessages.memberArchived,
      );
      setMemberLifecycleTarget(null);
      void reload().catch(() => undefined);
    } catch (error) {
      setMemberLifecycleError(
        error instanceof StaffFamilyCommandApiError
          ? error.message
          : messages.saveErrorDescription,
      );
    } finally {
      setIsChangingMemberStatus(false);
    }
  };

  const changePrimaryRepresentative = async () => {
    if (!primaryTarget) return;
    setIsChangingPrimary(true);
    setPrimaryError(null);
    try {
      await commandService.setPrimaryRepresentative({
        familyId: detail.family.id,
        representativeId: primaryTarget.id,
        expectedVersion: detail.family.version,
      });
      toast.success(commandMessages.primaryChanged);
      setPrimaryTarget(null);
      void reload().catch(() => undefined);
    } catch (error) {
      setPrimaryError(
        error instanceof StaffFamilyCommandApiError
          ? error.message
          : messages.saveErrorDescription,
      );
    } finally {
      setIsChangingPrimary(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Badge variant="outline">
          <Database className="mr-1 h-3 w-3" />
          {messages.familySourceBookingCore}
        </Badge>
      </div>
      <Alert>
        <AlertDescription>{messages.familyServerReadOnly}</AlertDescription>
      </Alert>
      {detail.hasPendingDuplicate ? (
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
            {detail.family.status === "active" ? (
              <Button
                onClick={() => {
                  setRepresentativeTarget(null);
                  setRepresentativeDialogOpen(true);
                }}
                size="sm"
                variant="outline"
              >
                <Plus /> {messages.addRepresentative}
              </Button>
            ) : null}
          </div>
          {detail.representatives.map((representative) => (
            <article
              className="space-y-2 rounded-xl border border-border/70 p-3"
              data-testid={`airhop-server-representative-${representative.id}`}
              key={representative.id}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {representative.displayName}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    {representative.phoneDisplay}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {representative.id ===
                  detail.family.primaryRepresentativeId ? (
                    <Badge variant="secondary">
                      {messages.familyPrimaryContact}
                    </Badge>
                  ) : null}
                  {representative.status === "active" ? (
                    <Button
                      aria-label={messages.editRepresentativeTitle}
                      onClick={() => {
                        setRepresentativeTarget(representative);
                        setRepresentativeDialogOpen(true);
                      }}
                      size="icon"
                      variant="ghost"
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                  {detail.family.status === "active" &&
                  representative.status === "active" &&
                  representative.id !==
                    detail.family.primaryRepresentativeId ? (
                    <Button
                      aria-label={commandMessages.makePrimary}
                      onClick={() => {
                        setPrimaryError(null);
                        setPrimaryTarget(representative);
                      }}
                      size="icon"
                      variant="ghost"
                    >
                      <Star />
                    </Button>
                  ) : null}
                  {detail.family.status === "active" &&
                  (representative.status === "archived" ||
                    representative.id !==
                      detail.family.primaryRepresentativeId) ? (
                    <Button
                      aria-label={
                        representative.status === "active"
                          ? messages.archive
                          : messages.restore
                      }
                      onClick={() => {
                        setMemberLifecycleError(null);
                        setMemberLifecycleTarget({
                          kind: "representative",
                          member: representative,
                          status:
                            representative.status === "active"
                              ? "archived"
                              : "active",
                        });
                      }}
                      size="icon"
                      variant="ghost"
                    >
                      {representative.status === "active" ? (
                        <Archive />
                      ) : (
                        <RotateCcw />
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>
              {representative.status === "archived" ? (
                <Badge variant="secondary">{messages.archived}</Badge>
              ) : null}
              {representative.verifiedMessengerChannels.length ? (
                <div className="flex flex-wrap gap-2">
                  {representative.verifiedMessengerChannels.map((channel) => (
                    <Badge key={channel} variant="success">
                      <MessageCircleCheck className="mr-1 h-3 w-3" />
                      {messages.familyVerifiedMessenger} · {channel}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </Card>

        <Card className="min-w-0 space-y-4 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{messages.familyChildren}</h2>
            {detail.family.status === "active" ? (
              <Button
                onClick={() => {
                  setChildTarget(null);
                  setChildDialogOpen(true);
                }}
                size="sm"
                variant="outline"
              >
                <Plus /> {messages.addChild}
              </Button>
            ) : null}
          </div>
          {detail.children.map((child) => {
            const enrollments = detail.enrollments.filter(
              (enrollment) => enrollment.childId === child.id,
            );
            return (
              <article
                className="min-w-0 space-y-3 rounded-xl border border-border/70 p-3"
                data-testid={`airhop-server-child-${child.id}`}
                key={child.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{child.displayName}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatChildAgeAndBirthDate({
                        birthDate: child.birthDate,
                        onDate: detail.organization.currentDate,
                        locale: detail.organization.locale,
                      })}
                    </p>
                    {child.note ? (
                      <p className="mt-2 text-sm">{child.note}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {child.status === "active" ? (
                      <Button
                        aria-label={messages.editChildTitle}
                        onClick={() => {
                          setChildTarget(child);
                          setChildDialogOpen(true);
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                    {detail.family.status === "active" ? (
                      <Button
                        aria-label={
                          child.status === "active"
                            ? messages.archive
                            : messages.restore
                        }
                        onClick={() => {
                          setMemberLifecycleError(null);
                          setMemberLifecycleTarget({
                            kind: "child",
                            member: child,
                            status:
                              child.status === "active" ? "archived" : "active",
                          });
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        {child.status === "active" ? (
                          <Archive />
                        ) : (
                          <RotateCcw />
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {child.status === "archived" ? (
                  <Badge variant="secondary">{messages.archived}</Badge>
                ) : null}
                <section className="space-y-2 border-t border-border/70 pt-3">
                  <h3 className="text-sm font-semibold">
                    {messages.familyEnrollments}
                  </h3>
                  {!enrollments.length ? (
                    <p className="text-sm text-muted-foreground">
                      {messages.familyNoEnrollments}
                    </p>
                  ) : (
                    enrollments.map((enrollment) => (
                      <div
                        className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm"
                        key={enrollment.id}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">
                              {enrollment.groupName}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {enrollment.tariff
                                ? `${enrollment.tariff.name} · ${formatters.money(
                                    enrollment.tariff.priceMinor,
                                    enrollment.tariff.currency,
                                  )}`
                                : messages.enrollmentNeedsAssignment}
                            </p>
                          </div>
                          <Badge
                            variant={
                              enrollment.status === "active"
                                ? "success"
                                : "secondary"
                            }
                          >
                            {enrollmentStatusLabel(enrollment.status, messages)}
                          </Badge>
                        </div>
                        <p className="text-xs leading-5">
                          {enrollment.assignmentState === "needs_assignment"
                            ? messages.enrollmentNeedsAssignment
                            : enrollment.schedule
                                .map(
                                  (slot) =>
                                    `${formatters.weekdayName(slot.weekday)}, ${slot.startTime.slice(0, 5)}–${slot.endTime.slice(0, 5)}`,
                                )
                                .join(" · ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {messages.enrollmentStarts(
                            formatters.date(enrollment.startDate),
                          )}
                        </p>
                      </div>
                    ))
                  )}
                </section>
              </article>
            );
          })}
        </Card>
      </div>

      <Card className="min-w-0 space-y-4 p-4 sm:p-5">
        <h2 className="text-lg font-semibold">{messages.familyHistory}</h2>
        {!detail.bookings.length ? (
          <p className="text-sm text-muted-foreground">
            {messages.noRequestsTitle}
          </p>
        ) : (
          <div className="grid gap-2">
            {detail.bookings.map((booking) => {
              const child = childById.get(booking.childId);
              return (
                <button
                  className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 p-3 text-left hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
                  key={booking.id}
                  onClick={() => void navigate({ to: "/booking/requests" })}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {child?.displayName ?? messages.childName} ·{" "}
                      {booking.groupName}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarDays className="h-4 w-4" />
                      {formatters.date(booking.date)},{" "}
                      {booking.startTime.slice(0, 5)} · {booking.branchName}
                    </span>
                  </span>
                  <Badge
                    variant={
                      booking.status === "confirmed" ? "success" : "secondary"
                    }
                  >
                    {bookingStatusLabel(booking.status, messages)}
                  </Badge>
                </button>
              );
            })}
          </div>
        )}
        {detail.bookingHistoryTruncated ? (
          <p className="text-xs text-muted-foreground">
            {messages.familyHistoryTruncated}
          </p>
        ) : null}
      </Card>
      <ServerRepresentativeFormDialog
        familyId={detail.family.id}
        locale={detail.organization.locale}
        onOpenChange={(open) => {
          setRepresentativeDialogOpen(open);
          if (!open) setRepresentativeTarget(null);
        }}
        onSaved={reload}
        open={representativeDialogOpen}
        representative={representativeTarget}
      />
      <ServerChildFormDialog
        child={childTarget}
        detail={detail}
        onOpenChange={(open) => {
          setChildDialogOpen(open);
          if (!open) setChildTarget(null);
        }}
        onSaved={reload}
        open={childDialogOpen}
      />
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !isChangingMemberStatus) {
            setMemberLifecycleTarget(null);
            setMemberLifecycleError(null);
          }
        }}
        open={memberLifecycleTarget !== null}
      >
        <AlertDialogContent data-testid="airhop-server-member-status-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {memberLifecycleTarget?.status === "archived"
                ? commandMessages.memberArchiveTitle(
                    memberLifecycleTarget.member.displayName,
                  )
                : commandMessages.memberRestoreTitle(
                    memberLifecycleTarget?.member.displayName ?? "",
                  )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {memberLifecycleTarget?.status === "active"
                ? commandMessages.memberRestoreDescription
                : memberLifecycleTarget?.kind === "child"
                  ? commandMessages.childArchiveDescription
                  : commandMessages.representativeArchiveDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {memberLifecycleError ? (
            <Alert variant="destructive">
              <AlertDescription>{memberLifecycleError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isChangingMemberStatus}>
              {messages.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isChangingMemberStatus}
              onClick={(event) => {
                event.preventDefault();
                void changeMemberStatus();
              }}
            >
              {isChangingMemberStatus
                ? messages.saving
                : memberLifecycleTarget?.status === "archived"
                  ? messages.archive
                  : messages.restore}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !isChangingPrimary) {
            setPrimaryTarget(null);
            setPrimaryError(null);
          }
        }}
        open={primaryTarget !== null}
      >
        <AlertDialogContent data-testid="airhop-server-primary-representative-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {commandMessages.makePrimaryTitle(
                primaryTarget?.displayName ?? "",
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {commandMessages.makePrimaryDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {primaryError ? (
            <Alert variant="destructive">
              <AlertDescription>{primaryError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isChangingPrimary}>
              {messages.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isChangingPrimary}
              onClick={(event) => {
                event.preventDefault();
                void changePrimaryRepresentative();
              }}
            >
              {isChangingPrimary
                ? messages.saving
                : commandMessages.makePrimary}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Read-only production family card backed exclusively by Booking Core. */
export function ServerFamilyDetailsScreen({ familyId }: { familyId: string }) {
  const state = useStaffFamilyDetail(familyId);
  const [familyFormOpen, setFamilyFormOpen] = React.useState(false);
  const [statusConfirmationOpen, setStatusConfirmationOpen] =
    React.useState(false);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [isChangingStatus, setIsChangingStatus] = React.useState(false);
  const lifecycleService = React.useMemo(
    () => createHttpStaffFamilyLifecycleService(),
    [],
  );
  const messages = getBookingAdminMessages(
    state.detail?.organization.locale ?? "ru-RU",
  );
  const commandMessages = getStaffFamilyCommandMessages(
    state.detail?.organization.locale ?? "ru-RU",
  );
  const targetStatus =
    state.detail?.family.status === "archived" ? "active" : "archived";

  const changeStatus = async () => {
    if (!state.detail) return;
    setIsChangingStatus(true);
    setStatusError(null);
    try {
      await lifecycleService.setFamilyStatus({
        familyId: state.detail.family.id,
        expectedVersion: state.detail.family.version,
        status: targetStatus,
      });
      toast.success(
        targetStatus === "active"
          ? messages.familyRestored
          : messages.familyArchived,
      );
      setStatusConfirmationOpen(false);
      await state.reload();
    } catch (error) {
      setStatusError(
        error instanceof StaffFamilyLifecycleApiError
          ? error.message
          : messages.saveErrorDescription,
      );
      if (
        error instanceof StaffFamilyLifecycleApiError &&
        error.status === 409
      ) {
        await state.reload();
      }
    } finally {
      setIsChangingStatus(false);
    }
  };
  let body: React.ReactNode;
  if (state.status === "loading") {
    body = (
      <CenteredState
        description={messages.loadingDescription}
        icon={<LoaderCircle className="h-8 w-8 animate-spin" />}
        title={messages.loadingTitle}
      />
    );
  } else if (state.status === "not_found") {
    body = (
      <CenteredState
        description={messages.familyNotFoundDescription}
        icon={<UsersRound className="h-8 w-8" />}
        title={messages.familyNotFoundTitle}
      />
    );
  } else if (state.status === "error" || !state.detail) {
    body = (
      <CenteredState
        action={
          <Button onClick={() => void state.reload()} variant="outline">
            <RotateCcw /> {messages.retry}
          </Button>
        }
        description={messages.loadErrorDescription}
        icon={<AlertTriangle className="h-8 w-8" />}
        title={messages.loadErrorTitle}
      />
    );
  } else {
    body = <FamilyContent detail={state.detail} reload={state.reload} />;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
        <PageHeader
          action={
            state.detail ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {state.detail.family.status === "active" ? (
                  <Button
                    onClick={() => setFamilyFormOpen(true)}
                    variant="outline"
                  >
                    <Pencil /> {commandMessages.editFamily}
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    setStatusError(null);
                    setStatusConfirmationOpen(true);
                  }}
                  variant="outline"
                >
                  {state.detail.family.status === "active" ? (
                    <Archive />
                  ) : (
                    <RotateCcw />
                  )}
                  {state.detail.family.status === "active"
                    ? messages.archive
                    : messages.restore}
                </Button>
              </div>
            ) : undefined
          }
          description={
            state.detail?.family.status === "archived"
              ? messages.archived
              : messages.clientsDescription
          }
          title={state.detail?.family.displayName ?? messages.family}
        />
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6">
        {body}
      </div>
      {state.detail ? (
        <>
          <ServerFamilyFormDialog
            detail={state.detail}
            onOpenChange={setFamilyFormOpen}
            onSaved={state.reload}
            open={familyFormOpen}
          />
          <AlertDialog
            onOpenChange={(open) => {
              if (!isChangingStatus) setStatusConfirmationOpen(open);
              if (!open) setStatusError(null);
            }}
            open={statusConfirmationOpen}
          >
            <AlertDialogContent data-testid="airhop-server-family-status-dialog">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {targetStatus === "archived"
                    ? messages.familyArchiveTitle(
                        state.detail.family.displayName,
                      )
                    : messages.restore}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {targetStatus === "archived"
                    ? messages.familyArchiveDescription
                    : messages.familyServerReadOnly}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {statusError ? (
                <Alert variant="destructive">
                  <AlertDescription>{statusError}</AlertDescription>
                </Alert>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isChangingStatus}>
                  {messages.cancel}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={isChangingStatus}
                  onClick={(event) => {
                    event.preventDefault();
                    void changeStatus();
                  }}
                >
                  {isChangingStatus
                    ? messages.saving
                    : targetStatus === "archived"
                      ? messages.archive
                      : messages.restore}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}
