export function getAnimatedAvatarCaptureCopy(isRussian: boolean) {
  return isRussian
    ? {
        iphoneCameraError:
          "Камера iPhone не найдена. Убедитесь, что Continuity Camera доступна, и попробуйте ещё раз.",
        cameraAccessError:
          "Не удалось получить доступ к камере. Проверьте разрешение AirHop на использование камеры и попробуйте ещё раз.",
        recordingFailed: "Не удалось записать видео. Попробуйте ещё раз.",
        noFrames: "Не записано ни одного кадра.",
        relayRejected: "Центр отклонил запись. Попробуйте ещё раз.",
        uploadFailed: "Не удалось загрузить анимированный аватар.",
        reviewWarning:
          "Не удалось загрузить модель удаления фона, поэтому фон сохранён. Подключитесь к интернету и переснимите, чтобы убрать его.",
        liveHelp: "Расположитесь в кадре.",
        recordingHelp: "Идёт запись… Постарайтесь не двигаться.",
        processingHelp: "Убираем фон…",
        hoverToPlay: "Наведите, чтобы воспроизвести",
        previewLabel:
          "Предпросмотр аватара — перетащите или используйте стрелки для позиционирования",
        startingCamera: "Запускаем камеру",
        processingRecording: "Обрабатываем запись",
        personSizeTip: "Настройте размер и положение в кадре.",
        reviewHelp: "Выберите стоп-кадр, который будет виден до наведения.",
        uploading: "Загружаем анимированный аватар",
        useAvatar: "Использовать как аватар",
        recordingError: (_error: unknown) =>
          "Не удалось записать видео. Попробуйте ещё раз.",
        uploadError: (_error: unknown) =>
          "Не удалось загрузить анимированный аватар.",
      }
    : {
        iphoneCameraError:
          "Could not find an iPhone camera. Make sure Continuity Camera is available, then try again.",
        cameraAccessError:
          "Could not access the camera. Check AirHop's camera permission and try again.",
        recordingFailed: "Recording failed. Try again.",
        noFrames: "No frames were recorded.",
        relayRejected: "The Center rejected the recording. Try again.",
        uploadFailed: "Could not upload the animated avatar.",
        reviewWarning:
          "Background removal model couldn't be loaded, so the background was kept. Retake while online to remove it.",
        liveHelp: "Line up your shot.",
        recordingHelp: "Recording... hold still-ish.",
        processingHelp: "Removing the background...",
        hoverToPlay: "Hover to play",
        previewLabel: "Avatar preview — drag or use arrow keys to position",
        startingCamera: "Starting camera",
        processingRecording: "Processing recording",
        personSizeTip: "Adjust your size and position in the frame.",
        reviewHelp: "Pick the still shown before hover.",
        uploading: "Uploading animated avatar",
        useAvatar: "Use as avatar",
        recordingError: (error: unknown) =>
          error instanceof Error
            ? error.message
            : "Recording failed. Try again.",
        uploadError: (error: unknown) =>
          error instanceof Error
            ? error.message
            : "Could not upload the animated avatar.",
      };
}
