//! Persistent desired state and replay-safe turn leases for external AirHop agents.

use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

/// Stable product blueprint for the parent-facing Hermes administrator.
pub const PARENT_ADMINISTRATOR_BLUEPRINT: &str = "airhop.hermes.parent_administrator";

/// Owner/admin desired state for one organization-isolated Hermes deployment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutParentAgentDeploymentInput {
    /// Stable deployment identity selected once by the control plane.
    pub deployment_id: Uuid,
    /// Exact Nostr principal used by this deployment only.
    pub agent_pubkey: [u8; 32],
    /// Immutable product-blueprint revision.
    pub blueprint_version: i64,
    /// Organization-isolated Hermes profile reference. This is not a secret.
    pub profile_ref: String,
    /// Pinned Hermes artifact/image revision.
    pub runtime_revision: String,
    /// Persona/SOUL revision.
    pub persona_revision: String,
    /// Base skill-bundle revision.
    pub skills_revision: String,
    /// Model-routing policy revision.
    pub model_revision: String,
    /// Whether the supervisor may start new turns.
    pub enabled: bool,
    /// Operational pause independent from configuration enablement.
    pub paused: bool,
    /// Master capability for booking mutations.
    pub manage_bookings: bool,
    /// Optimistic version, or zero when creating the deployment.
    pub expected_version: i64,
    /// Authenticated owner/admin applying this desired state.
    pub registered_by_pubkey: [u8; 32],
}

/// Safe persisted view of a parent-facing Hermes deployment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParentAgentDeployment {
    /// Server-resolved community.
    pub community_id: Uuid,
    /// Bound AirHop organization.
    pub organization_id: Uuid,
    /// Stable deployment identity.
    pub id: Uuid,
    /// Stable product blueprint key.
    pub blueprint_key: String,
    /// Product-blueprint revision.
    pub blueprint_version: i64,
    /// Stable product role.
    pub role: String,
    /// Exact Nostr principal.
    pub agent_pubkey: [u8; 32],
    /// Organization-isolated Hermes profile reference.
    pub profile_ref: String,
    /// Pinned runtime revision.
    pub runtime_revision: String,
    /// Persona revision.
    pub persona_revision: String,
    /// Skill-bundle revision.
    pub skills_revision: String,
    /// Model policy revision.
    pub model_revision: String,
    /// Whether new turns are enabled.
    pub enabled: bool,
    /// Whether operations are temporarily paused.
    pub paused: bool,
    /// Whether verified families may use booking mutations.
    pub manage_bookings: bool,
    /// Monotonic desired-state version.
    pub version: i64,
    /// Last owner/admin that changed desired state.
    pub registered_by_pubkey: [u8; 32],
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last material update time.
    pub updated_at: DateTime<Utc>,
}

/// Canonical source and domain scope for one coalesced parent input batch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeaseParentAgentTurnInput {
    /// Persisted deployment to execute.
    pub deployment_id: Uuid,
    /// Private Buzz thread channel.
    pub channel_id: Uuid,
    /// Stable external-conversation identity.
    pub conversation_id: Uuid,
    /// Current ownership cycle.
    pub cycle_id: Uuid,
    /// Deterministic/coalesced input batch identity.
    pub input_batch_id: Uuid,
    /// Canonical Buzz source event.
    pub source_message_id: [u8; 32],
    /// Verified Family when identity binding exists.
    pub family_id: Option<Uuid>,
    /// Verified representative paired with the Family.
    pub representative_id: Option<Uuid>,
    /// Bounded execution lease duration.
    pub lease_seconds: i64,
}

/// Exact live scope required to accept a signed Hermes context grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValidateParentAgentTurnLeaseInput {
    /// Organization captured when the grant was issued.
    pub organization_id: Uuid,
    /// Deployment captured when the grant was issued.
    pub deployment_id: Uuid,
    /// Exact desired-state version used by the turn.
    pub deployment_version: i64,
    /// Durable turn identity.
    pub turn_id: Uuid,
    /// Opaque proof for the current attempt.
    pub lease_token: Uuid,
    /// Authenticated Hermes principal.
    pub agent_pubkey: [u8; 32],
}

/// Durable lifecycle state for one Hermes execution attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HermesTurnStatus {
    /// One runtime owns an unexpired lease.
    Leased,
    /// The supervisor accepted a final result.
    Completed,
    /// Execution failed or its lease expired.
    Failed,
    /// A control-plane or human takeover cancelled execution.
    Cancelled,
}

impl HermesTurnStatus {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Leased => "leased",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "leased" => Ok(Self::Leased),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHop Hermes turn status: {other}"
            ))),
        }
    }
}

