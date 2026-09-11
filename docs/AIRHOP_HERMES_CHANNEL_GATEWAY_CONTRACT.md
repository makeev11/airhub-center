# AirHop Hermes Channel Gateway contract

Статус: server foundation, Telegram self-service, WhatsApp own-Meta
provisioning и hosted WhatsApp text adapter реализованы; реальный Meta E2E и
template lifecycle остаются release gates.
Дата: 2026-09-11

## Граница ответственности

AirHop relay владеет каноническим Buzz-тредом, desired state подключения,
зашифрованным credential store, маршрутом, inbound deduplication и durable
outbound. Тонкий Hermes adapter получает токен только для назначенного ему
connection, владеет webhook/polling, typing, media и вызовом Telegram либо
WhatsApp API. Model loop не получает provider payload и не вызывает provider
API напрямую.

В первой версии допустимы только provider IDs:

- `telegram` — upstream Telegram platform adapter Hermes Agent;
- `whatsapp_cloud` — официальный Meta WhatsApp Cloud API transport без
  WhatsApp Web/QR-сессии.

Обычные connection/runtime endpoints не принимают bot token, Meta access token,
app secret или сырой webhook secret. Единственное исключение для Telegram:
write-only self-service endpoint принимает BotFather token, проверяет `getMe`,
шифрует AES-256-GCM с tenant/connection/provider AAD и сохраняет только
ciphertext. Ключи шифрования и стабильный HMAC index key остаются вне Postgres.
Токен никогда не попадает в Nostr event, control-plane response или лог.

## Аутентификация

Все запросы используют существующую tenant-scoped NIP-98 авторизацию AirHop.
Credential-free desired/observed state читают active staff, а изменяет только
owner/admin. Runtime endpoints доступны только
exact `connectorPubkey`, сохранённому в connection. Этот же scoped integration
principal подписывает inbound Buzz event. Родитель остаётся trusted external
identity/conversation metadata и не получает фиктивный Nostr key.

### Подключить Telegram из Airhop Center

`POST /api/airhop/integrations/v1/channel-connections/telegram`

```json
{
  "token": "<BotFather token>",
  "hermesEnabled": true,
  "routing": { "buzzChannelId": null, "branchId": null }
}
```

Endpoint доступен только owner/admin, использует NIP-98 payload hash и не
отражает token в ответе. Relay вызывает фиксированный Telegram `getMe`, получает
безопасные bot id/name/username, создаёт connection и credential одной
транзакцией. Повторное подключение того же токена в одной организации
отклоняется keyed fingerprint, не раскрывающим credential.

Self-service включается только при совместной настройке:

- `BUZZ_AIRHOP_CHANNEL_CREDENTIAL_INDEX_KEY`;
- `BUZZ_AIRHOP_CHANNEL_CREDENTIAL_KEYS` (`version:64-hex-key`);
- `BUZZ_AIRHOP_CHANNEL_CURRENT_KEY_VERSION`;
- `BUZZ_AIRHOP_TELEGRAM_CONNECTOR_PUBKEY`.

При отсутствии полного keyring GET остаётся доступным, но сообщает UI, что
Telegram provisioning отключён; write endpoint fail-closed возвращает 503.

### Подключить собственное Meta-приложение

`POST /api/airhop/integrations/v1/channel-connections/whatsapp-cloud`

```json
{
  "appId": "<numeric Meta App ID>",
  "appSecret": "<write-only App Secret>",
  "wabaId": "<numeric WABA ID>",
  "phoneNumberId": "<numeric Phone Number ID>",
  "accessToken": "<write-only System User Token>",
  "hermesEnabled": true,
  "routing": { "buzzChannelId": null, "branchId": null }
}
```

Owner/admin endpoint проверяет токен чтением phone list выбранного WABA и
требует точного совпадения Phone Number ID. Credential хранится как
AES-256-GCM envelope с App ID, App Secret, WABA ID, Phone Number ID, access
token и сгенерированным Verify Token. Keyed fingerprint строится по App ID, а
отдельное DB-ограничение — по Phone Number ID. Поэтому одно приложение или один
номер нельзя случайно подключить дважды в одной организации. В первой версии
для каждого номера требуется отдельное Meta-приложение: callback у Meta
app-scoped.

Creation response с `Cache-Control: no-store` единственный раз возвращает
connection-scoped Callback URL и Verify Token. После того как владелец сохранил
их в Meta и включил field `messages`, Center вызывает:

`POST /api/airhop/integrations/v1/channel-connections/{connectionId}/whatsapp-cloud/activate`

