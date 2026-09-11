import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  MapPinned,
  UsersRound,
} from "lucide-react";
import * as React from "react";

import {
  BRANCH_MAP_PROVIDERS,
  buildBranchMapLinks,
  type BranchMapProvider,
} from "@/features/booking/lib/branchLocationLinks";
import type {
  TrackingLink,
  TrackingLinkList,
} from "@/features/booking/data/staffSiteAnalyticsService";
import type { ClientInbox } from "@/features/client-inbox/data/clientInboxService";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";

function copy(locale: string) {
  const ru = locale.toLowerCase().startsWith("ru");
  return ru
    ? {
        addressTitle: "Адрес филиала",
        addressHint:
          "Укажите точный адрес для клиентов. Airhop будет использовать его в записях и обращениях.",
        addressLabel: "Адрес",
        addressPlaceholder:
          "Например: Москва, ул. Земляной Вал, 27, вход со двора",
        checkAddress: "Проверить в картах",
        responsiblesTitle: "Ответственные за обращения",
        responsiblesHint:
          "Выберите до восьми сотрудников. Уведомление получат ответственные с доступом к каналу; иначе обращение останется владельцу или центральному администратору.",
        responsiblesFallback: "Без выбора — владелец или администратор",
        unavailableStaff: "Недоступный сотрудник",
        routingUnavailable:
          "Список сотрудников сейчас недоступен. Остальные настройки филиала можно сохранить.",
        trackedTitle: "Трекинговые ссылки для карт",
        trackedHint:
          "Airhop создаёт отдельную короткую ссылку для каждой площадки. Она ведёт на запись именно в этот филиал и сохраняет источник перехода.",
        trackedSteps:
          "1. Скопируйте ссылку → 2. Вставьте её в поле «Сайт» или «Онлайн-запись» в карточке филиала → 3. Смотрите переходы и записи в разделе «Аналитика → Привлечение».",
        createTracked: "Создать недостающие ссылки",
        creatingTracked: "Создаём ссылки…",
        createAfterSave:
          "После сохранения филиала Airhop автоматически создаст три отдельные ссылки — для Яндекс Карт, Google Maps и 2ГИС.",
        linkAfterSave: "Будет создана после сохранения",
        loadingLinks: "Загружаем трекинговые ссылки…",
        copy: "Копировать",
        copied: "Скопировано",
        linksUnavailable:
          "Аналитические ссылки сейчас недоступны. Адрес и ответственных всё равно можно сохранить.",
      }
    : {
        addressTitle: "Branch address",
        addressHint:
          "Enter the exact client-facing address. AirHop will use it in bookings and conversations.",
        addressLabel: "Address",
        addressPlaceholder:
          "For example: 27 Zemlyanoy Val St., entrance from the courtyard",
        checkAddress: "Check in maps",
        responsiblesTitle: "Conversation responsibles",
        responsiblesHint:
          "Choose up to eight staff. Eligible responsibles with channel access are notified; otherwise the owner or central administrator receives the conversation.",
        responsiblesFallback: "No selection — owner or administrator",
        unavailableStaff: "Unavailable staff member",
        routingUnavailable:
          "The staff list is unavailable right now. Other branch settings can still be saved.",
        trackedTitle: "Tracked links for map listings",
        trackedHint:
          "AirHop creates a separate short link for every platform. It opens booking for this branch and preserves the acquisition source.",
        trackedSteps:
          "1. Copy the link → 2. Paste it into the Website or Book online field in the branch listing → 3. See visits and bookings under Analytics → Acquisition.",
        createTracked: "Create missing links",
        creatingTracked: "Creating links…",
        createAfterSave:
          "After the branch is saved, AirHop automatically creates three separate links for Yandex Maps, Google Maps, and 2GIS.",
        linkAfterSave: "Created after saving",
        loadingLinks: "Loading tracked links…",
        copy: "Copy",
        copied: "Copied",
        linksUnavailable:
          "Analytics links are unavailable right now. The address and responsibles can still be saved.",
      };
}

function providerLabel(provider: BranchMapProvider): string {
  switch (provider) {
    case "yandex_maps":
      return "Яндекс Карты";
    case "google_maps":
      return "Google Maps";
    case "two_gis":
      return "2ГИС";
  }
}

