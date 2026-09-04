import assert from "node:assert/strict";
import test from "node:test";

import { routeSiteContentConfirmation } from "./siteContentConfirmation.ts";

test("routes an exact confirmation without changing its visible content", () => {
  assert.deepEqual(
    routeSiteContentConfirmation("Подтверждаю AE29DDC66344", [], "FECBF898"),
    ["fecbf898"],
  );
});

test("preserves explicit mentions and does not duplicate the marketer", () => {
  assert.deepEqual(
    routeSiteContentConfirmation(
      "  Подтверждаю AE29DDC66344  ",
      ["owner", "FECBF898"],
      "fecbf898",
    ),
    ["owner", "FECBF898"],
  );
});

test("does not route ordinary or malformed messages", () => {
  assert.deepEqual(
    routeSiteContentConfirmation(
      "Пожалуйста, Подтверждаю AE29DDC66344",
      ["owner"],
      "fecbf898",
    ),
    ["owner"],
  );
  assert.deepEqual(
    routeSiteContentConfirmation("Подтверждаю ae29ddc66344", [], "fecbf898"),
    [],
  );
});
