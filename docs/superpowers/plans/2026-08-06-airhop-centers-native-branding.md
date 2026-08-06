# AirHop Centers Native Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a locally testable centers application named exactly `AirHop`, with AirHop browser/native branding, a separate application identity, and no Buzz artwork on AirHop-owned surfaces.

**Architecture:** Keep the Buzz-derived runtime and sidecar protocol names unchanged, but introduce one AirHop brand boundary for user-visible assets and labels. Browser and React surfaces consume the same vector mark; Tauri derives platform icons from that mark, while release/dev identifiers and the canonical `airhop://` scheme separate the application from Buzz. Legacy `buzz://` links remain readable but are no longer generated or registered by AirHop.

**Tech Stack:** React 19, TypeScript, Vite, Node test runner, Playwright, Rust, Tauri 2, macOS AppKit/iconutil.

## Global Constraints

- The product name is written exactly as `AirHop` in native metadata, technical configuration, and user-facing copy in every locale.
- Use the existing round AirHop mark with the paper plane as the canonical square asset.
- Render the product wordmark as text `AirHop`; do not use a localized or Cyrillic wordmark in the centers application.
- A user-supplied organization image always wins over the AirHop fallback.
- Never replace a person's avatar with the organization or product mark.
- Keep `buzz-*`, `BUZZ_*`, relay protocol names, and sidecar binary names where they are internal compatibility boundaries.
- Use release identifier `ru.airhop.centers.app` and development identifier `ru.airhop.centers.app.dev`.
- Register `airhop://` for AirHop; accept legacy `buzz://` input only for backward compatibility.
- Do not publish, notarize, sign, or upload a build in this plan.
- Preserve the dirty worktree: stage only the exact files named by each task.
- AirHop HQ is outside this plan and receives a separate `AirHop HQ` branding pass.

---

## File Structure

- `desktop/public/airhop/mark.svg` — canonical browser and native source mark.
- `desktop/public/airhop/apple-touch-icon.png` — generated browser touch icon.
- `desktop/src/shared/brand/airhopBrand.ts` — exact product name and public asset paths.
- `desktop/src/shared/brand/airhopBrand.test.mjs` — browser and Tauri branding contract.
- `desktop/src/shared/ui/airhop-brand/AirHopBrand.tsx` — reusable mark, wordmark, and lightweight loading presentation.
- `desktop/src/shared/ui/airhop-brand/airhop-brand.css` — transform/opacity-only loading motion with reduced-motion handling.
- `desktop/scripts/generate-airhop-assets.swift` — deterministic macOS icon/touch/DMG asset generation from the canonical SVG.
- `desktop/src-tauri/icons/*` — generated platform icon set and AirHop DMG background.
- Existing `desktop/src/shared/ui/buzz-logo/{BuzzMark,FuzzyLogo,FlappingBee}.tsx` — compatibility adapters so established callers render AirHop without a broad UI rewrite.
- Existing `desktop/src/features/sidebar/ui/CommunityRail.tsx` — organization fallback avatar.
- Existing `desktop/src/features/booking/lib/bookingAdminLocale.ts` — booking navigation product label.
- Existing `desktop/index.html` — favicon, touch icon, and document title.
- Existing Tauri config/plist/Rust deep-link and migration files — independent application identity and compatible link/storage migration.

---

### Task 1: Establish the AirHop browser brand contract

**Files:**
- Create: `desktop/public/airhop/mark.svg`
- Create: `desktop/src/shared/brand/airhopBrand.ts`
- Create: `desktop/src/shared/brand/airhopBrand.test.mjs`
- Modify: `desktop/index.html`

**Interfaces:**
- Produces: `AIRHOP_PRODUCT_NAME`, `AIRHOP_MARK_PATH`, `AIRHOP_TOUCH_ICON_PATH`, and `AIRHOP_DEEP_LINK_SCHEME` for later UI and native tasks.
- Consumes: the approved AirHop SVG geometry from `/Users/andreymakeev/Documents/airhop/public/favicon.svg`.

- [ ] **Step 1: Write the failing brand contract test**

