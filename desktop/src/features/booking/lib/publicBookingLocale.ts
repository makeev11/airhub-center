import type {
  BookingStatus,
  PreferredContactChannel,
  PublicBookingPurpose,
  TrialPolicy,
} from "@/features/booking/model/bookingCore";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import type { PublicApplicantValidationIssue } from "@/features/booking/model/publicBooking";

export type PublicBookingMessages = {
  brand: string;
  poweredByBrand: string;
  standaloneEyebrow: (organizationName: string) => string;
  standaloneTitle: string;
  standaloneDescription: string;
  bookingTitle: Record<PublicBookingPurpose, string>;
  bookingDescription: Record<PublicBookingPurpose, string>;
  loading: string;
  unavailableTitle: string;
  unavailableDescription: string;
  stepProgress: (current: number, total: number) => string;
  back: string;
  continue: string;
  changeCriteria: string;
  basicsTitle: string;
  basicsDescription: string;
  birthMonth: string;
  childAge: string;
  childAgeHint: string;
  ageYears: (age: number) => string;
  branch: string;
  chooseBranch: string;
  changeBranch: string;
  branchAvailable: string;
  branchUnavailable: string;
  branchAvailabilityLoading: string;
  basicsError: string;
  contextFallbackNotice: string;
  groupsTitle: string;
  groupsDescription: string;
  chooseGroup: string;
  noOptionsTitle: string;
  noOptionsDescription: string;
  occurrencesTitle: string;
  occurrencesDescription: string;
  chooseOccurrence: string;
  placesUnlimited: string;
  placesRemaining: (count: number) => string;
  placesFull: string;
  groupFullNotice: string;
  contactTitle: string;
  contactDescription: string;
  parentName: string;
  parentNamePlaceholder: string;
  phone: string;
  phonePlaceholder: string;
  childName: string;
  childNamePlaceholder: string;
  exactBirthDate: string;
  consent: string;
  applicantErrors: Record<PublicApplicantValidationIssue, string>;
  previewTitle: string;
  previewDescription: string;
  center: string;
  group: string;
  dateAndTime: string;
  address: string;
  room: string;
  teachers: string;
  trial: string;
  trialFree: string;
  trialPaid: (price: string) => string;
  trialDisabled: string;
  submit: string;
  submitting: string;
  slotUnavailableTitle: string;
  slotUnavailableDescription: string;
  ageMismatchTitle: string;
  ageMismatchDescription: string;
  loadErrorTitle: string;
  loadErrorDescription: string;
  genericErrorTitle: string;
  genericErrorDescription: string;
  successTitle: string;
  successDescription: string;
  openManagementCard: string;
  contactChannelTitle: string;
  contactChannelDescription: string;
  contactChannelSaved: (channel: string) => string;
  contactChannelHonesty: string;
  contactChannels: Record<PreferredContactChannel, string>;
  manageTitle: string;
  manageDescription: string;
  invalidLinkTitle: string;
  invalidLinkDescription: string;
  status: Record<BookingStatus, string>;
  statusLabel: string;
  child: string;
  maskedPhone: string;
  transferRequested: string;
  transferRequestedDescription: string;
  cancelBooking: string;
  cancelTitle: string;
  cancelDescription: string;
  cancelConfirm: string;
  requestTransfer: string;
  transferTitle: string;
  transferDescription: string;
  transferComment: string;
  transferCommentPlaceholder: string;
  transferConfirm: string;
  close: string;
  startAnotherBooking: string;
  demoHostEyebrow: string;
  demoHostTitle: string;
  demoHostDescription: string;
  demoHostButton: string;
  widgetTitle: string;
  widgetDescription: string;
};

