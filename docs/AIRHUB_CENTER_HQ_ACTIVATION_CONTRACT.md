# AirHub Center ↔ HQ: deployment и activation contract

Статус: рабочая граница для реализации Center  
Дата: 2026-08-17

Документ фиксирует только взаимодействие AirHub Center с будущим AirHub HQ.
Текущая ветка HQ пока находится на стадии удаления старого Buzz и не считается
готовой реализацией этого контракта.

## 1. Два разных вида кодов

Нельзя объединять два независимых контура:

1. **HQ admin enrollment code** активирует новое устройство администратора HQ.
   После одноразового погашения устройство подписывает HQ API своим ключом.
2. **Center activation grant** активирует конкретную установленную копию AirHub
   Center для конкретной организации.

Код HQ не даёт доступ к Center, а код Center не создаёт администратора HQ.

## 2. Граница ответственности

- HQ хранит карточку `CenterInstallation`, observed/desired state, версию,
  историю deploy/health и metadata выданных grants.
- Center хранит собственные операционные данные, installation identity и
  состояние активации.
- HQ не копирует расписание, цены, места, клиентов и платежи Center.
- После активации Center работает при недоступном HQ. HQ не является proxy в
  пользовательском или публичном runtime.
- Приватный ключ installation identity создаётся и хранится на стороне Center и
  никогда не передаётся HQ.

## 3. Deployment flow

```text
HQ operator selects site_telegram_center
→ deploy worker installs an exact Center release
→ Center creates an installation identity and exposes readiness
→ Center connector verifies installation id, public key and release version
→ HQ operator explicitly issues a short-lived one-time activation grant
→ the grant is delivered once through an approved secret channel
→ Center claims it and atomically binds the installation identity
→ connector performs a signed challenge/response health check
→ HQ records Center as ready without becoming its runtime dependency
```

Повтор deploy или claim с тем же idempotency key возвращает сохранённый
результат. Ошибка Center не меняет успешный статус сайта или Telegram.

## 4. Activation grant

Grant должен быть:

- криптографически случайным и достаточной энтропии;
- короткоживущим;
- одноразовым;
- привязанным к `installationId`, организации, environment и разрешённому
  release/profile;
- хранимым HQ и Center только как keyed digest/hash;
- возвращаемым HQ-клиенту только один раз при выпуске;
- отзываемым до погашения;
- не попадающим в URL, Git, screenshots, audit payload и обычные логи.

Погашение выполняется одной транзакцией: проверить digest, срок, binding и
состояние → отметить grant использованным → привязать installation public key →
записать audit event. Два параллельных claim не могут оба завершиться успешно.

## 5. Минимальный versioned API

Точные payload будут закреплены тестовыми fixtures перед реализацией. Требуемые
семантические операции:

### HQ / Center connector

- создать и отозвать activation grant;
- получить безопасные metadata установки и grants без исходных кодов;
- запросить challenge и проверить подписанный ответ;
- получить release/config version, последнее успешное health-время и
  санитизированную ошибку.

### Center bootstrap surface

- claim одноразового grant вместе с installation public key;
- вернуть стабильную installation identity и activation version;
- подтвердить владение installation private key через challenge/response;
- показать безопасный readiness/status без клиентских операционных данных.

HTTP допустим здесь как bootstrap-интерфейс до появления доверенной Nostr
identity. Все обычные операции Center после активации продолжают использовать
его tenant-scoped, подписанный и аудируемый контур.

## 6. Состояния HQ-панели Center

`not_installed → provisioning → ready | degraded | failed → disabled`

- `not_installed` является нормой для профиля `site_telegram`.
- `ready` означает успешную последнюю проверку, а не выдуманный continuous
  online status.
- отзыв grant не деактивирует уже связанную installation identity. Для этого
  нужна отдельная явная команда disable/rotate с аудитом.
- ротация identity или повторная установка создаёт новую activation ceremony и
  не стирает историю предыдущей установки.

## 7. Приёмка

Сквозной тест должен доказать:

1. grant виден в открытом виде только в ответе на выпуск;
2. просроченный, отозванный, чужой и повторно использованный grant отклоняется;
3. параллельный claim имеет ровно один успешный результат;
4. успешный claim привязывает public key и пишет audit без секрета;
5. challenge проходит только с приватным ключом установки;
6. после отключения HQ уже активированный Center продолжает обслуживать свои
   staff/public сценарии;
7. HQ health/status не раскрывает данные клиентов Center.

