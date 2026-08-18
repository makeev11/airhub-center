export type BookingPaymentMessages = {
  paymentsBuzzChannel: string;
  paymentsBuzzChannelHint: string;
  paymentsBuzzChannelNone: string;
  paymentExpected: string;
  paymentOverdue: string;
  paymentPaid: string;
  paymentCancelled: string;
  paymentDueSummary: (amount: string, date: string) => string;
  paymentsTitle: string;
  paymentsDescription: string;
  analyticsTitle: string;
  analyticsDescription: string;
  analyticsAsOf: (date: string) => string;
  analyticsPaidThisMonth: string;
  analyticsOutstandingThisMonth: string;
  analyticsOpenTotal: (amount: string, count: string) => string;
  analyticsOverdueTotal: string;
  analyticsPaidShare: string;
  analyticsPaidShareHint: string;
  analyticsTrendTitle: string;
  analyticsTrendDescription: string;
  analyticsScheduled: string;
  analyticsPaymentsCount: (count: number) => string;
  analyticsNoDataTitle: string;
  analyticsNoDataDescription: string;
  analyticsPaymentsTab: string;
  analyticsFunnelTab: string;
  funnelAsOf: (date: string) => string;
  funnelCohort: string;
  funnelSource: string;
  funnelBranch: string;
  funnelAllSources: string;
  funnelAllBranches: string;
  funnelTrialBookings: string;
  funnelConfirmedTrials: string;
  funnelAttendedTrials: string;
  funnelPermanentEnrollments: string;
  funnelFirstPaymentsPaid: string;
  funnelShareOfCohort: string;
  funnelFirstPaymentAmount: string;
  funnelTrendTitle: string;
  funnelTrendDescription: string;
  funnelNoDataTitle: string;
  funnelNoDataDescription: string;
  funnelSourceLabel: (channel: string) => string;
  paymentFilterOpen: string;
  paymentFilterPaid: string;
  paymentFilterCancelled: string;
  paymentSearch: string;
  paymentNoOpenTitle: string;
  paymentNoOpenDescription: string;
  paymentNoHistoryTitle: string;
  paymentNoHistoryDescription: string;
  paymentFamily: string;
  paymentTariff: string;
  paymentGroup: string;
  paymentDueDate: string;
  paymentAmount: string;
  paymentMarkPaid: string;
  paymentChangeAmount: string;
  paymentMoveDueDate: string;
  paymentCancel: string;
  paymentRestore: string;
  paymentReopen: string;
  paymentPaidSuccess: string;
  paymentAmountUpdated: string;
  paymentDueDateUpdated: string;
  paymentCancelledSuccess: string;
  paymentRestoredSuccess: string;
  paymentActionFailed: string;
  paymentPaidTitle: string;
  paymentPaidDescription: string;
  paymentAmountTitle: string;
  paymentAmountDescription: string;
  paymentDueDateTitle: string;
  paymentDueDateDescription: string;
  paymentCancelTitle: string;
  paymentCancelDescription: string;
  paymentRestoreTitle: string;
  paymentRestoreDescription: string;
  paymentCancelReason: string;
  paymentCancelReasonPlaceholder: string;
  paymentReasonRequired: string;
  paymentInvalidDueDate: string;
  paymentInvalidAmount: string;
  paymentConfirmPaid: string;
  paymentConfirmAmount: string;
  paymentConfirmDueDate: string;
  paymentConfirmCancel: string;
  paymentConfirmRestore: string;
  paymentActionSummary: (child: string, amount: string, date: string) => string;
};