const ruMessages: PublicBookingMessages = {
  brand: "Airhop",
  poweredByBrand: "Работает на Airhop",
  standaloneEyebrow: (organizationName) =>
    `Онлайн-запись · ${organizationName}`,
  standaloneTitle: "Подберём пробное занятие",
  standaloneDescription: "Выберите занятие и отправьте заявку центру.",
  bookingTitle: {
    trial: "Запись на пробное занятие",
    lesson: "Запись на занятие",
  },
  bookingDescription: {
    trial: "Подберём подходящее пробное занятие.",
    lesson: "Выберите подходящее занятие и время.",
  },
  loading: "Загружаем доступные занятия…",
  unavailableTitle: "Онлайн-запись временно недоступна",
  unavailableDescription:
    "Публичный Booking API ещё не подключён к этому стенду.",
  stepProgress: (current, total) => `Шаг ${current} из ${total}`,
  back: "Назад",
  continue: "Продолжить",
  changeCriteria: "Изменить возраст или филиал",
  basicsTitle: "Выберите филиал и возраст",
  basicsDescription: "",
  birthMonth: "Месяц и год рождения ребёнка",
  childAge: "Сколько лет ребёнку?",
  childAgeHint: "Точную дату рождения спросим только перед отправкой заявки.",
  ageYears: (age) => {
    if (age === 0) return "Меньше года";
    const lastTwoDigits = age % 100;
    const lastDigit = age % 10;
    const suffix =
      lastTwoDigits >= 11 && lastTwoDigits <= 14
        ? "лет"
        : lastDigit === 1
          ? "год"
          : lastDigit >= 2 && lastDigit <= 4
            ? "года"
            : "лет";
    return `${age} ${suffix}`;
  },
  branch: "Филиал",
  chooseBranch: "Выберите филиал",
  changeBranch: "Изменить",
  branchAvailable: "Есть места",
  branchUnavailable: "Подходящих мест пока нет",
  branchAvailabilityLoading: "Проверяем места…",
  basicsError: "Выберите возраст и активный филиал.",
  contextFallbackNotice:
    "Предварительно выбранный вариант недоступен. Проверьте параметры и продолжите подбор.",
  groupsTitle: "Выберите направление",
  groupsDescription: "",
  chooseGroup: "Выбрать направление",
  noOptionsTitle: "Подходящих вариантов пока нет",
  noOptionsDescription:
    "Попробуйте изменить возраст или филиал. Здесь позже можно подключить честный способ связи с центром.",
  occurrencesTitle: "Выберите дату и время",
  occurrencesDescription: "Заполненные занятия отмечены «Мест нет».",
  chooseOccurrence: "Выбрать занятие",
  placesUnlimited: "Количество мест не ограничено",
  placesRemaining: (count) => `Свободных мест: ${count}`,
  placesFull: "Мест нет",
  groupFullNotice: "Ближайшие занятия заполнены",
  contactTitle: "Контакты для заявки",
  contactDescription:
    "Точная дата рождения нужна для окончательной проверки возраста.",
  parentName: "Имя родителя",
  parentNamePlaceholder: "Например, Мария",
  phone: "Телефон",
  phonePlaceholder: "+7 999 123-45-67",
  childName: "Имя ребёнка",
  childNamePlaceholder: "Например, Лев",
  exactBirthDate: "Точная дата рождения ребёнка",
  consent:
    "Я согласен на обработку данных для подбора занятия и связи по этой заявке",
  applicantErrors: {
    parent_name_required: "Укажите имя родителя.",
    phone_invalid: "Укажите корректный телефон.",
    child_name_required: "Укажите имя ребёнка.",
    birth_date_invalid: "Укажите корректную дату рождения.",
    birth_date_in_future: "Дата рождения не может быть в будущем.",
    consent_required: "Нужно согласие на обработку данных.",
  },
  previewTitle: "Проверьте заявку",
  previewDescription:
    "Место будет временно занято до решения сотрудника, но не позже начала занятия.",
  center: "Центр",
  group: "Направление",
  dateAndTime: "Дата и время",
  address: "Адрес",
  room: "Кабинет",
  teachers: "Преподаватели",
  trial: "Пробное занятие",
  trialFree: "Бесплатно",
  trialPaid: (price) => `Стоимость: ${price}`,
  trialDisabled: "Пробное недоступно",
  submit: "Отправить заявку",
  submitting: "Отправляем…",
  slotUnavailableTitle: "Это занятие уже недоступно",
  slotUnavailableDescription:
    "Место мог занять другой родитель. Выберите другой вариант.",
  ageMismatchTitle: "Точная дата не подходит по возрасту",
  ageMismatchDescription:
    "Мы не создали заявку. Вернитесь к списку и выберите другое занятие.",
  loadErrorTitle: "Онлайн-запись пока недоступна",
  loadErrorDescription:
    "Не удалось загрузить филиалы и расписание. Обновите страницу чуть позже.",
  genericErrorTitle: "Не удалось отправить заявку",
  genericErrorDescription: "Попробуйте ещё раз — введённые данные сохранены.",
  successTitle: "Заявка ожидает подтверждения",
  successDescription:
    "Сотрудник центра проверит заявку. До подтверждения это ещё не окончательная запись.",
  openManagementCard: "Открыть персональную карточку",
  contactChannelTitle: "Как удобнее связаться",
  contactChannelDescription:
    "Выберите предпочтительный канал. Подключение бота на этом стенде не выполняется.",
  contactChannelSaved: (channel) => `Предпочтительный канал: ${channel}`,
  contactChannelHonesty:
    "Выбор сохранён, но сообщение в мессенджер ещё не отправлено.",
  contactChannels: {
    telegram: "Telegram",
    max: "MAX",
    whatsapp: "WhatsApp",
    phone: "Телефон",
    none: "Не выбран",
  },
  manageTitle: "Персональная карточка записи",
  manageDescription:
    "Секретная ссылка открывает только эту заявку и не создаёт аккаунт.",
  invalidLinkTitle: "Карточка недоступна",
  invalidLinkDescription:
    "Ссылка недействительна или была отозвана. Мы не можем показать сведения по этой заявке.",
  status: {
    pending_confirmation: "Ожидает подтверждения",
    confirmed: "Подтверждена",
    rejected: "Отклонена",
    cancelled_by_parent: "Отменена родителем",
    cancelled_by_center: "Отменена центром",
  },
  statusLabel: "Статус",
  child: "Ребёнок",
  maskedPhone: "Телефон для связи",
  transferRequested: "Перенос запрошен",
  transferRequestedDescription:
    "Заявка остаётся на исходном занятии, пока сотрудник не выполнит перенос.",
  cancelBooking: "Отменить запись",
  cancelTitle: "Отменить эту заявку?",
  cancelDescription:
    "Место освободится сразу. Отмену нельзя обратить по этой ссылке.",
  cancelConfirm: "Да, отменить",
  requestTransfer: "Запросить перенос",
  transferTitle: "Запросить перенос занятия",
  transferDescription:
    "Мы сохраним запрос, но не будем автоматически менять занятие или освобождать место.",
  transferComment: "Комментарий, необязательно",
  transferCommentPlaceholder: "Например, удобнее в выходные",
  transferConfirm: "Отправить запрос",
  close: "Закрыть",
  startAnotherBooking: "Подобрать другое занятие",
  demoHostEyebrow: "Демонстрационный сайт центра",
  demoHostTitle: "Место, где любопытство становится навыком",
  demoHostDescription:
    "Пример страницы центра: выбранные филиал, направление и возраст уже переданы в форму.",
  demoHostButton: "Записаться",
  widgetTitle: "Запись через Airhop",
  widgetDescription: "Та же форма работает внутри фирменного окна сайта.",
};

