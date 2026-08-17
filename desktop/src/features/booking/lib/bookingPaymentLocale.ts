export type BookingPaymentMessages = {
  paymentExpected: string;
  paymentOverdue: string;
  paymentPaid: string;
  paymentCancelled: string;
  paymentDueSummary: (amount: string, date: string) => string;
  paymentsTitle: string;
  paymentsDescription: string;
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
  paymentExpected: "Ожидается",
  paymentOverdue: "Просрочено",
  paymentPaid: "Оплачено",
  paymentCancelled: "Отменено",
  paymentDueSummary: (amount, date) => `К оплате ${amount} · ${date}`,
  paymentsTitle: "Оплаты",
  paymentsDescription:
    "Рабочая очередь ожидаемых оплат и история решений сотрудников.",
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
