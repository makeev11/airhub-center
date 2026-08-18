//! Durable pending actions prepared by the registered Airhop Administrator.

use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::welcome_agents::AirhopWelcomeRole;
use crate::{Db, DbError, Result};

/// Lifecycle of one human-confirmed agent action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentActionStatus {
    /// Prepared and waiting for a human confirmation reaction.
    Pending,
    /// Replaced by a corrected command before confirmation.
    Cancelled,
    /// Applied atomically after confirmation.
    Committed,
    /// Confirmation window elapsed.
    Expired,
    /// A terminal application failure was recorded.
    Failed,
}

impl AgentActionStatus {
    /// Stable database/API value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Cancelled => "cancelled",
            Self::Committed => "committed",
            Self::Expired => "expired",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "cancelled" => Ok(Self::Cancelled),
            "committed" => Ok(Self::Committed),
            "expired" => Ok(Self::Expired),
            "failed" => Ok(Self::Failed),
            other => Err(DbError::InvalidData(format!(
                "unknown Airhop agent action status: {other}"
            ))),
        }
    }
}

/// One tenant-fenced action awaiting explicit human confirmation.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingAgentAction {
    /// Stable action identifier.
    pub id: Uuid,
    /// Server-resolved organization.
    pub organization_id: Uuid,
    /// Registered private Welcome channel.
    pub channel_id: Uuid,
    /// Human Welcome event that caused the preparation.
    pub triggering_event_id: [u8; 32],
    /// Human author of the triggering event.
    pub initiator_pubkey: [u8; 32],
    /// Exact registered agent that prepared the action.
    pub prepared_by_agent_pubkey: [u8; 32],
    /// Specialist role used for authorization and attribution.
    pub specialist_role: AirhopWelcomeRole,
    /// Closed command JSON parsed by the relay before persistence.
    pub command: Value,
    /// SHA-256 of the canonical typed command JSON.
    pub command_digest: [u8; 32],
    /// Resource versions captured while preparing the action.
    pub expected_versions: Value,
    /// Retry-stable relay-signed preview event, once reserved.
    pub preview_event_id: Option<[u8; 32]>,
    /// Current action lifecycle.
    pub status: AgentActionStatus,
    /// Confirmation deadline.
    pub expires_at: DateTime<Utc>,
    /// Stable creation time used to reproduce the preview event ID.
    pub created_at: DateTime<Utc>,
}

/// Validated preparation input supplied by the relay service.
#[derive(Debug, Clone, PartialEq)]
pub struct NewPendingAgentAction {
    /// Registered Welcome channel claimed by the caller.
    pub channel_id: Uuid,
    /// Human Welcome source event.
    pub triggering_event_id: [u8; 32],
    /// Authenticated registered specialist.
    pub prepared_by_agent_pubkey: [u8; 32],
    /// Closed specialist role.
    pub specialist_role: AirhopWelcomeRole,
    /// Canonical typed command JSON.
    pub command: Value,
    /// SHA-256 of `command`.
    pub command_digest: [u8; 32],
    /// Current resource versions captured by validation.
    pub expected_versions: Value,
    /// Confirmation deadline.
    pub expires_at: DateTime<Utc>,
}

/// Result of preparing or replaying a pending action.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedAgentAction {
    /// Persisted action.
    pub action: PendingAgentAction,
    /// True when the exact trigger and digest were already persisted.
    pub replayed: bool,
    /// Older pending action IDs cancelled by this corrected command.
    pub cancelled_action_ids: Vec<Uuid>,
}

fn validate_input(input: &NewPendingAgentAction, now: DateTime<Utc>) -> Result<()> {
    if input.specialist_role != AirhopWelcomeRole::Administrator {
        return Err(DbError::AccessDenied(
            "only the registered Airhop Administrator may prepare setup actions".to_owned(),
        ));
    }
    if !input.command.is_object() {
        return Err(DbError::InvalidData(
            "Airhop agent command must be a JSON object".to_owned(),
        ));
    }
    if !input.expected_versions.is_object() {
        return Err(DbError::InvalidData(
            "Airhop expectedVersions must be a JSON object".to_owned(),
        ));
    }
    if input.expires_at <= now {
        return Err(DbError::InvalidData(
            "Airhop agent action expiry must be in the future".to_owned(),
        ));
    }
    Ok(())
}

