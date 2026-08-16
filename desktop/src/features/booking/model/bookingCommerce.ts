import {
  enrollmentSchema,
  parseBookingWorkspace,
  paymentExpectationSchema,
  tariffSchema,
  type BookingEnrollment,
  type BookingTariff,
  type BookingWorkspace,
  type BookingWorkspaceDraft,
  type ConfiguredBookingEnrollment,
  type PaymentExpectation,
  type WeeklyScheduleSelection,
} from "@/features/booking/model/bookingCore";
import { isExactBirthDateEligible } from "@/features/booking/model/publicBooking";

export type BookingCommerceErrorCode =
  | "unknown_tariff"
  | "archived_tariff"
  | "inactive_group"
  | "invalid_weekly_selection"
  | "schedule_limit_exceeded"
  | "age_mismatch"
  | "overlapping_enrollment"
  | "invalid_payment_snapshot"
  | "invalid_payment_transition"
  | "entity_not_found"
  | "entity_already_exists";

export class BookingCommerceError extends Error {
  readonly code: BookingCommerceErrorCode;

  constructor(code: BookingCommerceErrorCode, message: string) {
    super(message);
    this.name = "BookingCommerceError";
    this.code = code;
  }
}

function workspaceDraft(workspace: BookingWorkspace): BookingWorkspaceDraft {
  const { revision: _revision, ...draft } = workspace;
  return draft;
}

function checkedDraft(
  workspace: BookingWorkspace,
  draft: BookingWorkspaceDraft,
): BookingWorkspaceDraft {
  const checked = parseBookingWorkspace({
    ...draft,
    revision: workspace.revision,
  });
  return workspaceDraft(checked);
}

function rangesOverlap(
  left: Pick<BookingEnrollment, "startDate" | "endDate">,
  right: Pick<BookingEnrollment, "startDate" | "endDate">,
): boolean {
  return (
    (left.endDate === undefined || left.endDate >= right.startDate) &&
    (right.endDate === undefined || right.endDate >= left.startDate)
  );
}

export function weeklySelectionKey(selection: WeeklyScheduleSelection): string {
  return `${selection.recurrenceRuleId}:${selection.weekday}`;
}

function requireTariff(
  workspace: BookingWorkspace,
  tariffId: string,
): BookingTariff {
  const tariff = workspace.tariffs.find(
    (candidate) => candidate.id === tariffId,
  );
  if (!tariff) {
    throw new BookingCommerceError(
      "unknown_tariff",
      `Unknown tariff ${tariffId}`,
    );
  }
  return tariff;
}

function validateConfiguredEnrollment(
  workspace: BookingWorkspace,
  input: ConfiguredBookingEnrollment,
  ignoredEnrollmentId?: string,
): { enrollment: ConfiguredBookingEnrollment; tariff: BookingTariff } {
  const enrollment = enrollmentSchema.parse(input);
  if (enrollment.assignmentState !== "configured") {
    throw new BookingCommerceError(
      "invalid_weekly_selection",
      "Permanent enrollment must be configured",
    );
  }
  if (enrollment.organizationId !== workspace.organization.id) {
    throw new BookingCommerceError(
      "entity_not_found",
      `Unknown organization ${enrollment.organizationId}`,
    );
  }
  const family = workspace.families.find(
    (candidate) => candidate.id === enrollment.familyId,
  );
  const child = workspace.children.find(
    (candidate) => candidate.id === enrollment.childId,
  );
  const group = workspace.groups.find(
    (candidate) => candidate.id === enrollment.groupId,
  );
  if (!family || !child || child.familyId !== family.id || !group) {
    throw new BookingCommerceError(
      "entity_not_found",
      "Enrollment family, child, or group is unavailable",
    );
  }
  if (group.status !== "active") {
    throw new BookingCommerceError(
      "inactive_group",
      `Group ${group.id} is archived`,
    );
  }
  if (!isExactBirthDateEligible(group, child.birthDate, enrollment.startDate)) {
    throw new BookingCommerceError(
      "age_mismatch",
      `Child ${child.id} does not fit group ${group.id}`,
    );
  }
  const tariff = requireTariff(workspace, enrollment.tariffId);
  if (tariff.status !== "active") {
    throw new BookingCommerceError(
      "archived_tariff",
      `Tariff ${tariff.id} is archived`,
    );
  }
  const selectionKeys = new Set<string>();
  for (const selection of enrollment.weeklyScheduleSelections) {
    const rule = workspace.recurrenceRules.find(
      (candidate) => candidate.id === selection.recurrenceRuleId,
    );
    const key = weeklySelectionKey(selection);
    if (
      selectionKeys.has(key) ||
      !rule ||
      rule.status !== "active" ||
      rule.groupId !== enrollment.groupId ||
      !rule.weekdays.includes(selection.weekday)
    ) {
      throw new BookingCommerceError(
        "invalid_weekly_selection",
        `Invalid weekly selection ${key}`,
      );
    }
    selectionKeys.add(key);
  }
  if (selectionKeys.size > tariff.weeklyScheduleLimit) {
    throw new BookingCommerceError(
      "schedule_limit_exceeded",
      `Tariff ${tariff.id} permits ${tariff.weeklyScheduleLimit} weekly slots`,
    );
  }
  const overlapping = workspace.enrollments.find(
    (candidate) =>
      candidate.id !== ignoredEnrollmentId &&
      candidate.status === "active" &&
      candidate.childId === enrollment.childId &&
      candidate.groupId === enrollment.groupId &&
      rangesOverlap(candidate, enrollment),
  );
  if (overlapping) {
    throw new BookingCommerceError(
      "overlapping_enrollment",
      `Enrollment overlaps ${overlapping.id}`,
    );
  }
  return { enrollment, tariff };
}

