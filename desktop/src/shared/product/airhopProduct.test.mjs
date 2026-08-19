import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AIRHOP_PRODUCT,
  isAirHopNativeCapabilityAllowed,
  isAirHopRelaySurfaceAllowed,
  isAirHopRouteAllowed,
  isAirHopSettingAllowed,
} from "./airhopProduct.ts";

test("Airhop exposes the focused Center surface and fails closed", () => {
  for (const route of [
    "booking.schedule",
    "booking.analytics",
    "booking.public",
  ]) {
    assert.equal(isAirHopRouteAllowed(route), true);
  }
  for (const route of ["huddle", "projects", "pulse", "workflows"]) {
    assert.equal(isAirHopRouteAllowed(route), false);
  }

  assert.equal(isAirHopSettingAllowed("custom-emoji"), true);
  assert.equal(isAirHopSettingAllowed("voice"), false);
  assert.equal(isAirHopSettingAllowed("experiments"), false);

  assert.equal(isAirHopNativeCapabilityAllowed("agents.stop-turn"), true);
  assert.equal(isAirHopNativeCapabilityAllowed("dictation.transcribe"), true);
  assert.equal(isAirHopNativeCapabilityAllowed("huddle.start"), false);
  assert.equal(isAirHopNativeCapabilityAllowed("builderlab.login"), false);
  assert.equal(isAirHopNativeCapabilityAllowed("terminal.execute"), false);

  assert.equal(isAirHopRelaySurfaceAllowed("booking"), true);
  assert.equal(isAirHopRelaySurfaceAllowed("knowledge"), false);
  assert.equal(isAirHopRelaySurfaceAllowed("workflow-hooks"), false);
});

test("Airhop manifest is immutable at every public collection boundary", () => {
  assert.equal(Object.isFrozen(AIRHOP_PRODUCT), true);
  assert.equal(Object.isFrozen(AIRHOP_PRODUCT.routes), true);
  assert.equal(Object.isFrozen(AIRHOP_PRODUCT.settings), true);
  assert.equal(Object.isFrozen(AIRHOP_PRODUCT.nativeCapabilities), true);
  assert.equal(Object.isFrozen(AIRHOP_PRODUCT.relaySurfaces), true);
  assert.equal(Object.isFrozen(AIRHOP_PRODUCT.sidecars), true);
});

test("native bundles expose exactly the product sidecars", () => {
  const desktopRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const expected = AIRHOP_PRODUCT.sidecars.map(
    (sidecar) => `binaries/${sidecar}`,
  );
  for (const configPath of [
    "src-tauri/tauri.conf.json",
    "src-tauri/tauri.windows.conf.json",
  ]) {
    const config = JSON.parse(
      readFileSync(new URL(configPath, `file://${desktopRoot}/`), "utf8"),
    );
    assert.deepEqual(config.bundle.externalBin, expected, configPath);
  }
});
