import type {
  BookingChild,
  BookingEnrollment,
  BookingFamily,
  BookingGroup,
  BookingTariff,
  BookingWorkspace,
  PaymentExpectation,
  RecurrenceRule,
} from "@/features/booking/model/bookingCore";
import { isEnrollmentActiveOn } from "@/features/booking/model/bookingOperations";

export type PaymentDisplayState =
  | "overdue"
  | "expected"
  | "paid"
  | "cancelled";

export type PaymentQueueRow = {
  payment: PaymentExpectation;
  displayState: PaymentDisplayState;
  family: BookingFamily;
  child: BookingChild;
  enrollment: BookingEnrollment;
  tariff: BookingTariff;
  group: BookingGroup;
};

export type FamilyEnrollmentRow = {
  enrollment: BookingEnrollment;
  child: BookingChild;
  group: BookingGroup;
  tariff?: BookingTariff;
  selectedRules: RecurrenceRule[];
  payments: Array<
    PaymentQueueRow & {
      payment: PaymentExpectation;
    }
  >;
  openPayment?: PaymentQueueRow;
};

export function paymentDisplayState(
  payment: PaymentExpectation,
  currentDate: string,
): PaymentDisplayState {
  if (payment.status === "paid") return "paid";
  if (payment.status === "cancelled") return "cancelled";
  return payment.dueDate < currentDate ? "overdue" : "expected";
}

const paymentStateOrder: Record<PaymentDisplayState, number> = {
  overdue: 0,
  expected: 1,
  paid: 2,
  cancelled: 3,
};

export function paymentQueueRows(
  workspace: BookingWorkspace,
  currentDate: string,
): PaymentQueueRow[] {
  const familyById = new Map(
    workspace.families.map((family) => [family.id, family]),
  );
  const childById = new Map(
    workspace.children.map((child) => [child.id, child]),
  );
  const enrollmentById = new Map(
    workspace.enrollments.map((enrollment) => [enrollment.id, enrollment]),
  );
  const tariffById = new Map(
    workspace.tariffs.map((tariff) => [tariff.id, tariff]),
  );
  const groupById = new Map(
    workspace.groups.map((group) => [group.id, group]),
  );
  return workspace.paymentExpectations
    .flatMap((payment): PaymentQueueRow[] => {
      const family = familyById.get(payment.familyId);
      const child = childById.get(payment.childId);
      const enrollment = enrollmentById.get(payment.enrollmentId);
      const tariff = tariffById.get(payment.tariffId);
      const group = enrollment ? groupById.get(enrollment.groupId) : undefined;
      if (!family || !child || !enrollment || !tariff || !group) return [];
      return [
        {
          payment,
          displayState: paymentDisplayState(payment, currentDate),
          family,
          child,
          enrollment,
          tariff,
          group,
        },
      ];
    })
    .sort((left, right) => {
      const state =
        paymentStateOrder[left.displayState] -
        paymentStateOrder[right.displayState];
      if (state !== 0) return state;
      const dueDate = left.payment.dueDate.localeCompare(right.payment.dueDate);
      if (dueDate !== 0) return dueDate;
      return left.child.displayName.localeCompare(
        right.child.displayName,
        workspace.organization.locale,
      );
    });
}

export function familyEnrollmentRows(
  workspace: BookingWorkspace,
  familyId: string,
  currentDate: string,
): FamilyEnrollmentRow[] {
  const childById = new Map(
    workspace.children.map((child) => [child.id, child]),
  );
  const groupById = new Map(
    workspace.groups.map((group) => [group.id, group]),
  );
  const tariffById = new Map(
    workspace.tariffs.map((tariff) => [tariff.id, tariff]),
  );
  const ruleById = new Map(
    workspace.recurrenceRules.map((rule) => [rule.id, rule]),
  );
  const paymentRows = paymentQueueRows(workspace, currentDate);
  return workspace.enrollments
    .filter((enrollment) => enrollment.familyId === familyId)
    .flatMap((enrollment): FamilyEnrollmentRow[] => {
      const child = childById.get(enrollment.childId);
      const group = groupById.get(enrollment.groupId);
      if (!child || !group) return [];
      const payments = paymentRows.filter(
        (row) => row.enrollment.id === enrollment.id,
      );
      const openPayment = payments.find(
        (row) =>
          row.displayState === "overdue" || row.displayState === "expected",
      );
      const tariff =
        enrollment.assignmentState === "configured"
          ? tariffById.get(enrollment.tariffId)
          : undefined;
      const selectedRules =
        enrollment.assignmentState === "configured"
          ? enrollment.weeklyScheduleSelections
              .map((selection) => ruleById.get(selection.recurrenceRuleId))
              .filter((rule): rule is RecurrenceRule => Boolean(rule))
          : [];
      return [
        {
          enrollment,
          child,
          group,
          ...(tariff ? { tariff } : {}),
          selectedRules,
          payments,
          ...(openPayment ? { openPayment } : {}),
        },
      ];
    })
    .sort((left, right) => {
      if (left.enrollment.status !== right.enrollment.status) {
        return left.enrollment.status === "active" ? -1 : 1;
      }
      return left.group.name.localeCompare(
        right.group.name,
        workspace.organization.locale,
      );
    });
}

export function groupActiveEnrollmentCount(
  workspace: BookingWorkspace,
  groupId: string,
  onDate: string,
): number {
  return workspace.enrollments.filter(
    (enrollment) =>
      enrollment.groupId === groupId &&
      isEnrollmentActiveOn(enrollment, onDate),
  ).length;
}