function validateFirstPayment(
  enrollment: ConfiguredBookingEnrollment,
  tariff: BookingTariff,
  input: PaymentExpectation,
): PaymentExpectation {
  const payment = paymentExpectationSchema.parse(input);
  if (
    payment.organizationId !== enrollment.organizationId ||
    payment.familyId !== enrollment.familyId ||
    payment.childId !== enrollment.childId ||
    payment.enrollmentId !== enrollment.id ||
    payment.tariffId !== tariff.id ||
    payment.tariffNameSnapshot !== tariff.name ||
    payment.amountMinor !== tariff.priceMinor ||
    payment.currency !== tariff.currency ||
    payment.dueDate !== enrollment.startDate ||
    payment.status !== "expected"
  ) {
    throw new BookingCommerceError(
      "invalid_payment_snapshot",
      `Payment ${payment.id} does not snapshot enrollment ${enrollment.id}`,
    );
  }
  return payment;
}

export function createTariff(
  workspace: BookingWorkspace,
  input: BookingTariff,
): BookingWorkspaceDraft {
  const tariff = tariffSchema.parse(input);
  if (tariff.organizationId !== workspace.organization.id) {
    throw new BookingCommerceError(
      "entity_not_found",
      `Unknown organization ${tariff.organizationId}`,
    );
  }
  if (workspace.tariffs.some((candidate) => candidate.id === tariff.id)) {
    throw new BookingCommerceError(
      "entity_already_exists",
      `Tariff ${tariff.id} already exists`,
    );
  }
  return checkedDraft(workspace, {
    ...workspaceDraft(workspace),
    tariffs: [...workspace.tariffs, tariff],
  });
}

export function updateTariff(
  workspace: BookingWorkspace,
  input: BookingTariff,
): BookingWorkspaceDraft {
  const tariff = tariffSchema.parse(input);
  const existing = requireTariff(workspace, tariff.id);
  if (
    tariff.organizationId !== workspace.organization.id ||
    tariff.organizationId !== existing.organizationId
  ) {
    throw new BookingCommerceError(
      "entity_not_found",
      `Unknown organization ${tariff.organizationId}`,
    );
  }
  return checkedDraft(workspace, {
    ...workspaceDraft(workspace),
    tariffs: workspace.tariffs.map((candidate) =>
      candidate.id === tariff.id ? tariff : candidate,
    ),
  });
}

export function setTariffStatus(
  workspace: BookingWorkspace,
  tariffId: string,
  status: BookingTariff["status"],
  updatedAt: string,
): BookingWorkspaceDraft {
  const tariff = requireTariff(workspace, tariffId);
  return updateTariff(workspace, { ...tariff, status, updatedAt });
}

