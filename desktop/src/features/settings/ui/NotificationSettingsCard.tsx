import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import type {
  DesktopNotificationPermissionState,
  NotificationSettings,
} from "@/features/notifications/hooks";
import {
  COMING_SOON_SLOTS,
  RECOMMENDED_SOUND_BY_SLOT,
  SLOT_DESCRIPTIONS,
  SLOT_LABELS,
  SOUND_SLOTS,
  type SoundName,
  type SoundSlot,
} from "@/features/notifications/lib/sound";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { SoundPicker } from "./SoundPicker";

export function NotificationSettingsCard({
  isUpdatingDesktopNotifications,
  notificationErrorMessage,
  notificationPermission,
  notificationSettings,
  onSetDesktopNotificationsEnabled,
  onSetAllSlotAlertsEnabled,
  onSetHomeBadgeEnabled,
  onSetSlotAlertsEnabled,
  onSetNotifyWhileViewing,
  onSetSoundForSlot,
}: {
  isUpdatingDesktopNotifications: boolean;
  notificationErrorMessage: string | null;
  notificationPermission: DesktopNotificationPermissionState;
  notificationSettings: NotificationSettings;
  onSetDesktopNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
  onSetAllSlotAlertsEnabled: (enabled: boolean) => void;
  onSetHomeBadgeEnabled: (enabled: boolean) => void;
  onSetSlotAlertsEnabled: (slot: SoundSlot, enabled: boolean) => void;
  onSetNotifyWhileViewing: (enabled: boolean) => void;
  onSetSoundForSlot: (slot: SoundSlot, name: SoundName) => void;
}) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const copy = isRussian
    ? {
        title: "Уведомления",
        description:
          "Уведомления на компьютере включены по умолчанию. Ниже можно выбрать, о чём сообщать.",
        unavailable: "Недоступно",
        blocked: "Заблокировано",
        on: "Включено",
        off: "Выключено",
        requesting: "Запрашиваем доступ…",
        desktopAlerts: "Уведомления на компьютере",
        desktopEnabled:
          "Системные уведомления включены для выбранных ниже событий.",
        desktopDisabled:
          "Разрешите системные уведомления, чтобы видеть новые упоминания и важные действия вне приложения.",
        notifyWhileViewing: "Уведомлять в открытом диалоге",
        notifyWhileViewingDescription:
          "Показывать уведомления и для личных сообщений в переписке, которая сейчас открыта.",
        sound: "Звук",
        soundDescription: "Воспроизводить звук для выбранных ниже событий.",
        comingSoon: "Скоро",
        showLess: "Свернуть",
        viewAll: "Показать все",
        homeBadge: "Счётчик во входящих",
        homeBadgeDescription:
          "Показывать в боковой панели количество упоминаний и действий, которые ждут ответа.",
        unsupported: "Системные уведомления недоступны в этой среде.",
        denied:
          "Системные уведомления заблокированы. Разрешите их в настройках компьютера.",
      }
    : {
        title: "Notifications",
        description:
          "Desktop alerts are on by default. Fine-tune what gets through below.",
        unavailable: "Unavailable",
        blocked: "Blocked",
        on: "On",
        off: "Off",
        requesting: "Requesting…",
        desktopAlerts: "Desktop alerts",
        desktopEnabled:
          "Native desktop alerts are enabled for the categories you have armed below.",
        desktopDisabled:
          "Request OS permission and surface new mentions or needs-action items outside the app.",
        notifyWhileViewing: "Notify while viewing",
        notifyWhileViewingDescription:
          "Also alert for direct messages in the conversation you have open.",
        sound: "Sound",
        soundDescription: "Alert with a sound for the events below.",
        comingSoon: "Coming soon",
        showLess: "Show less",
        viewAll: "View all",
        homeBadge: "Inbox badge",
        homeBadgeDescription:
          "Show an Inbox badge for mentions and needs-action items in the sidebar.",
        unsupported:
          "Desktop notifications are not supported in this environment.",
        denied:
          "Desktop notifications are blocked. Enable them in your system settings.",
      };
  const slotLabels: Record<SoundSlot, string> = isRussian
    ? {
        dm: "Личные сообщения",
        mention: "@Упоминания",
        thread_reply: "Ответы в обсуждениях",
        needs_action: "Нужны действия",
        job_accepted: "Агент принял задачу",
        job_progress: "Агент сообщил о ходе работы",
        job_result: "Агент завершил задачу",
        job_error: "Ошибка задачи агента",
      }
    : SLOT_LABELS;
  const slotDescriptions: Record<SoundSlot, string> = isRussian
    ? {
        dm: "Когда вам пишут личное сообщение.",
        mention: "Когда вас упоминают в канале.",
        thread_reply: "Когда отвечают в обсуждении, за которым вы следите.",
        needs_action: "Когда вас ждёт подтверждение или напоминание.",
        job_accepted: "Когда агент принимает задачу.",
        job_progress: "Когда агент сообщает о ходе работы.",
        job_result: "Когда агент завершает задачу.",
        job_error: "Когда задача агента завершается с ошибкой.",
      }
    : SLOT_DESCRIPTIONS;
  const permissionBlocked =
    notificationPermission === "denied" ||
    notificationPermission === "unsupported";
  // The parent Sound switch derives from its children: on when any live
  // event row is on, and toggling it bulk-sets every live row.
  const anyAlertsOn = SOUND_SLOTS.some(
    (slot) =>
      !COMING_SOON_SLOTS.has(slot) &&
      notificationSettings.slotAlertsEnabled[slot],
  );
  const [showComingSoon, setShowComingSoon] = useState(false);
  const visibleSlots = SOUND_SLOTS.filter(
    (slot) => showComingSoon || !COMING_SOON_SLOTS.has(slot),
  );

  return (
    <section className="min-w-0" data-testid="settings-notifications">
      <SettingsSectionHeader
        title={copy.title}
        description={copy.description}
      />

      <span className="sr-only" data-testid="notifications-desktop-state">
        {notificationPermission === "unsupported"
          ? copy.unavailable
          : notificationPermission === "denied"
            ? copy.blocked
            : notificationSettings.desktopEnabled
              ? copy.on
              : copy.off}
      </span>

      <div className="flex flex-col gap-4">
        <SettingsOptionGroup>
          <SettingsOptionRow>
            <div className="min-w-0">
              <label
                className="text-sm font-medium"
                htmlFor="desktop-alerts-switch"
              >
                {isUpdatingDesktopNotifications
                  ? copy.requesting
                  : copy.desktopAlerts}
              </label>
              <p className="text-sm font-normal text-muted-foreground">
                {notificationSettings.desktopEnabled
                  ? copy.desktopEnabled
                  : copy.desktopDisabled}
              </p>
            </div>
            <Switch
              checked={notificationSettings.desktopEnabled}
              data-testid="notifications-desktop-toggle"
              disabled={isUpdatingDesktopNotifications}
              id="desktop-alerts-switch"
              onCheckedChange={(checked) => {
                void onSetDesktopNotificationsEnabled(checked);
              }}
            />
          </SettingsOptionRow>

          <SettingsOptionRow>
            <div className="min-w-0">
              <label
                className="text-sm font-medium"
                htmlFor="notify-while-viewing-switch"
              >
                {copy.notifyWhileViewing}
              </label>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.notifyWhileViewingDescription}
              </p>
            </div>
            <Switch
              checked={
                notificationSettings.desktopEnabled &&
                notificationSettings.notifyWhileViewing
              }
              data-testid="notifications-notify-while-viewing-toggle"
              disabled={!notificationSettings.desktopEnabled}
              id="notify-while-viewing-switch"
              onCheckedChange={(checked) => {
                onSetNotifyWhileViewing(checked);
              }}
            />
          </SettingsOptionRow>
        </SettingsOptionGroup>

        {notificationSettings.desktopEnabled ? (
          <>
            <SettingsOptionGroup>
              <SettingsOptionRow>
                <div className="min-w-0">
                  <label
                    className="text-sm font-medium"
                    htmlFor="notification-sound-switch"
                  >
                    {copy.sound}
                  </label>
                  <p className="text-sm font-normal text-muted-foreground">
                    {copy.soundDescription}
                  </p>
                </div>
                <Switch
                  checked={anyAlertsOn}
                  data-testid="notifications-sound-toggle"
                  id="notification-sound-switch"
                  onCheckedChange={(checked) => {
                    onSetAllSlotAlertsEnabled(checked);
                  }}
                />
              </SettingsOptionRow>
            </SettingsOptionGroup>

            {anyAlertsOn ? (
              <>
                <SettingsOptionGroup>
                  {visibleSlots.map((slot) => {
                    const comingSoon = COMING_SOON_SLOTS.has(slot);
                    const alertsOn =
                      notificationSettings.slotAlertsEnabled[slot];
                    return (
                      <SettingsOptionRow
                        aria-disabled={comingSoon || undefined}
                        className={cn(
                          comingSoon && "cursor-not-allowed opacity-40",
                        )}
                        key={slot}
                      >
                        <div className="min-w-0">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {slotLabels[slot]}
                            {comingSoon ? (
                              <span className="rounded-full bg-muted/70 px-2 py-0.5 text-2xs font-normal uppercase tracking-wide text-muted-foreground">
                                {copy.comingSoon}
                              </span>
                            ) : null}
                          </span>
                          <p className="text-sm font-normal text-muted-foreground">
                            {slotDescriptions[slot]}
                          </p>
                        </div>
                        <span className="flex items-center gap-3">
                          <span
                            className={cn(
                              "transition-opacity duration-200",
                              !alertsOn && "pointer-events-none opacity-40",
                            )}
                          >
                            <SoundPicker
                              disabled={comingSoon || !alertsOn}
                              onChange={(next) => onSetSoundForSlot(slot, next)}
                              recommended={RECOMMENDED_SOUND_BY_SLOT[slot]}
                              value={notificationSettings.sounds[slot]}
                            />
                          </span>
                          <Switch
                            checked={alertsOn && !comingSoon}
                            data-testid={`notifications-alerts-enabled-${slot}`}
                            disabled={comingSoon}
                            id={`alerts-enabled-${slot}-switch`}
                            onCheckedChange={(checked) => {
                              onSetSlotAlertsEnabled(slot, checked);
                            }}
                          />
                        </span>
                      </SettingsOptionRow>
                    );
                  })}
                </SettingsOptionGroup>

                <div className="flex justify-center">
                  <Button
                    data-testid="notifications-toggle-coming-soon"
                    onClick={() => setShowComingSoon((current) => !current)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {showComingSoon ? (
                      <>
                        <ChevronUp className="h-4 w-4" />
                        {copy.showLess}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4" />
                        {copy.viewAll}
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        <SettingsOptionGroup>
          <SettingsOptionRow>
            <div className="min-w-0">
              <label
                className="text-sm font-medium"
                htmlFor="home-badge-switch"
              >
                {copy.homeBadge}
              </label>
              <p className="text-sm font-normal text-muted-foreground">
                {copy.homeBadgeDescription}
              </p>
            </div>
            <Switch
              checked={notificationSettings.homeBadgeEnabled}
              data-testid="notifications-home-badge-toggle"
              id="home-badge-switch"
              onCheckedChange={(checked) => {
                onSetHomeBadgeEnabled(checked);
              }}
            />
          </SettingsOptionRow>
        </SettingsOptionGroup>
      </div>

      {permissionBlocked && (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notificationPermission === "unsupported"
            ? copy.unsupported
            : copy.denied}
        </p>
      )}

      {notificationErrorMessage ? (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notificationErrorMessage}
        </p>
      ) : null}
    </section>
  );
}
