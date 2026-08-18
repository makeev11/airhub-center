//! Preparation and retry-stable publication of human-confirmed Airhop actions.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Json;
use buzz_core::TenantContext;
use buzz_db::airhop::agent_actions::{
    AgentActionStatus, NewPendingAgentAction, PendingAgentAction,
};
use buzz_db::airhop::branch_directory::BranchStatus;
use buzz_db::airhop::group_directory::{GroupStatus, RecurrenceRuleStatus};
use buzz_db::airhop::room_directory::RoomStatus;
use buzz_db::airhop::tariff_directory::TariffStatus;
use buzz_db::airhop::teacher_directory::TeacherStatus;
use buzz_db::airhop::welcome_agents::AirhopWelcomeRole;
use chrono::{Duration, NaiveDate, Utc};
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::api::airhop_auth::authenticate_airhop;
use crate::api::airhop_staff::{
    CreateBranchBody, CreateFamilyBody, CreateGroupBody, CreateRoomBody, CreateTariffBody,
    CreateTeacherBody, EnrollStaffParticipantBody, MutatePaymentBody, PutOrganizationSettingsBody,
};
use crate::api::{api_error, internal_error};
use crate::state::AppState;

const PREPARE_PATH: &str = "/api/airhop/agents/v1/actions/prepare";
const ACTION_TTL_HOURS: i64 = 24;

/// Closed initial setup command set. The same request DTOs are used by the
/// staff HTTP handlers, so an agent cannot prepare a shape the staff surface
/// would parse differently.
#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "type",
    content = "input",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum AirhopAgentCommand {
    PutOrganizationSettings(PutOrganizationSettingsBody),
    CreateBranch(CreateBranchBody),
    CreateRoom {
        branch_id: Uuid,
        body: CreateRoomBody,
    },
    CreateTeacher(CreateTeacherBody),
    CreateGroup(CreateGroupBody),
    CreateTariff(CreateTariffBody),
    CreateFamily(CreateFamilyBody),
    EnrollParticipant(EnrollStaffParticipantBody),
    MutatePayment {
        payment_id: Uuid,
        body: MutatePaymentBody,
    },
}