```js
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
  assert.match(html, /rel="apple-touch-icon"[^>]+href="\/airhop\/apple-touch-icon\.png"/);
  assert.doesNotMatch(html, /href="\/buzz\.svg/);
});
```

- [ ] **Step 2: Run the focused test and verify the missing module/assets failure**

Run: `cd desktop && node --import ./test-loader.mjs --experimental-strip-types --test src/shared/brand/airhopBrand.test.mjs`

Expected: FAIL because `airhopBrand.ts` and `public/airhop/mark.svg` do not exist.

- [ ] **Step 3: Add the brand constants and canonical SVG**

```ts
export const AIRHOP_PRODUCT_NAME = "AirHop";
export const AIRHOP_MARK_PATH = "/airhop/mark.svg";
export const AIRHOP_TOUCH_ICON_PATH = "/airhop/apple-touch-icon.png";
export const AIRHOP_DEEP_LINK_SCHEME = "airhop";
```

Copy the complete approved SVG contents from `/Users/andreymakeev/Documents/airhop/public/favicon.svg` into `desktop/public/airhop/mark.svg` using `apply_patch`; keep its `64 × 64` view box and accessible vector geometry unchanged.

- [ ] **Step 4: Give the static document the AirHop identity**

Replace the existing Buzz favicon and empty title in `desktop/index.html` with:

```html
<link rel="icon" type="image/svg+xml" href="/airhop/mark.svg" />
<link rel="apple-touch-icon" href="/airhop/apple-touch-icon.png" />
<meta name="application-name" content="AirHop" />
<title>AirHop</title>
```

Change only comments that describe user-visible Buzz branding; leave the `buzz-theme-cache` storage key unchanged because it is an internal persisted compatibility key.

- [ ] **Step 5: Run the focused test**

Run: `cd desktop && node --import ./test-loader.mjs --experimental-strip-types --test src/shared/brand/airhopBrand.test.mjs`

Expected: the name/mark/document assertions pass; the touch icon existence is intentionally covered after Task 3 generates it.

- [ ] **Step 6: Commit the browser brand boundary**

```bash
git add desktop/public/airhop/mark.svg desktop/src/shared/brand/airhopBrand.ts desktop/src/shared/brand/airhopBrand.test.mjs desktop/index.html
git commit -m "feat(airhop): establish product branding contract"
```

---

### Task 2: Replace user-visible Buzz artwork with AirHop components

**Files:**
- Create: `desktop/src/shared/ui/airhop-brand/AirHopBrand.tsx`
- Create: `desktop/src/shared/ui/airhop-brand/airhop-brand.css`
- Modify: `desktop/src/shared/ui/buzz-logo/BuzzMark.tsx`
- Modify: `desktop/src/shared/ui/buzz-logo/FuzzyLogo.tsx`
- Modify: `desktop/src/shared/ui/buzz-logo/FlappingBee.tsx`
- Modify: `desktop/src/app/App.tsx`
- Modify: `desktop/tests/e2e/boot-splash.spec.ts`

**Interfaces:**
- Consumes: `AIRHOP_PRODUCT_NAME` and `AIRHOP_MARK_PATH` from Task 1.
- Produces: `AirHopMark`, `AirHopWordmark`, and `AirHopLoadingMark` React components.
- Compatibility: existing Buzz-named wrapper components preserve their public prop shapes but delegate rendering to AirHop components.

- [ ] **Step 1: Rewrite the boot splash expectation before implementation**

Replace the bee-wing assertion in `desktop/tests/e2e/boot-splash.spec.ts` with:

```ts
const mark = overlay.getByTestId("airhop-loading-mark");
await expect(mark).toBeVisible();
await expect(mark.locator("img")).toHaveAttribute("src", "/airhop/mark.svg");
await expect(mark).toHaveCSS("animation-name", "airhop-mark-breathe");
```

Rename the test to `boot splash holds with the AirHop mark, then dismisses` and update comments so they no longer promise a bee animation.

- [ ] **Step 2: Run the E2E test and verify it fails on the missing AirHop test id**

