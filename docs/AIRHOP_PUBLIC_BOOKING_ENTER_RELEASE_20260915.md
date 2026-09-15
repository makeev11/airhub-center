# Public booking: Enter и locale даты — релиз 2026-09-15

## Результат

В public booking для русского и бразильского португальского locale обычный
`Enter` вызывает текущую основную кнопку: продолжает шаги выбора, отправляет
валидную контактную форму на предпросмотр и подтверждает заявку с экрана
предпросмотра. Существующая кнопка остаётся единственной точкой валидации,
аналитики и отправки, поэтому отдельный сетевой путь для клавиатуры не появился.

Обработчик не перехватывает модифицированный, повторный или composition Enter,
`textarea`, ссылки, кнопку «Назад» и ещё не выбранные варианты. На экране
предпросмотра основная кнопка получает фокус, чтобы подтверждение вторым Enter
было явным. Финальная отправка защищена существующим состоянием `isSubmitting`.

Нативное поле даты сохранено как `input[type=date]`: public booking задаёт ему
`lang="ru-RU"` или `lang="pt-BR"` и `autocomplete="bday"`. Внешний вид сегментов,
их порядок и системная подпись календаря контролируются браузером/ОС; приложение
не заменяет их собственной маской. Одновременно устранена найденная утечка
русской фразы о допустимости записи в португальский предпросмотр.

## Source и проверки

- Source commit: `7bb7b4aa8181338192c839d50322162c9ee25df7`.
- Release identity: `airhop-center-0.5.14-7bb7b4aa8181`, tree
  `3dc649840b08dc6089011ead772d21c0921d6b2d`.
- Production public-web aggregate SHA-256:
  `24c3d1de288490fe8083d24f5364e792bda80f19ac8371c63cae19fd38dea27d`.
- `pnpm --dir desktop typecheck`: passed.
- `pnpm --dir desktop check`: passed; существующие Biome info diagnostics не
  являются ошибками.
- Targeted unit tests: 9 passed.
- Полный `airhop-public-booking.spec.ts`: 16 passed.
- Повторная приёмка RU, pt-BR и embedded после выноса обработчика: 3 passed.
- File-size ratchet и `git diff --check`: passed.

## Выкладка

Target: `center-demo` (`buzz-demo`, `demo.airhop.ru`) с публичным BR allowlist на
`center.airhop.com.br`; сайт `hygge.airhop.com.br` проксирует этот же public
booking runtime.

Перед переключением фактический predecessor был healthy:

- image `airhub-center-relay:ptbr-public-locale-56f452314592`;
- image ID `sha256:975aa77c3844fbf8b5ccdec6c9f0f0c306b39b2edfec9dcaef14455327511f5d`;
- container `1383bdd769d909c3f540f6545f4cfe1b78eb8ec988600c9278dcbd114a0cc15e`.

Новый образ создан как узкий public-web layer поверх точного predecessor; SHA-256
`/usr/local/bin/buzz-relay` совпал до и после:
`0a290c1d051254e9266770614f3975542e9a1d91f52b94a9af7f5a26db9eb811`.
Штатный `airhop-demo-release.py plan/apply` проверил Docker daemon, весь список
из 26 Compose overlays, current container/image, конфигурацию, соседние
контейнеры и применил замену под общим lock.

Установлено:

- image `airhub-center-relay:public-booking-enter-7bb7b4aa8181`;
- image ID `sha256:801c08f93de2cb96b84a96cd477da6d644f2f0541ea34ac76686f5c2d6dc51d8`;
- container `8e019934bcc24f1215b5461062ca233504ce36717b03db11ca7b64e05314b971`;
- health `healthy`, started `2026-09-15T20:56:34Z`;
- database migration остаётся 70; backend binary и данные не менялись.

После релиза `/booking` вернул HTTP 200 на `demo.airhop.ru`,
`center.airhop.com.br` и `hygge.airhop.com.br`. Во временных браузерных сессиях
RU и pt-BR формы дошли по Enter до контактного шага; у даты подтверждены
`type=date` и соответствующие `lang`, ошибок/предупреждений консоли нет.
Финальная live-заявка не создавалась: её отправка проверена изолированным E2E.

## Откат

Проверенный predecessor и полная цепочка сохранены в
`/opt/airhop/public-booking-enter-7bb7b4aa8181/release-plan.json`. Откат требует
отдельного reviewed plan/apply под тем же lock; прямой `docker compose up` или
изменение Caddy для этого релиза не нужны.
