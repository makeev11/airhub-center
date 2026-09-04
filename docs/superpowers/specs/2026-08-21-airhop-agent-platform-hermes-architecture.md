# AirHop Agent Platform: целевая архитектура на Hermes Agent

Статус: нормативная архитектура; Stage 0–2 foundation и Stage 3 Channel Gateway foundation реализованы  
Дата: 2026-08-21  
Связанные документы:

- `docs/AIRHOP_SOURCE_OF_TRUTH.md` — продуктовый источник истины;
- `docs/superpowers/specs/2026-08-20-airhop-communication-channels-design.md` —
  каналы, conversation, delivery и human takeover;
- `docs/superpowers/specs/2026-08-20-airhop-hermes-product-brainstorm.md` —
  продуктовые решения по Администратору Гермесу;
- `docs/AIRHOP_HERMES_CHANNEL_GATEWAY_CONTRACT.md` — точный seam между AirHop
  и переиспользуемыми Hermes messaging adapters;
- `docs/superpowers/specs/2026-08-18-airhop-welcome-agent-team-design.md` —
  внутренняя команда Fizz и специалистов.

## 1. Архитектурное решение

AirHop строится как единое рабочее пространство данных, людей и агентов.
**Buzz является событийным пространством совместной работы**, Booking Core
является источником структурированных операционных фактов, а upstream
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)
является единым runtime интеллекта для AirHop-агентов.

AirHop не создаёт собственные:

- model loop и tool-calling loop;
- memory engine общего назначения;
- систему skills общего назначения;
- набор клиентов к разным LLM providers;
- Telegram/WhatsApp messaging framework с нуля.

AirHop создаёт только продуктовый слой, которого нет и не должно быть в
универсальном Hermes Agent:

- tenant, organization, Family, Representative и Booking Core;
- канонические Buzz-треды и правила видимости;
- AirHop Agent Backend с доменными reads/actions;
- human takeover и внутренние structured mentions;
- provider-neutral outbox, delivery audit и idempotency;
- published knowledge, policy и capability grants;
- privacy-safe learning pipeline и quality gates;
- UI настройки, наблюдения и управления агентами.

Hermes не превращается в сценарного бота. Он получает полноценную persona,
reasoning, session state, память, skills и возможность самостоятельно выбирать
последовательность reads/actions. Ограничивается не его интеллект, а рабочая
область и полномочия, как у реального сотрудника центра.

## 2. Главная модель системы

```text
                         AirHop Center
             настройки, люди, треды, контроль, аудит
                              │
                              ▼
WhatsApp / Telegram ⇄ Channel Gateway ⇄ Buzz event workspace
                                              │
                                  validated conversation events
                                              │
                                              ▼
                                      Agent Supervisor
                                              │
                              Hermes profile + scoped context
                                              │
                                              ▼
                                        Hermes Agent
                                              │
                                  AirHop Agent Backend (MCP)
                                  ┌───────────┴───────────┐
                                  ▼                       ▼
                           Booking Core          Published Knowledge
```

Ключевое следствие: мессенджер не вызывает модель напрямую. Сначала входящее
сообщение становится каноническим событием в Buzz-треде. После этого Agent
Supervisor решает, должен ли запускаться Hermes, сотрудник или никакой агент.
Ответ Гермеса также сначала становится валидированной командой и событием в
AirHop, а уже затем попадает в provider outbox.

Благодаря этому:

- сотрудники видят точное общение Гермеса в том же треде;
- обычный ответ сотрудника атомарно останавливает автоматическое ведение;
- Telegram можно заменить на WhatsApp без изменения persona и reasoning;
- перезапуск модели не теряет входящее сообщение и не дублирует action;
- delivery provider не становится источником истины разговора;
- один и тот же Agent Backend используется внутренними и внешними агентами.

## 3. Логические плоскости

### 3.1. Control plane

AirHop Center и Booking Core хранят и изменяют:

- `AgentBlueprint` и его product role;
- organization-scoped `AgentDeployment`;
- `HermesPolicy`, capability grants и model/runtime revision;
- `ChannelConnection`, routing и ответственных;
- connection health, pause, disable и human ownership;
- published knowledge revisions;
- quality incidents, eval results и rollout state.

Настройки не записываются напрямую в случайный `config.yaml` работающего
процесса. Control plane публикует versioned desired state, а supervisor применяет
его к конкретному Hermes profile/deployment и сообщает observed state.

### 3.2. Conversation plane

Buzz хранит каноническую хронологию:

- реальные inbound сообщения родителей;
- реальные outbound сообщения Гермеса и сотрудников;
- internal-only mentions и control events;
- delivery/read state как связанные события или projections;
- ссылки на tool calls и `ActionReceipt`, но не hidden reasoning;
- начало, ownership и outcome `ConversationCycle`.

Тред не является временной Hermes session. Он является долговечной историей
конкретного `ExternalConversation`. Hermes session можно удалить и восстановить,
не теряя канонической переписки.

### 3.3. Domain plane

Booking Core хранит authoritative facts и выполняет mutations:

- Organization, Branch, Group и расписание;
- Family, Representative и Child;
- Booking, transfer, cancellation и attendance notice;
- payment instructions, claims и reminders;
- working hours и policies;
- identity binding и privacy/access state.

Ни Buzz-текст, ни Hermes memory, ни knowledge Markdown не меняют эти факты.
Любая мутация происходит типизированной командой Booking Core.

### 3.4. Knowledge plane

Published Knowledge хранит проверенные объяснительные материалы:

- что брать с собой;
- правила опозданий;
- безопасность;
- способы оплаты;
- правила пробного занятия;
- FAQ, доступность, вход и парковка;
- organization/branch/group-specific пояснения.

Knowledge является versioned Markdown с locale, audience, scope и publication
state. Он помогает объяснять, но не перекрывает свежие факты Booking Core.

### 3.5. Runtime plane

Hermes Agent обеспечивает:

- reasoning и multi-step tool use;
- provider/model routing;
- session state и compression;
- persona/SOUL;
- skills и процедурное обучение;
- memory provider plugin interface;
- ACP и native Buzz integration;
- model/tool lifecycle signals.

