import * as React from "react";
import { AtSign, Plus, UserRound } from "lucide-react";

import {
  BookingWorkspaceProvider,
  useBookingWorkspace,
} from "@/features/booking/data/BookingWorkspaceProvider";
import { createHttpBookingBranchesRepository } from "@/features/booking/data/httpBookingBranchesRepository";
import { currentAirhopStaffDataRuntime } from "@/features/booking/data/staffDataRuntime";
import { teacherUsage } from "@/features/booking/lib/bookingAdmin";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import type { BookingTeacher } from "@/features/booking/model/bookingCore";
import { setBookingTeacherStatus } from "@/features/booking/model/bookingMutations";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { TeacherFormDialog } from "@/features/booking/ui/TeacherFormDialog";
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

function TeachersContent({ createRequest }: { createRequest: number }) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const [formOpen, setFormOpen] = React.useState(false);
  const [selectedTeacher, setSelectedTeacher] =
    React.useState<BookingTeacher | null>(null);
  const [archiveTarget, setArchiveTarget] =
    React.useState<BookingTeacher | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    if (!createRequest) return;
    setSelectedTeacher(null);
    setFormOpen(true);
  }, [createRequest]);

  const teachers = [...workspace.teachers].sort((first, second) => {
    if (first.status !== second.status)
      return first.status === "active" ? -1 : 1;
    return first.displayName.localeCompare(
      second.displayName,
      workspace.organization.locale,
    );
  });

  const setStatus = async (
    teacher: BookingTeacher,
    status: BookingTeacher["status"],
  ) => {
    setSuccessMessage(null);
    try {
      await booking.save((current) =>
        setBookingTeacherStatus(current, teacher.id, status),
      );
      setSuccessMessage(
        status === "archived"
          ? messages.teacherArchived
          : messages.teacherRestored,
      );
      setArchiveTarget(null);
    } catch {
      // Shared feedback explains storage and revision failures.
    }
  };

  const archiveUsage = archiveTarget
    ? teacherUsage(workspace, archiveTarget.id)
    : null;

  return (
    <>
      <div className="space-y-4">
        <BookingFeedbackBanners />
        {successMessage ? (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}
        {!teachers.length ? (
          <Card className="space-y-3 p-8 text-center">
            <UserRound className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {messages.noTeachersTitle}
            </h2>
            <p className="text-sm text-muted-foreground">
              {messages.noTeachersDescription}
            </p>
            <Button
              onClick={() => {
                setSelectedTeacher(null);
                setFormOpen(true);
              }}
            >
              <Plus />
              {messages.addTeacher}
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {teachers.map((teacher) => {
              const usage = teacherUsage(workspace, teacher.id);
              return (
                <Card
                  className="flex min-w-0 flex-col gap-4 p-5"
                  data-testid={`airhop-teacher-${teacher.id}`}
                  key={teacher.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold">
                          {teacher.displayName}
                        </h2>
                        <Badge
                          variant={
                            teacher.status === "active"
                              ? "success"
                              : "secondary"
                          }
                        >
                          {teacher.status === "active"
                            ? messages.active
                            : messages.archived}
                        </Badge>
                      </div>
                      {teacher.buzzUsername ? (
                        <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                          <AtSign className="h-4 w-4" />
                          {teacher.buzzUsername}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {messages.teacherGroupsSummary(usage.groups)}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-border/70 pt-4">
                    <Button
                      onClick={() => {
                        setSelectedTeacher(teacher);
                        setFormOpen(true);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {messages.edit}
                    </Button>
                    {teacher.status === "active" ? (
                      <Button
                        onClick={() => setArchiveTarget(teacher)}
                        size="sm"
                        variant="ghost"
                      >
                        {messages.archive}
                      </Button>
                    ) : (
                      <Button
                        disabled={booking.isSaving}
                        onClick={() => void setStatus(teacher, "active")}
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

      <TeacherFormDialog
        onOpenChange={setFormOpen}
        onSaved={(kind) =>
          setSuccessMessage(
            kind === "created"
              ? messages.teacherCreated
              : messages.teacherUpdated,
          )
        }
        open={formOpen}
        teacher={selectedTeacher}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        open={archiveTarget !== null}
      >
        <AlertDialogContent data-testid="airhop-archive-teacher-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {messages.archiveTeacherTitle(archiveTarget?.displayName ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>{messages.archiveTeacherDescription}</p>
              {archiveUsage ? (
                <p>
                  {messages.teacherUsage(
                    archiveUsage.groups,
                    archiveUsage.rules,
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

function TeachersScreenContent() {
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
              data-testid="airhop-add-teacher"
              onClick={() => setCreateRequested((value) => value + 1)}
            >
              <Plus />
              {messages.addTeacher}
            </Button>
          }
          description={messages.teachersDescription}
          title={messages.teachersTitle}
        />
        <BookingSettingsNav active="teachers" className="mt-4" />
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <BookingWorkspaceGate>
          {() => <TeachersContent createRequest={createRequested} />}
        </BookingWorkspaceGate>
      </div>
    </div>
  );
}

function ServerTeachersScreen() {
  const [repository] = React.useState(() =>
    createHttpBookingBranchesRepository(),
  );
  return (
    <BookingWorkspaceProvider repository={repository}>
      <TeachersScreenContent />
    </BookingWorkspaceProvider>
  );
}

/** Uses PostgreSQL teacher commands in Tauri and isolated demo state in previews. */
export function TeachersScreen() {
  return currentAirhopStaffDataRuntime() === "server" ? (
    <ServerTeachersScreen />
  ) : (
    <TeachersScreenContent />
  );
}
