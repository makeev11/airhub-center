export function getProfileAvatarEditorCopy(isRussian: boolean) {
  return isRussian
    ? {
        pickerLegend: "Выбор изображения аватара",
        uploading: "Загружаем...",
        dropHere: "Перетащите изображение сюда",
        dragOrBrowse: "Перетащите или выберите",
        dropOr: "Перетащите или ",
        browse: "выберите файл",
        pasteUrl: "Вставьте URL",
        pasteImageUrl: "Вставьте URL изображения",
        uploadError: "Не удалось загрузить изображение. Попробуйте ещё раз.",
        customColor: "Выбрать собственный цвет аватара",
        chooseEmojiFirst: "Сначала выберите эмодзи",
        backgroundLabel: (swatch: string) => `Использовать фон ${swatch}`,
        savingAvatar: "Сохраняем аватар",
        saving: "Сохраняем",
        save: "Сохранить",
        done: "Готово",
      }
    : {
        pickerLegend: "Avatar image picker",
        uploading: "Uploading...",
        dropHere: "Drop image here",
        dragOrBrowse: "Drag or browse",
        dropOr: "Drop or ",
        browse: "browse",
        pasteUrl: "Paste a URL",
        pasteImageUrl: "Paste an image URL",
        uploadError: "Could not upload the image. Try again.",
        customColor: "Choose custom avatar color",
        chooseEmojiFirst: "Choose an emoji before custom avatar color",
        backgroundLabel: (swatch: string) => `Use ${swatch} background`,
        savingAvatar: "Saving avatar",
        saving: "Saving",
        save: "Save",
        done: "Done",
      };
}