impl Db {
    /// Prepares exactly one pending action for a human Welcome event.
    ///
    /// The source event row is locked so concurrent corrected commands cannot
    /// leave more than one pending action. An exact retry returns the original
    /// row; a different digest cancels older pending rows before insertion.
    pub async fn prepare_airhop_agent_action(
        &self,
        tenant: &TenantContext,
        input: &NewPendingAgentAction,
    ) -> Result<PreparedAgentAction> {
        validate_input(input, Utc::now())?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;

        let team = sqlx::query(
            "SELECT team.organization_id, team.channel_id, team.fizz_pubkey,
                    team.administrator_pubkey, team.analyst_pubkey,
                    team.content_marketer_pubkey
             FROM airhop_welcome_teams team
             JOIN channels channel
               ON channel.community_id = team.community_id
              AND channel.id = team.channel_id
             WHERE team.community_id = $1
               AND channel.channel_type = 'stream'
               AND channel.visibility = 'private'
               AND channel.archived_at IS NULL
               AND channel.deleted_at IS NULL
             FOR UPDATE OF team",
        )
        .bind(community_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("active Airhop Welcome team".to_owned()))?;
        let organization_id: Uuid = team.try_get("organization_id")?;
        let registered_channel: Uuid = team.try_get("channel_id")?;
        if input.channel_id != registered_channel {
            return Err(DbError::AccessDenied(
                "agent action is outside the registered Welcome channel".to_owned(),
            ));
        }
        let administrator = vec_to_id(
            team.try_get("administrator_pubkey")?,
            "registered Administrator",
        )?;
        if input.prepared_by_agent_pubkey != administrator {
            return Err(DbError::AccessDenied(
                "only the registered Airhop Administrator may prepare setup actions".to_owned(),
            ));
        }

        let source = sqlx::query(
            "SELECT pubkey, kind, channel_id
             FROM events
             WHERE community_id = $1 AND id = $2 AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT 1
             FOR UPDATE",
        )
        .bind(community_id)
        .bind(input.triggering_event_id.as_slice())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("live Airhop Welcome source event".to_owned()))?;
        let source_channel: Option<Uuid> = source.try_get("channel_id")?;
        if source_channel != Some(registered_channel) {
            return Err(DbError::AccessDenied(
                "agent action source event is outside Welcome".to_owned(),
            ));
        }
        let source_kind: i32 = source.try_get("kind")?;
        if source_kind != i32::from(buzz_core::kind::KIND_STREAM_MESSAGE as u16) {
            return Err(DbError::InvalidData(
                "agent actions require a human stream-message source".to_owned(),
            ));
        }
        let initiator = vec_to_id(source.try_get("pubkey")?, "action initiator")?;
        for column in [
            "fizz_pubkey",
            "administrator_pubkey",
            "analyst_pubkey",
            "content_marketer_pubkey",
        ] {
            if initiator == vec_to_id(team.try_get(column)?, "registered Welcome agent")? {
                return Err(DbError::AccessDenied(
                    "agent-authored events cannot initiate setup actions".to_owned(),
                ));
            }
        }

        sqlx::query(
            "UPDATE airhop_agent_actions
             SET status = 'expired', updated_at = now()
             WHERE community_id = $1 AND triggering_event_id = $2
               AND status = 'pending' AND expires_at <= now()",
        )
        .bind(community_id)
        .bind(input.triggering_event_id.as_slice())
        .execute(&mut *tx)
        .await?;

        if let Some(row) = select_action(
            &mut tx,
            community_id,
            input.triggering_event_id,
            input.command_digest,
        )
        .await?
        {
            let action = action_from_row(&row)?;
            tx.commit().await?;
            return Ok(PreparedAgentAction {
                action,
                replayed: true,
                cancelled_action_ids: Vec::new(),
            });
        }