impl AirhopAgentCommand {
    fn kind(&self) -> &'static str {
        match self {
            Self::PutOrganizationSettings(_) => "put_organization_settings",
            Self::CreateBranch(_) => "create_branch",
            Self::CreateRoom { .. } => "create_room",
            Self::CreateTeacher(_) => "create_teacher",
            Self::CreateGroup(_) => "create_group",
            Self::CreateTariff(_) => "create_tariff",
            Self::CreateFamily(_) => "create_family",
            Self::EnrollParticipant(_) => "enroll_participant",
            Self::MutatePayment { .. } => "mutate_payment",
        }
    }

    fn canonical_value(&self) -> Result<Value, serde_json::Error> {
        serde_json::to_value(self)
    }

    fn validate_required_fields(&self) -> Result<(), &'static str> {
        let value = self
            .canonical_value()
            .map_err(|_| "command serialization failed")?;
        let input = value.get("input").ok_or("command input is required")?;
        let required = match self {
            Self::PutOrganizationSettings(_) => &["name", "locale", "timeZone"] as &[_],
            Self::CreateBranch(_) => &["name", "address"],
            Self::CreateRoom { .. } => &["body.name"],
            Self::CreateTeacher(_) => &["displayName"],
            Self::CreateGroup(_) => &["group.name"],
            Self::CreateTariff(_) => &["name", "currency"],
            Self::CreateFamily(_) => &["displayName", "representativeName", "phone", "childName"],
            Self::EnrollParticipant(_) => &[],
            Self::MutatePayment { .. } => &[],
        };
        for path in required {
            let Some(value) = value_at_path(input, path) else {
                return Err("required command field is missing");
            };
            if value.as_str().is_some_and(|value| value.trim().is_empty()) {
                return Err("required command text must not be blank");
            }
        }
        Ok(())
    }

    fn expected_versions(&self, organization_version: i64) -> Value {
        let mut versions =
            Map::from_iter([("organization".to_owned(), Value::from(organization_version))]);
        if let Ok(value) = self.canonical_value() {
            collect_expected_versions(&value, "command", &mut versions);
        }
        Value::Object(versions)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareAgentActionBody {
    channel_id: Uuid,
    triggering_event_id: String,
    command: AirhopAgentCommand,
}

/// Authenticates the registered Administrator, prepares a pending row, and
/// publishes one relay-signed top-level confirmation preview. No Booking Core
/// mutation is executed here.
pub(crate) async fn prepare_agent_action(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let principal =
        authenticate_airhop(&state, &headers, "POST", PREPARE_PATH, Some(&body)).await?;
    let request: PrepareAgentActionBody = serde_json::from_slice(&body).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "invalid typed Airhop agent action JSON",
        )
    })?;
    request
        .command
        .validate_required_fields()
        .map_err(|message| api_error(StatusCode::UNPROCESSABLE_ENTITY, message))?;
    let triggering_event_id = parse_event_id(&request.triggering_event_id)?;
    let organization = state
        .db
        .get_airhop_organization(&principal.tenant)
        .await
        .map_err(map_db_error)?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "Airhop organization is not configured",
            )
        })?;
    let command = request.command.canonical_value().map_err(|error| {
        internal_error(&format!("Airhop command serialization failed: {error}"))
    })?;
    let command_bytes = serde_json::to_vec(&command)
        .map_err(|error| internal_error(&format!("Airhop command digest failed: {error}")))?;
    let command_digest: [u8; 32] = Sha256::digest(&command_bytes).into();
    let expected_versions = validate_current_state(
        &state,
        &principal.tenant,
        &request.command,
        organization.version,
    )
    .await?;
    let prepared = state
        .db
        .prepare_airhop_agent_action(
            &principal.tenant,
            &NewPendingAgentAction {
                channel_id: request.channel_id,
                triggering_event_id,
                prepared_by_agent_pubkey: principal.pubkey.to_bytes(),
                specialist_role: AirhopWelcomeRole::Administrator,
                command,
                command_digest,
                expected_versions,
                expires_at: Utc::now() + Duration::hours(ACTION_TTL_HOURS),
            },
        )
        .await
        .map_err(map_db_error)?;

    if prepared.action.status != AgentActionStatus::Pending {
        return Ok(Json(action_response(&prepared.action, prepared.replayed)));
    }
    let event = build_preview_event(
        &state.relay_keypair,
        &prepared.action,
        &request.command,
        &organization.locale,
    )
    .map_err(|error| internal_error(&format!("Airhop preview build failed: {error}")))?;
    let preview_event_id = *event.id.as_bytes();
    let action = state
        .db
        .reserve_airhop_agent_action_preview(
            &principal.tenant,
            prepared.action.id,
            preview_event_id,
        )
        .await
        .map_err(map_db_error)?;
    crate::airhop_payments::persist_message(
        &state,
        &principal.tenant,
        action.channel_id,
        &event,
        None,
        None,
        0,
    )
    .await
    .map_err(|error| internal_error(&format!("Airhop preview publication failed: {error}")))?;
    Ok(Json(action_response(&action, prepared.replayed)))
}

