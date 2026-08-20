import { openUrl } from "@tauri-apps/plugin-opener";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { useUpdaterContext } from "./hooks/UpdaterProvider";
import { Button } from "@/shared/ui/button";
import {
  SettingsOptionGroup,
  SettingsOptionRow,
} from "./ui/SettingsOptionGroup";
import { SettingsSectionHeader } from "./ui/SettingsSectionHeader";
export function UpdateChecker() {
  const isRussian = useAirHopLocale() === "ru-RU";
  const copy = isRussian
    ? {
        title: "Обновления",
        description: "Получайте новые возможности и исправления AirHop.",
        status: "Состояние обновления",
        checkHint: "Проверить, доступна ли новая версия.",
        check: "Проверить обновления",
        checking: "Проверяем обновления…",
        latest: "У вас установлена последняя версия.",
        again: "Проверить снова",
        unavailable:
          "Автоматические обновления недоступны в этой сборке. Последнюю версию можно установить вручную.",
        available: (version: string) => `Доступно обновление — v${version}`,
        linux:
          "Эта сборка Linux не поддерживает обновление внутри приложения. Скачайте новую версию на странице релизов.",
        appImage: "Для автоматических обновлений используйте сборку AppImage.",
        download: "Скачать обновление",
        preparing: "Подготавливаем обновление…",
        downloading: "Скачиваем обновление…",
        installing: "Устанавливаем обновление…",
        ready: "Обновление загружено и готово к установке.",
        install: "Установить сейчас",
        failed: (message: string) => `Не удалось обновить: ${message}`,
        retry: "Повторить",
      }
    : {
        title: "Software updates",
        description:
          "Keep AirHop up to date with the latest features and fixes.",
        status: "Update status",
        checkHint: "Check if a new version is available.",
        check: "Check for updates",
        checking: "Checking for updates…",
        latest: "You're on the latest version.",
        again: "Check again",
        unavailable:
          "Automatic updates aren't available on this build. Download the latest release manually.",
        available: (version: string) => `Update available — v${version}`,
        linux:
          "In-app updates aren't supported on this Linux package. Download the new version from the release page.",
        appImage: "Switch to the AppImage build for automatic updates.",
        download: "Download update",
        preparing: "Preparing update…",
        downloading: "Downloading update…",
        installing: "Installing update…",
        ready: "Update downloaded and ready to install.",
        install: "Update now",
        failed: (message: string) => `Update failed: ${message}`,
        retry: "Retry",
      };
  const { status, checkForUpdate, installAndRelaunch } = useUpdaterContext();

  return (
    <section className="min-w-0" data-testid="settings-updates">
      <SettingsSectionHeader
        title={copy.title}
        description={copy.description}
      />

      <SettingsOptionGroup>
        {status.state === "idle" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">{copy.status}</p>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.checkHint}
              </p>
            </div>
            <Button size="sm" onClick={checkForUpdate}>
              {copy.check}
            </Button>
          </SettingsOptionRow>
        )}

        {status.state === "checking" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">{copy.status}</p>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.checking}
              </p>
            </div>
          </SettingsOptionRow>
        )}

        {status.state === "up-to-date" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">{copy.status}</p>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.latest}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={checkForUpdate}>
              {copy.again}
            </Button>
          </SettingsOptionRow>
        )}

        {status.state === "unavailable" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">{copy.status}</p>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.unavailable}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={checkForUpdate}>
              {copy.again}
            </Button>
          </SettingsOptionRow>
        )}

        {status.state === "manual-required" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {copy.available(status.version)}
              </p>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.linux}{" "}
                <span className="text-muted-foreground">{copy.appImage}</span>
              </p>
            </div>
            <Button size="sm" onClick={() => void openUrl(status.releaseUrl)}>
              {copy.download}
            </Button>
          </SettingsOptionRow>
        )}

        {status.state === "available" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">{copy.status}</p>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.preparing}
              </p>
            </div>
          </SettingsOptionRow>
        )}

        {status.state === "downloading" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">{copy.status}</p>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.downloading}
              </p>
            </div>
          </SettingsOptionRow>
        )}

        {status.state === "installing" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">{copy.status}</p>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.installing}
              </p>
            </div>
          </SettingsOptionRow>
        )}

        {status.state === "ready" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">{copy.status}</p>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.ready}
              </p>
            </div>
            <Button size="sm" onClick={installAndRelaunch}>
              {copy.install}
            </Button>
          </SettingsOptionRow>
        )}

        {status.state === "error" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">{copy.status}</p>
              <p className="text-sm font-normal text-destructive">
                {copy.failed(status.message)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={checkForUpdate}>
              {copy.retry}
            </Button>
          </SettingsOptionRow>
        )}
      </SettingsOptionGroup>
    </section>
  );
}