AirHop не использует editor-oriented Hermes ACP toolset как production
permission profile родительского агента. В upstream `hermes-acp` этот toolset
включает terminal, filesystem, browser, web и delegation. Для internal spike
это допустимо, но parent-facing deployment получает отдельный минимальный
AirHop tool profile: Hermes reasoning остаётся полноценным, а исполняемые
capabilities ограничиваются Agent Backend и явно разрешёнными служебными
инструментами.

Agent Supervisor обеспечивает:

- выбор deployment/profile;
- turn lease и отсутствие параллельных ответов в одном conversation;
- сбор `TurnContextEnvelope`;
- выдачу role-scoped tools;
- cancel/restart и timeout;
- фиксацию snapshot/read set/usage;
- final send gate.

### 3.6. Channel plane

AirHop Channel Gateway является постоянно работающим HQ deployment role. Он
переиспользует Hermes Agent messaging adapters и их protocol-specific поведение,
но не передаёт provider webhook напрямую в model loop.

Gateway:

- получает credentials из KMS/secret vault;
- валидирует webhook signatures;
- нормализует provider payload;
- дедуплицирует входящие provider events;
- сохраняет inbound до ответа провайдеру;
- публикует событие в канонический Buzz thread;
- арендует AirHop outbox jobs;
- вызывает provider send/template/media APIs;
- возвращает delivery/read receipts и health.

Внутренняя реализация Telegram/WhatsApp transport может быть Hermes plugin,
адаптером поверх его platform classes или upstream contribution. Продуктовый
контракт не зависит от внутренних Python-классов конкретной версии Hermes.

## 4. Модель агента

### 4.1. AgentBlueprint

Versioned product definition агента:

- стабильный `personaId`;
- display name и avatar;
- назначение и границы роли;
- базовый `SOUL.md`;
- immutable base skill bundle;
- default capability set;
- preferred Hermes runtime/model policy;
- допустимые conversation scopes и triggers.

Примеры:

- `airhop.fizz`;
- `airhop.administrator.internal`;
- `airhop.analyst`;
- `airhop.content_marketer`;
- `airhop.hermes.parent_administrator`.

Название runtime и имя persona не смешиваются. Все перечисленные роли могут
работать на Hermes Agent, но только внешняя persona отображается клиенту как
«Гермес».

### 4.2. AgentDeployment

Organization-scoped экземпляр blueprint:

- `organizationId`;
- отдельный Nostr agent principal/key;
- `profileRef` и runtime deployment;
- enabled/paused state;
- capability grants;
- доступные Buzz channels/conversation purposes;
- current runtime/persona/skills/model revisions;
- owner и operational health.

Нельзя использовать один agent principal или writable Hermes profile для двух
организаций.

### 4.3. Hermes profile

Каждый независимо работающий агент получает собственный Hermes profile. Один
profile содержит persona, sessions, organization-level memory, skills, model и
runtime settings только одного `AgentDeployment`.

Два процесса не пишут в один profile. Обновление base skill bundle не
перезаписывает tenant overlay и не смешивает профили.

### 4.4. Внутренний и внешний execution topology

Внутренние Fizz и специалисты могут исполняться через `hermes-acp`, когда AirHop
Center/Buzz владеет интерактивным transport. Их triggers и tools остаются
owner/staff-scoped.

Администратор Гермес исполняется серверно 24/7. Он получает события только из
parent threads и не зависит от запущенного desktop-приложения. Его primary
messaging surface для reasoning является Buzz, а provider connectors находятся
в Channel Gateway.

Оба варианта используют одни blueprint conventions, Agent Backend contracts,
runtime revisions и eval suite.

## 5. Источники истины

| Тип данных | Канонический источник | Допустимое использование Hermes |
|---|---|---|
| Booking, место, время, статус | Booking Core | Fresh typed read перед ответом/action |
| Family/Representative/Child | Booking Core | Только связанная и разрешённая Family |
| Цена и способы оплаты | Core + published payment instruction | Объяснение и создание claim, без выдуманного payment status |
| Полная переписка | Buzz thread | Bounded context и восстановление session |
| Delivery status | Outbox + provider receipt | Сообщать только фактический результат |
| Правила и FAQ | Published Knowledge | Retrieval по locale/audience/scope/version |
| Личная память семьи | Family-scoped memory/facts | Только внутри той же verified Family |
| Общий опыт агента | Hermes tenant profile skills/memory | Только PII-free procedural learning |
| Policy/capabilities | AirHop Control plane | Проверяются до turn и перед каждым action/send |
| Hidden reasoning | Нигде не является продуктовой записью | Не сохраняется как audit или knowledge |

## 6. AirHop Agent Backend

### 6.1. Назначение

Agent Backend является рабочим интерфейсом всех AirHop-агентов к продукту. Это
не сценарный workflow и не набор фраз. Он предоставляет достаточно богатые
примитивы, чтобы Hermes самостоятельно исследовал данные и строил решение.

Backend не выдаёт raw SQL, filesystem access или полный внутренний HTTP API.
Модель видит семантические ресурсы и typed domain commands.

### 6.2. Read surface

Начальный набор универсальных read tools:

```text
airhop_get_turn_context()
airhop_search(query, entityTypes, scope, cursor)
airhop_get(entityRef, fields, include)
airhop_list_booking_options(criteria, cursor)
airhop_search_knowledge(query, locale, scopes)
airhop_get_conversation_history(conversationId, cursor)
airhop_get_family_timeline(familyId, filters, cursor)
airhop_get_capabilities()
```

`airhop_search` и `airhop_get` дают агенту возможность ходить по разрешённому
графу данных, а не ждать отдельный tool на каждый вопрос. Сервер самостоятельно
ограничивает tenant, Family, audience, fields, page size и graph traversal.

Bulk export, чтение произвольных семей, raw Buzz search по всем каналам и
неограниченный session search не являются частью parent-facing surface.

Каждый read возвращает envelope:

```json
{
  "schemaVersion": "airhop.agent.read.v1",
  "observedAt": "...",
  "sourceRevision": "...",
  "scope": { "organizationId": "...", "familyId": "..." },
  "data": {},
  "nextCursor": null
}
```

### 6.3. Action surface

Action tools соответствуют бизнес-намерениям:

