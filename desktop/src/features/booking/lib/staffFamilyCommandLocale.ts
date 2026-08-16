export type StaffFamilyCommandMessages = {
  channelPhone: string;
  channelNone: string;
  saveConflict: string;
  saveError: string;
  editFamily: string;
  memberArchiveTitle: (name: string) => string;
  memberRestoreTitle: (name: string) => string;
  representativeArchiveDescription: string;
  childArchiveDescription: string;
  memberRestoreDescription: string;
  memberArchived: string;
  memberRestored: string;
  makePrimary: string;
  makePrimaryTitle: (name: string) => string;
  makePrimaryDescription: string;
  primaryChanged: string;
};

const russianMessages: StaffFamilyCommandMessages = {
  channelPhone: "Телефон",
  channelNone: "Не выбран",
  saveConflict:
    "Карточка уже изменилась. Обновите данные и повторите сохранение.",
  saveError:
    "Не удалось сохранить изменения. Проверьте данные и повторите попытку.",
  editFamily: "Изменить семью",
  memberArchiveTitle: (name) => `Архивировать «${name}»?`,
  memberRestoreTitle: (name) => `Восстановить «${name}»?`,
  representativeArchiveDescription:
    "Контакт и история сохранятся. Основной контакт и представителя с будущими записями архивировать нельзя.",
  childArchiveDescription:
    "История сохранится. Сначала завершите или отмените активные занятия и будущие записи ребёнка.",
  memberRestoreDescription:
    "Участник снова станет доступен для новых записей и операций.",
  memberArchived: "Участник перемещён в архив",
  memberRestored: "Участник восстановлен",
  makePrimary: "Сделать основным",
  makePrimaryTitle: (name) => `Сделать «${name}» основным контактом?`,
  makePrimaryDescription:
    "Новые операции семьи будут использовать этот контакт по умолчанию. История прежнего основного контакта сохранится.",
  primaryChanged: "Основной контакт изменён",
};

/** Returns staff-command copy independently from the demo workspace model. */
export function getStaffFamilyCommandMessages(
  _locale: string,
): StaffFamilyCommandMessages {
  return russianMessages;
}
