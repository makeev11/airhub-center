# app.airhop.ru — пилот браузерного чата, 2026-09-15

Поручение пользователя: опубликовать `app.airhop.ru`, соединённый с AirHop
Центрами. Пользователь подтвердил добавление A-записи `app → 46.173.25.23`.
Target: `center-chat-app`; первая зарегистрированная staff-цель —
`https://demo.airhop.ru`. Это действующий Center, не loopback-эмулятор.

## Поставленный артефакт

- URL: <https://app.airhop.ru/chat> (`/` перенаправляет на `/chat`).
- Release: `chat-app-20260915-v2`; только `web/dist-chat-app`, 18 файлов.
- Base checkout: `7af9f69f7364faf12b4936c842e4c8a21b480a57` плюс локальные изменения
  этой задачи. Это **не** чистый commit-based image release. Артефакт запечатан
  манифестом каждого файла; прочие незакоммиченные изменения не являются поставкой.
- Archive SHA-256: `c662074765bdff0d52f99d1e53c48cbbe69e11e5824a0f6cfa0c47574a54ba25`.
- HTML SHA-256: `e7221eec18cd17c83387535e5fc4f666164d6be930ca74b7775805ce11d4ac20`.
- Caddy fragment SHA-256: `38cf79b86af48cdf5a7ab8517aa102427c625e2d9d41ac250a428cf7e5ad7eef`.
- Runner SHA-256: `131e2c4518ccf5e2d3d582eabd6318afe4219f39b776f6d9cefa89323bdddf82`.

Файлы находятся в
`/opt/airhop/demo-test/center-chat-app/releases/chat-app-20260915-v2/public`.
`current` указывает на этот релиз. Control/backup/plan/receipt находятся в
`/opt/airhop/site/chat-app-releases/chat-app-20260915-v2/`.
Исходный v1 отклонён artifact guard из-за macOS AppleDouble-файлов; он не
активировался и оставлен как staging. v2 перепакован без xattrs, guard не обойдён.

## Активация и неизменность соседей

Host `airhop-prod`, `root@46.173.25.23`, Docker daemon
`dbfb14a9-8404-4f21-ad3e-3481b173ea9a`.
Runner `deploy/airhop/chat-app/release.py` выполнил plan/apply под обоими lock:
`/opt/airhop/site/deploy.lock`, `/opt/airhop/buzz-demo/deploy.lock`.
Сверены host/mounted Caddyfile, импортированные фрагменты, live admin config,
ID/image/start time/Compose labels всех контейнеров и все файлы кандидата.
Перед apply предшественник повторно совпал; кандидат прошёл `caddy validate`.

Main Caddyfile изменён только добавлением import собственного фрагмента,
с сохранением inode bind mount, затем `caddy reload`. Compose, контейнеры,
БД, memberships и существующие Center CORS не менялись.

| Fingerprint | До | После |
| --- | --- | --- |
| Caddyfile SHA-256 | `5dd8d0343b48cb4c07afd44796ffe3cbd6b6912aee70571401a063a9de746450` | `ec6675c3a137968de582e670ddc83859a940e0dddf604b089417cdcc0a12a89a` |
| Canonical live JSON SHA-256 | `89b34af7b4d9d5452095b5ecc33311940ccf88de21289d2b24d5903197082d51` | `9448aa3c755557b5b53d06e8f9a42696f084bd4e5a41619a4e7cbdb0ba73b32f` |

Все контейнеры сохранили ID/image/start time/Compose labels. Demo relay остался
`airhub-center-relay:public-booking-date-enter-f14ced1a77cc`, image ID
`sha256:38f6b552be552e7f6e8b2332f39f28865fe06254039814d6d9bf3fda44a9bdf9`.
Site root и demo root отвечают 200, legacy HQ — ожидаемый 410.

## Внешняя проверка около 22:03–22:07 UTC

- NS1/NS2 REG.RU и resolver сервера вернули ожидаемую A-запись.
- HTTPS проверен без отключения TLS verification, через обычный DNS и локальный
  `--resolve` runner. Все 18 внешних файлов побайтово совпали с локальной сборкой.
- Страница реально открыта в браузере: список Center → форма пароля и NIP-AB
  QR/кода; графического логотипа нет. Пароль/ключи сотрудника агент не вводил.
- Непосредственные `wss://demo.airhop.ru` и `/pair` принимают upgrade с Origin
  `https://app.airhop.ru`; основной сокет выдаёт NIP-42 AUTH challenge. Это
  проверка транспорта, не успешной авторизации или чтения private channels.
- NIP-11 через `/centers/center-demo/` вернул self
  `5e83f8d72f81a0c176127c6239be37902ffd023ebbfb6939883c7d013bc459f9`.
- HTML: no-store, noindex, nosniff, frame DENY, no-referrer. CSP разрешает только
  self и точный `wss://demo.airhop.ru`; bridge не принимает произвольный upstream.
- Foreign Origin и cross-site metadata: 403. Admin, query, иной Center,
  `/release.py`, demo bootstrap: 404. PUT без Origin: 404; unsigned PUT с app
  Origin: 401. Никакие файлы/сообщения/аккаунты в этих пробах не создавались.
- Отсутствующий media hash дал **404**, не ожидавшийся первоначально 401;
  непосредственный Center вернул тот же результат. Live env не задаёт
  `BUZZ_REQUIRE_MEDIA_GET_AUTH`, а reviewed code по умолчанию оставляет его false.
  Клиент подписывает чтение, но **обязательность GET-авторизации на live relay
  этим релизом не установлена и не доказана**. Перед private-file rollout нужен
  отдельный review совместимости клиентов и политики media. Не выдавать эту
  пробу за passed authenticated-read gate, не менять общий relay flag вслепую.
- Служебный файл не выдаётся через соседний `/demo-test/`: существующий Site
  fallback отдаёт прежний HTML, не runner. Его root — другой release-каталог.

## Локальные проверки

`test:chat`: 17 passed; shared-app E2E: 4 passed; chat E2E: 17 passed и прежний
WebKit offline fixme; demo/mobile E2E: 10 passed, 2 phone-only desktop skips.
Biome, TypeScript, file-size/pubkey guards, normal/chat/chat-app/demo builds,
5 Python artifact guard tests, py_compile и diff check прошли.
Fixture E2E не являются live/physical-phone проверкой; shared-app routing fixture
блокирует service workers, отдельный offline gate не отменён.

## Откат и последующие релизы

Только при необходимости и неизменном предшественнике:

```sh
ssh root@46.173.25.23 python3 /opt/airhop/demo-test/center-chat-app/releases/chat-app-20260915-v2/release.py rollback chat-app-20260915-v2
```

Rollback проверяет receipt/config/live/container/import hashes под обоими lock,
возвращает сохранённый Caddyfile и reload с проверкой live hash. DNS, артефакты
и backups сохраняются. Если guard откажет, нельзя обходить его или перезатирать
новую конфигурацию: нужен новый review. Runner предназначен для первого релиза;
следующий update требует эквивалентного guarded update, не повторного first apply.

## Незакрытая приёмка

User pairing и desktop ↔ browser сообщения/вложения/read-state на live Center;
физические iPhone/Android, клавиатура, камера, suspend/resume и installed PWA;
Web Push (не реализован); media GET policy. Сейчас подключён только demo Center,
не все организации. `center.airhop.com.br` имеет public booking, но staff root
отвечает 404, поэтому не добавлен в registry. Никакие ключи из desktop не извлекались.
Это опубликованный пилот, а не объявление массовой готовности.