async fn validate_current_state(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    command: &AirhopAgentCommand,
    organization_version: i64,
) -> Result<Value, (StatusCode, Json<Value>)> {
    let command_value = command
        .canonical_value()
        .map_err(|error| internal_error(&format!("Airhop command validation failed: {error}")))?;
    let input = command_value.get("input").ok_or_else(|| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "command input is required",
        )
    })?;
    let mut expected = command
        .expected_versions(organization_version)
        .as_object()
        .cloned()
        .unwrap_or_default();

    match command {
        AirhopAgentCommand::PutOrganizationSettings(_) => {
            let version = required_i64(input, "expectedVersion")?;
            require_current_version("organization", version, organization_version)?;
        }
        AirhopAgentCommand::CreateBranch(_)
        | AirhopAgentCommand::CreateTeacher(_)
        | AirhopAgentCommand::CreateTariff(_) => {}
        AirhopAgentCommand::CreateFamily(_) => {
            let phone = required_string(input, "phone")?;
            if crate::api::airhop_public::normalize_airhop_phone(phone).is_none() {
                return Err(api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid phone number",
                ));
            }
        }
        AirhopAgentCommand::CreateRoom { .. } => {
            let branch_id = required_uuid(input, "branchId")?;
            let branches = state
                .db
                .list_airhop_branches(tenant)
                .await
                .map_err(map_db_error)?;
            let branch = branches
                .iter()
                .find(|branch| branch.id == branch_id && branch.status == BranchStatus::Active)
                .ok_or_else(|| {
                    api_error(StatusCode::UNPROCESSABLE_ENTITY, "active branch not found")
                })?;
            insert_version(&mut expected, "branch", branch.id, branch.version);
        }
        AirhopAgentCommand::CreateGroup(_) => {
            let group = input.get("group").ok_or_else(|| {
                api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "group definition is required",
                )
            })?;
            let branch_id = required_uuid(group, "branchId")?;
            let branches = state
                .db
                .list_airhop_branches(tenant)
                .await
                .map_err(map_db_error)?;
            let branch = branches
                .iter()
                .find(|branch| branch.id == branch_id && branch.status == BranchStatus::Active)
                .ok_or_else(|| {
                    api_error(StatusCode::UNPROCESSABLE_ENTITY, "active branch not found")
                })?;
            insert_version(&mut expected, "branch", branch.id, branch.version);
            if let Some(room_id) = optional_uuid(group, "roomId")? {
                let rooms = state
                    .db
                    .list_airhop_rooms(tenant)
                    .await
                    .map_err(map_db_error)?;
                let room = rooms
                    .iter()
                    .find(|room| {
                        room.id == room_id
                            && room.branch_id == branch_id
                            && room.status == RoomStatus::Active
                    })
                    .ok_or_else(|| {
                        api_error(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "active room in the selected branch not found",
                        )
                    })?;
                insert_version(&mut expected, "room", room.id, room.version);
            }
            let teacher_ids = optional_uuid_array(group, "teacherIds")?;
            if !teacher_ids.is_empty() {
                let teachers = state
                    .db
                    .list_airhop_teachers(tenant)
                    .await
                    .map_err(map_db_error)?;
                for teacher_id in teacher_ids {
                    let teacher = teachers
                        .iter()
                        .find(|teacher| {
                            teacher.id == teacher_id && teacher.status == TeacherStatus::Active
                        })
                        .ok_or_else(|| {
                            api_error(StatusCode::UNPROCESSABLE_ENTITY, "active teacher not found")
                        })?;
                    insert_version(&mut expected, "teacher", teacher.id, teacher.version);
                }
            }
        }
        AirhopAgentCommand::EnrollParticipant(_) => {
            let family_id = required_uuid(input, "familyId")?;
            let child_id = required_uuid(input, "childId")?;
            let group_id = required_uuid(input, "groupId")?;
            let tariff_id = required_uuid(input, "tariffId")?;
            let family = state
                .db
                .get_airhop_staff_family_detail(tenant, family_id)
                .await
                .map_err(map_db_error)?;
            if family.family.status != "active"
                || !family
                    .children
                    .iter()
                    .any(|child| child.id == child_id && child.status == "active")
            {
                return Err(api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "active family child not found",
                ));
            }
            insert_version(
                &mut expected,
                "family",
                family.family.id,
                family.family.version,
            );
            let groups = state
                .db
                .list_airhop_groups(tenant)
                .await
                .map_err(map_db_error)?;
            let group = groups
                .iter()
                .find(|group| group.id == group_id && group.status == GroupStatus::Active)
                .ok_or_else(|| {
                    api_error(StatusCode::UNPROCESSABLE_ENTITY, "active group not found")
                })?;
            insert_version(&mut expected, "group", group.id, group.version);
            let tariffs = state
                .db
                .list_airhop_tariffs(tenant)
                .await
                .map_err(map_db_error)?;
            let tariff = tariffs
                .iter()
                .find(|tariff| tariff.id == tariff_id && tariff.status == TariffStatus::Active)
                .ok_or_else(|| {
                    api_error(StatusCode::UNPROCESSABLE_ENTITY, "active tariff not found")
                })?;
            insert_version(&mut expected, "tariff", tariff.id, tariff.version);
            let selected_rule_ids = input
                .get("schedule")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|selection| required_uuid(selection, "recurrenceRuleId"))
                .collect::<Result<Vec<_>, _>>()?;
            if !selected_rule_ids.is_empty() {
                let rules = state
                    .db
                    .list_airhop_recurrence_rules(tenant)
                    .await
                    .map_err(map_db_error)?;
                for rule_id in selected_rule_ids {
                    let rule = rules
                        .iter()
                        .find(|rule| {
                            rule.id == rule_id
                                && rule.group_id == group_id
                                && rule.status == RecurrenceRuleStatus::Active
                        })
                        .ok_or_else(|| {
                            api_error(
                                StatusCode::UNPROCESSABLE_ENTITY,
                                "active recurrence rule for the group not found",
                            )
                        })?;
                    insert_version(&mut expected, "recurrenceRule", rule.id, rule.version);
                }
            }
        }
        AirhopAgentCommand::MutatePayment { .. } => {
            let payment_id = required_uuid(input, "paymentId")?;
            let expected_version = required_i64(input, "body.expectedVersion")?;
            let payments = state
                .db
                .list_airhop_staff_payments(tenant)
                .await
                .map_err(map_db_error)?;
            let payment = payments
                .iter()
                .find(|item| item.payment.id == payment_id)
                .ok_or_else(|| api_error(StatusCode::UNPROCESSABLE_ENTITY, "payment not found"))?;
            require_current_version("payment", expected_version, payment.payment.version)?;
            insert_version(
                &mut expected,
                "payment",
                payment.payment.id,
                payment.payment.version,
            );
        }
    }
    Ok(Value::Object(expected))
}

