export type BookingPaymentMessages = {
  paymentsBuzzChannel: string;
  paymentsBuzzChannelHint: string;
  paymentsBuzzChannelNone: string;
  analyticsBuzzChannel: string;
  analyticsBuzzChannelHint: string;
  analyticsBuzzChannelNone: string;
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
  paymentReceived: string;
  paymentOutstanding: string;
  paymentHistory: string;
  paymentReceipt: string;
  paymentRefund: string;
  paymentRefundAction: string;
  paymentMethod: string;
  paymentMethodCash: string;
  paymentMethodCard: string;
  paymentMethodBankTransfer: string;
  paymentMethodOther: string;
  paymentNote: string;
  paymentNotePlaceholder: string;
  paymentRefundSuccess: string;
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
  paymentRefundTitle: string;
  paymentRefundDescription: string;
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
  paymentConfirmRefund: string;
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
  analyticsBuzzChannel: "Канал аналитики в Buzz",
  analyticsBuzzChannelHint:
    "Физ будет вести здесь отдельный месячный тред оплат и воронки, обновляя его только при изменениях.",
  analyticsBuzzChannelNone: "Не публиковать аналитику",
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
  paymentMarkPaid: "Подтвердить оплату",
  paymentReceived: "Получено",
  paymentOutstanding: "Осталось",
  paymentHistory: "История операций",
  paymentReceipt: "Оплата",
  paymentRefund: "Возврат",
  paymentRefundAction: "Оформить возврат",
  paymentMethod: "Способ оплаты",
  paymentMethodCash: "Наличные",
  paymentMethodCard: "Карта",
  paymentMethodBankTransfer: "Банковский перевод",
  paymentMethodOther: "Другое",
  paymentNote: "Заметка (необязательно)",
  paymentNotePlaceholder: "Например, номер перевода или комментарий",
  paymentRefundSuccess: "Возврат записан",
  paymentChangeAmount: "Изменить сумму",
  paymentMoveDueDate: "Перенести срок",
  paymentCancel: "Отменить начисление",
  paymentRestore: "Восстановить оплату",
  paymentReopen: "Снять отметку оплаты",
  paymentPaidSuccess: "Оплата отмечена",
  paymentAmountUpdated: "Сумма оплаты изменена",
  paymentDueDateUpdated: "Срок оплаты перенесён",
  paymentCancelledSuccess: "Начисление отменено",
  paymentRestoredSuccess: "Оплата восстановлена",
  paymentActionFailed:
    "Не удалось изменить оплату. Обновите данные и повторите.",
  paymentPaidTitle: "Подтвердить оплату",
  paymentPaidDescription:
    "После подтверждения оплата уйдёт из рабочей очереди в историю.",
  paymentRefundTitle: "Оформить возврат",
  paymentRefundDescription:
    "Возврат уменьшит полученную сумму и вернёт остаток в рабочую очередь.",
  paymentAmountTitle: "Изменить сумму оплаты",
  paymentAmountDescription:
    "Изменение касается только этой оплаты и не меняет стоимость тарифа.",
  paymentDueDateTitle: "Перенести срок оплаты",
  paymentDueDateDescription:
    "Новый срок применяется только к этой оплате. Причина останется в журнале действий.",
  paymentCancelTitle: "Отменить начисление",
  paymentCancelDescription:
    "Начисление останется в истории, но оплата больше не будет ожидаться от семьи. Ребёнок останется зачислен в группу.",
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
  paymentConfirmRefund: "Записать возврат",
  paymentConfirmCancel: "Отменить начисление",
  paymentConfirmRestore: "Восстановить",
  paymentActionSummary: (child, amount, date) =>
    `${child} · ${amount} · срок ${date}`,
};

