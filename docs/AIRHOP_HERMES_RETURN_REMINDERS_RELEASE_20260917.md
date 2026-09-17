# Напоминания вернуть разговор Гермесу — Center demo, 17 сентября 2026

Пользователь поручил реализацию, выкладку и отправку в GitHub. Обновлён только
relay зарегистрированной цели `center-demo` (`buzz-demo`, `demo.airhop.ru`).
HQ, browser static bundle, Hermes runtime и gateway не перекатывались.

## Поведение

После каждого третьего внешнего ответа сотрудника в human takeover — 3-го,
6-го, 9-го и далее — в том же треде появляется внутреннее системное сообщение
со structured mention автора порогового ответа и командой `@Гермес продолжай`.
Напоминание подписывает Relay. Оно не отправляется родителю и не меняет
владельца разговора. Успешный resume или новый cycle обнуляют интервал;
отключённый/paused Гермес, route, connection или deployment не копят счётчик.
Канон: [AIRHOP_SOURCE_OF_TRUTH.md](AIRHOP_SOURCE_OF_TRUTH.md).

## Установленный артефакт

| Поле | Значение |
| --- | --- |
| Source commit | `a51571b81e6f9d3e245f1e05e4ddab23d67d2dfd` |
| Git branch | `codex/hermes-dialogue-graph` |
| Source archive SHA-256 | `aaa10f4dbf3d36a945dd58b37fdaafff746ac8a4ceb24d31eb4dc294f62d97bf` |
| Relay binary SHA-256 | `b0278b26bfbc2a65c0b5eb7223827ddecab0b2f747368c8c5ad5cb5d775903ef` |
| Image | `airhub-center-relay:hermes-return-reminders-20260917-v1` |
| Image ID | `sha256:f28d470666e6923281292c6b58cd3e6c68bfab9a0a28c613fa438ce74209a239` |
| Container ID | `8db58825a372c19dd7980231f1193b13fa3393df7e45a4f6851525fc76000420` |
| Predecessor image ID | `sha256:18aa5dc5cb933f92d22d5491649dde204afa6e5c8567ea28b80450115e056229` |
| Schema | 71, no failed SQLx migrations |
| Release root | `/opt/airhop/hermes-return-reminders-20260917-v1` |

Коммит `590c176` отдельно закрепляет уже live ASR/Web Push source prerequisites,
`f04b5f9` — сам reminder, `a51571b` — отсутствовавший общий test fixture.
Каждый имеет `Signed-off-by`. Прочие dirty desktop/web изменения не вошли.
Сборка выполнена из clean worktree и Git archive, не из dirty working tree.

## Проверки и миграционный runbook

1. Read-only preflight подтвердил registered host/daemon, healthy predecessor,
   immutable image tag, целевой project, сети/тома и полную Compose-цепочку.
2. Cold Linux/amd64 build выполнил существующий Hostinger builder с 1 CPU,
   3 GiB memory без swap, 256 PIDs и одним Cargo job. Служебные symlinks
   repo/toolchain исключены из Linux context; Cargo source остался точным архивом.
   Соседние продуктовые контейнеры builder не изменились.
3. Проверенный ELF упакован поверх точного live Web Push v3 runtime image;
   user/entrypoint/Cmd/working directory и SHA-256 бинарника сверены.
4. Guarded image-only plan сохраняет все 32 исходных Compose entries, включая
   существующий повтор одного overlay, и добавляет ровно один entry (всего 33).
   Хеши 33 входов и 14 защищённых соседних контейнеров сохранены в `plan.json`.
5. `release-v2.py apply` удерживал `/opt/airhop/buzz-demo/deploy.lock` на всём
   backup/restore/preflight/apply. Бэкап schema 70 восстановлен в изолированную
   temporary database и мигрирован тем же кандидатом. У preflight нет live
   Redis, signing-key mounts и provider workers. Temporary DB/container удалены.
6. После preflight весь план повторно сверён под тем же lock. Compose вызван с
   явным `--project-name buzz-demo`, полной цепочкой, `--no-deps --no-build
   --pull never --wait`, только для `relay`. Живой auto-migrate применил 71.
7. Acceptance подтвердил exact image/binary/revision, schema/checksum 71,
   healthy, 0 restarts, `GET /health` = `ok`, публичный NIP-11 с сохранённой
   авторизацией, Web Push profile и UUID v4/v5 grammar, все 14 соседей неизменны.
   Синтетические сообщения реальным родителям не отправлялись.

Первый preflight честно остановился до DB connection: read-only root не позволил
default `./repos`. Runner v2 задаёт только temporary `BUZZ_GIT_REPO_PATH=/tmp/repos`.
Исходные sealed v1 inputs/image/plan не переписаны; v2 сохранён отдельно,
SHA-256 `eb51e075e207441a687b4efce195eab25f9c9d18a212593f7e753b71326fefb2`.

Исходники точных runners и Dockerfiles сохранены в
[`deploy/airhop/hermes-return-reminders-20260917`](../deploy/airhop/hermes-return-reminders-20260917).
Это одноразовый audited runbook: не запускать снова как общий deployer.
Receipts остаются в закрытом release root: `build-receipt.json`,
`package-receipt.json`, `backup-receipt-v2.json`,
`migration-preflight-receipt-v2.json`, `runner-v2-receipt.json`,
`apply-receipt.json`, `acceptance-receipt.json`.

## Backup и rollback

Перед успешным apply сохранён private PostgreSQL custom dump schema 70:
`/opt/airhop/hermes-return-reminders-20260917-v1/backup/buzz-v2.dump`,
2,460,082 bytes, SHA-256
`cf18c78435c1d09fa6bd5f217268f960e728bbed795922af121f96051879e840`.
Backup проверен восстановлением. В Git нет дампа, секретов или полного inspect.

Migration 71 добавляет counter и новую таблицу; image rollback не является
DB rollback. На ошибке применения reviewed runner способен вернуть только
предшествующий image с полной исходной цепочкой и узким rollback overlay
`BUZZ_AUTO_MIGRATE=false`, чтобы старый embedded migrator не отверг schema 71.
Новая таблица/данные при этом сохраняются; автоматического DB downgrade нет.
Этот rollback не потребовался. Поздний rollback требует нового чтения состояния,
review и общего demo-lock; восстановление БД — отдельное явное решение.

## Evidence и ограничения

Clean commit: `cargo fmt --all -- --check` и
`cargo clippy -p buzz-db -p buzz-relay --all-targets -- -D warnings` успешны;
`buzz-db --lib`: 196 passed / 238 infrastructure ignored. `buzz-relay --lib`:
928 passed / 38 ignored / 9 failed исключительно из-за отсутствующей local
PostgreSQL role `buzz` (старые admin/media tests), не assertion reminder-кода.
Четыре dedicated PostgreSQL reminder integration tests прошли отдельно:
порог/replay/recovery, resume reset, reopen reset и недоступность Гермеса.

Установленный backend и схема подтверждены; полный physical employee-client →
messenger scenario не подменяется этим receipt. Public client documentation
остаётся review без approval; этот продуктовый deploy не публикует её.
