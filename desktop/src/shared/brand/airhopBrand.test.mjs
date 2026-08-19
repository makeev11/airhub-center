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

test("Airhop exposes one exact product name and asset contract", () => {
  assert.equal(AIRHOP_PRODUCT_NAME, "Airhop");
  assert.equal(AIRHOP_MARK_PATH, "/airhop/mark.png");
  assert.equal(AIRHOP_TOUCH_ICON_PATH, "/airhop/apple-touch-icon.png");
  assert.equal(AIRHOP_DEEP_LINK_SCHEME, "airhop");
  assert.equal(existsSync("public/airhop/mark.png"), true);
});

test("the browser document identifies Airhop before React loads", () => {
  const html = readFileSync("index.html", "utf8");
  assert.match(html, /<title>Airhop<\/title>/);
  assert.match(html, /rel="icon"[^>]+href="\/airhop\/mark\.png"/);
  assert.match(
    html,
    /rel="apple-touch-icon"[^>]+href="\/airhop\/apple-touch-icon\.png"/,
  );
  assert.doesNotMatch(html, /href="\/buzz\.svg/);
});

test("generated Airhop artwork matches the browser and installer contract", () => {
  assert.equal(existsSync("public/airhop/apple-touch-icon.png"), true);
  assert.equal(existsSync("src-tauri/icons/icon.icns"), true);
  assert.equal(existsSync("src-tauri/icons/icon.ico"), true);
  assert.equal(existsSync("src-tauri/icons/dmg-background.png"), true);
  assert.deepEqual(readPngDimensions("public/airhop/apple-touch-icon.png"), {
    width: 180,
    height: 180,
  });
  assert.deepEqual(readPngDimensions("src-tauri/icons/dmg-background.png"), {
    width: 801,
    height: 491,
  });
});

test("Tauri packages an independent Airhop application", () => {
  const release = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const development = JSON.parse(
    readFileSync("src-tauri/tauri.dev.conf.json", "utf8"),
  );
  const plist = readFileSync("src-tauri/Info.plist", "utf8");

  assert.equal(release.productName, "Airhop");
  assert.equal(release.identifier, "ru.airhop.centers");
  assert.deepEqual(release.plugins["deep-link"].desktop.schemes, ["airhop"]);
  assert.equal(development.productName, "Airhop Dev");
  assert.equal(development.identifier, "ru.airhop.centers.dev");
  assert.match(
    plist,
    /<key>CFBundleDisplayName<\/key>\s*<string>Airhop<\/string>/,
  );
  assert.doesNotMatch(plist, /<string>Buzz<\/string>/);
});

test("first launch presents AirHop instead of the inherited Buzz wordmark", () => {
  const flow = readFileSync(
    "src/features/onboarding/ui/MachineOnboardingFlow.tsx",
    "utf8",
  );
  const help = readFileSync(
    "src/features/onboarding/ui/IdentityKeyHelpDialog.tsx",
    "utf8",
  );

  assert.match(flow, /AirHopWordmark/);
  assert.doesNotMatch(flow, /landing\/buzz-wordmark\.png/);
  assert.doesNotMatch(flow, /alt="Buzz"/);
  assert.doesNotMatch(flow, /Buzz account/);
  assert.doesNotMatch(help, /Buzz uses an identity key/);
  assert.doesNotMatch(help, /belongs to you, not Buzz/);
});

test("the main navigation keeps the AirHop brand visible for a single center", () => {
  const pinnedHeader = readFileSync(
    "src/features/sidebar/ui/AppSidebarPinnedHeader.tsx",
    "utf8",
  );

  assert.match(pinnedHeader, /AirHopWordmark/);
  assert.match(
    pinnedHeader,
    /data-testid="sidebar-airhop-wordmark"/,
    "single-center navigation must not depend on the multi-community rail",
  );
});

test("product-owned onboarding and account copy names AirHop", () => {
  const productCopyFiles = [
    "src/features/communities/ui/HostedCommunityOnboarding.tsx",
    "src/features/communities/ui/HostedCommunityCreateFlow.tsx",
    "src/features/onboarding/ui/BackupStep.tsx",
    "src/features/onboarding/ui/CommunityOnboardingFlow.tsx",
    "src/features/onboarding/ui/DefaultConfigStep.tsx",
    "src/features/onboarding/ui/KeyringLockedScreen.tsx",
    "src/features/onboarding/ui/RecoveryScreen.tsx",
    "src/features/onboarding/ui/RelaunchRequiredScreen.tsx",
    "src/features/onboarding/ui/ResetFailedScreen.tsx",
    "src/features/onboarding/ui/SetupStep.tsx",
    "src/features/onboarding/welcomeCanvas.ts",
    "src/features/onboarding/welcomeGuide.ts",
    "src/features/onboarding/welcomeKickoff.ts",
    "src/features/settings/ui/HostedCommunitiesSettingsCard.tsx",
    "src/features/settings/ui/ProfileSettingsCard.tsx",
  ];
  const inheritedProductPhrases =
    /Buzz identity|Welcome to Buzz|across Buzz|using Buzz|Take me to Buzz|Restart Buzz|Relaunch Buzz|Buzz (?:checks|keeps|needs|was unable)/;

  for (const path of productCopyFiles) {
    assert.doesNotMatch(readFileSync(path, "utf8"), inheritedProductPhrases);
  }
});