        let already_committed: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM airhop_agent_actions
                WHERE community_id = $1 AND triggering_event_id = $2
                  AND status = 'committed'
             )",
        )
        .bind(community_id)
        .bind(input.triggering_event_id.as_slice())
        .fetch_one(&mut *tx)
        .await?;
        if already_committed {
            return Err(DbError::AirhopVersionConflict);
        }

        let cancelled = sqlx::query_scalar::<_, Uuid>(
            "UPDATE airhop_agent_actions
             SET status = 'cancelled', updated_at = now()
             WHERE community_id = $1 AND triggering_event_id = $2
               AND status = 'pending' AND command_digest <> $3
             RETURNING id",
        )
        .bind(community_id)
        .bind(input.triggering_event_id.as_slice())
        .bind(input.command_digest.as_slice())
        .fetch_all(&mut *tx)
        .await?;

        let id = Uuid::new_v4();
        let row = sqlx::query(
            "INSERT INTO airhop_agent_actions (
                community_id, organization_id, id, channel_id,
                triggering_event_id, initiator_pubkey, prepared_by_agent_pubkey,
                specialist_role, command, command_digest, expected_versions,
                status, expires_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                       'pending', $12)
             RETURNING id, organization_id, channel_id, triggering_event_id,
                 initiator_pubkey, prepared_by_agent_pubkey, specialist_role,
                 command, command_digest, expected_versions, preview_event_id,
                 status, expires_at, created_at",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(id)
        .bind(registered_channel)
        .bind(input.triggering_event_id.as_slice())
        .bind(initiator.as_slice())
        .bind(administrator.as_slice())
        .bind(input.specialist_role.as_str())
        .bind(&input.command)
        .bind(input.command_digest.as_slice())
        .bind(&input.expected_versions)
        .bind(input.expires_at)
        .fetch_one(&mut *tx)
        .await?;
        let action = action_from_row(&row)?;
        tx.commit().await?;
        Ok(PreparedAgentAction {
            action,
            replayed: false,
            cancelled_action_ids: cancelled,
        })
    }

    /// Atomically reserves the deterministic relay preview event ID.
    pub async fn reserve_airhop_agent_action_preview(
        &self,
        tenant: &TenantContext,
        action_id: Uuid,
        preview_event_id: [u8; 32],
    ) -> Result<PendingAgentAction> {
        let community_id = *tenant.community().as_uuid();
        let row = sqlx::query(
            "UPDATE airhop_agent_actions
             SET preview_event_id = COALESCE(preview_event_id, $3), updated_at = now()
             WHERE community_id = $1 AND id = $2 AND status = 'pending'
               AND expires_at > now()
               AND (preview_event_id IS NULL OR preview_event_id = $3)
             RETURNING id, organization_id, channel_id, triggering_event_id,
                 initiator_pubkey, prepared_by_agent_pubkey, specialist_role,
                 command, command_digest, expected_versions, preview_event_id,
                 status, expires_at, created_at",
        )
        .bind(community_id)
        .bind(action_id)
        .bind(preview_event_id.as_slice())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(DbError::AirhopVersionConflict)?;
        action_from_row(&row)
    }
}

async fn select_action(
    connection: &mut PgConnection,
    community_id: Uuid,
    triggering_event_id: [u8; 32],
    command_digest: [u8; 32],
) -> Result<Option<sqlx::postgres::PgRow>> {
    sqlx::query(
        "SELECT id, organization_id, channel_id, triggering_event_id,
             initiator_pubkey, prepared_by_agent_pubkey, specialist_role,
             command, command_digest, expected_versions, preview_event_id,
             status, expires_at, created_at
         FROM airhop_agent_actions
         WHERE community_id = $1 AND triggering_event_id = $2 AND command_digest = $3",
    )
    .bind(community_id)
    .bind(triggering_event_id.as_slice())
    .bind(command_digest.as_slice())
    .fetch_optional(connection)
    .await
    .map_err(Into::into)
}

fn action_from_row(row: &sqlx::postgres::PgRow) -> Result<PendingAgentAction> {
    Ok(PendingAgentAction {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        channel_id: row.try_get("channel_id")?,
        triggering_event_id: vec_to_id(row.try_get("triggering_event_id")?, "trigger event")?,
        initiator_pubkey: vec_to_id(row.try_get("initiator_pubkey")?, "initiator")?,
        prepared_by_agent_pubkey: vec_to_id(
            row.try_get("prepared_by_agent_pubkey")?,
            "preparing agent",
        )?,
        specialist_role: parse_role(row.try_get("specialist_role")?)?,
        command: row.try_get("command")?,
        command_digest: vec_to_id(row.try_get("command_digest")?, "command digest")?,
        expected_versions: row.try_get("expected_versions")?,
        preview_event_id: row
            .try_get::<Option<Vec<u8>>, _>("preview_event_id")?
            .map(|value| vec_to_id(value, "preview event"))
            .transpose()?,
        status: AgentActionStatus::parse(row.try_get("status")?)?,
        expires_at: row.try_get("expires_at")?,
        created_at: row.try_get("created_at")?,
    })
}

