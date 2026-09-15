# Browser chat pilot — AirHop Center

2026-09-15. Browser pilot published at `app.airhop.ru`, **not a complete mobile replacement**.
Task: `buzz-russia-mobile-distribution` in the private AirHop knowledge workspace.

## Рабочий адрес для телефона

[Открыть чат](https://app.airhop.ru/chat), выбрать **AirHop Center**
(`demo.airhop.ru`), задать пароль этого браузера и привязать устройство через
уже подключённый desktop Center: настройки → подключение устройства → QR/код →
сверка шести цифр. Пароль и коды не пересылают администратору или агенту.
Это существующий сервер Center, не локальный демо-эмулятор. Другие Center
добавляются только после проверки точного origin и доступности staff/pairing.

Отдельная сборка `build:chat-app` предоставляет выбор Center. Vault разделён
по canonical origin; NIP-42 и pairing используют прямой `wss://demo.airhop.ru`,
а NIP-11 и Blossom — фиксированный same-origin bridge. CORS relay не расширен.
Подробности live-проверки и отката: [release receipt](AIRHOP_CHAT_APP_RELEASE_20260915.md).
Публикация проверена до экрана подключения. Фактическая переписка сотрудника
требует user pairing; Web Push и физическая мобильная приёмка ещё не выполнены.

## Локальное демо без аккаунта

Для просмотра без аккаунта запустите из корня репозитория:

```sh
. ./bin/activate-hermit
pnpm --filter buzz-web preview:chat-demo
```

Откройте [локальный чат](http://127.0.0.1:4188/chat). Сразу появится «Команда».
Напишите сообщение внизу — «Анна · демо» пришлёт автоматический ответ.
Можно открыть ветку, личную переписку и приложить тестовый файл.

Это **демонстрация на этом компьютере**, не рабочий Center и не ссылка для
телефона. Вымышленные сотрудники явно обозначены; настоящие документы и ключи
не нужны. Данные хранятся только в памяти процесса и исчезают после его
перезапуска. Пока команда работает, ссылка доступна; Ctrl+C останавливает демо.
Для телефона используйте отдельный рабочий HTTPS-адрес выше.

Демо собирается отдельно в `web/dist-chat-demo`, слушает только `127.0.0.1`,
проверяет Host/Origin и не обращается к действующим сервисам. Ни вход с
демонстрационной identity, ни автоматический собеседник не входят в
`build:chat` или `build:chat-app`; сборки проверяют отсутствие demo bootstrap. Демо не устанавливает
service worker. Это тот же интерфейс чата с отдельным локальным relay-эмулятором.

Проверка: `pnpm --filter buzz-web test:e2e:chat-demo` — Chromium desktop/Android и
WebKit/iPhone viewport, без аккаунта: сообщение/ответ, ветка, DM, файл,
границы доступа, отсутствие внешнего трафика и переполнения экрана.
Десять сценариев прошли 2026-09-15; два phone-only сценария намеренно не
выполняются на desktop. Это не проверка на физических телефонах.

### Внешний вид: основа Buzz / New Slack

По обратной связи вместо исходного зелёного оформления использованы палитра и
паттерны уже имеющегося desktop Buzz:
`desktop/src/shared/styles/globals/theme.css` (New Slack), `SidebarSection.tsx`
и `MessageThreadPanel.tsx`. Боковая панель со сворачиваемыми каналами/DM,
поиск сверху, плотная белая лента, квадратные аватары, действия у сообщения,
поле ввода с рабочими кнопками Markdown/файла/отправки. Импорта Tauri-зависимых
desktop-компонентов нет; браузерные transport/identity сохранены.

На ширине более 1080 px канал и ветка видны одновременно, с независимыми
черновиками и прокруткой. На меньшей ширине ветка занимает экран переписки;
закрытие возвращает исходный канал и черновик. На телефоне список чатов —
отдельный экран. Это перенос визуальной основы, не заявление полного паритета
со Slack/Buzz. Прежние 17 browser E2E и 15 core/branding тестов прошли;
WebKit offline fixme сохранён. Demo E2E дополнительно проверяют геометрию панелей,
черновики, Markdown-кнопку и сворачивание списка. Screenshot QA desktop/mobile
выполнена. Этот этап оформления не менял живые окружения; последующая публикация
отдельно описана в release receipt.

### Телефон — основная поверхность; без графического логотипа

Постоянное требование пользователя: отвергнутый графический знак не возвращать.
Удалены SVG чата и его подключения в header/login, а также копирование Apple icon
из desktop. В интерфейсе только текстовое название; установочная плитка — простая
чёрно-белая надпись «ЧАТ», без нового графического знака. Source/manifest tests
защищают эти точки от повторного подключения прежних brand assets.

На телефоне над перепиской одна компактная шапка. Поиск и форматирование
открываются по кнопке; основным действиям даны touch targets не меньше 44 CSS px.
В списке есть превью сообщений. Возврат из чата/ветки сохраняет черновик в текущей
сессии. Поле растёт до заданного предела; после ACK очищается без потери фокуса.
Исправлено подавление touch-click в WebKit при отмене pointerdown на отправке.

Оболочка учитывает высоту и смещение VisualViewport, safe areas и изменение
ориентации; pinch zoom не отключён. Это необходимо, поскольку клавиатура может
менять видимую область без изменения layout viewport
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport),
[Chrome](https://developer.chrome.com/blog/viewport-resize-behavior/)).
В E2E на 320/390 px проверены длинный ввод, touch-send, фокус, навигация,
поиск и отсутствие overflow. Видимая область 300 px со смещением 40 px —
**явная симуляция API**, не тест настоящей экранной клавиатуры. Проверка
физических Safari/Android и установленной PWA по-прежнему обязательна.

## Delivered slice

A dedicated React/TypeScript employee chat at `/chat`, using the existing Center
relay and identity. No new message database, Symfony service, or third-party chat
platform. The standalone `build:chat` entry does not load the repository browser.

- Existing employee pairs from desktop using the NIP-AB QR or pasted pairing URI.
  Both devices must confirm matching six-digit SAS; source transcript is verified.
  Imported identity is pinned to this Center and validated with NIP-42.
- Browser-local password protects the saved key with AES-GCM / PBKDF2-SHA256
  (600,000 iterations, random salt and IV, authenticated origin and public key).
  Neither password nor unencrypted private key is persisted. This protects at rest;
  it is not hardware-backed storage and does not defeat same-origin XSS.
- Existing joined channels and hidden-group DMs; per-user hidden DM snapshot is
  respected. Relay-signed membership/metadata are checked against NIP-11 `self`.
- Messages, reply threads, basic Markdown, search within a conversation, own
  edits/deletions, reactions. Unsupported business cards are not executable UI.
- Files up to 20 MB; JPEG/PNG/WebP photos are re-encoded before upload to remove
  EXIF. Signed Blossom upload/read, pinned media origin, redirects disabled.
  Remote images do not auto-load. Non-image files download as octet-stream.
- Outgoing messages need a relay ACK. Ambiguous retries reuse the identical signed
  event ID; drafts survive switching conversations in the current session.
- Per-visible-message NIP-RS markers, self-encrypted and compatible with desktop.
  A collapsed reply is not marked read just because its channel/root is open.
  Stable 32-hex slots and a separate client ID are reconciled before first publish;
  an occupied slot rotates instead of overwriting another installation.
- Manual lock; background lock after ten minutes also checks elapsed time on
  return (mobile browsers can suspend timers). Leaving the page locks the session.
- Home-screen manifest, Apple touch icon and versioned public-shell service worker.
  Caches contain application assets, **not messages, files, credentials or API
  responses**. Offline shell is available; offline message history is not promised.
  Offline reload is verified in Chromium. Playwright WebKit aborted that scenario
  with an internal navigation error; it remains a visible fixme/device gate,
  not a passing Safari offline claim. Playwright documents service-worker tooling
  as [Chromium-only](https://playwright.dev/docs/service-workers).

## Build and local verification

From the repository root, first activate the normal Hermit environment:

```sh
. ./bin/activate-hermit
pnpm --filter buzz-web test:chat
pnpm --filter buzz-web typecheck
pnpm --filter buzz-web check:file-sizes
pnpm --filter buzz-web check:pubkey-truncation
pnpm --filter buzz-web test:e2e:chat
```

`test:e2e:chat` builds `web/dist-chat` and uses a dedicated preview port 4187.
Its fixture emulates a relay with valid Nostr signatures and independent
source-side ECDH/HKDF pairing. It is **not** a connection to a real Center.
Projects cover Chromium/Pixel viewport and WebKit/iPhone viewport; those are
browser-engine checks, **not tests on physical Android/iPhone devices**.

### Verification receipt, 2026-09-15

- Core/transport/branding/Center-isolation tests: **17 passed** (including independent desktop
  read-state validation, distinct IDs for intentionally repeated same-second
  messages, rejected-logo guard and text-only installation PNG validation).
- Mobile viewport E2E: **17 passed, 1 explicit WebKit offline fixme**. Includes
  pairing and vault, channels/DMs/threads, search, own edits/deletion, e-only native
  reactions, dropped-ACK idempotency, draft switching, signed upload/read,
  denied-access and inert-HTML checks; Chromium offline reload passed.
- TypeScript, Biome, web file-size and public-key display guards: passed.
- Relay router unit tests: **9 passed**, including chat route isolation and
  exact-host WebSocket CSP / hostile Host rejection. Command:
  `cargo test -j 2 -p buzz-relay --lib router::tests --offline`.
- Relay configuration unit tests: **29 passed** via
  `cargo test -j 2 -p buzz-relay --lib config::tests --offline`.
- Workspace Rust formatting and `git diff --check`: passed.
- Normal web, isolated chat, shared app and local demo builds: passed.
- Shared app E2E: **4 passed**, Chromium/Android and WebKit/iPhone viewports;
  per-Center vault isolation, signed sending and invalid registry fail-closed.
  Service workers are blocked in this routing fixture; this is not a Safari
  offline check. The independent offline gate above is unchanged.
- Static-release artifact guard: **5 passed**; public allowlist, no symlinks,
  no demo bootstrap and only the reviewed Center registry.
- Mobile and desktop screenshots were visually reviewed from synthetic test data.
- The Web CI job now includes chat unit tests, both browser engines and evidence
  artifacts. The workflow was edited locally; no remote CI run is claimed.
- Full `just test`, Docker image build, authenticated live interoperability and
  physical-device acceptance have not run. Live DNS/TLS/assets/NIP-11/WS handshake
  and pairing socket upgrades were checked separately. The `just test` helper starts
  shared default-name containers and may migrate/seed the configured database;
  it must be isolated explicitly before use. Docker is available, but no database
  or Compose stack was modified for this pilot.

Passing fixture tests is evidence about this browser implementation, not proof
of compatibility with a deployed Center. See the release gates below.

For an **actual-client connection-screen** preview (without the demo server):

```sh
pnpm --filter buzz-web build:chat
pnpm --filter buzz-web exec vite preview --outDir dist-chat --host 127.0.0.1 --port 4189 --strictPort
```

Without a relay, this preview only demonstrates the connection screen. For an
interactive no-account demo use the command at the top of this document. Do not
paste production credentials into a development preview. Use an isolated Center
and test identity for real pairing/interoperability acceptance.

## Explicit deployment boundary

The relay only exposes the employee bundle when `BUZZ_CHAT_WEB_DIR` points to
the **isolated** `web/dist-chat` build. In the Docker image its location is
`/srv/buzz/chat`; it is bundled but **not enabled by default**.

Only `/chat`, `/chat/`, `/chat-assets/*`, `/chat.webmanifest`, `/chat-sw.js`
and `/chat-touch-icon.png` serve the chat bundle. The legacy `/chat-icon.svg`
allowlist entry has no asset and returns 404. Admin host handling runs first. Existing
`BUZZ_WEB_DIR`, booking, invite, repository and media routing are not replaced.
Chat HTML has same-origin CSP, no-referrer, nosniff and no-store headers.
The CSP explicitly allows the exact request host's `wss://` origin (and `ws://`
only for loopback development), because `'self'` does not cover WebSocket schemes
in every browser ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src)).
Host characters are validated before constructing the policy; forwarded hosts
and wildcard WebSocket destinations are not trusted.
Production uses same-origin HTTPS; do not bake a different relay origin into
this bundle without reviewing its CSP and identity boundaries.