Run: `cd desktop && pnpm build:e2e && pnpm exec playwright test tests/e2e/boot-splash.spec.ts --project=smoke`

Expected: FAIL because `airhop-loading-mark` is absent.

- [ ] **Step 3: Implement lightweight AirHop brand primitives**

```tsx
import type * as React from "react";

import {
  AIRHOP_MARK_PATH,
  AIRHOP_PRODUCT_NAME,
} from "@/shared/brand/airhopBrand";
import { cn } from "@/shared/lib/cn";
import "./airhop-brand.css";

type MarkProps = Omit<React.ComponentProps<"img">, "alt" | "src"> & {
  decorative?: boolean;
};

export function AirHopMark({ className, decorative = true, ...props }: MarkProps) {
  return (
    <img
      {...props}
      alt={decorative ? "" : AIRHOP_PRODUCT_NAME}
      className={cn("block shrink-0 object-contain", className)}
      decoding="async"
      draggable={false}
      src={AIRHOP_MARK_PATH}
    />
  );
}

export function AirHopWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", className)}>
      <AirHopMark className="size-[1.35em]" />
      <span>{AIRHOP_PRODUCT_NAME}</span>
    </span>
  );
}

export function AirHopLoadingMark({ className, ariaLabel }: { className?: string; ariaLabel: string }) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn("airhop-loading-mark", className)}
      data-testid="airhop-loading-mark"
      role="img"
    >
      <AirHopMark className="h-full w-full" />
    </div>
  );
}
```

```css
@keyframes airhop-mark-breathe {
  0%, 100% { opacity: 0.82; transform: scale(0.96); }
  50% { opacity: 1; transform: scale(1); }
}

.airhop-loading-mark {
  animation: airhop-mark-breathe 1.8s ease-in-out infinite;
  transform-origin: center;
}

@media (prefers-reduced-motion: reduce) {
  .airhop-loading-mark { animation: none; }
}
```

- [ ] **Step 4: Convert the legacy logo components into compatibility adapters**

`BuzzMark.tsx` should render `AirHopMark`; `FuzzyLogo.tsx` should render `AirHopLoadingMark`; `FlappingBee.tsx` should render `AirHopLoadingMark`. Preserve accepted `className` and accessible label props so existing onboarding, agent activity, and huddle callers compile without changing their control flow. Do not import `BuzzLogoAnimation` from any of these three runtime adapters.

- [ ] **Step 5: Make the main loading gates use AirHop names directly**

In `desktop/src/app/App.tsx`, replace `BeeLoader` with `AirHopLoader`, import `AirHopLoadingMark`, and render it in `AppLoadingGate` and `CommunitySwitchGate`. Keep `__BUZZ_E2E__`, query client names, and storage keys unchanged because they are non-user-visible test/runtime contracts.

- [ ] **Step 6: Run the splash and production build checks**

Run: `cd desktop && pnpm build:e2e && pnpm exec playwright test tests/e2e/boot-splash.spec.ts --project=smoke && pnpm build`

Expected: two splash tests pass and Vite production build succeeds without a `BuzzLogoAnimation` import from the three compatibility adapters.

- [ ] **Step 7: Commit the UI branding components**

```bash
git add desktop/src/shared/ui/airhop-brand/AirHopBrand.tsx desktop/src/shared/ui/airhop-brand/airhop-brand.css desktop/src/shared/ui/buzz-logo/BuzzMark.tsx desktop/src/shared/ui/buzz-logo/FuzzyLogo.tsx desktop/src/shared/ui/buzz-logo/FlappingBee.tsx desktop/src/app/App.tsx desktop/tests/e2e/boot-splash.spec.ts
git commit -m "feat(airhop): replace Buzz artwork in app surfaces"
```

---

### Task 3: Generate deterministic browser, native, and DMG assets