fn require_current_version(
    resource: &str,
    expected: i64,
    current: i64,
) -> Result<(), (StatusCode, Json<Value>)> {
    if expected == current {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::CONFLICT,
            &format!("{resource} changed; read current data before preparing the action"),
        ))
    }
}

fn insert_version(output: &mut Map<String, Value>, kind: &str, id: Uuid, version: i64) {
    output.insert(format!("{kind}:{id}"), Value::from(version));
}

fn required_string<'a>(value: &'a Value, path: &str) -> Result<&'a str, (StatusCode, Json<Value>)> {
    value_at_path(value, path)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                &format!("{path} is required"),
            )
        })
}

fn required_i64(value: &Value, path: &str) -> Result<i64, (StatusCode, Json<Value>)> {
    value_at_path(value, path)
        .and_then(Value::as_i64)
        .ok_or_else(|| {
            api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                &format!("{path} must be an integer"),
            )
        })
}

fn required_uuid(value: &Value, path: &str) -> Result<Uuid, (StatusCode, Json<Value>)> {
    let raw = required_string(value, path)?;
    Uuid::parse_str(raw).map_err(|_| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{path} must be a UUID"),
        )
    })
}

fn optional_uuid(value: &Value, path: &str) -> Result<Option<Uuid>, (StatusCode, Json<Value>)> {
    match value_at_path(value, path) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => required_uuid(value, path).map(Some),
    }
}

fn optional_uuid_array(value: &Value, path: &str) -> Result<Vec<Uuid>, (StatusCode, Json<Value>)> {
    value_at_path(value, path)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|value| {
            value
                .as_str()
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    api_error(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        &format!("{path} must contain UUIDs"),
                    )
                })
        })
        .collect()
}

fn action_response(action: &PendingAgentAction, replayed: bool) -> Value {
    json!({
        "actionId": action.id,
        "previewEventId": action.preview_event_id.map(hex::encode),
        "status": action.status.as_str(),
        "message": if action.status == AgentActionStatus::Pending {
            "Preview posted. Wait for a human ✅."
        } else {
            "This prepared action is no longer pending."
        },
        "replayed": replayed,
    })
}

