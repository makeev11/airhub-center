//! Authoritative Airhop teacher directory and audited staff commands.

use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, AirhopActor, AirhopCommand,
    CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent, PrivacyClass,
};
use crate::{Db, DbError, Result};

const CREATE_TEACHER_COMMAND_TYPE: &str = "CreateTeacher";
const PUT_TEACHER_COMMAND_TYPE: &str = "PutTeacher";

/// Operational lifecycle of a teacher profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeacherStatus {
    /// Available for assignment to groups and lessons.
    Active,
    /// Retained for historical schedules and reporting.
    Archived,
}

impl TeacherStatus {
    const fn as_db_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
        }
    }

    fn from_db(value: &str) -> Result<Self> {
        match value {
            "active" => Ok(Self::Active),
            "archived" => Ok(Self::Archived),
            other => Err(DbError::InvalidData(format!(
                "unknown Airhop teacher status {other:?}"
            ))),
        }
    }
}

/// Server-authoritative teacher profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirhopTeacher {
    /// Server-owned teacher identifier.
    pub id: Uuid,
    /// Server-resolved organization identifier.
    pub organization_id: Uuid,
    /// Human-readable teacher name.
    pub display_name: String,
    /// Optional Buzz username without the leading at-sign.
    pub buzz_username: Option<String>,
    /// Operational lifecycle.
    pub status: TeacherStatus,
    /// Optimistic entity version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// Idempotent input for creating a teacher profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateTeacherInput {
    /// Human-readable teacher name.
    pub display_name: String,
    /// Optional Buzz username without the leading at-sign.
    pub buzz_username: Option<String>,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Canonical method/path/body request hash.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Full optimistic replacement of one teacher profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutTeacherInput {
    /// Teacher selected by the authenticated request path.
    pub teacher_id: Uuid,
    /// Version observed by the staff client.
    pub expected_version: i64,
    /// Human-readable teacher name.
    pub display_name: String,
    /// Optional Buzz username without the leading at-sign.
    pub buzz_username: Option<String>,
    /// Desired operational lifecycle.
    pub status: TeacherStatus,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Canonical method/path/body request hash.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of a teacher create, update, archive, or restore command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TeacherMutationOutcome {
    /// Affected teacher.
    pub teacher_id: Uuid,
    /// New or replayed optimistic version.
    pub version: i64,
    /// True when an existing committed command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTeacherMutationResult {
    teacher_id: Uuid,
    version: i64,
}

impl Db {
    /// Lists active and archived teachers for the host-resolved tenant.
    pub async fn list_airhop_teachers(&self, tenant: &TenantContext) -> Result<Vec<AirhopTeacher>> {
        let organization_id = resolve_active_organization(&self.pool, tenant).await?;
        sqlx::query(
            "SELECT id, organization_id, display_name, buzz_username, status, version, \
                    created_at, updated_at \
             FROM airhop_teachers \
             WHERE community_id = $1 AND organization_id = $2 \
             ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, lower(display_name), id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(parse_teacher_row)
        .collect()
    }

    /// Creates a teacher profile, audit event, and command receipt atomically.
    pub async fn create_airhop_teacher(
        &self,
        tenant: &TenantContext,
        input: &CreateTeacherInput,
    ) -> Result<TeacherMutationOutcome> {
        validate_teacher_fields(&input.display_name, input.buzz_username.as_deref())?;
        input.actor.validate()?;
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: CREATE_TEACHER_COMMAND_TYPE.to_owned(),
                idempotency_digest: input.idempotency_digest,
                request_hash: input.request_hash,
                actor: input.actor.clone(),
                correlation_id: Uuid::new_v4(),
            },
        )
        .await?
        {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_mutation(transaction, command).await;
            }
        };
        let teacher_id = Uuid::new_v4();
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        sqlx::query(
            "INSERT INTO airhop_teachers ( \
                 community_id, organization_id, id, display_name, buzz_username, \
                 created_at, updated_at \
             ) VALUES ($1, $2, $3, $4, $5, $6, $6)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(teacher_id)
        .bind(input.display_name.trim())
        .bind(trimmed_optional(input.buzz_username.as_deref()))
        .bind(occurred_at)
        .execute(&mut *transaction)
        .await?;
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "teacher".to_owned(),
                stream_id: teacher_id,
                stream_version: 1,
                event_type: "airhop.teacher.created.v1".to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "teacherId": teacher_id,
                }),
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;
        finish_mutation(
            transaction,
            tenant,
            organization_id,
            command.id,
            teacher_id,
            1,
        )
        .await
    }

    /// Replaces one teacher profile with optimistic concurrency and immutable audit.
    pub async fn put_airhop_teacher(
        &self,
        tenant: &TenantContext,
        input: &PutTeacherInput,
    ) -> Result<TeacherMutationOutcome> {
        validate_teacher_fields(&input.display_name, input.buzz_username.as_deref())?;
        input.actor.validate()?;
        if input.teacher_id.is_nil() || input.expected_version <= 0 {
            return Err(DbError::InvalidData(
                "Airhop teacher identity or version is invalid".to_owned(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: PUT_TEACHER_COMMAND_TYPE.to_owned(),
                idempotency_digest: input.idempotency_digest,
                request_hash: input.request_hash,
                actor: input.actor.clone(),
                correlation_id: Uuid::new_v4(),
            },
        )
        .await?
        {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(command) => {
                return replay_mutation(transaction, command).await;
            }
        };
        let current_status: String = sqlx::query_scalar(
            "SELECT status FROM airhop_teachers \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.teacher_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("Airhop teacher".to_owned()))?;
        let current_status = TeacherStatus::from_db(&current_status)?;
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let version: i64 = sqlx::query_scalar(
            "UPDATE airhop_teachers \
             SET display_name = $4, buzz_username = $5, status = $6, \
                 version = version + 1, updated_at = $7 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 AND version = $8 \
             RETURNING version",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.teacher_id)
        .bind(input.display_name.trim())
        .bind(trimmed_optional(input.buzz_username.as_deref()))
        .bind(input.status.as_db_str())
        .bind(occurred_at)
        .bind(input.expected_version)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(DbError::AirhopVersionConflict)?;
        let event_type = match (current_status, input.status) {
            (TeacherStatus::Active, TeacherStatus::Archived) => "airhop.teacher.archived.v1",
            (TeacherStatus::Archived, TeacherStatus::Active) => "airhop.teacher.restored.v1",
            _ => "airhop.teacher.updated.v1",
        };
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "teacher".to_owned(),
                stream_id: input.teacher_id,
                stream_version: version,
                event_type: event_type.to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "teacherId": input.teacher_id,
                    "status": input.status,
                }),
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;
        finish_mutation(
            transaction,
            tenant,
            organization_id,
            command.id,
            input.teacher_id,
            version,
        )
        .await
    }
}