```text
airhop_create_booking
airhop_confirm_online_booking
airhop_reschedule_booking
airhop_cancel_booking
airhop_record_participation_notice
airhop_create_intake_request
airhop_create_payment_claim
airhop_request_staff_handoff
airhop_prepare_external_message
```

Каждый вызов содержит:

- `organizationId`, выведенный сервером, а не моделью;
- `conversationId`, `cycleId`, `sourceMessageId`, `turnId`;
- детерминированный `idempotencyKey`;
- expected entity versions или decision read set;
- typed payload без произвольного provider JSON.

Успешный action возвращает durable `ActionReceipt`:

```json
{
  "status": "committed",
  "actionId": "...",
  "resultType": "booking_rescheduled",
  "authoritativeResult": {},
  "newVersions": {},
  "userFacingFacts": {}
}
```

Гермес строит подтверждение из `ActionReceipt`. Сам текст «я перенёс запись» не
является доказательством action.

### 6.4. Role-scoped capabilities

Backend один, но effective tools и field visibility зависят от deployment role:

- Fizz видит общую картину организации и может делегировать внутренним агентам;
- внутренний Administrator настраивает Core через confirmation workflow;
- Analyst получает агрегаты, но не личные переписки;
- Content Marketer получает public/approved material;
- внешний Гермес получает public organization data, связанную Family,
  parent-safe knowledge и разрешённые booking/service actions.

Role определяет доступ, но не прописывает сценарий разговора.

## 7. TurnContextEnvelope

Agent Supervisor начинает каждый turn с небольшого неизменяемого envelope:

- organization, locale и timezone;
- agent blueprint/deployment/runtime revision;
- conversation, cycle и ownership state;
- verified external identity и Family binding level;
- bounded recent messages из Buzz;
- current subject/domain links;
- applicable policy и capability grants;
- channel capabilities и delivery window;
- релевантные family-scoped memory facts;
- ссылки на доступные knowledge scopes;
- tool schema versions;
- expected conversation/control/input versions.

Envelope не содержит весь tenant, всю базу знаний и всю историю семьи. Hermes
получает стартовую карту и сам вызывает read tools по мере необходимости. Это
сохраняет интеллект и снижает стоимость/случайную утечку контекста.

При старте фиксируется `HermesTurnConfigurationSnapshot`. Реально использованные
reads попадают в `HermesDecisionReadSet`. Перед action и outbound commit сервер
повторно проверяет изменившиеся зависимости.

## 8. Сквозной цикл сообщения

### 8.1. Inbound

1. Provider adapter проверяет webhook signature и account/connection.
2. Gateway строит `NormalizedInboundEnvelope`.
3. Provider event ID проходит durable deduplication.
4. Identity Resolver связывает sender с `ExternalIdentity`, Representative и
   Family либо оставляет public/unverified scope.
5. Conversation Router находит или создаёт `ExternalConversation`, Buzz root и
   текущий `ConversationCycle`.
6. Точное inbound сообщение и media metadata публикуются в Buzz.
7. Gateway подтверждает provider webhook только после durable acceptance.

### 8.2. Trigger

8. Agent Supervisor проверяет connection, purpose, Hermes enabled, cycle owner,
   message type и policy.
9. Быстрые последовательные parent messages коалесцируются в bounded input
   batch.
10. На `(cycleId, inputBatchId)` создаётся один `HermesTurnReceipt` и lease.
11. Никакой trigger не возникает от provider retry, receipt, typing, internal
    mention или обычного staff event.

### 8.3. Reasoning и actions

12. Context Builder создаёт `TurnContextEnvelope`.
13. Supervisor запускает соответствующий Hermes profile/revision.
14. Hermes понимает намерение и самостоятельно выбирает reads/actions.
15. Agent Backend авторизует каждый tool call независимо от текста prompt.
16. Domain mutation возвращает durable `ActionReceipt`.
17. Hermes формирует короткий естественный draft либо handoff.

### 8.4. Outbound

18. Final Send Gate повторно проверяет ownership, control version, input version,
    connection, channel capability и WhatsApp service window.
19. Draft сохраняется как external-message command и outbox job.
20. Только committed outbox делает сообщение видимым как pending external
    outbound в Buzz.
21. Gateway отправляет через provider adapter.
22. Provider ID и delivery/read receipts связываются с Buzz message.
23. Cycle получает outcome или остаётся `waiting_staff|waiting_system`.

Model output никогда не вызывает provider API напрямую.

## 9. Human control

В parent thread действуют общие правила:

- plain outbound сотрудника является внешним сообщением и human takeover;
- сообщение со structured mention любого человека является internal-only;
- `@Гермес остановись` создаёт typed `PauseHermes`;
- `@Гермес продолжай` создаёт typed `ResumeHermes` и само не уходит родителю;
- открытие треда и typing ownership не меняют;
- staff takeover отменяет любой не committed Hermes draft;
- provider-accepted сообщение не скрывается задним числом;
- один conversation не имеет двух одновременно активных Hermes turns.

Гермес после resume видит последние родительские и человеческие сообщения и
продолжает естественно. Отдельный «скрипт возврата» не нужен.

## 10. Память и самообучение

### 10.1. Почему одного Hermes profile memory недостаточно

Встроенные `MEMORY.md` и `USER.md` Hermes имеют scope всего profile и
подмешиваются в system prompt новых sessions. Встроенный `session_search` также
ищет по sessions всего profile. Это полезно для персонального агента, но
родительский deployment обслуживает много семей одной организации.

Поэтому profile-wide memory нельзя использовать для хранения имён, частных
переписок и обстоятельств отдельных семей. Иначе агент может перенести факт из
одной семьи в разговор с другой.

### 10.2. Три уровня памяти

#### Conversation memory

Hermes session хранит текущий thread context и tool history. Session key
детерминированно связан с `ExternalConversation`. Он не используется для другого
conversation.

#### Family memory

Личные предпочтения и долговечные факты хранятся через AirHop-scoped memory
provider/tool с namespace:

```text
organization / family / representative / conversation / purpose
```

Каждая запись имеет provenance, confidence/status, source event и privacy
class. Context Builder возвращает только факты текущей verified Family.

#### Organization procedural memory

Hermes profile может хранить PII-free знания о работе агента:

