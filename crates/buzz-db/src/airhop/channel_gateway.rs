//! Provider-neutral channel connections, inbound deduplication, and delivery leases.

use buzz_core::{CommunityId, TenantContext};
use chrono::{DateTime, Utc};
use nostr::Event;
use serde::Serialize;
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

const MAX_EXTERNAL_DELIVERY_ATTEMPTS: i32 = 5;
const MAX_HERMES_PUBLICATION_ATTEMPTS: i32 = 10;

/// Owner-authored desired state for one Hermes messaging adapter.
#[derive(Debug, Clone)]
pub struct PutChannelConnectionInput {
    /// Stable connection identity.
    pub connection_id: Uuid,
    /// `telegram` or the official `whatsapp_cloud` adapter in the first release.
    pub provider: String,
    /// Human-facing name shown in AirHop Center.
    pub display_name: String,
    /// Exact trusted gateway principal allowed to claim and ingest traffic.
    pub connector_pubkey: [u8; 32],
    /// `active`, `paused`, or `disabled`.
    pub status: String,
    /// Whether parent input from this connection may start Hermes.
    pub hermes_enabled: bool,
    /// Provider capabilities negotiated by the separately deployed adapter.
    pub capabilities: Value,
    /// Zero creates; the current version updates.
    pub expected_version: i64,
    /// Authenticated owner/admin applying desired state.
    pub updated_by_pubkey: [u8; 32],
}

/// Atomic self-service provisioning input for one encrypted provider token.
#[derive(Debug, Clone)]
pub struct ProvisionChannelConnectionInput {
    /// Credential-free desired connection state.
    pub connection: PutChannelConnectionInput,
    /// AEAD ciphertext including its authentication tag.
    pub credential_ciphertext: Vec<u8>,
    /// Unique 96-bit AEAD nonce.
    pub credential_nonce: [u8; 12],
    /// Relay-configured encryption key version.
    pub credential_key_version: i16,
    /// Stable keyed fingerprint used only for duplicate prevention.
    pub credential_fingerprint: [u8; 32],
    /// Provider-issued bot identity verified before persistence.
    pub provider_bot_id: String,
    /// Optional provider username safe to show in Center.
    pub provider_bot_username: Option<String>,
}

/// Encrypted provider credential returned only to Relay for decryption.
#[derive(Debug, Clone)]
pub struct EncryptedChannelCredential {
    /// Stable connection identity bound into AEAD associated data.
    pub connection_id: Uuid,
    /// Provider owning this credential.
    pub provider: String,
    /// AEAD ciphertext including its authentication tag.
    pub ciphertext: Vec<u8>,
    /// Unique 96-bit AEAD nonce.
    pub nonce: [u8; 12],
    /// Relay-configured encryption key version.
    pub key_version: i16,
}

/// Safe connector assignment used by the multi-connection gateway supervisor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelGatewayAssignment {
    /// Stable connection identity.
    pub connection_id: Uuid,
    /// Provider adapter id.
    pub provider: String,
    /// Desired lifecycle state.
    pub status: String,
}

/// Safe control-plane projection of a channel connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelConnection {
    /// Server-resolved organization.
    pub organization_id: Uuid,
    /// Stable connection identity.
    pub id: Uuid,
    /// Provider adapter id.
    pub provider: String,
    /// Human-facing connection name.
    pub display_name: String,
    /// Trusted connector principal.
    pub connector_pubkey: [u8; 32],
    /// Current desired lifecycle state.
    pub status: String,
    /// Whether Hermes is enabled for inbound messages on the connection.
    pub hermes_enabled: bool,
    /// Negotiated provider capabilities.
    pub capabilities: Value,
    /// Last adapter-reported state.
    pub observed_status: String,
    /// Capabilities reported by the running adapter.
    pub observed_capabilities: Value,
    /// Last authenticated adapter heartbeat.
    pub last_heartbeat_at: Option<DateTime<Utc>>,
    /// Stable non-secret adapter error code.
    pub last_error_code: Option<String>,
    /// Optimistic-control version.
    pub version: i64,
}

/// Runtime observation reported by the exact configured adapter principal.
#[derive(Debug, Clone)]
pub struct ObserveChannelConnectionInput {
    /// Stable connection identity.
    pub connection_id: Uuid,
    /// `offline`, `connecting`, `ready`, or `degraded`.
    pub observed_status: String,
    /// Runtime capabilities actually available in this adapter revision.
    pub observed_capabilities: Value,
    /// Stable non-secret error code when degraded.
    pub error_code: Option<String>,
    /// Exact authenticated connector principal.
    pub connector_pubkey: [u8; 32],
}

/// Owner-authored binding from one canonical Buzz conversation to a provider chat.
#[derive(Debug, Clone)]
pub struct PutConversationRouteInput {
    /// Canonical external conversation.
    pub conversation_id: Uuid,
    /// Channel connection that owns transport.
    pub connection_id: Uuid,
    /// Provider-specific routable chat/user id, disclosed only to its connector.
    pub provider_chat_id: String,
    /// Tenant-keyed digest used for uniqueness without indexing the clear id.
    pub provider_chat_digest: [u8; 32],
    /// `active`, `paused`, or `disabled`.
    pub status: String,
    /// Zero creates; the current version updates.
    pub expected_version: i64,
    /// Authenticated owner/admin applying desired state.
    pub updated_by_pubkey: [u8; 32],
}

/// Safe control-plane projection of one provider conversation route.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRoute {
    /// Canonical external conversation.
    pub conversation_id: Uuid,
    /// Bound transport connection.
    pub connection_id: Uuid,
    /// Route lifecycle state.
    pub status: String,
    /// Optimistic-control version.
    pub version: i64,
    /// Monotonic identity fence copied into external outbox rows.
    pub routing_version: i64,
}

/// Runtime-only route projection returned to the exact configured connector.
///
/// The provider chat id never leaves the request/connector boundary. Its
/// tenant-keyed digest resolves the canonical Buzz destination instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedConversationRoute {
    /// Canonical external conversation.
    pub conversation_id: Uuid,
    /// Private Buzz stream that stores the conversation.
    pub channel_id: Uuid,
    /// Current route lifecycle state.
    pub route_status: String,
    /// Current connection lifecycle state.
    pub connection_status: String,
}

/// Exact connector request to create the first canonical conversation for a
/// previously unseen private provider chat.
#[derive(Debug, Clone)]
pub struct ProvisionExternalConversationRouteInput {
    /// Channel connection receiving the private message.
    pub connection_id: Uuid,
    /// Provider-specific routable chat id, stored only inside the gateway boundary.
    pub provider_chat_id: String,
    /// Tenant/connection-scoped digest used for idempotency and lookup.
    pub provider_chat_digest: [u8; 32],
    /// Authenticated connector principal configured on the connection.
    pub connector_pubkey: [u8; 32],
}

/// Idempotent outcome of first-contact route provisioning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvisionedExternalConversationRoute {
    /// Canonical route, whether newly created or replayed.
    pub route: ResolvedConversationRoute,
    /// True only for the transaction that created the channel and conversation.
    pub created: bool,
}

/// Trusted provider provenance carried into atomic Buzz event insertion.
#[derive(Debug, Clone, Copy)]
pub struct GatewayInboundContext {
    /// Exact connection claimed by the authenticated connector.
    pub connection_id: Uuid,
    /// Tenant-keyed provider event id digest.
    pub provider_event_digest: [u8; 32],
    /// Exact authenticated connector principal.
    pub connector_pubkey: [u8; 32],
}

