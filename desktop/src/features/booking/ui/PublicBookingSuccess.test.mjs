import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getPublicBookingMessages } from "../lib/publicBookingLocale.ts";
import { PublicBookingSuccess } from "./PublicBookingSuccess.tsx";

function render(locale, overrides = {}) {
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
      card: {
        status: "pending_confirmation",
        preferredContactChannel: "telegram",
        childName: "Платон",
        groupName: "Футбол",
        date: "2026-09-12",
        startTime: "10:00",
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
  assert.match(html, /Открыть Telegram/);
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
