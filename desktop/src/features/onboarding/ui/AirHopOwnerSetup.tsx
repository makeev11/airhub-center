import * as React from "react";

import {
  AIRHOP_OWNER_LOCALES,
  airHopOwnerCopy,
  airHopOwnerLanguageLabel,
  loadAirHopOwnerLocale,
  persistAirHopOwnerLocale,
  type AirHopOwnerLocale,
} from "@/features/onboarding/airhopOwnerLocale";
import { parseInviteInput } from "@/shared/api/inviteHelpers";
import { AIRHOP_OWNER_BACKGROUND_PATH } from "@/shared/brand/airhopBrand";
import { AirHopMark } from "@/shared/ui/airhop-brand/AirHopBrand";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";

export type AirHopOwnerSetupProps = {
  defaultRelayUrl: string;
  onStart: (relayUrl: string, code: string) => void;
};

export function AirHopOwnerSetup({
  defaultRelayUrl,
  onStart,
}: AirHopOwnerSetupProps) {
  const [locale, setLocale] = React.useState<AirHopOwnerLocale | null>(
    loadAirHopOwnerLocale,
  );
  const [code, setCode] = React.useState("");
  const [hasInvalidCode, setHasInvalidCode] = React.useState(false);
  const copy = airHopOwnerCopy(locale ?? "ru-RU");

  const selectLocale = React.useCallback((nextLocale: AirHopOwnerLocale) => {
    persistAirHopOwnerLocale(nextLocale);
    setLocale(nextLocale);
    setHasInvalidCode(false);
  }, []);

  const submit = React.useCallback(() => {
    const parsed = parseInviteInput(code);
    if (!parsed) {
      setHasInvalidCode(true);
      return;
    }
    const relayUrl =
      "relayWsUrl" in parsed ? parsed.relayWsUrl : defaultRelayUrl;
    const normalizedCode = parsed.code.trim();
    if (!relayUrl.trim() || !normalizedCode) {
      setHasInvalidCode(true);
      return;
    }
    onStart(relayUrl, normalizedCode);
  }, [code, defaultRelayUrl, onStart]);

  return (
    <main
      className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-8"
      data-testid="airhop-owner-setup"
    >
      <StartupWindowDragRegion />
      <img
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        data-testid="airhop-owner-background"
        decoding="async"
        fetchPriority="high"
        src={AIRHOP_OWNER_BACKGROUND_PATH}
      />
      <div className="absolute inset-0 bg-slate-950/45 backdrop-saturate-125" />

      <section className="relative z-10 w-full max-w-md rounded-3xl border border-white/25 bg-slate-950/72 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
        <AirHopMark
          className="mx-auto size-16 drop-shadow-lg"
          decorative={false}
        />

        {locale === null ? (
          <div className="mt-6 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              {copy.setupTitle}
            </h1>
            <p className="mt-2 text-sm text-white/70">{copy.chooseLanguage}</p>
            <fieldset className="mt-7 grid gap-2">
              <legend className="sr-only">{copy.chooseLanguage}</legend>
              {AIRHOP_OWNER_LOCALES.map((option) => (
                <Button
                  className="h-11 justify-start rounded-xl border-white/15 bg-white/10 px-4 text-white shadow-none hover:bg-white/20"
                  key={option}
                  onClick={() => selectLocale(option)}
                  type="button"
                  variant="outline"
                >
                  {airHopOwnerLanguageLabel(option)}
                </Button>
              ))}
            </fieldset>
          </div>
        ) : (
          <div className="mt-6">
            <div className="text-center">
              <h1 className="text-3xl font-semibold tracking-tight">
                {copy.connectTitle}
              </h1>
              <p className="mt-2 text-sm leading-6 text-white/70">
                {copy.connectHint}
              </p>
            </div>

            <form
              className="mt-7 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <label
                className="grid gap-2 text-sm font-medium"
                htmlFor="airhop-owner-code"
              >
                {copy.codeLabel}
                <Input
                  data-testid="airhop-owner-code"
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  className="h-12 rounded-xl border-white/20 bg-white/10 font-mono text-base tracking-wide text-white shadow-none placeholder:text-white/35 focus-visible:ring-white/50"
                  id="airhop-owner-code"
                  onChange={(event) => {
                    setCode(event.target.value);
                    setHasInvalidCode(false);
                  }}
                  placeholder={copy.codePlaceholder}
                  spellCheck={false}
                  value={code}
                />
              </label>

              {hasInvalidCode ? (
                <p
                  className="rounded-xl border border-red-300/30 bg-red-950/55 p-3 text-sm leading-5 text-red-50"
                  role="alert"
                >
                  {copy.invalidCode}
                </p>
              ) : null}

              <Button
                className="h-12 w-full rounded-xl bg-white text-slate-950 shadow-none hover:bg-white/90"
                data-testid="airhop-owner-connect"
                disabled={code.trim().length === 0}
                type="submit"
              >
                {copy.connect}
              </Button>
              <Button
                className="h-9 w-full text-white/65 shadow-none hover:bg-white/10 hover:text-white"
                onClick={() => {
                  setLocale(null);
                  setHasInvalidCode(false);
                }}
                type="button"
                variant="ghost"
              >
                {copy.changeLanguage}
              </Button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
