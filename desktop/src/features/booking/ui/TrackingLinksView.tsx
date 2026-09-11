import { Check, Copy, Link2, Plus } from "lucide-react";
import * as React from "react";

import type {
  CreateTrackingLink,
  TrackingLink,
  TrackingLinkGoal,
  TrackingLinkSource,
} from "@/features/booking/data/staffSiteAnalyticsService";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

const SOURCES: TrackingLinkSource[] = [
  "yandex_maps",
  "google_maps",
  "two_gis",
  "qr",
  "campaign",
  "custom",
];
const GOALS: TrackingLinkGoal[] = ["site", "booking", "contact"];

function copy(locale: string) {
  const ru = locale.toLowerCase().startsWith("ru");
  return ru
    ? {
        title: "Новая размеченная ссылка",
        hint: "Создайте ссылку для карточки на картах, QR-кода или кампании. Переход и результат свяжутся автоматически.",
        name: "Название",
        namePlaceholder: "Например, Яндекс Карты — основной филиал",
        source: "Источник",
        goal: "Цель",
        destination: "Куда ведёт",
        create: "Создать ссылку",
        creating: "Создаём…",
        failed:
          "Не удалось создать ссылку. Проверьте поля и попробуйте ещё раз.",
        list: "Готовые ссылки",
        empty: "Пока нет размеченных ссылок.",
        copied: "Скопировано",
        copy: "Копировать",
        opens: "переходов",
        bookings: "записей",
        contacts: "контактов",
        sourceLabel: {
          yandex_maps: "Яндекс Карты",
          google_maps: "Google Maps",
          two_gis: "2ГИС",
          qr: "QR-код",
          campaign: "Кампания",
          custom: "Другое",
        },
        goalLabel: { site: "Сайт", booking: "Запись", contact: "Контакт" },
      }
    : {
        title: "New tracked link",
        hint: "Create a link for a map listing, QR code, or campaign. Visits and outcomes are attributed automatically.",
        name: "Name",
        namePlaceholder: "For example, Google Maps — Downtown",
        source: "Source",
        goal: "Goal",
        destination: "Destination",
        create: "Create link",
        creating: "Creating…",
        failed: "Could not create the link. Check the fields and try again.",
        list: "Ready links",
        empty: "There are no tracked links yet.",
        copied: "Copied",
        copy: "Copy",
        opens: "visits",
        bookings: "bookings",
        contacts: "contacts",
        sourceLabel: {
          yandex_maps: "Yandex Maps",
          google_maps: "Google Maps",
          two_gis: "2GIS",
          qr: "QR code",
          campaign: "Campaign",
          custom: "Other",
        },
        goalLabel: { site: "Site", booking: "Booking", contact: "Contact" },
      };
}

export function TrackingLinksView({
  locale,
  links,
  redirectBaseUrl,
  onCreate,
}: {
  locale: string;
  links: TrackingLink[];
  redirectBaseUrl: string;
  onCreate: (input: CreateTrackingLink) => Promise<void>;
}) {
  const messages = copy(locale);
  const [name, setName] = React.useState("");
  const [source, setSource] = React.useState<TrackingLinkSource>("yandex_maps");
  const [goal, setGoal] = React.useState<TrackingLinkGoal>("booking");
  const [destinationPath, setDestinationPath] = React.useState("/booking/");
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const destinationInvalid =
    !destinationPath.startsWith("/") ||
    destinationPath.startsWith("//") ||
    destinationPath.includes("?") ||
    destinationPath.includes("#");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || destinationInvalid) return;
    setSaving(true);
    setFailed(false);
    try {
      await onCreate({ name: name.trim(), source, goal, destinationPath });
      setName("");
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async (link: TrackingLink) => {
    try {
      await navigator.clipboard.writeText(`${redirectBaseUrl}${link.slug}`);
      setCopiedId(link.id);
      window.setTimeout(() => setCopiedId(null), 1_500);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="airhop-tracking-links">
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Link2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">{messages.title}</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {messages.hint}
            </p>
          </div>
        </div>
        <form
          className="mt-5 grid gap-4 lg:grid-cols-4"
          onSubmit={(event) => void submit(event)}
        >
          <label
            className="grid gap-1.5 text-sm lg:col-span-2"
            htmlFor="tracking-link-name"
          >
            <span className="font-medium">{messages.name}</span>
            <Input
              id="tracking-link-name"
              onChange={(event) => setName(event.target.value)}
              placeholder={messages.namePlaceholder}
              value={name}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{messages.source}</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              onChange={(event) =>
                setSource(event.target.value as TrackingLinkSource)
              }
              value={source}
            >
              {SOURCES.map((value) => (
                <option key={value} value={value}>
                  {messages.sourceLabel[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{messages.goal}</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              onChange={(event) =>
                setGoal(event.target.value as TrackingLinkGoal)
              }
              value={goal}
            >
              {GOALS.map((value) => (
                <option key={value} value={value}>
                  {messages.goalLabel[value]}
                </option>
              ))}
            </select>
          </label>
          <label
            className="grid gap-1.5 text-sm lg:col-span-3"
            htmlFor="tracking-link-destination"
          >
            <span className="font-medium">{messages.destination}</span>
            <Input
              id="tracking-link-destination"
              onChange={(event) => setDestinationPath(event.target.value)}
              value={destinationPath}
            />
          </label>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={saving || !name.trim() || destinationInvalid}
              type="submit"
            >
              <Plus />
              {saving ? messages.creating : messages.create}
            </Button>
          </div>
        </form>
        {failed ? (
          <p className="mt-3 text-sm text-destructive">{messages.failed}</p>
        ) : null}
      </Card>

      <Card className="space-y-4 p-4 sm:p-5">
        <h2 className="text-base font-semibold">{messages.list}</h2>
        {links.length ? (
          <div className="divide-y divide-border/70">
            {links.map((link) => (
              <div
                className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-center"
                key={link.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{link.name}</p>
                    <Badge variant="secondary">
                      {messages.sourceLabel[link.source]}
                    </Badge>
                    <Badge variant="outline">
                      {messages.goalLabel[link.goal]}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {redirectBaseUrl}
                    {link.slug}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {link.openCount} {messages.opens} · {link.bookingCount}{" "}
                    {messages.bookings} · {link.contactClickCount}{" "}
                    {messages.contacts}
                  </p>
                </div>
                <Button
                  onClick={() => void copyLink(link)}
                  size="sm"
                  variant="outline"
                >
                  {copiedId === link.id ? <Check /> : <Copy />}
                  {copiedId === link.id ? messages.copied : messages.copy}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{messages.empty}</p>
        )}
      </Card>
    </div>
  );
}