Relay расшифровывает credential внутри owner/admin boundary и вызывает
`/{wabaId}/subscribed_apps`. Успешный ответ означает только `connecting`;
готовность появляется исключительно после heartbeat hosted WhatsApp adapter.

Flow включается дополнительным HTTPS prefix:

- `BUZZ_AIRHOP_WHATSAPP_WEBHOOK_BASE_URL=https://gateway.example/webhooks/whatsapp`.

Полная инструкция владельца находится в
[`docs/AIRHOP_WHATSAPP_OWN_META_APP_SETUP.md`](AIRHOP_WHATSAPP_OWN_META_APP_SETUP.md).

## Control plane

### Получить подключения

`GET /api/airhop/integrations/v1/channel-connections`

Возвращает desired `status`, `hermesEnabled`, configured capabilities,
`version`, а также `observedStatus`, runtime capabilities, heartbeat и bounded
error code. При устаревшем heartbeat интерфейс показывает connection как
offline независимо от последнего reported status.

### Создать или изменить подключение

`PUT /api/airhop/integrations/v1/channel-connections/{connectionId}`

```json
{
  "provider": "telegram",
  "displayName": "Telegram центра",
  "connectorPubkey": "<64 hex>",
  "status": "active",
  "hermesEnabled": true,
  "capabilities": { "typing": true, "media": ["voice"] },
  "expectedVersion": 0,
  "routing": { "buzzChannelId": null, "branchId": null }
}
```

`expectedVersion = 0` создаёт connection. Следующее изменение передаёт текущую
версию. Provider после создания неизменяем; для другого provider создаётся
новый connection. Отключение выполняется status `disabled`, без удаления аудита.

### Привязать provider chat

`PUT /api/airhop/integrations/v1/channel-connections/conversations/{conversationId}`

```json
{
  "connectionId": "<uuid>",
  "providerChatId": "<provider destination>",
  "status": "active",
  "expectedVersion": 0
}
```

Clear provider destination возвращается только exact connector при outbound
claim. В индексах используется tenant/connection-scoped HMAC digest. Rebind
повышает `routingVersion`; pending сообщения старого route становятся
`superseded`, а rebind во время живой lease получает conflict.

Connector principal должен быть участником закрытого Buzz-канала conversation.
Route без такого membership отклоняется: runtime не получает неявного доступа к
каналам только потому, что знает provider chat ID.

## Runtime adapter loop

### Hosted assignments и credential retrieval

`GET /api/airhop/integrations/v1/channel-gateway/assignments` возвращает
credential-free список активных/приостановленных connection только точному
настроенному gateway principal.

`GET /api/airhop/integrations/v1/channel-gateway/connections/{connectionId}/credential`
доступен тому же exact connector и только для bound, не disabled connection.
Relay расшифровывает токен непосредственно перед ответом и ставит
`Cache-Control: no-store`; Center UI этот endpoint не вызывает. Hosted
supervisor периодически синхронизирует assignments, запускает отдельный
Telegram или WhatsApp runtime и отдельный SQLite spool на connection,
останавливает runtime при pause/disable и подхватывает новое подключение без
ручного redeploy. Один supervisor принадлежит одному развёртыванию Center;
номер поддержки AirHub HQ является отдельным connection и не переиспользуется.

### Heartbeat

`POST /api/airhop/integrations/v1/channel-gateway/connections/{connectionId}/heartbeat`

```json
{
  "observedStatus": "ready",
  "observedCapabilities": { "typing": true, "media": ["voice"] },
  "errorCode": null
}
```

Допустимы `offline`, `connecting`, `ready`, `degraded`. Только `degraded`
содержит lowercase bounded `errorCode`, например `provider_rate_limited`.
Рекомендуемый heartbeat — раз в 30 секунд; UI считает его устаревшим после
двух пропущенных интервалов.

### Inbound

Сначала adapter разрешает clear provider destination в canonical Buzz route:

`POST /api/airhop/integrations/v1/channel-gateway/routes/resolve`

```json
{
  "connectionId": "<uuid>",
  "providerChatId": "<provider destination>"
}
```

Ответ содержит `conversationId`, `channelId`, `rootEventId`, `threaded`, статусы
route/connection и `created`. Под scoped advisory lock резервируются conversation,
первый cycle и route, **не канал**. Пока первое сообщение не принято, root равен null.
Первый подписанный inbound становится единственным root атомарно с inbound receipt,
событием и thread metadata. Повтор/конкурентный resolve возвращает ту же сущность.
При проигранной гонке root сервер до вставки отвечает 409 `airhop_thread_changed`:
шлюз повторно разрешает route и подписывает reply. При сетевой неопределённости
повторяет **тот же сохранённый подписанный event**, не создаёт новый.

