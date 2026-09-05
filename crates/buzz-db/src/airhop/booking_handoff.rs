//! Booking credentials authorize issuance, provider-authenticated inbound
//! authorizes redemption. Neither a click nor an arbitrary phone/name binds a family.

use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use super::public_management::PublicManagementCredential;
use super::{
    append_domain_event, commit_command, insert_pending_command, ActorKind, AirhopActor,
    CommandInsertOutcome, NewAirhopCommand, NewDomainEvent, PrivacyClass,
};
use crate::{Db, DbError, Result};

/// Non-secret launch metadata for a token returned only to its issuing browser.
pub struct BookingHandoffLaunch {
    /// Verified Telegram username from token provisioning, never caller input.
    pub bot_username: String,
    /// The original deadline; retries do not extend it.
    pub expires_at: DateTime<Utc>,
}

/// Privacy-preserving redemption result; invalid codes never reveal a booking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BookingHandoffStatus {
    /// This exact conversation is now verified, including same-chat retries.
    Connected,
    /// Expired, revoked, unknown, or wrong-connection code.
    Invalid,
    /// The conversation already represents a different person.
    Conflict,
}

impl Db {
    /// Links only conversations the requesting staff principal can actually read.
    pub async fn list_airhop_family_conversations(
        &self,
        tenant: &TenantContext,
        family_id: Uuid,
        pubkey: [u8; 32],
    ) -> Result<Vec<Value>> {
        let rows = sqlx::query(
            "SELECT v.channel_id, v.representative_id, c.provider FROM airhop_external_conversations v
             JOIN airhop_external_conversation_routes r ON r.community_id = v.community_id AND r.conversation_id = v.id
             JOIN airhop_channel_connections c ON c.community_id = r.community_id AND c.id = r.connection_id
             JOIN channel_members m ON m.community_id = v.community_id AND m.channel_id = v.channel_id
             WHERE v.community_id = $1 AND v.family_id = $2 AND m.pubkey = $3 AND m.removed_at IS NULL
               AND v.status = 'active' AND r.status = 'active' AND c.status = 'active'
             ORDER BY v.updated_at DESC, v.id LIMIT 100",
        ).bind(tenant.community().as_uuid()).bind(family_id).bind(pubkey.as_slice()).fetch_all(&self.pool).await?;
        rows.iter().map(|row| Ok(json!({"channelId": row.try_get::<Uuid, _>("channel_id")?,
            "representativeId": row.try_get::<Uuid, _>("representative_id")?, "provider": row.try_get::<String, _>("provider")?}))).collect()
    }

