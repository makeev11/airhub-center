import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getPublicBookingMessages } from "../lib/publicBookingLocale.ts";
import { PublicBookingSuccess } from "./PublicBookingSuccess.tsx";

function render(locale, overrides = {}, props = {}) {
  return renderToStaticMarkup(
    createElement(PublicBookingSuccess, {
      locale,
      messages: getPublicBookingMessages(locale),
      mode: "embedded",
      managementToken: null,
      isSavingChannel: false,
      organizationName: "AirHop",
      onStartAnother() {},
      onChooseContactChannel() {},
      ...props,
      card: {
        status: "pending_confirmation",
        preferredContactChannel: "telegram",
        childName: "Платон",
        groupName: "Футбол",
        date: "2026-09-12",
        startTime: "10:00",
        endTime: "11:00",
        branchAddress: "Адрес центра",
        ...overrides,
      },
    }),
  );
}

test("Telegram launch explains Start without claiming connection or confirmation", () => {
  const html = render("ru-RU", {
    messengerHandoff: {
      url: `https://t.me/airhop_bot?start=ahh_${"a".repeat(43)}`,
      expiresAt: "2026-09-05T20:00:00Z",
    },
  });
  assert.match(html, /Перейти в Telegram/);
  assert.match(html, /Нажмите Start/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /Telegram подключён/);
});

test("connected state is localized and hides the one-use launch link", () => {
  const html = render("pt-BR", { telegramConnected: true });
  assert.match(html, /Telegram conectado/);
  assert.doesNotMatch(html, /Abrir Telegram/);
});

test("authoritative confirmation replaces pending title and includes the real place and time", () => {
  const html = render("ru-RU", {
    telegramConnected: true,
    status: "confirmed",
  });
  assert.match(
    html,
    new RegExp(getPublicBookingMessages("ru-RU").status.confirmed),
  );
  assert.match(html, /Адрес центра/);
  assert.match(html, /10:00/);
});

test("unconfigured centers show no confirmation shortcuts or phone choice", () => {
  const html = render("ru-RU", { preferredContactChannel: "none" });
  assert.doesNotMatch(html, /airhop-contact-channel-|Подтвердите запись/);
});

test("only server-enabled confirmation channels are offered", () => {
  const html = render("ru-RU", { confirmationChannels: ["telegram"] });
  assert.match(html, /Подтвердите запись в мессенджере/);
  assert.match(html, /airhop-contact-channel-telegram/);
  assert.doesNotMatch(html, /Заявка ожидает подтверждения/);
  assert.match(html, /оставайтесь с нами на связи/);
  assert.doesNotMatch(html, /airhop-contact-channel-(max|whatsapp|phone)/);
});

test("confirmed bookings do not offer confirmation again", () => {
  const html = render("ru-RU", {
    status: "confirmed",
    confirmationChannels: ["telegram"],
  });
  assert.doesNotMatch(html, /Подтвердите запись|airhop-contact-channel-/);
});

test("local preview displays the messenger screen without a live link or waiting title", () => {
  const html = render(
    "ru-RU",
    { preferredContactChannel: "none" },
    { confirmationPreview: true },
  );
  assert.match(html, /Подтвердите запись в мессенджере/);
  assert.match(html, /Перейти в Telegram/);
  assert.match(html, /Перейти в MAX/);
  assert.match(html, /Перейти в WhatsApp/);
  assert.doesNotMatch(html, /Предпросмотр|чат не подключён/);
  assert.doesNotMatch(
    html,
    /Заявка отправлена|Заявка ожидает подтверждения|Подобрать другое занятие|https:\/\/t\.me/,
  );
});

test("messenger screen keeps booking details and does not repeat the age warning", () => {
  const html = render("ru-RU", {}, { confirmationPreview: true });
  assert.match(html, /airhop-public-booking-summary/);
  assert.match(html, /Футбол/);
  assert.match(html, /12 сентября/);
  assert.match(html, /10:00–11:00/);
  assert.match(html, /Адрес центра/);
  assert.match(html, /Перейти в Telegram/);
  assert.doesNotMatch(html, /airhop-public-age-notice/);
});

test("Telegram guidance follows its button and explains the bot and ongoing communication", () => {
  for (const props of [{ confirmationPreview: true }, {}]) {
    const html = render(
      "ru-RU",
      props.confirmationPreview
        ? {}
        : {
            messengerHandoff: {
              url: "https://t.me/airhop_bot?start=demo",
              expiresAt: "2026-09-12T10:00:00Z",
            },
          },
      props,
    );
    assert.ok(
      html.indexOf("Перейти в Telegram") < html.indexOf("Нажмите Start"),
    );
    assert.match(html, /бот поможет/);
    assert.match(html, /с записью/);
    assert.doesNotMatch(html, /чат центра|связи с центром|undefined/);
  }
});
