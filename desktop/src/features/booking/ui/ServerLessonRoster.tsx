import { useNavigate } from "@tanstack/react-router";
import { UserRound } from "lucide-react";

import type {
  StaffLessonAttendanceStatus,
  StaffLessonRoster,
} from "@/features/booking/data/staffLessonService";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

export function ServerLessonRoster({
  error,
  isLoading,
  isSaving,
  locale,
  onSetAttendance,
  roster,
}: {
  error: Error | null;
  isLoading: boolean;
  isSaving: boolean;
  locale: string;
  onSetAttendance: (
    childId: string,
    expectedVersion: number,
    status: StaffLessonAttendanceStatus | null,
  ) => void;
  roster: StaffLessonRoster | null;
}) {
  const navigate = useNavigate();
  const messages = getBookingAdminMessages(locale);
  const items = roster?.items ?? [];

  return (
    <section
      className="space-y-3 rounded-xl border border-border/70 p-3 sm:p-4"
      data-testid="airhop-lesson-roster"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{messages.lessonRosterTitle}</h3>
        <span className="text-xs text-muted-foreground">
          {messages.lessonRosterExpected(items.length)}
        </span>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{messages.loadErrorDescription}</AlertDescription>
        </Alert>
      ) : null}
      {isLoading && !items.length ? (
        <p className="text-sm text-muted-foreground">
          {messages.loadingDescription}
        </p>
      ) : !items.length ? (
        <p className="text-sm text-muted-foreground">
          {messages.lessonRosterEmpty}
        </p>
      ) : (
        <div className="grid gap-2">
          {items.map((entry) => (
            <div
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3"
              data-testid={`airhop-roster-${entry.childId}`}
              key={entry.childId}
            >
              <div className="flex min-w-0 items-center gap-3">
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.childName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.representativeName}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    entry.enrollmentId || entry.bookingStatus === "confirmed"
                      ? "success"
                      : "secondary"
                  }
                >
                  {entry.bookingStatus === "pending_confirmation"
                    ? messages.lessonRosterPending
                    : entry.enrollmentId
                      ? messages.lessonRosterPermanent
                      : entry.visitKind === "single"
                        ? messages.lessonRosterSingle
                        : entry.visitKind === "trial"
                          ? messages.lessonRosterTrial
                          : messages.lessonRosterConfirmed}
                </Badge>
                {roster?.trackAttendance ? (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      aria-pressed={entry.attendanceStatus === "present"}
                      disabled={isSaving}
                      onClick={() =>
                        onSetAttendance(
                          entry.childId,
                          entry.attendanceVersion,
                          entry.attendanceStatus === "present"
                            ? null
                            : "present",
                        )
                      }
                      size="sm"
                      type="button"
                      variant={
                        entry.attendanceStatus === "present"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {messages.participantAttendancePresent}
                    </Button>
                    <Button
                      aria-pressed={entry.attendanceStatus === "absent"}
                      disabled={isSaving}
                      onClick={() =>
                        onSetAttendance(
                          entry.childId,
                          entry.attendanceVersion,
                          entry.attendanceStatus === "absent" ? null : "absent",
                        )
                      }
                      size="sm"
                      type="button"
                      variant={
                        entry.attendanceStatus === "absent"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {messages.participantAttendanceAbsent}
                    </Button>
                  </div>
                ) : null}
                <Button
                  onClick={() =>
                    void navigate({
                      to: "/booking/clients/$familyId",
                      params: { familyId: entry.familyId },
                    })
                  }
                  size="sm"
                  variant="ghost"
                >
                  {messages.requestOpenFamily}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
