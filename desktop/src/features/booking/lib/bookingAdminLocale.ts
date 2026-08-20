import type { Weekday } from "@/features/booking/model/bookingCore";
import {
  type BookingPaymentMessages,
  ruPaymentMessages,
} from "@/features/booking/lib/bookingPaymentLocale";
import { EN_BOOKING_ADMIN_MESSAGES } from "@/features/booking/lib/bookingAdminLocale.en";
import { loadAirHopLocale } from "@/shared/locale/airhopLocale";
import type { BookingEnrollmentManagementMessages } from "@/features/booking/lib/bookingEnrollmentLocale";

export type BookingAdminMessages = BookingPaymentMessages &
  BookingEnrollmentManagementMessages & {
    productName: string;
    navSchedule: string;
    navRequests: string;
    navClients: string;
    navBranches: string;
    navGroups: string;
    navTariffs: string;
    navPayments: string;
    navAnalytics: string;
    navTeachers: string;
    navSettings: string;
    loadingTitle: string;
    loadingDescription: string;
    unavailableTitle: string;
    unavailableDescription: string;
    loadErrorTitle: string;
    loadErrorDescription: string;
    saveErrorTitle: string;
    saveErrorDescription: string;
    retry: string;
    revisionConflictTitle: string;
    revisionConflictDescription: string;
    recoveredDataTitle: string;
    recoveredDataDescription: string;
    dismiss: string;
    unsavedChangesConfirm: string;
    save: string;
    saving: string;
    cancel: string;
    edit: string;
    archive: string;
    restore: string;
    active: string;
    archived: string;
    nextStage: string;
    settingsTitle: string;
    settingsDescription: string;
    settingsSectionsLabel: string;
    organizationCardTitle: string;
    organizationName: string;
    locale: string;
    localeRussian: string;
    localeEnglish: string;
    timeZone: string;
    timeZoneAutomatic: (timeZone: string) => string;
    timeZoneHint: string;
    trialPolicy: string;
    trialDisabled: string;
    trialFree: string;
    trialPaid: string;
    currency: string;
    trialPrice: string;
    centerPaymentDay: string;
    centerPaymentDayHint: string;
    attendanceDefault: string;
    attendanceHint: string;
    singleVisitsDefault: string;
    singleVisitsHint: string;
    publicBookingCardTitle: string;
    publicBookingCardDescription: string;
    publicBookingPurpose: string;
    publicBookingPurposeTrial: string;
    publicBookingPurposeLesson: string;
    publicBookingPurposeHint: string;
    publicBookingAppearance: string;
    publicBookingAppearanceAutomatic: string;
    publicBookingAppearanceLight: string;
    publicBookingAppearanceDark: string;
    publicBookingAppearanceHint: string;
    settingsSaved: string;
    requiredField: string;
    invalidTimeZone: string;
    invalidCurrency: string;
    invalidPrice: string;
    branchesTitle: string;
    branchesDescription: string;
    addBranch: string;
    noBranchesTitle: string;
    noBranchesDescription: string;
    branchName: string;
    branchAddress: string;
    buzzChannel: string;
    buzzChannelHint: string;
    buzzChannelPlaceholder: string;
    buzzChannelSearching: string;
    buzzChannelFound: (name: string) => string;
    buzzChannelWillCreate: (name: string) => string;
    buzzChannelSuggestions: string;
    buzzChannelLookupError: string;
    buzzChannelUnavailable: string;
    buzzChannelDescription: (branchName: string) => string;
    workingHours: string;
    workingDay: string;
    dayOff: string;
    workingPeriodStart: string;
    workingPeriodEnd: string;
    addPeriod: string;
    removePeriod: string;
    createBranchTitle: string;
    editBranchTitle: string;
    createBranchDescription: string;
    editBranchDescription: string;
    branchCreated: string;
    branchUpdated: string;
    branchArchived: string;
    branchRestored: string;
    archiveBranchTitle: (name: string) => string;
    archiveBranchDescription: string;
    branchUsage: (groups: number, rooms: number, rules: number) => string;
    copyBookingLink: string;
    bookingLinkCopied: (name: string) => string;
    bookingLinkCopyFailed: string;
    manageRooms: string;
    roomsForBranch: (name: string) => string;
    roomsDescription: string;
    addRoom: string;
    noRoomsTitle: string;
    noRoomsDescription: string;
    roomName: string;
    createRoomTitle: string;
    editRoomTitle: string;
    createRoomDescription: string;
    editRoomDescription: string;
    roomCreated: string;
    roomUpdated: string;
    roomArchived: string;
    roomRestored: string;
    archiveRoomTitle: (name: string) => string;
    archiveRoomDescription: string;
    roomUsage: (active: number, historical: number) => string;
    restoreRoomBlocked: string;
    invalidWorkingPeriod: string;
    overlapWarningTitle: string;
    overlapWarningDescription: string;
    overlapConfirmation: string;
    workingDaysSummary: (days: number, periods: number) => string;
    groupsTitle: string;
    groupsDescription: string;
    addGroup: string;
    noGroupsTitle: string;
    noGroupsDescription: string;
    groupName: string;
    groupDescription: string;
    groupDescriptionHint: string;
    groupBranch: string;
    groupRoom: string;
    noRoom: string;
    groupTeachers: string;
    noTeachers: string;
    groupMinAge: string;
    groupMaxAge: string;
    ageMonthsHint: string;
    groupCapacity: string;
    capacityHint: string;
    groupTrialPolicy: string;
    inheritCenterSetting: string;
    groupAttendance: string;
    groupSingleVisits: string;
    attendanceEnabled: string;
    attendanceDisabled: string;
    singleVisitsEnabled: string;
    singleVisitsDisabled: string;
    inheritGroupSetting: string;
    lessonChangeSingleVisits: (from: string, to: string) => string;
    weeklySchedule: string;
    scheduleHint: string;
    scheduleWeekday: string;
    scheduleStartsOn: string;
    scheduleEndsOn: string;
    scheduleStartTime: string;
    scheduleEndTime: string;
    addScheduleTemplate: string;
    removeScheduleTemplate: string;
    createGroupTitle: string;
    editGroupTitle: string;
    createGroupDescription: string;
    editGroupDescription: string;
    groupCreated: string;
    groupUpdated: string;
    groupArchived: string;
    groupRestored: string;
    archiveGroupTitle: (name: string) => string;
    archiveGroupDescription: string;
    groupUsage: (rules: number, exceptions: number) => string;
    groupScheduleSummary: (templates: number) => string;
    groupTeachersSummary: (teachers: number) => string;
    groupEnrollStudent: string;
    groupActiveStudents: (count: number) => string;
    groupAgeSummary: (minimum: string, maximum: string) => string;
    groupCapacityUnlimited: string;
    trialEffective: (value: string) => string;
    attendanceEffective: (value: string) => string;
    archivedBranchOption: (name: string) => string;
    archivedTeacherOption: (name: string) => string;
    archivedRoomOption: (name: string) => string;
    restoreGroupBlocked: string;
    invalidAge: string;
    invalidAgeRange: string;
    invalidCapacity: string;
    invalidScheduleRange: string;
    invalidScheduleTime: string;
    scheduleWeekdayRequired: string;
    scheduleRequired: string;
    scheduleConflictTitle: string;
    scheduleConflictDescription: string;
    scheduleConflictWorkingHours: string;
    scheduleConflictRoom: string;
    scheduleConflictTeacher: string;
    scheduleConflictWithGroup: (name: string) => string;
    scheduleConflictConfirmation: string;
    bookedOccurrenceRuleErrorTitle: string;
    bookedOccurrenceRuleErrorDescription: string;
    teachersTitle: string;
    teachersDescription: string;
    addTeacher: string;
    noTeachersTitle: string;
    noTeachersDescription: string;
    teacherName: string;
    teacherBuzzUsername: string;
    teacherBuzzUsernameHint: string;
    createTeacherTitle: string;
    editTeacherTitle: string;
    createTeacherDescription: string;
    editTeacherDescription: string;
    teacherCreated: string;
    teacherUpdated: string;
    teacherArchived: string;
    teacherRestored: string;
    archiveTeacherTitle: (name: string) => string;
    archiveTeacherDescription: string;
    teacherUsage: (groups: number, rules: number) => string;
    teacherGroupsSummary: (groups: number) => string;
    tariffsTitle: string;
    tariffsDescription: string;
    addTariff: string;
    noTariffsTitle: string;
    noTariffsDescription: string;
    tariffName: string;
    tariffDescription: string;
    tariffDescriptionHint: string;
    tariffPrice: string;
    tariffCurrency: string;
    tariffWeeklyScheduleLimit: string;
    tariffWeeklyScheduleLimitHint: string;
    tariffPaymentDay: string;
    tariffPaymentDayInherited: (day: number) => string;
    tariffPaymentDayCustom: string;
    tariffPaymentDayCustomLabel: string;
    tariffPaymentDayHint: string;
    createTariffTitle: string;
    editTariffTitle: string;
    createTariffDescription: string;
    editTariffDescription: string;
    tariffCreated: string;
    tariffUpdated: string;
    tariffArchived: string;
    tariffRestored: string;
    showArchivedTariffs: (count: number) => string;
    hideArchivedTariffs: string;
    archivedTariffsTitle: string;
    archiveTariffTitle: (name: string) => string;
    archiveTariffDescription: string;
    tariffEnrollmentUsage: (count: number) => string;
    tariffPerWeek: (count: number) => string;
    tariffPaymentDaySummary: (day: number) => string;
    tariffPaymentDayCenterSummary: (day: number) => string;
    invalidWeeklyScheduleLimit: string;
    invalidPaymentDay: string;
    enrollChildTitle: string;
    enrollChildDescription: string;
    enrollmentClientSectionTitle: string;
    enrollmentClientSectionDescription: string;
    enrollmentTermsSectionTitle: string;
    enrollmentTermsSectionDescription: string;
    enrollmentExistingChild: string;
    enrollmentGroup: string;
    enrollmentTariff: string;
    enrollmentTariffPlaceholder: string;
    enrollmentSchedule: string;
    enrollmentStartDate: string;
    enrollmentAgeWarningTitle: string;
    enrollmentAgeWarningDescription: (ageRange: string) => string;
    enrollmentReviewTitle: string;
    enrollmentReviewDescription: string;
    enrollmentSelectedSlots: (selected: number, maximum: number) => string;
    enrollmentSlotLimitReached: (maximum: number) => string;
    enrollmentNoWeeklySlots: string;
    enrollmentNoGroups: string;
    enrollmentNoTariffs: string;
    enrollmentFirstPayment: string;
    enrollmentBack: string;
    enrollmentContinue: string;
    enrollmentConfirm: string;
    enrollmentCreated: string;
    enrollmentActionFailed: string;
    familyEnrollments: string;
    familyEnrollChild: string;
    enrollmentNeedsAssignment: string;
    enrollmentStarts: (date: string) => string;
    enrollmentManage: string;
    enrollmentManagementTitle: string;
    enrollmentManagementDescription: (group: string) => string;
    enrollmentManagementFailed: string;
    enrollmentUpdated: string;
    enrollmentCurrentTariff: string;
    enrollmentChangeTariff: string;
    enrollmentSelectTariff: string;
    enrollmentNoCompatibleTariffs: string;
    enrollmentTariffFutureOnly: string;
    enrollmentPause: string;
    enrollmentResume: string;
    enrollmentEnd: string;
    enrollmentEndDescription: string;
    enrollmentEndWarning: string;
    requestsTitle: string;
    requestsDescription: string;
    requestSearch: string;
    requestFilterAll: string;
    requestFilterAttention: string;
    requestFilterPending: string;
    requestFilterConfirmed: string;
    requestFilterProcessed: string;
    noRequestsTitle: string;
    noRequestsDescription: string;
    requestStatusPending: string;
    requestStatusConfirmed: string;
    requestStatusRejected: string;
    requestStatusCancelledByParent: string;
    requestStatusCancelledByCenter: string;
    requestStatusIntakeNew: string;
    requestStatusIntakeConverted: string;
    requestStatusIntakeClosed: string;
    requestNeedsLesson: string;
    requestTransferPending: string;
    requestPossibleDuplicate: string;
    requestConfirm: string;
    requestReject: string;
    requestConfirmed: string;
    requestRejected: string;
    requestMessengerQueued: string;
    requestStaffCallQueued: string;
    requestSourceBookingCore: string;
    requestLoadMore: string;
    requestLoadingMore: string;
    requestOpenFamily: string;
    clientsTitle: string;
    clientsDescription: string;
    clientSearch: string;
    clientAddFamily: string;
    clientsServerReadOnly: string;
    noClientsTitle: string;
    noClientsDescription: string;
    family: string;
    familyRepresentatives: string;
    familyChildren: string;
    familyHistory: string;
    familyPrimaryContact: string;
    familyBookingsCount: (count: number) => string;
    familyActiveEnrollmentsCount: (count: number) => string;
    familyLastActivity: string;
    familyPossibleDuplicate: string;
    familyNotFoundTitle: string;
    familyNotFoundDescription: string;
    familySourceBookingCore: string;
    familyServerReadOnly: string;
    familyVerifiedMessenger: string;
    familyNoEnrollments: string;
    familyEnrollmentPaused: string;
    familyEnrollmentEnded: string;
    familyHistoryTruncated: string;
    createFamilyTitle: string;
    createFamilyDescription: string;
    familyCreated: string;
    editRepresentativeTitle: string;
    addRepresentativeTitle: string;
    representativeSaved: string;
    editChildTitle: string;
    addChildTitle: string;
    childSaved: string;
    invalidPhone: string;
    invalidBirthDate: string;
    familyArchiveTitle: (name: string) => string;
    familyArchiveDescription: string;
    familyArchived: string;
    familyRestored: string;
    familyName: string;
    editFamilyNameTitle: string;
    editFamilyNameDescription: string;
    representativeName: string;
    representativeFirstName: string;
    representativeLastName: string;
    representativePhone: string;
    representativeChannel: string;
    childName: string;
    childBirthDate: string;
    childNote: string;
    addRepresentative: string;
    addChild: string;
    lessonRosterTitle: string;
    lessonRosterExpected: (count: number) => string;
    lessonRosterEmpty: string;
    lessonRosterPending: string;
    lessonRosterConfirmed: string;
    lessonRosterPermanent: string;
    lessonRosterTrial: string;
    lessonRosterSingle: string;
    lessonAddParticipant: string;
    lessonAddParticipantTitle: string;
    lessonAddParticipantDescription: string;
    participantExistingClient: string;
    participantNewClient: string;
    participantSearch: string;
    participantSearchEmpty: string;
    participantVisitKind: string;
    participantVisitTrial: string;
    participantVisitSingle: string;
    participantNoVisitKinds: string;
    participantAdd: string;
    participantAdded: string;
    participantAttendancePresent: string;
    participantAttendanceAbsent: string;
    participantActionFailed: string;
    weekdayNames: Record<Weekday, string>;
  };

