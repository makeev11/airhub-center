import assert from "node:assert/strict";
import test from "node:test";

import { getWhatsAppOwnMetaSetupCopy } from "./whatsappOwnMetaSetupCopy.ts";

test("WhatsApp own-Meta setup exposes complete Brazilian Portuguese copy", () => {
  const copy = getWhatsAppOwnMetaSetupCopy("pt-BR");

  assert.equal(copy.title, "Conectar WhatsApp");
  assert.match(copy.partnerNumberDescription, /cada centro parceiro/);
  assert.match(copy.partnerNumberDescription, /AirHub HQ/);
  assert.match(copy.pricingDescription, /24 horas/);
  assert.match(copy.coexistenceDescription, /coexistência oficial/);
  assert.equal(copy.webhookSteps.length, 4);
  assert.equal(
    copy.metaConfirmed("+55 11 99999-0000"),
    "A Meta confirmou +55 11 99999-0000",
  );
});

test("Russian and English setup copy remain locale-specific", () => {
  assert.equal(
    getWhatsAppOwnMetaSetupCopy("ru-RU").title,
    "Подключить WhatsApp",
  );
  assert.equal(getWhatsAppOwnMetaSetupCopy("en-US").title, "Connect WhatsApp");
  assert.equal(getWhatsAppOwnMetaSetupCopy("tr-TR").title, "Connect WhatsApp");
});