/// Persisted lease and immutable scope for one Hermes turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesTurnReceipt {
    /// Stable turn identity allocated by the server.
    pub id: Uuid,
    /// Deployment snapshot owner.
    pub deployment_id: Uuid,
    /// Exact runtime principal.
    pub agent_pubkey: [u8; 32],
    /// Canonical Buzz channel.
    pub channel_id: Uuid,
    /// Stable external conversation.
    pub conversation_id: Uuid,
    /// Current ownership cycle.
    pub cycle_id: Uuid,
    /// Deduplicated input batch.
    pub input_batch_id: Uuid,
    /// Canonical Buzz source event.
    pub source_message_id: [u8; 32],
    /// Verified Family scope, when available.
    pub family_id: Option<Uuid>,
    /// Verified representative scope, when available.
    pub representative_id: Option<Uuid>,
    /// Current lifecycle state.
    pub status: HermesTurnStatus,
    /// Opaque lease proof.
    pub lease_token: Uuid,
    /// Lease deadline.
    pub lease_expires_at: DateTime<Utc>,
    /// Number of leases for this same input batch.
    pub attempt: i32,
    /// Immutable deployment/capability snapshot.
    pub configuration_snapshot: serde_json::Value,
    /// Whether this acquisition replayed the same input batch.
    pub replayed: bool,
}

/// Atomically acquired deployment and turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeasedParentAgentTurn {
    /// Current desired state used to build capabilities.
    pub deployment: ParentAgentDeployment,
    /// Durable leased turn.
    pub turn: HermesTurnReceipt,
}

/// Terminal supervisor/runtime acknowledgement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FinishHermesTurn {
    /// The final draft/result was accepted by the supervisor.
    Completed {
        /// Stable supervisor outcome such as `waiting_parent`.
        outcome: String,
    },
    /// Execution failed before a result could be accepted.
    Failed {
        /// Stable operational error code.
        error_code: String,
    },
    /// Execution was explicitly cancelled, including human takeover.
    Cancelled {
        /// Stable cancellation reason such as `human_takeover`.
        error_code: String,
    },
}