function activeProviderLink(
  links: TrackingLink[],
  branchId: string,
  provider: BranchMapProvider,
): TrackingLink | undefined {
  return links.find(
    (link) =>
      link.status === "active" &&
      link.branchId === branchId &&
      link.source === provider,
  );
}

function SettingsSection({
  children,
  hint,
  icon,
  testId,
  title,
}: {
  children: React.ReactNode;
  hint: string;
  icon: React.ReactNode;
  testId?: string;
  title: string;
}) {
  return (
    <section
      className="rounded-xl border border-border/70 p-4"
      data-testid={testId}
    >
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-3">
        <div className="pt-0.5 text-primary">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div aria-hidden="true" />
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

export function BranchOperationalSettings({
  address,
  addressError,
  branchId,
  enableServerOperations,
  generatingLinks,
  loading,
  locale,
  onGenerateLinks,
  onAddressChange,
  onSelectedResponsiblesChange,
  routing,
  routingFailed,
  selectedResponsibles,
  tracking,
  trackingFailed,
}: {
  address: string;
  addressError?: string;
  branchId?: string;
  enableServerOperations: boolean;
  generatingLinks: boolean;
  loading: boolean;
  locale: string;
  onGenerateLinks: () => Promise<void>;
  onAddressChange: (address: string) => void;
  onSelectedResponsiblesChange: (pubkeys: string[]) => void;
  routing: ClientInbox | null;
  routingFailed: boolean;
  selectedResponsibles: string[];
  tracking: TrackingLinkList | null;
  trackingFailed: boolean;
}) {
  const messages = copy(locale);
  const mapLinks = buildBranchMapLinks(address);
  const [copied, setCopied] = React.useState<string | null>(null);
  const staff = React.useMemo(
    () =>
      [
        ...new Map(
          (routing?.staff ?? []).map((person) => [person.pubkey, person]),
        ).values(),
      ].sort((first, second) => first.name.localeCompare(second.name, locale)),
    [locale, routing?.staff],
  );
  const missingProviders = branchId
    ? BRANCH_MAP_PROVIDERS.filter(
        (provider) =>
          !activeProviderLink(tracking?.items ?? [], branchId, provider),
      )
    : [...BRANCH_MAP_PROVIDERS];

  const copyTrackedLink = async (link: TrackingLink) => {
    if (!tracking) return;
    const value = `${tracking.redirectBaseUrl}${link.slug}`;
    try {
      await writeTextToClipboard(value);
      setCopied(link.id);
      window.setTimeout(() => setCopied(null), 1_500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="airhop-branch-operational-settings">
      <SettingsSection
        hint={messages.addressHint}
        icon={<MapPinned className="h-5 w-5" />}
        title={messages.addressTitle}
      >
        <div className="grid gap-1.5 text-sm">
          <label className="font-medium" htmlFor="airhop-branch-address">
            {messages.addressLabel}
          </label>
          <Textarea
            aria-label={messages.addressLabel}
            aria-invalid={Boolean(addressError)}
            data-testid="airhop-branch-address"
            id="airhop-branch-address"
            maxLength={500}
            onChange={(event) => onAddressChange(event.target.value)}
            placeholder={messages.addressPlaceholder}
            value={address}
          />
          {addressError ? (
            <span className="text-xs text-destructive">{addressError}</span>
          ) : null}
        </div>
        {mapLinks.length ? (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              {messages.checkAddress}
            </p>
            <div
              className="flex flex-wrap gap-2"
              data-testid="airhop-branch-map-links"
            >
              {mapLinks.map((link) => (
                <Button asChild key={link.provider} size="sm" variant="outline">
                  <a href={link.url} rel="noreferrer" target="_blank">
                    {providerLabel(link.provider)}
                    <ExternalLink />
                  </a>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </SettingsSection>

      {enableServerOperations ? (
        <SettingsSection
          hint={messages.responsiblesHint}
          icon={<UsersRound className="h-5 w-5" />}
          title={messages.responsiblesTitle}
        >
          {loading && !routing ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {messages.responsiblesTitle}
            </p>
          ) : routingFailed || !routing ? (
            <Alert variant="destructive">
              <AlertDescription>{messages.routingUnavailable}</AlertDescription>
            </Alert>
          ) : routing.canManageRouting ? (
            <fieldset className="grid gap-2 sm:grid-cols-2" disabled={loading}>
              <legend className="mb-2 text-xs text-muted-foreground">
                {messages.responsiblesFallback}
              </legend>
              {staff.map((person) => {
                const selected = selectedResponsibles.includes(person.pubkey);
                return (
                  <label
                    className="flex min-w-0 items-center gap-2 text-sm"
                    key={person.pubkey}
                  >
                    <input
                      checked={selected}
                      disabled={selectedResponsibles.length >= 8 && !selected}
                      onChange={(event) =>
                        onSelectedResponsiblesChange(
                          event.target.checked
                            ? [...selectedResponsibles, person.pubkey]
                            : selectedResponsibles.filter(
                                (pubkey) => pubkey !== person.pubkey,
                              ),
                        )
                      }
                      type="checkbox"
                    />
                    <span className="truncate">{person.name}</span>
                  </label>
                );
              })}
              {selectedResponsibles
                .filter(
                  (pubkey) => !staff.some((person) => person.pubkey === pubkey),
                )
                .map((pubkey) => (
                  <label
                    className="flex min-w-0 items-center gap-2 text-sm"
                    key={pubkey}
                  >
                    <input
                      checked
                      onChange={() =>
                        onSelectedResponsiblesChange(
                          selectedResponsibles.filter(
                            (candidate) => candidate !== pubkey,
                          ),
                        )
                      }
                      type="checkbox"
                    />
                    <span className="truncate">
                      {messages.unavailableStaff}: {truncatePubkey(pubkey)}
                    </span>
                  </label>
                ))}
            </fieldset>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedResponsibles.length ? (
                selectedResponsibles.map((pubkey) => (
                  <Badge key={pubkey} variant="secondary">
                    {staff.find((person) => person.pubkey === pubkey)?.name ??
                      messages.unavailableStaff}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">
                  {messages.responsiblesFallback}
                </span>
              )}
            </div>
          )}
        </SettingsSection>
      ) : null}

      {enableServerOperations ? (
        <SettingsSection
          hint={messages.trackedHint}
          icon={<Link2 className="h-5 w-5" />}
          testId="airhop-branch-tracking-settings"
          title={messages.trackedTitle}
        >
          <p className="mb-3 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-foreground">
            {messages.trackedSteps}
          </p>
          {trackingFailed ? (
            <Alert variant="destructive">
              <AlertDescription>{messages.linksUnavailable}</AlertDescription>
            </Alert>
          ) : loading && !tracking ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {messages.loadingLinks}
            </p>
          ) : branchId && tracking ? (
            <div
              className="space-y-2"
              data-testid="airhop-branch-tracking-links"
            >
              {BRANCH_MAP_PROVIDERS.map((provider) => {
                const link = activeProviderLink(
                  tracking.items,
                  branchId,
                  provider,
                );
                const value = link
                  ? `${tracking.redirectBaseUrl}${link.slug}`
                  : null;
                return (
                  <div
                    className="grid min-w-0 gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center"
                    key={provider}
                  >
                    <span className="text-sm font-medium">
                      {providerLabel(provider)}
                    </span>
                    {link && value ? (
                      <>
                        <code className="block min-w-0 truncate rounded-md bg-background px-2 py-1.5 text-xs text-muted-foreground">
                          {value}
                        </code>
                        <Button
                          aria-label={`${messages.copy}: ${providerLabel(provider)}`}
                          onClick={() => void copyTrackedLink(link)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {copied === link.id ? <Check /> : <Copy />}
                          {copied === link.id ? messages.copied : messages.copy}
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground sm:col-span-2">
                        {messages.linkAfterSave}
                      </span>
                    )}
                  </div>
                );
              })}
              {missingProviders.length ? (
                <Button
                  disabled={generatingLinks}
                  onClick={() => void onGenerateLinks().catch(() => undefined)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {generatingLinks ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Link2 />
                  )}
                  {generatingLinks
                    ? messages.creatingTracked
                    : messages.createTracked}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {messages.createAfterSave}
            </p>
          )}
        </SettingsSection>
      ) : null}
    </div>
  );
}