**Files:**
- Create: `desktop/scripts/generate-airhop-assets.swift`
- Create: `desktop/public/airhop/apple-touch-icon.png`
- Modify generated files: `desktop/src-tauri/icons/32x32.png`
- Modify generated files: `desktop/src-tauri/icons/64x64.png`
- Modify generated files: `desktop/src-tauri/icons/128x128.png`
- Modify generated files: `desktop/src-tauri/icons/128x128@2x.png`
- Modify generated files: `desktop/src-tauri/icons/icon.png`
- Modify generated files: `desktop/src-tauri/icons/icon.icns`
- Modify generated files: `desktop/src-tauri/icons/icon.ico`
- Modify generated files: `desktop/src-tauri/icons/Square*.png`
- Modify generated files: `desktop/src-tauri/icons/StoreLogo.png`
- Modify generated files: `desktop/src-tauri/icons/ios/*.png`
- Modify generated files: `desktop/src-tauri/icons/dmg-background.png`
- Remove: `desktop/src-tauri/icons/buzz-source.png`
- Modify: `desktop/src/shared/brand/airhopBrand.test.mjs`

**Interfaces:**
- Consumes: `desktop/public/airhop/mark.svg` from Task 1.
- Produces: all icon files referenced by Tauri plus a 180-pixel browser touch icon and a 660 × 532 AirHop DMG background.

- [ ] **Step 1: Extend the contract test with generated-asset dimensions**

Add an assertion that `public/airhop/apple-touch-icon.png`, `src-tauri/icons/icon.icns`, `src-tauri/icons/icon.ico`, and `src-tauri/icons/dmg-background.png` exist. Read PNG headers for `apple-touch-icon.png` and `dmg-background.png` and assert dimensions `180 × 180` and `660 × 532`.

- [ ] **Step 2: Run the contract test and verify the touch icon assertion fails**

Run: `cd desktop && node --import ./test-loader.mjs --experimental-strip-types --test src/shared/brand/airhopBrand.test.mjs`

Expected: FAIL because the AirHop touch icon is absent.

- [ ] **Step 3: Add the deterministic AppKit generator**

The Swift script must:

1. accept `mark.svg`, output icon directory, and touch-icon path;
2. load the SVG with `NSImage(contentsOf:)`;
3. render a transparent square master at `1024 × 1024` with high interpolation;
4. generate PNG sizes required by the current Tauri icon directory;
5. assemble `icon.icns` with `/usr/bin/iconutil`;
6. invoke `pnpm tauri icon public/airhop/mark.svg --output src-tauri/icons` for the Windows and mobile derivatives after the master source is verified;
7. render a `660 × 532` DMG background using the app surface color, a centered mark, and the exact text `AirHop` drawn with `NSFont.systemFont(ofSize:weight:)`;
8. write `public/airhop/apple-touch-icon.png` at `180 × 180`.

Use `NSBitmapImageRep.representation(using: .png, properties: [:])` for PNG output and exit non-zero if the SVG cannot load or a generated file has the wrong dimensions.

- [ ] **Step 4: Generate and inspect all assets**

Run: `cd desktop && swift scripts/generate-airhop-assets.swift public/airhop/mark.svg src-tauri/icons public/airhop/apple-touch-icon.png`

Expected: the script prints every generated output and removes `src-tauri/icons/buzz-source.png` only after the new icon set exists.

Run: `sips -g pixelWidth -g pixelHeight desktop/public/airhop/apple-touch-icon.png desktop/src-tauri/icons/icon.png desktop/src-tauri/icons/dmg-background.png`

Expected: `180 × 180`, `512 × 512` or larger for `icon.png`, and `660 × 532` respectively.

- [ ] **Step 5: Run the asset contract test**

Run: `cd desktop && node --import ./test-loader.mjs --experimental-strip-types --test src/shared/brand/airhopBrand.test.mjs`

Expected: all browser and generated-asset assertions pass.

- [ ] **Step 6: Commit source and generated assets together**

```bash
git add desktop/scripts/generate-airhop-assets.swift desktop/public/airhop/apple-touch-icon.png desktop/src-tauri/icons
git commit -m "feat(airhop): generate native application artwork"
```

---

### Task 4: Brand the booking navigation and organization fallback avatar

**Files:**
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Modify: `desktop/src/features/sidebar/ui/CommunityRail.tsx`
- Modify: `desktop/tests/e2e/airhop-schedule.spec.ts`
- Modify: `desktop/tests/e2e/community-rail.spec.ts`