impl Db {
    /// Creates or optimistically updates the single parent-administrator
    /// deployment for the server-resolved organization.
    pub async fn put_airhop_parent_agent_deployment(
        &self,
        tenant: &TenantContext,
        input: &PutParentAgentDeploymentInput,
    ) -> Result<ParentAgentDeployment> {
        validate_deployment_input(input)?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id = active_organization_id(&mut tx, community_id).await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!(
                "airhop_hermes_deployment:{community_id}:{organization_id}"
            ))
            .execute(&mut *tx)
            .await?;
        require_owner_or_admin(&mut tx, community_id, input.registered_by_pubkey).await?;
        let active_profile: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users
             WHERE community_id = $1 AND pubkey = $2 AND deactivated_at IS NULL)",
        )
        .bind(community_id)
        .bind(input.agent_pubkey.as_slice())
        .fetch_one(&mut *tx)
        .await?;
        if !active_profile {
            return Err(DbError::InvalidData(
                "AirHop Hermes principal must have an active Buzz profile".to_owned(),
            ));
        }

        let current = sqlx::query(
            "SELECT community_id, organization_id, id, blueprint_key, blueprint_version,
                    role, agent_pubkey, profile_ref, runtime_revision, persona_revision,
                    skills_revision, model_revision, enabled, paused, manage_bookings,
                    version, registered_by_pubkey, created_at, updated_at
             FROM airhop_agent_deployments
             WHERE community_id = $1 AND organization_id = $2
               AND role = 'parent_administrator'
             FOR UPDATE",
        )
        .bind(community_id)
        .bind(organization_id)
        .fetch_optional(&mut *tx)
        .await?;

        let row = if let Some(row) = current {
            let existing = deployment_from_row(&row)?;
            if existing.id != input.deployment_id || existing.version != input.expected_version {
                return Err(DbError::AirhopVersionConflict);
            }
            if deployment_matches_input(&existing, input) {
                tx.commit().await?;
                return Ok(existing);
            }
            let updated = sqlx::query(
                "UPDATE airhop_agent_deployments SET
                    blueprint_version = $4, agent_pubkey = $5, profile_ref = $6,
                    runtime_revision = $7, persona_revision = $8, skills_revision = $9,
                    model_revision = $10, enabled = $11, paused = $12,
                    manage_bookings = $13, registered_by_pubkey = $14,
                    version = version + 1, updated_at = now()
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3
                 RETURNING community_id, organization_id, id, blueprint_key,
                    blueprint_version, role, agent_pubkey, profile_ref, runtime_revision,
                    persona_revision, skills_revision, model_revision, enabled, paused,
                    manage_bookings, version, registered_by_pubkey, created_at, updated_at",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(input.deployment_id)
            .bind(input.blueprint_version)
            .bind(input.agent_pubkey.as_slice())
            .bind(input.profile_ref.trim())
            .bind(input.runtime_revision.trim())
            .bind(input.persona_revision.trim())
            .bind(input.skills_revision.trim())
            .bind(input.model_revision.trim())
            .bind(input.enabled)
            .bind(input.paused)
            .bind(input.manage_bookings)
            .bind(input.registered_by_pubkey.as_slice())
            .fetch_one(&mut *tx)
            .await?;
            sqlx::query(
                "UPDATE airhop_hermes_turn_receipts
                 SET status = 'cancelled', error_code = 'deployment_changed',
                     finished_at = now(), updated_at = now()
                 WHERE community_id = $1 AND organization_id = $2
                   AND deployment_id = $3 AND status = 'leased'",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(input.deployment_id)
            .execute(&mut *tx)
            .await?;
            updated
        } else {
            if input.expected_version != 0 {
                return Err(DbError::AirhopVersionConflict);
            }
            sqlx::query(
                "INSERT INTO airhop_agent_deployments (
                    community_id, organization_id, id, blueprint_key, blueprint_version,
                    role, agent_pubkey, profile_ref, runtime_revision, persona_revision,
                    skills_revision, model_revision, enabled, paused, manage_bookings,
                    registered_by_pubkey
                 ) VALUES ($1, $2, $3, $4, $5, 'parent_administrator', $6, $7, $8,
                    $9, $10, $11, $12, $13, $14, $15)
                 RETURNING community_id, organization_id, id, blueprint_key,
                    blueprint_version, role, agent_pubkey, profile_ref, runtime_revision,
                    persona_revision, skills_revision, model_revision, enabled, paused,
                    manage_bookings, version, registered_by_pubkey, created_at, updated_at",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(input.deployment_id)
            .bind(PARENT_ADMINISTRATOR_BLUEPRINT)
            .bind(input.blueprint_version)
            .bind(input.agent_pubkey.as_slice())
            .bind(input.profile_ref.trim())
            .bind(input.runtime_revision.trim())
            .bind(input.persona_revision.trim())
            .bind(input.skills_revision.trim())
            .bind(input.model_revision.trim())
            .bind(input.enabled)
            .bind(input.paused)
            .bind(input.manage_bookings)
            .bind(input.registered_by_pubkey.as_slice())
            .fetch_one(&mut *tx)
            .await?
        };
        let deployment = deployment_from_row(&row)?;
        tx.commit().await?;
        Ok(deployment)
    }

    /// Reads one deployment only inside the server-resolved organization.
    pub async fn get_airhop_parent_agent_deployment(
        &self,
        tenant: &TenantContext,
        deployment_id: Uuid,
    ) -> Result<Option<ParentAgentDeployment>> {
        let row = sqlx::query(
            "SELECT deployment.community_id, deployment.organization_id, deployment.id,
                    deployment.blueprint_key, deployment.blueprint_version, deployment.role,
                    deployment.agent_pubkey, deployment.profile_ref, deployment.runtime_revision,
                    deployment.persona_revision, deployment.skills_revision,
                    deployment.model_revision, deployment.enabled, deployment.paused,
                    deployment.manage_bookings, deployment.version,
                    deployment.registered_by_pubkey, deployment.created_at, deployment.updated_at
             FROM airhop_agent_deployments deployment
             JOIN airhop_organizations organization
               ON organization.community_id = deployment.community_id
              AND organization.id = deployment.organization_id
              AND organization.status = 'active'
             WHERE deployment.community_id = $1 AND deployment.id = $2",
        )
        .bind(tenant.community().as_uuid())
        .bind(deployment_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(deployment_from_row).transpose()
    }

    /// Reads the organization's sole parent-administrator deployment, allowing
    /// a settings client to discover its stable ID after login or reinstall.
    pub async fn get_current_airhop_parent_agent_deployment(
        &self,
        tenant: &TenantContext,
    ) -> Result<Option<ParentAgentDeployment>> {
        let row = sqlx::query(
            "SELECT deployment.community_id, deployment.organization_id, deployment.id,
                    deployment.blueprint_key, deployment.blueprint_version, deployment.role,
                    deployment.agent_pubkey, deployment.profile_ref, deployment.runtime_revision,
                    deployment.persona_revision, deployment.skills_revision,
                    deployment.model_revision, deployment.enabled, deployment.paused,
                    deployment.manage_bookings, deployment.version,
                    deployment.registered_by_pubkey, deployment.created_at, deployment.updated_at
             FROM airhop_agent_deployments deployment
             JOIN airhop_organizations organization
               ON organization.community_id = deployment.community_id
              AND organization.id = deployment.organization_id
              AND organization.status = 'active'
             WHERE deployment.community_id = $1
               AND deployment.role = 'parent_administrator'",
        )
        .bind(tenant.community().as_uuid())
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(deployment_from_row).transpose()
    }

    /// Acquires exactly one turn for `(cycle, input batch)`, returning the same
    /// receipt on retry and rotating an expired lease for that same batch.
    pub async fn lease_airhop_parent_agent_turn(
        &self,
        tenant: &TenantContext,
        input: &LeaseParentAgentTurnInput,
    ) -> Result<LeasedParentAgentTurn> {
        validate_turn_input(input)?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id = active_organization_id(&mut tx, community_id).await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!(
                "airhop_hermes_turn:{community_id}:{organization_id}:{}",
                input.conversation_id
            ))
            .execute(&mut *tx)
            .await?;
        let deployment_row = sqlx::query(
            "SELECT community_id, organization_id, id, blueprint_key, blueprint_version,
                    role, agent_pubkey, profile_ref, runtime_revision, persona_revision,
                    skills_revision, model_revision, enabled, paused, manage_bookings,
                    version, registered_by_pubkey, created_at, updated_at
             FROM airhop_agent_deployments
             WHERE community_id = $1 AND organization_id = $2 AND id = $3
             FOR SHARE",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.deployment_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHop Hermes deployment".to_owned()))?;
        let deployment = deployment_from_row(&deployment_row)?;
        if !deployment.enabled || deployment.paused {
            return Err(DbError::AccessDenied(
                "AirHop Hermes deployment is disabled or paused".to_owned(),
            ));
        }
        validate_turn_scope(&mut tx, community_id, organization_id, &deployment, input).await?;

        if let Some(row) = sqlx::query(
            "SELECT * FROM airhop_hermes_turn_receipts
             WHERE community_id = $1 AND organization_id = $2
               AND cycle_id = $3 AND input_batch_id = $4
             FOR UPDATE",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.cycle_id)
        .bind(input.input_batch_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            let mut receipt = turn_from_row(&row, true)?;
            require_same_turn_scope(&receipt, input)?;
            if receipt.status != HermesTurnStatus::Leased {
                return Err(DbError::AirhopVersionConflict);
            }
            if receipt.lease_expires_at <= Utc::now() {
                let rotated = sqlx::query(
                    "UPDATE airhop_hermes_turn_receipts
                     SET lease_token = gen_random_uuid(),
                         lease_expires_at = now() + ($5::BIGINT * interval '1 second'),
                         attempt = attempt + 1, updated_at = now()
                     WHERE community_id = $1 AND organization_id = $2
                       AND cycle_id = $3 AND input_batch_id = $4
                     RETURNING *",
                )
                .bind(community_id)
                .bind(organization_id)
                .bind(input.cycle_id)
                .bind(input.input_batch_id)
                .bind(input.lease_seconds)
                .fetch_one(&mut *tx)
                .await?;
                receipt = turn_from_row(&rotated, true)?;
            }
            tx.commit().await?;
            return Ok(LeasedParentAgentTurn {
                deployment,
                turn: receipt,
            });
        }

        sqlx::query(
            "UPDATE airhop_hermes_turn_receipts
             SET status = 'failed', error_code = 'lease_expired', finished_at = now(),
                 updated_at = now()
             WHERE community_id = $1 AND organization_id = $2
               AND conversation_id = $3 AND status = 'leased' AND lease_expires_at <= now()",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.conversation_id)
        .execute(&mut *tx)
        .await?;
        let active_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM airhop_hermes_turn_receipts
             WHERE community_id = $1 AND organization_id = $2
               AND conversation_id = $3 AND status = 'leased')",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.conversation_id)
        .fetch_one(&mut *tx)
        .await?;
        if active_exists {
            return Err(DbError::AirhopCommandInProgress);
        }

        let configuration_snapshot = deployment_snapshot(&deployment);
        let row = sqlx::query(
            "INSERT INTO airhop_hermes_turn_receipts (
                community_id, organization_id, deployment_id, agent_pubkey, channel_id,
                conversation_id, cycle_id, input_batch_id, source_message_id,
                family_id, representative_id, lease_token, lease_expires_at,
                configuration_snapshot
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                gen_random_uuid(), now() + ($12::BIGINT * interval '1 second'), $13)
             RETURNING *",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.deployment_id)
        .bind(deployment.agent_pubkey.as_slice())
        .bind(input.channel_id)
        .bind(input.conversation_id)
        .bind(input.cycle_id)
        .bind(input.input_batch_id)
        .bind(input.source_message_id.as_slice())
        .bind(input.family_id)
        .bind(input.representative_id)
        .bind(input.lease_seconds)
        .bind(configuration_snapshot)
        .fetch_one(&mut *tx)
        .await?;
        let turn = turn_from_row(&row, false)?;
        tx.commit().await?;
        Ok(LeasedParentAgentTurn { deployment, turn })
    }

    /// Revalidates a context grant against live desired state and the exact
    /// unexpired database lease. The signed token alone is never sufficient.
    pub async fn validate_airhop_parent_agent_turn_lease(
        &self,
        tenant: &TenantContext,
        input: &ValidateParentAgentTurnLeaseInput,
    ) -> Result<HermesTurnReceipt> {
        let row = sqlx::query(
            "SELECT turn.*
             FROM airhop_hermes_turn_receipts turn
             JOIN airhop_agent_deployments deployment
               ON deployment.community_id = turn.community_id
              AND deployment.organization_id = turn.organization_id
              AND deployment.id = turn.deployment_id
              AND deployment.agent_pubkey = turn.agent_pubkey
             JOIN airhop_organizations organization
               ON organization.community_id = turn.community_id
              AND organization.id = turn.organization_id
             WHERE turn.community_id = $1 AND turn.organization_id = $2
               AND turn.deployment_id = $3 AND deployment.version = $4
               AND turn.id = $5 AND turn.lease_token = $6
               AND turn.agent_pubkey = $7 AND turn.status = 'leased'
               AND turn.lease_expires_at > now()
               AND deployment.enabled AND NOT deployment.paused
               AND organization.status = 'active'",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.organization_id)
        .bind(input.deployment_id)
        .bind(input.deployment_version)
        .bind(input.turn_id)
        .bind(input.lease_token)
        .bind(input.agent_pubkey.as_slice())
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| {
            DbError::AccessDenied("AirHop Hermes turn lease is not active".to_owned())
        })?;
        turn_from_row(&row, true)
    }

    /// Appends one bounded, data-minimized authoritative read dependency to the
    /// active turn. Result payloads and parent PII are deliberately excluded.
    pub async fn record_airhop_parent_agent_turn_read(
        &self,
        tenant: &TenantContext,
        turn_id: Uuid,
        lease_token: Uuid,
        agent_pubkey: [u8; 32],
        operation: &str,
        source_revision: Option<&str>,
    ) -> Result<()> {
        if operation.is_empty()
            || operation.len() > 80
            || source_revision.is_some_and(|value| value.len() > 240)
        {
            return Err(DbError::InvalidData(
                "AirHop Hermes read dependency is invalid".to_owned(),
            ));
        }
        let updated = sqlx::query(
            "UPDATE airhop_hermes_turn_receipts
             SET decision_read_set = CASE
                    WHEN jsonb_array_length(decision_read_set) < 128 THEN
                        decision_read_set || jsonb_build_array(
                            jsonb_build_object(
                                'operation', $5::TEXT,
                                'sourceRevision', $6::TEXT,
                                'observedAt', now()
                            )
                        )
                    ELSE decision_read_set
                 END,
                 updated_at = now()
             WHERE community_id = $1 AND id = $2 AND lease_token = $3
               AND agent_pubkey = $4 AND status = 'leased'
               AND lease_expires_at > now()",
        )
        .bind(tenant.community().as_uuid())
        .bind(turn_id)
        .bind(lease_token)
        .bind(agent_pubkey.as_slice())
        .bind(operation)
        .bind(source_revision)
        .execute(&self.pool)
        .await?;
        if updated.rows_affected() == 1 {
            Ok(())
        } else {
            Err(DbError::AccessDenied(
                "AirHop Hermes read set cannot be updated for this lease".to_owned(),
            ))
        }
    }

    /// Completes the exact active lease once. Repeated acknowledgement of the
    /// same terminal state is idempotent; a different outcome is rejected.
    pub async fn finish_airhop_parent_agent_turn(
        &self,
        tenant: &TenantContext,
        turn_id: Uuid,
        lease_token: Uuid,
        agent_pubkey: [u8; 32],
        completion: &FinishHermesTurn,
    ) -> Result<HermesTurnReceipt> {
        validate_completion(completion)?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT * FROM airhop_hermes_turn_receipts
             WHERE community_id = $1 AND id = $2 FOR UPDATE",
        )
        .bind(community_id)
        .bind(turn_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHop Hermes turn".to_owned()))?;
        let current = turn_from_row(&row, true)?;
        if current.agent_pubkey != agent_pubkey || current.lease_token != lease_token {
            return Err(DbError::AccessDenied(
                "AirHop Hermes turn lease belongs to another runtime".to_owned(),
            ));
        }
        let (status, outcome, error_code) = completion_columns(completion);
        if current.status != HermesTurnStatus::Leased {
            let same_status = current.status.as_str() == status;
            let stored_outcome: Option<String> = row.try_get("outcome")?;
            let stored_error: Option<String> = row.try_get("error_code")?;
            if same_status
                && stored_outcome.as_deref() == outcome
                && stored_error.as_deref() == error_code
            {
                tx.commit().await?;
                return Ok(current);
            }
            return Err(DbError::AirhopVersionConflict);
        }
        if current.lease_expires_at <= Utc::now() {
            return Err(DbError::AccessDenied(
                "AirHop Hermes turn lease expired before completion".to_owned(),
            ));
        }
        let updated = sqlx::query(
            "UPDATE airhop_hermes_turn_receipts
             SET status = $4, outcome = $5, error_code = $6,
                 finished_at = now(), updated_at = now()
             WHERE community_id = $1 AND id = $2 AND lease_token = $3
             RETURNING *",
        )
        .bind(community_id)
        .bind(turn_id)
        .bind(lease_token)
        .bind(status)
        .bind(outcome)
        .bind(error_code)
        .fetch_one(&mut *tx)
        .await?;
        let receipt = turn_from_row(&updated, false)?;
        tx.commit().await?;
        Ok(receipt)
    }
}