- удачный способ объяснять перенос;
- формат, понятный родителям организации;
- tool quirks и рабочие последовательности;
- повторяющиеся пробелы в knowledge;
- неудачные стратегии, которых следует избегать.

`MEMORY.md`/`USER.md` parent deployment не используются как общий каталог
семей. Built-in memory writes проходят AirHop memory policy; unrestricted
profile-wide `session_search` родительскому agent surface не выдаётся.

### 10.3. Два темпа обучения

#### Немедленное обучение

Без ожидания review применяются:

- язык и стиль текущего собеседника;
- текущий conversational context;
- подтверждённые Family preferences с точным provenance;
- committed action results;
- исправления родителя, если они не заменяют Core fact без проверки.

#### Процедурное обучение

Hermes автоматически создаёт `LearnedSkillCandidate`, когда повторяется успешный
или проблемный паттерн. Candidate содержит минимизированные PII-free examples,
source outcomes и proposed skill diff.

Автоматический pipeline:

```text
conversation outcomes / 👎 / 🚨
        → PII minimization
        → skill or knowledge-gap candidate
        → replay on golden dialogues
        → policy/security checks
        → tenant shadow activation
        → measured promotion or rollback
```

Это остаётся настоящим self-improvement: Hermes сам извлекает опыт, создаёт и
улучшает skill. Но случайный parent prompt не может мгновенно изменить active
skill для всех семей или добавить новый tool.

### 10.4. Skill layers

В effective skill bundle входят:

1. immutable upstream Hermes skills;
2. immutable versioned AirHop base skills;
3. organization tenant overlay;
4. optional conversation-local temporary technique.

Tenant overlay versioned и rollbackable. Global AirHop improvement создаётся
только из PII-free aggregate evidence и проходит полный cross-locale eval.

Skill может улучшить reasoning и tool use, но не может:

- добавить capability;
- изменить Booking Core policy;
- открыть другую Family;
- отправить сообщение мимо outbox;
- изменить active persona/policy без новой runtime revision.

## 11. База знаний и обучение не смешиваются

Если Гермес обнаружил отсутствие ответа, он не записывает догадку в published
knowledge. Он создаёт `KnowledgeDraftProposal` с:

- вопросом и предполагаемой темой;
- organization/branch/group scope;
- PII-minimized evidence;
- suggested Markdown;
- ссылками на conversation outcomes;
- status `proposed|published|rejected`.

Fizz или уполномоченный сотрудник публикует material. После publication новая
версия применяется со следующего turn. До этого Гермес либо отвечает по другим
источникам, либо честно зовёт человека.

## 12. Tenancy и безопасность

### 12.1. Изоляция runtime

Первый production topology использует отдельный Hermes process/container как
минимум на organization и agent deployment. Разные tenants не разделяют:

- writable Hermes home/profile;
- session database;
- memory/skill overlay;
- model credentials;
- MCP credentials;
- provider tokens;
- filesystem mounts.

Multiprofile может использоваться позднее только внутри одной organization и
после отдельных isolation tests. Он не является tenant boundary.

### 12.2. Разделение credentials

Parent-facing Hermes runtime получает:

- scoped AirHop Agent Backend credential;
- model provider credential согласно deployment policy;
- Buzz agent principal.

Он не получает WhatsApp/Telegram management tokens. Они остаются у Channel
Gateway/outbox worker. Channel Gateway, в свою очередь, не получает права
напрямую менять Booking.

### 12.3. Capability enforcement

Persona, prompt, tool schema и Hermes approvals не являются security boundary.
Agent Backend выводит tenant/identity/role из подписанного server context и
проверяет:

- active agent deployment;
- connection purpose;
- verified identity и Family membership;
- entity ownership;
- capability/policy revision;
- fresh Core state;
- idempotency и expected versions.

### 12.4. Полноценный интеллект без произвольного host access

Отсутствие production shell у родительского агента не означает ограничение его
reasoning. Для работы ему предоставляется богатый AirHop data graph, knowledge,
memory, планирование и typed actions. Terminal сервера не является источником
данных продукта и не нужен для качественной консультации.

Если будущий agent task действительно требует code/browser/files, он получает
отдельный sandboxed worker и явный capability, а не расширяет права постоянного
parent runtime.

## 13. Надёжность и конкуренция

Обязательные инварианты:

1. Provider webhook принимается только после durable inbound acceptance.
2. Provider event ID обрабатывается один раз.
3. В одном conversation работает не более одного Hermes turn.
4. Domain action имеет детерминированный idempotency key.
5. Staff takeover сильнее незавершённого Hermes turn.
6. Outbound отправляется только из durable outbox.
7. Provider retry не запускает новую генерацию текста.
8. Runtime restart восстанавливается из Buzz/Core/outbox, а не из памяти процесса.
9. Hermes session/memory можно перестроить без потери authoritative state.
10. Knowledge/model/skills revision не меняется внутри одного turn.
11. После собственного action Hermes использует `ActionReceipt`, а не повторяет mutation.
12. Второй конфликт одного input batch приводит к handoff, а не бесконечному loop.

### 13.1. Сбои

| Сбой | Поведение |
|---|---|
| Model/runtime недоступен | Cycle `waiting_system` или `waiting_staff`, человек получает понятное сообщение/задачу |
| Booking Core недоступен | Гермес не выдумывает результат; durable follow-up либо handoff |
| Provider недоступен | Outbox retry; текст не генерируется повторно |
| Hermes container restart | Lease истекает; turn безопасно resume/rebuild |
| Новый inbound во время generation | Draft инвалидируется или новый event идёт следующим batch по commit boundary |
| Staff написал одновременно | Uncommitted Hermes draft отменяется |
| Memory provider недоступен | Работа продолжается на Core/Knowledge/recent Buzz context без выдуманного recall |
| Skill revision сломан | Rollback на предыдущий immutable bundle |

## 14. Наблюдаемость и качество

На каждый turn фиксируются:

- conversation/cycle/input batch/turn IDs;
- runtime, model, persona, policy, knowledge и skill revisions;
- tool names, typed arguments digest, status и duration;
- `ActionReceipt` references;
- token/cache/latency/cost usage;
- final outbound/delivery IDs;
- handoff/outcome/failure category;
- decision read set;
- quality feedback и incident link.

