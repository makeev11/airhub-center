//! Atomic AirHub Center installation activation.
//!
//! Cleartext activation codes are generated and returned by the HTTP boundary.
//! Persistence accepts only a tenant-keyed digest. Every transition locks the
//! grant/installation rows and appends secret-free activation audit metadata.

use buzz_core::TenantContext;
use chrono::{DateTime, Duration, Utc};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

/// Minimum lifetime accepted for a Center activation grant.
pub const MIN_ACTIVATION_GRANT_TTL_SECONDS: i64 = 60;
/// Maximum lifetime accepted for a Center activation grant.
pub const MAX_ACTIVATION_GRANT_TTL_SECONDS: i64 = 3_600;

/// Deployment environment sealed into one installation activation ceremony.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CenterEnvironment {
    /// Customer-facing production deployment.
    Production,
    /// Pre-production deployment.
    Staging,
    /// Local or isolated development deployment.
    Development,
}

impl CenterEnvironment {
    /// Parse the closed HTTP vocabulary.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "production" => Some(Self::Production),
            "staging" => Some(Self::Staging),
            "development" => Some(Self::Development),
            _ => None,
        }
    }

    /// Return the stable database/API representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Production => "production",
            Self::Staging => "staging",
            Self::Development => "development",
        }
    }
}

/// Safe lifecycle projection for one Center installation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CenterInstallationStatus {
    /// Release is installed but identity has not been activated.
    Provisioning,
    /// Installation identity is activated and the latest known check passed.
    Ready,
    /// Installation is reachable with reduced capability.
    Degraded,
    /// Provisioning or a health check failed.
    Failed,
    /// Installation was explicitly disabled.
    Disabled,
}

impl CenterInstallationStatus {
    fn from_db(value: &str) -> Result<Self> {
        match value {
            "provisioning" => Ok(Self::Provisioning),
            "ready" => Ok(Self::Ready),
            "degraded" => Ok(Self::Degraded),
            "failed" => Ok(Self::Failed),
            "disabled" => Ok(Self::Disabled),
            other => Err(DbError::InvalidData(format!(
                "unknown AirHub Center installation status {other:?}"
            ))),
        }
    }

    /// Return the stable database/API representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Provisioning => "provisioning",
            Self::Ready => "ready",
            Self::Degraded => "degraded",
            Self::Failed => "failed",
            Self::Disabled => "disabled",
        }
    }
}

/// Operator request persisted when issuing an activation grant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueCenterActivationGrantInput {
    /// Stable installation id allocated by the deploy workflow.
    pub installation_id: Uuid,
    /// Deployment environment.
    pub environment: CenterEnvironment,
    /// Deployment profile, for example `site_telegram_center`.
    pub release_profile: String,
    /// Exact release version allowed to claim the grant.
    pub release_version: String,
    /// Grant lifetime in seconds.
    pub ttl_seconds: i64,
    /// Tenant-keyed digest of the cleartext activation code.
    pub code_digest: [u8; 32],
    /// Tenant/operator-scoped digest of `Idempotency-Key`.
    pub issue_idempotency_digest: [u8; 32],
    /// SHA-256 hash of the signed request body.
    pub issue_request_hash: [u8; 32],
    /// Authenticated deployment operator.
    pub issued_by_pubkey: [u8; 32],
}

/// Secret-free result of activation grant issuance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueCenterActivationGrantOutcome {
    /// Server-allocated grant identifier.
    pub grant_id: Uuid,
    /// Bound organization identifier.
    pub organization_id: Uuid,
    /// Bound installation identifier.
    pub installation_id: Uuid,
    /// Grant expiration instant.
    pub expires_at: DateTime<Utc>,
    /// True only when this transaction inserted the grant.
    pub inserted: bool,
}

/// Secret-free metadata for an issued activation grant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CenterActivationGrantMetadata {
    /// Grant identifier.
    pub id: Uuid,
    /// Expiration instant.
    pub expires_at: DateTime<Utc>,
    /// Claim instant, if consumed.
    pub claimed_at: Option<DateTime<Utc>>,
    /// Revocation instant, if revoked before claim.
    pub revoked_at: Option<DateTime<Utc>>,
    /// Creation instant.
    pub created_at: DateTime<Utc>,
}