fn build_preview_event(
    keys: &Keys,
    action: &PendingAgentAction,
    command: &AirhopAgentCommand,
    locale: &str,
) -> anyhow::Result<Event> {
    let channel_id = action.channel_id.to_string();
    let organization_id = action.organization_id.to_string();
    let action_id = action.id.to_string();
    let digest = hex::encode(action.command_digest);
    let tags = vec![
        Tag::parse(["h", channel_id.as_str()])?,
        Tag::parse([
            "airhop-action",
            organization_id.as_str(),
            action_id.as_str(),
            "1",
            digest.as_str(),
        ])?,
    ];
    EventBuilder::new(
        Kind::from(buzz_core::kind::KIND_STREAM_MESSAGE as u16),
        localized_preview(command, locale),
    )
    .tags(tags)
    .custom_created_at(crate::airhop_payments::nostr_timestamp(action.created_at)?)
    .sign_with_keys(keys)
    .map_err(Into::into)
}

fn localized_preview(command: &AirhopAgentCommand, locale: &str) -> String {
    let language = language(locale);
    let specialist = match language {
        "ru" => "Администратор",
        "pt" => "Administrador",
        _ => "Administrator",
    };
    let label = command_label(command, language);
    let details = command_details(command, language);
    let instruction = match language {
        "ru" => "Проверьте данные и поставьте ✅, чтобы применить.",
        "pt" => "Confirme os dados e reaja com ✅ para aplicar.",
        _ => "Check the details and react with ✅ to apply.",
    };
    if details.is_empty() {
        format!("{specialist} · {label}\n\n{instruction}")
    } else {
        format!("{specialist} · {label}\n{details}\n\n{instruction}")
    }
}

fn command_label(command: &AirhopAgentCommand, language: &str) -> &'static str {
    match (language, command.kind()) {
        ("ru", "put_organization_settings") => "Настройки организации",
        ("ru", "create_branch") => "Новый филиал",
        ("ru", "create_room") => "Новый зал",
        ("ru", "create_teacher") => "Новый преподаватель",
        ("ru", "create_group") => "Новая группа",
        ("ru", "create_tariff") => "Новый тариф",
        ("ru", "create_family") => "Новая семья",
        ("ru", "enroll_participant") => "Зачисление ученика",
        ("ru", "mutate_payment") => "Изменение оплаты",
        ("pt", "put_organization_settings") => "Definições da organização",
        ("pt", "create_branch") => "Nova unidade",
        ("pt", "create_room") => "Nova sala",
        ("pt", "create_teacher") => "Novo professor",
        ("pt", "create_group") => "Novo grupo",
        ("pt", "create_tariff") => "Novo plano",
        ("pt", "create_family") => "Nova família",
        ("pt", "enroll_participant") => "Inscrição do aluno",
        ("pt", "mutate_payment") => "Alteração de pagamento",
        (_, "put_organization_settings") => "Organization settings",
        (_, "create_branch") => "New branch",
        (_, "create_room") => "New room",
        (_, "create_teacher") => "New teacher",
        (_, "create_group") => "New group",
        (_, "create_tariff") => "New tariff",
        (_, "create_family") => "New family",
        (_, "enroll_participant") => "Enroll student",
        (_, "mutate_payment") => "Payment change",
        _ => "Airhop action",
    }
}

