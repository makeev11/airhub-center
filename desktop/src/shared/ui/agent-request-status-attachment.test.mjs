import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentRequestStatusCard,
  agentRequestStatusCopy,
} from "./agent-request-status-attachment.tsx";

const status = {
  version: 1,
  source_event_id: "aa".repeat(32),
  source_channel_id: "550e8400-e29b-41d4-a716-446655440000",
  target_role: "analyst",
  reason: "external_readers",
};

test("status card gives a localized corrective action without reader details", () => {
  const copy = agentRequestStatusCopy(status, "ru-RU");
  assert.equal(copy.title, "Аналитик не смог ответить");
  assert.equal(copy.action, "Проверить участников →");
  assert.match(copy.description, /внешнему участнику/);
  assert.doesNotMatch(
    copy.description,
    /pubkey|connector|parent_administrator/i,
  );
});

test("status card renders the corrective channel-members action", () => {
  const html = renderToStaticMarkup(
    React.createElement(AgentRequestStatusCard, {
      locale: "ru-RU",
      onOpenAgentSettings() {},
      onOpenChannelMembers() {},
      status,
    }),
  );
  assert.match(html, /Аналитик не смог ответить/);
  assert.match(html, /Проверить участников/);
  assert.match(html, /data-state="error"/);
  assert.doesNotMatch(html, /buzz:agent-request-status|source_event_id/);
});
