import * as React from "react";
import { Building2, CalendarDays, Plus, UsersRound } from "lucide-react";

import {
  BookingWorkspaceProvider,
  useBookingWorkspace,
} from "@/features/booking/data/BookingWorkspaceProvider";
import { createHttpBookingBranchesRepository } from "@/features/booking/data/httpBookingBranchesRepository";
import { currentAirhopStaffDataRuntime } from "@/features/booking/data/staffDataRuntime";
import {
  effectiveGroupAttendanceTracking,
  effectiveGroupTrialPolicy,
  groupUsage,
} from "@/features/booking/lib/bookingAdmin";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { groupActiveEnrollmentCount } from "@/features/booking/lib/bookingCommerceReadModels";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import { formatBookingAgeRange } from "@/features/booking/lib/bookingLocale";
import type { BookingGroup } from "@/features/booking/model/bookingCore";
import { setBookingGroupStatus } from "@/features/booking/model/bookingMutations";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { GroupFormDialog } from "@/features/booking/ui/GroupFormDialog";
import { EnrollmentDialog } from "@/features/booking/ui/EnrollmentDialog";
import { BookingSettingsNav } from "@/features/booking/ui/BookingSettingsNav";
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
import { PageHeader } from "@/shared/ui/PageHeader";

function GroupsContent({
  createRequest,
  enrollmentEnabled,
}: {
  createRequest: number;
  enrollmentEnabled: boolean;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const [formOpen, setFormOpen] = React.useState(false);
  const [selectedGroup, setSelectedGroup] = React.useState<BookingGroup | null>(
    null,
  );
  const [archiveTarget, setArchiveTarget] = React.useState<BookingGroup | null>(
    null,
  );
  const [enrollmentGroupId, setEnrollmentGroupId] = React.useState<
    string | null
  >(null);
  const [feedbackMessage, setFeedbackMessage] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    if (!createRequest) return;
    setSelectedGroup(null);
    setFormOpen(true);
  }, [createRequest]);

  const groups = [...workspace.groups].sort((first, second) => {
    if (first.status !== second.status)
      return first.status === "active" ? -1 : 1;
    return first.name.localeCompare(second.name, workspace.organization.locale);
  });
  const branchById = new Map(
    workspace.branches.map((branch) => [branch.id, branch]),
  );
  const roomById = new Map(workspace.rooms.map((room) => [room.id, room]));
  const teacherById = new Map(
    workspace.teachers.map((teacher) => [teacher.id, teacher]),
  );
  const currentDate = organizationLocalDateTime(
    workspace.organization.timeZone,
    new Date(),
  ).date;

  const setStatus = async (
    group: BookingGroup,
    status: BookingGroup["status"],
  ) => {
    setFeedbackMessage(null);
    if (
      status === "active" &&
      branchById.get(group.branchId)?.status !== "active"
    ) {
      setFeedbackMessage(messages.restoreGroupBlocked);
      return;
    }
    try {
      await booking.save((current) =>
        setBookingGroupStatus(current, group.id, status),
      );
      setFeedbackMessage(
        status === "archived" ? messages.groupArchived : messages.groupRestored,
      );
      setArchiveTarget(null);
    } catch {
      // Shared feedback explains storage and revision failures.
    }
  };

  const archiveUsage = archiveTarget
    ? groupUsage(workspace, archiveTarget.id)
    : null;

  return (
    <>
      <div className="space-y-4">
        <BookingFeedbackBanners />
        {feedbackMessage ? (
          <Alert>
            <AlertDescription>{feedbackMessage}</AlertDescription>
          </Alert>
        ) : null}
        {!groups.length ? (
          <Card className="space-y-3 p-8 text-center">
            <UsersRound className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{messages.noGroupsTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {messages.noGroupsDescription}
            </p>
            <Button
              onClick={() => {
                setSelectedGroup(null);
                setFormOpen(true);
              }}
            >
              <Plus />
              {messages.addGroup}
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {groups.map((group) => {
              const branch = branchById.get(group.branchId);
              const room = group.roomId ? roomById.get(group.roomId) : null;
              const teachers = group.teacherIds
                .map((teacherId) => teacherById.get(teacherId))
                .filter((teacher) => teacher !== undefined);
              const templates = workspace.recurrenceRules.filter(
                (rule) => rule.groupId === group.id && rule.status === "active",
              ).length;
              const activeStudents = groupActiveEnrollmentCount(
                workspace,
                group.id,
                currentDate,
              );
              const trial = effectiveGroupTrialPolicy(workspace, group);
              const attendance = effectiveGroupAttendanceTracking(
                workspace,
                group,
              );
              const trialLabel =
                trial.mode === "disabled"
                  ? messages.trialDisabled
                  : trial.mode === "free"
                    ? messages.trialFree
                    : messages.trialPaid;
              return (
                <Card
                  className="flex min-w-0 flex-col gap-4 p-5"
                  data-testid={`airhop-group-${group.id}`}
                  key={group.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold">
                          {group.name}
                        </h2>
                        <Badge
                          variant={
                            group.status === "active" ? "success" : "secondary"
                          }
                        >
                          {group.status === "active"
                            ? messages.active
                            : messages.archived}
                        </Badge>
                      </div>
                      {group.description ? (
                        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                          {group.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <p className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0" />
                      <span>
                        {branch?.status === "archived"
                          ? messages.archivedBranchOption(branch.name)
                          : (branch?.name ?? group.branchId)}
                        {room ? ` · ${room.name}` : ""}
                      </span>
                    </p>
                    <p className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 shrink-0" />
                      {messages.groupScheduleSummary(templates)}
                    </p>
                    <p>
                      {formatBookingAgeRange({
                        locale: workspace.organization.locale,
                        minAgeMonths: group.minAgeMonths,
                        maxAgeMonths: group.maxAgeMonths,
                      })}
                    </p>
                    <p>
                      {group.capacity === undefined
                        ? messages.groupCapacityUnlimited
                        : `${messages.groupCapacity}: ${group.capacity}`}
                    </p>
                    <p>
                      {messages.groupTeachersSummary(group.teacherIds.length)}
                    </p>
                    <p>{messages.groupActiveStudents(activeStudents)}</p>
                    <p>{messages.trialEffective(trialLabel)}</p>
                    <p>
                      {messages.attendanceEffective(
                        attendance
                          ? messages.attendanceEnabled
                          : messages.attendanceDisabled,
                      )}
                    </p>
                  </div>
                  {teachers.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {teachers.map((teacher) => (
                        <Badge key={teacher.id} variant="outline">
                          {teacher.status === "archived"
                            ? messages.archivedTeacherOption(
                                teacher.displayName,
                              )
                            : teacher.displayName}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-border/70 pt-4">
                    {enrollmentEnabled &&
                    group.status === "active" &&
                    templates > 0 ? (
                      <Button
                        data-testid={`airhop-enroll-group-${group.id}`}
                        onClick={() => setEnrollmentGroupId(group.id)}
                        size="sm"
                      >
                        <Plus />
                        {messages.groupEnrollStudent}
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => {
                        setSelectedGroup(group);
                        setFormOpen(true);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {messages.edit}
                    </Button>
                    {group.status === "active" ? (
                      <Button
                        onClick={() => setArchiveTarget(group)}
                        size="sm"
                        variant="ghost"
                      >
                        {messages.archive}
                      </Button>
                    ) : (
                      <Button
                        disabled={booking.isSaving}
                        onClick={() => void setStatus(group, "active")}
                        size="sm"
                        variant="ghost"
                      >
                        {messages.restore}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <GroupFormDialog
        group={selectedGroup}
        onOpenChange={setFormOpen}
        onSaved={(kind) =>
          setFeedbackMessage(
            kind === "created" ? messages.groupCreated : messages.groupUpdated,
          )
        }
        open={formOpen}
      />
      {enrollmentEnabled ? (
        <EnrollmentDialog
          initialGroupId={enrollmentGroupId ?? undefined}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEnrollmentGroupId(null);
          }}
          onSaved={() => setFeedbackMessage(messages.enrollmentCreated)}
          open={enrollmentGroupId !== null}
        />
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        open={archiveTarget !== null}
      >
        <AlertDialogContent data-testid="airhop-archive-group-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {messages.archiveGroupTitle(archiveTarget?.name ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>{messages.archiveGroupDescription}</p>
              {archiveUsage ? (
                <p>
                  {messages.groupUsage(
                    archiveUsage.rules,
                    archiveUsage.exceptions,
                  )}
                </p>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={booking.isSaving}
              onClick={(event) => {
                event.preventDefault();
                if (archiveTarget) void setStatus(archiveTarget, "archived");
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

function GroupsScreenContent({
  enrollmentEnabled,
}: {
  enrollmentEnabled: boolean;
}) {
  const booking = useBookingWorkspace();
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  const [createRequested, setCreateRequested] = React.useState(0);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-6 py-5">
        <PageHeader
          action={
            <Button
              data-testid="airhop-add-group"
              onClick={() => setCreateRequested((value) => value + 1)}
            >
              <Plus />
              {messages.addGroup}
            </Button>
          }
          description={messages.groupsDescription}
          title={messages.groupsTitle}
        />
        <BookingSettingsNav active="groups" className="mt-4" />
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <BookingWorkspaceGate>
          {() => (
            <GroupsContent
              createRequest={createRequested}
              enrollmentEnabled={enrollmentEnabled}
            />
          )}
        </BookingWorkspaceGate>
      </div>
    </div>
  );
}

function ServerGroupsScreen() {
  const [repository] = React.useState(() =>
    createHttpBookingBranchesRepository(),
  );
  return (
    <BookingWorkspaceProvider repository={repository}>
      <GroupsScreenContent enrollmentEnabled={false} />
    </BookingWorkspaceProvider>
  );
}

/** Uses PostgreSQL in Tauri while retaining demo enrollment flows in previews. */
export function GroupsScreen() {
  return currentAirhopStaffDataRuntime() === "server" ? (
    <ServerGroupsScreen />
  ) : (
    <GroupsScreenContent enrollmentEnabled />
  );
}
