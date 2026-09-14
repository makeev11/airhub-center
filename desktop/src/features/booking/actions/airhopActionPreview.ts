import type {
  AirhopActionCommand,
  AirhopActionPreview,
} from "@/features/booking/actions/airhopActionSchemas";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import type {
  BookingApplicantSnapshot,
  BookingWorkspace,
} from "@/features/booking/model/bookingCore";
import type { AirHopLocale } from "@/shared/locale/airhopLocale";
import { localePair } from "@/shared/locale/messengerCopy";

function previewLocale(value: string): AirHopLocale {
  if (value.toLowerCase().startsWith("ru")) return "ru-RU";
  if (value.toLowerCase().startsWith("pt")) return "pt-BR";
  if (value.toLowerCase().startsWith("tr")) return "tr-TR";
  return "en-US";
}

export function previewAirhopAction(
  workspace: BookingWorkspace,
  command: AirhopActionCommand,
  client?: { applicant: BookingApplicantSnapshot },
): AirhopActionPreview {
  const locale = previewLocale(workspace.organization.locale);
  const t = <T>(russian: T, english: T) => localePair(russian, english, locale);
  const formatters = createBookingFormatters(workspace.organization.locale);
  const lines = client
    ? [
        `${t("Представитель", "Representative")}: ${client.applicant.parentName}`,
        `${t("Ребёнок", "Child")}: ${client.applicant.childName}`,
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
      `${t("Группа", "Group")}: ${group?.name ?? command.groupId}`,
      `${t("Тариф", "Tariff")}: ${tariff?.name ?? command.tariffId}`,
      `${t("Расписание", "Schedule")}: ${schedule}`,
      `${t("Начало", "Starts")}: ${command.startDate}`,
      `${t("Первая оплата", "First payment")}: ${
        tariff
          ? `${formatters.money(tariff.priceMinor, tariff.currency)}, ${formatters.date(command.startDate)}`
          : command.startDate
      }`,
    );
  } else if (command.type === "CreateTariff") {
    lines.push(
      `${t("Тариф", "Tariff")}: ${command.name}`,
      `${t("Стоимость", "Price")}: ${formatters.money(command.priceMinor, command.currency)}`,
      `${t("Занятий в неделю", "Classes per week")}: ${command.weeklyScheduleLimit}`,
    );
  } else if (command.type === "UpdateTariff") {
    lines.push(
      `${t("Тариф", "Tariff")}: ${command.name}`,
      `${t("Новая стоимость", "New price")}: ${formatters.money(command.priceMinor, command.currency)}`,
      `${t("Занятий в неделю", "Classes per week")}: ${command.weeklyScheduleLimit}`,
    );
  } else if (command.type === "SetTariffStatus") {
    const tariff = workspace.tariffs.find(({ id }) => id === command.tariffId);
    lines.push(
      `${t("Тариф", "Tariff")}: ${tariff?.name ?? command.tariffId}`,
      `${t("Статус", "Status")}: ${command.status}`,
    );
  } else if (command.type === "SetPaymentStatus") {
    const payment = workspace.paymentExpectations.find(
      ({ id }) => id === command.paymentId,
    );
    lines.push(
      `${t("Оплата", "Payment")}: ${
        payment
          ? formatters.money(payment.amountMinor, payment.currency)
          : command.paymentId
      }`,
      `${t("Статус", "Status")}: ${command.status}`,
    );
  } else if (command.type === "UpdatePaymentAmount") {
    const payment = workspace.paymentExpectations.find(
      ({ id }) => id === command.paymentId,
    );
    lines.push(
      `${t("Новая сумма", "New amount")}: ${formatters.money(
        command.amountMinor,
        payment?.currency ?? "RUB",
      )}`,
    );
  } else if (command.type === "UpdatePaymentDueDate") {
    lines.push(
      `${t("Новый срок", "New due date")}: ${formatters.date(command.dueDate)}`,
      `${t("Причина", "Reason")}: ${command.internalReason}`,
    );
  } else if (command.type === "CreateBookingRequest") {
    lines.push(
      `${t("Занятие", "Lesson")}: ${command.lessonRef.originalDate}`,
      `${t("Тип", "Type")}: ${command.visitKind}`,
      `${t("Статус", "Status")}: ${t("Новая заявка", "New request")}`,
    );
  } else if (command.type === "AddLessonParticipant") {
    const status =
      command.submissionMode === "direct"
        ? t("Подтверждено", "Confirmed")
        : t("Новая заявка", "New request");
    lines.push(
      `${t("Занятие", "Lesson")}: ${command.lessonRef.originalDate}`,
      `${t("Тип", "Type")}: ${command.visitKind}`,
      `${t("Статус", "Status")}: ${status}`,
    );
  } else if (command.type === "CreateUnassignedRequest") {
    lines.push(
      t("Время пока не выбрано", "Time has not been selected"),
      `${t("Статус", "Status")}: ${t("Новая", "New")}`,
    );
  } else {
    lines.push(
      `${t("Посещаемость", "Attendance")}: ${command.status ?? t("без отметки", "unmarked")}`,
    );
  }
  return {
    locale: workspace.organization.locale,
    title: t("Будет выполнено", "Will be applied"),
    lines,
  };
}