export const ruPaymentMessages: BookingPaymentMessages = {
  paymentsBuzzChannel: "Канал оплат в Buzz",
  paymentsBuzzChannelHint:
    "Физ будет вести в этом канале ежемесячный тред с изменениями просроченных оплат.",
  paymentsBuzzChannelNone: "Не публиковать сводки",
  paymentExpected: "Ожидается",
  paymentOverdue: "Просрочено",
  paymentPaid: "Оплачено",
  paymentCancelled: "Отменено",
  paymentDueSummary: (amount, date) => `К оплате ${amount} · ${date}`,
  paymentsTitle: "Оплаты",
  paymentsDescription:
    "Рабочая очередь ожидаемых оплат и история решений сотрудников.",
  analyticsTitle: "Аналитика оплат",
  analyticsDescription:
    "Начисления, оплаты и просрочки по данным Booking Core.",
  analyticsAsOf: (date) => `Данные на ${date}`,
  analyticsPaidThisMonth: "Оплачено в этом месяце",
  analyticsOutstandingThisMonth: "Ожидается за этот месяц",
  analyticsOpenTotal: (amount, count) => `Всего открыто: ${amount} · ${count}`,
  analyticsOverdueTotal: "Просрочено всего",
  analyticsPaidShare: "Доля оплаченного",
  analyticsPaidShareHint: "От неотменённых начислений текущего месяца",
  analyticsTrendTitle: "Динамика за шесть месяцев",
  analyticsTrendDescription:
    "Расчётный месяц не меняется при переносе срока отдельной оплаты.",
  analyticsScheduled: "Начислено",
  analyticsPaymentsCount: (count) => {
    const lastTwo = count % 100;
    const last = count % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return `${count} оплат`;
    if (last === 1) return `${count} оплата`;
    if (last >= 2 && last <= 4) return `${count} оплаты`;
    return `${count} оплат`;
  },
  analyticsNoDataTitle: "Для аналитики пока нет данных",
  analyticsNoDataDescription:
    "Показатели появятся после создания первой ожидаемой оплаты.",
  analyticsPaymentsTab: "Оплаты",
  analyticsFunnelTab: "Воронка",
  funnelAsOf: (date) => `Когорты на ${date}`,
  funnelCohort: "Месяц заявки",
  funnelSource: "Источник",
  funnelBranch: "Филиал",
  funnelAllSources: "Все источники",
  funnelAllBranches: "Все филиалы",
  funnelTrialBookings: "Заявки на пробное",
  funnelConfirmedTrials: "Пробное подтверждено",
  funnelAttendedTrials: "Пробное посещено",
  funnelPermanentEnrollments: "Постоянное зачисление",
  funnelFirstPaymentsPaid: "Первая оплата",
  funnelShareOfCohort: "от заявок этой когорты",
  funnelFirstPaymentAmount: "Сумма первых оплат",
  funnelTrendTitle: "Когорты за шесть месяцев",
  funnelTrendDescription:
    "Каждая строка показывает путь от созданных заявок до первой оплаты.",
  funnelNoDataTitle: "В этой когорте пока нет пробных записей",
  funnelNoDataDescription:
    "Выберите другой месяц, источник или филиал либо дождитесь новых заявок.",
  funnelSourceLabel: (channel) =>
    ({
      website: "Сайт",
      phone: "Телефон",
      visit: "Визит",
      telegram: "Telegram",
      max: "MAX",
      whatsapp: "WhatsApp",
      buzz: "Buzz",
      other: "Другое",
    })[channel] ?? channel,
  paymentFilterOpen: "Нужно оплатить",
  paymentFilterPaid: "Оплачено",
  paymentFilterCancelled: "Отменено",
  paymentSearch: "Найти ребёнка, семью, группу или тариф",
  paymentNoOpenTitle: "Ожидающих оплат нет",
  paymentNoOpenDescription: "Новые оплаты появятся после зачисления в группу.",
  paymentNoHistoryTitle: "Здесь пока пусто",
  paymentNoHistoryDescription: "Оплаты с выбранным статусом появятся здесь.",
  paymentFamily: "Семья",
  paymentTariff: "Тариф",
  paymentGroup: "Группа",
  paymentDueDate: "Срок оплаты",
  paymentAmount: "Сумма",
  paymentMarkPaid: "Отметить оплату",
  paymentChangeAmount: "Изменить сумму",
  paymentMoveDueDate: "Перенести срок",
  paymentCancel: "Отменить оплату",
  paymentRestore: "Восстановить оплату",
  paymentReopen: "Снять отметку оплаты",
  paymentPaidSuccess: "Оплата отмечена",
  paymentAmountUpdated: "Сумма оплаты изменена",
  paymentDueDateUpdated: "Срок оплаты перенесён",
  paymentCancelledSuccess: "Оплата отменена",
  paymentRestoredSuccess: "Оплата восстановлена",
  paymentActionFailed:
    "Не удалось изменить оплату. Обновите данные и повторите.",
  paymentPaidTitle: "Подтвердить оплату",
  paymentPaidDescription:
    "После подтверждения оплата уйдёт из рабочей очереди в историю.",
  paymentAmountTitle: "Изменить сумму оплаты",
  paymentAmountDescription:
    "Изменение касается только этой оплаты и не меняет стоимость тарифа.",
  paymentDueDateTitle: "Перенести срок оплаты",
  paymentDueDateDescription:
    "Новый срок применяется только к этой оплате. Причина останется в журнале действий.",
  paymentCancelTitle: "Отменить оплату",
  paymentCancelDescription:
    "Оплата останется в истории, но больше не будет ожидаться от семьи.",
  paymentRestoreTitle: "Восстановить оплату",
  paymentRestoreDescription:
    "Оплата снова появится в рабочей очереди как ожидаемая или просроченная.",
  paymentCancelReason: "Внутренняя причина",
  paymentCancelReasonPlaceholder: "Например, ученик прекратил занятия",
  paymentReasonRequired: "Укажите внутреннюю причину.",
  paymentInvalidDueDate: "Укажите новый корректный срок оплаты.",
  paymentInvalidAmount: "Укажите корректную неотрицательную сумму.",
  paymentConfirmPaid: "Подтвердить оплату",
  paymentConfirmAmount: "Сохранить сумму",
  paymentConfirmDueDate: "Перенести срок",
  paymentConfirmCancel: "Отменить оплату",
  paymentConfirmRestore: "Восстановить",
  paymentActionSummary: (child, amount, date) =>
    `${child} · ${amount} · срок ${date}`,
};
