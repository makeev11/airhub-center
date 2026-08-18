//! Authoritative AirHub room directory and audited staff commands.

use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::{
    append_domain_event, commit_command, insert_pending_command, ActorKind, AirhopActor,
    AirhopCommand, CommandInsertOutcome, CommandStatus, NewAirhopCommand, NewDomainEvent,
    PrivacyClass,
};
use crate::{Db, DbError, Result};

const CREATE_ROOM_COMMAND_TYPE: &str = "CreateRoom";
const PUT_ROOM_COMMAND_TYPE: &str = "PutRoom";

/// Lifecycle of an operational room.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoomStatus {
    /// Available for new groups and lessons.
    Active,
    /// Retained for existing and historical relationships.
    Archived,
}

impl RoomStatus {
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
                "unknown AirHub room status {other:?}"
            ))),
        }
    }
}

/// Server-authoritative room projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirhopRoom {
    /// Server-owned room identifier.
    pub id: Uuid,
    /// Server-resolved organization identifier.
    pub organization_id: Uuid,
    /// Immutable parent branch.
    pub branch_id: Uuid,
    /// Human-readable room or hall name.
    pub name: String,
    /// Operational lifecycle.
    pub status: RoomStatus,
    /// Optimistic entity version.
    pub version: i64,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
    /// Last update instant.
    pub updated_at: DateTime<Utc>,
}

/// Idempotent input for creating a room in an active branch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateRoomInput {
    /// Active parent branch selected by the authenticated request path.
    pub branch_id: Uuid,
    /// Human-readable room or hall name.
    pub name: String,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of method, path, and canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Full optimistic replacement of one room without changing its branch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutRoomInput {
    /// Immutable parent branch selected by the authenticated request path.
    pub branch_id: Uuid,
    /// Room selected by the authenticated request path.
    pub room_id: Uuid,
    /// Version observed by the staff client.
    pub expected_version: i64,
    /// Human-readable room or hall name.
    pub name: String,
    /// Desired operational lifecycle.
    pub status: RoomStatus,
    /// Keyed digest of the HTTP idempotency key.
    pub idempotency_digest: [u8; 32],
    /// Hash of method, path, and canonical HTTP body.
    pub request_hash: [u8; 32],
    /// Verified staff attribution.
    pub actor: AirhopActor,
}

/// Result of a create, update, archive, or restore command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoomMutationOutcome {
    /// Affected room.
    pub room_id: Uuid,
    /// New or replayed optimistic version.
    pub version: i64,
    /// True when an existing committed command receipt was replayed.
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRoomMutationResult {
    room_id: Uuid,
    version: i64,
}