fn command_details(command: &AirhopAgentCommand, language: &str) -> String {
    let Ok(value) = command.canonical_value() else {
        return String::new();
    };
    let Some(input) = value.get("input") else {
        return String::new();
    };
    let fields: &[(&str, &str)] = match command {
        AirhopAgentCommand::PutOrganizationSettings(_) => &[
            ("name", label(language, "Name", "Название", "Nome")),
            ("locale", label(language, "Language", "Язык", "Idioma")),
            (
                "timeZone",
                label(language, "Time zone", "Часовой пояс", "Fuso horário"),
            ),
        ],
        AirhopAgentCommand::CreateBranch(_) => &[
            ("name", label(language, "Name", "Название", "Nome")),
            ("address", label(language, "Address", "Адрес", "Morada")),
        ],
        AirhopAgentCommand::CreateRoom { .. } => {
            &[("body.name", label(language, "Room", "Зал", "Sala"))]
        }
        AirhopAgentCommand::CreateTeacher(_) => &[(
            "displayName",
            label(language, "Teacher", "Преподаватель", "Professor"),
        )],
        AirhopAgentCommand::CreateGroup(_) => {
            &[("group.name", label(language, "Group", "Группа", "Grupo"))]
        }
        AirhopAgentCommand::CreateTariff(_) => {
            &[("name", label(language, "Tariff", "Тариф", "Plano"))]
        }
        AirhopAgentCommand::CreateFamily(_) => &[
            ("displayName", label(language, "Family", "Семья", "Família")),
            ("childName", label(language, "Student", "Ученик", "Aluno")),
        ],
        AirhopAgentCommand::EnrollParticipant(_) => {
            &[("startDate", label(language, "Starts", "Начало", "Início"))]
        }
        AirhopAgentCommand::MutatePayment { .. } => &[(
            "body.action",
            label(language, "Operation", "Операция", "Operação"),
        )],
    };
    let mut lines = fields
        .iter()
        .filter_map(|(path, title)| {
            let value = value_at_path(input, path)?;
            let rendered = if path.ends_with("Date") {
                format_date(value.as_str()?, language)
            } else {
                scalar_text(value)?
            };
            Some(format!("{title}: {rendered}"))
        })
        .collect::<Vec<_>>();
    if matches!(command, AirhopAgentCommand::CreateTariff(_)) {
        if let (Some(amount), Some(currency)) = (
            value_at_path(input, "priceMinor").and_then(Value::as_i64),
            value_at_path(input, "currency").and_then(Value::as_str),
        ) {
            lines.push(format!(
                "{}: {}",
                label(language, "Price", "Цена", "Preço"),
                format_money(amount, currency, language)
            ));
        }
    }
    if matches!(command, AirhopAgentCommand::MutatePayment { .. }) {
        if let Some(amount) = value_at_path(input, "body.amountMinor").and_then(Value::as_i64) {
            lines.push(format!(
                "{}: {}",
                label(language, "Amount", "Сумма", "Montante"),
                format_minor(amount, language)
            ));
        }
    }
    lines.join("\n")
}

fn label<'a>(language: &str, en: &'a str, ru: &'a str, pt: &'a str) -> &'a str {
    match language {
        "ru" => ru,
        "pt" => pt,
        _ => en,
    }
}

fn language(locale: &str) -> &str {
    match locale.split(['-', '_']).next().unwrap_or_default() {
        "ru" | "RU" => "ru",
        "pt" | "PT" => "pt",
        _ => "en",
    }
}

fn format_date(value: &str, language: &str) -> String {
    let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") else {
        return value.to_owned();
    };
    match language {
        "ru" | "pt" => date.format("%d.%m.%Y").to_string(),
        _ => date.format("%Y-%m-%d").to_string(),
    }
}

fn format_money(amount_minor: i64, currency: &str, language: &str) -> String {
    format!(
        "{} {}",
        format_minor(amount_minor, language),
        currency.to_uppercase()
    )
}

fn format_minor(amount_minor: i64, language: &str) -> String {
    let sign = if amount_minor < 0 { "-" } else { "" };
    let absolute = i128::from(amount_minor).abs();
    let separator = if matches!(language, "ru" | "pt") {
        ','
    } else {
        '.'
    };
    format!("{sign}{}{separator}{:02}", absolute / 100, absolute % 100)
}

fn scalar_text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.to_owned()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn value_at_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .try_fold(value, |value, part| value.get(part))
}

fn collect_expected_versions(value: &Value, path: &str, output: &mut Map<String, Value>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                let child = format!("{path}.{key}");
                if key == "expectedVersion" && value.is_i64() {
                    output.insert(child, value.clone());
                } else {
                    collect_expected_versions(value, &child, output);
                }
            }
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                collect_expected_versions(value, &format!("{path}[{index}]"), output);
            }
        }
        _ => {}
    }
}

fn parse_event_id(value: &str) -> Result<[u8; 32], (StatusCode, Json<Value>)> {
    let bytes = hex::decode(value.trim()).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "invalid Airhop triggering event id",
        )
    })?;
    bytes.try_into().map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "invalid Airhop triggering event id",
        )
    })
}

