import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageAgentOwner } from "./MessageAgentOwner.tsx";

for (const [state, props] of [
  ["unknown owner", {}],
  ["known owner", { ownerPubkey: "ab".repeat(32), ownerLabel: "Андрей" }],
  ["viewer owns agent", { ownerPubkey: "ab".repeat(32), ownerLabel: "you" }],
  ["owner profile still loading", { ownerPubkey: "ab".repeat(32) }],
]) {
  test(`Center message byline is absent: ${state}`, () => {
    assert.equal(
      renderToStaticMarkup(React.createElement(MessageAgentOwner, props)),
      "",
    );
  });
}