fn parse_role(value: &str) -> Result<AirhopWelcomeRole> {
    match value {
        "fizz" => Ok(AirhopWelcomeRole::Fizz),
        "administrator" => Ok(AirhopWelcomeRole::Administrator),
        "analyst" => Ok(AirhopWelcomeRole::Analyst),
        "content_marketer" => Ok(AirhopWelcomeRole::ContentMarketer),
        other => Err(DbError::InvalidData(format!(
            "unknown Airhop specialist role: {other}"
        ))),
    }
}

fn vec_to_id(value: Vec<u8>, label: &str) -> Result<[u8; 32]> {
    value.try_into().map_err(|value: Vec<u8>| {
        DbError::InvalidData(format!(
            "Airhop {label} must contain 32 bytes, got {}",
            value.len()
        ))
    })
}

#[cfg(test)]
mod tests {
    use chrono::Duration;
    use serde_json::json;

    use super::*;

    fn input(role: AirhopWelcomeRole) -> NewPendingAgentAction {
        NewPendingAgentAction {
            channel_id: Uuid::new_v4(),
            triggering_event_id: [1; 32],
            prepared_by_agent_pubkey: [2; 32],
            specialist_role: role,
            command: json!({"type": "create_room", "input": {"branchId": Uuid::nil(), "body": {"name": "Blue"}}}),
            command_digest: [3; 32],
            expected_versions: json!({"branch": 1}),
            expires_at: Utc::now() + Duration::hours(24),
        }
    }

    #[test]
    fn agent_actions_fail_closed_for_non_administrator_and_invalid_shapes() {
        let now = Utc::now();
        assert!(validate_input(&input(AirhopWelcomeRole::Fizz), now).is_err());
        assert!(validate_input(&input(AirhopWelcomeRole::Analyst), now).is_err());
        assert!(validate_input(&input(AirhopWelcomeRole::ContentMarketer), now).is_err());
        assert!(validate_input(&input(AirhopWelcomeRole::Administrator), now).is_ok());

        let mut invalid = input(AirhopWelcomeRole::Administrator);
        invalid.command = json!([]);
        assert!(validate_input(&invalid, now).is_err());
        invalid = input(AirhopWelcomeRole::Administrator);
        invalid.expected_versions = json!([]);
        assert!(validate_input(&invalid, now).is_err());
        invalid = input(AirhopWelcomeRole::Administrator);
        invalid.expires_at = now;
        assert!(validate_input(&invalid, now).is_err());
    }

    #[test]
    fn agent_action_status_wire_values_are_closed() {
        for status in [
            AgentActionStatus::Pending,
            AgentActionStatus::Cancelled,
            AgentActionStatus::Committed,
            AgentActionStatus::Expired,
            AgentActionStatus::Failed,
        ] {
            assert_eq!(AgentActionStatus::parse(status.as_str()).unwrap(), status);
        }
        assert!(AgentActionStatus::parse("approved").is_err());
    }

    #[tokio::test]
    #[ignore = "requires a dedicated migrated Postgres database"]
    async fn agent_actions_are_atomic_idempotent_and_correction_safe() {
        use std::collections::BTreeMap;

        use buzz_core::{CommunityId, TenantContext};
        use nostr::{EventBuilder, Keys, Kind, Tag};

        use crate::airhop::welcome_agents::PutWelcomeTeamInput;

        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("BUZZ_TEST_DATABASE_URL must point to a dedicated migrated database");
        let db = Db::new(&crate::DbConfig {
            database_url,
            max_connections: 8,
            min_connections: 0,
            ..crate::DbConfig::default()
        })
        .await
        .expect("connect test database");
        db.migrate().await.expect("migrate test database");

        let community_id = Uuid::new_v4();
        let host = format!("agent-action-{}.test", community_id.simple());
        let tenant = TenantContext::resolved(CommunityId::from_uuid(community_id), host.clone());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_id)
            .bind(&host)
            .execute(&db.pool)
            .await
            .unwrap();