**Interfaces:**
- Consumes: `AirHopMark` from Task 2.
- Produces: exact `AirHop` navigation label and an AirHop organization fallback that does not affect personal avatars.

- [ ] **Step 1: Change E2E expectations first**

Rename the schedule test to `AirHop schedule is embedded beside the existing collaboration navigation` and expect `AirHop` instead of `Buzz AirHop`.

Add a community rail assertion:

```ts
const fallback = page.getByTestId("community-rail-default-airhop-mark").first();
await expect(fallback).toBeVisible();
await expect(fallback.locator("img")).toHaveAttribute("src", "/airhop/mark.svg");
```

- [ ] **Step 2: Run focused E2E and verify both assertions fail**

Run: `cd desktop && pnpm build:e2e && pnpm exec playwright test tests/e2e/airhop-schedule.spec.ts tests/e2e/community-rail.spec.ts --project=smoke`

Expected: FAIL on the old `Buzz AirHop` label and initials/bee fallback.

- [ ] **Step 3: Update the exact product label**

Change the Russian booking admin message to:

```ts
productName: "AirHop",
```

Do not translate or alter capitalization for future locales.

- [ ] **Step 4: Replace only the organization fallback**

In both `CommunityButton` and `CommunityDragOverlay`, keep the supplied `iconUrl` image branch unchanged. Replace the initials/bee fallback branch with:

```tsx
<span data-testid="community-rail-default-airhop-mark">
  <AirHopMark className="h-full w-full" />
</span>
```

Do not modify `SidebarProfileCard.tsx` or profile avatar logic.

- [ ] **Step 5: Run focused E2E**

Run: `cd desktop && pnpm build:e2e && pnpm exec playwright test tests/e2e/airhop-schedule.spec.ts tests/e2e/community-rail.spec.ts --project=smoke`

Expected: the AirHop navigation label and organization fallback assertions pass; supplied community icons remain unchanged.

- [ ] **Step 6: Commit navigation and organization branding**

```bash
git add desktop/src/features/booking/lib/bookingAdminLocale.ts desktop/src/features/sidebar/ui/CommunityRail.tsx desktop/tests/e2e/airhop-schedule.spec.ts desktop/tests/e2e/community-rail.spec.ts
git commit -m "feat(airhop): brand navigation and organization fallback"
```

---