impl Db {
    /// Lists all active and archived rooms for the host-resolved tenant.
    pub async fn list_airhop_rooms(&self, tenant: &TenantContext) -> Result<Vec<AirhopRoom>> {
        let organization_id = resolve_active_organization(&self.pool, tenant).await?;
        sqlx::query(
            "SELECT id, organization_id, branch_id, name, status, version, \
                    created_at, updated_at \
             FROM airhop_rooms \
             WHERE community_id = $1 AND organization_id = $2 \
             ORDER BY branch_id, CASE status WHEN 'active' THEN 0 ELSE 1 END, lower(name), id",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(parse_room_row)
        .collect()
    }

    /// Creates a room, audit event, and command receipt atomically.
    pub async fn create_airhop_room(
        &self,
        tenant: &TenantContext,
        input: &CreateRoomInput,
    ) -> Result<RoomMutationOutcome> {
        validate_create_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: CREATE_ROOM_COMMAND_TYPE.to_owned(),
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
        require_active_branch(&mut transaction, tenant, organization_id, input.branch_id).await?;
        let room_id = Uuid::new_v4();
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        sqlx::query(
            "INSERT INTO airhop_rooms (\
                 community_id, organization_id, id, branch_id, name, created_at, updated_at\
             ) VALUES ($1, $2, $3, $4, $5, $6, $6)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(room_id)
        .bind(input.branch_id)
        .bind(input.name.trim())
        .bind(occurred_at)
        .execute(&mut *transaction)
        .await?;
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "room".to_owned(),
                stream_id: room_id,
                stream_version: 1,
                event_type: "airhop.room.created.v1".to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "roomId": room_id,
                    "branchId": input.branch_id,
                }),
                privacy_class: PrivacyClass::Operational,
            },
        )
        .await?;
        finish_mutation(transaction, tenant, organization_id, command.id, room_id, 1).await
    }

    /// Replaces, archives, or restores one room with optimistic concurrency.
    pub async fn put_airhop_room(
        &self,
        tenant: &TenantContext,
        input: &PutRoomInput,
    ) -> Result<RoomMutationOutcome> {
        validate_put_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let organization_id = resolve_active_organization(&mut *transaction, tenant).await?;
        let branch_status =
            branch_status(&mut transaction, tenant, organization_id, input.branch_id).await?;
        let command = match insert_pending_command(
            &mut transaction,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: PUT_ROOM_COMMAND_TYPE.to_owned(),
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
            "SELECT status \
             FROM airhop_rooms \
             WHERE community_id = $1 AND organization_id = $2 \
               AND branch_id = $3 AND id = $4 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.branch_id)
        .bind(input.room_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHub room".to_owned()))?;
        let current_status = RoomStatus::from_db(&current_status)?;
        if current_status == RoomStatus::Archived
            && input.status == RoomStatus::Active
            && branch_status != "active"
        {
            return Err(DbError::NotFound("active AirHub branch".to_owned()));
        }
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let version: i64 = sqlx::query_scalar(
            "UPDATE airhop_rooms \
             SET name = $5, status = $6, version = version + 1, updated_at = $7 \
             WHERE community_id = $1 AND organization_id = $2 \
               AND branch_id = $3 AND id = $4 AND version = $8 \
             RETURNING version",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.branch_id)
        .bind(input.room_id)
        .bind(input.name.trim())
        .bind(input.status.as_db_str())
        .bind(occurred_at)
        .bind(input.expected_version)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(DbError::AirhopVersionConflict)?;
        let event_type = match (current_status, input.status) {
            (RoomStatus::Active, RoomStatus::Archived) => "airhop.room.archived.v1",
            (RoomStatus::Archived, RoomStatus::Active) => "airhop.room.restored.v1",
            _ => "airhop.room.updated.v1",
        };
        append_domain_event(
            &mut transaction,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "room".to_owned(),
                stream_id: input.room_id,
                stream_version: version,
                event_type: event_type.to_owned(),
                schema_version: 1,
                occurred_at,
                actor: input.actor.clone(),
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: json!({
                    "roomId": input.room_id,
                    "branchId": input.branch_id,
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
            input.room_id,
            version,
        )
        .await
    }
}

/// Executes the normal room creation service inside a caller-owned transaction.
pub(super) async fn create_airhop_room_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    input: &CreateRoomInput,
) -> Result<RoomMutationOutcome> {
    validate_agent_create_input(input)?;
    let organization_id = resolve_active_organization(&mut **transaction, tenant).await?;
    let command = match insert_pending_command(
        transaction,
        tenant,
        &NewAirhopCommand {
            id: Uuid::new_v4(),
            organization_id,
            command_type: CREATE_ROOM_COMMAND_TYPE.to_owned(),
            idempotency_digest: input.idempotency_digest,
            request_hash: input.request_hash,
            actor: input.actor.clone(),
            correlation_id: Uuid::new_v4(),
        },
    )
    .await?
    {
        CommandInsertOutcome::Inserted(command) => command,
        CommandInsertOutcome::Existing(command) => return replay_without_commit(command),
    };
    require_active_branch(transaction, tenant, organization_id, input.branch_id).await?;
    let room_id = Uuid::new_v4();
    let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
        .fetch_one(&mut **transaction)
        .await?;
    sqlx::query(
        "INSERT INTO airhop_rooms (\
             community_id, organization_id, id, branch_id, name, created_at, updated_at\
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(room_id)
    .bind(input.branch_id)
    .bind(input.name.trim())
    .bind(occurred_at)
    .execute(&mut **transaction)
    .await?;
    append_domain_event(
        transaction,
        tenant,
        &NewDomainEvent {
            id: Uuid::new_v4(),
            organization_id,
            stream_type: "room".to_owned(),
            stream_id: room_id,
            stream_version: 1,
            event_type: "airhop.room.created.v1".to_owned(),
            schema_version: 1,
            occurred_at,
            actor: input.actor.clone(),
            causation_id: command.id,
            correlation_id: command.correlation_id,
            payload: json!({"roomId": room_id, "branchId": input.branch_id}),
            privacy_class: PrivacyClass::Operational,
        },
    )
    .await?;
    let stored = StoredRoomMutationResult {
        room_id,
        version: 1,
    };
    commit_command(
        transaction,
        tenant,
        organization_id,
        command.id,
        &serde_json::to_value(&stored)?,
    )
    .await?;
    Ok(RoomMutationOutcome {
        room_id,
        version: 1,
        replayed: false,
    })
}

fn replay_without_commit(command: AirhopCommand) -> Result<RoomMutationOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredRoomMutationResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            Ok(RoomMutationOutcome {
                room_id: stored.room_id,
                version: stored.version,
                replayed: true,
            })
        }
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
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))
}