/// Safe Center installation metadata with no operational customer data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CenterInstallationMetadata {
    /// Installation identifier.
    pub id: Uuid,
    /// Bound organization identifier.
    pub organization_id: Uuid,
    /// Deployment environment.
    pub environment: String,
    /// Deployment profile.
    pub release_profile: String,
    /// Exact installed/allowed release version.
    pub release_version: String,
    /// Bound public key after activation.
    pub installation_pubkey: Option<[u8; 32]>,
    /// Safe lifecycle state.
    pub status: CenterInstallationStatus,
    /// Monotonic activation generation.
    pub activation_version: i64,
    /// Activation instant.
    pub activated_at: Option<DateTime<Utc>>,
    /// Last cryptographically verified health instant, when implemented.
    pub last_verified_at: Option<DateTime<Utc>>,
    /// Sanitized machine-readable failure code.
    pub sanitized_error_code: Option<String>,
    /// Grant history without code material or digests.
    pub grants: Vec<CenterActivationGrantMetadata>,
}

/// Authenticated operator request to revoke one unclaimed grant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevokeCenterActivationGrantInput {
    /// Grant identifier returned during issue.
    pub grant_id: Uuid,
    /// Authenticated deployment operator.
    pub revoked_by_pubkey: [u8; 32],
}

/// Result of idempotent grant revocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevokeCenterActivationGrantOutcome {
    /// Grant identifier.
    pub grant_id: Uuid,
    /// Bound installation identifier.
    pub installation_id: Uuid,
    /// Revocation instant.
    pub revoked_at: DateTime<Utc>,
    /// True when the grant was already revoked by an earlier request.
    pub replayed: bool,
}

/// Public bootstrap request after the HTTP boundary validates the code shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimCenterActivationGrantInput {
    /// Expected installation identifier.
    pub installation_id: Uuid,
    /// Tenant-keyed activation-code digest.
    pub code_digest: [u8; 32],
    /// Installation-owned Nostr public key.
    pub installation_pubkey: [u8; 32],
    /// Environment reported by the claiming installation.
    pub environment: CenterEnvironment,
    /// Release profile reported by the claiming installation.
    pub release_profile: String,
    /// Exact running release version.
    pub release_version: String,
    /// Tenant/installation-scoped digest of `Idempotency-Key`.
    pub claim_idempotency_digest: [u8; 32],
    /// SHA-256 hash of the canonical request body.
    pub claim_request_hash: [u8; 32],
}

/// Result of an atomic activation claim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimCenterActivationGrantOutcome {
    /// Installation identifier.
    pub installation_id: Uuid,
    /// Bound organization identifier.
    pub organization_id: Uuid,
    /// Monotonic activation generation.
    pub activation_version: i64,
    /// Safe lifecycle state.
    pub status: CenterInstallationStatus,
    /// True when the same idempotent claim had already committed.
    pub replayed: bool,
}