async fn resolve_active_organization<'e, E>(executor: E, tenant: &TenantContext) -> Result<Uuid>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_scalar(
        "SELECT id FROM airhop_organizations \
         WHERE community_id = $1 AND status = 'active'",
    )
    .bind(tenant.community().as_uuid())
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| DbError::NotFound("active Airhop organization".to_owned()))
}

async fn finish_mutation(
    mut transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    command_id: Uuid,
    teacher_id: Uuid,
    version: i64,
) -> Result<TeacherMutationOutcome> {
    let stored = StoredTeacherMutationResult {
        teacher_id,
        version,
    };
    commit_command(
        &mut transaction,
        tenant,
        organization_id,
        command_id,
        &serde_json::to_value(&stored)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(TeacherMutationOutcome {
        teacher_id,
        version,
        replayed: false,
    })
}

async fn replay_mutation(
    transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    command: AirhopCommand,
) -> Result<TeacherMutationOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredTeacherMutationResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed Airhop command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(TeacherMutationOutcome {
                teacher_id: stored.teacher_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

fn parse_teacher_row(row: sqlx::postgres::PgRow) -> Result<AirhopTeacher> {
    Ok(AirhopTeacher {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        display_name: row.try_get("display_name")?,
        buzz_username: row.try_get("buzz_username")?,
        status: TeacherStatus::from_db(row.try_get("status")?)?,
        version: row.try_get("version")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn validate_teacher_fields(display_name: &str, buzz_username: Option<&str>) -> Result<()> {
    let display_name_length = display_name.trim().chars().count();
    if !(1..=160).contains(&display_name_length)
        || buzz_username.is_some_and(|value| {
            let value = value.trim();
            value.is_empty() || value.chars().count() > 160 || value.starts_with('@')
        })
    {
        return Err(DbError::InvalidData(
            "Airhop teacher fields are invalid".to_owned(),
        ));
    }
    Ok(())
}

fn trimmed_optional(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use buzz_core::{CommunityId, TenantContext};

    use super::super::ActorKind;

    fn actor() -> AirhopActor {
        AirhopActor {
            kind: ActorKind::Staff,
            pubkey: Some([8; 32]),
            on_behalf_of_pubkey: None,
            agent_pubkey: None,
        }
    }

    fn create_input() -> CreateTeacherInput {
        CreateTeacherInput {
            display_name: "Анна Орлова".to_owned(),
            buzz_username: Some("anna".to_owned()),
            idempotency_digest: [21; 32],
            request_hash: [22; 32],
            actor: actor(),
        }
    }

    use super::*;

    #[test]
    fn teacher_validation_accepts_business_boundaries() {
        assert!(validate_teacher_fields("А", None).is_ok());
        assert!(validate_teacher_fields(&"Я".repeat(160), Some("teacher.buzz")).is_ok());
    }

    #[test]
    fn teacher_validation_rejects_blank_long_and_prefixed_values() {
        assert!(validate_teacher_fields(" ", None).is_err());
        assert!(validate_teacher_fields(&"Я".repeat(161), None).is_err());
        assert!(validate_teacher_fields("Анна", Some("")).is_err());
        assert!(validate_teacher_fields("Анна", Some("@anna")).is_err());
        assert!(validate_teacher_fields("Анна", Some(&"a".repeat(161))).is_err());
    }
    #[tokio::test]
    #[ignore = "requires a dedicated migrated Postgres database"]
    async fn teacher_commands_are_persistent_idempotent_and_versioned() {
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("BUZZ_TEST_DATABASE_URL must point to a dedicated migrated database");
        let db = Db::new(&crate::DbConfig {
            database_url,
            max_connections: 5,
            min_connections: 0,
            ..crate::DbConfig::default()
        })
        .await
        .expect("connect test database");
        db.migrate().await.expect("migrate test database");

        let community_id = Uuid::new_v4();
        let organization_id = Uuid::new_v4();
        let host = format!("teacher-directory-{}.test", community_id.simple());
        let tenant = TenantContext::resolved(CommunityId::from_uuid(community_id), host.clone());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_id)
            .bind(&host)
            .execute(&db.pool)
            .await
            .expect("insert community");
        sqlx::query(
            "INSERT INTO airhop_organizations (\
                 community_id, id, name, locale, time_zone, default_trial_policy\
             ) VALUES ($1, $2, 'Teacher test', 'ru-RU', 'Europe/Moscow', $3)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(json!({ "mode": "free" }))
        .execute(&db.pool)
        .await
        .expect("insert organization");

        let created = db
            .create_airhop_teacher(&tenant, &create_input())
            .await
            .expect("create teacher");
        assert_eq!(created.version, 1);
        assert!(!created.replayed);
        assert!(
            db.create_airhop_teacher(&tenant, &create_input())
                .await
                .expect("replay create")
                .replayed
        );

        let teachers = db
            .list_airhop_teachers(&tenant)
            .await
            .expect("list teachers");
        assert_eq!(teachers.len(), 1);
        assert_eq!(teachers[0].display_name, "Анна Орлова");
        assert_eq!(teachers[0].buzz_username.as_deref(), Some("anna"));

        let update = PutTeacherInput {
            teacher_id: created.teacher_id,
            expected_version: 1,
            display_name: "Анна Соколова".to_owned(),
            buzz_username: None,
            status: TeacherStatus::Archived,
            idempotency_digest: [23; 32],
            request_hash: [24; 32],
            actor: actor(),
        };
        let updated = db
            .put_airhop_teacher(&tenant, &update)
            .await
            .expect("archive teacher");
        assert_eq!(updated.version, 2);
        assert!(matches!(
            db.put_airhop_teacher(
                &tenant,
                &PutTeacherInput {
                    idempotency_digest: [25; 32],
                    request_hash: [26; 32],
                    ..update.clone()
                }
            )
            .await,
            Err(DbError::AirhopVersionConflict)
        ));

        let persisted = db
            .list_airhop_teachers(&tenant)
            .await
            .expect("reload teachers");
        assert_eq!(persisted[0].display_name, "Анна Соколова");
        assert_eq!(persisted[0].buzz_username, None);
        assert_eq!(persisted[0].status, TeacherStatus::Archived);
        assert_eq!(persisted[0].version, 2);
    }
}
