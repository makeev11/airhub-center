# AirHop Hermes Channel Gateway contract

Статус: server foundation, Telegram self-service и hosted gateway supervisor реализованы  
Дата: 2026-08-21

## Граница ответственности

AirHop relay владеет каноническим Buzz-тредом, desired state подключения,
зашифрованным credential store, маршрутом, inbound deduplication и durable
outbound. Тонкий Hermes adapter получает токен только для назначенного ему
connection, владеет webhook/polling, typing, media и вызовом Telegram либо
WhatsApp API. Model loop не получает provider payload и не вызывает provider
API напрямую.

В первой версии допустимы только provider IDs:

- `telegram` — upstream Telegram platform adapter Hermes Agent;
- `whatsapp_cloud` — официальный WhatsApp Cloud adapter Hermes Agent.

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
  "hermesEnabled": true
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
  "expectedVersion": 0
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
supervisor периодически синхронизирует assignments, запускает отдельный Hermes
Telegram runtime и отдельный SQLite spool на connection, останавливает runtime
при pause/disable и подхватывает новое подключение без ручного redeploy.

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

Ответ содержит только `conversationId`, `channelId`, статусы route/connection и
`created`. Если exact private provider chat ещё не известен, этот же POST под
scoped advisory lock создаёт один private Buzz stream, неподтверждённый
`ExternalConversation`, первый ownership cycle и route. В канал добавляются
Hermes, точный connector и owner/admin центра; relay публикует обычные NIP-29
discovery/membership events. Повтор или параллельный первый update получает тот
же route, а не второй тред.

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
principal. Conversation определяют `h` tag события и сохранённый route; Relay
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
generic unbound-contact provisioning и booking handoff grant consumption
остаются отдельными следующими контрактами, а не скрытыми эвристиками.