Не фиксируются provider secrets и hidden chain-of-thought.

Основные продуктовые метрики:

- доля корректно завершённых обращений без handoff;
- correction/reopen rate;
- domain action success и duplicate prevention;
- time to first response и human takeover;
- delivery success;
- стоимость одного resolved cycle;
- доля learned candidates, улучшивших eval и production outcomes;
- cross-family/cross-tenant leak count, всегда равный нулю.

## 15. Deployment и обновления

### 15.1. Version pinning

Production deployment фиксирует:

- Hermes Agent release и container digest;
- AirHop bridge/plugin version;
- Agent Backend schema version;
- persona/base skills revision;
- model provider/id/mode;
- memory provider revision.

`hermes update` не запускается автоматически в production.

Первая подтверждённая runtime revision фиксирует Hermes Agent `v0.20.4`, tag
`v2026.8.18`, commit `e624e9fde561e1add9388384012b295fde669ade`. Образ обязан
содержать оба extras: `hermes-agent[acp,mcp]` либо эквивалентный verified lock.
`hermes-acp --check` проверяет ACP adapter, но не доказывает наличие MCP SDK;
readiness gate поэтому создаёт настоящую ACP session с injected test MCP и
проверяет, что ожидаемый tool появился в runtime surface.

### 15.2. Rollout

Новая runtime revision проходит:

1. synthetic и PII-free unit/contract tests;
2. recorded minimized golden dialogues на `ru`, `pt-BR`, `en`;
3. security/tenant/identity tests;
4. shadow traffic без external send;
5. canary organizations;
6. gradual rollout с автоматическим rollback threshold.

Profile data backup и schema migration проверяются до canary. Runtime revision и
tenant learning overlay обновляются независимо.

### 15.3. Минимальная сборка

Первый spike может использовать официальный Hermes image. После измерения image
size, RSS, cold start и concurrency AirHop может собирать минимальный derivative
из той же pinned upstream version:

- Hermes core/runtime;
- ACP/native Buzz;
- MCP;
- выбранные model providers;
- нужные messaging adapter packages для Channel Gateway.

Browser, desktop UI, Matrix, local wake word, RL и ненужные providers не должны
автоматически попадать в production image. Это packaging, а не fork Hermes.

Для малого trusted AirHop toolset progressive `tool_search` выключается:

```yaml
tools:
  tool_search: false
```

Три-четыре доменных tools должны быть видимы модели напрямую. Progressive
disclosure остаётся полезным для больших каталогов, но в spike скрытие AirHop
tools привело к тому, что модель начала искать их реализацию через filesystem и
terminal. Это увеличило latency и token usage, не создав ни одного domain call.

## 16. Текущее состояние кода и gaps

Уже существует:

- Hermes runtime preset `hermes-acp` в
  `desktop/src-tauri/src/managed_agents/discovery/presets.rs`;
- встроенные AirHop persona Fizz/Administrator/Analyst/Content Marketer;
- Welcome team и role context;
- `airhop-agent-mcp` в `crates/buzz-dev-mcp/src/airhop.rs`;
- role-scoped reads, internal messages/delegation и prepared setup actions;
- Booking Core staff/public APIs и idempotent action bridge;
- Buzz agent principals, channels, threads и observer lifecycle.

Критические gaps после hosted Telegram/Hermes vertical slice:

1. Внешняя AirHop persona закреплена за parent runtime; остальные внутренние
   persona пока не переведены на тот же hosted lifecycle.
2. Persistent `AgentDeployment`, owner/admin API и control-plane UI подключены.
   Для multi-organization HQ всё ещё нужен отдельный hosted runtime reconciler;
   первый pilot использует один organization-isolated Compose service.
3. Нет универсального graph `search/get`, conversation history и Family timeline;
   v1 даёт scoped turn context, Family, booking options и published knowledge.
4. Booking v1 пока выполняет отмену и request-transfer; создание, настоящее
   атомарное перемещение и auto-confirm требуют следующих typed Core commands.
5. Durable `HermesTurnReceipt`, lease, configuration snapshot, bounded decision
   read set и постоянно работающий `buzz-acp` execution loop существуют.
6. Channel Gateway contract, normalized inbound, automatic unverified
   first-contact conversation и provider-neutral outbox loop реализованы;
   Telegram adapter готов к deployment, но WhatsApp, typing/read projection и
   media path ещё не реализованы.
7. Нет Hermes memory policy/plugin, отделяющего Family memory от profile memory.
8. Нет versioned learned-skill candidate/eval/promotion pipeline.
9. Hosted 24/7 external Hermes deployment реализован для первого pilot topology;
   ещё нет HQ scheduler/reconciler для автоматического управления множеством
   таких deployment.

Trusted runtime gate уже разрешает встроенным AirHop Welcome-persona получать
`airhop-agent-mcp` как через `buzz-agent`, так и через `hermes-acp`. Для
произвольных persona Hermes по-прежнему не получает этот privileged MCP.

## 17. Последовательность реализации

### Этап 0. Runtime compatibility spike

Цель: доказать, что существующий AirHop MCP работает с настоящим Hermes Agent.

- pin Hermes release/image;
- исправить trusted MCP runtime gate;
- запустить Fizz или internal Administrator через `hermes-acp`;
- выполнить current read и prepared action end-to-end;
- проверить session persistence, model picker и observer events;
- измерить RSS, cold start, turn latency и token usage.

Результат: никакого нового product behavior, только подтверждённый runtime seam.

#### Фактический результат spike от 2026-08-21

Подтверждено на изолированном Hermes profile, без изменения пользовательского
`~/.hermes`:

- upstream `v0.20.4` успешно прошёл `hermes-acp --check`;
- Buzz-shaped `initialize` согласовал ACP protocol `1` и вернул
  `hermes-agent 0.20.4`;
- `session/new` принял injected `airhop-agent-mcp` и DeepSeek
  `deepseek-v4-flash`;
- после полного restart `session/load` восстановил ту же session;
- ACP stream отдал `tool_call`, `tool_call_update`, thought, message и usage
  updates, необходимые Buzz observer projection;
- live turn вызвал `mcp__airhop_agent_mcp__airhop_read`, затем
  `mcp__airhop_agent_mcp__airhop_prepare_action`;