impl Db {
    /// Issue a short-lived activation grant for one exact installation binding.
    pub async fn issue_airhop_center_activation_grant(
        &self,
        tenant: &TenantContext,
        input: &IssueCenterActivationGrantInput,
    ) -> Result<IssueCenterActivationGrantOutcome> {
        validate_issue_input(input)?;
        let mut transaction = self.pool.begin().await?;

        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 9917))")
            .bind(format!("{}:{}", tenant.community(), input.installation_id))
            .execute(&mut *transaction)
            .await?;

        if let Some(existing) = load_grant_by_issue_idempotency(
            &mut transaction,
            tenant,
            &input.issue_idempotency_digest,
        )
        .await?
        {
            if existing.issue_request_hash.as_slice() != input.issue_request_hash.as_slice() {
                return Err(DbError::AirhopIdempotencyConflict);
            }
            transaction.commit().await?;
            return Ok(IssueCenterActivationGrantOutcome {
                grant_id: existing.id,
                organization_id: existing.organization_id,
                installation_id: existing.installation_id,
                expires_at: existing.expires_at,
                inserted: false,
            });
        }

        let organization_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM airhop_organizations \
             WHERE community_id = $1 AND status = 'active' \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))?;

        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let expires_at = occurred_at + Duration::seconds(input.ttl_seconds);

        sqlx::query(
            "INSERT INTO airhop_center_installations (\
                 community_id, organization_id, id, environment, release_profile, release_version\
             ) VALUES ($1, $2, $3, $4, $5, $6) \
             ON CONFLICT (community_id, id) DO NOTHING",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.installation_id)
        .bind(input.environment.as_str())
        .bind(input.release_profile.trim())
        .bind(input.release_version.trim())
        .execute(&mut *transaction)
        .await?;

        let installation = sqlx::query(
            "SELECT organization_id, environment, release_profile, release_version, \
                    installation_pubkey, status \
             FROM airhop_center_installations \
             WHERE community_id = $1 AND id = $2 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.installation_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(DbError::AirhopActivationConflict)?;

        let persisted_organization_id: Uuid = installation.try_get("organization_id")?;
        let persisted_environment: String = installation.try_get("environment")?;
        let persisted_profile: String = installation.try_get("release_profile")?;
        let persisted_version: String = installation.try_get("release_version")?;
        let installation_pubkey: Option<Vec<u8>> = installation.try_get("installation_pubkey")?;
        let installation_status: String = installation.try_get("status")?;
        if persisted_organization_id != organization_id
            || persisted_environment != input.environment.as_str()
            || persisted_profile != input.release_profile.trim()
            || persisted_version != input.release_version.trim()
            || installation_pubkey.is_some()
            || installation_status != "provisioning"
        {
            return Err(DbError::AirhopActivationConflict);
        }

        let has_live_grant: bool = sqlx::query_scalar(
            "SELECT EXISTS(\
                 SELECT 1 FROM airhop_center_activation_grants \
                 WHERE community_id = $1 AND organization_id = $2 AND installation_id = $3 \
                   AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at > $4\
             )",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.installation_id)
        .bind(occurred_at)
        .fetch_one(&mut *transaction)
        .await?;
        if has_live_grant {
            return Err(DbError::AirhopActivationConflict);
        }

        let grant_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_center_activation_grants (\
                 community_id, organization_id, id, installation_id, code_digest, \
                 issue_idempotency_digest, issue_request_hash, issued_by_pubkey, expires_at, created_at\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(grant_id)
        .bind(input.installation_id)
        .bind(input.code_digest.as_slice())
        .bind(input.issue_idempotency_digest.as_slice())
        .bind(input.issue_request_hash.as_slice())
        .bind(input.issued_by_pubkey.as_slice())
        .bind(expires_at)
        .bind(occurred_at)
        .execute(&mut *transaction)
        .await?;

        append_activation_audit(
            &mut transaction,
            tenant,
            &ActivationAuditInput {
                organization_id,
                installation_id: input.installation_id,
                grant_id: Some(grant_id),
                event_type: "airhop.center.activation-grant-issued.v1",
                actor_kind: "operator",
                actor_pubkey: &input.issued_by_pubkey,
                occurred_at,
                payload: json!({
                    "environment": input.environment.as_str(),
                    "releaseProfile": input.release_profile.trim(),
                    "releaseVersion": input.release_version.trim(),
                    "expiresAt": expires_at,
                }),
            },
        )
        .await?;

        transaction.commit().await?;
        Ok(IssueCenterActivationGrantOutcome {
            grant_id,
            organization_id,
            installation_id: input.installation_id,
            expires_at,
            inserted: true,
        })
    }

    /// Idempotently revoke an unclaimed activation grant.
    pub async fn revoke_airhop_center_activation_grant(
        &self,
        tenant: &TenantContext,
        input: &RevokeCenterActivationGrantInput,
    ) -> Result<RevokeCenterActivationGrantOutcome> {
        let mut transaction = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT organization_id, installation_id, claimed_at, revoked_at \
             FROM airhop_center_activation_grants \
             WHERE community_id = $1 AND id = $2 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.grant_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(DbError::AirhopActivationInvalid)?;
        let organization_id: Uuid = row.try_get("organization_id")?;
        let installation_id: Uuid = row.try_get("installation_id")?;
        let claimed_at: Option<DateTime<Utc>> = row.try_get("claimed_at")?;
        let revoked_at: Option<DateTime<Utc>> = row.try_get("revoked_at")?;
        if claimed_at.is_some() {
            return Err(DbError::AirhopActivationConflict);
        }
        if let Some(revoked_at) = revoked_at {
            transaction.commit().await?;
            return Ok(RevokeCenterActivationGrantOutcome {
                grant_id: input.grant_id,
                installation_id,
                revoked_at,
                replayed: true,
            });
        }

        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        sqlx::query(
            "UPDATE airhop_center_activation_grants \
             SET revoked_at = $3, revoked_by_pubkey = $4 \
             WHERE community_id = $1 AND id = $2",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.grant_id)
        .bind(occurred_at)
        .bind(input.revoked_by_pubkey.as_slice())
        .execute(&mut *transaction)
        .await?;
        append_activation_audit(
            &mut transaction,
            tenant,
            &ActivationAuditInput {
                organization_id,
                installation_id,
                grant_id: Some(input.grant_id),
                event_type: "airhop.center.activation-grant-revoked.v1",
                actor_kind: "operator",
                actor_pubkey: &input.revoked_by_pubkey,
                occurred_at,
                payload: json!({}),
            },
        )
        .await?;
        transaction.commit().await?;
        Ok(RevokeCenterActivationGrantOutcome {
            grant_id: input.grant_id,
            installation_id,
            revoked_at: occurred_at,
            replayed: false,
        })
    }

    /// Atomically consume a grant and bind its installation public key.
    pub async fn claim_airhop_center_activation_grant(
        &self,
        tenant: &TenantContext,
        input: &ClaimCenterActivationGrantInput,
    ) -> Result<ClaimCenterActivationGrantOutcome> {
        validate_claim_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let occurred_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let grant = sqlx::query(
            "SELECT id, organization_id, expires_at, claimed_at, claimed_by_pubkey, \
                    claim_idempotency_digest, claim_request_hash, revoked_at \
             FROM airhop_center_activation_grants \
             WHERE community_id = $1 AND installation_id = $2 AND code_digest = $3 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.installation_id)
        .bind(input.code_digest.as_slice())
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(DbError::AirhopActivationInvalid)?;

        let grant_id: Uuid = grant.try_get("id")?;
        let organization_id: Uuid = grant.try_get("organization_id")?;
        let expires_at: DateTime<Utc> = grant.try_get("expires_at")?;
        let claimed_at: Option<DateTime<Utc>> = grant.try_get("claimed_at")?;
        let claimed_by_pubkey: Option<Vec<u8>> = grant.try_get("claimed_by_pubkey")?;
        let claim_idempotency_digest: Option<Vec<u8>> =
            grant.try_get("claim_idempotency_digest")?;
        let claim_request_hash: Option<Vec<u8>> = grant.try_get("claim_request_hash")?;
        let revoked_at: Option<DateTime<Utc>> = grant.try_get("revoked_at")?;

        if claimed_at.is_some() {
            let same_request = claimed_by_pubkey.as_deref()
                == Some(input.installation_pubkey.as_slice())
                && claim_idempotency_digest.as_deref()
                    == Some(input.claim_idempotency_digest.as_slice())
                && claim_request_hash.as_deref() == Some(input.claim_request_hash.as_slice());
            if !same_request {
                return Err(DbError::AirhopActivationInvalid);
            }
            let installation =
                load_installation_metadata_row(&mut transaction, tenant, input.installation_id)
                    .await?
                    .ok_or(DbError::AirhopActivationInvalid)?;
            transaction.commit().await?;
            return Ok(ClaimCenterActivationGrantOutcome {
                installation_id: input.installation_id,
                organization_id,
                activation_version: installation.activation_version,
                status: installation.status,
                replayed: true,
            });
        }
        if revoked_at.is_some() || expires_at <= occurred_at {
            return Err(DbError::AirhopActivationInvalid);
        }

        let installation =
            load_installation_metadata_row(&mut transaction, tenant, input.installation_id)
                .await?
                .ok_or(DbError::AirhopActivationInvalid)?;
        if installation.organization_id != organization_id
            || installation.environment != input.environment.as_str()
            || installation.release_profile != input.release_profile.trim()
            || installation.release_version != input.release_version.trim()
            || installation.installation_pubkey.is_some()
            || installation.status != CenterInstallationStatus::Provisioning
        {
            return Err(DbError::AirhopActivationConflict);
        }

        sqlx::query(
            "UPDATE airhop_center_activation_grants \
             SET claimed_at = $4, claimed_by_pubkey = $5, \
                 claim_idempotency_digest = $6, claim_request_hash = $7 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(grant_id)
        .bind(occurred_at)
        .bind(input.installation_pubkey.as_slice())
        .bind(input.claim_idempotency_digest.as_slice())
        .bind(input.claim_request_hash.as_slice())
        .execute(&mut *transaction)
        .await?;

        let activation_version: i64 = sqlx::query_scalar(
            "UPDATE airhop_center_installations \
             SET installation_pubkey = $4, status = 'ready', \
                 activation_version = activation_version + 1, activated_at = $5, updated_at = $5 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
             RETURNING activation_version",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.installation_id)
        .bind(input.installation_pubkey.as_slice())
        .bind(occurred_at)
        .fetch_one(&mut *transaction)
        .await?;

        append_activation_audit(
            &mut transaction,
            tenant,
            &ActivationAuditInput {
                organization_id,
                installation_id: input.installation_id,
                grant_id: Some(grant_id),
                event_type: "airhop.center.installation-activated.v1",
                actor_kind: "installation",
                actor_pubkey: &input.installation_pubkey,
                occurred_at,
                payload: json!({
                    "activationVersion": activation_version,
                    "releaseVersion": input.release_version.trim(),
                }),
            },
        )
        .await?;
        transaction.commit().await?;
        Ok(ClaimCenterActivationGrantOutcome {
            installation_id: input.installation_id,
            organization_id,
            activation_version,
            status: CenterInstallationStatus::Ready,
            replayed: false,
        })
    }

    /// Return operator-safe installation and grant metadata without secret material.
    pub async fn get_airhop_center_installation_metadata(
        &self,
        tenant: &TenantContext,
        installation_id: Uuid,
    ) -> Result<Option<CenterInstallationMetadata>> {
        let mut connection = self.pool.acquire().await?;
        let Some(mut installation) = load_installation_metadata_row_from_connection(
            &mut connection,
            tenant,
            installation_id,
        )
        .await?
        else {
            return Ok(None);
        };
        let rows = sqlx::query(
            "SELECT id, expires_at, claimed_at, revoked_at, created_at \
             FROM airhop_center_activation_grants \
             WHERE community_id = $1 AND organization_id = $2 AND installation_id = $3 \
             ORDER BY created_at DESC, id DESC",
        )
        .bind(tenant.community().as_uuid())
        .bind(installation.organization_id)
        .bind(installation_id)
        .fetch_all(&mut *connection)
        .await?;
        installation.grants = rows
            .into_iter()
            .map(|row| {
                Ok(CenterActivationGrantMetadata {
                    id: row.try_get("id")?,
                    expires_at: row.try_get("expires_at")?,
                    claimed_at: row.try_get("claimed_at")?,
                    revoked_at: row.try_get("revoked_at")?,
                    created_at: row.try_get("created_at")?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Some(installation))
    }

    /// Load an activated installation only when the authenticated identity matches.
    pub async fn get_airhop_center_installation_for_identity(
        &self,
        tenant: &TenantContext,
        installation_id: Uuid,
        installation_pubkey: &[u8; 32],
    ) -> Result<Option<CenterInstallationMetadata>> {
        let metadata = self
            .get_airhop_center_installation_metadata(tenant, installation_id)
            .await?;
        Ok(metadata.filter(|installation| {
            installation.installation_pubkey.as_ref() == Some(installation_pubkey)
                && installation.activation_version > 0
        }))
    }
}

#[derive(Debug)]
struct ExistingGrant {
    id: Uuid,
    organization_id: Uuid,
    installation_id: Uuid,
    issue_request_hash: Vec<u8>,
    expires_at: DateTime<Utc>,
}

async fn load_grant_by_issue_idempotency(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    idempotency_digest: &[u8; 32],
) -> Result<Option<ExistingGrant>> {
    let row = sqlx::query(
        "SELECT id, organization_id, installation_id, issue_request_hash, expires_at \
         FROM airhop_center_activation_grants \
         WHERE community_id = $1 AND issue_idempotency_digest = $2 \
         FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(idempotency_digest.as_slice())
    .fetch_optional(&mut **transaction)
    .await?;
    row.map(|row| {
        Ok(ExistingGrant {
            id: row.try_get("id")?,
            organization_id: row.try_get("organization_id")?,
            installation_id: row.try_get("installation_id")?,
            issue_request_hash: row.try_get("issue_request_hash")?,
            expires_at: row.try_get("expires_at")?,
        })
    })
    .transpose()
}

struct ActivationAuditInput<'a> {
    organization_id: Uuid,
    installation_id: Uuid,
    grant_id: Option<Uuid>,
    event_type: &'static str,
    actor_kind: &'static str,
    actor_pubkey: &'a [u8; 32],
    occurred_at: DateTime<Utc>,
    payload: serde_json::Value,
}

async fn append_activation_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    input: &ActivationAuditInput<'_>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO airhop_center_activation_audit (\
             community_id, organization_id, installation_id, grant_id, event_type, \
             actor_kind, actor_pubkey, occurred_at, payload\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(tenant.community().as_uuid())
    .bind(input.organization_id)
    .bind(input.installation_id)
    .bind(input.grant_id)
    .bind(input.event_type)
    .bind(input.actor_kind)
    .bind(input.actor_pubkey.as_slice())
    .bind(input.occurred_at)
    .bind(&input.payload)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn load_installation_metadata_row(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &TenantContext,
    installation_id: Uuid,
) -> Result<Option<CenterInstallationMetadata>> {
    let row = sqlx::query(
        "SELECT organization_id, id, environment, release_profile, release_version, \
                installation_pubkey, status, activation_version, activated_at, \
                last_verified_at, sanitized_error_code \
         FROM airhop_center_installations \
         WHERE community_id = $1 AND id = $2 \
         FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(installation_id)
    .fetch_optional(&mut **transaction)
    .await?;
    row.map(parse_installation_metadata_row).transpose()
}

async fn load_installation_metadata_row_from_connection(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Postgres>,
    tenant: &TenantContext,
    installation_id: Uuid,
) -> Result<Option<CenterInstallationMetadata>> {
    let row = sqlx::query(
        "SELECT organization_id, id, environment, release_profile, release_version, \
                installation_pubkey, status, activation_version, activated_at, \
                last_verified_at, sanitized_error_code \
         FROM airhop_center_installations \
         WHERE community_id = $1 AND id = $2",
    )
    .bind(tenant.community().as_uuid())
    .bind(installation_id)
    .fetch_optional(&mut **connection)
    .await?;
    row.map(parse_installation_metadata_row).transpose()
}

fn parse_installation_metadata_row(
    row: sqlx::postgres::PgRow,
) -> Result<CenterInstallationMetadata> {
    let pubkey: Option<Vec<u8>> = row.try_get("installation_pubkey")?;
    let installation_pubkey = pubkey
        .map(|value| {
            value.try_into().map_err(|_| {
                DbError::InvalidData("invalid AirHub Center installation pubkey length".to_owned())
            })
        })
        .transpose()?;
    let status: String = row.try_get("status")?;
    Ok(CenterInstallationMetadata {
        id: row.try_get("id")?,
        organization_id: row.try_get("organization_id")?,
        environment: row.try_get("environment")?,
        release_profile: row.try_get("release_profile")?,
        release_version: row.try_get("release_version")?,
        installation_pubkey,
        status: CenterInstallationStatus::from_db(&status)?,
        activation_version: row.try_get("activation_version")?,
        activated_at: row.try_get("activated_at")?,
        last_verified_at: row.try_get("last_verified_at")?,
        sanitized_error_code: row.try_get("sanitized_error_code")?,
        grants: Vec::new(),
    })
}

fn validate_issue_input(input: &IssueCenterActivationGrantInput) -> Result<()> {
    if input.installation_id.is_nil()
        || !(1..=80).contains(&input.release_profile.trim().len())
        || !(1..=120).contains(&input.release_version.trim().len())
        || !(MIN_ACTIVATION_GRANT_TTL_SECONDS..=MAX_ACTIVATION_GRANT_TTL_SECONDS)
            .contains(&input.ttl_seconds)
    {
        return Err(DbError::InvalidData(
            "invalid AirHub Center activation grant input".to_owned(),
        ));
    }
    Ok(())
}

fn validate_claim_input(input: &ClaimCenterActivationGrantInput) -> Result<()> {
    if input.installation_id.is_nil()
        || !(1..=80).contains(&input.release_profile.trim().len())
        || !(1..=120).contains(&input.release_version.trim().len())
    {
        return Err(DbError::InvalidData(
            "invalid AirHub Center activation claim input".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue_input() -> IssueCenterActivationGrantInput {
        IssueCenterActivationGrantInput {
            installation_id: Uuid::new_v4(),
            environment: CenterEnvironment::Production,
            release_profile: "site_telegram_center".to_owned(),
            release_version: "2026.08.17".to_owned(),
            ttl_seconds: 900,
            code_digest: [1; 32],
            issue_idempotency_digest: [2; 32],
            issue_request_hash: [3; 32],
            issued_by_pubkey: [4; 32],
        }
    }

    #[test]
    fn issue_validation_rejects_unsafe_ttl_and_empty_binding() {
        let mut input = issue_input();
        input.ttl_seconds = MAX_ACTIVATION_GRANT_TTL_SECONDS + 1;
        assert!(validate_issue_input(&input).is_err());

        input = issue_input();
        input.release_profile = "  ".to_owned();
        assert!(validate_issue_input(&input).is_err());
    }

    #[test]
    fn environment_vocabulary_is_closed() {
        assert_eq!(
            CenterEnvironment::parse("production"),
            Some(CenterEnvironment::Production)
        );
        assert_eq!(CenterEnvironment::parse("prod"), None);
    }
}
