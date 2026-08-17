import type {
  AirhopActionCommand,
  AirhopActionPreview,
} from "@/features/booking/actions/airhopActionSchemas";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import type {
  BookingApplicantSnapshot,
  BookingWorkspace,
} from "@/features/booking/model/bookingCore";

export function previewAirhopAction(
  workspace: BookingWorkspace,
  command: AirhopActionCommand,
  client?: { applicant: BookingApplicantSnapshot },
): AirhopActionPreview {
  const russian = workspace.organization.locale.toLowerCase().startsWith("ru");
  const formatters = createBookingFormatters(workspace.organization.locale);
  const lines = client
    ? [
        `${russian ? "Представитель" : "Representative"}: ${client.applicant.parentName}`,
        `${russian ? "Ребёнок" : "Child"}: ${client.applicant.childName}`,
      ]
    : [];
  if (command.type === "CreateExistingStudent") {
    const group = workspace.groups.find(({ id }) => id === command.groupId);
    const tariff = workspace.tariffs.find(({ id }) => id === command.tariffId);
    const schedule = command.weeklyScheduleSelections
      .map((selection) => {
        const rule = workspace.recurrenceRules.find(
          ({ id }) => id === selection.recurrenceRuleId,
        );
        return `${formatters.weekdayName(selection.weekday)}${
          rule ? `, ${rule.startTime}–${rule.endTime}` : ""
        }`;
      })
      .join("; ");
    lines.push(
      `${russian ? "Группа" : "Group"}: ${group?.name ?? command.groupId}`,
      `${russian ? "Тариф" : "Tariff"}: ${tariff?.name ?? command.tariffId}`,
      `${russian ? "Расписание" : "Schedule"}: ${schedule}`,
      `${russian ? "Начало" : "Starts"}: ${command.startDate}`,
      `${russian ? "Первая оплата" : "First payment"}: ${
        tariff
          ? `${formatters.money(tariff.priceMinor, tariff.currency)}, ${formatters.date(command.startDate)}`
          : command.startDate
      }`,
    );
  } else if (command.type === "CreateTariff") {
    lines.push(
      `${russian ? "Тариф" : "Tariff"}: ${command.name}`,
      `${russian ? "Стоимость" : "Price"}: ${formatters.money(command.priceMinor, command.currency)}`,
      `${russian ? "Дней в неделю" : "Days per week"}: ${command.weeklyScheduleLimit}`,
    );
  } else if (command.type === "UpdateTariff") {
    lines.push(
      `${russian ? "Тариф" : "Tariff"}: ${command.name}`,
      `${russian ? "Новая стоимость" : "New price"}: ${formatters.money(command.priceMinor, command.currency)}`,
      `${russian ? "Дней в неделю" : "Days per week"}: ${command.weeklyScheduleLimit}`,
    );
  } else if (command.type === "SetTariffStatus") {
    const tariff = workspace.tariffs.find(({ id }) => id === command.tariffId);
    lines.push(
      `${russian ? "Тариф" : "Tariff"}: ${tariff?.name ?? command.tariffId}`,
      `${russian ? "Статус" : "Status"}: ${command.status}`,
    );
  } else if (command.type === "SetPaymentStatus") {
    const payment = workspace.paymentExpectations.find(
      ({ id }) => id === command.paymentId,
    );
    lines.push(
      `${russian ? "Оплата" : "Payment"}: ${
        payment
          ? formatters.money(payment.amountMinor, payment.currency)
          : command.paymentId
      }`,
      `${russian ? "Статус" : "Status"}: ${command.status}`,
    );
  } else if (command.type === "UpdatePaymentAmount") {
    const payment = workspace.paymentExpectations.find(
      ({ id }) => id === command.paymentId,
    );
    lines.push(
      `${russian ? "Новая сумма" : "New amount"}: ${formatters.money(
        command.amountMinor,
        payment?.currency ?? "RUB",
      )}`,
    );
  } else if (command.type === "UpdatePaymentDueDate") {
    lines.push(
      `${russian ? "Новый срок" : "New due date"}: ${formatters.date(command.dueDate)}`,
      `${russian ? "Причина" : "Reason"}: ${command.internalReason}`,
    );
  } else if (command.type === "CreateBookingRequest") {
    lines.push(
      `${russian ? "Занятие" : "Lesson"}: ${command.lessonRef.originalDate}`,
      `${russian ? "Тип" : "Type"}: ${command.visitKind}`,
      `${russian ? "Статус" : "Status"}: ${russian ? "Новая заявка" : "New request"}`,
    );
  } else if (command.type === "AddLessonParticipant") {
    const status =
      command.submissionMode === "direct"
        ? russian
          ? "Подтверждено"
          : "Confirmed"
        : russian
          ? "Новая заявка"
          : "New request";
    lines.push(
      `${russian ? "Занятие" : "Lesson"}: ${command.lessonRef.originalDate}`,
      `${russian ? "Тип" : "Type"}: ${command.visitKind}`,
      `${russian ? "Статус" : "Status"}: ${status}`,
    );
  } else if (command.type === "CreateUnassignedRequest") {
    lines.push(
      russian ? "Время пока не выбрано" : "Time has not been selected",
      `${russian ? "Статус" : "Status"}: ${russian ? "Новая" : "New"}`,
    );
  } else {
    lines.push(
      `${russian ? "Посещаемость" : "Attendance"}: ${command.status ?? (russian ? "без отметки" : "unmarked")}`,
    );
  }
  return {
    locale: workspace.organization.locale,
    title: russian ? "Будет выполнено" : "Will be applied",
    lines,
  };
}