- mock authoritative backend получил ровно один `GET
  /api/airhop/staff/v1/settings` и один `POST
  /api/airhop/agents/v1/actions/prepare`; prepared action не был committed;
- успешный DeepSeek turn занял `10.24 s`, три model calls соответствовали двум
  последовательным tool results и финальному ответу, последующие calls получили
  `98–99%` provider cache hit;
- cold isolated process tree занял около `153.8 MiB` RSS; initialize занял
  `9.78 s`, session readiness `30.66 s`, restart initialize `8.49 s`, session
  load `30.04 s`.

Эти latency/RSS числа являются диагностической baseline изолированной
Python-установки upstream, а не production SLO. Они подтверждают seam и
одновременно обосновывают минимальный pinned image, warm runtime pool и
измерение на canary.

Spike также нашёл два обязательных release gates:

1. `[acp]` без `[mcp]` проходит `hermes-acp --check`, но injected MCP tools
   остаются недоступны модели; production artifact обязан включать оба extras.
2. При default progressive `tool_search` DeepSeek ушёл в repository/terminal
   exploration и завершил turn без domain calls. Малый AirHop toolset должен
   быть eager, а editor tools должны быть исключены из parent runtime profile.

### Этап 1. AirHop Agent Backend v1

- выделить общий backend contract из Welcome-specific MCP;
- сохранить текущие внутренние tools совместимыми;
- добавить `AgentDeployment` context и `parent_administrator` role;
- реализовать `get_turn_context`, scoped `search/get`, knowledge search;
- добавить typed booking/service actions и `ActionReceipt`;
- добавить contract tests по каждой роли и cross-tenant denial.

Результат: Hermes может свободно исследовать реальный AirHop backend, а не идти
по запрограммированной анкете.

#### Фактический v1 vertical slice от 2026-08-21

Реализована безопасная граница первого parent-facing turn:

- ACP и `airhop-agent-mcp` понимают отдельную роль `parent_administrator`;
- внешний Гермес видит только пять parent tools: turn context, Family,
  booking options, knowledge search и booking management; Welcome tools скрыты;
- owner/admin issuer атомарно арендует durable turn и создаёт краткоживущий
  relay-signed context grant для сохранённого deployment principal, tenant,
  organization, private channel, conversation, Family, Representative, cycle,
  input batch, source message и lease;
- Agent Backend повторно проверяет NIP-98 principal, подпись/TTL grant,
  organization, source event/channel и active Family binding на каждом вызове;
- caller не передаёт organization/Family IDs в tool arguments и не может
  расширить scope неизвестным JSON-полем;
- published knowledge хранится versioned Markdown с locale, audience,
  organization/branch/group scope и доступно только в status `published`;
- отмена и request-transfer используют существующие Booking Core command,
  domain-event и outbox primitives, server-derived idempotency и durable
  `airhop.agent.action-receipt.v1`;
- verified Family даёт read, но booking mutation появляется только при включённом
  master capability `manageBookings` в выданном контексте;
- context grant передаётся только AirHop MCP и не наследуется произвольными MCP.

Также остаются следующие Stage 1 расширения: graph search/get,
conversation/timeline reads, booking create/confirm/atomic transfer и staff
handoff command.

### Этап 2. Buzz-native external Hermes

- добавить external Hermes blueprint/persona/avatar/profile;
- поднять organization-isolated hosted runtime;
- добавить Agent Supervisor, turn lease, snapshot/read set;
- запускать external Hermes только от validated parent events;
- реализовать human takeover, pause/resume и final send gate;
- оставить transport тестовым, без реального родительского номера.

Результат: полноценный Hermes работает внутри канонического Buzz-треда.

#### Фактический Stage 2 runtime foundation от 2026-08-21

Реализован серверный seam, на котором supervisor может безопасно запускать
настоящий Hermes без локального desktop state:

- `airhop_agent_deployments` хранит ровно один organization-scoped deployment
  роли `parent_administrator`, отдельный Nostr principal, Hermes `profileRef`,
  pinned runtime/persona/skills/model revisions, `enabled`, `paused` и master
  capability `manageBookings`;
- owner/admin `GET /api/airhop/agents/v1/deployments` обнаруживает текущий
  deployment, а `GET/PUT /api/airhop/agents/v1/deployments/{id}` даёт versioned
  desired state; одинаковый PUT не увеличивает version и не сбрасывает живой
  turn, stale update получает conflict, а материальное изменение атомарно
  отменяет незавершённые turns этого deployment;
- `airhop_hermes_turn_receipts` фиксирует canonical channel/conversation/cycle,
  `(cycleId,inputBatchId)`, source event, Family binding, agent principal,
  configuration snapshot, lease token/deadline, attempt и terminal outcome;
- per-conversation PostgreSQL advisory lock и partial unique index не допускают
  два одновременно active turn; retry того же input batch получает тот же
  receipt, а истёкший lease этого batch безопасно ротируется;
- новый context grant больше не принимает от caller `agentPubkey`,
  `manageBookings` или `turnId`: principal, capabilities и turn выводятся только
  из live deployment и durable lease;
- каждый Agent Backend call повторно связывает signed grant с live enabled
  deployment version и точным неистёкшим lease; изменение desired state сразу
  инвалидирует старый grant;
- Booking Core mutation повторяет эту проверку под row locks внутри той же
  PostgreSQL transaction, что и изменение записи; отключение deployment,
  отзыв lease/human takeover и commit действия поэтому имеют однозначный
  порядок без окна между HTTP-проверкой и записью;
- успешные authoritative reads добавляют в bounded `decision_read_set` только
  operation, revision и timestamp, без result payload и PII;
- `POST /api/airhop/agents/v1/turns/{id}/finish` принимает terminal outcome
  только от exact agent principal с exact lease token и остаётся idempotent при
  сетевом retry.

#### Фактический Stage 2 supervisor vertical slice от 2026-08-21

Поверх runtime foundation реализован первый Buzz-only Agent Supervisor:

- private Buzz channel регистрируется как `ExternalConversation` с trusted
  external identity metadata, optional verified Family/Representative, текущим
  cycle, владельцем следующего ответа и монотонным `controlVersion`; transport
  inbound подписывает scoped integration principal, а не фиктивный parent key;