/// One provider-neutral external delivery leased to the Hermes gateway.
#[derive(Debug, Clone)]
pub struct ExternalMessageDeliveryJob {
    /// Durable outbox identity.
    pub outbox_id: Uuid,
    /// Per-attempt lease capability.
    pub lease_token: Uuid,
    /// Connection desired-state identity.
    pub connection_id: Uuid,
    /// Provider adapter id.
    pub provider: String,
    /// Provider-specific destination, returned only to its exact connector.
    pub provider_chat_id: String,
    /// Stable Buzz event id used as provider idempotency material.
    pub buzz_event_id: [u8; 32],
    /// Signed canonical Buzz event.
    pub event: Event,
    /// `hermes`, `staff`, or `system`.
    pub actor_kind: String,
    /// Position in a bounded multi-message reply.
    pub sequence: i16,
    /// One-based delivery attempt.
    pub attempt: i32,
}

/// Connector completion for one external-message lease.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalDeliveryCompletion {
    /// The provider accepted the exact message.
    Delivered {
        /// Provider receipt/message id when available.
        provider_message_id: Option<String>,
    },
    /// The provider rejected or could not accept this attempt.
    Failed {
        /// Stable non-secret error code.
        error_code: String,
        /// Connector-selected retry delay.
        retry_after_seconds: i64,
        /// False when the provider says another attempt cannot succeed.
        retryable: bool,
    },
}

/// Observable result of an idempotent external delivery callback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalDeliveryAckState {
    /// Provider delivery is terminally successful.
    Delivered,
    /// The same outbox result will be retried later.
    RetryScheduled,
    /// Retry budget was exhausted.
    Failed,
}

/// A committed Hermes event that still needs normal Buzz ingestion.
#[derive(Debug, Clone)]
pub struct PendingHermesPublication {
    /// Server-trusted tenant identity from the database row.
    pub community_id: CommunityId,
    /// Canonical host joined from the community registry.
    pub host: String,
    /// Signed event to replay through the ordinary ingest pipeline.
    pub event: Event,
    /// Exact deployed Hermes principal.
    pub agent_pubkey: [u8; 32],
}

