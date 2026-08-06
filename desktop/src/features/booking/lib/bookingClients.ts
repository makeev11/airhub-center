import { resolveStablePublicOccurrence } from "@/features/booking/lib/publicBookingAvailability";
import type {
  BookingAttendanceRecord,
  BookingChild,
  BookingEnrollment,
  BookingFamily,
  BookingIntakeRequest,
  BookingRepresentative,
  BookingVisitKind,
  BookingWorkspace,
  PublicLessonBooking,
  StableLessonReference,
} from "@/features/booking/model/bookingCore";
import {
  attendanceForLesson,
  enrollmentCoversLesson,
} from "@/features/booking/model/bookingOperations";
import { stableLessonReferenceKey } from "@/features/booking/model/publicBooking";

type BookingRequestRowBase = {
  family: BookingFamily;
  representative: BookingRepresentative;
  child: BookingChild;
  groupName?: string;
  branchName?: string;
  date?: string;
  startTime?: string;
  requiresAttention: boolean;
};

export type BookingQueueRow = BookingRequestRowBase & {
  kind: "booking";
  booking: PublicLessonBooking;
  groupName: string;
  branchName: string;
  date: string;
  startTime: string;
};

export type IntakeQueueRow = BookingRequestRowBase & {
  kind: "intake";
  request: BookingIntakeRequest;
};

export type BookingRequestRow = BookingQueueRow | IntakeQueueRow;

export type FamilySummary = {
  family: BookingFamily;
  primaryRepresentative: BookingRepresentative;
  representatives: BookingRepresentative[];
  children: BookingChild[];
  bookingCount: number;
  lastActivityAt: string;
  requiresAttention: boolean;
};

export type LessonRosterEntry = {
  key: string;
  source: "enrollment" | "booking" | "enrollment_and_booking";
  booking?: PublicLessonBooking;
  enrollment?: BookingEnrollment;
  attendance?: BookingAttendanceRecord;
  visitKind?: BookingVisitKind;
  family: BookingFamily;
  representative: BookingRepresentative;
  child: BookingChild;
};

function pendingDuplicateEntityIds(workspace: BookingWorkspace): Set<string> {
  const ids = new Set<string>();
  for (const candidate of workspace.duplicateCandidates) {
    if (candidate.status !== "pending") continue;
    ids.add(candidate.newEntityId);
    ids.add(candidate.existingEntityId);
  }
  return ids;
}

function requestPriority(
  row: BookingRequestRow,
  duplicateEntityIds: ReadonlySet<string>,
): number {
  if (row.kind === "intake") return row.request.status === "new" ? 0 : 3;
  if (row.booking.status === "pending_confirmation") return 0;
  if (row.booking.transferRequest?.status === "pending") return 1;
  if (
    duplicateEntityIds.has(row.representative.id) ||
    duplicateEntityIds.has(row.child.id)
  ) {
    return 2;
  }
  return 3;
}