### Task 5: Give the native application an independent AirHop identity

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json`
- Modify: `desktop/src-tauri/tauri.dev.conf.json`
- Modify: `desktop/src-tauri/Info.plist`
- Modify: `desktop/src/shared/brand/airhopBrand.test.mjs`

**Interfaces:**
- Produces: release bundle `ru.airhop.centers.app`, development bundle `ru.airhop.centers.app.dev`, native display name `AirHop`, and registered scheme `airhop`.
- Consumes: generated icons from Task 3.

- [ ] **Step 1: Add native metadata assertions**

```js
test("Tauri packages an independent AirHop application", () => {
  const release = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const development = JSON.parse(readFileSync("src-tauri/tauri.dev.conf.json", "utf8"));
  const plist = readFileSync("src-tauri/Info.plist", "utf8");
  assert.equal(release.productName, "AirHop");
  assert.equal(release.identifier, "ru.airhop.centers.app");
  assert.deepEqual(release.plugins["deep-link"].desktop.schemes, ["airhop"]);
  assert.equal(development.productName, "AirHop Dev");
  assert.equal(development.identifier, "ru.airhop.centers.app.dev");
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>AirHop<\/string>/);
  assert.doesNotMatch(plist, /<string>Buzz<\/string>/);
});
```

- [ ] **Step 2: Run the contract test and verify it fails on Buzz metadata**

Run: `cd desktop && node --import ./test-loader.mjs --experimental-strip-types --test src/shared/brand/airhopBrand.test.mjs`

Expected: FAIL on `productName` or `identifier`.

- [ ] **Step 3: Update Tauri release and development configuration**

In `tauri.conf.json`, set product name, identifier, and deep-link scheme to `AirHop`, `ru.airhop.centers.app`, and `airhop`. Keep external binary paths unchanged. In `tauri.dev.conf.json`, set `AirHop Dev` and `ru.airhop.centers.app.dev`.

- [ ] **Step 4: Update macOS user-visible metadata**

Set `CFBundleDisplayName` and `CFBundleName` to `AirHop`. Rewrite the microphone, camera, and local-network permission sentences to begin with `AirHop` while preserving their exact capability explanations.

- [ ] **Step 5: Run the contract test**

Run: `cd desktop && node --import ./test-loader.mjs --experimental-strip-types --test src/shared/brand/airhopBrand.test.mjs`

Expected: all native identity assertions pass.

- [ ] **Step 6: Commit native metadata**

```bash
git add desktop/src-tauri/tauri.conf.json desktop/src-tauri/tauri.dev.conf.json desktop/src-tauri/Info.plist desktop/src/shared/brand/airhopBrand.test.mjs
git commit -m "feat(airhop): assign independent native identity"
```

---

### Task 6: Canonicalize AirHop deep links while retaining legacy input

**Files:**
- Modify: `desktop/src/features/messages/lib/messageLink.ts`
- Modify: `desktop/src/features/messages/lib/messageLink.test.mjs`
- Modify: `desktop/src/features/messages/lib/openPopoverLink.ts`
- Modify: `desktop/src/features/messages/lib/openPopoverLink.test.mjs`
- Modify: `desktop/src/shared/api/inviteHelpers.ts`
- Modify: `desktop/src/shared/api/parseInviteInput.test.mjs`
- Modify: `desktop/src/shared/lib/maskedLink.test.mjs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/src/deep_link.rs`

**Interfaces:**
- Consumes: canonical scheme `airhop` from the brand contract.
- Produces: newly generated `airhop://message`, `airhop://join`, `airhop://connect`, and `airhop://add-community` links.
- Compatibility: parsers accept both `airhop://` and legacy `buzz://`; the OS bundle registers only `airhop://`.

- [ ] **Step 1: Add TypeScript tests for canonical output and legacy input**

```js
test("message links generate AirHop and parse legacy Buzz links", () => {
  assert.match(buildMessageLink({ channelId: "c", messageId: "m" }), /^airhop:\/\/message\?/);
  assert.equal(parseMessageLink("airhop://message?channel=c&id=m").ok, true);
  assert.equal(parseMessageLink("buzz://message?channel=c&id=m").ok, true);
});
```

Add matching invite and popover cases: `airhop://join` is canonical, while existing `buzz://join` fixtures continue to parse.

- [ ] **Step 2: Run the focused TypeScript tests and verify canonical generation fails**

Run: `cd desktop && node --import ./test-loader.mjs --experimental-strip-types --test src/features/messages/lib/messageLink.test.mjs src/features/messages/lib/openPopoverLink.test.mjs src/shared/api/parseInviteInput.test.mjs src/shared/lib/maskedLink.test.mjs`

Expected: canonical output assertions fail because links still use `buzz://`.

- [ ] **Step 3: Centralize supported schemes in message and invite parsing**

Use `airhop` as the builder scheme and a read-only set for parsers:

```ts
const CANONICAL_APP_SCHEME = "airhop";
const SUPPORTED_APP_SCHEMES = new Set([CANONICAL_APP_SCHEME, "buzz"]);
```

Reject every other custom scheme. Update user-facing code comments to say AirHop; retain comments that explicitly document legacy Buzz compatibility.

- [ ] **Step 4: Add Rust tests for AirHop canonical and Buzz legacy URLs**

Add tests that call the pure parsing helpers with both schemes and a helper assertion for:

```rust
fn supported_deep_link_scheme(scheme: &str) -> bool {
    matches!(scheme, "airhop" | "buzz")
}
```

Verify `other://message` is rejected.

- [ ] **Step 5: Update native command-line and deep-link dispatch**