Канал задаётся в connection: `routing.branchId=null` означает общее подключение,
`routing.branchId=<active branch>` — филиальное. Явный `buzzChannelId` выбирает
закрытый активный stream; без него используется рабочий канал филиала или singleton
организации `parents`. Последний создаётся только при настройке connection,
с owner/admin, connector и Гермесом; discovery публикуется на этой границе.
Внешний родитель не становится фиктивным Buzz-участником.
Изменение обычного статуса с отсутствующим `routing` не меняет membership/канал.
Изменение routing применяется к новым контактам; старые не переезжают неявно.

Это только безопасный direct-contact bootstrap. Он не подтверждает Family или
Representative и не притворяется booking handoff. Гермес должен уточнить, хочет
ли человек записаться или уже является клиентом; verified binding появляется
только после отдельной проверки телефона, одноразового booking grant либо
подтверждения другим родителем.
Другой connector не может разрешить route. Clear chat ID не индексируется и не
возвращается в ответе.

`POST /api/airhop/integrations/v1/channel-gateway/inbound`

```json
{
  "connectionId": "<uuid>",
  "providerEventId": "<stable provider update/message id>",
  "event": { "id": "...", "pubkey": "...", "kind": 9, "tags": [], "content": "...", "sig": "..." }
}
```

Adapter нормализует входящее сообщение и подписывает kind-9 exact connector
principal. Conversation определяют точный `airhop-conversation`, `h` tag,
канонический root и сохранённый route; Relay
повторно проверяет connector, route и channel membership.
Provider event ID хэшируется с tenant и connection. Тот же ID с другим event
отклоняется; тот же ID и event является безопасным retry.

### Забрать outbound

`POST /api/airhop/integrations/v1/channel-gateway/outbound/claim`

```json
{
  "connectionId": "<uuid>",
  "limit": 25,
  "leaseSeconds": 90
}
```

Каждая job содержит `outboxId`, `leaseToken`, `provider`, `providerChatId`,
signed Buzz `event`, `sequence`, `attempt` и `idempotencyKey`. Adapter отправляет
job по порядку ответа и использует idempotency key в provider metadata, когда
provider это поддерживает. Текст берётся только из signed event; повторно
запускать Hermes для transport retry запрещено.

### Завершить попытку

`POST /api/airhop/integrations/v1/channel-gateway/outbound/{outboxId}/complete`

Успех:

```json
{
  "status": "delivered",
  "leaseToken": "<uuid>",
  "providerMessageId": "<provider receipt>"
}
```

Повтор:

```json
{
  "status": "failed",
  "leaseToken": "<uuid>",
  "errorCode": "provider_timeout",
  "retryAfterSeconds": 30,
  "retryable": true
}
```

Completion одной lease идемпотентен. Retry ограничен 5–3600 секундами и пятью
арендами; истёкшая аренда считается попыткой. После лимита сообщение получает
terminal `failed`, а не циркулирует бесконечно. Для provider `forbidden`/`not
found` adapter отправляет `retryable: false` и завершает job сразу.

## Что должен делать wrapper вокруг Hermes adapter

1. Получить update у готового platform adapter и проверить provider transport.
2. Сохранить минимальный normalized inbound в локальный durable inbox до
   продолжения обработки provider update.
3. Разрешить provider chat в сохранённый route и подписать нормализованный
   kind-9 exact connector principal.
4. Сохранить exact signed event для безопасного ambiguous retry и отправить
   inbound; Relay выполняет второй durable dedup.
5. Постоянно забирать outbound leases и передавать `event.content` в готовый
   `send` adapter method.
6. Зафиксировать success либо bounded failure; при crash дать lease истечь.
7. Отдельно проецировать typing/read/media, когда эти контракты появятся.

Эта прослойка намеренно мала: обновление Hermes Agent меняет его platform
implementation, но не канонический AirHop conversation/outbox contract.

Фактическая Telegram-реализация находится в
`integrations/hermes-airhop-channel-gateway`. Она pin-ит Hermes Agent
`v2026.8.18` (`e624e9fde561e1add9388384012b295fde669ade`), использует его
`TelegramAdapter` для polling/webhook/send и не запускает Hermes model loop.
Первый slice принимает только private DM text/command/location. Media, typing,
оригинальные вложения и typing остаются отдельными контрактами. First contact и
booking handoff реализованы; неподдерживаемое вложение не выдается за прочитанное.