export function bookingRequestRows(
  workspace: BookingWorkspace,
): BookingRequestRow[] {
  const familyById = new Map(
    workspace.families.map((family) => [family.id, family]),
  );
  const representativeById = new Map(
    workspace.representatives.map((representative) => [
      representative.id,
      representative,
    ]),
  );
  const childById = new Map(
    workspace.children.map((child) => [child.id, child]),
  );
  const duplicateEntityIds = pendingDuplicateEntityIds(workspace);
  const rows: BookingRequestRow[] = [];

  for (const booking of workspace.bookings) {
    if (booking.source.workflow === "direct") continue;
    const family = familyById.get(booking.familyId);
    const representative = representativeById.get(booking.representativeId);
    const child = childById.get(booking.childId);
    const occurrence = resolveStablePublicOccurrence(
      workspace,
      booking.lessonRef,
    );
    if (
      !family ||
      !representative ||
      !child ||
      representative.familyId !== family.id ||
      child.familyId !== family.id ||
      !occurrence
    ) {
      continue;
    }
    const group = workspace.groups.find(
      (candidate) => candidate.id === occurrence.groupId,
    );
    const branch = workspace.branches.find(
      (candidate) => candidate.id === occurrence.branchId,
    );
    if (!group || !branch) continue;
    const requiresAttention =
      booking.status === "pending_confirmation" ||
      booking.transferRequest?.status === "pending" ||
      duplicateEntityIds.has(representative.id) ||
      duplicateEntityIds.has(child.id);
    rows.push({
      kind: "booking",
      booking,
      family,
      representative,
      child,
      groupName: group.name,
      branchName: branch.name,
      date: occurrence.date,
      startTime: occurrence.startTime,
      requiresAttention,
    });
  }

  for (const request of workspace.intakeRequests) {
    const family = familyById.get(request.familyId);
    const representative = representativeById.get(request.representativeId);
    const child = childById.get(request.childId);
    if (
      !family ||
      !representative ||
      !child ||
      representative.familyId !== family.id ||
      child.familyId !== family.id
    ) {
      continue;
    }
    const branch = request.branchId
      ? workspace.branches.find(
          (candidate) => candidate.id === request.branchId,
        )
      : undefined;
    const group = request.groupId
      ? workspace.groups.find((candidate) => candidate.id === request.groupId)
      : undefined;
    rows.push({
      kind: "intake",
      request,
      family,
      representative,
      child,
      ...(group ? { groupName: group.name } : {}),
      ...(branch ? { branchName: branch.name } : {}),
      requiresAttention:
        request.status === "new" ||
        duplicateEntityIds.has(representative.id) ||
        duplicateEntityIds.has(child.id),
    });
  }

  return rows.sort((left, right) => {
    const priority =
      requestPriority(left, duplicateEntityIds) -
      requestPriority(right, duplicateEntityIds);
    if (priority !== 0) return priority;
    const leftActivity =
      left.kind === "booking" ? left.booking.updatedAt : left.request.updatedAt;
    const rightActivity =
      right.kind === "booking"
        ? right.booking.updatedAt
        : right.request.updatedAt;
    const activity = rightActivity.localeCompare(leftActivity);
    if (activity !== 0) return activity;
    const leftCreated =
      left.kind === "booking" ? left.booking.createdAt : left.request.createdAt;
    const rightCreated =
      right.kind === "booking"
        ? right.booking.createdAt
        : right.request.createdAt;
    const created = rightCreated.localeCompare(leftCreated);
    if (created !== 0) return created;
    const leftId = left.kind === "booking" ? left.booking.id : left.request.id;
    const rightId =
      right.kind === "booking" ? right.booking.id : right.request.id;
    return leftId.localeCompare(rightId);
  });
}