async fn active_organization_id(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
) -> Result<Uuid> {
    sqlx::query_scalar(
        "SELECT id FROM airhop_organizations
         WHERE community_id = $1 AND status = 'active'",
    )
    .bind(community_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| DbError::NotFound("active AirHop organization".to_owned()))
}

async fn require_owner_or_admin(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    pubkey: [u8; 32],
) -> Result<()> {
    let authorized: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM relay_members
         WHERE community_id = $1 AND pubkey = $2 AND role IN ('owner', 'admin'))",
    )
    .bind(community_id)
    .bind(hex::encode(pubkey))
    .fetch_one(&mut **tx)
    .await?;
    if authorized {
        Ok(())
    } else {
        Err(DbError::AccessDenied(
            "only an owner or admin may configure AirHop Hermes".to_owned(),
        ))
    }
}

async fn validate_turn_scope(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    organization_id: Uuid,
    deployment: &ParentAgentDeployment,
    input: &LeaseParentAgentTurnInput,
) -> Result<()> {
    let channel_valid: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM channels channel
         JOIN channel_members member
           ON member.community_id = channel.community_id
          AND member.channel_id = channel.id
         WHERE channel.community_id = $1 AND channel.id = $2
           AND channel.channel_type = 'stream' AND channel.visibility = 'private'
           AND channel.archived_at IS NULL AND channel.deleted_at IS NULL
           AND member.pubkey = $3 AND member.role = 'bot' AND member.removed_at IS NULL)",
    )
    .bind(community_id)
    .bind(input.channel_id)
    .bind(deployment.agent_pubkey.as_slice())
    .fetch_one(&mut **tx)
    .await?;
    if !channel_valid {
        return Err(DbError::AccessDenied(
            "AirHop Hermes must be an active bot in the private parent channel".to_owned(),
        ));
    }
    let source_route = sqlx::query(
        "SELECT conversation.control_version
         FROM airhop_external_conversations conversation
         JOIN airhop_external_inbound_receipts receipt
           ON receipt.community_id = conversation.community_id
          AND receipt.organization_id = conversation.organization_id
          AND receipt.conversation_id = conversation.id
         JOIN events source
           ON source.community_id = conversation.community_id
          AND source.id = receipt.event_id
         WHERE conversation.community_id = $1
           AND conversation.organization_id = $2
           AND conversation.id = $3 AND conversation.channel_id = $4
           AND conversation.current_cycle_id = $5
           AND conversation.family_id IS NOT DISTINCT FROM $6
           AND conversation.representative_id IS NOT DISTINCT FROM $7
           AND conversation.status = 'active' AND conversation.owner = 'hermes'
           AND NOT conversation.hermes_paused
           AND NOT EXISTS (
             SELECT 1 FROM airhop_external_conversation_routes route
             JOIN airhop_channel_connections connection
               ON connection.community_id = route.community_id
              AND connection.organization_id = route.organization_id
              AND connection.id = route.connection_id
             WHERE route.community_id = conversation.community_id
               AND route.organization_id = conversation.organization_id
               AND route.conversation_id = conversation.id
               AND (route.status <> 'active' OR connection.status <> 'active'
                    OR NOT connection.hermes_enabled)
           )
           AND receipt.event_id = $8 AND receipt.decision = 'trigger'
           AND receipt.cycle_id = conversation.current_cycle_id
           AND receipt.control_version = conversation.control_version
           AND source.channel_id = conversation.channel_id
           AND source.kind = $9 AND source.deleted_at IS NULL
           AND (source.pubkey = conversation.parent_pubkey OR (
             receipt.reason = 'staff_resume' AND EXISTS (
               SELECT 1 FROM channel_members staff
               JOIN relay_members roster
                 ON roster.community_id = staff.community_id
                AND roster.pubkey = encode(staff.pubkey, 'hex')
               WHERE staff.community_id = conversation.community_id
                 AND staff.channel_id = conversation.channel_id
                 AND staff.pubkey = source.pubkey
                 AND staff.role <> 'bot' AND staff.removed_at IS NULL
             )
           ))
         FOR SHARE OF conversation",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(input.conversation_id)
    .bind(input.channel_id)
    .bind(input.cycle_id)
    .bind(input.family_id)
    .bind(input.representative_id)
    .bind(input.source_message_id.as_slice())
    .bind(i32::from(buzz_core::kind::KIND_STREAM_MESSAGE as u16))
    .fetch_optional(&mut **tx)
    .await?;
    if source_route.is_none() {
        return Err(DbError::AccessDenied(
            "AirHop Hermes source is not a current triggerable parent event".to_owned(),
        ));
    }
    match (input.family_id, input.representative_id) {
        (None, None) => Ok(()),
        (Some(family_id), Some(representative_id)) => {
            let binding_valid: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM airhop_representatives representative
                 JOIN airhop_families family
                   ON family.community_id = representative.community_id
                  AND family.organization_id = representative.organization_id
                  AND family.id = representative.family_id
                 WHERE representative.community_id = $1
                   AND representative.organization_id = $2
                   AND representative.family_id = $3 AND representative.id = $4
                   AND representative.status = 'active' AND family.status = 'active')",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(family_id)
            .bind(representative_id)
            .fetch_one(&mut **tx)
            .await?;
            if binding_valid {
                Ok(())
            } else {
                Err(DbError::AccessDenied(
                    "AirHop Hermes Family binding is not active".to_owned(),
                ))
            }
        }
        _ => Err(DbError::InvalidData(
            "AirHop Hermes Family and representative must be bound together".to_owned(),
        )),
    }
}

