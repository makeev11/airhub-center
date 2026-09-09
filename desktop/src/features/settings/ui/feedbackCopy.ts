const ru: Record<string, string> = {
  "Send feedback": "Отправить отзыв",
  "Sending…": "Отправляем…",
  Close: "Закрыть",
  Bug: "Ошибка",
  Praise: "Понравилось",
  "Needs work": "Можно улучшить",
  "Tell us what went wrong, or share general feedback.":
    "Расскажите, что случилось или что можно улучшить.",
  "View attached image": "Посмотреть изображение",
  Attached: "Вложение",
  "Attached image": "Прикреплённое изображение",
  "Remove attachment": "Удалить вложение",
  "Attach image": "Добавить изображение",
  "Attaching…": "Загружаем…",
  "Attach diagnostics": "Добавить технические сведения",
  Cancel: "Отмена",
  "Failed to attach image.": "Не удалось добавить изображение.",
  "Failed to send feedback.": "Не удалось отправить отзыв.",
  "Includes capture time, app version, platform, user agent, and language. No application log lines are collected.":
    "Будут добавлены время, версия приложения, платформа, сведения о браузере и язык. Журнал работы приложения не собирается.",
  "Feedback is saved on your center’s server for its server administrators, not posted to a channel. Images are uploaded as soon as you attach them, before sending the feedback.":
    "Отзыв сохраняется на сервере вашего центра и доступен администраторам сервера. В каналы он не публикуется. Изображения загружаются сразу при добавлении, ещё до отправки отзыва.",
};
export function feedbackText(text: string, isRussian: boolean): string {
  return isRussian ? (ru[text] ?? text) : text;
}