In `lib.rs`, forward arguments whose parsed scheme is supported rather than checking only `arg.starts_with("buzz://")`. In `deep_link.rs`, accept `airhop` and legacy `buzz`, document `airhop://` as canonical, and retain existing action/query validation unchanged.

- [ ] **Step 6: Run TypeScript and Rust focused tests**

Run: `cd desktop && node --import ./test-loader.mjs --experimental-strip-types --test src/features/messages/lib/messageLink.test.mjs src/features/messages/lib/openPopoverLink.test.mjs src/shared/api/parseInviteInput.test.mjs src/shared/lib/maskedLink.test.mjs`

Run: `cd desktop/src-tauri && cargo test deep_link`

Expected: canonical AirHop and legacy Buzz cases pass; unsupported scheme cases fail closed.

- [ ] **Step 7: Commit deep-link compatibility**

```bash
git add desktop/src/features/messages/lib/messageLink.ts desktop/src/features/messages/lib/messageLink.test.mjs desktop/src/features/messages/lib/openPopoverLink.ts desktop/src/features/messages/lib/openPopoverLink.test.mjs desktop/src/shared/api/inviteHelpers.ts desktop/src/shared/api/parseInviteInput.test.mjs desktop/src/shared/lib/maskedLink.test.mjs desktop/src-tauri/src/lib.rs desktop/src-tauri/src/deep_link.rs
git commit -m "feat(airhop): canonicalize application deep links"
```

---

### Task 7: Align dev storage detection with the AirHop bundle identifiers

**Files:**
- Modify: `desktop/src-tauri/src/migration.rs`
- Modify: `desktop/src-tauri/src/migration_tests.rs`
- Modify: `desktop/src-tauri/src/migration_sync_guard_tests.rs`
- Modify: `desktop/src-tauri/src/reset.rs`

**Interfaces:**
- Produces: correct dev/release discrimination for `ru.airhop.centers.app(.dev)`.
- Compatibility: existing Buzz and Sprout directories remain legacy import sources; AirHop never writes back into them.

- [ ] **Step 1: Rewrite migration guard tests for AirHop identifiers**

```rust
#[test]
fn recognizes_airhop_dev_identifiers_only() {
    assert!(!is_dev_data_dir_name("ru.airhop.centers.app"));
    assert!(is_dev_data_dir_name("ru.airhop.centers.app.dev"));
    assert!(is_dev_data_dir_name("ru.airhop.centers.app.dev.my-worktree"));
    assert!(!is_dev_data_dir_name("ru.airhop.centers.app.developer"));
}
```

Add a migration fixture where current AirHop storage can discover the corresponding `xyz.block.buzz.app` directory as a legacy source without deleting it.

- [ ] **Step 2: Run focused migration tests and verify identifier failures**

Run: `cd desktop/src-tauri && cargo test migration_`

Expected: FAIL because the production code still treats `xyz.block.buzz.app.dev` as canonical.

- [ ] **Step 3: Introduce explicit current and legacy identifier constants**

```rust
const AIRHOP_RELEASE_IDENTIFIER: &str = "ru.airhop.centers.app";
const AIRHOP_DEV_IDENTIFIER: &str = "ru.airhop.centers.app.dev";
const LEGACY_BUZZ_RELEASE_IDENTIFIER: &str = "xyz.block.buzz.app";
const LEGACY_BUZZ_DEV_IDENTIFIER: &str = "xyz.block.buzz.app.dev";
```

Use AirHop constants for current-path classification and canonical dev sync. Use Buzz/Sprout constants only when locating an import source. Keep reset operations constrained to the identifier returned by the running Tauri application plus explicitly validated reset-trash siblings.

- [ ] **Step 4: Update reset test fixtures without broadening deletion scope**

Replace current-app fixture paths with `ru.airhop.centers.app` and `ru.airhop.centers.app.dev`; retain separate tests that prove unrelated Buzz paths are not removed during an AirHop reset.

- [ ] **Step 5: Run focused Rust tests**

Run: `cd desktop/src-tauri && cargo test migration_ && cargo test reset::tests`

Expected: AirHop dev classification, legacy discovery, and reset safety tests pass.

- [ ] **Step 6: Commit storage identity migration**

