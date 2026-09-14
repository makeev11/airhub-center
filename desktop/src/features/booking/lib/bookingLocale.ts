import { loadActivationLocale } from "@/features/activation/i18n";
import { currencyMinorUnitExponent } from "@/features/booking/lib/bookingMoney";
import type { Weekday } from "@/features/booking/model/bookingCore";

export type BookingMessages = {
  scheduleTitle: string;
  today: string;
  previousWeek: string;
  nextWeek: string;
  branch: string;
  archivedBranch: string;
  allBranches: string;
  noLessons: string;
  moved: string;
  modified: string;
  cancelled: string;
  dateAndTime: string;
  room: string;
  teachers: string;
  places: string;
  trialLesson: string;
  unlimited: string;
  unlimitedCapacity: string;
  noPlaces: string;
  onePlaceLeft: string;
  placesFree: (count: number) => string;
  occupiedPlaces: (booked: number, capacity: number) => string;
  trialUnavailable: string;
  trialFree: string;
  trialPaid: (price: string) => string;
  teacherUnassigned: string;
  roomFallback: string;
  addressMissing: string;
  unnamedGroup: string;
  movedFrom: (date: string, startTime: string, endTime: string) => string;
  editLesson: string;
  cancelLesson: string;
  restoreLesson: string;
  editLessonTitle: string;
  editLessonDescription: string;
  lessonDate: string;
  lessonStartTime: string;
  lessonEndTime: string;
  lessonCapacity: string;
  lessonCapacityInherit: string;
  lessonCapacityUnlimited: string;
  lessonCapacityLimited: string;
  lessonCapacityLimit: string;
  lessonTrialPolicy: string;
  lessonTrialInherit: string;
  lessonInheritedValue: (value: string) => string;
  lessonCapacityValue: (count: number) => string;
  lessonPreviewTitle: string;
  lessonOneOccurrenceOnly: string;
  lessonNoChanges: string;
  lessonChangeDate: (from: string, to: string) => string;
  lessonChangeTime: (from: string, to: string) => string;
  lessonChangeBranch: (from: string, to: string) => string;
  lessonChangeRoom: (from: string, to: string) => string;
  lessonChangeTeachers: (from: string, to: string) => string;
  lessonChangeCapacity: (from: string, to: string) => string;
  lessonChangeTrial: (from: string, to: string) => string;
  lessonConflictTitle: string;
  lessonConflictDescription: string;
  lessonConflictConfirmation: string;
  cancelLessonTitle: string;
  cancelLessonDescription: (date: string, time: string) => string;
  restoreLessonTitle: string;
  restoreLessonDescription: string;
  lessonUpdated: string;
  lessonCancelled: string;
  lessonRestored: string;
  openLesson: (groupName: string, startTime: string) => string;
  scheduleUnavailableTitle: string;
  scheduleUnavailableDescription: string;
  scheduleLoadingTitle: string;
  scheduleLoadingDescription: string;
  scheduleLoadErrorTitle: string;
  scheduleLoadErrorDescription: string;
  scheduleRetry: string;
};

