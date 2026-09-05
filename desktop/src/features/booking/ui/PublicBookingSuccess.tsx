import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";

import type { PublicBookingManagementCard } from "@/features/booking/data/publicBookingService";
import type { PublicBookingMessages } from "@/features/booking/lib/publicBookingLocale";
import type { PreferredContactChannel } from "@/features/booking/model/bookingCore";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

export function PublicBookingSuccess({
  card,
  channelError = false,
  locale = "ru-RU",
  isSavingChannel,
  managementToken,
  messages,
  mode,
  onChooseContactChannel,
  onStartAnother,
  organizationName,
}: {
  card: PublicBookingManagementCard;
  channelError?: boolean;
  locale?: string;
  isSavingChannel: boolean;
  managementToken: string | null;
  messages: PublicBookingMessages;
  mode: "standalone" | "embedded";
  onChooseContactChannel: (channel: PreferredContactChannel) => void;
  onStartAnother: () => void;
  organizationName: string;
}) {
  const copy = locale.startsWith("ru")
    ? {
        open: "Открыть Telegram",
        hint: "Нажмите Start в Telegram. Гермес увидит вашу запись и поможет с подтверждением.",
        connected:
          "Telegram подключён. Продолжайте общение с центром в этом чате.",
        error:
          "Не получилось подготовить переход. Попробуйте ещё раз, ваша запись сохранена.",
      }
    : locale.startsWith("pt")
      ? {
          open: "Abrir Telegram",
          hint: "Toque em Iniciar no Telegram. Hermes encontrará sua reserva e ajudará com a confirmação.",
          connected:
            "Telegram conectado. Continue conversando com o centro nesse chat.",
          error:
            "Não foi possível preparar o link. Tente novamente; sua reserva está salva.",
        }
      : locale.startsWith("tr")
        ? {
            open: "Telegram'ı aç",
            hint: "Telegram'da Başlat'a dokunun. Hermes kaydınızı bulup onaylamanıza yardımcı olacak.",
            connected:
              "Telegram bağlandı. Merkezle bu sohbette iletişime devam edebilirsiniz.",
            error:
              "Bağlantı hazırlanamadı. Tekrar deneyin; kaydınız kaydedildi.",
          }
        : {
            open: "Open Telegram",
            hint: "Tap Start in Telegram. Hermes will find your booking and help confirm it.",
            connected:
              "Telegram connected. Continue talking with the center in this chat.",
            error:
              "Couldn't prepare the link. Please try again; your booking is saved.",
          };
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col justify-center py-6 sm:py-8">
      <Card
        className="border-primary/20 bg-card/95 p-6 shadow-lg sm:p-8"
        data-testid="airhop-public-success"
      >
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Check className="h-6 w-6" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          {messages.standaloneEyebrow(organizationName)}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {card.status === "pending_confirmation"
            ? messages.successTitle
            : messages.status[card.status]}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {card.status === "pending_confirmation"
            ? messages.successDescription
            : `${card.childName} · ${card.groupName} · ${card.date} · ${card.startTime} · ${card.branchAddress}`}
        </p>
        <div className="mt-6 rounded-2xl bg-muted/60 p-4">
          <p className="text-sm font-medium">{messages.contactChannelTitle}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {messages.contactChannelDescription}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["telegram", "max", "whatsapp", "phone"] as const).map(
              (channel) => (
                <Button
                  className="min-h-11 sm:min-h-9"
                  data-testid={`airhop-contact-channel-${channel}`}
                  disabled={isSavingChannel || !managementToken}
                  key={channel}
                  onClick={() => onChooseContactChannel(channel)}
                  size="sm"
                  type="button"
                  variant={
                    card.preferredContactChannel === channel
                      ? "default"
                      : "outline"
                  }
                >
                  {messages.contactChannels[channel]}
                </Button>
              ),
            )}
          </div>
          {channelError ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {copy.error}
            </p>
          ) : null}
          {card.telegramConnected ? (
            <p className="mt-4 text-sm" role="status">
              {copy.connected}
            </p>
          ) : card.messengerHandoff ? (
            <div
              className="mt-4 space-y-3"
              data-testid="airhop-telegram-handoff"
            >
              <p className="text-sm text-muted-foreground">{copy.hint}</p>
              <Button asChild>
                <a
                  href={card.messengerHandoff.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {copy.open}
                </a>
              </Button>
            </div>
          ) : card.preferredContactChannel !== "none" ? (
            <div className="mt-4 text-xs text-muted-foreground" role="status">
              <p>
                {messages.contactChannelSaved(
                  messages.contactChannels[card.preferredContactChannel],
                )}
              </p>
              <p className="mt-1">{messages.contactChannelHonesty}</p>
            </div>
          ) : null}
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {managementToken ? (
            <Button asChild className="min-h-11 sm:min-h-9 sm:flex-1">
              <Link
                params={{ token: managementToken }}
                to="/booking/manage/$token"
              >
                {messages.openManagementCard}
              </Link>
            </Button>
          ) : null}
          {mode === "embedded" ? (
            <Button
              className="min-h-11 sm:min-h-9 sm:flex-1"
              onClick={onStartAnother}
              type="button"
              variant="outline"
            >
              {messages.startAnotherBooking}
            </Button>
          ) : (
            <Button
              asChild
              className="min-h-11 sm:min-h-9 sm:flex-1"
              variant="outline"
            >
              <Link onClick={onStartAnother} to="/booking">
                {messages.startAnotherBooking}
              </Link>
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