function normalizeSearchValue(value: string, locale: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase(locale)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function searchFamilySummaries(
  workspace: BookingWorkspace,
  query: string,
): FamilySummary[] {
  const normalizedQuery = normalizeSearchValue(
    query,
    workspace.organization.locale,
  );
  const queryDigits = query.replace(/\D/g, "");
  const duplicateEntityIds = pendingDuplicateEntityIds(workspace);

  const summaries = workspace.families.flatMap((family): FamilySummary[] => {
    const representatives = workspace.representatives.filter(
      (representative) => representative.familyId === family.id,
    );
    const children = workspace.children.filter(
      (child) => child.familyId === family.id,
    );
    const primaryRepresentative = representatives.find(
      (representative) => representative.id === family.primaryRepresentativeId,
    );
    if (!primaryRepresentative) return [];
    const bookings = workspace.bookings.filter(
      (booking) => booking.familyId === family.id,
    );
    const textValues = [
      family.displayName,
      ...representatives.map((representative) => representative.displayName),
      ...children.map((child) => child.displayName),
    ].map((value) =>
      normalizeSearchValue(value, workspace.organization.locale),
    );
    const phoneValues = representatives.map((representative) =>
      representative.phoneNormalized.replace(/\D/g, ""),
    );
    const matches =
      normalizedQuery.length === 0 ||
      textValues.some((value) => value.includes(normalizedQuery)) ||
      (queryDigits.length > 0 &&
        phoneValues.some((value) => value.includes(queryDigits)));
    if (!matches) return [];
    const lastActivityAt = [
      family.updatedAt,
      ...representatives.map((representative) => representative.updatedAt),
      ...children.map((child) => child.updatedAt),
      ...bookings.map((booking) => booking.updatedAt),
    ].sort((left, right) => right.localeCompare(left))[0];
    return [
      {
        family,
        primaryRepresentative,
        representatives,
        children,
        bookingCount: bookings.length,
        lastActivityAt,
        requiresAttention: [...representatives, ...children].some((entity) =>
          duplicateEntityIds.has(entity.id),
        ),
      },
    ];
  });

  return summaries.sort((left, right) => {
    if (left.family.status !== right.family.status) {
      return left.family.status === "active" ? -1 : 1;
    }
    return left.family.displayName.localeCompare(
      right.family.displayName,
      workspace.organization.locale,
    );
  });
}

export function lessonRoster(
  workspace: BookingWorkspace,
  lessonRef: StableLessonReference,
): LessonRosterEntry[] {
  const referenceKey = stableLessonReferenceKey(lessonRef);
  const occurrence = resolveStablePublicOccurrence(workspace, lessonRef);
  if (!occurrence) return [];
  const familyById = new Map(
    workspace.families.map((family) => [family.id, family]),
  );
  const representativeById = new Map(
    workspace.representatives.map((representative) => [
      representative.id,
      representative,
    ]),
  );
  const childById = new Map(
    workspace.children.map((child) => [child.id, child]),
  );
  const attendanceByChildId = attendanceForLesson(workspace, lessonRef);
  const entriesByChildId = new Map<string, LessonRosterEntry>();

  for (const booking of workspace.bookings.filter(
    (booking) =>
      stableLessonReferenceKey(booking.lessonRef) === referenceKey &&
      (booking.status === "pending_confirmation" ||
        booking.status === "confirmed"),
  )) {
    const family = familyById.get(booking.familyId);
    const representative = representativeById.get(booking.representativeId);
    const child = childById.get(booking.childId);
    if (
      !family ||
      !representative ||
      !child ||
      representative.familyId !== family.id ||
      child.familyId !== family.id
    ) {
      continue;
    }
    entriesByChildId.set(child.id, {
      key: child.id,
      source: "booking",
      booking,
      attendance: attendanceByChildId.get(child.id),
      visitKind: booking.visitKind,
      family,
      representative,
      child,
    });
  }

  for (const enrollment of workspace.enrollments) {
    if (
      !enrollmentCoversLesson(enrollment, {
        groupId: occurrence.groupId,
        date: occurrence.date,
        lessonRef,
      })
    ) {
      continue;
    }
    const family = familyById.get(enrollment.familyId);
    const child = childById.get(enrollment.childId);
    const representative = family
      ? representativeById.get(family.primaryRepresentativeId)
      : undefined;
    if (
      !family ||
      !representative ||
      !child ||
      representative.familyId !== family.id ||
      child.familyId !== family.id
    ) {
      continue;
    }
    const existing = entriesByChildId.get(child.id);
    entriesByChildId.set(child.id, {
      key: child.id,
      source: existing ? "enrollment_and_booking" : "enrollment",
      ...(existing?.booking ? { booking: existing.booking } : {}),
      enrollment,
      attendance: attendanceByChildId.get(child.id),
      ...(existing?.visitKind ? { visitKind: existing.visitKind } : {}),
      family,
      representative: existing?.representative ?? representative,
      child,
    });
  }

  return [...entriesByChildId.values()].sort((left, right) => {
    const status =
      (left.booking?.status === "pending_confirmation" ? 0 : 1) -
      (right.booking?.status === "pending_confirmation" ? 0 : 1);
    if (status !== 0) return status;
    return left.child.displayName.localeCompare(
      right.child.displayName,
      workspace.organization.locale,
    );
  });
}

export function familyBookings(
  workspace: BookingWorkspace,
  familyId: string,
): BookingQueueRow[] {
  return bookingRequestRows(workspace).filter(
    (row): row is BookingQueueRow =>
      row.kind === "booking" && row.family.id === familyId,
  );
}