fn validate_deployment_input(input: &PutParentAgentDeploymentInput) -> Result<()> {
    let revisions = [
        input.profile_ref.as_str(),
        input.runtime_revision.as_str(),
        input.persona_revision.as_str(),
        input.skills_revision.as_str(),
        input.model_revision.as_str(),
    ];
    if input.deployment_id.is_nil()
        || input.blueprint_version <= 0
        || input.expected_version < 0
        || revisions
            .iter()
            .any(|value| value.trim().is_empty() || value.trim().len() > 240)
    {
        return Err(DbError::InvalidData(
            "AirHop Hermes deployment fields are invalid".to_owned(),
        ));
    }
    Ok(())
}

fn deployment_matches_input(
    deployment: &ParentAgentDeployment,
    input: &PutParentAgentDeploymentInput,
) -> bool {
    deployment.agent_pubkey == input.agent_pubkey
        && deployment.blueprint_version == input.blueprint_version
        && deployment.profile_ref == input.profile_ref.trim()
        && deployment.runtime_revision == input.runtime_revision.trim()
        && deployment.persona_revision == input.persona_revision.trim()
        && deployment.skills_revision == input.skills_revision.trim()
        && deployment.model_revision == input.model_revision.trim()
        && deployment.enabled == input.enabled
        && deployment.paused == input.paused
        && deployment.manage_bookings == input.manage_bookings
}

