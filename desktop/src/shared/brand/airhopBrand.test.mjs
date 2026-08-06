import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  AIRHOP_DEEP_LINK_SCHEME,
  AIRHOP_MARK_PATH,
  AIRHOP_PRODUCT_NAME,
  AIRHOP_TOUCH_ICON_PATH,
} from "./airhopBrand.ts";

function readPngDimensions(path) {
  const png = readFileSync(path);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

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

test("generated AirHop artwork matches the browser and installer contract", () => {
  assert.equal(existsSync("public/airhop/apple-touch-icon.png"), true);
  assert.equal(existsSync("src-tauri/icons/icon.icns"), true);
  assert.equal(existsSync("src-tauri/icons/icon.ico"), true);
  assert.equal(existsSync("src-tauri/icons/dmg-background.png"), true);
  assert.deepEqual(readPngDimensions("public/airhop/apple-touch-icon.png"), {
    width: 180,
    height: 180,
  });
  assert.deepEqual(readPngDimensions("src-tauri/icons/dmg-background.png"), {
    width: 660,
    height: 532,
  });
});

test("Tauri packages an independent AirHop application", () => {
  const release = JSON.parse(
    readFileSync("src-tauri/tauri.conf.json", "utf8"),
  );
  const development = JSON.parse(
    readFileSync("src-tauri/tauri.dev.conf.json", "utf8"),
  );
  const plist = readFileSync("src-tauri/Info.plist", "utf8");

  assert.equal(release.productName, "AirHop");
  assert.equal(release.identifier, "ru.airhop.centers.app");
  assert.deepEqual(release.plugins["deep-link"].desktop.schemes, ["airhop"]);
  assert.equal(development.productName, "AirHop Dev");
  assert.equal(development.identifier, "ru.airhop.centers.app.dev");
  assert.match(
    plist,
    /<key>CFBundleDisplayName<\/key>\s*<string>AirHop<\/string>/,
  );
  assert.doesNotMatch(plist, /<string>Buzz<\/string>/);
});