impl Db {
    /// Creates or updates one credential-free channel connection desired state.
    pub async fn put_airhop_channel_connection(
        &self,
        tenant: &TenantContext,
        input: &PutChannelConnectionInput,
    ) -> Result<ChannelConnection> {
        validate_connection(input)?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id = active_organization(&mut tx, community_id).await?;
        require_owner_or_admin(&mut tx, community_id, input.updated_by_pubkey).await?;
        require_owner_or_admin(&mut tx, community_id, input.connector_pubkey).await?;

        let existing = sqlx::query(
            "SELECT organization_id, id, provider, display_name, connector_pubkey,
                    status, hermes_enabled, capabilities, observed_status,
                    observed_capabilities, last_heartbeat_at, last_error_code, version
             FROM airhop_channel_connections
             WHERE community_id = $1 AND id = $2 FOR UPDATE",
        )
        .bind(community_id)
        .bind(input.connection_id)
        .fetch_optional(&mut *tx)
        .await?;
        let row = if let Some(row) = existing {
            let current = connection_from_row(&row)?;
            if current.organization_id != organization_id {
                return Err(DbError::AccessDenied(
                    "AirHop channel connection belongs to another organization".to_owned(),
                ));
            }
            if current.version != input.expected_version {
                return Err(DbError::AirhopVersionConflict);
            }
            if current.provider != input.provider {
                return Err(DbError::InvalidData(
                    "AirHop channel connection provider is immutable".to_owned(),
                ));
            }
            let row = sqlx::query(
                "UPDATE airhop_channel_connections
                 SET display_name = $4, connector_pubkey = $5, status = $6,
                     hermes_enabled = $7, capabilities = $8,
                     version = version + 1, updated_by_pubkey = $9, updated_at = now()
                 WHERE community_id = $1 AND organization_id = $2 AND id = $3
                 RETURNING organization_id, id, provider, display_name, connector_pubkey,
                    status, hermes_enabled, capabilities, observed_status,
                    observed_capabilities, last_heartbeat_at, last_error_code, version",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(input.connection_id)
            .bind(input.display_name.trim())
            .bind(input.connector_pubkey.as_slice())
            .bind(input.status.trim())
            .bind(input.hermes_enabled)
            .bind(&input.capabilities)
            .bind(input.updated_by_pubkey.as_slice())
            .fetch_one(&mut *tx)
            .await?;
            if current.status != "disabled" && input.status.trim() == "disabled" {
                sqlx::query(
                    "UPDATE airhop_external_message_outbox
                     SET status = 'superseded', last_error_code = 'connection_disabled',
                         lease_token = NULL, leased_by_pubkey = NULL,
                         lease_expires_at = NULL, updated_at = now()
                     WHERE community_id = $1 AND organization_id = $2
                       AND connection_id = $3 AND status = 'pending'",
                )
                .bind(community_id)
                .bind(organization_id)
                .bind(input.connection_id)
                .execute(&mut *tx)
                .await?;
            }
            row
        } else {
            if input.expected_version != 0 {
                return Err(DbError::AirhopVersionConflict);
            }
            sqlx::query(
                "INSERT INTO airhop_channel_connections (
                    community_id, organization_id, id, provider, display_name,
                    connector_pubkey, status, hermes_enabled, capabilities,
                    updated_by_pubkey
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING organization_id, id, provider, display_name, connector_pubkey,
                    status, hermes_enabled, capabilities, observed_status,
                    observed_capabilities, last_heartbeat_at, last_error_code, version",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(input.connection_id)
            .bind(input.provider.trim())
            .bind(input.display_name.trim())
            .bind(input.connector_pubkey.as_slice())
            .bind(input.status.trim())
            .bind(input.hermes_enabled)
            .bind(&input.capabilities)
            .bind(input.updated_by_pubkey.as_slice())
            .fetch_one(&mut *tx)
            .await?
        };
        let connection = connection_from_row(&row)?;
        tx.commit().await?;
        Ok(connection)
    }

    /// Atomically creates a channel connection and its encrypted credential.
    pub async fn provision_airhop_channel_connection(
        &self,
        tenant: &TenantContext,
        input: &ProvisionChannelConnectionInput,
    ) -> Result<ChannelConnection> {
        validate_connection(&input.connection)?;
        validate_provisioning(input)?;
        if input.connection.expected_version != 0 {
            return Err(DbError::AirhopVersionConflict);
        }

        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id = active_organization(&mut tx, community_id).await?;
        require_owner_or_admin(&mut tx, community_id, input.connection.updated_by_pubkey).await?;
        require_staff_member(&mut tx, community_id, input.connection.connector_pubkey).await?;

        let duplicate: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM airhop_channel_credentials
                WHERE community_id = $1 AND organization_id = $2
                  AND provider = $3 AND credential_fingerprint = $4
             )",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.connection.provider.trim())
        .bind(input.credential_fingerprint.as_slice())
        .fetch_one(&mut *tx)
        .await?;
        if duplicate {
            return Err(DbError::InvalidData(
                "Telegram bot is already connected".to_owned(),
            ));
        }

        let row = sqlx::query(
            "INSERT INTO airhop_channel_connections (
                community_id, organization_id, id, provider, display_name,
                connector_pubkey, status, hermes_enabled, capabilities,
                updated_by_pubkey
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING organization_id, id, provider, display_name, connector_pubkey,
                status, hermes_enabled, capabilities, observed_status,
                observed_capabilities, last_heartbeat_at, last_error_code, version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.connection.connection_id)
        .bind(input.connection.provider.trim())
        .bind(input.connection.display_name.trim())
        .bind(input.connection.connector_pubkey.as_slice())
        .bind(input.connection.status.trim())
        .bind(input.connection.hermes_enabled)
        .bind(&input.connection.capabilities)
        .bind(input.connection.updated_by_pubkey.as_slice())
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO airhop_channel_credentials (
                community_id, organization_id, connection_id, provider,
                credential_ciphertext, credential_nonce, credential_key_version,
                credential_fingerprint, provider_bot_id, provider_bot_username,
                updated_by_pubkey
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.connection.connection_id)
        .bind(input.connection.provider.trim())
        .bind(&input.credential_ciphertext)
        .bind(input.credential_nonce.as_slice())
        .bind(input.credential_key_version)
        .bind(input.credential_fingerprint.as_slice())
        .bind(input.provider_bot_id.trim())
        .bind(input.provider_bot_username.as_deref().map(str::trim))
        .bind(input.connection.updated_by_pubkey.as_slice())
        .execute(&mut *tx)
        .await?;

        let connection = connection_from_row(&row)?;
        tx.commit().await?;
        Ok(connection)
    }

    /// Lists credential-free desired and observed connection state for settings UI.
    pub async fn list_airhop_channel_connections(
        &self,
        tenant: &TenantContext,
        requester_pubkey: [u8; 32],
    ) -> Result<Vec<ChannelConnection>> {
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id = active_organization(&mut tx, community_id).await?;
        require_staff_member(&mut tx, community_id, requester_pubkey).await?;
        let rows = sqlx::query(
            "SELECT organization_id, id, provider, display_name, connector_pubkey,
                    status, hermes_enabled, capabilities, observed_status,
                    observed_capabilities, last_heartbeat_at, last_error_code, version
             FROM airhop_channel_connections
             WHERE community_id = $1 AND organization_id = $2
             ORDER BY provider, display_name, id",
        )
        .bind(community_id)
        .bind(organization_id)
        .fetch_all(&mut *tx)
        .await?;
        let connections = rows
            .iter()
            .map(connection_from_row)
            .collect::<Result<Vec<_>>>()?;
        tx.commit().await?;
        Ok(connections)
    }

    /// Lists active assignments for the exact authenticated connector.
    pub async fn list_airhop_channel_gateway_assignments(
        &self,
        tenant: &TenantContext,
        connector_pubkey: [u8; 32],
    ) -> Result<Vec<ChannelGatewayAssignment>> {
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id = active_organization(&mut tx, community_id).await?;
        require_staff_member(&mut tx, community_id, connector_pubkey).await?;
        let rows = sqlx::query(
            "SELECT connection.id, connection.provider, connection.status
             FROM airhop_channel_connections connection
             JOIN airhop_channel_credentials credential
               ON credential.community_id = connection.community_id
              AND credential.organization_id = connection.organization_id
              AND credential.connection_id = connection.id
             WHERE connection.community_id = $1
               AND connection.organization_id = $2
               AND connection.connector_pubkey = $3
               AND connection.status <> 'disabled'
             ORDER BY connection.provider, connection.id",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(connector_pubkey.as_slice())
        .fetch_all(&mut *tx)
        .await?;
        let assignments = rows
            .iter()
            .map(|row| {
                Ok(ChannelGatewayAssignment {
                    connection_id: row.try_get("id")?,
                    provider: row.try_get("provider")?,
                    status: row.try_get("status")?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        tx.commit().await?;
        Ok(assignments)
    }

    /// Returns encrypted credential material to Relay only when the caller is
    /// the exact connector bound to an enabled connection.
    pub async fn get_airhop_channel_credential_for_connector(
        &self,
        tenant: &TenantContext,
        connection_id: Uuid,
        connector_pubkey: [u8; 32],
    ) -> Result<EncryptedChannelCredential> {
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id = active_organization(&mut tx, community_id).await?;
        let row = sqlx::query(
            "SELECT credential.connection_id, credential.provider,
                    credential.credential_ciphertext, credential.credential_nonce,
                    credential.credential_key_version
             FROM airhop_channel_credentials credential
             JOIN airhop_channel_connections connection
               ON connection.community_id = credential.community_id
              AND connection.organization_id = credential.organization_id
              AND connection.id = credential.connection_id
             WHERE credential.community_id = $1
               AND credential.organization_id = $2
               AND credential.connection_id = $3
               AND connection.connector_pubkey = $4
               AND connection.status <> 'disabled'",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(connection_id)
        .bind(connector_pubkey.as_slice())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("channel credential".to_owned()))?;
        let nonce: Vec<u8> = row.try_get("credential_nonce")?;
        let nonce = nonce.try_into().map_err(|_| {
            DbError::InvalidData("stored channel credential nonce is invalid".to_owned())
        })?;
        let credential = EncryptedChannelCredential {
            connection_id: row.try_get("connection_id")?,
            provider: row.try_get("provider")?,
            ciphertext: row.try_get("credential_ciphertext")?,
            nonce,
            key_version: row.try_get("credential_key_version")?,
        };
        tx.commit().await?;
        Ok(credential)
    }

    /// Records runtime health from the exact connector without changing desired state.
    pub async fn observe_airhop_channel_connection(
        &self,
        tenant: &TenantContext,
        input: &ObserveChannelConnectionInput,
    ) -> Result<ChannelConnection> {
        validate_observation(input)?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id = active_organization(&mut tx, community_id).await?;
        let row = sqlx::query(
            "UPDATE airhop_channel_connections
             SET observed_status = $5, observed_capabilities = $6,
                 last_heartbeat_at = now(), last_error_code = $7,
                 updated_at = now()
             WHERE community_id = $1 AND organization_id = $2 AND id = $3
               AND connector_pubkey = $4
             RETURNING organization_id, id, provider, display_name, connector_pubkey,
                status, hermes_enabled, capabilities, observed_status,
                observed_capabilities, last_heartbeat_at, last_error_code, version",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.connection_id)
        .bind(input.connector_pubkey.as_slice())
        .bind(input.observed_status.trim())
        .bind(&input.observed_capabilities)
        .bind(input.error_code.as_deref().map(str::trim))
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            DbError::AccessDenied(
                "AirHop channel connection belongs to another connector".to_owned(),
            )
        })?;
        let connection = connection_from_row(&row)?;
        tx.commit().await?;
        Ok(connection)
    }

    /// Creates or updates the exact provider route for one external conversation.
    pub async fn put_airhop_external_conversation_route(
        &self,
        tenant: &TenantContext,
        input: &PutConversationRouteInput,
    ) -> Result<ConversationRoute> {
        validate_route(input)?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id = active_organization(&mut tx, community_id).await?;
        require_owner_or_admin(&mut tx, community_id, input.updated_by_pubkey).await?;
        let valid_binding: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM airhop_external_conversations conversation
                JOIN airhop_channel_connections connection
                  ON connection.community_id = conversation.community_id
                 AND connection.organization_id = conversation.organization_id
                 AND connection.id = $4
                WHERE conversation.community_id = $1
                  AND conversation.organization_id = $2
                  AND conversation.id = $3 AND conversation.status = 'active'
                  AND connection.status <> 'disabled'
                  AND EXISTS (
                    SELECT 1 FROM channel_members connector
                    WHERE connector.community_id = conversation.community_id
                      AND connector.channel_id = conversation.channel_id
                      AND connector.pubkey = connection.connector_pubkey
                      AND connector.removed_at IS NULL
                  )
             )",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(input.conversation_id)
        .bind(input.connection_id)
        .fetch_one(&mut *tx)
        .await?;
        if !valid_binding {
            return Err(DbError::AccessDenied(
                "AirHop conversation route requires an active conversation, connection, and connector channel membership"
                    .to_owned(),
            ));
        }

        let existing = sqlx::query(
            "SELECT conversation_id, connection_id, provider_chat_digest, status,
                    version, routing_version
             FROM airhop_external_conversation_routes
             WHERE community_id = $1 AND conversation_id = $2 FOR UPDATE",
        )
        .bind(community_id)
        .bind(input.conversation_id)
        .fetch_optional(&mut *tx)
        .await?;
        let row = if let Some(row) = existing {
            let version: i64 = row.try_get("version")?;
            if version != input.expected_version {
                return Err(DbError::AirhopVersionConflict);
            }
            let old_connection: Uuid = row.try_get("connection_id")?;
            let old_digest: Vec<u8> = row.try_get("provider_chat_digest")?;
            let old_status: String = row.try_get("status")?;
            let identity_changed = old_connection != input.connection_id
                || old_digest.as_slice() != input.provider_chat_digest;
            if identity_changed {
                let leased: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM airhop_external_message_outbox
                     WHERE community_id = $1 AND organization_id = $2
                       AND conversation_id = $3 AND status = 'leased')",
                )
                .bind(community_id)
                .bind(organization_id)
                .bind(input.conversation_id)
                .fetch_one(&mut *tx)
                .await?;
                if leased {
                    return Err(DbError::AirhopVersionConflict);
                }
            }
            let row = sqlx::query(
                "UPDATE airhop_external_conversation_routes
                 SET connection_id = $4, provider_chat_id = $5,
                     provider_chat_digest = $6, status = $7,
                     version = version + 1,
                     routing_version = routing_version + CASE WHEN $8 THEN 1 ELSE 0 END,
                     updated_by_pubkey = $9, updated_at = now()
                 WHERE community_id = $1 AND organization_id = $2
                   AND conversation_id = $3
                 RETURNING conversation_id, connection_id, status, version, routing_version",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(input.conversation_id)
            .bind(input.connection_id)
            .bind(input.provider_chat_id.trim())
            .bind(input.provider_chat_digest.as_slice())
            .bind(input.status.trim())
            .bind(identity_changed)
            .bind(input.updated_by_pubkey.as_slice())
            .fetch_one(&mut *tx)
            .await?;
            if identity_changed {
                sqlx::query(
                    "UPDATE airhop_external_message_outbox
                     SET status = 'superseded', last_error_code = 'route_rebound',
                         lease_token = NULL, leased_by_pubkey = NULL,
                         lease_expires_at = NULL, updated_at = now()
                     WHERE community_id = $1 AND organization_id = $2
                       AND conversation_id = $3 AND status = 'pending'",
                )
                .bind(community_id)
                .bind(organization_id)
                .bind(input.conversation_id)
                .execute(&mut *tx)
                .await?;
            } else {
                if old_status != "disabled" && input.status.trim() == "disabled" {
                    sqlx::query(
                        "UPDATE airhop_external_message_outbox
                         SET status = 'superseded', last_error_code = 'route_disabled',
                             lease_token = NULL, leased_by_pubkey = NULL,
                             lease_expires_at = NULL, updated_at = now()
                         WHERE community_id = $1 AND organization_id = $2
                           AND conversation_id = $3 AND status = 'pending'",
                    )
                    .bind(community_id)
                    .bind(organization_id)
                    .bind(input.conversation_id)
                    .execute(&mut *tx)
                    .await?;
                }
            }
            row
        } else {
            if input.expected_version != 0 {
                return Err(DbError::AirhopVersionConflict);
            }
            sqlx::query(
                "INSERT INTO airhop_external_conversation_routes (
                    community_id, organization_id, conversation_id, connection_id,
                    provider_chat_id, provider_chat_digest, status, updated_by_pubkey
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING conversation_id, connection_id, status, version, routing_version",
            )
            .bind(community_id)
            .bind(organization_id)
            .bind(input.conversation_id)
            .bind(input.connection_id)
            .bind(input.provider_chat_id.trim())
            .bind(input.provider_chat_digest.as_slice())
            .bind(input.status.trim())
            .bind(input.updated_by_pubkey.as_slice())
            .fetch_one(&mut *tx)
            .await?
        };
        let route = route_from_row(&row)?;
        tx.commit().await?;
        Ok(route)
    }

    /// Resolves one provider chat to its canonical Buzz destination for the
    /// exact connector principal configured on the connection.
    pub async fn resolve_airhop_external_conversation_route(
        &self,
        tenant: &TenantContext,
        connection_id: Uuid,
        provider_chat_digest: [u8; 32],
        connector_pubkey: [u8; 32],
    ) -> Result<ResolvedConversationRoute> {
        if connection_id.is_nil() {
            return Err(DbError::InvalidData(
                "AirHop external conversation route lookup is invalid".to_owned(),
            ));
        }
        let community_id = *tenant.community().as_uuid();
        let row = sqlx::query(
            "SELECT conversation.id AS conversation_id, conversation.channel_id,
                    route.status AS route_status,
                    connection.status AS connection_status
             FROM airhop_external_conversation_routes route
             JOIN airhop_external_conversations conversation
               ON conversation.community_id = route.community_id
              AND conversation.organization_id = route.organization_id
              AND conversation.id = route.conversation_id
             JOIN airhop_channel_connections connection
               ON connection.community_id = route.community_id
              AND connection.organization_id = route.organization_id
              AND connection.id = route.connection_id
             WHERE route.community_id = $1 AND route.connection_id = $2
               AND route.provider_chat_digest = $3
               AND connection.connector_pubkey = $4
               AND conversation.status = 'active'
               AND route.status <> 'disabled'
               AND connection.status <> 'disabled'",
        )
        .bind(community_id)
        .bind(connection_id)
        .bind(provider_chat_digest.as_slice())
        .bind(connector_pubkey.as_slice())
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHop external conversation route".to_owned()))?;
        Ok(ResolvedConversationRoute {
            conversation_id: row.try_get("conversation_id")?,
            channel_id: row.try_get("channel_id")?,
            route_status: row.try_get("route_status")?,
            connection_status: row.try_get("connection_status")?,
        })
    }

    /// Creates the minimal unverified private conversation for a first direct
    /// provider message. A scoped advisory lock and the route digest make
    /// concurrent/replayed first messages return one canonical channel.
    pub async fn provision_airhop_external_conversation_route(
        &self,
        tenant: &TenantContext,
        input: &ProvisionExternalConversationRouteInput,
    ) -> Result<ProvisionedExternalConversationRoute> {
        if input.connection_id.is_nil()
            || input.provider_chat_id.trim().is_empty()
            || input.provider_chat_id.chars().count() > 300
        {
            return Err(DbError::InvalidData(
                "AirHop external conversation provisioning is invalid".to_owned(),
            ));
        }

        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!(
                "airhop_external_route:{community_id}:{}:{}",
                input.connection_id,
                hex::encode(input.provider_chat_digest)
            ))
            .execute(&mut *tx)
            .await?;

        let existing = sqlx::query(
            "SELECT conversation.id AS conversation_id, conversation.channel_id,
                    route.status AS route_status,
                    connection.status AS connection_status
             FROM airhop_external_conversation_routes route
             JOIN airhop_external_conversations conversation
               ON conversation.community_id = route.community_id
              AND conversation.organization_id = route.organization_id
              AND conversation.id = route.conversation_id
             JOIN airhop_channel_connections connection
               ON connection.community_id = route.community_id
              AND connection.organization_id = route.organization_id
              AND connection.id = route.connection_id
             WHERE route.community_id = $1 AND route.connection_id = $2
               AND route.provider_chat_digest = $3
               AND connection.connector_pubkey = $4
               AND conversation.status = 'active'
               AND route.status <> 'disabled'
               AND connection.status <> 'disabled'",
        )
        .bind(community_id)
        .bind(input.connection_id)
        .bind(input.provider_chat_digest.as_slice())
        .bind(input.connector_pubkey.as_slice())
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(row) = existing {
            let route = resolved_route_from_row(&row)?;
            tx.commit().await?;
            return Ok(ProvisionedExternalConversationRoute {
                route,
                created: false,
            });
        }

        let scope = sqlx::query(
            "SELECT connection.organization_id, connection.provider,
                    connection.display_name, connection.status AS connection_status,
                    deployment.agent_pubkey
             FROM airhop_channel_connections connection
             JOIN airhop_agent_deployments deployment
               ON deployment.community_id = connection.community_id
              AND deployment.organization_id = connection.organization_id
              AND deployment.role = 'parent_administrator'
             WHERE connection.community_id = $1 AND connection.id = $2
               AND connection.connector_pubkey = $3
               AND connection.status = 'active'
             FOR UPDATE OF connection",
        )
        .bind(community_id)
        .bind(input.connection_id)
        .bind(input.connector_pubkey.as_slice())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            DbError::AccessDenied(
                "active AirHop connection and Hermes deployment are required".to_owned(),
            )
        })?;
        let organization_id: Uuid = scope.try_get("organization_id")?;
        let provider: String = scope.try_get("provider")?;
        let display_name: String = scope.try_get("display_name")?;
        let agent_pubkey: Vec<u8> = scope.try_get("agent_pubkey")?;
        if agent_pubkey.len() != 32 {
            return Err(DbError::InvalidData(
                "stored Hermes deployment pubkey is invalid".to_owned(),
            ));
        }

        let channel_id = Uuid::new_v4();
        let conversation_id = Uuid::new_v4();
        let cycle_id = Uuid::new_v4();
        let channel_name = format!("{} · новый контакт", display_name.trim());
        sqlx::query(
            "INSERT INTO channels (
                community_id, id, name, channel_type, visibility, description,
                created_by, nip29_group_id
             ) VALUES ($1, $2, $3, 'stream', 'private', $4, $5, $6)",
        )
        .bind(community_id)
        .bind(channel_id)
        .bind(channel_name)
        .bind(format!("Личный диалог из канала {provider}"))
        .bind(input.connector_pubkey.as_slice())
        .bind(channel_id.to_string())
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO channel_members (
                community_id, channel_id, pubkey, role, invited_by
             )
             SELECT $1, $2, decode(member.pubkey, 'hex'),
                    CASE member.role
                      WHEN 'owner' THEN 'owner'::member_role
                      ELSE 'admin'::member_role
                    END,
                    $3
             FROM relay_members member
             WHERE member.community_id = $1 AND member.role IN ('owner', 'admin')
             ON CONFLICT (community_id, channel_id, pubkey) DO UPDATE
             SET removed_at = NULL, removed_by = NULL",
        )
        .bind(community_id)
        .bind(channel_id)
        .bind(input.connector_pubkey.as_slice())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO channel_members (
                community_id, channel_id, pubkey, role, invited_by
             ) VALUES ($1, $2, $3, 'member', $3)
             ON CONFLICT (community_id, channel_id, pubkey) DO UPDATE
             SET removed_at = NULL, removed_by = NULL",
        )
        .bind(community_id)
        .bind(channel_id)
        .bind(input.connector_pubkey.as_slice())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO channel_members (
                community_id, channel_id, pubkey, role, invited_by
             ) VALUES ($1, $2, $3, 'bot', $4)
             ON CONFLICT (community_id, channel_id, pubkey) DO UPDATE
             SET role = 'bot', removed_at = NULL, removed_by = NULL",
        )
        .bind(community_id)
        .bind(channel_id)
        .bind(agent_pubkey.as_slice())
        .bind(input.connector_pubkey.as_slice())
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO airhop_external_conversations (
                community_id, organization_id, id, channel_id, parent_pubkey,
                current_cycle_id, opened_by_pubkey
             ) VALUES ($1, $2, $3, $4, $5, $6, $5)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(conversation_id)
        .bind(channel_id)
        .bind(input.connector_pubkey.as_slice())
        .bind(cycle_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO airhop_external_conversation_cycles (
                community_id, organization_id, conversation_id, id, sequence, started_by
             ) VALUES ($1, $2, $3, $4, 1, 'registration')",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(conversation_id)
        .bind(cycle_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO airhop_external_conversation_routes (
                community_id, organization_id, conversation_id, connection_id,
                provider_chat_id, provider_chat_digest, status, updated_by_pubkey
             ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(conversation_id)
        .bind(input.connection_id)
        .bind(input.provider_chat_id.trim())
        .bind(input.provider_chat_digest.as_slice())
        .bind(input.connector_pubkey.as_slice())
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(ProvisionedExternalConversationRoute {
            route: ResolvedConversationRoute {
                conversation_id,
                channel_id,
                route_status: "active".to_owned(),
                connection_status: "active".to_owned(),
            },
            created: true,
        })
    }

    /// Leases due external messages to the exact connector configured for them.
    pub async fn claim_airhop_external_messages(
        &self,
        tenant: &TenantContext,
        connector_pubkey: [u8; 32],
        connection_id: Option<Uuid>,
        requested_limit: u16,
        requested_lease_seconds: i64,
    ) -> Result<Vec<ExternalMessageDeliveryJob>> {
        let limit = i64::from(requested_limit.clamp(1, 50));
        let lease_seconds = requested_lease_seconds.clamp(30, 300);
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        // A connector crash is still a real delivery attempt. Close exhausted
        // expired leases before selecting more work so a permanently crashing
        // adapter cannot circulate one message forever without a callback.
        sqlx::query(
            "UPDATE airhop_external_message_outbox outbox
             SET status = 'failed', last_error_code = 'lease_expired',
                 failed_at = now(), lease_token = NULL,
                 leased_by_pubkey = NULL, lease_expires_at = NULL,
                 updated_at = now()
             WHERE outbox.community_id = $1 AND outbox.status = 'leased'
               AND outbox.lease_expires_at < now() AND outbox.attempts >= $3
               AND EXISTS (
                 SELECT 1 FROM airhop_channel_connections connection
                 WHERE connection.community_id = outbox.community_id
                   AND connection.organization_id = outbox.organization_id
                   AND connection.id = outbox.connection_id
                   AND connection.connector_pubkey = $2
                   AND ($4::UUID IS NULL OR connection.id = $4)
               )",
        )
        .bind(community_id)
        .bind(connector_pubkey.as_slice())
        .bind(MAX_EXTERNAL_DELIVERY_ATTEMPTS)
        .bind(connection_id)
        .execute(&mut *tx)
        .await?;
        let rows = sqlx::query(
            "WITH candidates AS (
                SELECT outbox.community_id, outbox.id
                FROM airhop_external_message_outbox outbox
                JOIN airhop_external_conversation_routes route
                  ON route.community_id = outbox.community_id
                 AND route.organization_id = outbox.organization_id
                 AND route.conversation_id = outbox.conversation_id
                 AND route.connection_id = outbox.connection_id
                 AND route.routing_version = outbox.route_version
                JOIN airhop_channel_connections connection
                  ON connection.community_id = route.community_id
                 AND connection.organization_id = route.organization_id
                 AND connection.id = route.connection_id
                WHERE outbox.community_id = $1
                  AND connection.connector_pubkey = $2
                  AND connection.status = 'active' AND route.status = 'active'
                  AND ($6::UUID IS NULL OR outbox.connection_id = $6)
                  AND outbox.next_attempt_at <= now()
                  AND outbox.attempts < $5
                  AND (outbox.status = 'pending'
                    OR (outbox.status = 'leased' AND outbox.lease_expires_at < now()))
                ORDER BY outbox.next_attempt_at, outbox.created_at,
                         outbox.batch_key, outbox.sequence, outbox.id
                FOR UPDATE OF outbox SKIP LOCKED
                LIMIT $3
             ), leased AS (
                UPDATE airhop_external_message_outbox outbox
                SET status = 'leased', lease_token = gen_random_uuid(),
                    leased_by_pubkey = $2,
                    lease_expires_at = now() + ($4::BIGINT * interval '1 second'),
                    attempts = attempts + 1,
                    updated_at = now()
                FROM candidates
                WHERE outbox.community_id = candidates.community_id
                  AND outbox.id = candidates.id
                RETURNING outbox.*
             )
             SELECT leased.id, leased.lease_token, leased.connection_id,
                    connection.provider, route.provider_chat_id,
                    leased.buzz_event_id, leased.event_json, leased.actor_kind,
                    leased.sequence, leased.attempts AS attempt
             FROM leased
             JOIN airhop_external_conversation_routes route
               ON route.community_id = leased.community_id
              AND route.organization_id = leased.organization_id
              AND route.conversation_id = leased.conversation_id
              AND route.connection_id = leased.connection_id
             JOIN airhop_channel_connections connection
               ON connection.community_id = route.community_id
              AND connection.organization_id = route.organization_id
              AND connection.id = route.connection_id
             ORDER BY leased.next_attempt_at, leased.created_at,
                      leased.batch_key, leased.sequence, leased.id",
        )
        .bind(community_id)
        .bind(connector_pubkey.as_slice())
        .bind(limit)
        .bind(lease_seconds)
        .bind(MAX_EXTERNAL_DELIVERY_ATTEMPTS)
        .bind(connection_id)
        .fetch_all(&mut *tx)
        .await?;
        let jobs = rows
            .iter()
            .map(delivery_job_from_row)
            .collect::<Result<Vec<_>>>()?;
        tx.commit().await?;
        Ok(jobs)
    }

    /// Idempotently completes one provider delivery lease.
    pub async fn complete_airhop_external_message(
        &self,
        tenant: &TenantContext,
        connector_pubkey: [u8; 32],
        outbox_id: Uuid,
        lease_token: Uuid,
        completion: &ExternalDeliveryCompletion,
    ) -> Result<ExternalDeliveryAckState> {
        validate_completion(completion)?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;
        let organization_id = active_organization(&mut tx, community_id).await?;
        if let Some(row) = sqlx::query(
            "SELECT outcome FROM airhop_external_message_delivery_attempts
             WHERE community_id = $1 AND organization_id = $2
               AND outbox_id = $3 AND lease_token = $4",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(outbox_id)
        .bind(lease_token)
        .fetch_optional(&mut *tx)
        .await?
        {
            let state = delivery_state_from_outcome(row.try_get("outcome")?);
            tx.commit().await?;
            return state;
        }
        let row = sqlx::query(
            "SELECT outbox.attempts, outbox.status, outbox.lease_token,
                    outbox.leased_by_pubkey
             FROM airhop_external_message_outbox outbox
             JOIN airhop_channel_connections connection
               ON connection.community_id = outbox.community_id
              AND connection.organization_id = outbox.organization_id
              AND connection.id = outbox.connection_id
             WHERE outbox.community_id = $1 AND outbox.organization_id = $2
               AND outbox.id = $3 AND connection.connector_pubkey = $4
             FOR UPDATE OF outbox",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(outbox_id)
        .bind(connector_pubkey.as_slice())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("AirHop external delivery lease".to_owned()))?;
        let status: String = row.try_get("status")?;
        let stored_lease: Option<Uuid> = row.try_get("lease_token")?;
        let stored_connector: Option<Vec<u8>> = row.try_get("leased_by_pubkey")?;
        if status != "leased"
            || stored_lease != Some(lease_token)
            || stored_connector.as_deref() != Some(connector_pubkey.as_slice())
        {
            return Err(DbError::AccessDenied(
                "AirHop external delivery lease belongs to another attempt".to_owned(),
            ));
        }
        let attempt: i32 = row.try_get("attempts")?;
        let (outcome, error_code, provider_message_id, state) = match completion {
            ExternalDeliveryCompletion::Delivered {
                provider_message_id,
            } => (
                "delivered",
                None,
                provider_message_id.as_deref(),
                ExternalDeliveryAckState::Delivered,
            ),
            ExternalDeliveryCompletion::Failed {
                error_code,
                retryable,
                ..
            } if !retryable || attempt >= MAX_EXTERNAL_DELIVERY_ATTEMPTS => (
                "failed",
                Some(error_code.as_str()),
                None,
                ExternalDeliveryAckState::Failed,
            ),
            ExternalDeliveryCompletion::Failed { error_code, .. } => (
                "retry",
                Some(error_code.as_str()),
                None,
                ExternalDeliveryAckState::RetryScheduled,
            ),
        };
        sqlx::query(
            "INSERT INTO airhop_external_message_delivery_attempts (
                community_id, organization_id, outbox_id, lease_token,
                connector_pubkey, outcome, provider_message_id, error_code
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(outbox_id)
        .bind(lease_token)
        .bind(connector_pubkey.as_slice())
        .bind(outcome)
        .bind(provider_message_id)
        .bind(error_code)
        .execute(&mut *tx)
        .await?;
        match completion {
            ExternalDeliveryCompletion::Delivered {
                provider_message_id,
            } => {
                sqlx::query(
                    "UPDATE airhop_external_message_outbox
                     SET status = 'delivered', attempts = $4,
                         provider_message_id = $5, last_error_code = NULL,
                         delivered_at = now(), lease_token = NULL,
                         leased_by_pubkey = NULL, lease_expires_at = NULL,
                         updated_at = now()
                     WHERE community_id = $1 AND organization_id = $2 AND id = $3",
                )
                .bind(community_id)
                .bind(organization_id)
                .bind(outbox_id)
                .bind(attempt)
                .bind(provider_message_id.as_deref())
                .execute(&mut *tx)
                .await?;
            }
            ExternalDeliveryCompletion::Failed {
                error_code,
                retry_after_seconds,
                retryable,
            } if *retryable && attempt < MAX_EXTERNAL_DELIVERY_ATTEMPTS => {
                sqlx::query(
                    "UPDATE airhop_external_message_outbox
                     SET status = 'pending', attempts = $4, last_error_code = $5,
                         next_attempt_at = now() + ($6::BIGINT * interval '1 second'),
                         lease_token = NULL, leased_by_pubkey = NULL,
                         lease_expires_at = NULL, updated_at = now()
                     WHERE community_id = $1 AND organization_id = $2 AND id = $3",
                )
                .bind(community_id)
                .bind(organization_id)
                .bind(outbox_id)
                .bind(attempt)
                .bind(error_code)
                .bind((*retry_after_seconds).clamp(5, 3_600))
                .execute(&mut *tx)
                .await?;
            }
            ExternalDeliveryCompletion::Failed { error_code, .. } => {
                sqlx::query(
                    "UPDATE airhop_external_message_outbox
                     SET status = 'failed', attempts = $4, last_error_code = $5,
                         failed_at = now(), lease_token = NULL,
                         leased_by_pubkey = NULL, lease_expires_at = NULL,
                         updated_at = now()
                     WHERE community_id = $1 AND organization_id = $2 AND id = $3",
                )
                .bind(community_id)
                .bind(organization_id)
                .bind(outbox_id)
                .bind(attempt)
                .bind(error_code)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
        Ok(state)
    }

    /// Returns due committed Hermes intents for crash recovery across tenants.
    pub async fn prepare_airhop_hermes_publication_recovery(
        &self,
        requested_limit: i64,
    ) -> Result<Vec<PendingHermesPublication>> {
        let rows = sqlx::query(
            "SELECT intent.event_json, deployment.agent_pubkey,
                    community.id AS community_id, community.host
             FROM airhop_hermes_outbound_intents intent
             JOIN airhop_agent_deployments deployment
               ON deployment.community_id = intent.community_id
              AND deployment.organization_id = intent.organization_id
              AND deployment.id = intent.deployment_id
             JOIN communities community ON community.id = intent.community_id
             WHERE intent.status = 'committed'
               AND intent.next_publication_attempt_at <= now()
             ORDER BY intent.next_publication_attempt_at, intent.committed_at, intent.id
             LIMIT $1",
        )
        .bind(requested_limit.clamp(1, 200))
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                let event_json: Value = row.try_get("event_json")?;
                let agent_pubkey: Vec<u8> = row.try_get("agent_pubkey")?;
                let agent_pubkey = agent_pubkey.try_into().map_err(|_| {
                    DbError::InvalidData("stored Hermes deployment pubkey is invalid".to_owned())
                })?;
                Ok(PendingHermesPublication {
                    community_id: CommunityId::from_uuid(row.try_get("community_id")?),
                    host: row.try_get("host")?,
                    event: serde_json::from_value(event_json)?,
                    agent_pubkey,
                })
            })
            .collect()
    }

    /// Records a bounded backoff after one failed internal Buzz publication.
    pub async fn record_airhop_hermes_publication_failure(
        &self,
        community_id: CommunityId,
        event_id: [u8; 32],
        error_code: &str,
    ) -> Result<()> {
        if error_code.trim().is_empty() || error_code.len() > 120 {
            return Err(DbError::InvalidData(
                "Hermes publication failure code is invalid".to_owned(),
            ));
        }
        sqlx::query(
            "UPDATE airhop_hermes_outbound_intents
             SET publication_attempts = publication_attempts + 1,
                 status = CASE
                   WHEN publication_attempts + 1 >= $4 THEN 'failed'
                   ELSE status
                 END,
                 failure_code = CASE
                   WHEN publication_attempts + 1 >= $4 THEN $3
                   ELSE failure_code
                 END,
                 last_publication_error_code = $3,
                 next_publication_attempt_at = now() +
                   (LEAST(300, (1::BIGINT << LEAST(8, publication_attempts))) * interval '1 second'),
                 updated_at = now()
             WHERE community_id = $1 AND event_id = $2 AND status = 'committed'",
        )
        .bind(community_id.as_uuid())
        .bind(event_id.as_slice())
        .bind(error_code.trim())
        .bind(MAX_HERMES_PUBLICATION_ATTEMPTS)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

async fn active_organization(
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
    .ok_or_else(|| DbError::NotFound("active AirHub organization".to_owned()))
}

async fn require_owner_or_admin(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    pubkey: [u8; 32],
) -> Result<()> {
    let allowed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM relay_members
         WHERE community_id = $1 AND pubkey = $2 AND role IN ('owner', 'admin'))",
    )
    .bind(community_id)
    .bind(hex::encode(pubkey))
    .fetch_one(&mut **tx)
    .await?;
    if allowed {
        Ok(())
    } else {
        Err(DbError::AccessDenied(
            "AirHop channel gateway requires an owner/admin connector".to_owned(),
        ))
    }
}

async fn require_staff_member(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    pubkey: [u8; 32],
) -> Result<()> {
    let allowed: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM relay_members
           WHERE community_id = $1 AND pubkey = $2
             AND role IN ('owner', 'admin', 'member'))",
    )
    .bind(community_id)
    .bind(hex::encode(pubkey))
    .fetch_one(&mut **transaction)
    .await?;
    if allowed {
        Ok(())
    } else {
        Err(DbError::AccessDenied(
            "active AirHop staff membership is required".to_owned(),
        ))
    }
}