async fn branch_status(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    branch_id: Uuid,
) -> Result<String> {
    sqlx::query_scalar(
        "SELECT status FROM airhop_branches \
         WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
         FOR SHARE",
    )
    .bind(tenant.community().as_uuid())
    .bind(organization_id)
    .bind(branch_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| DbError::NotFound("AirHub branch".to_owned()))
}

async fn require_active_branch(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    branch_id: Uuid,
) -> Result<()> {
    if branch_status(transaction, tenant, organization_id, branch_id).await? == "active" {
        Ok(())
    } else {
        Err(DbError::NotFound("active AirHub branch".to_owned()))
    }
}

async fn finish_mutation(
    mut transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    organization_id: Uuid,
    command_id: Uuid,
    room_id: Uuid,
    version: i64,
) -> Result<RoomMutationOutcome> {
    let stored = StoredRoomMutationResult { room_id, version };
    commit_command(
        &mut transaction,
        tenant,
        organization_id,
        command_id,
        &serde_json::to_value(&stored)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(RoomMutationOutcome {
        room_id,
        version,
        replayed: false,
    })
}

async fn replay_mutation(
    transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    command: AirhopCommand,
) -> Result<RoomMutationOutcome> {
    match command.status {
        CommandStatus::Pending => Err(DbError::AirhopCommandInProgress),
        CommandStatus::Failed => Err(DbError::AirhopCommandPreviouslyFailed),
        CommandStatus::Committed => {
            let stored: StoredRoomMutationResult =
                serde_json::from_value(command.result.ok_or_else(|| {
                    DbError::InvalidData("committed AirHub command has no result".to_owned())
                })?)?;
            transaction.commit().await?;
            Ok(RoomMutationOutcome {
                room_id: stored.room_id,
                version: stored.version,
                replayed: true,
            })
        }
    }
}

fn parse_room_row(row: sqlx::postgres::PgRow) -> Result<AirhopRoom> {
    Ok(AirhopRoom {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        branch_id: row.try_get("branch_id")?,
        name: row.try_get("name")?,
        status: RoomStatus::from_db(row.try_get("status")?)?,
        version: row.try_get("version")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn validate_create_input(input: &CreateRoomInput) -> Result<()> {
    validate_common(input.branch_id, &input.name, &input.actor, false)
}

fn validate_agent_create_input(input: &CreateRoomInput) -> Result<()> {
    validate_common(input.branch_id, &input.name, &input.actor, true)
}

fn validate_put_input(input: &PutRoomInput) -> Result<()> {
    if input.room_id.is_nil() || input.expected_version <= 0 {
        return Err(DbError::InvalidData(
            "AirHub room identity or version is invalid".to_owned(),
        ));
    }
    validate_common(input.branch_id, &input.name, &input.actor, false)
}

fn validate_common(
    branch_id: Uuid,
    name: &str,
    actor: &AirhopActor,
    allow_bot: bool,
) -> Result<()> {
    actor.validate()?;
    if !(actor.kind == ActorKind::Staff || (allow_bot && actor.kind == ActorKind::Bot))
        || branch_id.is_nil()
        || name.trim().is_empty()
        || name.chars().count() > 160
    {
        return Err(DbError::InvalidData(
            "AirHub room input is invalid".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use buzz_core::{CommunityId, TenantContext};

    use super::*;

    fn actor() -> AirhopActor {
        AirhopActor {
            kind: ActorKind::Staff,
            pubkey: Some([8; 32]),
            on_behalf_of_pubkey: None,
            agent_pubkey: None,
        }
    }

    fn create_input(branch_id: Uuid) -> CreateRoomInput {
        CreateRoomInput {
            branch_id,
            name: "Большой зал".to_owned(),
            idempotency_digest: [11; 32],
            request_hash: [12; 32],
            actor: actor(),
        }
    }

    #[test]
    fn room_validation_rejects_blank_names_and_nil_branches() {
        assert!(validate_create_input(&create_input(Uuid::nil())).is_err());
        let mut input = create_input(Uuid::new_v4());
        input.name = "  ".to_owned();
        assert!(validate_create_input(&input).is_err());
    }

    #[tokio::test]
    #[ignore = "requires a dedicated migrated Postgres database"]
    async fn room_commands_are_persistent_idempotent_and_versioned() {
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
        let branch_id = Uuid::new_v4();
        let host = format!("room-directory-{}.test", community_id.simple());
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
             ) VALUES ($1, $2, 'Room test', 'ru-RU', 'Europe/Moscow', $3)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(json!({ "mode": "free" }))
        .execute(&db.pool)
        .await
        .expect("insert organization");
        sqlx::query(
            "INSERT INTO airhop_branches (community_id, organization_id, id, name, address) \
             VALUES ($1, $2, $3, 'Курская', 'Земляной Вал, 1')",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(branch_id)
        .execute(&db.pool)
        .await
        .expect("insert branch");

        let created = db
            .create_airhop_room(&tenant, &create_input(branch_id))
            .await
            .expect("create room");
        assert_eq!(created.version, 1);
        assert!(!created.replayed);
        assert!(
            db.create_airhop_room(&tenant, &create_input(branch_id))
                .await
                .expect("replay create")
                .replayed
        );
        let rooms = db.list_airhop_rooms(&tenant).await.expect("list rooms");
        assert_eq!(rooms.len(), 1);
        assert_eq!(rooms[0].branch_id, branch_id);

        let update = PutRoomInput {
            branch_id,
            room_id: created.room_id,
            expected_version: 1,
            name: "Большой зал 2".to_owned(),
            status: RoomStatus::Archived,
            idempotency_digest: [13; 32],
            request_hash: [14; 32],
            actor: actor(),
        };
        let updated = db
            .put_airhop_room(&tenant, &update)
            .await
            .expect("archive room");
        assert_eq!(updated.version, 2);
        assert!(matches!(
            db.put_airhop_room(
                &tenant,
                &PutRoomInput {
                    idempotency_digest: [15; 32],
                    request_hash: [16; 32],
                    ..update.clone()
                }
            )
            .await,
            Err(DbError::AirhopVersionConflict)
        ));
        let persisted = db.list_airhop_rooms(&tenant).await.expect("reload rooms");
        assert_eq!(persisted[0].name, "Большой зал 2");
        assert_eq!(persisted[0].status, RoomStatus::Archived);
        assert_eq!(persisted[0].version, 2);

        sqlx::query(
            "UPDATE airhop_branches SET status = 'archived' \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(branch_id)
        .execute(&db.pool)
        .await
        .expect("archive branch");
        assert!(
            db.create_airhop_room(&tenant, &create_input(branch_id))
                .await
                .expect("replay create after branch archive")
                .replayed
        );
        assert!(matches!(
            db.put_airhop_room(
                &tenant,
                &PutRoomInput {
                    expected_version: 2,
                    status: RoomStatus::Active,
                    idempotency_digest: [17; 32],
                    request_hash: [18; 32],
                    ..update
                }
            )
            .await,
            Err(DbError::NotFound(_))
        ));
    }
}