const ruMessages: BookingMessages = {
  scheduleTitle: "Расписание",
  today: "Сегодня",
  previousWeek: "Предыдущая неделя",
  nextWeek: "Следующая неделя",
  branch: "Филиал",
  archivedBranch: "Филиал в архиве",
  allBranches: "Все филиалы",
  noLessons: "Нет занятий",
  moved: "Перенесено",
  modified: "Изменено",
  cancelled: "Отменено",
  dateAndTime: "Дата и время",
  room: "Кабинет",
  teachers: "Преподаватели",
  places: "Места",
  trialLesson: "Пробное занятие",
  unlimited: "Без ограничений",
  unlimitedCapacity: "Без ограничения",
  noPlaces: "Мест нет",
  onePlaceLeft: "Осталось 1 место",
  placesFree: (count) => `${count} мест свободно`,
  occupiedPlaces: (booked, capacity) => `${booked} из ${capacity} занято`,
  trialUnavailable: "Пробное недоступно",
  trialFree: "Пробное: бесплатно",
  trialPaid: (price) => `Пробное: ${price}`,
  teacherUnassigned: "Преподаватель не назначен",
  roomFallback: "Не указан — показываем адрес филиала",
  addressMissing: "Адрес не указан",
  unnamedGroup: "Группа без названия",
  movedFrom: (date, startTime, endTime) =>
    `Перенесено с ${date}, ${startTime}–${endTime}`,
  editLesson: "Изменить занятие",
  cancelLesson: "Отменить занятие",
  restoreLesson: "Вернуть значения серии",
  editLessonTitle: "Изменение одного занятия",
  editLessonDescription:
    "Дата, время, место, преподаватели, вместимость и пробное изменятся только у выбранного занятия.",
  lessonDate: "Дата занятия",
  lessonStartTime: "Время начала",
  lessonEndTime: "Время окончания",
  lessonCapacity: "Вместимость занятия",
  lessonCapacityInherit: "Наследовать от серии",
  lessonCapacityUnlimited: "Без ограничения",
  lessonCapacityLimited: "Указать лимит",
  lessonCapacityLimit: "Лимит мест",
  lessonTrialPolicy: "Пробное для занятия",
  lessonTrialInherit: "Наследовать",
  lessonInheritedValue: (value) => `Наследовать от серии (${value})`,
  lessonCapacityValue: (count) => `${count} мест`,
  lessonPreviewTitle: "Что изменится",
  lessonOneOccurrenceOnly: "Изменения затронут только это занятие.",
  lessonNoChanges:
    "Измените хотя бы одно значение или верните занятие к серии.",
  lessonChangeDate: (from, to) => `Дата: ${from} → ${to}`,
  lessonChangeTime: (from, to) => `Время: ${from} → ${to}`,
  lessonChangeBranch: (from, to) => `Филиал: ${from} → ${to}`,
  lessonChangeRoom: (from, to) => `Кабинет: ${from} → ${to}`,
  lessonChangeTeachers: (from, to) => `Преподаватели: ${from} → ${to}`,
  lessonChangeCapacity: (from, to) => `Вместимость: ${from} → ${to}`,
  lessonChangeTrial: (from, to) => `Пробное: ${from} → ${to}`,
  lessonConflictTitle: "Есть конфликты занятия",
  lessonConflictDescription:
    "Сохранение допустимо, но проверьте пересечения итоговой даты и времени.",
  lessonConflictConfirmation:
    "Я проверил конфликты и хочу изменить одно занятие",
  cancelLessonTitle: "Отменить это занятие?",
  cancelLessonDescription: (date, time) =>
    `${date}, ${time}. Остальные занятия серии не изменятся.`,
  restoreLessonTitle: "Вернуть занятие к серии?",
  restoreLessonDescription:
    "Исключение будет удалено, а занятие снова получит дату, время, место, преподавателей, вместимость и пробное из серии.",
  lessonUpdated: "Одно занятие изменено",
  lessonCancelled: "Одно занятие отменено",
  lessonRestored: "Занятие возвращено к серии",
  openLesson: (groupName, startTime) =>
    `Открыть занятие ${groupName}, ${startTime}`,
  scheduleUnavailableTitle: "Расписание ещё не подключено",
  scheduleUnavailableDescription:
    "Подключите Booking API организации, чтобы здесь появились реальные филиалы, группы и занятия.",
  scheduleLoadingTitle: "Загружаем расписание",
  scheduleLoadingDescription: "Получаем актуальные занятия с сервера центра.",
  scheduleLoadErrorTitle: "Не удалось загрузить расписание",
  scheduleLoadErrorDescription:
    "Проверьте соединение с сервером центра и повторите попытку.",
  scheduleRetry: "Попробовать снова",
};

