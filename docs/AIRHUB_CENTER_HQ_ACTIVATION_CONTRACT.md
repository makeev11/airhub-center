# AirHub Center ↔ HQ: deployment и owner enrollment contract

Статус: Center contract реализуется; HQ UI выпуска кода ещё не реализован
Дата: 2026-08-17

Документ фиксирует только взаимодействие AirHub Center с будущим AirHub HQ.
Текущая ветка HQ пока находится на стадии удаления старого Buzz и не считается
готовой реализацией этого контракта.

## 1. Один пользовательский сценарий кода

В AirHub Center нет двух последовательных кодов «для установки» и «для
владельца». После выбора языка пользователь видит одно поле:

- первый код выпускается для уже созданной организации и её deployment;
- claim подписывается локальным аккаунтом пользователя;
- одной транзакцией код связывает Center с организацией и назначает этот аккаунт
  единственным `owner`;
- последующий код, выпущенный владельцем для сотрудника, вводится на том же
  экране и добавляет роль, записанную сервером в приглашении.

Тип полномочия определяется сервером по самому коду, а не дополнительным
переключателем или вторым экраном. Код owner enrollment имеет префикс `ahc_1_`,
обычный код сотрудника — собственный непрозрачный формат; для человека это одна
операция «вставить код и продолжить» и один signed claim endpoint.

## 2. Граница ответственности

- HQ хранит карточку `CenterInstallation`, версию deployment и metadata выданных
  owner enrollment codes.
- Center хранит собственные операционные данные, привязку организации и
  авторитетный roster владельцев/сотрудников.
- HQ не копирует расписание, цены, места, клиентов и платежи Center.
- После активации Center работает при недоступном HQ. HQ не является proxy в
  пользовательском или публичном runtime.
- Приватный ключ аккаунта владельца создаётся и хранится на его устройстве и
  никогда не передаётся HQ или Center.

## 3. Deployment flow

```text
HQ operator selects site_telegram_center
→ deploy worker installs an exact Center release
→ HQ creates/binds the organization and installation record
→ HQ operator issues a short-lived one-time owner enrollment code
→ the owner receives the code through an approved secret channel
→ after language selection the owner enters the code in Center
→ Center verifies the signed claim and atomically binds organization + owner
→ Center is ready for work without HQ as a runtime dependency
```

Повтор deploy с тем же idempotency key и повтор claim тем же действующим
владельцем возвращают сохранённый результат. Ошибка Center не меняет успешный
статус сайта или Telegram.

### Универсальное приложение и поиск установки

На `airhop.ru/download` публикуется одна подписанная сборка AirHop Center для
каждой поддерживаемой платформы. Сборка не содержит адрес или данные конкретной
организации. Для bare owner-кода приложение сначала определяет, какому Center
этот код принадлежит.

Поиск не передаёт bearer-код в HQ. При выдаче нового кода HQ сохраняет только
`SHA-256` fingerprint высокоэнтропийного кода рядом с безопасными metadata
grant. Приложение считает тот же fingerprint локально и отправляет его через
`POST /api/hq/v1/activation/resolve`. Ответ содержит только `relayUrl`; название
организации, роли и рабочие данные не раскрываются. После этого исходный код и
локально подписанный claim отправляются напрямую в найденный Center.

Resolver не погашает код и не становится proxy: при недоступном HQ уже
активированный Center продолжает работать. Просроченный, отозванный, погашенный
или не являющийся последним живым grant не разрешается. Сам код, fingerprint и
resolver request запрещено помещать в URL, analytics и обычные логи.

## 4. Owner enrollment code

Grant должен быть:

- криптографически случайным и достаточной энтропии;
- короткоживущим;
- одноразовым;
- привязанным сервером к `installationId`, организации, environment и
  разрешённому release/profile, без повторного ввода этих полей владельцем;
- хранимым HQ и Center только как keyed digest/hash;
- возвращаемым HQ-клиенту только один раз при выпуске;
- отзываемым до погашения;
- не попадающим в URL, Git, screenshots, audit payload и обычные логи.

Погашение выполняется одной транзакцией: проверить digest, срок и deployment
binding → отметить код использованным → сделать подписавший аккаунт единственным
`owner` → привязать организацию к активному deployment → записать audit event.
Два параллельных claim не могут оба завершиться успешно.

Перевыпуск для той же установки автоматически отзывает старый живой код. Новый
код разрешено погасить и после первоначальной активации: это явная операция
восстановления/смены владельца. Предыдущий owner понижается до `member`, поэтому
утерянный или скомпрометированный ключ не сохраняет административный доступ.

## 5. Versioned API Center

Выпуск использует существующую deployment-global NIP-98 авторизацию
`RELAY_OPERATOR_PUBKEYS`. HQ может вызывать operator route напрямую из своей
операции deploy/выдачи кода; постоянно работающий connector для пользовательского
входа не требуется.