export const enPaymentMessages: BookingPaymentMessages = {
  paymentsBuzzChannel: "Payments channel in Buzz",
  paymentsBuzzChannelHint:
    "Fizz will keep a monthly thread with overdue-payment changes in this channel.",
  paymentsBuzzChannelNone: "Do not publish summaries",
  analyticsBuzzChannel: "Analytics channel in Buzz",
  analyticsBuzzChannelHint:
    "Fizz will keep a separate monthly payments and funnel thread here, updating it only when the data changes.",
  analyticsBuzzChannelNone: "Do not publish analytics",
  paymentExpected: "Expected",
  paymentOverdue: "Overdue",
  paymentPaid: "Paid",
  paymentCancelled: "Cancelled",
  paymentDueSummary: (amount, date) => `Due ${amount} · ${date}`,
  paymentsTitle: "Payments",
  paymentsDescription:
    "Work queue for expected payments and a history of staff decisions.",
  analyticsTitle: "Payment analytics",
  analyticsDescription:
    "Charges, payments, and overdue balances from Booking Core.",
  analyticsAsOf: (date) => `As of ${date}`,
  analyticsPaidThisMonth: "Paid this month",
  analyticsOutstandingThisMonth: "Outstanding this month",
  analyticsOpenTotal: (amount, count) => `Open total: ${amount} · ${count}`,
  analyticsOverdueTotal: "Total overdue",
  analyticsPaidShare: "Paid share",
  analyticsPaidShareHint: "Of non-cancelled charges for the current month",
  analyticsTrendTitle: "Six-month trend",
  analyticsTrendDescription:
    "The billing month does not change when an individual due date moves.",
  analyticsScheduled: "Charged",
  analyticsPaymentsCount: (count) =>
    `${count} ${count === 1 ? "payment" : "payments"}`,
  analyticsNoDataTitle: "No analytics data yet",
  analyticsNoDataDescription:
    "Metrics will appear after the first expected payment is created.",
  analyticsPaymentsTab: "Payments",
  analyticsFunnelTab: "Funnel",
  funnelAsOf: (date) => `Cohorts as of ${date}`,
  funnelCohort: "Application month",
  funnelSource: "Source",
  funnelBranch: "Branch",
  funnelAllSources: "All sources",
  funnelAllBranches: "All branches",
  funnelTrialBookings: "Trial applications",
  funnelConfirmedTrials: "Trial confirmed",
  funnelAttendedTrials: "Trial attended",
  funnelPermanentEnrollments: "Permanent enrollment",
  funnelFirstPaymentsPaid: "First payment",
  funnelShareOfCohort: "of applications in this cohort",
  funnelFirstPaymentAmount: "First-payment amount",
  funnelTrendTitle: "Six-month cohorts",
  funnelTrendDescription:
    "Each row shows the path from an application to the first payment.",
  funnelNoDataTitle: "No trial applications in this cohort",
  funnelNoDataDescription:
    "Choose another month, source, or branch, or wait for new applications.",
  funnelSourceLabel: (channel) =>
    ({
      website: "Website",
      phone: "Phone",
      visit: "In-person visit",
      telegram: "Telegram",
      max: "MAX",
      whatsapp: "WhatsApp",
      buzz: "Buzz",
      other: "Other",
    })[channel] ?? channel,
  paymentFilterOpen: "Payment due",
  paymentFilterPaid: "Paid",
  paymentFilterCancelled: "Cancelled",
  paymentSearch: "Find a child, family, group, or plan",
  paymentNoOpenTitle: "No expected payments",
  paymentNoOpenDescription: "New payments appear after a group enrollment.",
  paymentNoHistoryTitle: "Nothing here yet",
  paymentNoHistoryDescription:
    "Payments with the selected status will appear here.",
  paymentFamily: "Family",
  paymentTariff: "Plan",
  paymentGroup: "Group",
  paymentDueDate: "Due date",
  paymentAmount: "Amount",
  paymentReceived: "Received",
  paymentOutstanding: "Outstanding",
  paymentHistory: "Transaction history",
  paymentReceipt: "Payment",
  paymentRefund: "Refund",
  paymentRefundAction: "Issue refund",
  paymentMethod: "Payment method",
  paymentMethodCash: "Cash",
  paymentMethodCard: "Card",
  paymentMethodBankTransfer: "Bank transfer",
  paymentMethodOther: "Other",
  paymentNote: "Note (optional)",
  paymentNotePlaceholder: "For example, transfer number or comment",
  paymentRefundSuccess: "Refund recorded",
  paymentMarkPaid: "Confirm payment",
  paymentChangeAmount: "Change amount",
  paymentMoveDueDate: "Move due date",
  paymentCancel: "Cancel charge",
  paymentRestore: "Restore payment",
  paymentReopen: "Mark as unpaid",
  paymentPaidSuccess: "Payment confirmed",
  paymentAmountUpdated: "Payment amount updated",
  paymentDueDateUpdated: "Due date updated",
  paymentCancelledSuccess: "Charge cancelled",
  paymentRestoredSuccess: "Payment restored",
  paymentActionFailed: "Could not update the payment. Refresh and try again.",
  paymentPaidTitle: "Confirm payment",
  paymentPaidDescription:
    "After confirmation, the payment moves from the work queue to history.",
  paymentAmountTitle: "Change payment amount",
  paymentRefundTitle: "Issue refund",
  paymentRefundDescription:
    "The refund reduces the received amount and returns the balance to the work queue.",
  paymentAmountDescription:
    "This changes only this payment and does not change the plan price.",
  paymentDueDateTitle: "Move payment due date",
  paymentDueDateDescription:
    "The new date applies only to this payment. The reason stays in the action log.",
  paymentCancelTitle: "Cancel charge",
  paymentCancelDescription:
    "The charge remains in history, but payment is no longer expected from the family.",
  paymentRestoreTitle: "Restore payment",
  paymentRestoreDescription:
    "The payment returns to the work queue as expected or overdue.",
  paymentCancelReason: "Internal reason",
  paymentCancelReasonPlaceholder: "For example, the student stopped attending",
  paymentReasonRequired: "Enter an internal reason.",
  paymentInvalidDueDate: "Enter a valid new due date.",
  paymentInvalidAmount: "Enter a valid non-negative amount.",
  paymentConfirmPaid: "Confirm payment",
  paymentConfirmAmount: "Save amount",
  paymentConfirmRefund: "Record refund",
  paymentConfirmDueDate: "Move due date",
  paymentConfirmCancel: "Cancel charge",
  paymentConfirmRestore: "Restore",
  paymentActionSummary: (child, amount, date) =>
    `${child} · ${amount} · due ${date}`,
};