## Очередь, ответственность и безопасность общего канала

Физический адрес — `channelId + rootEventId`. Филиал, ответственный и очередь
не являются ACL. Участники общего канала видят все его разговоры; для строгой
изоляции настройте отдельные филиальные connection/каналы. Переезд после выбора
филиала запрещён: новая семья, следующая запись и следующий цикл используют тот
же conversation/root. Binding обновляет название обращения, не имя канала.

`GET /api/airhop/staff/v1/client-conversations` (NIP-98, no-store): до 100 строк,
keyset `before + afterId`, фильтры branchId/unassignedBranch, mine, status,
connectionId, search, familyId/representativeId, conversationId. Поиск по текущему
названию; это не новый API сообщений. Из очереди и карточек семьи/записи открывается
стандартный Buzz thread. Непринятые резервации без root в очередь не попадают.

Подписанный kind **9051** через `/events` или CLI `buzz airhop client-command`:
`{idempotencyKey, conversationId, expectedVersion, action}`, где action —
`assign_branch {branchId}`, `assign {pubkey}`, `set_status {status}` или
`migrate_legacy {expectedRouteVersion}`. Требуется точный `airhop-community` tag,
действующая staff membership, CAS; изменение и retry receipt коммитятся вместе.
Настройка ответственных: тот же kind с
`{idempotencyKey, branchId, expectedVersion, responsiblePubkeys}`, до восьми
существующих сотрудников, только owner/admin. Настройка не выдаёт membership.

Неизвестный филиал получает owner/admin fallback. Гермес уточняет выбор и вызывает
`airhop_assign_conversation_branch` с цитатой из текущего authenticated inbound;
backend перепроверяет lease, источник, филиал и версию. Настроенные ответственные,
имеющие доступ, получают настоящие внутренние p-mentions; если таких нет — владелец.
Новые inbound-alerts сохраняются в durable очереди и подписываются relay отдельно:
исходный root не рассылает уведомление всем участникам общего канала. Внутренние
упоминания не попадают в provider outbox. Уведомление не гарантирует немедленный
push на офлайн-устройство; каноническое сообщение остаётся доступно в истории.
Если доступного ответственного нет, попытка откладывается на 60 секунд и не
задерживает другие обращения. Ошибка Redis оставляет доставку уведомления в очереди.

Состояния: waiting_staff / waiting_parent / resolved. Новое входящее после resolved
создаёт новый ownership cycle в той же ветке. Подтверждённая доставка ответа переводит
очередь в waiting_parent, только если после него не пришёл клиент и сотрудник не
поменял состояние. Передача Гермесом сотруднику остаётся waiting_staff.
ACP делит batch по root и модельные сессии по supervisor-confirmed conversation;
parent runtime не допускает flat-channel history. Соседние клиенты не становятся
контекстом подтверждения записи или отправки ответа.
Для обработки живой очереди обязателен обновляемый `BUZZ_AIRHOP_CONTEXT_GRANT_FILE`;
статический grant не отключает supervisor-проверку и не разрешает такую обработку.

## Явная миграция legacy

1. Сначала обновить relay, gateway, MCP/persona и Center одним кандидатом с миграцией
   0057; настройки не запускают перенос данных автоматически.
2. Настроить parent channel у подключения, проверить membership и резервную копию.
3. В очереди owner/admin нажимает «Проверить перенос старого разговора» либо вызывает
   `buzz airhop client-migration-preview --conversation-id <id>`.
4. Любые pending/leased deliveries, committed/unpublished replies или live turns
   блокируют перенос. Их нужно завершить/сверить, не удалять для обхода проверки.
5. Явная команда с версиями conversation/route атомарно создаёт подписанный служебный
   root со ссылкой на архив, меняет адрес прежнего conversation и версию прежнего
   route, архивирует старый канал. Исторические события не копируются/переподписываются.
6. Exact replay возвращает прежний результат. Старый канал не может отправлять
   outbound. Не принятый до переноса inbound получает 409 для безопасного re-resolve;
   уже принятый exact replay подтверждается по durable receipt даже после cutover.

Отключение connection сохраняет историю и останавливает новые claims; pending outbox
получает superseded. Уже начавшийся внешний сетевой send нельзя отозвать задним числом:
перед миграцией именно поэтому требуется завершение всех leases. Rollback приложения
не является rollback данных: после cutover нельзя включать старый per-contact gateway.
