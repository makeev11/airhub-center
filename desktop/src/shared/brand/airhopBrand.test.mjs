import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  AIRHOP_DEEP_LINK_SCHEME,
  AIRHOP_MARK_PATH,
  AIRHOP_PRODUCT_NAME,
  AIRHOP_TOUCH_ICON_PATH,
} from "./airhopBrand.ts";

test("AirHop exposes one exact product name and asset contract", () => {
  assert.equal(AIRHOP_PRODUCT_NAME, "AirHop");
  assert.equal(AIRHOP_MARK_PATH, "/airhop/mark.svg");
  assert.equal(AIRHOP_TOUCH_ICON_PATH, "/airhop/apple-touch-icon.png");
  assert.equal(AIRHOP_DEEP_LINK_SCHEME, "airhop");
  assert.equal(existsSync("public/airhop/mark.svg"), true);
});

test("the browser document identifies AirHop before React loads", () => {
  const html = readFileSync("index.html", "utf8");
  assert.match(html, /<title>AirHop<\/title>/);
  assert.match(html, /rel="icon"[^>]+href="\/airhop\/mark\.svg"/);
  assert.match(
    html,
    /rel="apple-touch-icon"[^>]+href="\/airhop\/apple-touch-icon\.png"/,
  );
  assert.doesNotMatch(html, /href="\/buzz\.svg/);
});