- kind-9 event и изменение владения фиксируются в одной PostgreSQL transaction;
  plain staff message означает human takeover, любое `p`-mention является
  внутренним сообщением, а точные `@Гермес продолжай` / pause-команды меняют
  владение, не попадая в parent route;
- validated external inbound получает durable trigger/suppressed receipt. Hosted
  runtime может claim только exact current receipt; stale receipt после
  takeover/resume не запускает модель;
- dispatch существующего `buzz-acp` делает server claim до Hermes prompt и
  передаёт rotating signed context через отдельный `0600` файл только в
  `airhop-agent-mcp`. Parent profile временно ограничен одним ACP slot и queue
  mode, чтобы один MCP process никогда не увидел context другого параллельного
  turn;
- внешний Гермес больше не может писать в зарегистрированный parent channel
  обычным `/events`: ingest требует заранее committed outbound intent;
- `airhop_send_parent_reply` подписывает один–три коротких top-level events,
  атомарно проверяет live turn, cycle, conversation owner и deployment, закрывает
  turn и лишь затем проводит события через обычный Buzz ingest/fan-out;
- human takeover и final-send commit блокируют одну conversation row. Побеждает
  тот, кто первым закоммитил transaction: уже committed ответ не исчезает, а
  ещё не committed ответ после takeover гарантированно отклоняется;
- deterministic input batch id, durable turn lease и idempotent outbound intent
  позволяют безопасно повторить claim/reply после сетевой ошибки или crash.

Это завершило server-to-Hermes Buzz-only вертикаль. Следующий фактический срез
добавил pinned hosted runtime, materialization внешнего профиля и Telegram
adapter. Multi-organization reconciler, гарантированный fallback после model
turn без final tool и полный реальный provider E2E остаются release gates.

### Этап 3. Telegram vertical slice

- завернуть/reuse Hermes Telegram adapter за Channel Gateway contract;
- реализовать normalized inbound, binding и provider dedup;
- реализовать outbound worker, receipts и typing projection;
- провести booking handoff и один полный консультационный сценарий;
- проверить restart, duplicate, race и staff takeover.

Результат: первый production-shaped разговор от Telegram до Core и обратно.

#### Фактический Stage 3 Channel Gateway foundation от 2026-08-21

Реализована provider-neutral серверная граница, не копирующая upstream transport:

- connection desired state хранит `telegram` либо официальный
  `whatsapp_cloud`, exact connector principal, `active/paused/disabled`,
  настройку Гермеса и capabilities, но никогда не принимает provider token;
- settings API читает и изменяет connection с optimistic version, а точный
  connector отдельно сообщает `offline/connecting/ready/degraded`, фактические
  capabilities, heartbeat и bounded error code;
- canonical `ExternalConversation` versioned-связью привязывается к одному
  provider chat. Смена identity повышает `routingVersion`, запрещена во время
  живой delivery lease и подавляет неарендованный outbound старого route;
- inbound принимает только подписанный kind-9 event exact connector principal,
  проверяет connector/route/channel membership, а provider event digest и Buzz
  event сохраняются атомарно. Родитель показывается из trusted conversation
  metadata; retry того же provider event не создаёт второй turn;
- parent inbound через paused route остаётся в Buzz, но не запускает Hermes;
  disabled route отклоняет новый provider traffic;
- финальные сообщения Гермеса и обычные сообщения сотрудника используют один
  durable external outbox. Любое `p`-mention и Hermes control остаются
  internal-only и в provider не арендуются;
- claim выдаёт provider destination только exact connector, signed Buzz event,
  sequence, lease token и стабильный idempotency key из Buzz event ID;
- success/retry/terminal failure записываются идемпотентно и append-only;
  аренда ограничена пятью попытками, включая crash/expiry адаптера;
- фоновый recovery worker каждые пять секунд по умолчанию повторно проводит
  exact committed Hermes event через обычный ingest. Event ID делает запуск
  нескольких relay pods безопасным и не генерирует текст повторно.

HTTP-контракт адаптера зафиксирован отдельно.

#### Фактический Stage 3 Telegram deployment adapter от 2026-08-21

- добавлен отдельный deployment role
  `integrations/hermes-airhop-channel-gateway`, который pin-ит Hermes Agent
  `v2026.8.18`/`e624e9fde561e1add9388384012b295fde669ade` и напрямую использует
  upstream `TelegramAdapter`; собственная реализация Telegram Bot API не
  создаётся;
- один process получает только `TELEGRAM_BOT_TOKEN`, scoped connector secret,
  tenant Relay URL и `connectionId`; Relay не принимает и не хранит эти
  provider credentials;
- polling используется по умолчанию, а при `TELEGRAM_WEBHOOK_URL` плюс
  `TELEGRAM_WEBHOOK_SECRET` тот же upstream adapter включает webhook mode;
- private DM text/command/location сначала попадает в local SQLite WAL с
  `synchronous=FULL`, затем exact provider chat разрешается через
  tenant/connection HMAC route, подписывается один kind-9 connector principal и
  отправляется в atomic Relay dedup. Exact signed event сохраняется до успеха,
  поэтому ambiguous HTTP retry не меняет event ID;
- `/start` bearer payload никогда не попадает в local inbox, логи или Buzz;
  пока booking handoff consumer не реализован, pre-bound route получает только
  redacted `/start`. Обычный первый private DM идемпотентно создаёт unverified
  conversation; это ещё не связывает чат с Family и не подтверждает личность;
- outbound worker арендует jobs только указанного connection, последовательно
  вызывает upstream `send`, записывает provider message ID и различает bounded
  retry от permanent `forbidden/not_found`; crash оставляет lease истечь и
  засчитывается как одна из пяти попыток;
- connection heartbeat отражает `connecting/ready/degraded/offline`, а наличие
  dead inbound переводит adapter в `degraded` без утечки текста или identity;
- deterministic fake-Telegram E2E проверяет durable inbound, local/provider
  dedup, redaction handoff token, canonical h-tag, outbound и permanent failure.

