import type { AirHopLocale } from "@/shared/locale/airhopLocale";

export const AIRHOP_SETTING_IDS = Object.freeze([
  "appearance",
  "profile",
  "notifications",
  "shortcuts",
  "agents",
  "community-members",
  "custom-emoji",
  "mobile",
  "updates",
] as const);

export type AirHopSettingsSection = (typeof AIRHOP_SETTING_IDS)[number];

export const DEFAULT_AIRHOP_SETTINGS_SECTION: AirHopSettingsSection =
  "appearance";

type SettingsCopy = Readonly<{
  labels: Record<AirHopSettingsSection, string>;
  groups: Readonly<{ personal: string; center: string; app: string }>;
  back: string;
  checkingAccess: string;
  accessError: string;
  retry: string;
  accessUnavailable: string;
  groupAria: (group: string) => string;
}>;

const COPY: Record<AirHopLocale, SettingsCopy> = {
  "ru-RU": {
    labels: {
      appearance: "Внешний вид",
      profile: "Профиль",
      notifications: "Уведомления",
      shortcuts: "Сочетания клавиш",
      agents: "AI-агенты",
      "community-members": "Сотрудники",
      "custom-emoji": "Свои эмодзи",
      mobile: "Мобильное приложение",
      updates: "Обновления",
    },
    groups: { personal: "Личное", center: "Центр", app: "Приложение" },
    back: "Назад в приложение",
    checkingAccess: "Проверяем права на приглашения…",
    accessError: "Не удалось проверить настройки приглашений.",
    retry: "Повторить",
    accessUnavailable:
      "Настройки приглашений недоступны. Возможно, подключение ещё восстанавливается.",
    groupAria: (group) => `Разделы настроек: ${group}`,
  },
  "en-US": {
    labels: {
      appearance: "Appearance",
      profile: "Profile",
      notifications: "Notifications",
      shortcuts: "Keyboard shortcuts",
      agents: "AI agents",
      "community-members": "Employees",
      "custom-emoji": "Custom emoji",
      mobile: "Mobile app",
      updates: "Updates",
    },
    groups: { personal: "Personal", center: "Center", app: "App" },
    back: "Back to app",
    checkingAccess: "Checking invite permissions…",
    accessError: "Invite settings could not be checked.",
    retry: "Try again",
    accessUnavailable:
      "Invite settings are unavailable. The connection may still be recovering.",
    groupAria: (group) => `${group} settings sections`,
  },
  "tr-TR": {
    labels: {
      appearance: "Görünüm",
      profile: "Profil",
      notifications: "Bildirimler",
      shortcuts: "Klavye kısayolları",
      agents: "AI temsilcileri",
      "community-members": "Çalışanlar",
      "custom-emoji": "Özel emojiler",
      mobile: "Mobil uygulama",
      updates: "Güncellemeler",
    },
    groups: { personal: "Kişisel", center: "Merkez", app: "Uygulama" },
    back: "Uygulamaya dön",
    checkingAccess: "Davet izinleri kontrol ediliyor…",
    accessError: "Davet ayarları kontrol edilemedi.",
    retry: "Tekrar dene",
    accessUnavailable:
      "Davet ayarları kullanılamıyor. Bağlantı hâlâ yeniden kuruluyor olabilir.",
    groupAria: (group) => `${group} ayar bölümleri`,
  },
  "pt-BR": {
    labels: {
      appearance: "Aparência",
      profile: "Perfil",
      notifications: "Notificações",
      shortcuts: "Atalhos de teclado",
      agents: "Agentes de IA",
      "community-members": "Funcionários",
      "custom-emoji": "Emojis personalizados",
      mobile: "Aplicativo móvel",
      updates: "Atualizações",
    },
    groups: { personal: "Pessoal", center: "Centro", app: "Aplicativo" },
    back: "Voltar ao aplicativo",
    checkingAccess: "Verificando permissões de convite…",
    accessError: "Não foi possível verificar as configurações de convite.",
    retry: "Tentar novamente",
    accessUnavailable:
      "As configurações de convite estão indisponíveis. A conexão ainda pode estar sendo restaurada.",
    groupAria: (group) => `Seções de configuração: ${group}`,
  },
};

export function isAirHopSettingsSection(
  value: unknown,
): value is AirHopSettingsSection {
  return (
    typeof value === "string" &&
    (AIRHOP_SETTING_IDS as readonly string[]).includes(value)
  );
}

export function resolveAirHopSettingsSection(
  value: unknown,
): AirHopSettingsSection {
  return isAirHopSettingsSection(value)
    ? value
    : DEFAULT_AIRHOP_SETTINGS_SECTION;
}

export function airHopSettingsCopy(locale: AirHopLocale): SettingsCopy {
  return COPY[locale];
}