    /// Reads connected state only with the booking's management credential.
    pub async fn is_airhop_booking_telegram_connected(
        &self,
        tenant: &TenantContext,
        credential: PublicManagementCredential,
    ) -> Result<bool> {
        Ok(sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM airhop_bookings b
             JOIN airhop_booking_messenger_handoffs h ON h.community_id = b.community_id AND h.booking_id = b.id
             JOIN airhop_external_conversations v ON v.community_id = h.community_id AND v.id = h.conversation_id
             JOIN airhop_external_conversation_routes r ON r.community_id = v.community_id AND r.conversation_id = v.id AND r.connection_id = h.connection_id
             JOIN airhop_channel_connections c ON c.community_id = r.community_id AND c.id = r.connection_id
             WHERE b.community_id = $1 AND b.management_key_version = $2 AND b.management_token_digest = $3
               AND h.status = 'consumed' AND v.family_id = b.family_id AND v.representative_id = b.representative_id
               AND v.status = 'active' AND r.status = 'active' AND c.status = 'active')",
        ).bind(tenant.community().as_uuid()).bind(credential.key_version).bind(credential.token_digest.as_slice())
            .fetch_one(&self.pool).await?)
    }

    /// Issues or replays a 15-minute Telegram grant for a credential-owned booking.
    /// A new digest revokes the previous unused grant. No raw bearer reaches SQL.
    pub async fn issue_airhop_booking_handoff(
        &self,
        tenant: &TenantContext,
        credential: PublicManagementCredential,
        token_digest: [u8; 32],
    ) -> Result<Option<BookingHandoffLaunch>> {
        let mut tx = self.pool.begin().await?;
        let booking = sqlx::query(
            "SELECT b.id, b.organization_id, b.version FROM airhop_bookings b
             JOIN airhop_organizations o ON o.community_id = b.community_id AND o.id = b.organization_id
             WHERE b.community_id = $1 AND b.management_key_version = $2
               AND b.management_token_digest = $3 AND o.status = 'active'
               AND b.status IN ('pending_confirmation', 'confirmed') FOR UPDATE OF b",
        ).bind(tenant.community().as_uuid()).bind(credential.key_version)
            .bind(credential.token_digest.as_slice()).fetch_optional(&mut *tx).await?
            .ok_or_else(|| DbError::NotFound("AirHop managed booking".into()))?;
        let booking_id: Uuid = booking.try_get("id")?;
        let organization_id: Uuid = booking.try_get("organization_id")?;
        // Reuse a retry's exact connection and deadline, never silently renew it.
        let existing = sqlx::query(
            "SELECT h.status, h.expires_at, c.provider_bot_username FROM airhop_booking_messenger_handoffs h
             JOIN airhop_channel_credentials c ON c.community_id = h.community_id
               AND c.connection_id = h.connection_id
             WHERE h.community_id = $1 AND h.booking_id = $2 AND h.token_digest = $3",
        ).bind(tenant.community().as_uuid()).bind(booking_id).bind(token_digest.as_slice())
            .fetch_optional(&mut *tx).await?;
        if let Some(row) = existing {
            let status: String = row.try_get("status")?;
            let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
            return if status == "issued" && expires_at > Utc::now() {
                Ok(Some(BookingHandoffLaunch {
                    bot_username: row.try_get("provider_bot_username")?,
                    expires_at,
                }))
            } else {
                Ok(None)
            };
        }
        let connection = sqlx::query(
            "SELECT c.id, secret.provider_bot_username FROM airhop_channel_connections c
             JOIN airhop_channel_credentials secret ON secret.community_id = c.community_id
               AND secret.connection_id = c.id
             WHERE c.community_id = $1 AND c.organization_id = $2 AND c.provider = 'telegram'
               AND c.status = 'active' AND secret.provider_bot_username IS NOT NULL
             ORDER BY c.created_at, c.id LIMIT 1 FOR SHARE OF c",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(connection) = connection else {
            return Ok(None);
        };
        sqlx::query("UPDATE airhop_booking_messenger_handoffs SET status = 'revoked' WHERE community_id = $1 AND booking_id = $2 AND status = 'issued'")
            .bind(tenant.community().as_uuid()).bind(booking_id).execute(&mut *tx).await?;
        let expires_at: DateTime<Utc> = sqlx::query_scalar(
            "INSERT INTO airhop_booking_messenger_handoffs
             (community_id, organization_id, booking_id, connection_id, token_digest, booking_version)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING expires_at",
        ).bind(tenant.community().as_uuid()).bind(organization_id).bind(booking_id)
            .bind(connection.try_get::<Uuid, _>("id")?).bind(token_digest.as_slice())
            .bind(booking.try_get::<i64, _>("version")?).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(Some(BookingHandoffLaunch {
            bot_username: connection.try_get("provider_bot_username")?,
            expires_at,
        }))
    }

    /// Binds an existing private route and consumes the grant in one transaction.
    /// The gateway may persist the digest, but only its exact authenticated
    /// principal can use it, for the connection and chat proven by provider input.
    pub async fn consume_airhop_booking_handoff(
        &self,
        tenant: &TenantContext,
        connection_id: Uuid,
        conversation_id: Uuid,
        connector_pubkey: [u8; 32],
        token_digest: [u8; 32],
    ) -> Result<BookingHandoffStatus> {
        let mut tx = self.pool.begin().await?;
        // Consistent lock order: connection, conversation, grant. Grant issuance
        // locks the booking, which redemption only reads (never locks).
        let route = sqlx::query(
            "SELECT c.organization_id, r.provider_chat_id, r.provider_chat_digest,
                    v.family_id, v.representative_id, v.channel_id
             FROM airhop_channel_connections c
             JOIN airhop_external_conversation_routes r ON r.community_id = c.community_id
               AND r.organization_id = c.organization_id AND r.connection_id = c.id
             JOIN airhop_external_conversations v ON v.community_id = r.community_id
               AND v.organization_id = r.organization_id AND v.id = r.conversation_id
             JOIN airhop_organizations o ON o.community_id = c.community_id AND o.id = c.organization_id
             WHERE c.community_id = $1 AND c.id = $2 AND v.id = $3 AND c.connector_pubkey = $4
               AND c.provider = 'telegram' AND c.status = 'active' AND r.status = 'active'
               AND v.status = 'active' AND o.status = 'active' FOR SHARE OF c FOR UPDATE OF v",
        ).bind(tenant.community().as_uuid()).bind(connection_id).bind(conversation_id)
            .bind(connector_pubkey.as_slice()).fetch_optional(&mut *tx).await?
            .ok_or_else(|| DbError::AccessDenied("AirHop active connector route required".into()))?;
        let grant = sqlx::query(
            "SELECT h.status, h.expires_at, h.conversation_id, b.family_id, b.representative_id,
                    f.display_name AS family_name, p.display_name AS parent_name,
                    b.applicant_snapshot->>'childName' AS child_name,
                    b.source->>'createdRepresentative' = 'true' AS created_representative,
                    EXISTS (SELECT 1 FROM airhop_duplicate_candidates d WHERE d.community_id=b.community_id
                      AND d.organization_id=b.organization_id AND d.status='pending' AND (
                        (d.new_entity_type='representative' AND d.new_entity_id=b.representative_id)
                        OR (d.new_entity_type='child' AND d.new_entity_id=b.child_id))) AS needs_review
             FROM airhop_booking_messenger_handoffs h
             JOIN airhop_bookings b ON b.community_id = h.community_id AND b.organization_id = h.organization_id AND b.id = h.booking_id
             JOIN airhop_families f ON f.community_id = b.community_id AND f.organization_id = b.organization_id AND f.id = b.family_id
             JOIN airhop_representatives p ON p.community_id = b.community_id AND p.organization_id = b.organization_id AND p.id = b.representative_id
             WHERE h.community_id = $1 AND h.connection_id = $2 AND h.token_digest = $3
               AND f.status = 'active' AND p.status = 'active' FOR UPDATE OF h",
        ).bind(tenant.community().as_uuid()).bind(connection_id).bind(token_digest.as_slice())
            .fetch_optional(&mut *tx).await?;
        let Some(grant) = grant else {
            return Ok(BookingHandoffStatus::Invalid);
        };
        let family_id: Uuid = grant.try_get("family_id")?;
        let representative_id: Uuid = grant.try_get("representative_id")?;
        let status: String = grant.try_get("status")?;
        if status == "consumed" {
            return Ok(
                if grant.try_get::<Option<Uuid>, _>("conversation_id")? == Some(conversation_id)
                    && route.try_get::<Option<Uuid>, _>("family_id")? == Some(family_id)
                    && route.try_get::<Option<Uuid>, _>("representative_id")?
                        == Some(representative_id)
                {
                    BookingHandoffStatus::Connected
                } else {
                    BookingHandoffStatus::Invalid
                },
            );
        }
        if status != "issued" || grant.try_get::<DateTime<Utc>, _>("expires_at")? <= Utc::now() {
            return Ok(BookingHandoffStatus::Invalid);
        }
        // Issuing a new public booking with someone else's phone is not family
        // authentication. Only its newly created identity or the already bound
        // representative may gain family-scoped tools from this grant.
        if grant.try_get::<bool, _>("needs_review")? {
            return Ok(BookingHandoffStatus::Conflict);
        }
        if !grant
            .try_get::<Option<bool>, _>("created_representative")?
            .unwrap_or(false)
            && route.try_get::<Option<Uuid>, _>("representative_id")? != Some(representative_id)
        {
            return Ok(BookingHandoffStatus::Conflict);
        }
        if route
            .try_get::<Option<Uuid>, _>("representative_id")?
            .is_some_and(|id| id != representative_id)
            || route
                .try_get::<Option<Uuid>, _>("family_id")?
                .is_some_and(|id| id != family_id)
        {
            return Ok(BookingHandoffStatus::Conflict);
        }
        let organization_id: Uuid = route.try_get("organization_id")?;
        let chat_digest: Vec<u8> = route.try_get("provider_chat_digest")?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!(
                "{organization_id}:telegram:{}",
                hex::encode(&chat_digest)
            ))
            .execute(&mut *tx)
            .await?;
        // The account digest uses the same tenant+connection HMAC as the route.
        // Unique route locking serializes all redemptions for this identity.
        let account_owner: Option<Uuid> = sqlx::query_scalar(
            "SELECT representative_id FROM airhop_messenger_accounts WHERE community_id = $1
             AND organization_id = $2 AND channel = 'telegram' AND external_user_digest = $3",
        )
        .bind(tenant.community().as_uuid())
        .bind(organization_id)
        .bind(&chat_digest)
        .fetch_optional(&mut *tx)
        .await?;
        if account_owner.is_some_and(|id| id != representative_id) {
            return Ok(BookingHandoffStatus::Conflict);
        }
        let account_write: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO airhop_messenger_accounts (community_id, organization_id, representative_id,
                channel, external_user_id, external_user_digest, verified_at, verified_by_pubkey, last_inbound_at)
             VALUES ($1,$2,$3,'telegram',$4,$5,now(),$6,now())
             ON CONFLICT (community_id, organization_id, channel, external_user_digest)
             DO UPDATE SET last_inbound_at = now(), updated_at = now(),
               verified_at = COALESCE(airhop_messenger_accounts.verified_at, now()),
               verified_by_pubkey = COALESCE(airhop_messenger_accounts.verified_by_pubkey, EXCLUDED.verified_by_pubkey)
             WHERE airhop_messenger_accounts.representative_id = EXCLUDED.representative_id RETURNING id",
        ).bind(tenant.community().as_uuid()).bind(organization_id).bind(representative_id)
            .bind(route.try_get::<String, _>("provider_chat_id")?).bind(chat_digest)
            .bind(connector_pubkey.as_slice()).fetch_optional(&mut *tx).await?;
        let Some(account_id) = account_write else {
            return Ok(BookingHandoffStatus::Conflict);
        };
        let actor = AirhopActor {
            kind: ActorKind::System,
            pubkey: Some(connector_pubkey),
            agent_pubkey: None,
            on_behalf_of_pubkey: None,
        };
        let command = match insert_pending_command(
            &mut tx,
            tenant,
            &NewAirhopCommand {
                id: Uuid::new_v4(),
                organization_id,
                command_type: "ConsumeBookingMessengerHandoff".into(),
                idempotency_digest: token_digest,
                request_hash: token_digest,
                actor: actor.clone(),
                correlation_id: Uuid::new_v4(),
            },
        )
        .await?
        {
            CommandInsertOutcome::Inserted(command) => command,
            CommandInsertOutcome::Existing(_) => return Err(DbError::AirhopVersionConflict),
        };
        let representative_version: i64 = sqlx::query_scalar(
            "UPDATE airhop_representatives SET version=version+1, updated_at=now(), preferred_contact_channel='telegram'
             WHERE community_id=$1 AND organization_id=$2 AND id=$3 RETURNING version",
        ).bind(tenant.community().as_uuid()).bind(organization_id).bind(representative_id).fetch_one(&mut *tx).await?;
        let evidence = json!({"messengerAccountId": account_id, "conversationId": conversation_id,
            "representativeId": representative_id, "channel": "telegram", "verificationMethod": "booking_handoff"});
        append_domain_event(
            &mut tx,
            tenant,
            &NewDomainEvent {
                id: Uuid::new_v4(),
                organization_id,
                stream_type: "representative".into(),
                stream_id: representative_id,
                stream_version: representative_version,
                event_type: "airhop.representative.messenger-bound.v1".into(),
                schema_version: 1,
                occurred_at: Utc::now(),
                actor,
                causation_id: command.id,
                correlation_id: command.correlation_id,
                payload: evidence.clone(),
                privacy_class: PrivacyClass::Pii,
            },
        )
        .await?;
        commit_command(&mut tx, tenant, organization_id, command.id, &evidence).await?;
        sqlx::query("UPDATE airhop_external_conversations SET family_id = $3, representative_id = $4, control_version = control_version + 1, updated_at = now() WHERE community_id = $1 AND id = $2")
            .bind(tenant.community().as_uuid()).bind(conversation_id).bind(family_id).bind(representative_id).execute(&mut *tx).await?;
        // Cancel unverified turns already running before binding. Their signed
        // context must not acquire new permissions retroactively.
        sqlx::query("UPDATE airhop_hermes_turn_receipts SET status = 'cancelled', finished_at = now(), outcome = 'identity_bound' WHERE community_id = $1 AND conversation_id = $2 AND status = 'leased'")
            .bind(tenant.community().as_uuid()).bind(conversation_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE airhop_booking_messenger_handoffs SET status = 'consumed', conversation_id = $3, consumed_at = now() WHERE community_id = $1 AND token_digest = $2")
            .bind(tenant.community().as_uuid()).bind(token_digest.as_slice()).bind(conversation_id).execute(&mut *tx).await?;
        let title = format!(
            "{} · {} · {} · Telegram",
            grant.try_get::<String, _>("family_name")?,
            grant.try_get::<String, _>("parent_name")?,
            grant
                .try_get::<Option<String>, _>("child_name")?
                .unwrap_or_default()
        );
        sqlx::query("UPDATE channels SET name = $3 WHERE community_id = $1 AND id = $2")
            .bind(tenant.community().as_uuid())
            .bind(route.try_get::<Uuid, _>("channel_id")?)
            .bind(title.chars().take(200).collect::<String>())
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(BookingHandoffStatus::Connected)
    }

    /// Latest bound booking in a verified conversation; never model-selected.
    pub async fn get_airhop_conversation_booking(
        &self,
        tenant: &TenantContext,
        conversation_id: Uuid,
        family_id: Uuid,
    ) -> Result<Option<Uuid>> {
        Ok(sqlx::query_scalar(
            "SELECT h.booking_id FROM airhop_booking_messenger_handoffs h
             JOIN airhop_external_conversations v ON v.community_id = h.community_id AND v.id = h.conversation_id
             JOIN airhop_bookings b ON b.community_id = h.community_id AND b.id = h.booking_id
             WHERE h.community_id = $1 AND h.conversation_id = $2 AND v.family_id = $3
               AND b.family_id = $3 AND h.status = 'consumed' ORDER BY h.consumed_at DESC LIMIT 1",
        ).bind(tenant.community().as_uuid()).bind(conversation_id).bind(family_id).fetch_optional(&self.pool).await?)
    }
}
