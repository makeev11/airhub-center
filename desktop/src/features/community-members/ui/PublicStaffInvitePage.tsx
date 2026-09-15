import * as React from "react";
import {
  acceptJoinPolicy,
  getJoinPolicy,
  joinPolicyDocumentUrl,
  type JoinPolicy,
} from "@/shared/api/invites";
import { parseInviteInput } from "@/shared/api/inviteHelpers";
import { AirHopMark } from "@/shared/ui/airhop-brand/AirHopBrand";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { messageText } from "@/shared/locale/messengerCopy";
import type { AirHopLocale } from "@/shared/locale/airhopLocale";

function browserInviteLocale(): AirHopLocale {
  if (navigator.language.toLowerCase().startsWith("pt")) return "pt-BR";
  if (navigator.language.toLowerCase().startsWith("ru")) return "ru-RU";
  return "en-US";
}

/** Public employee invitation landing page, rendered without the native app shell. */
export function PublicStaffInvitePage() {
  const [locale, setLocale] = React.useState<AirHopLocale>(browserInviteLocale);
  const t = (russian: string, english: string) =>
    locale === "ru-RU" ? russian : messageText(english, {}, locale);
  const invite = React.useMemo(
    () => parseInviteInput(window.location.href),
    [],
  );
  const relay = invite && "relayWsUrl" in invite ? invite.relayWsUrl : null;
  const [policy, setPolicy] = React.useState<JoinPolicy | null | undefined>();
  const [error, setError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [age, setAge] = React.useState(false);
  const [agreement, setAgreement] = React.useState(false);
  const [receipt, setReceipt] = React.useState<string>();
  const [pending, setPending] = React.useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries policy discovery.
  React.useEffect(() => {
    if (!relay) return;
    let active = true;
    setError(false);
    setPolicy(undefined);
    void getJoinPolicy(relay, "webview")
      .then((value) => {
        if (active) setPolicy(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [relay, attempt]);

  const canOpen =
    policy !== undefined && (policy === null || receipt !== undefined);
  const query = new URLSearchParams({
    relay: relay ?? "",
    code: invite?.code ?? "",
  });
  if (receipt) query.set("policy_receipt", receipt);

  async function accept() {
    if (!relay || !invite || !policy || pending) return;
    setPending(true);
    setError(false);
    try {
      setReceipt(
        await acceptJoinPolicy(relay, invite.code, policy.version, age),
      );
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-lg space-y-5 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between">
          <AirHopMark className="size-12" decorative={false} />
          <fieldset aria-label={t("Язык", "Language")} className="flex gap-1">
            {(
              [
                ["en-US", "EN", "English"],
                ["ru-RU", "RU", "Русский"],
                ["pt-BR", "PT-BR", "Português (Brasil)"],
              ] as const
            ).map(([value, label, accessibleLabel]) => (
              <Button
                aria-label={accessibleLabel}
                aria-pressed={locale === value}
                key={value}
                onClick={() => setLocale(value)}
                size="sm"
                variant={locale === value ? "secondary" : "ghost"}
              >
                {label}
              </Button>
            ))}
          </fieldset>
        </div>
        <h1 className="text-2xl font-semibold">
          {t("Приглашение в Airhop Center", "Invitation to Airhop Center")}
        </h1>
        {!relay ? (
          <p role="alert">
            {t(
              "Некорректная ссылка. Попросите администратора прислать новое приглашение.",
              "Invalid link. Ask your administrator for a new invitation.",
            )}
          </p>
        ) : (
          <>
            <p className="break-words text-sm text-muted-foreground">
              {t(
                "Вас пригласили в команду центра",
                "You have been invited to the center team",
              )}
              : <strong>{new URL(relay).host}</strong>
            </p>
            <p className="text-sm">
              {t(
                "Откройте Airhop Center и завершите вход со своим профилем сотрудника.",
                "Open Airhop Center and finish joining with your employee profile.",
              )}
            </p>
            {policy === undefined && !error ? (
              <p role="status">
                {t("Загружаем условия входа…", "Loading joining requirements…")}
              </p>
            ) : null}
            {policy && !receipt ? (
              <div className="space-y-3 text-sm">
                {policy.ageAttestationRequired ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      data-testid="staff-invite-age"
                      checked={age}
                      onChange={(event) => setAge(event.target.checked)}
                    />
                    {t("Мне исполнилось 18 лет", "I am at least 18 years old")}
                  </label>
                ) : null}
                {policy.termsMarkdown || policy.privacyMarkdown ? (
                  <>
                    <div className="flex flex-wrap gap-3">
                      {policy.termsMarkdown ? (
                        <a
                          className="underline"
                          href={joinPolicyDocumentUrl(relay, "terms")}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("Условия использования", "Terms of service")}
                        </a>
                      ) : null}
                      {policy.privacyMarkdown ? (
                        <a
                          className="underline"
                          href={joinPolicyDocumentUrl(relay, "privacy")}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("Политика конфиденциальности", "Privacy policy")}
                        </a>
                      ) : null}
                    </div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        data-testid="staff-invite-agreement"
                        checked={agreement}
                        onChange={(event) => setAgreement(event.target.checked)}
                      />
                      {t(
                        "Я принимаю указанные условия",
                        "I accept these policies",
                      )}
                    </label>
                  </>
                ) : null}
                <Button
                  data-testid="staff-invite-accept"
                  disabled={
                    pending ||
                    (policy.ageAttestationRequired && !age) ||
                    (Boolean(policy.termsMarkdown || policy.privacyMarkdown) &&
                      !agreement)
                  }
                  onClick={() => void accept()}
                >
                  {t("Продолжить", "Continue")}
                </Button>
              </div>
            ) : null}
            {error ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {t(
                    "Не удалось проверить условия входа. Повторите попытку.",
                    "Could not verify joining requirements. Please try again.",
                  )}
                </p>
                <Button
                  variant="outline"
                  data-testid="staff-invite-retry"
                  onClick={() => {
                    setReceipt(undefined);
                    setAge(false);
                    setAgreement(false);
                    setAttempt((value) => value + 1);
                  }}
                >
                  {t("Повторить", "Retry")}
                </Button>
              </div>
            ) : null}
            {canOpen ? (
              <Button asChild className="w-full">
                <a
                  data-testid="staff-invite-open"
                  href={`airhop://join?${query}`}
                >
                  {t("Открыть Airhop Center", "Open Airhop Center")}
                </a>
              </Button>
            ) : null}
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                {t(
                  "Если приложение не открывается, установите Airhop Center по инструкции администратора. При первом запуске вставьте эту ссылку в поле «Код организации».",
                  "If the app does not open, install Airhop Center using your administrator’s instructions. On first launch, paste this link into the Organization code field.",
                )}
              </p>
              <Input
                aria-label={t("Ссылка приглашения", "Invitation link")}
                data-testid="staff-invite-link"
                readOnly
                value={`${window.location.origin}/invite/${encodeURIComponent(invite?.code ?? "")}${receipt ? `?policy_receipt=${encodeURIComponent(receipt)}` : ""}`}
                onFocus={(event) => event.target.select()}
              />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