fn validate_connection(input: &PutChannelConnectionInput) -> Result<()> {
    let provider = input.provider.trim();
    if input.connection_id.is_nil()
        || !matches!(provider, "telegram" | "whatsapp_cloud")
        || input.display_name.trim().is_empty()
        || input.display_name.chars().count() > 160
        || !matches!(input.status.trim(), "active" | "paused" | "disabled")
        || !input.capabilities.is_object()
        || input.expected_version < 0
    {
        return Err(DbError::InvalidData(
            "AirHop channel connection is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_provisioning(input: &ProvisionChannelConnectionInput) -> Result<()> {
    if input.connection.provider.trim() != "telegram"
        || !(17..=512).contains(&input.credential_ciphertext.len())
        || input.credential_key_version <= 0
        || input.provider_bot_id.trim().is_empty()
        || input.provider_bot_id.chars().count() > 64
        || input
            .provider_bot_username
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 160)
    {
        return Err(DbError::InvalidData(
            "AirHop channel credential is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_route(input: &PutConversationRouteInput) -> Result<()> {
    if input.conversation_id.is_nil()
        || input.connection_id.is_nil()
        || input.provider_chat_id.trim().is_empty()
        || input.provider_chat_id.chars().count() > 300
        || !matches!(input.status.trim(), "active" | "paused" | "disabled")
        || input.expected_version < 0
    {
        return Err(DbError::InvalidData(
            "AirHop external conversation route is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_observation(input: &ObserveChannelConnectionInput) -> Result<()> {
    let error_is_valid = input
        .error_code
        .as_ref()
        .is_none_or(|value| is_error_code(value));
    if input.connection_id.is_nil()
        || !matches!(
            input.observed_status.trim(),
            "offline" | "connecting" | "ready" | "degraded"
        )
        || !input.observed_capabilities.is_object()
        || !error_is_valid
        || (input.observed_status.trim() == "degraded" && input.error_code.is_none())
        || (input.observed_status.trim() != "degraded" && input.error_code.is_some())
    {
        return Err(DbError::InvalidData(
            "AirHop channel connection observation is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_completion(completion: &ExternalDeliveryCompletion) -> Result<()> {
    match completion {
        ExternalDeliveryCompletion::Delivered {
            provider_message_id,
        } if provider_message_id
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 300) =>
        {
            Err(DbError::InvalidData(
                "provider message id is invalid".to_owned(),
            ))
        }
        ExternalDeliveryCompletion::Failed {
            error_code,
            retry_after_seconds,
            retryable,
        } if !is_error_code(error_code)
            || (*retryable && !(5..=3600).contains(retry_after_seconds)) =>
        {
            Err(DbError::InvalidData(
                "provider delivery failure is invalid".to_owned(),
            ))
        }
        _ => Ok(()),
    }
}

fn is_error_code(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 120
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-' | b'.')
        })
}

fn connection_from_row(row: &sqlx::postgres::PgRow) -> Result<ChannelConnection> {
    let connector_pubkey: Vec<u8> = row.try_get("connector_pubkey")?;
    let connector_pubkey = connector_pubkey.try_into().map_err(|_| {
        DbError::InvalidData("stored channel connector pubkey is invalid".to_owned())
    })?;
    Ok(ChannelConnection {
        organization_id: row.try_get("organization_id")?,
        id: row.try_get("id")?,
        provider: row.try_get("provider")?,
        display_name: row.try_get("display_name")?,
        connector_pubkey,
        status: row.try_get("status")?,
        hermes_enabled: row.try_get("hermes_enabled")?,
        capabilities: row.try_get("capabilities")?,
        observed_status: row.try_get("observed_status")?,
        observed_capabilities: row.try_get("observed_capabilities")?,
        last_heartbeat_at: row.try_get("last_heartbeat_at")?,
        last_error_code: row.try_get("last_error_code")?,
        version: row.try_get("version")?,
    })
}

fn route_from_row(row: &sqlx::postgres::PgRow) -> Result<ConversationRoute> {
    Ok(ConversationRoute {
        conversation_id: row.try_get("conversation_id")?,
        connection_id: row.try_get("connection_id")?,
        status: row.try_get("status")?,
        version: row.try_get("version")?,
        routing_version: row.try_get("routing_version")?,
    })
}

fn resolved_route_from_row(row: &sqlx::postgres::PgRow) -> Result<ResolvedConversationRoute> {
    Ok(ResolvedConversationRoute {
        conversation_id: row.try_get("conversation_id")?,
        channel_id: row.try_get("channel_id")?,
        route_status: row.try_get("route_status")?,
        connection_status: row.try_get("connection_status")?,
    })
}

fn delivery_job_from_row(row: &sqlx::postgres::PgRow) -> Result<ExternalMessageDeliveryJob> {
    let event_json: Value = row.try_get("event_json")?;
    let buzz_event_id: Vec<u8> = row.try_get("buzz_event_id")?;
    let buzz_event_id = buzz_event_id
        .try_into()
        .map_err(|_| DbError::InvalidData("stored external Buzz event id is invalid".to_owned()))?;
    Ok(ExternalMessageDeliveryJob {
        outbox_id: row.try_get("id")?,
        lease_token: row.try_get("lease_token")?,
        connection_id: row.try_get("connection_id")?,
        provider: row.try_get("provider")?,
        provider_chat_id: row.try_get("provider_chat_id")?,
        buzz_event_id,
        event: serde_json::from_value(event_json)?,
        actor_kind: row.try_get("actor_kind")?,
        sequence: row.try_get("sequence")?,
        attempt: row.try_get("attempt")?,
    })
}

fn delivery_state_from_outcome(outcome: &str) -> Result<ExternalDeliveryAckState> {
    match outcome {
        "delivered" => Ok(ExternalDeliveryAckState::Delivered),
        "retry" => Ok(ExternalDeliveryAckState::RetryScheduled),
        "failed" => Ok(ExternalDeliveryAckState::Failed),
        other => Err(DbError::InvalidData(format!(
            "unknown external delivery outcome: {other}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn connection() -> PutChannelConnectionInput {
        PutChannelConnectionInput {
            connection_id: Uuid::new_v4(),
            provider: "telegram".to_owned(),
            display_name: "Telegram центра".to_owned(),
            connector_pubkey: [1; 32],
            status: "active".to_owned(),
            hermes_enabled: true,
            capabilities: json!({"typing": true, "media": ["voice"]}),
            expected_version: 0,
            updated_by_pubkey: [2; 32],
        }
    }

    #[test]
    fn first_release_accepts_only_official_provider_ids() {
        assert!(validate_connection(&connection()).is_ok());
        let mut whatsapp = connection();
        whatsapp.provider = "whatsapp_cloud".to_owned();
        assert!(validate_connection(&whatsapp).is_ok());
        let mut unofficial = connection();
        unofficial.provider = "whatsapp".to_owned();
        assert!(validate_connection(&unofficial).is_err());
    }

    #[test]
    fn encrypted_telegram_provisioning_is_bounded() {
        let mut input = ProvisionChannelConnectionInput {
            connection: connection(),
            credential_ciphertext: vec![7; 64],
            credential_nonce: [8; 12],
            credential_key_version: 1,
            credential_fingerprint: [9; 32],
            provider_bot_id: "123456789".to_owned(),
            provider_bot_username: Some("airhop_bot".to_owned()),
        };
        assert!(validate_provisioning(&input).is_ok());
        input.credential_ciphertext.clear();
        assert!(validate_provisioning(&input).is_err());
    }

    #[test]
    fn delivery_completion_is_closed_and_bounded() {
        assert!(validate_completion(&ExternalDeliveryCompletion::Delivered {
            provider_message_id: Some("wamid.1".to_owned()),
        })
        .is_ok());
        assert!(validate_completion(&ExternalDeliveryCompletion::Failed {
            error_code: "provider_timeout".to_owned(),
            retry_after_seconds: 15,
            retryable: true,
        })
        .is_ok());
        assert!(validate_completion(&ExternalDeliveryCompletion::Failed {
            error_code: String::new(),
            retry_after_seconds: 15,
            retryable: true,
        })
        .is_err());
        assert!(validate_completion(&ExternalDeliveryCompletion::Failed {
            error_code: "provider_forbidden".to_owned(),
            retry_after_seconds: 0,
            retryable: false,
        })
        .is_ok());
    }

    #[test]
    fn connection_observation_is_closed_and_non_secret() {
        let ready = ObserveChannelConnectionInput {
            connection_id: Uuid::new_v4(),
            observed_status: "ready".to_owned(),
            observed_capabilities: json!({"typing": true}),
            error_code: None,
            connector_pubkey: [3; 32],
        };
        assert!(validate_observation(&ready).is_ok());
        let degraded = ObserveChannelConnectionInput {
            observed_status: "degraded".to_owned(),
            error_code: Some("provider_rate_limited".to_owned()),
            ..ready.clone()
        };
        assert!(validate_observation(&degraded).is_ok());
        let leaking = ObserveChannelConnectionInput {
            observed_status: "ready".to_owned(),
            error_code: Some("token=secret".to_owned()),
            ..ready
        };
        assert!(validate_observation(&leaking).is_err());
    }
}
