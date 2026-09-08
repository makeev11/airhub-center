# Public booking: persistent date-selection action

The shared `PublicBookingFlow` now renders the occurrences step's Continue
button outside its scrolling `<main>`, in a non-shrinking bottom action area.
It appears only when an available occurrence is selected, transitions through
the existing contact-step handler, and unmounts on other steps. Current-main
analytics tracking is preserved. Both standalone and embedded modes use the
same component; no Hygge-specific condition was added to product code.

The action area uses the shell's width and theme and reserves its own layout
space, including the device safe-area inset. It does not cover the final slot.

## Local component extraction

The bottom action markup is now in `PublicBookingOccurrenceActions.tsx`.
`PublicBookingFlow` still owns the visibility condition (occurrences step with
an available lesson selected), localized label and callback that tracks step
completion before opening contacts. CSS, DOM placement and button type are
unchanged. This removes the flow file's 1,000-line size-check violation without
raising the limit or removing functionality. This source refactor is not a new
deployment; the demo release described below is unchanged.

The component's StrictMode unit test checks the localized button and one
callback per click. The repository browser tests now check no action before
selection, placement outside the scrolling flow, a stable button position while
scrolling, and removal after proceeding, in both standalone and embedded modes.
Verification after extraction: full desktop `pnpm check`, TypeScript and
`build:e2e` passed; 26 focused unit tests and all 14 public-booking Playwright
scenarios passed. No server or installed desktop application was changed.

## Deployment scope

Only `demo.airhop.ru` was updated. Backend remains f9730f5; database migrations,
Hermes runtime and production were not changed. The demo image is
`airhub-center-relay:f9730f5-booking-cta-20260907`, derived from the existing
f9730f5 image with an overlay of the rebuilt public-web assets. Old hashed
assets are retained for already-open clients.

The bundle was built from a clean archive of f9730f5 plus this UI change,
not from unrelated uncommitted analytics work in main. Build source and
Dockerfile are archived on the server at
`/opt/airhop/buzz-demo/releases/booking-cta-KYPgAqz9` and
`/opt/airhop/buzz-demo/releases/hygge-booking-cta-20260907.tgz`.
The canonical demo release config
`/opt/airhop/buzz-demo/releases/f9730f5.compose.yml` now selects this image.
Rollback config is
`/opt/airhop/backups/hygge-booking-cta-4ebcd0iq/release.compose.yml`.
Use the complete existing buzz-demo Compose configuration when rolling back;
do not restart or alter neighboring production services.

Other Center installations and installed desktop binaries are not updated by
this demo deployment. Include the shared source change in their normal next
release; no global rollout was performed.

## Verification

- Clean-base TypeScript check and Vite production build passed.
- Shared component React StrictMode test and focused Biome lint passed.
- Browser QA checks button absence before selection, visibility after selection,
  unchanged position while scrolling a long list, no horizontal overflow,
  successful transition to contacts, and removal of the action area afterward.
- Repeat against the authorized Hygge test environment:
  `BOOKING_TEST_ORIGIN=https://demo.airhop.ru node --experimental-strip-types scripts/check-hygge-booking-cta.mjs`
  from `desktop/` after activating Hermit.
- The test covers standalone and embedded `/booking/demo-host` modes at
  418×704, 320×568, and 1280×800. It stops before submitting any booking.
- Screenshots use the repository's animation-settling helper.

The live organization/branch display names and address were changed by the
user during this task. Those settings were preserved; they are not UI fixtures
hardcoded into the deployed product.