fn validate_turn_input(input: &LeaseParentAgentTurnInput) -> Result<()> {
    if input.deployment_id.is_nil()
        || input.channel_id.is_nil()
        || input.conversation_id.is_nil()
        || input.cycle_id.is_nil()
        || input.input_batch_id.is_nil()
        || input.family_id.is_some_and(|value| value.is_nil())
        || input.representative_id.is_some_and(|value| value.is_nil())
        || matches!(
            (input.family_id, input.representative_id),
            (Some(_), None) | (None, Some(_))
        )
        || !(60..=15 * 60).contains(&input.lease_seconds)
    {
        return Err(DbError::InvalidData(
            "AirHop Hermes turn fields are invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_completion(completion: &FinishHermesTurn) -> Result<()> {
    let value = match completion {
        FinishHermesTurn::Completed { outcome } => outcome,
        FinishHermesTurn::Failed { error_code } | FinishHermesTurn::Cancelled { error_code } => {
            error_code
        }
    };
    if value.trim().is_empty() || value.trim().len() > 120 {
        return Err(DbError::InvalidData(
            "AirHop Hermes completion code must contain 1-120 bytes".to_owned(),
        ));
    }
    Ok(())
}

fn completion_columns(completion: &FinishHermesTurn) -> (&'static str, Option<&str>, Option<&str>) {
    match completion {
        FinishHermesTurn::Completed { outcome } => ("completed", Some(outcome.trim()), None),
        FinishHermesTurn::Failed { error_code } => ("failed", None, Some(error_code.trim())),
        FinishHermesTurn::Cancelled { error_code } => ("cancelled", None, Some(error_code.trim())),
    }
}

fn require_same_turn_scope(
    receipt: &HermesTurnReceipt,
    input: &LeaseParentAgentTurnInput,
) -> Result<()> {
    if receipt.deployment_id == input.deployment_id
        && receipt.channel_id == input.channel_id
        && receipt.conversation_id == input.conversation_id
        && receipt.cycle_id == input.cycle_id
        && receipt.input_batch_id == input.input_batch_id
        && receipt.source_message_id == input.source_message_id
        && receipt.family_id == input.family_id
        && receipt.representative_id == input.representative_id
    {
        Ok(())
    } else {
        Err(DbError::AirhopIdempotencyConflict)
    }
}

fn deployment_snapshot(deployment: &ParentAgentDeployment) -> serde_json::Value {
    json!({
        "schemaVersion": "airhop.hermes.turn-configuration.v1",
        "deploymentId": deployment.id,
        "deploymentVersion": deployment.version,
        "blueprintKey": deployment.blueprint_key,
        "blueprintVersion": deployment.blueprint_version,
        "profileRef": deployment.profile_ref,
        "runtimeRevision": deployment.runtime_revision,
        "personaRevision": deployment.persona_revision,
        "skillsRevision": deployment.skills_revision,
        "modelRevision": deployment.model_revision,
        "manageBookings": deployment.manage_bookings,
    })
}

fn deployment_from_row(row: &sqlx::postgres::PgRow) -> Result<ParentAgentDeployment> {
    Ok(ParentAgentDeployment {
        community_id: row.try_get("community_id")?,
        organization_id: row.try_get("organization_id")?,
        id: row.try_get("id")?,
        blueprint_key: row.try_get("blueprint_key")?,
        blueprint_version: row.try_get("blueprint_version")?,
        role: row.try_get("role")?,
        agent_pubkey: vec_to_pubkey(row.try_get("agent_pubkey")?, "deployment agent")?,
        profile_ref: row.try_get("profile_ref")?,
        runtime_revision: row.try_get("runtime_revision")?,
        persona_revision: row.try_get("persona_revision")?,
        skills_revision: row.try_get("skills_revision")?,
        model_revision: row.try_get("model_revision")?,
        enabled: row.try_get("enabled")?,
        paused: row.try_get("paused")?,
        manage_bookings: row.try_get("manage_bookings")?,
        version: row.try_get("version")?,
        registered_by_pubkey: vec_to_pubkey(
            row.try_get("registered_by_pubkey")?,
            "deployment registrant",
        )?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn turn_from_row(row: &sqlx::postgres::PgRow, replayed: bool) -> Result<HermesTurnReceipt> {
    Ok(HermesTurnReceipt {
        id: row.try_get("id")?,
        deployment_id: row.try_get("deployment_id")?,
        agent_pubkey: vec_to_pubkey(row.try_get("agent_pubkey")?, "turn agent")?,
        channel_id: row.try_get("channel_id")?,
        conversation_id: row.try_get("conversation_id")?,
        cycle_id: row.try_get("cycle_id")?,
        input_batch_id: row.try_get("input_batch_id")?,
        source_message_id: vec_to_pubkey(row.try_get("source_message_id")?, "source message")?,
        family_id: row.try_get("family_id")?,
        representative_id: row.try_get("representative_id")?,
        status: HermesTurnStatus::parse(row.try_get("status")?)?,
        lease_token: row.try_get("lease_token")?,
        lease_expires_at: row.try_get("lease_expires_at")?,
        attempt: row.try_get("attempt")?,
        configuration_snapshot: row.try_get("configuration_snapshot")?,
        replayed,
    })
}

fn vec_to_pubkey(value: Vec<u8>, name: &str) -> Result<[u8; 32]> {
    value.try_into().map_err(|value: Vec<u8>| {
        DbError::InvalidData(format!(
            "AirHop Hermes {name} must contain 32 bytes, got {}",
            value.len()
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deployment_input() -> PutParentAgentDeploymentInput {
        PutParentAgentDeploymentInput {
            deployment_id: Uuid::new_v4(),
            agent_pubkey: [7; 32],
            blueprint_version: 1,
            profile_ref: "org/profile/hermes".to_owned(),
            runtime_revision: "hermes-agent@0.20.4".to_owned(),
            persona_revision: "hermes-parent@1".to_owned(),
            skills_revision: "airhop-parent@1".to_owned(),
            model_revision: "deepseek-chat:flash".to_owned(),
            enabled: true,
            paused: false,
            manage_bookings: true,
            expected_version: 0,
            registered_by_pubkey: [9; 32],
        }
    }

    #[test]
    fn deployment_requires_pinned_non_empty_revisions() {
        let mut input = deployment_input();
        assert!(validate_deployment_input(&input).is_ok());
        input.runtime_revision = "  ".to_owned();
        assert!(validate_deployment_input(&input).is_err());
    }

    #[test]
    fn identical_deployment_save_is_not_a_material_change() {
        let input = deployment_input();
        let now = Utc::now();
        let deployment = ParentAgentDeployment {
            community_id: Uuid::new_v4(),
            organization_id: Uuid::new_v4(),
            id: input.deployment_id,
            blueprint_key: PARENT_ADMINISTRATOR_BLUEPRINT.to_owned(),
            blueprint_version: input.blueprint_version,
            role: "parent_administrator".to_owned(),
            agent_pubkey: input.agent_pubkey,
            profile_ref: input.profile_ref.clone(),
            runtime_revision: input.runtime_revision.clone(),
            persona_revision: input.persona_revision.clone(),
            skills_revision: input.skills_revision.clone(),
            model_revision: input.model_revision.clone(),
            enabled: input.enabled,
            paused: input.paused,
            manage_bookings: input.manage_bookings,
            version: 1,
            registered_by_pubkey: input.registered_by_pubkey,
            created_at: now,
            updated_at: now,
        };
        assert!(deployment_matches_input(&deployment, &input));
        let mut changed = input;
        changed.manage_bookings = false;
        assert!(!deployment_matches_input(&deployment, &changed));
    }

    #[test]
    fn turn_lease_requires_paired_identity_and_bounded_duration() {
        let input = LeaseParentAgentTurnInput {
            deployment_id: Uuid::new_v4(),
            channel_id: Uuid::new_v4(),
            conversation_id: Uuid::new_v4(),
            cycle_id: Uuid::new_v4(),
            input_batch_id: Uuid::new_v4(),
            source_message_id: [4; 32],
            family_id: None,
            representative_id: None,
            lease_seconds: 300,
        };
        assert!(validate_turn_input(&input).is_ok());
        let mut partial = input.clone();
        partial.family_id = Some(Uuid::new_v4());
        assert!(validate_turn_input(&partial).is_err());
        let mut too_long = input;
        too_long.lease_seconds = 901;
        assert!(validate_turn_input(&too_long).is_err());
    }

    #[test]
    fn completion_codes_are_bounded_and_typed() {
        assert!(validate_completion(&FinishHermesTurn::Completed {
            outcome: "waiting_parent".to_owned(),
        })
        .is_ok());
        assert!(validate_completion(&FinishHermesTurn::Failed {
            error_code: String::new(),
        })
        .is_err());
    }
}
