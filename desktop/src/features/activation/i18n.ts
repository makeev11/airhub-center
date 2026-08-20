import {
  AIRHOP_LOCALES,
  AIRHOP_LOCALE_CHANGE_EVENT,
  AIRHOP_LOCALE_STORAGE_KEY,
  type AirHopLocale,
  isAirHopLocale,
  loadAirHopLocale,
  persistAirHopLocale,
  resolveAirHopLocale,
  subscribeAirHopLocale,
} from "@/shared/locale/airhopLocale";

export const ACTIVATION_LOCALES = AIRHOP_LOCALES;
export type ActivationLocale = AirHopLocale;
export const AVAILABLE_ACTIVATION_LOCALES = ["en-US", "ru-RU"] as const;
export const ACTIVATION_LOCALE_STORAGE_KEY = AIRHOP_LOCALE_STORAGE_KEY;
export const ACTIVATION_LOCALE_CHANGED_EVENT = AIRHOP_LOCALE_CHANGE_EVENT;

export const isActivationLocale = isAirHopLocale;
export const loadActivationLocale = loadAirHopLocale;
export const persistActivationLocale = persistAirHopLocale;
export const resolveActivationLocale = resolveAirHopLocale;
export const subscribeActivationLocale = subscribeAirHopLocale;

export function isAvailableActivationLocale(
  value: string | null,
): value is (typeof AVAILABLE_ACTIVATION_LOCALES)[number] {
  return AVAILABLE_ACTIVATION_LOCALES.some((locale) => locale === value);
}

export function visibleOwnerLocales(): readonly AirHopLocale[] {
  return AVAILABLE_ACTIVATION_LOCALES;
}

export function defaultOwnerLocale(): AirHopLocale {
  return "en-US";
}
