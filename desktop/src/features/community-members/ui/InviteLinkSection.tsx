import { Check, ChevronDown, Link2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { mintInvite } from "@/shared/api/invites";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Separator } from "@/shared/ui/separator";
import { Spinner } from "@/shared/ui/spinner";

const TTL_OPTIONS: { label: string; value: number }[] = [
  { label: "1 day", value: 24 * 60 * 60 },
  { label: "3 days", value: 3 * 24 * 60 * 60 },
  { label: "7 days", value: 7 * 24 * 60 * 60 },
  { label: "30 days", value: 30 * 24 * 60 * 60 },
];

const MAX_USE_OPTIONS: { label: string; value: number | null }[] = [
  { label: "No limit", value: null },
  { label: "1 use", value: 1 },
  { label: "3 uses", value: 3 },
  { label: "5 uses", value: 5 },
  { label: "10 uses", value: 10 },
  { label: "25 uses", value: 25 },
];

export const DEFAULT_INVITE_TTL_SECS = TTL_OPTIONS[1].value;

type CopyStatus = "idle" | "copying" | "copied";

/**
 * Share-with-link footer for the community invite dialog.
 *
 * Each copy action mints a fresh database-backed invite code and places its
 * shareable landing-page URL on the clipboard. Invites may be unlimited or
 * capped to a caller-selected number of successful joins.
 */
export function InviteLinkSection({
  onTtlSecsChange,
  ttlSecs,
}: {
  onTtlSecsChange: (ttlSecs: number) => void;
  ttlSecs: number;
}) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const [copyStatus, setCopyStatus] = React.useState<CopyStatus>("idle");
  const [maxUses, setMaxUses] = React.useState<number | null>(null);
  const ttlOptions = isRussian
    ? [
        { label: "1 день", value: 24 * 60 * 60 },
        { label: "3 дня", value: 3 * 24 * 60 * 60 },
        { label: "7 дней", value: 7 * 24 * 60 * 60 },
        { label: "30 дней", value: 30 * 24 * 60 * 60 },
      ]
    : TTL_OPTIONS;
  const maxUseOptions = isRussian
    ? [
        { label: "Без ограничений", value: null },
        { label: "1 вход", value: 1 },
        { label: "3 входа", value: 3 },
        { label: "5 входов", value: 5 },
        { label: "10 входов", value: 10 },
        { label: "25 входов", value: 25 },
      ]
    : MAX_USE_OPTIONS;
  const ttlLabel =
    ttlOptions.find((option) => option.value === ttlSecs)?.label ??
    (isRussian ? "3 дня" : "3 days");
  const maxUsesLabel =
    maxUseOptions.find((option) => option.value === maxUses)?.label ??
    (isRussian ? "Без ограничений" : "No limit");
  const copyLabel =
    copyStatus === "copying"
      ? isRussian
        ? "Копируем…"
        : "Copying…"
      : copyStatus === "copied"
        ? isRussian
          ? "Скопировано"
          : "Copied"
        : isRussian
          ? "Скопировать ссылку"
          : "Copy link";

  React.useEffect(() => {
    if (copyStatus !== "copied") return;
    const resetTimer = window.setTimeout(() => setCopyStatus("idle"), 2000);
    return () => window.clearTimeout(resetTimer);
  }, [copyStatus]);

  async function handleCopy() {
    if (copyStatus === "copying") return;
    setCopyStatus("copying");
    try {
      const invite = await mintInvite({ ttlSecs, maxUses });
      await writeTextToClipboard(invite.url);
      setCopyStatus("copied");
      toast.success(isRussian ? "Ссылка скопирована" : "Invite link copied");
    } catch {
      setCopyStatus("idle");
      toast.error(
        isRussian
          ? "Не удалось скопировать ссылку. Попробуйте ещё раз."
          : "Couldn’t copy the invite link. Try again.",
      );
    }
  }

  return (
    <section data-testid="community-invite-link-section">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">
            {isRussian ? "Срок действия" : "Expires after"}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={
                  isRussian
                    ? "Выбрать срок действия приглашения"
                    : "Choose invite expiry"
                }
                className="h-8 shrink-0 gap-1.5 px-2 text-sm text-muted-foreground"
                data-testid="invite-link-ttl-trigger"
                disabled={copyStatus === "copying"}
                size="sm"
                type="button"
                variant="ghost"
              >
                {ttlLabel}
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuRadioGroup
                onValueChange={(value) => onTtlSecsChange(Number(value))}
                value={String(ttlSecs)}
              >
                {ttlOptions.map((option) => (
                  <DropdownMenuRadioItem
                    data-testid={`invite-link-ttl-${option.value}`}
                    key={option.value}
                    value={String(option.value)}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">
            {isRussian ? "Ограничить число входов" : "Limit number of uses"}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={
                  isRussian
                    ? "Выбрать число входов по приглашению"
                    : "Choose maximum invite uses"
                }
                className="h-8 shrink-0 gap-1.5 px-2 text-sm text-muted-foreground"
                data-testid="invite-link-max-uses-trigger"
                disabled={copyStatus === "copying"}
                size="sm"
                type="button"
                variant="ghost"
              >
                {maxUsesLabel}
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  setMaxUses(value === "no-limit" ? null : Number(value))
                }
                value={String(maxUses ?? "no-limit")}
              >
                {maxUseOptions.map((option) => (
                  <DropdownMenuRadioItem
                    data-testid={`invite-link-max-uses-${option.value ?? "no-limit"}`}
                    key={option.value ?? "no-limit"}
                    value={String(option.value ?? "no-limit")}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Separator className="my-4 bg-input/40" />
      <div className="flex justify-end">
        <Button
          className="shrink-0 border-border shadow-none"
          data-copy-status={copyStatus}
          data-testid="copy-invite-link"
          disabled={copyStatus === "copying"}
          onClick={() => void handleCopy()}
          size="sm"
          type="button"
          variant="outline"
        >
          {copyStatus === "copying" ? (
            <Spinner aria-hidden="true" className="h-4 w-4 border-2" />
          ) : copyStatus === "copied" ? (
            <Check aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Link2 aria-hidden="true" className="h-4 w-4" />
          )}
          {copyLabel}
        </Button>
      </div>
    </section>
  );
}
