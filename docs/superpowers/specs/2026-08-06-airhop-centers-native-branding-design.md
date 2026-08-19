# AirHop Centers Native Branding Design

**Date:** 2026-08-06  
**Scope:** `airhop-center` application for children's centers
**Status:** Approved

## Goal

Turn the existing Buzz fork into a clearly independent AirHop application at every user-visible boundary: browser tab, native application bundle, loading state, navigation shell, default space avatar, and local installer. The result must be testable locally as a real macOS `.app` without publishing or Apple signing.

AirHop HQ is deliberately outside this implementation. It will receive a separate `AirHop HQ` branding pass after the centers application is verified, so its bundle identifier and visual distinction can be designed independently.

## Brand contract

- The product name is written exactly as `AirHop` in native metadata, technical configuration, and user-facing copy in every locale.
- The existing round AirHop mark with the paper plane is the canonical square source asset.
- The product wordmark is rendered as the exact text `AirHop` beside the canonical mark; localized or Cyrillic wordmarks are not used in the centers application.
- Buzz artwork must not remain in AirHop-owned product surfaces.
- Buzz interaction patterns and design-system components remain; this is a product branding change, not a visual redesign.

## Asset strategy

Keep one checked-in canonical mark in the desktop public assets. Render the exact text `AirHop` beside it where a horizontal brand signature is needed. Generate platform-specific derivatives from the canonical mark rather than maintaining unrelated hand-edited versions.

Required derivatives:

- browser favicon in SVG or compact PNG form;
- Apple touch icon;
- Tauri PNG icon sizes;
- macOS `.icns`;
- Windows `.ico`;
- store and Windows tile PNGs already referenced by the Tauri project.

The mark must stay legible at 16×16 pixels. Small derivatives use the round mark alone; they never include text. The `AirHop` text signature is used only where sufficient horizontal space exists. Assets should be optimized once at build time and loaded as static files; no runtime image processing or network dependency is introduced.

## Native application identity

Update the centers application's Tauri configuration to use:

- product name: `AirHop`;
- bundle identifier: `ru.airhop.centers.app`;
- development identifier: `ru.airhop.centers.app.dev`;
- deep-link scheme: `airhop`;
- AirHop platform icons and AirHop DMG artwork.

The separate identifiers prevent a local AirHop build from overwriting or sharing preferences with an installed Buzz application. Existing source-code binary names may remain `buzz-*` where renaming would affect internal protocols or bundled sidecars; those names are not user-visible and changing them is outside this branding pass.

## Web and shell branding

The desktop web document receives an AirHop favicon, Apple touch icon, and non-empty `AirHop` title. The native window may keep its hidden title-bar treatment, but operating-system metadata must expose the AirHop name.

Replace Buzz-owned marks in these product surfaces:

- cold-start loading gate;
- community-switch loading gate where a brand mark is shown;
- application navigation brand area;
- default organization/space avatar in the AirHop demo and first-run configuration;
- any AirHop-owned footer or attribution that currently says Buzz.

Do not replace generic bee/user avatars inside historical mock conversations unless they explicitly represent the application brand. Agent and user avatars remain independent profile data.

## Default avatar behavior

The AirHop mark is the fallback avatar for a newly created AirHop organization when no custom organization image exists. A user-supplied organization avatar always wins. The current user's personal avatar is not overwritten; personal identity and organization branding remain separate.

Demo and E2E seed data use the local AirHop mark so the preview matches the packaged application without external URLs.

## Local verification flow

Two verification levels are required:

1. `pnpm tauri dev` verifies native window behavior with the development frontend.
2. `pnpm tauri build --bundles app --no-sign` creates a real local macOS application at `desktop/src-tauri/target/release/bundle/macos/AirHop.app`.

The packaged application is opened locally and checked for:

- AirHop name in Finder, Dock, application metadata, and process-facing UI;
- AirHop icon in Finder and Dock at small and large sizes;
- no Buzz mark during cold start;
- correct AirHop favicon and title in the browser build;
- working AirHop deep-link registration without conflicting with Buzz;
- unchanged booking routes and persisted preview data.

A DMG is optional for this pass. Windows icons are generated and committed now, but the final `.exe`/installer is verified on Windows rather than cross-built on macOS.

## Failure handling and rollback

- Asset generation is deterministic and does not modify canonical source images.
- Existing Buzz icons remain recoverable through Git history; no destructive conversion is used.
- If a platform icon cannot be generated, the build stops rather than silently falling back to Buzz artwork.
- If a bundled sidecar or internal Rust package still requires a Buzz-prefixed technical filename, it remains unchanged and is documented as internal-only.
- The centers dev server and HQ dev server use separate ports during verification so one project cannot masquerade as the other.

## Tests and acceptance criteria

- Add a static branding contract test that checks the document title, favicon paths, Tauri product name, identifiers, deep-link scheme, and configured icon files.
- Run the existing AirHop-focused unit and E2E suites to ensure navigation and booking behavior remain intact.
- Run `pnpm check`, `pnpm build`, and `pnpm tauri build --bundles app --no-sign`.
- Inspect the generated icon at 16, 32, 128, 256, 512, and 1024 pixels.
- Open the packaged `.app` and verify there are no missing assets, horizontal layout regressions, or Buzz-owned marks in AirHop product surfaces.

The implementation is complete when a fresh local `AirHop.app` launches independently of Buzz and presents AirHop branding consistently from the operating system icon through the booking interface.
