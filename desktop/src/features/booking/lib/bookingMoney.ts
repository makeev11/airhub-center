const CURRENCY_EXPONENT_FALLBACKS: Readonly<Record<string, number>> = {
  EUR: 2,
  JPY: 0,
  KWD: 3,
  RUB: 2,
  USD: 2,
};

function isKnownCurrency(code: string): boolean {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      return Intl.supportedValuesOf("currency").includes(code);
    }
  } catch {
    // Fall through to the currencies supported explicitly by this MVP.
  }
  return Object.hasOwn(CURRENCY_EXPONENT_FALLBACKS, code);
}

export function currencyMinorUnitExponent(currency: string): number | null {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || !isKnownCurrency(code)) return null;

  try {
    const fractionDigits = new Intl.NumberFormat("en", {
      currency: code,
      currencyDisplay: "code",
      style: "currency",
      useGrouping: false,
    }).resolvedOptions().maximumFractionDigits;
    if (
      typeof fractionDigits === "number" &&
      Number.isInteger(fractionDigits) &&
      fractionDigits >= 0 &&
      fractionDigits <= 6
    ) {
      return fractionDigits;
    }
  } catch {
    // Older embedded runtimes may have incomplete currency data. The explicit
    // MVP currencies below retain their ISO 4217 exponent in that case.
  }

  return CURRENCY_EXPONENT_FALLBACKS[code] ?? null;
}

export function majorMoneyInput(amountMinor: number, currency: string): string {
  const exponent = currencyMinorUnitExponent(currency);
  if (
    exponent === null ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0
  ) {
    throw new RangeError("Invalid currency amount");
  }
  if (exponent === 0) return String(amountMinor);

  const scale = 10 ** exponent;
  const major = Math.floor(amountMinor / scale);
  const fraction = String(amountMinor % scale).padStart(exponent, "0");
  return `${major}.${fraction}`;
}

export function parseMajorMoneyInput(
  value: string,
  currency: string,
): number | null {
  const exponent = currencyMinorUnitExponent(currency);
  if (exponent === null) return null;
  const normalized = value.trim().replace(",", ".");
  const pattern =
    exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${exponent}})?$`);
  if (!pattern.test(normalized)) return null;

  const [majorPart, fractionPart = ""] = normalized.split(".");
  const scale = 10 ** exponent;
  const major = Number(majorPart);
  const fraction = exponent ? Number(fractionPart.padEnd(exponent, "0")) : 0;
  const amountMinor = major * scale + fraction;
  return Number.isSafeInteger(amountMinor) ? amountMinor : null;
}