const enMessages: BookingMessages = {
  scheduleTitle: "Schedule",
  today: "Today",
  previousWeek: "Previous week",
  nextWeek: "Next week",
  branch: "Branch",
  archivedBranch: "Archived branch",
  allBranches: "All branches",
  noLessons: "No classes",
  moved: "Moved",
  modified: "Changed",
  cancelled: "Cancelled",
  dateAndTime: "Date and time",
  room: "Room",
  teachers: "Teachers",
  places: "Places",
  trialLesson: "Trial class",
  unlimited: "No limit",
  unlimitedCapacity: "Unlimited",
  noPlaces: "No places",
  onePlaceLeft: "1 place left",
  placesFree: (count) => `${count} places free`,
  occupiedPlaces: (booked, capacity) => `${booked} of ${capacity} occupied`,
  trialUnavailable: "Trial unavailable",
  trialFree: "Trial: free",
  trialPaid: (price) => `Trial: ${price}`,
  teacherUnassigned: "No teacher assigned",
  roomFallback: "Not specified — showing the branch address",
  addressMissing: "Address not specified",
  unnamedGroup: "Unnamed group",
  movedFrom: (date, startTime, endTime) =>
    `Moved from ${date}, ${startTime}–${endTime}`,
  editLesson: "Edit class",
  cancelLesson: "Cancel class",
  restoreLesson: "Restore series values",
  editLessonTitle: "Edit one class",
  editLessonDescription:
    "Date, time, place, teachers, capacity, and trial settings change only for the selected class.",
  lessonDate: "Class date",
  lessonStartTime: "Start time",
  lessonEndTime: "End time",
  lessonCapacity: "Class capacity",
  lessonCapacityInherit: "Inherit from series",
  lessonCapacityUnlimited: "Unlimited",
  lessonCapacityLimited: "Set a limit",
  lessonCapacityLimit: "Place limit",
  lessonTrialPolicy: "Trial for this class",
  lessonTrialInherit: "Inherit",
  lessonInheritedValue: (value) => `Inherit from series (${value})`,
  lessonCapacityValue: (count) => `${count} places`,
  lessonPreviewTitle: "What will change",
  lessonOneOccurrenceOnly: "Changes apply only to this class.",
  lessonNoChanges: "Change at least one value or restore the series values.",
  lessonChangeDate: (from, to) => `Date: ${from} → ${to}`,
  lessonChangeTime: (from, to) => `Time: ${from} → ${to}`,
  lessonChangeBranch: (from, to) => `Branch: ${from} → ${to}`,
  lessonChangeRoom: (from, to) => `Room: ${from} → ${to}`,
  lessonChangeTeachers: (from, to) => `Teachers: ${from} → ${to}`,
  lessonChangeCapacity: (from, to) => `Capacity: ${from} → ${to}`,
  lessonChangeTrial: (from, to) => `Trial: ${from} → ${to}`,
  lessonConflictTitle: "Class conflicts found",
  lessonConflictDescription:
    "You can still save, but review conflicts for the resulting date and time.",
  lessonConflictConfirmation:
    "I reviewed the conflicts and want to change this class",
  cancelLessonTitle: "Cancel this class?",
  cancelLessonDescription: (date, time) =>
    `${date}, ${time}. Other classes in the series are unchanged.`,
  restoreLessonTitle: "Restore series values?",
  restoreLessonDescription:
    "The exception will be removed. The class will again use the series date, time, place, teachers, capacity, and trial settings.",
  lessonUpdated: "Class updated",
  lessonCancelled: "Class cancelled",
  lessonRestored: "Series values restored",
  openLesson: (groupName, startTime) =>
    `Open ${groupName} class at ${startTime}`,
  scheduleUnavailableTitle: "Schedule not connected yet",
  scheduleUnavailableDescription:
    "Connect the organization's Booking API to show live branches, groups, and classes here.",
  scheduleLoadingTitle: "Loading schedule",
  scheduleLoadingDescription: "Getting the latest classes from the Center.",
  scheduleLoadErrorTitle: "Could not load the schedule",
  scheduleLoadErrorDescription:
    "Check the connection to the Center server and try again.",
  scheduleRetry: "Try again",
};