const ru: BookingAdminMessages = {
  productName: "Airhop",
  navSchedule: "Расписание",
  navRequests: "Заявки",
  navClients: "Клиенты",
  navBranches: "Филиалы",
  navGroups: "Группы",
  navTariffs: "Тарифы",
  navPayments: "Оплаты",
  navAnalytics: "Аналитика",
  navTeachers: "Преподаватели",
  navSettings: "Настройки",
  loadingTitle: "Загружаем Airhop",
  loadingDescription: "Получаем актуальные настройки и филиалы.",
  unavailableTitle: "Booking Core ещё не подключён",
  unavailableDescription:
    "В production здесь будет серверный репозиторий. Локальные данные используются только на стенде разработки.",
  loadErrorTitle: "Не удалось загрузить Airhop",
  loadErrorDescription:
    "Данные Airhop не загружены. Проверьте доступ к хранилищу и повторите попытку.",
  saveErrorTitle: "Не удалось сохранить изменения",
  saveErrorDescription:
    "Изменения не сохранены. Проверьте доступ к хранилищу и повторите попытку.",
  retry: "Повторить",
  revisionConflictTitle: "Данные уже изменились",
  revisionConflictDescription:
    "Загружена свежая версия. Проверьте поля перед повторным сохранением — чужие изменения не перезаписаны.",
  recoveredDataTitle: "Демостенд восстановлен",
  recoveredDataDescription:
    "Повреждённые демоданные сохранены в резервную копию, стенд восстановлен.",
  dismiss: "Закрыть",
  unsavedChangesConfirm:
    "Есть несохранённые изменения. Выйти и потерять черновик?",
  save: "Сохранить",
  saving: "Сохраняем…",
  cancel: "Отмена",
  edit: "Редактировать",
  archive: "Архивировать",
  restore: "Восстановить",
  active: "Активен",
  archived: "В архиве",
  nextStage: "Следующий этап",
  settingsTitle: "Настройки AirHop",
  settingsDescription:
    "Основные параметры центра и значения по умолчанию для новых групп.",
  settingsSectionsLabel: "Разделы настроек Airhop",
  organizationCardTitle: "Организация",
  organizationName: "Название центра",
  locale: "Язык интерфейса",
  localeRussian: "Русский",
  localeEnglish: "Английский",
  timeZone: "Часовой пояс",
  timeZoneAutomatic: (timeZone) => `Определить автоматически — ${timeZone}`,
  timeZoneHint:
    "Выберите часовой пояс IANA из списка или определите его автоматически.",
  trialPolicy: "Пробное занятие по умолчанию",
  trialDisabled: "Недоступно",
  trialFree: "Бесплатно",
  trialPaid: "Платно",
  currency: "Валюта",
  trialPrice: "Стоимость",
  centerPaymentDay: "Число месяца оплаты по умолчанию",
  centerPaymentDayHint:
    "Новые тарифы используют это число, если для них не задан другой день.",
  attendanceDefault: "Включать посещаемость по умолчанию",
  attendanceHint: "Группа сможет переопределить это значение позже.",
  singleVisitsDefault: "Разовые посещения",
  singleVisitsHint:
    "Разрешить запись на одно обычное занятие. Группа или отдельное занятие смогут переопределить настройку.",
  publicBookingCardTitle: "Публичная запись",
  publicBookingCardDescription:
    "Настройка формы, которая открывается на сайте центра и по ссылкам филиалов.",
  publicBookingPurpose: "Сценарий виджета",
  publicBookingPurposeTrial: "Запись на пробное занятие",
  publicBookingPurposeLesson: "Запись на занятие",
  publicBookingPurposeHint:
    "Сценарий меняет заголовки и набор доступных занятий, а не только текст формы.",
  publicBookingAppearance: "Внешний вид",
  publicBookingAppearanceAutomatic: "Как в Airhop",
  publicBookingAppearanceLight: "Светлый",
  publicBookingAppearanceDark: "Тёмный",
  publicBookingAppearanceHint:
    "Фирменное оформление Airhop либо отдельный светлый или тёмный вариант для публичной формы.",
  settingsSaved: "Настройки сохранены",
  requiredField: "Заполните обязательное поле.",
  invalidTimeZone: "Укажите корректный часовой пояс IANA.",
  invalidCurrency:
    "Укажите поддерживаемый трёхбуквенный код валюты, например RUB.",
  invalidPrice:
    "Укажите неотрицательную стоимость с точностью выбранной валюты.",
  branchesTitle: "Филиалы",
  branchesDescription: "Адреса, рабочее время и маршрутизация рабочих каналов.",
  addBranch: "Добавить филиал",
  noBranchesTitle: "Филиалов пока нет",
  noBranchesDescription:
    "Создайте первый филиал, чтобы затем привязать к нему группы и расписание.",
  branchName: "Название филиала",
  branchAddress: "Адрес",
  buzzChannel: "Канал филиала",
  buzzChannelHint:
    "Здесь команда будет получать новые записи, задачи и уведомления Airhop. Если канал уже есть, мы привяжем его; если нет — создадим при сохранении.",
  buzzChannelPlaceholder: "например, курская",
  buzzChannelSearching: "Ищем канал в Buzz…",
  buzzChannelFound: (name) =>
    `Найден канал #${name}. Филиал будет привязан к нему.`,
  buzzChannelWillCreate: (name) =>
    `Канала #${name} пока нет. Он будет создан при сохранении филиала.`,
  buzzChannelSuggestions: "Похожие каналы:",
  buzzChannelLookupError:
    "Не удалось проверить или создать канал. Проверьте подключение к Buzz и повторите.",
  buzzChannelUnavailable: "Привязанный канал недоступен",
  buzzChannelDescription: (branchName) =>
    `Рабочий канал филиала «${branchName}» в AirHop.`,
  workingHours: "Рабочее время",
  workingDay: "Рабочий день",
  dayOff: "Выходной",
  workingPeriodStart: "начало",
  workingPeriodEnd: "окончание",
  addPeriod: "Добавить интервал",
  removePeriod: "Удалить интервал",
  createBranchTitle: "Новый филиал",
  editBranchTitle: "Редактирование филиала",
  createBranchDescription: "Укажите адрес и недельное рабочее время.",
  editBranchDescription: "Изменения сразу отразятся во всех разделах Airhop.",
  branchCreated: "Филиал создан",
  branchUpdated: "Филиал обновлён",
  branchArchived: "Филиал перемещён в архив",
  branchRestored: "Филиал восстановлен",
  archiveBranchTitle: (name) => `Архивировать «${name}»?`,
  archiveBranchDescription:
    "Филиал останется в истории и во всех связанных данных. Новые группы не смогут использовать его.",
  branchUsage: (groups, rooms, rules) =>
    `Связи: групп — ${groups}, помещений — ${rooms}, правил расписания — ${rules}.`,
  copyBookingLink: "Скопировать ссылку записи",
  bookingLinkCopied: (name) => `Ссылка записи для «${name}» скопирована`,
  bookingLinkCopyFailed:
    "Не удалось скопировать ссылку записи. Повторите попытку.",
  manageRooms: "Кабинеты",
  roomsForBranch: (name) => `Кабинеты · ${name}`,
  roomsDescription:
    "Кабинеты и залы этого филиала. Архив сохраняет существующие связи.",
  addRoom: "Добавить кабинет",
  noRoomsTitle: "Кабинетов пока нет",
  noRoomsDescription:
    "Можно оставить кабинет пустым или добавить первый кабинет филиала.",
  roomName: "Название кабинета или зала",
  createRoomTitle: "Новый кабинет",
  editRoomTitle: "Редактирование кабинета",
  createRoomDescription: "Кабинет будет доступен группам этого филиала.",
  editRoomDescription:
    "Новое название отразится во всех связанных группах и занятиях.",
  roomCreated: "Кабинет создан",
  roomUpdated: "Кабинет обновлён",
  roomArchived: "Кабинет перемещён в архив",
  roomRestored: "Кабинет восстановлен",
  archiveRoomTitle: (name) => `Архивировать «${name}»?`,
  archiveRoomDescription:
    "Кабинет останется в существующих группах и истории занятий, но исчезнет из новых назначений.",
  roomUsage: (active, historical) =>
    `Связи: активных — ${active}, исторических — ${historical}.`,
  restoreRoomBlocked:
    "Сначала восстановите филиал, чтобы снова назначать этот кабинет.",
  invalidWorkingPeriod: "Время окончания должно быть позже времени начала.",
  overlapWarningTitle: "Интервалы пересекаются",
  overlapWarningDescription:
    "Это допустимо, но может привести к неоднозначному рабочему времени. Подтвердите осознанное сохранение.",
  overlapConfirmation: "Я понимаю и хочу сохранить пересекающиеся интервалы",
  workingDaysSummary: (days, periods) =>
    `Рабочих дней: ${days} · интервалов: ${periods}`,
  groupsTitle: "Группы",
  groupsDescription:
    "Параметры групп, преподаватели и недельные шаблоны расписания.",
  addGroup: "Добавить группу",
  noGroupsTitle: "Групп пока нет",
  noGroupsDescription:
    "Создайте первую группу и задайте хотя бы один недельный шаблон занятий.",
  groupName: "Название группы",
  groupDescription: "Описание",
  groupDescriptionHint: "Необязательно. Короткая внутренняя заметка о группе.",
  groupBranch: "Филиал",
  groupRoom: "Кабинет или зал",
  noRoom: "Не выбран",
  groupTeachers: "Преподаватели",
  noTeachers: "Без преподавателя",
  groupMinAge: "Минимальный возраст, месяцев",
  groupMaxAge: "Максимальный возраст, месяцев",
  ageMonthsHint: "Необязательно. Каждая граница задаётся независимо.",
  groupCapacity: "Вместимость",
  capacityHint: "Оставьте пустым, если ограничения нет.",
  groupTrialPolicy: "Пробное занятие",
  inheritCenterSetting: "Как в настройках центра",
  groupAttendance: "Учёт посещаемости",
  groupSingleVisits: "Разовые посещения",
  attendanceEnabled: "Включён",
  attendanceDisabled: "Выключен",
  singleVisitsEnabled: "Разрешить",
  singleVisitsDisabled: "Запретить",
  inheritGroupSetting: "Как в настройках группы",
  lessonChangeSingleVisits: (from, to) => `Разовые посещения: ${from} → ${to}`,
  weeklySchedule: "Недельное расписание",
  scheduleHint:
    "Каждая строка создаёт повторяющееся занятие в выбранном диапазоне дат.",
  scheduleWeekday: "День недели",
  scheduleStartsOn: "Начало",
  scheduleEndsOn: "Окончание",
  scheduleStartTime: "С",
  scheduleEndTime: "До",
  addScheduleTemplate: "Добавить занятие",
  removeScheduleTemplate: "Удалить занятие",
  createGroupTitle: "Новая группа",
  editGroupTitle: "Редактирование группы",
  createGroupDescription:
    "Укажите филиал, параметры группы и недельное расписание.",
  editGroupDescription:
    "Удалённые шаблоны останутся в истории и перестанут создавать новые занятия.",
  groupCreated: "Группа создана",
  groupUpdated: "Группа обновлена",
  groupArchived: "Группа перемещена в архив",
  groupRestored: "Группа восстановлена",
  archiveGroupTitle: (name) => `Архивировать «${name}»?`,
  archiveGroupDescription:
    "Группа и связанные шаблоны останутся в истории. Активное расписание больше не будет создавать по ним занятия.",
  groupUsage: (rules, exceptions) =>
    `История: шаблонов — ${rules}, исключений занятий — ${exceptions}.`,
  groupScheduleSummary: (templates) => `Шаблонов расписания: ${templates}`,
  groupTeachersSummary: (teachers) =>
    teachers ? `Преподавателей: ${teachers}` : "Без преподавателя",
  groupEnrollStudent: "Добавить постоянного ученика",
  groupActiveStudents: (count) => `Постоянных учеников: ${count}`,
  groupAgeSummary: (minimum, maximum) => `Возраст: ${minimum} — ${maximum}`,
  groupCapacityUnlimited: "Вместимость без ограничений",
  trialEffective: (value) => `Пробное: ${value}`,
  attendanceEffective: (value) => `Посещаемость: ${value}`,
  archivedBranchOption: (name) => `${name} (филиал в архиве)`,
  archivedTeacherOption: (name) => `${name} (в архиве)`,
  archivedRoomOption: (name) => `${name} (в архиве)`,
  restoreGroupBlocked:
    "Сначала выберите активный филиал в редакторе группы или восстановите связанный филиал.",
  invalidAge: "Укажите целое неотрицательное число месяцев.",
  invalidAgeRange: "Минимальный возраст не может быть больше максимального.",
  invalidCapacity: "Укажите целое число больше нуля или оставьте поле пустым.",
  invalidScheduleRange: "Дата окончания должна быть не раньше даты начала.",
  invalidScheduleTime: "Время окончания должно быть позже времени начала.",
  scheduleWeekdayRequired: "Выберите хотя бы один день недели.",
  scheduleRequired: "Добавьте хотя бы одно занятие в недельное расписание.",
  scheduleConflictTitle: "Есть конфликты расписания",
  scheduleConflictDescription:
    "Сохранение допустимо, но сначала проверьте перечисленные пересечения.",
  scheduleConflictWorkingHours: "Занятие выходит за рабочее время филиала",
  scheduleConflictRoom: "Кабинет уже занят",
  scheduleConflictTeacher: "Преподаватель уже занят",
  scheduleConflictWithGroup: (name) => `Пересечение с группой «${name}»`,
  scheduleConflictConfirmation:
    "Я проверил конфликты и хочу сохранить расписание",
  bookedOccurrenceRuleErrorTitle: "Нельзя изменить эту серию",
  bookedOccurrenceRuleErrorDescription:
    "Серия уже используется записями или постоянными учениками либо связана с архивными настройками. Сохраните её историю и создайте новый шаблон.",
  teachersTitle: "Преподаватели",
  teachersDescription:
    "Необязательный справочник преподавателей с сохранением исторических связей.",
  addTeacher: "Добавить преподавателя",
  noTeachersTitle: "Преподавателей пока нет",
  noTeachersDescription:
    "Можно работать без преподавателей или добавить первого в справочник.",
  teacherName: "Имя преподавателя",
  teacherBuzzUsername: "Имя в Buzz",
  teacherBuzzUsernameHint: "Необязательно. Укажите имя без символа @.",
  createTeacherTitle: "Новый преподаватель",
  editTeacherTitle: "Редактирование преподавателя",
  createTeacherDescription:
    "Для создания достаточно имени. Привязка к группам необязательна.",
  editTeacherDescription:
    "Изменения имени отразятся во всех связанных группах и занятиях.",
  teacherCreated: "Преподаватель создан",
  teacherUpdated: "Преподаватель обновлён",
  teacherArchived: "Преподаватель перемещён в архив",
  teacherRestored: "Преподаватель восстановлен",
  archiveTeacherTitle: (name) => `Архивировать «${name}»?`,
  archiveTeacherDescription:
    "Преподаватель останется в истории и в уже созданных связях, но исчезнет из списка новых назначений.",
  teacherUsage: (groups, rules) =>
    `Связи: групп — ${groups}, шаблонов расписания — ${rules}.`,
  teacherGroupsSummary: (groups) => `Связан с группами: ${groups}`,
  tariffsTitle: "Тарифы",
  tariffsDescription:
    "Стоимость, число занятий в неделю и день ожидаемой оплаты.",
  addTariff: "Добавить тариф",
  noTariffsTitle: "Тарифов пока нет",
  noTariffsDescription:
    "Создайте первый тариф, чтобы зачислять учеников в постоянные группы.",
  tariffName: "Название тарифа",
  tariffDescription: "Что входит",
  tariffDescriptionHint: "Необязательно. Например: восемь занятий в месяц.",
  tariffPrice: "Стоимость",
  tariffCurrency: "Валюта",
  tariffWeeklyScheduleLimit: "Занятий в неделю",
  tariffWeeklyScheduleLimitHint:
    "При зачислении сотрудник выберет не больше этого числа дней.",
  tariffPaymentDay: "День оплаты",
  tariffPaymentDayInherited: (day) => `Как у центра — ${day}-го числа`,
  tariffPaymentDayCustom: "Другой день",
  tariffPaymentDayCustomLabel: "Число месяца",
  tariffPaymentDayHint:
    "Первая оплата ожидается в день зачисления, следующие — в выбранный день.",
  createTariffTitle: "Новый тариф",
  editTariffTitle: "Редактирование тарифа",
  createTariffDescription:
    "Задайте понятное название, стоимость и допустимое расписание.",
  editTariffDescription:
    "Изменения применятся к новым оплатам и не перепишут уже созданные.",
  tariffCreated: "Тариф создан",
  tariffUpdated: "Тариф обновлён",
  tariffArchived: "Тариф перемещён в архив",
  tariffRestored: "Тариф восстановлен",
  showArchivedTariffs: (count) => `Показать архив · ${count}`,
  hideArchivedTariffs: "Скрыть архив",
  archivedTariffsTitle: "Архивные тарифы",
  archiveTariffTitle: (name) => `Архивировать «${name}»?`,
  archiveTariffDescription:
    "Тариф останется у уже зачисленных учеников и в истории оплат, но его нельзя будет выбрать для нового зачисления.",
  tariffEnrollmentUsage: (count) => `Активных зачислений: ${count}`,
  tariffPerWeek: (count) => `${count} в неделю`,
  tariffPaymentDaySummary: (day) => `Оплата ${day}-го числа`,
  tariffPaymentDayCenterSummary: (day) => `Оплата как у центра: ${day}-го`,
  invalidWeeklyScheduleLimit: "Выберите от 1 до 7 занятий в неделю.",
  invalidPaymentDay: "Укажите число от 1 до 28.",
  enrollChildTitle: "Зачислить в группу",
  enrollChildDescription:
    "Выберите тариф и постоянные дни занятий. Первая оплата появится сразу после подтверждения.",
  enrollmentClientSectionTitle: "Кого зачисляем?",
  enrollmentClientSectionDescription:
    "Выберите ребёнка из клиентской базы или создайте новую карточку.",
  enrollmentTermsSectionTitle: "Условия зачисления",
  enrollmentTermsSectionDescription:
    "Выберите тариф, дату начала и постоянные дни занятий.",
  enrollmentExistingChild: "Ребёнок",
  enrollmentGroup: "Группа",
  enrollmentTariff: "Тариф",
  enrollmentTariffPlaceholder: "Выберите тариф",
  enrollmentSchedule: "Постоянные дни",
  enrollmentStartDate: "Дата начала",
  enrollmentAgeWarningTitle: "Возраст вне диапазона группы",
  enrollmentAgeWarningDescription: (ageRange) =>
    `Рекомендуемый возраст для этой группы: ${ageRange}. Можно продолжить, если сотрудник центра согласовал зачисление.`,
  enrollmentReviewTitle: "Проверьте зачисление",
  enrollmentReviewDescription:
    "После подтверждения ребёнок появится в выбранных занятиях, а оплата — в рабочей очереди.",
  enrollmentSelectedSlots: (selected, maximum) =>
    `Выбрано ${selected} из ${maximum}`,
  enrollmentSlotLimitReached: (maximum) =>
    `По этому тарифу можно выбрать не больше ${maximum}.`,
  enrollmentNoWeeklySlots:
    "У группы нет активного регулярного расписания. Сначала добавьте занятия в группе.",
  enrollmentNoGroups: "Нет активных групп с регулярным расписанием.",
  enrollmentNoTariffs: "Нет активных тарифов. Сначала создайте тариф.",
  enrollmentFirstPayment: "Первая оплата",
  enrollmentBack: "Назад",
  enrollmentContinue: "Продолжить",
  enrollmentConfirm: "Подтвердить зачисление",
  enrollmentCreated: "Ребёнок зачислен в группу",
  enrollmentActionFailed:
    "Не удалось создать зачисление. Проверьте тариф и выбранное расписание.",
  familyEnrollments: "Постоянные занятия",
  familyEnrollChild: "Зачислить в группу",
  enrollmentNeedsAssignment: "Нужно назначить тариф и постоянные дни",
  enrollmentStarts: (date) => `Начало: ${date}`,
  enrollmentEnds: (date) => `До: ${date} включительно`,
  enrollmentScheduled: "Запланировано",
  enrollmentEnded: "Завершено",
  enrollmentManage: "Управлять",
  enrollmentManagementTitle: "Управление зачислением",
  enrollmentManagementDescription: (group) =>
    `Статус и будущий тариф для группы «${group}».`,
  enrollmentManagementFailed:
    "Не удалось изменить зачисление. Обновите карточку и попробуйте ещё раз.",
  enrollmentUpdated: "Зачисление обновлено",
  enrollmentCurrentTariff: "Текущий тариф",
  enrollmentChangeTariff: "Сменить тариф",
  enrollmentChangeTariffTitle: "Смена тарифа",
  enrollmentChangeTariffDescription:
    "Выберите новый тариф и дату перехода. История прежнего тарифа и оплат сохранится.",
  enrollmentEffectiveDate: "Дата перехода",
  enrollmentEffectiveDateHint:
    "По умолчанию выбран следующий расчётный день. При необходимости можно перейти раньше.",
  enrollmentNewTariff: "Новый тариф",
  enrollmentNewPayment: (amount, date) =>
    `Новая ожидаемая оплата: ${amount} · ${date}`,
  enrollmentFuturePaymentReplaced:
    "Ожидаемая оплата прежнего тарифа на эту дату или позже будет отменена и останется в истории.",
  enrollmentConfirmTariffChange: "Подтвердить переход",
  enrollmentTariffChanged: "Переход на новый тариф запланирован",
  enrollmentSelectTariff: "Выберите новый тариф",
  enrollmentNoCompatibleTariffs: "Нет подходящих активных тарифов",
  enrollmentTariffFutureOnly:
    "Новый тариф применяется только к ещё не созданным оплатам.",
  enrollmentPause: "Приостановить",
  enrollmentResume: "Возобновить",
  enrollmentEnd: "Завершить зачисление",
  enrollmentEndTitle: "Завершить зачисление",
  enrollmentEndDescription:
    "Ребёнок останется в группе до выбранной даты включительно. История занятий и оплат сохранится.",
  enrollmentEndDate: "Последний день в группе",
  enrollmentCancelExpectedPayment: "Отменить ожидаемую оплату",
  enrollmentCancelExpectedPaymentHint:
    "Оплата сохранится в истории как отменённая. Оплаченные операции не изменятся.",
  enrollmentConfirmEnd: "Завершить зачисление",
  enrollmentEndedSuccess: "Дата завершения зачисления сохранена",
  enrollmentEndWarning:
    "Уже созданные оплаты сохранятся без изменений. При необходимости отмените их отдельно в очереди оплат.",
  ...ruPaymentMessages,
  requestsTitle: "Заявки",
  requestsDescription:
    "Новые записи, запросы на перенос и заявки, которым нужно внимание.",
  requestSearch: "Найти по ребёнку, родителю или телефону",
  requestFilterAll: "Все",
  requestFilterAttention: "Нужно внимание",
  requestFilterPending: "Новые",
  requestFilterConfirmed: "Подтверждённые",
  requestFilterProcessed: "Завершённые",
  noRequestsTitle: "Заявок пока нет",
  noRequestsDescription: "Новые записи из формы и мессенджеров появятся здесь.",
  requestStatusPending: "Ждёт подтверждения",
  requestStatusConfirmed: "Подтверждена",
  requestStatusRejected: "Отклонена",
  requestStatusCancelledByParent: "Отменена родителем",
  requestStatusCancelledByCenter: "Отменена центром",
  requestStatusIntakeNew: "Нужно подобрать",
  requestStatusIntakeConverted: "Преобразована в запись",
  requestStatusIntakeClosed: "Закрыта",
  requestNeedsLesson: "Нужно подобрать занятие",
  requestTransferPending: "Запрошен перенос",
  requestPossibleDuplicate: "Возможный дубль клиента",
  requestConfirm: "Подтвердить",
  requestReject: "Отклонить",
  requestConfirmed: "Заявка подтверждена",
  requestRejected: "Заявка отклонена",
  requestMessengerQueued: "Сообщение родителю поставлено в очередь отправки.",
  requestStaffCallQueued: "Создана задача связаться с родителем по телефону.",
  requestSourceBookingCore: "Booking Core · сервер",
  requestLoadMore: "Загрузить ещё",
  requestLoadingMore: "Загружаем…",
  requestOpenFamily: "Открыть семью",
  clientsTitle: "Клиенты",
  clientsDescription:
    "Семьи, представители, дети и история записей в одном месте.",
  clientSearch: "Найти семью, ребёнка, представителя или телефон",
  clientAddFamily: "Добавить семью",
  clientsServerReadOnly:
    "Каталог загружен из операционной базы. Создание и изменения выполняются серверными командами с журналом событий.",
  noClientsTitle: "Клиентов пока нет",
  noClientsDescription:
    "Семья появится после первой заявки или ручного добавления.",
  family: "Семья",
  familyRepresentatives: "Представители",
  familyChildren: "Дети",
  familyHistory: "История записей",
  familyPrimaryContact: "Основной контакт",
  familyBookingsCount: (count) => `Записей: ${count}`,
  familyActiveEnrollmentsCount: (count) => `Активных занятий: ${count}`,
  familyLastActivity: "Последняя активность",
  familyPossibleDuplicate: "Нужно проверить возможный дубль",
  familyNotFoundTitle: "Семья не найдена",
  familyNotFoundDescription:
    "Возможно, карточка была удалена или ссылка относится к другой организации.",
  familySourceBookingCore: "Booking Core · сервер",
  familyServerReadOnly:
    "Карточка загружена из операционной базы. Изменения семьи, представителей, детей и постоянных зачислений сохраняются серверными командами с аудитом.",
  familyVerifiedMessenger: "Мессенджер подтверждён",
  familyNoEnrollments: "Постоянных занятий пока нет.",
  familyEnrollmentPaused: "Приостановлено",
  familyEnrollmentEnded: "Завершено",
  familyHistoryTruncated:
    "Показаны последние 200 записей. Более ранняя история сохранена в Booking Core.",
  createFamilyTitle: "Новая семья",
  createFamilyDescription:
    "Добавьте основной контакт и первого ребёнка. Остальные данные можно внести позже.",
  familyCreated: "Семья добавлена",
  editRepresentativeTitle: "Редактировать представителя",
  addRepresentativeTitle: "Новый представитель",
  representativeSaved: "Данные представителя сохранены",
  editChildTitle: "Редактировать ребёнка",
  addChildTitle: "Новый ребёнок",
  childSaved: "Данные ребёнка сохранены",
  invalidPhone: "Укажите корректный номер телефона",
  invalidBirthDate: "Укажите корректную дату рождения",
  familyArchiveTitle: (name) => `Архивировать «${name}»?`,
  familyArchiveDescription:
    "История и записи сохранятся, семья исчезнет из списка активных клиентов.",
  familyArchived: "Семья перемещена в архив",
  familyRestored: "Семья восстановлена",
  familyName: "Название семьи",
  editFamilyNameTitle: "Изменить название семьи",
  editFamilyNameDescription:
    "Название используется в списке клиентов, заявках и оплатах.",
  representativeName: "Имя представителя",
  representativeFirstName: "Имя представителя",
  representativeLastName: "Фамилия представителя",
  representativePhone: "Телефон",
  representativeChannel: "Канал связи",
  childName: "Имя ребёнка",
  childBirthDate: "Дата рождения",
  childNote: "Заметка",
  addRepresentative: "Добавить представителя",
  addChild: "Добавить ребёнка",
  lessonRosterTitle: "Кто придёт",
  lessonRosterExpected: (count) => `Ожидается: ${count}`,
  lessonRosterEmpty: "На это занятие пока никто не записан.",
  lessonRosterPending: "Ожидает подтверждения",
  lessonRosterConfirmed: "Подтверждён",
  lessonRosterPermanent: "Постоянный",
  lessonRosterTrial: "Пробное",
  lessonRosterSingle: "Разовое",
  lessonAddParticipant: "Добавить участника",
  lessonAddParticipantTitle: "Добавить на занятие",
  lessonAddParticipantDescription:
    "Выберите ребёнка из клиентской базы или создайте новую карточку.",
  participantExistingClient: "Из базы клиентов",
  participantNewClient: "Новый клиент",
  participantSearch: "Имя ребёнка, родителя или телефон",
  participantSearchEmpty: "Подходящие клиенты не найдены.",
  participantVisitKind: "Тип посещения",
  participantVisitTrial: "Пробное",
  participantVisitSingle: "Разовое",
  participantNoVisitKinds:
    "Для этого занятия не разрешены пробные или разовые посещения.",
  participantAdd: "Добавить",
  participantAdded: "Участник добавлен на занятие",
  participantAttendancePresent: "Пришёл",
  participantAttendanceAbsent: "Не пришёл",
  participantActionFailed:
    "Не удалось выполнить действие. Проверьте данные и попробуйте ещё раз.",
  weekdayNames: {
    monday: "Понедельник",
    tuesday: "Вторник",
    wednesday: "Среда",
    thursday: "Четверг",
    friday: "Пятница",
    saturday: "Суббота",
    sunday: "Воскресенье",
  },
};

const messagesByLanguage: Partial<Record<string, BookingAdminMessages>> = {
  en: EN_BOOKING_ADMIN_MESSAGES,
  ru,
};

function bookingLanguage(locale: string): string {
  try {
    const canonical = Intl.getCanonicalLocales(locale)[0] ?? "ru-RU";
    return new Intl.Locale(canonical).language;
  } catch {
    return "ru";
  }
}

export function getBookingAdminMessages(locale: string): BookingAdminMessages {
  const interfaceLocale = loadAirHopLocale() ?? locale;
  return (
    messagesByLanguage[bookingLanguage(interfaceLocale)] ??
    EN_BOOKING_ADMIN_MESSAGES
  );
}