### Operator plane

- `POST /operator/airhop/center-activation-grants` — выпустить owner enrollment
  code. Требует
  `Idempotency-Key` и NIP-98 payload binding. Тело содержит `host`,
  `installationId`, `environment`, `releaseProfile`, `releaseVersion` и
  необязательный `ttlSeconds` (по умолчанию 86400, допустимо 60–86400). Код
  действует 24 часа с момента выпуска; после погашения owner identity не имеет
  TTL и остаётся активной до явного отзыва. Ответ `201`
  единственный раз содержит `activationCode`; идемпотентный replay возвращает
  `200` с теми же metadata без кода.
- `POST /operator/airhop/center-activation-grants/revoke` — идемпотентно
  отозвать непогашенный grant по `host` и `grantId`.
- `GET /operator/airhop/center-installations?host=…&installationId=…` — получить
  безопасные metadata установки и историю grants без кодов и digests.
- `POST /operator/airhop/center-installations/health-challenges` — необязательная
  техническая диагностика deployment. Она не выдаётся владельцу, не вводится в
  приложении и не участвует в допуске пользователя.

Выпуск разрешён только после создания активной AirHub organization в выбранном
tenant. Повторный выпуск атомарно отзывает предыдущий живой код для той же
установки.

### Bootstrap discovery plane HQ

- `POST /api/hq/v1/activation/resolve` — публичный минимальный lookup для
  универсального приложения. Тело содержит только 64-символьный lowercase
  `fingerprint = SHA-256(code)`. Успешный ответ содержит только `relayUrl`.
- Ответ всегда `Cache-Control: no-store`; неизвестный и неактивный fingerprint
  дают одинаковый нейтральный отказ без сведений об организации.
- Endpoint не заменяет signed claim и не выдаёт membership. Знание fingerprint
  позволяет узнать только публичный адрес Center, но не погасить grant.

### Единый enrollment plane

- `POST /api/invites/claim` — единый host-bound, rate-limited и payload-bound
  NIP-98 claim. Тело содержит `code` и необязательный `policy_receipt`.
- Код `ahc_1_...` вызывает owner enrollment; обычный invite вызывает добавление
  сотрудника. Клиент не передаёт `installationId`, organization, environment,
  release profile или желаемую роль: это уже зафиксировано сервером при выпуске.
- `POST /api/airhop/activation/v1/claim` остаётся совместимым signed alias для
  автоматизации, но не является вторым пользовательским сценарием.

Успешный owner claim сразу переводит установку в `ready`: доступ человека не
зависит от технической health-проверки. Повтор того же кода тем же действующим
owner идемпотентен. После погашения нового recovery-кода старый код не может
вернуть предыдущему владельцу роль owner.

Health challenge, status и version telemetry могут остаться операторской
диагностикой. Они не используют отдельный пользовательский код и не блокируют
работу уже активированного Center.

## 6. Требуемые операции HQ

- создать, перевыпустить и отозвать owner enrollment code;
- получить безопасные metadata установки и grants без исходных кодов;
- при необходимости получить release/config version, health-время и
  санитизированную ошибку.

Center принимает код на существующем onboarding-экране и подписывает claim
локальным аккаунтом. Все обычные операции после enrollment продолжают
использовать tenant-scoped, подписанный и аудируемый контур.

## 7. Состояния HQ-панели Center

`not_installed → provisioning → ready | degraded | failed → disabled`

- `not_installed` является нормой для профиля `site_telegram`.
- успешный owner claim переводит установку в `ready` для пользовательской
  работы;
- отдельная health-метка означает только результат последней диагностики, а не
  выдуманный continuous online status.
- отзыв непогашенного кода не деактивирует уже связанного владельца. Для
  отключения deployment нужна отдельная явная команда disable с аудитом.
- перевыпуск кода меняет owner без переустановки и не стирает историю; новый
  deployment получает новый `installationId`.

## 8. Приёмка

Сквозной тест должен доказать:

1. grant виден в открытом виде только в ответе на выпуск;
2. просроченный, отозванный и чужой код отклоняется;
3. параллельный claim имеет ровно один успешный результат;
4. успешный claim одной транзакцией назначает sole owner, записывает policy
   evidence и audit без секрета;
5. перевыпуск отзывает старый живой код, а recovery claim снимает owner с
   предыдущего ключа;
6. тот же экран и endpoint принимают последующие приглашения сотрудников;
7. после отключения HQ уже активированный Center продолжает обслуживать свои
   staff/public сценарии;
8. необязательный HQ health/status не раскрывает данные клиентов Center;
9. универсальная сборка по fingerprint получает только адрес правильного Center,
   не отправляя исходный код в HQ;
10. resolver не разрешает старый, просроченный, отозванный или уже погашенный
    grant и не кеширует ответы.
