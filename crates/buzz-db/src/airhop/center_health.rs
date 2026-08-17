//! Signed health verification for activated AirHub Center installations.
//!
//! The deployment operator creates a short-lived challenge. Verification is
//! admitted only after the HTTP boundary validates a payload-bound NIP-98
//! signature, then this module atomically consumes the challenge, advances the
//! installation verification version, and appends secret-free audit evidence.

use buzz_core::TenantContext;
use chrono::{DateTime, Duration, Utc};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use super::center_activation::CenterInstallationStatus;
use crate::{Db, DbError, Result};

/// Fixed lifetime of one server-issued Center health challenge.
pub const CENTER_HEALTH_CHALLENGE_TTL_SECONDS: i64 = 300;

/// Operator-authenticated request to create a health challenge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueCenterHealthChallengeInput {
    /// Activated installation to verify.
    pub installation_id: Uuid,
    /// Tenant-keyed digest of the random challenge returned by HTTP.
    pub challenge_digest: [u8; 32],
    /// Authenticated deployment operator requesting the check.
    pub issued_by_pubkey: [u8; 32],
}

/// Secret-free challenge issuance result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueCenterHealthChallengeOutcome {
    /// Server-allocated challenge identifier.
    pub challenge_id: Uuid,
    /// Bound organization identifier.
    pub organization_id: Uuid,
    /// Bound installation identifier.
    pub installation_id: Uuid,
    /// Challenge expiration instant.
    pub expires_at: DateTime<Utc>,
}

/// Installation-signed response to one health challenge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyCenterHealthChallengeInput {
    /// Bound installation identifier.
    pub installation_id: Uuid,
    /// Challenge identifier returned to the operator.
    pub challenge_id: Uuid,
    /// Tenant-keyed digest of the returned challenge material.
    pub challenge_digest: [u8; 32],
    /// Nostr public key that signed the NIP-98 verification request.
    pub installation_pubkey: [u8; 32],
    /// Exact running release version.
    pub release_version: String,
    /// Sanitized Center configuration generation/version.
    pub config_version: String,
}

/// Result of an atomic signed health verification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyCenterHealthChallengeOutcome {
    /// Bound installation identifier.
    pub installation_id: Uuid,
    /// Monotonic successful-verification generation.
    pub verification_version: i64,
    /// Safe post-verification lifecycle state.
    pub status: CenterInstallationStatus,
    /// Database-authoritative verification instant.
    pub verified_at: DateTime<Utc>,
    /// True when the exact same challenge response had already committed.
    pub replayed: bool,
}