const messagesByLanguage: Partial<Record<string, PublicBookingMessages>> = {
  ru: ruMessages,
};

export function getPublicBookingMessages(
  locale: string,
): PublicBookingMessages {
  let language = "ru";
  try {
    const canonical = Intl.getCanonicalLocales(locale)[0] ?? "ru-RU";
    language = new Intl.Locale(canonical).language;
  } catch {
    // Russian is the explicit MVP fallback.
  }
  return messagesByLanguage[language] ?? ruMessages;
}

/** Formats all trial-policy states without presenting disabled as free. */
export function formatPublicTrialPolicy(
  policy: TrialPolicy,
  locale: string,
  messages: PublicBookingMessages = getPublicBookingMessages(locale),
): string {
  if (policy.mode === "free") return messages.trialFree;
  if (policy.mode === "disabled") return messages.trialDisabled;
  return messages.trialPaid(
    createBookingFormatters(locale).money(
      policy.price.amountMinor,
      policy.price.currency,
    ),
  );
}

/** Keeps the public occurrence label wholly controlled by locale formatting. */
export function formatPublicOccurrenceDateTime(
  occurrence: {
    date: string;
    startTime: string;
    endTime: string;
  },
  locale: string,
): string {
  const formatters = createBookingFormatters(locale);
  return `${formatters.weekdayDate(occurrence.date)} · ${occurrence.startTime}–${occurrence.endTime}`;
}