export function createConfiguredEnrollmentWithPayment(
  workspace: BookingWorkspace,
  input: {
    enrollment: ConfiguredBookingEnrollment;
    payment: PaymentExpectation;
  },
): BookingWorkspaceDraft {
  if (
    workspace.enrollments.some(
      (candidate) => candidate.id === input.enrollment.id,
    ) ||
    workspace.paymentExpectations.some(
      (candidate) => candidate.id === input.payment.id,
    )
  ) {
    throw new BookingCommerceError(
      "entity_already_exists",
      "Enrollment or payment id already exists",
    );
  }
  const { enrollment, tariff } = validateConfiguredEnrollment(
    workspace,
    input.enrollment,
  );
  const payment = validateFirstPayment(enrollment, tariff, input.payment);
  return checkedDraft(workspace, {
    ...workspaceDraft(workspace),
    enrollments: [...workspace.enrollments, enrollment],
    paymentExpectations: [...workspace.paymentExpectations, payment],
  });
}

export function reconfigureEnrollment(
  workspace: BookingWorkspace,
  input: ConfiguredBookingEnrollment,
): BookingWorkspaceDraft {
  if (!workspace.enrollments.some((candidate) => candidate.id === input.id)) {
    throw new BookingCommerceError(
      "entity_not_found",
      `Unknown enrollment ${input.id}`,
    );
  }
  const { enrollment } = validateConfiguredEnrollment(
    workspace,
    input,
    input.id,
  );
  return checkedDraft(workspace, {
    ...workspaceDraft(workspace),
    enrollments: workspace.enrollments.map((candidate) =>
      candidate.id === enrollment.id ? enrollment : candidate,
    ),
  });
}

function requirePayment(
  workspace: BookingWorkspace,
  paymentId: string,
): PaymentExpectation {
  const payment = workspace.paymentExpectations.find(
    (candidate) => candidate.id === paymentId,
  );
  if (!payment) {
    throw new BookingCommerceError(
      "entity_not_found",
      `Unknown payment ${paymentId}`,
    );
  }
  return payment;
}

export function updateExpectedPaymentAmount(
  workspace: BookingWorkspace,
  paymentId: string,
  input: { amountMinor: number; updatedAt: string },
): BookingWorkspaceDraft {
  const payment = requirePayment(workspace, paymentId);
  if (payment.status !== "expected") {
    throw new BookingCommerceError(
      "invalid_payment_transition",
      "Only an expected payment amount can change",
    );
  }
  const updated = paymentExpectationSchema.parse({
    ...payment,
    amountMinor: input.amountMinor,
    updatedAt: input.updatedAt,
  });
  return checkedDraft(workspace, {
    ...workspaceDraft(workspace),
    paymentExpectations: workspace.paymentExpectations.map((candidate) =>
      candidate.id === paymentId ? updated : candidate,
    ),
  });
}

export function setPaymentStatus(
  workspace: BookingWorkspace,
  paymentId: string,
  input: {
    status: PaymentExpectation["status"];
    actorId: string;
    occurredAt: string;
    internalReason?: string;
  },
): BookingWorkspaceDraft {
  const payment = requirePayment(workspace, paymentId);
  const allowed =
    (payment.status === "expected" &&
      (input.status === "paid" || input.status === "cancelled")) ||
    ((payment.status === "paid" || payment.status === "cancelled") &&
      input.status === "expected");
  if (!allowed) {
    throw new BookingCommerceError(
      "invalid_payment_transition",
      `Invalid payment transition ${payment.status} -> ${input.status}`,
    );
  }
  if (
    (input.status === "cancelled" || input.status === "expected") &&
    !input.internalReason?.trim()
  ) {
    throw new BookingCommerceError(
      "invalid_payment_transition",
      "An internal reason is required",
    );
  }
  const updated = paymentExpectationSchema.parse(
    input.status === "paid"
      ? {
          ...payment,
          status: "paid",
          paidAt: input.occurredAt,
          paidBy: input.actorId,
          cancelledAt: undefined,
          cancelledBy: undefined,
          internalReason: undefined,
          updatedAt: input.occurredAt,
        }
      : input.status === "cancelled"
        ? {
            ...payment,
            status: "cancelled",
            paidAt: undefined,
            paidBy: undefined,
            cancelledAt: input.occurredAt,
            cancelledBy: input.actorId,
            internalReason: input.internalReason?.trim(),
            updatedAt: input.occurredAt,
          }
        : {
            ...payment,
            status: "expected",
            paidAt: undefined,
            paidBy: undefined,
            cancelledAt: undefined,
            cancelledBy: undefined,
            internalReason: undefined,
            updatedAt: input.occurredAt,
          },
  );
  return checkedDraft(workspace, {
    ...workspaceDraft(workspace),
    paymentExpectations: workspace.paymentExpectations.map((candidate) =>
      candidate.id === paymentId ? updated : candidate,
    ),
  });
}
