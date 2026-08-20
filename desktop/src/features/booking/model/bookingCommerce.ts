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
  | "invalid_enrollment_transition"
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

function shiftIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function cancelledPayment(
  payment: PaymentExpectation,
  input: { actorId: string; occurredAt: string; internalReason: string },
): PaymentExpectation {
  return paymentExpectationSchema.parse({
    ...payment,
    status: "cancelled",
    paidAt: undefined,
    paidBy: undefined,
    cancelledAt: input.occurredAt,
    cancelledBy: input.actorId,
    internalReason: input.internalReason,
    updatedAt: input.occurredAt,
  });
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
  const payment = paymentExpectationSchema.parse({
    ...input,
    billingPeriod: input.billingPeriod ?? `${input.dueDate.slice(0, 7)}-01`,
  });
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

/**
 * Starts a new tariff segment without rewriting the previous enrollment or
 * any resolved payment snapshots. Future expected payments from the previous
 * segment are cancelled and replaced by the first payment for the new tariff.
 */
export function transitionEnrollmentTariff(
  workspace: BookingWorkspace,
  input: {
    enrollmentId: string;
    tariffId: string;
    weeklyScheduleSelections: WeeklyScheduleSelection[];
    effectiveDate: string;
    newEnrollmentId: string;
    newPaymentId: string;
    actorId: string;
    occurredAt: string;
  },
): BookingWorkspaceDraft {
  const existing = workspace.enrollments.find(
    (candidate) => candidate.id === input.enrollmentId,
  );
  if (!existing) {
    throw new BookingCommerceError(
      "entity_not_found",
      `Unknown enrollment ${input.enrollmentId}`,
    );
  }
  if (
    existing.assignmentState !== "configured" ||
    existing.status !== "active" ||
    input.effectiveDate <= existing.startDate ||
    (existing.endDate !== undefined && input.effectiveDate > existing.endDate)
  ) {
    throw new BookingCommerceError(
      "invalid_enrollment_transition",
      "Tariff transition must start inside an active configured enrollment",
    );
  }
  if (
    workspace.enrollments.some(
      (candidate) => candidate.id === input.newEnrollmentId,
    ) ||
    workspace.paymentExpectations.some(
      (candidate) => candidate.id === input.newPaymentId,
    )
  ) {
    throw new BookingCommerceError(
      "entity_already_exists",
      "Enrollment or payment id already exists",
    );
  }

  const tariff = requireTariff(workspace, input.tariffId);
  const previousEndDate = shiftIsoDate(input.effectiveDate, -1);
  const previousEnrollment = enrollmentSchema.parse({
    ...existing,
    endDate: previousEndDate,
    updatedAt: input.occurredAt,
  });
  const nextEnrollment = enrollmentSchema.parse({
    ...existing,
    id: input.newEnrollmentId,
    startDate: input.effectiveDate,
    ...(existing.endDate ? { endDate: existing.endDate } : {}),
    tariffId: input.tariffId,
    weeklyScheduleSelections: input.weeklyScheduleSelections,
    createdBy: input.actorId,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  });
  if (nextEnrollment.assignmentState !== "configured") {
    throw new BookingCommerceError(
      "invalid_enrollment_transition",
      "New tariff segment must be configured",
    );
  }

  const shortenedWorkspace = parseBookingWorkspace({
    ...workspace,
    enrollments: workspace.enrollments.map((candidate) =>
      candidate.id === previousEnrollment.id ? previousEnrollment : candidate,
    ),
  });
  const created = createConfiguredEnrollmentWithPayment(shortenedWorkspace, {
    enrollment: nextEnrollment,
    payment: {
      id: input.newPaymentId,
      organizationId: existing.organizationId,
      familyId: existing.familyId,
      childId: existing.childId,
      enrollmentId: nextEnrollment.id,
      tariffId: tariff.id,
      tariffNameSnapshot: tariff.name,
      amountMinor: tariff.priceMinor,
      currency: tariff.currency,
      dueDate: input.effectiveDate,
      status: "expected",
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  });
  const reason = `Tariff changed from ${existing.tariffId} to ${tariff.id}`;
  return checkedDraft(workspace, {
    ...created,
    paymentExpectations: created.paymentExpectations.map((payment) =>
      payment.enrollmentId === existing.id &&
      payment.status === "expected" &&
      payment.dueDate >= input.effectiveDate
        ? cancelledPayment(payment, {
            actorId: input.actorId,
            occurredAt: input.occurredAt,
            internalReason: reason,
          })
        : payment,
    ),
  });
}

/** Ends an enrollment after the selected date while preserving its history. */
export function endEnrollment(
  workspace: BookingWorkspace,
  enrollmentId: string,
  input: {
    endDate: string;
    cancelExpectedPayments: boolean;
    actorId: string;
    occurredAt: string;
  },
): BookingWorkspaceDraft {
  const existing = workspace.enrollments.find(
    (candidate) => candidate.id === enrollmentId,
  );
  if (!existing) {
    throw new BookingCommerceError(
      "entity_not_found",
      `Unknown enrollment ${enrollmentId}`,
    );
  }
  if (
    existing.status !== "active" ||
    input.endDate < existing.startDate ||
    (existing.endDate !== undefined && input.endDate > existing.endDate)
  ) {
    throw new BookingCommerceError(
      "invalid_enrollment_transition",
      "Enrollment cannot end on the selected date",
    );
  }
  const ended = enrollmentSchema.parse({
    ...existing,
    endDate: input.endDate,
    updatedAt: input.occurredAt,
  });
  return checkedDraft(workspace, {
    ...workspaceDraft(workspace),
    enrollments: workspace.enrollments.map((candidate) =>
      candidate.id === enrollmentId ? ended : candidate,
    ),
    paymentExpectations: workspace.paymentExpectations.map((payment) =>
      input.cancelExpectedPayments &&
      payment.enrollmentId === enrollmentId &&
      payment.status === "expected"
        ? cancelledPayment(payment, {
            actorId: input.actorId,
            occurredAt: input.occurredAt,
            internalReason: "Enrollment ended by staff",
          })
        : payment,
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

export function updateExpectedPaymentDueDate(
  workspace: BookingWorkspace,
  paymentId: string,
  input: { dueDate: string; updatedAt: string },
): BookingWorkspaceDraft {
  const payment = requirePayment(workspace, paymentId);
  if (payment.status !== "expected" || payment.dueDate === input.dueDate) {
    throw new BookingCommerceError(
      "invalid_payment_transition",
      "Only an expected payment can move to a different due date",
    );
  }
  const duplicate = workspace.paymentExpectations.some(
    (candidate) =>
      candidate.id !== paymentId &&
      candidate.enrollmentId === payment.enrollmentId &&
      candidate.dueDate === input.dueDate,
  );
  if (duplicate) {
    throw new BookingCommerceError(
      "invalid_payment_transition",
      "The enrollment already has a payment on this due date",
    );
  }
  const updated = paymentExpectationSchema.parse({
    ...payment,
    billingPeriod: payment.billingPeriod ?? `${payment.dueDate.slice(0, 7)}-01`,
    dueDate: input.dueDate,
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