        let owner_keys = Keys::generate();
        let owner = owner_keys.public_key().to_bytes();
        db.bootstrap_owner(tenant.community(), &hex::encode(owner))
            .await
            .unwrap();
        let organization_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_organizations (
                community_id, id, name, locale, time_zone, default_trial_policy
             ) VALUES ($1, $2, 'Action test', 'ru-RU', 'Europe/Moscow', $3)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(json!({"mode": "free"}))
        .execute(&db.pool)
        .await
        .unwrap();
        let channel = crate::channel::create_channel(
            &db.pool,
            tenant.community(),
            "Welcome actions",
            crate::channel::ChannelType::Stream,
            crate::channel::ChannelVisibility::Private,
            None,
            &owner,
            None,
        )
        .await
        .unwrap();

        let agent_keys = AirhopWelcomeRole::ALL.map(|_| Keys::generate());
        let members = BTreeMap::from_iter(
            AirhopWelcomeRole::ALL
                .into_iter()
                .zip(agent_keys.iter().map(|keys| keys.public_key().to_bytes())),
        );
        for pubkey in members.values() {
            sqlx::query(
                "INSERT INTO users (community_id, pubkey, agent_type)
                 VALUES ($1, $2, 'managed-agent')",
            )
            .bind(community_id)
            .bind(pubkey.as_slice())
            .execute(&db.pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO channel_members (
                    community_id, channel_id, pubkey, role, invited_by
                 ) VALUES ($1, $2, $3, 'bot', $4)",
            )
            .bind(community_id)
            .bind(channel.id)
            .bind(pubkey.as_slice())
            .bind(owner.as_slice())
            .execute(&db.pool)
            .await
            .unwrap();
        }
        db.put_airhop_welcome_team(
            &tenant,
            &PutWelcomeTeamInput {
                organization_id,
                channel_id: channel.id,
                locale: "ru-RU".to_owned(),
                members: members.clone(),
                registered_by_pubkey: owner,
            },
        )
        .await
        .unwrap();

        let human = EventBuilder::new(Kind::Custom(9), "Создай зал")
            .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &human, Some(channel.id))
            .await
            .unwrap();
        let base = NewPendingAgentAction {
            channel_id: channel.id,
            triggering_event_id: *human.id.as_bytes(),
            prepared_by_agent_pubkey: members[&AirhopWelcomeRole::Administrator],
            specialist_role: AirhopWelcomeRole::Administrator,
            command: json!({"type": "create_room", "input": {"branchId": Uuid::nil(), "body": {"name": "Blue"}}}),
            command_digest: [11; 32],
            expected_versions: json!({"organization": 1}),
            expires_at: Utc::now() + Duration::hours(24),
        };

        let first = db.prepare_airhop_agent_action(&tenant, &base);
        let second = db.prepare_airhop_agent_action(&tenant, &base);
        let (first, second) = tokio::join!(first, second);
        let first = first.unwrap();
        let second = second.unwrap();
        assert_eq!(first.action.id, second.action.id);
        assert_eq!(
            usize::from(first.replayed) + usize::from(second.replayed),
            1
        );

        let mut corrected = base.clone();
        corrected.command = json!({"type": "create_room", "input": {"branchId": Uuid::nil(), "body": {"name": "Green"}}});
        corrected.command_digest = [12; 32];
        let corrected = db
            .prepare_airhop_agent_action(&tenant, &corrected)
            .await
            .unwrap();
        assert_ne!(corrected.action.id, first.action.id);
        assert_eq!(corrected.cancelled_action_ids, vec![first.action.id]);
        let old_status: String = sqlx::query_scalar(
            "SELECT status FROM airhop_agent_actions
             WHERE community_id = $1 AND id = $2",
        )
        .bind(community_id)
        .bind(first.action.id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(old_status, "cancelled");

        let reserved = db
            .reserve_airhop_agent_action_preview(&tenant, corrected.action.id, [21; 32])
            .await
            .unwrap();
        assert_eq!(reserved.preview_event_id, Some([21; 32]));
        assert!(db
            .reserve_airhop_agent_action_preview(&tenant, corrected.action.id, [22; 32])
            .await
            .is_err());
        assert!(db
            .prepare_airhop_agent_action(
                &tenant,
                &NewPendingAgentAction {
                    specialist_role: AirhopWelcomeRole::Analyst,
                    ..base
                },
            )
            .await
            .is_err());
    }
}