const ptBrMessages: BookingMessages = {
  scheduleTitle: "Agenda",
  today: "Hoje",
  previousWeek: "Semana anterior",
  nextWeek: "Próxima semana",
  branch: "Unidade",
  archivedBranch: "Unidade arquivada",
  allBranches: "Todas as unidades",
  noLessons: "Nenhuma aula",
  moved: "Reagendada",
  modified: "Alterada",
  cancelled: "Cancelada",
  dateAndTime: "Data e horário",
  room: "Sala",
  teachers: "Professores",
  places: "Vagas",
  trialLesson: "Aula experimental",
  unlimited: "Sem limite",
  unlimitedCapacity: "Ilimitada",
  noPlaces: "Sem vagas",
  onePlaceLeft: "1 vaga restante",
  placesFree: (count) => `${count} vagas disponíveis`,
  occupiedPlaces: (booked, capacity) => `${booked} de ${capacity} ocupadas`,
  trialUnavailable: "Aula experimental indisponível",
  trialFree: "Experimental: grátis",
  trialPaid: (price) => `Experimental: ${price}`,
  teacherUnassigned: "Nenhum professor atribuído",
  roomFallback: "Não informada — exibindo o endereço da unidade",
  addressMissing: "Endereço não informado",
  unnamedGroup: "Grupo sem nome",
  movedFrom: (date, startTime, endTime) =>
    `Reagendada de ${date}, ${startTime}–${endTime}`,
  editLesson: "Editar aula",
  cancelLesson: "Cancelar aula",
  restoreLesson: "Restaurar valores da série",
  editLessonTitle: "Editar uma aula",
  editLessonDescription:
    "Data, horário, local, professores, capacidade e regras da aula experimental serão alterados somente para a aula selecionada.",
  lessonDate: "Data da aula",
  lessonStartTime: "Horário de início",
  lessonEndTime: "Horário de término",
  lessonCapacity: "Capacidade da aula",
  lessonCapacityInherit: "Herdar da série",
  lessonCapacityUnlimited: "Ilimitada",
  lessonCapacityLimited: "Definir limite",
  lessonCapacityLimit: "Limite de vagas",
  lessonTrialPolicy: "Experimental nesta aula",
  lessonTrialInherit: "Herdar",
  lessonInheritedValue: (value) => `Herdar da série (${value})`,
  lessonCapacityValue: (count) => `${count} vagas`,
  lessonPreviewTitle: "O que será alterado",
  lessonOneOccurrenceOnly: "As alterações se aplicam somente a esta aula.",
  lessonNoChanges:
    "Altere pelo menos um valor ou restaure os valores da série.",
  lessonChangeDate: (from, to) => `Data: ${from} → ${to}`,
  lessonChangeTime: (from, to) => `Horário: ${from} → ${to}`,
  lessonChangeBranch: (from, to) => `Unidade: ${from} → ${to}`,
  lessonChangeRoom: (from, to) => `Sala: ${from} → ${to}`,
  lessonChangeTeachers: (from, to) => `Professores: ${from} → ${to}`,
  lessonChangeCapacity: (from, to) => `Capacidade: ${from} → ${to}`,
  lessonChangeTrial: (from, to) => `Experimental: ${from} → ${to}`,
  lessonConflictTitle: "Foram encontrados conflitos de aula",
  lessonConflictDescription:
    "Ainda é possível salvar, mas revise os conflitos da data e do horário resultantes.",
  lessonConflictConfirmation: "Revisei os conflitos e quero alterar esta aula",
  cancelLessonTitle: "Cancelar esta aula?",
  cancelLessonDescription: (date, time) =>
    `${date}, ${time}. As outras aulas da série não serão alteradas.`,
  restoreLessonTitle: "Restaurar os valores da série?",
  restoreLessonDescription:
    "A exceção será removida. A aula voltará a usar data, horário, local, professores, capacidade e regras da série.",
  lessonUpdated: "Aula atualizada",
  lessonCancelled: "Aula cancelada",
  lessonRestored: "Valores da série restaurados",
  openLesson: (groupName, startTime) =>
    `Abrir aula de ${groupName} às ${startTime}`,
  scheduleUnavailableTitle: "A agenda ainda não está conectada",
  scheduleUnavailableDescription:
    "Conecte a API de agendamento da organização para exibir aqui unidades, grupos e aulas em tempo real.",
  scheduleLoadingTitle: "Carregando agenda",
  scheduleLoadingDescription: "Buscando as aulas mais recentes do Center.",
  scheduleLoadErrorTitle: "Não foi possível carregar a agenda",
  scheduleLoadErrorDescription:
    "Verifique a conexão com o servidor do Center e tente novamente.",
  scheduleRetry: "Tentar novamente",
};

