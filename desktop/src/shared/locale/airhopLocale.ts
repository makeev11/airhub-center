export const AIRHOP_LOCALES = ["ru-RU", "en-US", "tr-TR", "pt-BR"] as const;

export type AirHopLocale = (typeof AIRHOP_LOCALES)[number];

export const AIRHOP_LOCALE_STORAGE_KEY = "airhop.locale.v1";
export const AIRHOP_LOCALE_CHANGE_EVENT = "airhop:locale-change";

export function isAirHopLocale(value: string | null): value is AirHopLocale {
  return AIRHOP_LOCALES.some((locale) => locale === value);
}

export function loadAirHopLocale(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
): AirHopLocale | null {
  const value =
    storage && typeof storage.getItem === "function"
      ? storage.getItem(AIRHOP_LOCALE_STORAGE_KEY)
      : null;
  return isAirHopLocale(value) ? value : null;
}

export function resolveAirHopLocale(): AirHopLocale {
  return loadAirHopLocale() ?? "en-US";
}

export function persistAirHopLocale(
  locale: AirHopLocale,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
): void {
  if (storage && typeof storage.setItem === "function") {
    storage.setItem(AIRHOP_LOCALE_STORAGE_KEY, locale);
  }
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new window.CustomEvent<AirHopLocale>(AIRHOP_LOCALE_CHANGE_EVENT, {
        detail: locale,
      }),
    );
  }
}

export function subscribeAirHopLocale(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    if (event.key === AIRHOP_LOCALE_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(AIRHOP_LOCALE_CHANGE_EVENT, onChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(AIRHOP_LOCALE_CHANGE_EVENT, onChange);
  };
}
