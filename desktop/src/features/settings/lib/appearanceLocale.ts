import type { AirHopLocale } from "@/shared/locale/airhopLocale";

export type AppearanceMessages = Readonly<{
  title: string;
  description: string;
  centerTarget: string;
  widgetTarget: string;
  systemMode: string;
  widgetAutomatic: string;
  widgetLight: string;
  widgetDark: string;
  lightMode: string;
  darkMode: string;
  accentColor: string;
  threadLayout: string;
  threadFocus: string;
  threadFocusDescription: string;
  threadSplit: string;
  threadSplitDescription: string;
  widgetDescription: string;
  widgetPreview: string;
  widgetSave: string;
  widgetSaving: string;
  widgetSaved: string;
  widgetHeading: string;
  widgetStep: string;
  widgetAge: string;
}>;

const EN: AppearanceMessages = {
  title: "Appearance",
  description: "Choose how Airhop Center and the booking widget look.",
  centerTarget: "Airhop Center",
  widgetTarget: "Booking widget",
  systemMode: "System",
  widgetAutomatic: "Follow Airhop",
  widgetLight: "Light",
  widgetDark: "Dark",
  lightMode: "Light",
  darkMode: "Dark",
  accentColor: "Accent color",
  threadLayout: "Thread layout",
  threadFocus: "Focus",
  threadFocusDescription: "Threads open over the channel, full width",
  threadSplit: "Split",
  threadSplitDescription: "Threads open in a side panel next to the channel",
  widgetDescription:
    "Set the booking widget to follow Airhop or always use a light or dark canvas.",
  widgetPreview: "Preview",
  widgetSave: "Save changes",
  widgetSaving: "Saving…",
  widgetSaved: "Saved",
  widgetHeading: "Online booking",
  widgetStep: "Step 1 of 5",
  widgetAge: "Select the child's age",
};

const RU: AppearanceMessages = {
  title: "Внешний вид",
  description: "Настройте оформление Airhop Center и виджета записи.",
  centerTarget: "Airhop Center",
  widgetTarget: "Виджет записи",
  systemMode: "Системная",
  widgetAutomatic: "Как в Airhop",
  widgetLight: "Светлый",
  widgetDark: "Тёмный",
  lightMode: "Светлая",
  darkMode: "Тёмная",
  accentColor: "Акцентный цвет",
  threadLayout: "Отображение обсуждений",
  threadFocus: "Фокус",
  threadFocusDescription: "Обсуждения открываются поверх канала на всю ширину",
  threadSplit: "Рядом",
  threadSplitDescription: "Обсуждения открываются рядом с каналом",
  widgetDescription:
    "Виджет может повторять оформление Airhop или всегда оставаться светлым либо тёмным.",
  widgetPreview: "Предпросмотр",
  widgetSave: "Сохранить изменения",
  widgetSaving: "Сохраняем…",
  widgetSaved: "Сохранено",
  widgetHeading: "Онлайн-запись",
  widgetStep: "Шаг 1 из 5",
  widgetAge: "Выберите возраст ребёнка",
};

export function getAppearanceMessages(
  locale: AirHopLocale,
): AppearanceMessages {
  return locale === "ru-RU" ? RU : EN;
}
