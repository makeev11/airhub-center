import {
  getShortcutsByCategory,
  getPlatformKeys,
  type KeyboardShortcut,
} from "@/shared/lib/keyboard-shortcuts";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

function KeyCombo({ shortcut }: { shortcut: KeyboardShortcut }) {
  const keys = getPlatformKeys(shortcut);
  // Split on "+" but keep "+" as a standalone key (e.g. for zoom-in "⌘+")
  const parts = keys
    .split(/(?<!\+)\+(?!\s*$)/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <span className="flex items-center gap-1">
      {parts.map((part) => (
        <kbd
          className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border/70 bg-muted/60 px-1.5 font-mono text-xs text-muted-foreground"
          key={part}
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}

export function KeyboardShortcutsCard() {
  const isRussian = useAirHopLocale() === "ru-RU";
  const categories = getShortcutsByCategory();
  const categoryLabels: Record<string, string> = {
    Navigation: "Навигация",
    Messages: "Сообщения",
    Formatting: "Форматирование",
    Zoom: "Масштаб",
  };
  const shortcutCopy: Record<string, [string, string]> = {
    "quick-search": ["Быстрый поиск", "Открыть окно поиска"],
    "browse-channels": ["Найти каналы", "Открыть список каналов"],
    "browse-dms": ["Новое личное сообщение", "Открыть новое сообщение"],
    "new-channel": ["Новый канал", "Открыть создание канала"],
    "open-settings": ["Настройки", "Открыть или закрыть настройки"],
    "go-back": ["Назад", "Перейти на предыдущую страницу"],
    "go-forward": ["Вперёд", "Перейти на следующую страницу"],
    "find-in-channel": ["Найти в канале", "Искать сообщения в текущем канале"],
    "go-home": ["Главная", "Перейти во входящие"],
    "toggle-sidebar": ["Боковая панель", "Показать или скрыть боковую панель"],
    "mark-current-read": [
      "Отметить прочитанным",
      "Отметить текущую переписку прочитанной",
    ],
    "mark-all-read": ["Прочитать всё", "Отметить все переписки прочитанными"],
    "zoom-in": ["Увеличить", "Увеличить масштаб интерфейса"],
    "zoom-out": ["Уменьшить", "Уменьшить масштаб интерфейса"],
    "zoom-reset": ["Сбросить масштаб", "Вернуть масштаб по умолчанию"],
    "send-message": ["Отправить сообщение", "Отправить текущее сообщение"],
    "new-line": ["Новая строка", "Добавить перенос строки в редакторе"],
    "publish-note": ["Опубликовать заметку", "Опубликовать текущую заметку"],
    "close-dialog": ["Закрыть окно", "Закрыть текущее окно или настройки"],
    "push-to-talk": [
      "Нажать и говорить",
      "Удерживать, чтобы включить микрофон",
    ],
    "format-bold": ["Полужирный", "Включить или выключить полужирный текст"],
    "format-italic": ["Курсив", "Включить или выключить курсив"],
    "format-strikethrough": [
      "Зачёркнутый",
      "Включить или выключить зачёркивание",
    ],
    "format-code": [
      "Код в строке",
      "Включить или выключить форматирование кода",
    ],
    "format-link": [
      "Вставить ссылку",
      "Добавить или изменить ссылку в редакторе",
    ],
  };

  return (
    <section className="min-w-0" data-testid="settings-shortcuts">
      <SettingsSectionHeader
        title={isRussian ? "Сочетания клавиш" : "Keyboard shortcuts"}
        description={
          isRussian
            ? "Все доступные сочетания клавиш. Изменить их пока нельзя."
            : "All available keyboard shortcuts. Shortcuts are read-only."
        }
      />

      <div className="space-y-4">
        {[...categories.entries()].map(([category, shortcuts]) => (
          <div key={category}>
            <h2 className="mb-2 text-lg font-semibold tracking-tight">
              {isRussian ? categoryLabels[category] : category}
            </h2>
            <SettingsOptionGroup>
              {shortcuts.map((shortcut) => (
                <SettingsOptionRow
                  className="min-h-12 px-3 py-2"
                  key={shortcut.id}
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground">
                      {isRussian
                        ? (shortcutCopy[shortcut.id]?.[0] ?? shortcut.label)
                        : shortcut.label}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      {isRussian
                        ? (shortcutCopy[shortcut.id]?.[1] ??
                          shortcut.description)
                        : shortcut.description}
                    </span>
                  </div>
                  <KeyCombo shortcut={shortcut} />
                </SettingsOptionRow>
              ))}
            </SettingsOptionGroup>
          </div>
        ))}
      </div>
    </section>
  );
}