fn map_db_error(error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    match error {
        buzz_db::DbError::NotFound(_) => {
            api_error(StatusCode::NOT_FOUND, "Airhop action resource not found")
        }
        buzz_db::DbError::AccessDenied(_) => api_error(
            StatusCode::FORBIDDEN,
            "only the registered Airhop Administrator may prepare this action",
        ),
        buzz_db::DbError::InvalidData(message) => {
            api_error(StatusCode::UNPROCESSABLE_ENTITY, &message)
        }
        buzz_db::DbError::AirhopVersionConflict => api_error(
            StatusCode::CONFLICT,
            "Airhop action or preview is no longer current",
        ),
        other => internal_error(&format!("Airhop agent action failed: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use chrono::DateTime;
    use serde_json::json;

    use super::*;

    fn pending(command: Value) -> PendingAgentAction {
        PendingAgentAction {
            id: Uuid::from_u128(7),
            organization_id: Uuid::from_u128(8),
            channel_id: Uuid::from_u128(9),
            triggering_event_id: [1; 32],
            initiator_pubkey: [2; 32],
            prepared_by_agent_pubkey: [3; 32],
            specialist_role: AirhopWelcomeRole::Administrator,
            command,
            command_digest: [4; 32],
            expected_versions: json!({"organization": 1}),
            preview_event_id: None,
            status: AgentActionStatus::Pending,
            expires_at: DateTime::from_timestamp(1_900_000_000, 0).unwrap(),
            created_at: DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
        }
    }

    #[test]
    fn typed_commands_reject_unknown_variants_and_fields() {
        assert!(serde_json::from_value::<AirhopAgentCommand>(json!({
            "type": "delete_everything",
            "input": {}
        }))
        .is_err());
        assert!(serde_json::from_value::<AirhopAgentCommand>(json!({
            "type": "create_room",
            "input": {
                "branchId": Uuid::nil(),
                "body": {"name": "Blue", "unexpected": true}
            }
        }))
        .is_err());
        assert!(serde_json::from_value::<AirhopAgentCommand>(json!({
            "type": "create_room",
            "input": {"branchId": Uuid::nil(), "body": {"name": "Blue"}}
        }))
        .is_ok());
    }

    #[test]
    fn preview_is_top_level_retry_stable_and_binds_exact_digest() {
        let command: AirhopAgentCommand = serde_json::from_value(json!({
            "type": "create_tariff",
            "input": {
                "name": "Base",
                "priceMinor": 4200,
                "currency": "EUR",
                "weeklyScheduleLimit": 2
            }
        }))
        .unwrap();
        let action = pending(command.canonical_value().unwrap());
        let keys = Keys::generate();
        let first = build_preview_event(&keys, &action, &command, "ru-RU").unwrap();
        let second = build_preview_event(&keys, &action, &command, "ru-RU").unwrap();
        assert_eq!(first.id, second.id);
        assert!(first.content.contains("Администратор"));
        assert!(first.content.contains("42,00 EUR"));
        assert!(first.content.ends_with("✅, чтобы применить."));
        let tags = first
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect::<Vec<_>>();
        assert!(!tags.iter().any(|tag| tag[0] == "e"));
        assert!(tags.iter().any(|tag| tag
            == &[
                "airhop-action",
                &action.organization_id.to_string(),
                &action.id.to_string(),
                "1",
                &hex::encode(action.command_digest),
            ]));
    }

    #[test]
    fn preview_localizes_dates_and_confirmation_instruction() {
        let command: AirhopAgentCommand = serde_json::from_value(json!({
            "type": "enroll_participant",
            "input": {
                "familyId": Uuid::new_v4(),
                "childId": Uuid::new_v4(),
                "groupId": Uuid::new_v4(),
                "tariffId": Uuid::new_v4(),
                "startDate": "2026-08-21",
                "schedule": []
            }
        }))
        .unwrap();
        let text = localized_preview(&command, "pt-PT");
        assert!(text.contains("21.08.2026"));
        assert!(text.contains("reaja com ✅"));
    }
}