impl Db {
    /// Create a short-lived challenge for an activated Center installation.
    pub async fn issue_airhop_center_health_challenge(
        &self,
        tenant: &TenantContext,
        input: &IssueCenterHealthChallengeInput,
    ) -> Result<IssueCenterHealthChallengeOutcome> {
        if input.installation_id.is_nil() {
            return Err(DbError::InvalidData(
                "invalid AirHub Center health challenge installation id".to_owned(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        let installation = sqlx::query(
            "SELECT organization_id, installation_pubkey, activation_version, status \
             FROM airhop_center_installations \
             WHERE community_id = $1 AND id = $2 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.installation_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(DbError::AirhopHealthChallengeInvalid)?;
        let organization_id: Uuid = installation.try_get("organization_id")?;
        let installation_pubkey: Option<Vec<u8>> = installation.try_get("installation_pubkey")?;
        let activation_version: i64 = installation.try_get("activation_version")?;
        let status: String = installation.try_get("status")?;
        if installation_pubkey.is_none() || activation_version <= 0 || status == "disabled" {
            return Err(DbError::AirhopActivationConflict);
        }

        let created_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let expires_at = created_at + Duration::seconds(CENTER_HEALTH_CHALLENGE_TTL_SECONDS);
        let challenge_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_center_health_challenges (\
                 community_id, organization_id, id, installation_id, challenge_digest, \
                 issued_by_pubkey, expires_at, created_at\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(challenge_id)
        .bind(input.installation_id)
        .bind(input.challenge_digest.as_slice())
        .bind(input.issued_by_pubkey.as_slice())
        .bind(expires_at)
        .bind(created_at)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(IssueCenterHealthChallengeOutcome {
            challenge_id,
            organization_id,
            installation_id: input.installation_id,
            expires_at,
        })
    }

    /// Consume a challenge and mark the installation ready after signature verification.
    pub async fn verify_airhop_center_health_challenge(
        &self,
        tenant: &TenantContext,
        input: &VerifyCenterHealthChallengeInput,
    ) -> Result<VerifyCenterHealthChallengeOutcome> {
        validate_verify_input(input)?;
        let mut transaction = self.pool.begin().await?;
        let verified_at: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
            .fetch_one(&mut *transaction)
            .await?;
        let challenge = sqlx::query(
            "SELECT organization_id, expires_at, consumed_at, verified_pubkey, \
                    verified_release_version, verified_config_version, verification_version \
             FROM airhop_center_health_challenges \
             WHERE community_id = $1 AND id = $2 AND installation_id = $3 \
               AND challenge_digest = $4 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.challenge_id)
        .bind(input.installation_id)
        .bind(input.challenge_digest.as_slice())
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(DbError::AirhopHealthChallengeInvalid)?;
        let organization_id: Uuid = challenge.try_get("organization_id")?;
        let expires_at: DateTime<Utc> = challenge.try_get("expires_at")?;
        let consumed_at: Option<DateTime<Utc>> = challenge.try_get("consumed_at")?;
        let verified_pubkey: Option<Vec<u8>> = challenge.try_get("verified_pubkey")?;
        let verified_release_version: Option<String> =
            challenge.try_get("verified_release_version")?;
        let verified_config_version: Option<String> =
            challenge.try_get("verified_config_version")?;
        let stored_verification_version: Option<i64> = challenge.try_get("verification_version")?;

        if let Some(consumed_at) = consumed_at {
            let same_response = verified_pubkey.as_deref()
                == Some(input.installation_pubkey.as_slice())
                && verified_release_version.as_deref() == Some(input.release_version.trim())
                && verified_config_version.as_deref() == Some(input.config_version.trim());
            if !same_response {
                return Err(DbError::AirhopHealthChallengeInvalid);
            }
            let verification_version = stored_verification_version.ok_or_else(|| {
                DbError::InvalidData("consumed health challenge has no version".to_owned())
            })?;
            transaction.commit().await?;
            return Ok(VerifyCenterHealthChallengeOutcome {
                installation_id: input.installation_id,
                verification_version,
                status: CenterInstallationStatus::Ready,
                verified_at: consumed_at,
                replayed: true,
            });
        }
        if expires_at <= verified_at {
            return Err(DbError::AirhopHealthChallengeInvalid);
        }

        let installation = sqlx::query(
            "SELECT organization_id, installation_pubkey, release_version, status \
             FROM airhop_center_installations \
             WHERE community_id = $1 AND id = $2 \
             FOR UPDATE",
        )
        .bind(tenant.community().as_uuid())
        .bind(input.installation_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(DbError::AirhopHealthChallengeInvalid)?;
        let installation_organization_id: Uuid = installation.try_get("organization_id")?;
        let installation_pubkey: Option<Vec<u8>> = installation.try_get("installation_pubkey")?;
        let release_version: String = installation.try_get("release_version")?;
        let status: String = installation.try_get("status")?;
        if installation_organization_id != organization_id
            || installation_pubkey.as_deref() != Some(input.installation_pubkey.as_slice())
            || release_version != input.release_version.trim()
            || status == "disabled"
        {
            return Err(DbError::AirhopActivationConflict);
        }

        let verification_version: i64 = sqlx::query_scalar(
            "UPDATE airhop_center_installations \
             SET config_version = $4, verification_version = verification_version + 1, \
                 last_verified_at = $5, status = 'ready', sanitized_error_code = NULL, \
                 updated_at = $5 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3 \
             RETURNING verification_version",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.installation_id)
        .bind(input.config_version.trim())
        .bind(verified_at)
        .fetch_one(&mut *transaction)
        .await?;

        sqlx::query(
            "UPDATE airhop_center_health_challenges \
             SET consumed_at = $4, verified_pubkey = $5, verified_release_version = $6, \
                 verified_config_version = $7, verification_version = $8 \
             WHERE community_id = $1 AND organization_id = $2 AND id = $3",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.challenge_id)
        .bind(verified_at)
        .bind(input.installation_pubkey.as_slice())
        .bind(input.release_version.trim())
        .bind(input.config_version.trim())
        .bind(verification_version)
        .execute(&mut *transaction)
        .await?;

        sqlx::query(
            "INSERT INTO airhop_center_activation_audit (\
                 community_id, organization_id, installation_id, grant_id, event_type, \
                 actor_kind, actor_pubkey, occurred_at, payload\
             ) VALUES ($1, $2, $3, NULL, $4, 'installation', $5, $6, $7)",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(input.installation_id)
        .bind("airhop.center.installation-verified.v1")
        .bind(input.installation_pubkey.as_slice())
        .bind(verified_at)
        .bind(json!({
            "challengeId": input.challenge_id,
            "verificationVersion": verification_version,
            "releaseVersion": input.release_version.trim(),
            "configVersion": input.config_version.trim(),
        }))
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(VerifyCenterHealthChallengeOutcome {
            installation_id: input.installation_id,
            verification_version,
            status: CenterInstallationStatus::Ready,
            verified_at,
            replayed: false,
        })
    }
}

fn validate_verify_input(input: &VerifyCenterHealthChallengeInput) -> Result<()> {
    if input.installation_id.is_nil()
        || input.challenge_id.is_nil()
        || !(1..=120).contains(&input.release_version.trim().len())
        || !(1..=120).contains(&input.config_version.trim().len())
    {
        return Err(DbError::InvalidData(
            "invalid AirHub Center health verification input".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verification_requires_nonempty_bounded_versions() {
        let mut input = VerifyCenterHealthChallengeInput {
            installation_id: Uuid::new_v4(),
            challenge_id: Uuid::new_v4(),
            challenge_digest: [1; 32],
            installation_pubkey: [2; 32],
            release_version: "2026.08.17".to_owned(),
            config_version: "config-1".to_owned(),
        };
        assert!(validate_verify_input(&input).is_ok());
        input.config_version = "  ".to_owned();
        assert!(validate_verify_input(&input).is_err());
    }
}