The preceding opt-in describes a same-origin relay-hosted build, not the new
shared app deployment. User-authorized `center-chat-app` uses a separate static
build and a scoped Caddy fragment, under both Site and demo locks. DNS was added
by the user; Caddy was reloaded without container/Compose/database changes.
No app-store release occurred. Future updates still require the canonical map,
exact target, predecessor guards and locks; this document does not grant authority.

## Remaining release gates

1. **Web Push is not implemented.** The UI says so. Existing NIP-PL/APNs is not
   a Web Push service. Add authenticated browser subscriptions, VAPID sender,
   revocation and delivery/error handling; verify locked-phone delivery separately.
   Registering a service worker or showing an install icon does not pass this gate.
2. Test actual desktop ↔ browser pairing, messages, media and read-state against
   an isolated real relay, then physical iPhone and Android (including camera,
   keyboard, installation, suspend/resume and revoked membership).
3. Mobile-first staff invitation without an already signed-in desktop, dedicated
   per-device credentials/revocation, recovery and multi-device key rotation are
   not implemented here. Forgetting the browser vault does not revoke the shared
   Nostr identity on the server.
4. Existing conversations are supported; new DM/channel creation, mention picker,
   business-card parity, huddles/audio, per-channel notification settings and a
   native Android package are outside this first slice.
5. History loads the latest 100 messages per channel/page (thread limit 500;
   search 100). Initial global feed/unread counts cover loaded events, not a
   complete unread index. Dense same-second pagination, large-channel performance,
   long-offline catch-up beyond the initial window and read-state retention need
   expanded coverage before calling the client lossless or feature-complete.
   Manual-unread override semantics are not implemented; only channel/thread/message
   read frontiers are interpreted, so full unread parity is not claimed.
6. Read markers are bounded to 250 entries per browser slot. Drafts are memory-only
   and are lost when the chat is locked/reloaded; the page warns before unloading
   unsent drafts. No background send queue is claimed.

These are visible follow-ups, not accepted production risks. This first slice
can be exercised at the published pilot URL; it is not ready for general staff rollout.
