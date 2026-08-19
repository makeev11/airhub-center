import {
  AIRHOP_LOCALES,
  AIRHOP_LOCALE_STORAGE_KEY,
  isAirHopLocale,
  loadAirHopLocale,
  persistAirHopLocale,
  type AirHopLocale,
} from "@/shared/locale/airhopLocale";

export const AIRHOP_OWNER_LOCALES = AIRHOP_LOCALES;
export type AirHopOwnerLocale = AirHopLocale;
export const AIRHOP_OWNER_LOCALE_STORAGE_KEY = AIRHOP_LOCALE_STORAGE_KEY;

type AirHopOwnerCopy = Readonly<{
  setupTitle: string;
  chooseLanguage: string;
  connectTitle: string;
  connectHint: string;
  codeLabel: string;
  codePlaceholder: string;
  connect: string;
  changeLanguage: string;
  checkingCode: string;
  connecting: string;
  invalidCode: string;
  profileTitle: string;
  profileHint: string;
  nameLabel: string;
  namePlaceholder: string;
  next: string;
  back: string;
  retry: string;
  setupFailed: string;
}>;

const COPY: Record<AirHopOwnerLocale, AirHopOwnerCopy> = {
  "ru-RU": {
    setupTitle: "Настроим ваш центр",
    chooseLanguage: "Выберите язык",
    connectTitle: "Подключите ваш центр",
    connectHint: "Введите код организации, который вам передал Airhop.",
    codeLabel: "Код организации",
    codePlaceholder: "XXXX-XXXX-XXXX-XXXX",
    connect: "Подключить центр",
    changeLanguage: "Изменить язык",
    checkingCode: "Проверяем код…",
    connecting: "Подключаем центр…",
    invalidCode: "Проверьте код и попробуйте ещё раз.",
    profileTitle: "Как к вам обращаться?",
    profileHint:
      "Имя будет видно сотрудникам и агентам. Фото можно добавить позже.",
    nameLabel: "Ваше имя",
    namePlaceholder: "Введите имя",
    next: "Продолжить",
    back: "Назад",
    retry: "Повторить",
    setupFailed: "Не удалось подготовить команду. Попробуйте ещё раз.",
  },
  "en-US": {
    setupTitle: "Set up your center",
    chooseLanguage: "Choose language",
    connectTitle: "Connect your center",
    connectHint: "Enter the organization code provided by Airhop.",
    codeLabel: "Organization code",
    codePlaceholder: "XXXX-XXXX-XXXX-XXXX",
    connect: "Connect center",
    changeLanguage: "Change language",
    checkingCode: "Checking the code…",
    connecting: "Connecting your center…",
    invalidCode: "Check the code and try again.",
    profileTitle: "What should we call you?",
    profileHint:
      "Your name is visible to teammates and agents. A photo is optional.",
    nameLabel: "Your name",
    namePlaceholder: "Enter your name",
    next: "Continue",
    back: "Back",
    retry: "Try again",
    setupFailed: "Your team could not be prepared. Please try again.",
  },
  "tr-TR": {
    setupTitle: "Merkezinizi kuralım",
    chooseLanguage: "Dil seçin",
    connectTitle: "Merkezinizi bağlayın",
    connectHint: "Airhop tarafından verilen kuruluş kodunu girin.",
    codeLabel: "Kuruluş kodu",
    codePlaceholder: "XXXX-XXXX-XXXX-XXXX",
    connect: "Merkezi bağla",
    changeLanguage: "Dili değiştir",
    checkingCode: "Kod kontrol ediliyor…",
    connecting: "Merkez bağlanıyor…",
    invalidCode: "Kodu kontrol edip tekrar deneyin.",
    profileTitle: "Size nasıl hitap edelim?",
    profileHint:
      "Adınız ekip arkadaşları ve temsilciler tarafından görülür. Fotoğraf isteğe bağlıdır.",
    nameLabel: "Adınız",
    namePlaceholder: "Adınızı girin",
    next: "Devam et",
    back: "Geri",
    retry: "Tekrar dene",
    setupFailed: "Ekibiniz hazırlanamadı. Lütfen tekrar deneyin.",
  },
  "pt-BR": {
    setupTitle: "Vamos configurar seu centro",
    chooseLanguage: "Escolha o idioma",
    connectTitle: "Conecte seu centro",
    connectHint: "Digite o código da organização fornecido pela Airhop.",
    codeLabel: "Código da organização",
    codePlaceholder: "XXXX-XXXX-XXXX-XXXX",
    connect: "Conectar centro",
    changeLanguage: "Alterar idioma",
    checkingCode: "Verificando o código…",
    connecting: "Conectando seu centro…",
    invalidCode: "Confira o código e tente novamente.",
    profileTitle: "Como devemos chamar você?",
    profileHint:
      "Seu nome fica visível para a equipe e os agentes. A foto é opcional.",
    nameLabel: "Seu nome",
    namePlaceholder: "Digite seu nome",
    next: "Continuar",
    back: "Voltar",
    retry: "Tentar novamente",
    setupFailed: "Não foi possível preparar sua equipe. Tente novamente.",
  },
};

const LABELS: Record<AirHopOwnerLocale, string> = {
  "ru-RU": "Русский",
  "en-US": "English",
  "tr-TR": "Türkçe",
  "pt-BR": "Português (Brasil)",
};

export function isAirHopOwnerLocale(
  value: string | null,
): value is AirHopOwnerLocale {
  return isAirHopLocale(value);
}

export function loadAirHopOwnerLocale(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
): AirHopOwnerLocale | null {
  return loadAirHopLocale(storage);
}

export function persistAirHopOwnerLocale(
  locale: AirHopOwnerLocale,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
): void {
  persistAirHopLocale(locale, storage);
}

export function airHopOwnerCopy(locale: AirHopOwnerLocale): AirHopOwnerCopy {
  return COPY[locale];
}

export function airHopOwnerLanguageLabel(locale: AirHopOwnerLocale): string {
  return LABELS[locale];
}

/** Converts internal relay/runtime failures into owner-facing localized copy. */
export function airHopOwnerError(
  locale: AirHopOwnerLocale,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /invalid.*(?:code|invite)|invite.*(?:invalid|expired)|claim.*failed/i.test(
      message,
    )
  ) {
    return COPY[locale].invalidCode;
  }
  return COPY[locale].setupFailed;
}
