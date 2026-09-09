import { formatPublicOccurrenceDateTime } from "../lib/publicBookingLocale";
import { Link } from "@tanstack/react-router";
import { CalendarDays, MapPin } from "lucide-react";
import { useEffect, useRef } from "react";

import type { PublicBookingManagementCard } from "@/features/booking/data/publicBookingService";
import type { PublicBookingMessages } from "@/features/booking/lib/publicBookingLocale";
import type { PreferredContactChannel } from "@/features/booking/model/bookingCore";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

export function PublicBookingSuccess({
  card,
  channelError = false,
  confirmationPreview = false,
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
  confirmationPreview?: boolean;
  locale?: string;
  isSavingChannel: boolean;
  managementToken: string | null;
  messages: PublicBookingMessages;
  mode: "standalone" | "embedded";
  onChooseContactChannel: (channel: PreferredContactChannel) => void;
  onStartAnother: () => void;
  organizationName: string;
}) {
  const channels =
    (confirmationPreview
      ? (["telegram", "max", "whatsapp"] as const)
      : card.confirmationChannels) ??
    (card.messengerHandoff || card.telegramConnected
      ? (["telegram"] as const)
      : []);
  const showConfirmation =
    card.status === "pending_confirmation" &&
    (channels.length > 0 || card.telegramConnected);
  const preparationAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (
      confirmationPreview ||
      !showConfirmation ||
      card.telegramConnected ||
      card.messengerHandoff ||
      channels.length !== 1 ||
      !managementToken ||
      isSavingChannel ||
      channelError ||
      preparationAttempt.current === managementToken
    )
      return;
    preparationAttempt.current = managementToken;
    onChooseContactChannel(channels[0]);
  }, [
    confirmationPreview,
    showConfirmation,
    card.telegramConnected,
    card.messengerHandoff,
    channels,
    managementToken,
    isSavingChannel,
    channelError,
    onChooseContactChannel,
  ]);
  const needsMessenger = showConfirmation && !card.telegramConnected;
  const copy = locale.startsWith("ru")
    ? {
        open: "Перейти в Telegram",
        hint: "Нажмите Start — бот поможет с записью.",
        connected:
          "Telegram подключён. Здесь вы сможете получать сообщения по записи и общаться с нами.",
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
  const channelHints: Partial<Record<PreferredContactChannel, string>> = {
    telegram: copy.hint,
    max: "Продолжите запись в чате.",
    whatsapp: "Напишите нам в чате.",
  };
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col py-1 sm:py-4">
      <Card
        className="border-primary/20 bg-card/95 p-5 shadow-sm sm:p-7"
        data-testid="airhop-public-success"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          {messages.standaloneEyebrow(organizationName)}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {needsMessenger
            ? messages.contactChannelTitle
            : card.status === "pending_confirmation"
              ? "Заявка отправлена"
              : messages.status[card.status]}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {needsMessenger
            ? messages.contactChannelDescription
            : card.status === "pending_confirmation"
              ? card.telegramConnected
                ? copy.connected
                : messages.successDescription
              : card.childName}
        </p>
        <div
          className="mt-4 space-y-2 rounded-xl bg-muted/45 p-3 text-sm"
          data-testid="airhop-public-booking-summary"
        >
          <p className="font-semibold">{card.groupName}</p>
          <p className="flex items-start gap-2 text-muted-foreground">
            <CalendarDays
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span>{formatPublicOccurrenceDateTime(card, locale)}</span>
          </p>
          <p className="flex items-start gap-2 text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{card.branchAddress}</span>
          </p>
        </div>
        {showConfirmation ? (
          <div className="mt-4">
            <div className="flex flex-wrap gap-4">
              {(!card.telegramConnected && !card.messengerHandoff
                ? channels
                : []
              ).map((channel) => (
                <div key={channel} className="w-full">
                  <Button
                    className="min-h-11 w-full text-base"
                    data-testid={`airhop-contact-channel-${channel}`}
                    disabled={
                      isSavingChannel ||
                      (!managementToken && !confirmationPreview)
                    }
                    aria-disabled={confirmationPreview || undefined}
                    aria-describedby={`airhop-channel-hint-${channel}`}
                    onClick={() => {
                      if (!confirmationPreview) onChooseContactChannel(channel);
                    }}
                    size="sm"
                    type="button"
                    variant="default"
                  >
                    {isSavingChannel
                      ? "Готовим переход…"
                      : `Перейти в ${messages.contactChannels[channel]}`}
                  </Button>
                  {channelHints[channel] ? (
                    <p
                      id={`airhop-channel-hint-${channel}`}
                      className="mt-2 text-xs leading-5 text-muted-foreground"
                    >
                      {channelHints[channel]}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            {channelError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {copy.error}
              </p>
            ) : null}
            {!card.telegramConnected && card.messengerHandoff ? (
              <div
                className="mt-4 space-y-3"
                data-testid="airhop-telegram-handoff"
              >
                <Button asChild className="min-h-11 w-full">
                  <a
                    aria-describedby="airhop-channel-hint-telegram"
                    href={card.messengerHandoff.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {copy.open}
                  </a>
                </Button>
                <p
                  id="airhop-channel-hint-telegram"
                  className="text-xs leading-5 text-muted-foreground"
                >
                  {channelHints.telegram}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {managementToken ? (
            <Button
              asChild
              variant={needsMessenger ? "link" : "default"}
              className="min-h-11 sm:min-h-9 sm:flex-1"
            >
              <Link
                params={{ token: managementToken }}
                to="/booking/manage/$token"
              >
                {messages.openManagementCard}
              </Link>
            </Button>
          ) : null}
          {!needsMessenger &&
            (mode === "embedded" ? (
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
            ))}
        </div>
      </Card>
      {needsMessenger ? (
        <Button
          className="mt-2 min-h-11 self-center text-xs text-muted-foreground"
          variant="link"
          onClick={onStartAnother}
          type="button"
        >
          Новая запись
        </Button>
      ) : null}
    </div>
  );
}