const messagesByLanguage: Partial<Record<string, BookingMessages>> = {
  en: enMessages,
  pt: ptBrMessages,
  ru: ruMessages,
};

function canonicalLocale(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? "ru-RU";
  } catch {
    return "ru-RU";
  }
}

export function getBookingMessages(locale: string): BookingMessages {
  const resolvedLocale = canonicalLocale(loadActivationLocale() ?? locale);
  const language = new Intl.Locale(resolvedLocale).language;
  return messagesByLanguage[language] ?? enMessages;
}

function asCalendarDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export type BookingFormatters = {
  date: (isoDate: string) => string;
  weekday: (isoDate: string) => string;
  weekdayName: (weekday: Weekday) => string;
  weekdayDate: (isoDate: string) => string;
  shortDate: (isoDate: string) => string;
  money: (amountMinor: number, currency: string) => string;
};

export function createBookingFormatters(locale: string): BookingFormatters {
  const resolvedLocale = canonicalLocale(loadActivationLocale() ?? locale);
  const dateFormatter = new Intl.DateTimeFormat(resolvedLocale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const weekdayFormatter = new Intl.DateTimeFormat(resolvedLocale, {
    weekday: "short",
    timeZone: "UTC",
  });
  const weekdayDateFormatter = new Intl.DateTimeFormat(resolvedLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const shortDateFormatter = new Intl.DateTimeFormat(resolvedLocale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const weekdayNameFormatter = new Intl.DateTimeFormat(resolvedLocale, {
    weekday: "long",
    timeZone: "UTC",
  });
  const weekdayDates: Record<Weekday, string> = {
    monday: "2026-08-03",
    tuesday: "2026-08-04",
    wednesday: "2026-08-05",
    thursday: "2026-08-06",
    friday: "2026-08-07",
    saturday: "2026-08-08",
    sunday: "2026-08-09",
  };
  const capitalize = (value: string) =>
    value
      ? `${value[0].toLocaleUpperCase(resolvedLocale)}${value.slice(1)}`
      : value;

  return {
    date: (isoDate) => dateFormatter.format(asCalendarDate(isoDate)),
    weekday: (isoDate) => weekdayFormatter.format(asCalendarDate(isoDate)),
    weekdayName: (weekday) =>
      capitalize(
        weekdayNameFormatter.format(asCalendarDate(weekdayDates[weekday])),
      ),
    weekdayDate: (isoDate) => {
      const value = weekdayDateFormatter.format(asCalendarDate(isoDate));
      return capitalize(value);
    },
    shortDate: (isoDate) => shortDateFormatter.format(asCalendarDate(isoDate)),
    money: (amountMinor, currency) => {
      const fractionDigits = currencyMinorUnitExponent(currency);
      if (fractionDigits === null) throw new RangeError("Unknown currency");
      const formatter = new Intl.NumberFormat(resolvedLocale, {
        style: "currency",
        currency,
        currencyDisplay:
          currency.toUpperCase() === "RUB" ? "narrowSymbol" : "symbol",
      });
      return formatter.format(amountMinor / 10 ** fractionDigits);
    },
  };
}

function russianPlural(
  value: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = value % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function russianAgeDuration(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years) {
    parts.push(`${years} ${russianPlural(years, "год", "года", "лет")}`);
  }
  if (months || !parts.length) {
    parts.push(
      `${months} ${russianPlural(months, "месяц", "месяца", "месяцев")}`,
    );
  }
  return parts.join(" ");
}

function englishAgeDuration(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (months || !parts.length) {
    parts.push(`${months} ${months === 1 ? "month" : "months"}`);
  }
  return parts.join(" ");
}

function portugueseAgeDuration(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years) parts.push(`${years} ${years === 1 ? "ano" : "anos"}`);
  if (months || !parts.length) {
    parts.push(`${months} ${months === 1 ? "mês" : "meses"}`);
  }
  return parts.join(" e ");
}

export function formatBookingAgeRange({
  locale,
  minAgeMonths,
  maxAgeMonths,
}: {
  locale: string;
  minAgeMonths?: number;
  maxAgeMonths?: number;
}): string {
  const messages = getBookingMessages(locale);
  if (minAgeMonths === undefined && maxAgeMonths === undefined) {
    return messages.unlimited;
  }

  const language = new Intl.Locale(
    canonicalLocale(loadActivationLocale() ?? locale),
  ).language;
  const duration =
    language === "ru"
      ? russianAgeDuration
      : language === "pt"
        ? portugueseAgeDuration
        : englishAgeDuration;
  if (minAgeMonths === undefined) {
    if (language === "ru") return `до ${duration(maxAgeMonths ?? 0)}`;
    if (language === "pt") return `até ${duration(maxAgeMonths ?? 0)}`;
    return `up to ${duration(maxAgeMonths ?? 0)}`;
  }
  if (maxAgeMonths === undefined) {
    if (language === "ru") return `от ${duration(minAgeMonths)}`;
    if (language === "pt") return `a partir de ${duration(minAgeMonths)}`;
    return `from ${duration(minAgeMonths)}`;
  }

  if (minAgeMonths % 12 === 0 && maxAgeMonths % 12 === 0) {
    const minYears = minAgeMonths / 12;
    const maxYears = maxAgeMonths / 12;
    if (language === "ru") {
      return `${minYears}–${maxYears} ${russianPlural(
        maxYears,
        "год",
        "года",
        "лет",
      )}`;
    }
    return `${minYears}–${maxYears} ${language === "pt" ? "anos" : "years"}`;
  }
  return `${duration(minAgeMonths)}–${duration(maxAgeMonths)}`;
}

export function formatChildAgeAndBirthDate({
  birthDate,
  onDate,
  locale,
}: {
  birthDate: string;
  onDate: string;
  locale: string;
}): string {
  const resolvedLocale = canonicalLocale(loadActivationLocale() ?? locale);
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = onDate.split("-").map(Number);
  let years = currentYear - birthYear;
  if (
    currentMonth < birthMonth ||
    (currentMonth === birthMonth && currentDay < birthDay)
  ) {
    years -= 1;
  }
  if (!Number.isInteger(years) || years < 0) {
    throw new RangeError("Birth date must not be after the display date");
  }
  const language = new Intl.Locale(resolvedLocale).language;
  const category = new Intl.PluralRules(resolvedLocale).select(years);
  const ageUnit =
    language === "ru"
      ? category === "one"
        ? "год"
        : category === "few"
          ? "года"
          : "лет"
      : language === "pt"
        ? category === "one"
          ? "ano"
          : "anos"
        : category === "one"
          ? "year"
          : "years";
  const date = new Intl.DateTimeFormat(resolvedLocale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(asCalendarDate(birthDate));
  return `${years} ${ageUnit} · ${date}`;
}