Это production-shaped text transport, но ещё не полный продуктовый pilot.
Generic first-contact provisioning теперь создаёт unverified conversation при
первом private DM. Остаются одноразовый booking handoff grant, identity binding,
continuous typing/read projection, voice transcription/media review и
production secret/vault rollout. WhatsApp Cloud остаётся следующим adapter
slice поверх той же server boundary.

#### Фактический hosted Hermes runtime от 2026-08-21

- добавлен отдельный `hermes-parent-runtime` Compose profile с persistent
  organization-isolated `HERMES_HOME`, warm single-worker `buzz-acp`,
  `hermes-acp` и `airhop-agent-mcp`;
- upstream Hermes Agent закреплён на
  `e624e9fde561e1add9388384012b295fde669ade` и устанавливается с точными
  `[acp,mcp]` extras; build падает, если reviewed compatibility patch больше не
  применяется к этому commit;
- parent persona обязует загружать turn context и завершать родительский ответ
  только через `airhop_send_parent_reply`, отвечает на языке родителя и не
  имитирует успешные Core actions;
- стандартный upstream `hermes-acp` toolset с shell/filesystem/browser/code и
  subagents отключён. В session динамически добавляется только scoped Airhop MCP;
  model process не получает rotating context grant;
- расходы и loop bounded одним worker, нулевым autonomous heartbeat, восемью
  Hermes iterations, 180-second idle timeout и 300-second absolute turn limit;
- pilot bootstrap регистрирует отдельные connector/agent principals, публикует
  signed Hermes profile и создаёт pinned organization deployment; дальнейшее
  desired state управляется существующей карточкой агента.

#### Фактический Stage 3 control-plane UI от 2026-08-21

- существующий экран агентов показывает внешнего **Администратора Гермеса**
  отдельной карточкой и иконкой, а не переименовывает внутреннего администратора;
- карточка читает organization-scoped deployment desired state и позволяет
  owner/admin изменять глобальный `enabled` и master `manageBookings`, сохраняя
  pinned runtime/persona/skills/model revisions и optimistic version;
- в существующей навигации настроек центра появился раздел **«Каналы связи»** с
  Telegram self-service, desired/observed state, heartbeat, pause/resume и
  per-connection `hermesEnabled`;
- safe state могут читать все active staff, изменять его только owner/admin;
- BotFather token существует только в dedicated write-only NIP-98 запросе.
  Relay сначала проверяет Telegram `getMe`, затем шифрует token AES-256-GCM с
  tenant/connection/provider AAD и сохраняет ciphertext одной транзакцией с
  connection. Ключевой HMAC fingerprint предотвращает дубль, не раскрывая
  token. Обычный connection PUT остаётся credential-free и закрыт
  `deny_unknown_fields`;
- hosted Telegram supervisor подписывает GET своим exact connector principal,
  получает assignments и расшифрованный credential только для конкретного
  bound active connection с `Cache-Control: no-store`, после чего запускает
  отдельный upstream Hermes Telegram runtime и SQLite spool на connection.

### Этап 4. Scoped memory и learning

- связать Hermes session key с `ExternalConversation`;
- внедрить Family-scoped memory provider/tool;
- запретить PII в profile-wide memory/session search;
- добавить outcome extraction и `LearnedSkillCandidate`;
- автоматизировать minimization, eval, shadow, promotion и rollback;
- подключить 👎/🚨 и knowledge-gap proposals.

Memory scoping входит в release gate до реальных нескольких семей. Skill
promotion можно включать постепенно после Telegram vertical slice.

### Этап 5. WhatsApp Cloud pilot

- reuse официального Hermes `whatsapp_cloud` adapter;
- Meta webhook/signature/setup;
- template sync/send вне 24 часов;
- tenant-aware rate limiter и health;
- voice/media path;
- `pt-BR` golden/E2E и Brazil privacy gate.

### Этап 6. Следующие агенты и каналы

- перевести остальные AirHop blueprint на единый runtime/backend contract;
- hosted/internal execution по необходимости;
- MAX, затем другие adapters по продуктовым данным;
- межагентная делегация только через Buzz events и typed assignments.

## 18. Release gates первого внешнего Гермеса

Релиз невозможен, пока не доказаны:

1. Один parent inbound создаёт один канонический Buzz event.
2. Один input batch создаёт не более одного Hermes turn.
3. Hermes видит свежий Core и published knowledge через Agent Backend.
4. Неожиданная естественная формулировка не требует заранее заданного сценария.
5. Booking action подтверждается только настоящим `ActionReceipt`.
6. Plain staff outbound останавливает uncommitted Hermes response.
7. `@Гермес продолжай` возвращает ведение без отправки control text родителю.
8. Provider retry не создаёт новый model turn или duplicate action.
9. Restart любого одного процесса не теряет inbound/outbox/domain result.
10. Family A невозможно прочитать session/memory/data Family B.
11. Organization A невозможно прочитать data/profile/secrets Organization B.
12. Learned memory не превращается в authoritative Core fact.
13. Learned skill не добавляет permission и проходит eval до activation.
14. Новый канал подключается без изменения persona, Agent Backend и Booking Core.
15. Сотрудник видит точные сообщения Гермеса и delivery state в одном треде.

## 19. Что сознательно не проектируется заново

- собственный LLM provider SDK layer;
- собственный general-purpose vector memory product;
- собственный multi-agent reasoning framework;
- собственный Telegram/WhatsApp protocol implementation;
- Chatwoot как второй helpdesk/CRM runtime;
- raw database access модели;
- отдельная история разговора вне Buzz;
- workflow tree на каждый возможный текст родителя;
- live self-modification, способная менять permissions или business facts.

## 20. Итоговая формулировка

AirHop предоставляет агентам безопасное, богатое и наблюдаемое рабочее
пространство. Hermes Agent приносит в это пространство интеллект, память,
reasoning, skills и способность улучшать собственную работу. Buzz объединяет
агентов и людей в одной событийной истории. Booking Core и Published Knowledge
дают проверяемые данные. Channel Gateway связывает пространство с любым
мессенджером.

Качество достигается не сокращением возможностей Hermes и не ростом числа
сценариев. Оно достигается тем, что полноценный Hermes получает правильные
данные, устойчивые инструменты, scoped memory, обратную связь и возможность
учиться, не обходя источники истины и человеческое управление.
