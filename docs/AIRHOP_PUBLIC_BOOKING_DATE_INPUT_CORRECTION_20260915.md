# Public booking: исправление даты и Enter в Safari — 2026-09-15

## Исправленный контракт

Public booking снова использует единый `AirHopDateInput`, а не браузерный
`input[type=date]`. Пользователь может набрать дату цифрами; маска, доступное
имя, календарь и названия месяцев принадлежат locale публичного каталога, а не
языку браузера или окружающего интерфейса:

- `ru-RU`: `ДД.ММ.ГГГГ`, русский календарь;
- `pt-BR`: `DD.MM.AAAA`, бразильский португальский календарь.

Enter вызывает ту же текущую основную кнопку, что и pointer-click, на всех шагах
public booking. Обработчик установлен на `window` в capture phase. Это важно для
WebKit/Safari: pointer-click по кнопке там может не переносить фокус, поэтому
следующий `keydown` имеет `body` как target и не достигает обработчика на
внутреннем React-контейнере. Ограничения прежнего контракта сохранены: не
перехватываются модифицированный, повторный и composition Enter, `textarea`,
ссылки, кнопка «Назад» и disabled primary action.

## Причина корректирующего релиза

Предыдущий image-only релиз `7bb7b4aa8181` ошибочно закрепил нативное поле даты
как желаемое поведение. Chromium-only live-проверка Enter также не выявила
WebKit-расхождение фокуса. Пользовательская проверка в Safari показала оба
дефекта: системный календарь вместо согласованного поля и отсутствие перехода
по Enter. Эта запись явно заменяет решение о нативной дате в историческом
[`AIRHOP_PUBLIC_BOOKING_ENTER_RELEASE_20260915.md`](AIRHOP_PUBLIC_BOOKING_ENTER_RELEASE_20260915.md).

## Source и проверки до выкладки

- Source commit: `f14ced1a77cc65998cad22e2b3ab669c03bc97d8`.
- Release identity: `airhop-center-0.5.14-f14ced1a77cc`.
- Source tree: `0f845e9e3a7d12fc91ba12ee8c451cfc0d4c407e`.
- Production public-web aggregate SHA-256:
  `372f99d4ddb27f898c74a5e40a44b07857f534fb77435b19fc2352c9b57732ac`.
- `pnpm --dir desktop typecheck`: passed.
- `pnpm --dir desktop build:e2e`: passed.
- Полный `airhop-public-booking.spec.ts`: 32/32 passed в двух Playwright
  проектах, включая мобильные размеры и light/dark.
- `pnpm --dir desktop check`: passed; 16 существующих Biome info diagnostics
  вне изменённых файлов не являются ошибками.
- `git diff --check`: passed.

E2E отдельно меняет окружающую locale на `ru-RU` внутри формы `pt-BR` и
подтверждает, что поле остаётся `DD.MM.AAAA`, а календарь — португальским.
Сценарий Enter перед нажатием снимает фокус до `body`, воспроизводя поведение
Safari, из-за которого прежний обработчик не срабатывал.

## Production rollout

Target: `center-demo` (`buzz-demo`, `demo.airhop.ru`) с тем же public booking
runtime на `center.airhop.com.br` и `hygge.airhop.com.br`. Caddy, сайт, backend,
схема и данные не менялись.

Проверенный predecessor:

- image `airhub-center-relay:public-booking-enter-7bb7b4aa8181`;
- image ID `sha256:801c08f93de2cb96b84a96cd477da6d644f2f0541ea34ac76686f5c2d6dc51d8`;
- container `8e019934bcc24f1215b5461062ca233504ce36717b03db11ca7b64e05314b971`.

Новый образ собран как public-web layer поверх точного predecessor. SHA-256
`/usr/local/bin/buzz-relay` до и после совпал:
`0a290c1d051254e9266770614f3975542e9a1d91f52b94a9af7f5a26db9eb811`.
Штатный `airhop-demo-release.py plan/apply` проверил Docker daemon, полную
активную цепочку Compose overlays, отсутствие drift, immutable image ID и
неизменность всех защищённых контейнеров, затем применил замену под общим lock.

Установлено:

- image `airhub-center-relay:public-booking-date-enter-f14ced1a77cc`;
- image ID `sha256:38f6b552be552e7f6e8b2332f39f28865fe06254039814d6d9bf3fda44a9bdf9`;
- container `b55bd8ea7562e630837f5c466bc5f0abf0c5ef63dbc167b1d627b6f534541812`;
- health `healthy`, started `2026-09-15T21:43:37Z`;
- database migration остаётся 70.

## Live acceptance

На реально опубликованном bundle `booking-assets/index-DNZuSoNZ.js` выполнены
четыре браузерных сценария: Hygge `pt-BR` и demo `ru-RU` в Chromium и WebKit.
Во всех четырёх сценариях фокус принудительно снят до `body`, после чего Enter
провёл форму через выбор направления и времени до контактного шага.

Подтверждено на live:

- Hygge остаётся в modal iframe; URL страницы не меняется;
- `pt-BR`: `type=text`, `DD.MM.AAAA`, ввод `15.09.2021`, месяц `setembro`;
- `ru-RU`: `type=text`, `ДД.ММ.ГГГГ`, ввод `15.09.2021`, месяц `сентябрь`;
- brand mark загружается; page/console errors отсутствуют.

Во время live acceptance все non-GET запросы были перехвачены, поэтому тестовая
заявка и аналитические события в production не создавались.

## Откат

Release plan и точный predecessor сохранены в
`/opt/airhop/public-booking-date-enter-f14ced1a77cc/release-plan.json`.
Откат требует отдельного immutable overlay и нового reviewed plan/apply под тем
же lock. Прямой `docker compose up`, изменение Caddy или восстановление данных
для этого image-only релиза не нужны.
