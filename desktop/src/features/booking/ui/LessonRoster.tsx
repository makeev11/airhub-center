import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { UserRound } from "lucide-react";

import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { lessonRoster } from "@/features/booking/lib/bookingClients";
import type {
  BookingAttendanceRecord,
  BookingWorkspace,
  StableLessonReference,
} from "@/features/booking/model/bookingCore";
import { EnrollmentDialog } from "@/features/booking/ui/EnrollmentDialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

export function LessonRoster({
  isSaving,
  lessonRef,
  onSetAttendance,
  trackAttendance,
  workspace,
}: {
  isSaving: boolean;
  lessonRef: StableLessonReference;
  onSetAttendance: (
    childId: string,
    status: BookingAttendanceRecord["status"] | null,
  ) => void;
  trackAttendance: boolean;
  workspace: BookingWorkspace;
}) {
  const navigate = useNavigate();
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const entries = lessonRoster(workspace, lessonRef);
  const groupId = workspace.recurrenceRules.find(
    (rule) => rule.id === lessonRef.recurrenceRuleId,
  )?.groupId;
  const [enrollmentTarget, setEnrollmentTarget] = useState<{
    childId: string;
    groupId: string;
  } | null>(null);

  return (
    <>
      <section
        className="space-y-3 rounded-xl border border-border/70 p-3 sm:p-4"
        data-testid="airhop-lesson-roster"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{messages.lessonRosterTitle}</h3>
          <span className="text-xs text-muted-foreground">
            {messages.lessonRosterExpected(entries.length)}
          </span>
        </div>
        {!entries.length ? (
          <p className="text-sm text-muted-foreground">
            {messages.lessonRosterEmpty}
          </p>
        ) : (
          <div className="grid gap-2">
            {entries.map((entry) => (
              <div
                className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3"
                data-testid={`airhop-roster-${entry.key}`}
                key={entry.key}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {entry.child.displayName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.representative.displayName}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      entry.enrollment || entry.booking?.status === "confirmed"
                        ? "success"
                        : "secondary"
                    }
                  >
                    {entry.booking?.status === "pending_confirmation"
                      ? messages.lessonRosterPending
                      : entry.enrollment
                        ? messages.lessonRosterPermanent
                        : entry.visitKind === "single"
                          ? messages.lessonRosterSingle
                          : entry.visitKind === "trial"
                            ? messages.lessonRosterTrial
                            : messages.lessonRosterConfirmed}
                  </Badge>
                  {trackAttendance ? (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        aria-pressed={entry.attendance?.status === "present"}
                        disabled={isSaving}
                        onClick={() =>
                          onSetAttendance(
                            entry.child.id,
                            entry.attendance?.status === "present"
                              ? null
                              : "present",
                          )
                        }
                        size="sm"
                        type="button"
                        variant={
                          entry.attendance?.status === "present"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {messages.participantAttendancePresent}
                      </Button>
                      <Button
                        aria-pressed={entry.attendance?.status === "absent"}
                        disabled={isSaving}
                        onClick={() =>
                          onSetAttendance(
                            entry.child.id,
                            entry.attendance?.status === "absent"
                              ? null
                              : "absent",
                          )
                        }
                        size="sm"
                        type="button"
                        variant={
                          entry.attendance?.status === "absent"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {messages.participantAttendanceAbsent}
                      </Button>
                    </div>
                  ) : null}
                  {entry.booking?.status === "confirmed" &&
                  entry.visitKind === "trial" &&
                  !entry.enrollment &&
                  groupId ? (
                    <Button
                      data-testid={`airhop-enroll-trial-${entry.child.id}`}
                      onClick={() =>
                        setEnrollmentTarget({
                          childId: entry.child.id,
                          groupId,
                        })
                      }
                      size="sm"
                      type="button"
                    >
                      {messages.familyEnrollChild}
                    </Button>
                  ) : null}
                  <Button
                    onClick={() =>
                      void navigate({
                        to: "/booking/clients/$familyId",
                        params: { familyId: entry.family.id },
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
      <EnrollmentDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEnrollmentTarget(null);
        }}
        open={enrollmentTarget !== null}
        sourceVisit={enrollmentTarget ?? undefined}
      />
    </>
  );
}