```bash
git add desktop/src-tauri/src/migration.rs desktop/src-tauri/src/migration_tests.rs desktop/src-tauri/src/migration_sync_guard_tests.rs desktop/src-tauri/src/reset.rs
git commit -m "fix(airhop): align storage migration with bundle identity"
```

---

### Task 8: Verify browser behavior and build a real local AirHop.app

**Files:**
- Modify only if verification finds a defect: files already named in Tasks 1–7.

**Interfaces:**
- Consumes: the complete browser/native branding implementation.
- Produces: verified local application at `desktop/src-tauri/target/release/bundle/macos/AirHop.app`.

- [ ] **Step 1: Run formatting, static checks, and focused unit tests**

Run: `pnpm check`

Run: `cd desktop && pnpm test -- --test-name-pattern='AirHop|booking|message link|invite'`

Expected: commands exit `0`; pre-existing informational Biome notices may remain but no new errors are introduced.

- [ ] **Step 2: Run production and E2E builds**

Run: `cd desktop && pnpm build && pnpm build:e2e`

Expected: TypeScript and Vite complete successfully and emit the AirHop title/assets.

- [ ] **Step 3: Run the focused visual/booking suite**

Run: `cd desktop && pnpm exec playwright test tests/e2e/boot-splash.spec.ts tests/e2e/airhop-schedule.spec.ts tests/e2e/airhop-public-booking.spec.ts tests/e2e/community-rail.spec.ts --project=smoke`

Expected: all selected tests pass.

- [ ] **Step 4: Check responsive AirHop-owned surfaces**

Open the booking schedule, public booking widget, onboarding/loading gate, and community rail at `320 × 568`, `351 × 704`, `768 × 1024`, and `1440 × 900`. At every size verify no horizontal overflow, the mark is crisp, `AirHop` is not truncated in the booking navigation, and personal avatars remain personal.

- [ ] **Step 5: Build the unsigned macOS application**

Run: `cd desktop && pnpm tauri build --bundles app --no-sign`

Expected: exit `0` and create `desktop/src-tauri/target/release/bundle/macos/AirHop.app`.

- [ ] **Step 6: Inspect the packaged metadata and artwork**

Run: `/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' desktop/src-tauri/target/release/bundle/macos/AirHop.app/Contents/Info.plist`

Expected: `AirHop`.

Run: `/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' desktop/src-tauri/target/release/bundle/macos/AirHop.app/Contents/Info.plist`

Expected: `ru.airhop.centers.app`.

Run: `/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' desktop/src-tauri/target/release/bundle/macos/AirHop.app/Contents/Info.plist`

Expected: `airhop`.

- [ ] **Step 7: Launch locally and perform the final visual smoke test**

Open `desktop/src-tauri/target/release/bundle/macos/AirHop.app`, verify the Finder/Dock icon, first loading frame, sidebar organization fallback, booking navigation, and absence of Buzz artwork on product-owned surfaces. Confirm that no Buzz installation is overwritten because the bundle identifier differs.

- [ ] **Step 8: Record final verification without sweeping unrelated changes**

Run: `git status --short` and `git diff --check`.

If verification required no code change, do not create an empty commit. If a defect was fixed, stage only the exact affected files and commit with a message describing that defect.

---

## Self-Review Results

- Spec coverage: browser title/favicon, exact product name, lightweight UI mark, loading gates, organization fallback, custom avatar precedence, native identifiers, icons, DMG, deep links, unsigned `.app`, and visual verification are assigned to Tasks 1–8.
- Boundary coverage: personal avatars and internal `buzz-*` runtime names are explicitly protected; AirHop HQ is explicitly excluded.
- Placeholder scan: the plan contains no deferred implementation markers.
- Type consistency: `AIRHOP_PRODUCT_NAME`, `AIRHOP_MARK_PATH`, `AIRHOP_TOUCH_ICON_PATH`, `AIRHOP_DEEP_LINK_SCHEME`, `AirHopMark`, `AirHopWordmark`, and `AirHopLoadingMark` have one spelling and signature throughout the plan.
