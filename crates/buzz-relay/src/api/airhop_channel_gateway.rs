//! Authenticated provider-neutral bridge for Hermes messaging adapters.

use std::sync::Arc;

use aes_gcm::aead::{Aead, KeyInit as AeadKeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::header::{CACHE_CONTROL, PRAGMA};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::Json;
use hmac::digest::KeyInit as HmacKeyInit;
use hmac::{Hmac, Mac};
use nostr::{Event, PublicKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use buzz_db::airhop::channel_gateway::{
    ChannelConnection, ExternalDeliveryAckState, ExternalDeliveryCompletion,
    ObserveChannelConnectionInput, ProvisionChannelConnectionInput,
    ProvisionExternalConversationRouteInput, PutChannelConnectionInput, PutConversationRouteInput,
};

use crate::handlers::ingest::{IngestAuth, IngestError};
use crate::state::AppState;

use super::airhop_auth::authenticate_airhop;
use super::{api_error, internal_error};

const CONNECTION_PREFIX: &str = "/api/airhop/integrations/v1/channel-connections";
const GATEWAY_PREFIX: &str = "/api/airhop/integrations/v1/channel-gateway";
const TELEGRAM_CONNECTION_PATH: &str = "/api/airhop/integrations/v1/channel-connections/telegram";
const WHATSAPP_CONNECTION_PATH: &str =
    "/api/airhop/integrations/v1/channel-connections/whatsapp-cloud";
const GATEWAY_ASSIGNMENTS_PATH: &str = "/api/airhop/integrations/v1/channel-gateway/assignments";
const TELEGRAM_API_ORIGIN: &str = "https://api.telegram.org";
const META_GRAPH_ORIGIN: &str = "https://graph.facebook.com/v26.0";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PutConnectionBody {
    routing: Option<buzz_db::airhop::channel_gateway::ConnectionRouting>,
    provider: String,
    display_name: String,
    connector_pubkey: String,
    #[serde(default = "default_active")]
    status: String,
    #[serde(default = "default_true")]
    hermes_enabled: bool,
    #[serde(default = "empty_object")]
    capabilities: Value,
    expected_version: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConnectTelegramBody {
    routing: Option<buzz_db::airhop::channel_gateway::ConnectionRouting>,
    token: String,
    #[serde(default = "default_true")]
    hermes_enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConnectWhatsAppBody {
    routing: Option<buzz_db::airhop::channel_gateway::ConnectionRouting>,
    app_id: String,
    app_secret: String,
    waba_id: String,
    phone_number_id: String,
    access_token: String,
    #[serde(default = "default_true")]
    hermes_enabled: bool,
}

impl Drop for ConnectWhatsAppBody {
    fn drop(&mut self) {
        self.app_secret.zeroize();
        self.access_token.zeroize();
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ActivateWhatsAppBody {}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WhatsAppCredentialEnvelope<'a> {
    schema_version: &'static str,
    app_id: &'a str,
    app_secret: &'a str,
    waba_id: &'a str,
    phone_number_id: &'a str,
    access_token: &'a str,
    verify_token: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredWhatsAppCredential {
    schema_version: String,
    app_id: String,
    app_secret: String,
    waba_id: String,
    phone_number_id: String,
    access_token: String,
    verify_token: String,
}

impl Drop for StoredWhatsAppCredential {
    fn drop(&mut self) {
        self.app_secret.zeroize();
        self.access_token.zeroize();
        self.verify_token.zeroize();
    }
}

#[derive(Debug, Deserialize)]
struct MetaPhoneList {
    #[serde(default)]
    data: Vec<MetaPhoneIdentity>,
}

#[derive(Debug, Deserialize)]
struct MetaPhoneIdentity {
    id: String,
    display_phone_number: Option<String>,
    verified_name: Option<String>,
    quality_rating: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MetaSuccess {
    success: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct TelegramApiEnvelope {
    ok: bool,
    result: Option<TelegramBotIdentity>,
}

#[derive(Debug, Deserialize)]
struct TelegramBotIdentity {
    id: i64,
    is_bot: bool,
    first_name: String,
    username: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PutConversationRouteBody {
    connection_id: Uuid,
    provider_chat_id: String,
    #[serde(default = "default_active")]
    status: String,
    expected_version: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ResolveConversationRouteBody {
    connection_id: Uuid,
    provider_chat_id: String,
    handoff_token_digest: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GatewayInboundBody {
    connection_id: Uuid,
    provider_event_id: String,
    event: Event,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaimExternalMessagesBody {
    connection_id: Option<Uuid>,
    #[serde(default = "default_claim_limit")]
    limit: u16,
    #[serde(default = "default_lease_seconds")]
    lease_seconds: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ObserveConnectionBody {
    observed_status: String,
    #[serde(default = "empty_object")]
    observed_capabilities: Value,
    error_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CompleteExternalMessageBody {
    Delivered {
        #[serde(rename = "leaseToken")]
        lease_token: Uuid,
        #[serde(rename = "providerMessageId")]
        provider_message_id: Option<String>,
    },
    Failed {
        #[serde(rename = "leaseToken")]
        lease_token: Uuid,
        #[serde(rename = "errorCode")]
        error_code: String,
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: i64,
        #[serde(default = "default_true")]
        retryable: bool,
    },
}

fn default_active() -> String {
    "active".to_owned()
}

const fn default_true() -> bool {
    true
}

fn empty_object() -> Value {
    json!({})
}

const fn default_claim_limit() -> u16 {
    25
}

const fn default_lease_seconds() -> i64 {
    90
}

/// Lists desired and observed channel state without provider credentials.
pub(crate) async fn list_connections(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let principal = super::airhop_auth::authenticate_airhop_agent(
        &state,
        &headers,
        "GET",
        CONNECTION_PREFIX,
        None,
    )
    .await?;
    if principal.member_role == "agent" {
        super::airhop_staff::authorize_registered_agent_read(
            &state,
            &principal.tenant,
            &principal.pubkey,
            CONNECTION_PREFIX,
        )
        .await?;
    }
    let connections = state
        .db
        .list_airhop_channel_connections(&principal.tenant, principal.pubkey.to_bytes())
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "schemaVersion": "airhop.channel-connections.v1",
        "connections": connections.iter().map(connection_json).collect::<Vec<_>>(),
        "provisioning": {
            "telegram": {
                "available": state.config.airhop_channel_gateway.is_some(),
            },
            "whatsappCloud": {
                "available": state.config.airhop_channel_gateway.as_ref()
                    .and_then(|gateway| gateway.whatsapp_webhook_base_url())
                    .is_some(),
            },
        },
    })))
}

/// Verifies a BotFather token, encrypts it, and atomically creates Telegram.
pub(crate) async fn connect_telegram(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let principal = authenticate_airhop(
        &state,
        &headers,
        "POST",
        TELEGRAM_CONNECTION_PATH,
        Some(&body),
    )
    .await?;
    require_owner_or_admin(&principal.member_role)?;
    let request: ConnectTelegramBody = parse_body(&body, "invalid Telegram connection JSON")?;
    let token = Zeroizing::new(request.token.trim().to_owned());
    if !valid_telegram_token_shape(&token) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid Telegram bot token",
        ));
    }
    let gateway = state
        .config
        .airhop_channel_gateway
        .as_ref()
        .ok_or_else(|| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Telegram self-service is not configured",
            )
        })?;
    let bot = verify_telegram_bot(TELEGRAM_API_ORIGIN, &token).await?;
    let connection_id = Uuid::new_v4();
    let provider = "telegram";
    let aad = credential_aad(
        *principal.tenant.community().as_uuid(),
        connection_id,
        provider,
    );
    let key_version = gateway.current_credential_key_version();
    let key = gateway
        .credential_key(key_version)
        .ok_or_else(|| internal_error("current AirHop channel credential key is unavailable"))?;
    let nonce: [u8; 12] = rand::random();
    let ciphertext = encrypt_credential(key, &nonce, aad.as_bytes(), token.as_bytes())?;
    let fingerprint = credential_fingerprint(gateway.credential_index_key(), provider, &token)?;
    let username = bot
        .username
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let display_name = username
        .map(|value| format!("@{value}"))
        .unwrap_or_else(|| bot.first_name.trim().to_owned());
    let connection = state
        .db
        .provision_airhop_channel_connection(
            &principal.tenant,
            &ProvisionChannelConnectionInput {
                connection: PutChannelConnectionInput {
                    routing: request.routing,
                    connection_id,
                    provider: provider.to_owned(),
                    display_name,
                    connector_pubkey: gateway.telegram_connector_pubkey(),
                    status: "active".to_owned(),
                    hermes_enabled: request.hermes_enabled,
                    capabilities: json!({"commands": true, "locations": true, "text": true}),
                    expected_version: 0,
                    updated_by_pubkey: principal.pubkey.to_bytes(),
                },
                credential_ciphertext: ciphertext,
                credential_nonce: nonce,
                credential_key_version: key_version,
                credential_fingerprint: fingerprint,
                provider_bot_id: bot.id.to_string(),
                provider_bot_username: username.map(str::to_owned),
            },
        )
        .await
        .map_err(map_db_error)?;
    notify_connection_channel(
        &state,
        &principal.tenant,
        &connection,
        &principal.pubkey.to_bytes(),
    )
    .await;
    Ok(Json(json!({
        "schemaVersion": "airhop.telegram-connection.v1",
        "connection": connection_json(&connection),
        "bot": {
            "id": bot.id.to_string(),
            "firstName": bot.first_name,
            "username": bot.username,
        },
    })))
}

/// Verifies and encrypts credentials for a center-owned Meta application.
pub(crate) async fn connect_whatsapp_cloud(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(HeaderMap, Json<Value>), (StatusCode, Json<Value>)> {
    let principal = authenticate_airhop(
        &state,
        &headers,
        "POST",
        WHATSAPP_CONNECTION_PATH,
        Some(&body),
    )
    .await?;
    require_owner_or_admin(&principal.member_role)?;
    let mut request: ConnectWhatsAppBody =
        parse_body(&body, "invalid WhatsApp Cloud connection JSON")?;
    let routing = request.routing.take();
    let app_id = std::mem::take(&mut request.app_id).trim().to_owned();
    let app_secret = Zeroizing::new(std::mem::take(&mut request.app_secret).trim().to_owned());
    let waba_id = std::mem::take(&mut request.waba_id).trim().to_owned();
    let phone_number_id = std::mem::take(&mut request.phone_number_id)
        .trim()
        .to_owned();
    let access_token = Zeroizing::new(std::mem::take(&mut request.access_token).trim().to_owned());
    let hermes_enabled = request.hermes_enabled;
    if !valid_meta_id(&app_id)
        || !valid_meta_id(&waba_id)
        || !valid_meta_id(&phone_number_id)
        || !valid_meta_app_secret(&app_secret)
        || !valid_meta_access_token(&access_token)
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid WhatsApp Cloud credentials",
        ));
    }
    let gateway = state
        .config
        .airhop_channel_gateway
        .as_ref()
        .ok_or_else(|| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "WhatsApp Cloud self-service is not configured",
            )
        })?;
    let webhook_base_url = gateway.whatsapp_webhook_base_url().ok_or_else(|| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "WhatsApp Cloud self-service is not configured",
        )
    })?;
    let phone =
        verify_whatsapp_phone(META_GRAPH_ORIGIN, &waba_id, &phone_number_id, &access_token).await?;
    let display_phone_number = phone
        .display_phone_number
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            api_error(
                StatusCode::BAD_GATEWAY,
                "Meta did not return the WhatsApp display phone number",
            )
        })?
        .to_owned();
    let verified_name = phone
        .verified_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().count() <= 160)
        .map(str::to_owned);
    let display_name = verified_name
        .clone()
        .unwrap_or_else(|| display_phone_number.clone());
    let connection_id = Uuid::new_v4();
    let callback_url = format!("{webhook_base_url}/{connection_id}");
    let verify_token = Zeroizing::new(hex::encode(rand::random::<[u8; 32]>()));
    let credential = Zeroizing::new(
        serde_json::to_vec(&WhatsAppCredentialEnvelope {
            schema_version: "airhop.whatsapp-cloud-credential.v1",
            app_id: &app_id,
            app_secret: &app_secret,
            waba_id: &waba_id,
            phone_number_id: &phone_number_id,
            access_token: &access_token,
            verify_token: &verify_token,
        })
        .map_err(|_| internal_error("WhatsApp credential serialization failed"))?,
    );
    let provider = "whatsapp_cloud";
    let aad = credential_aad(
        *principal.tenant.community().as_uuid(),
        connection_id,
        provider,
    );
    let key_version = gateway.current_credential_key_version();
    let key = gateway
        .credential_key(key_version)
        .ok_or_else(|| internal_error("current AirHop channel credential key is unavailable"))?;
    let nonce: [u8; 12] = rand::random();
    let ciphertext = encrypt_credential(key, &nonce, aad.as_bytes(), &credential)?;
    // Meta configures the callback at app level. Fence one connection per
    // customer-owned app in this first release, while the DB's provider
    // identity constraint separately prevents reconnecting the same phone.
    let identity = format!("app:{app_id}");
    let fingerprint = credential_fingerprint(gateway.credential_index_key(), provider, &identity)?;
    let connection = state
        .db
        .provision_airhop_channel_connection(
            &principal.tenant,
            &ProvisionChannelConnectionInput {
                connection: PutChannelConnectionInput {
                    routing,
                    connection_id,
                    provider: provider.to_owned(),
                    display_name,
                    connector_pubkey: gateway.telegram_connector_pubkey(),
                    status: "active".to_owned(),
                    hermes_enabled,
                    capabilities: json!({
                        "setupMode": "customer_meta_app",
                        "text": true,
                        "templates": false,
                        "appId": app_id,
                        "wabaId": waba_id,
                        "phoneNumberId": phone_number_id,
                        "displayPhoneNumber": display_phone_number,
                        "qualityRating": phone.quality_rating,
                        "webhookCallbackUrl": callback_url,
                    }),
                    expected_version: 0,
                    updated_by_pubkey: principal.pubkey.to_bytes(),
                },
                credential_ciphertext: ciphertext,
                credential_nonce: nonce,
                credential_key_version: key_version,
                credential_fingerprint: fingerprint,
                provider_bot_id: phone_number_id.clone(),
                provider_bot_username: Some(display_phone_number.clone()),
            },
        )
        .await
        .map_err(map_db_error)?;
    notify_connection_channel(
        &state,
        &principal.tenant,
        &connection,
        &principal.pubkey.to_bytes(),
    )
    .await;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response_headers.insert(PRAGMA, HeaderValue::from_static("no-cache"));
    Ok((
        response_headers,
        Json(json!({
            "schemaVersion": "airhop.whatsapp-cloud-connection.v1",
            "connection": connection_json(&connection),
            "meta": {
                "appId": app_id,
                "wabaId": waba_id,
                "phoneNumberId": phone_number_id,
                "displayPhoneNumber": display_phone_number,
                "verifiedName": verified_name,
                "qualityRating": phone.quality_rating,
            },
            "webhook": {
                "callbackUrl": callback_url,
                "verifyToken": verify_token.as_str(),
                "field": "messages",
            },
        })),
    ))
}

/// Subscribes the center-owned Meta application after callback verification.
pub(crate) async fn activate_whatsapp_cloud(
    State(state): State<Arc<AppState>>,
    Path(connection_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{CONNECTION_PREFIX}/{connection_id}/whatsapp-cloud/activate");
    let principal = authenticate_airhop(&state, &headers, "POST", &path, Some(&body)).await?;
    require_owner_or_admin(&principal.member_role)?;
    let _: ActivateWhatsAppBody = parse_body(&body, "invalid WhatsApp activation JSON")?;
    let gateway = state
        .config
        .airhop_channel_gateway
        .as_ref()
        .filter(|gateway| gateway.whatsapp_webhook_base_url().is_some())
        .ok_or_else(|| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "WhatsApp Cloud self-service is not configured",
            )
        })?;
    let encrypted = state
        .db
        .get_airhop_channel_credential_for_connector(
            &principal.tenant,
            connection_id,
            gateway.telegram_connector_pubkey(),
        )
        .await
        .map_err(map_db_error)?;
    if encrypted.provider != "whatsapp_cloud" {
        return Err(api_error(
            StatusCode::CONFLICT,
            "channel connection is not WhatsApp Cloud",
        ));
    }
    let key = gateway
        .credential_key(encrypted.key_version)
        .ok_or_else(|| internal_error("AirHop channel credential key is unavailable"))?;
    let aad = credential_aad(
        *principal.tenant.community().as_uuid(),
        encrypted.connection_id,
        &encrypted.provider,
    );
    let plaintext =
        decrypt_credential(key, &encrypted.nonce, aad.as_bytes(), &encrypted.ciphertext)?;
    let credential: StoredWhatsAppCredential = serde_json::from_slice(&plaintext)
        .map_err(|_| internal_error("stored WhatsApp credential is invalid"))?;
    if credential.schema_version != "airhop.whatsapp-cloud-credential.v1"
        || !valid_meta_id(&credential.app_id)
        || !valid_meta_id(&credential.waba_id)
        || !valid_meta_id(&credential.phone_number_id)
        || !valid_meta_app_secret(&credential.app_secret)
        || !valid_meta_access_token(&credential.access_token)
        || credential.verify_token.len() != 64
    {
        return Err(internal_error("stored WhatsApp credential is invalid"));
    }
    subscribe_whatsapp_app(
        META_GRAPH_ORIGIN,
        &credential.waba_id,
        &credential.access_token,
    )
    .await?;
    Ok(Json(json!({
        "schemaVersion": "airhop.whatsapp-cloud-activation.v1",
        "connectionId": connection_id,
        "subscribed": true,
        "status": "connecting",
    })))
}

/// Lists self-service assignments for the exact hosted gateway principal.
pub(crate) async fn list_gateway_assignments(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let principal =
        authenticate_airhop(&state, &headers, "GET", GATEWAY_ASSIGNMENTS_PATH, None).await?;
    require_gateway_principal(&state, principal.pubkey.to_bytes())?;
    let assignments = state
        .db
        .list_airhop_channel_gateway_assignments(&principal.tenant, principal.pubkey.to_bytes())
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "schemaVersion": "airhop.channel-gateway.assignments.v1",
        "assignments": assignments,
    })))
}

/// Decrypts one token only for the exact connector bound to the connection.
pub(crate) async fn get_gateway_credential(
    State(state): State<Arc<AppState>>,
    Path(connection_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<Value>), (StatusCode, Json<Value>)> {
    let path = format!("{GATEWAY_PREFIX}/connections/{connection_id}/credential");
    let principal = authenticate_airhop(&state, &headers, "GET", &path, None).await?;
    let gateway = require_gateway_principal(&state, principal.pubkey.to_bytes())?;
    let encrypted = state
        .db
        .get_airhop_channel_credential_for_connector(
            &principal.tenant,
            connection_id,
            principal.pubkey.to_bytes(),
        )
        .await
        .map_err(map_db_error)?;
    let key = gateway
        .credential_key(encrypted.key_version)
        .ok_or_else(|| internal_error("AirHop channel credential key is unavailable"))?;
    let aad = credential_aad(
        *principal.tenant.community().as_uuid(),
        encrypted.connection_id,
        &encrypted.provider,
    );
    let plaintext =
        decrypt_credential(key, &encrypted.nonce, aad.as_bytes(), &encrypted.ciphertext)?;
    let token = Zeroizing::new(
        String::from_utf8(plaintext.to_vec())
            .map_err(|_| internal_error("stored AirHop channel credential is invalid"))?,
    );
    let mut response_headers = HeaderMap::new();
    response_headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response_headers.insert(PRAGMA, HeaderValue::from_static("no-cache"));
    Ok((
        response_headers,
        Json(json!({
            "schemaVersion": "airhop.channel-gateway.credential.v1",
            "connectionId": encrypted.connection_id,
            "provider": encrypted.provider,
            "token": token.as_str(),
        })),
    ))
}

/// Creates or updates connection desired state without accepting provider secrets.
pub(crate) async fn put_connection(
    State(state): State<Arc<AppState>>,
    Path(connection_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{CONNECTION_PREFIX}/{connection_id}");
    let principal = authenticate_airhop(&state, &headers, "PUT", &path, Some(&body)).await?;
    require_owner_or_admin(&principal.member_role)?;
    let request: PutConnectionBody = parse_body(&body, "invalid channel connection JSON")?;
    let routing_changed = request.routing.is_some() || request.expected_version == 0;
    let connector_pubkey = PublicKey::from_hex(request.connector_pubkey.trim())
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid connector public key"))?;
    let connection = state
        .db
        .put_airhop_channel_connection(
            &principal.tenant,
            &PutChannelConnectionInput {
                routing: request.routing,
                connection_id,
                provider: request.provider,
                display_name: request.display_name,
                connector_pubkey: connector_pubkey.to_bytes(),
                status: request.status,
                hermes_enabled: request.hermes_enabled,
                capabilities: request.capabilities,
                expected_version: request.expected_version,
                updated_by_pubkey: principal.pubkey.to_bytes(),
            },
        )
        .await
        .map_err(map_db_error)?;
    if routing_changed {
        notify_connection_channel(
            &state,
            &principal.tenant,
            &connection,
            &principal.pubkey.to_bytes(),
        )
        .await;
    }
    Ok(Json(json!({
        "schemaVersion": "airhop.channel-connection.v1",
        "connection": connection_json(&connection),
    })))
}

// NIP-29 discovery alone does not wake an already running ACP subscriber.
// Announce only actual service memberships after explicit routing setup. The
// persisted global notification is also replayable after a reconnect.
async fn notify_connection_channel(
    state: &Arc<AppState>,
    tenant: &buzz_core::TenantContext,
    connection: &ChannelConnection,
    actor: &[u8; 32],
) {
    let Some(channel_id) = connection.buzz_channel_id else {
        return;
    };
    if let Err(error) =
        crate::handlers::side_effects::emit_group_discovery_events(tenant, state, channel_id).await
    {
        tracing::warn!(%error, %channel_id, "Connection channel discovery will recover on refresh");
    }
    let mut targets = vec![connection.connector_pubkey];
    match state
        .db
        .get_current_airhop_parent_agent_deployment(tenant)
        .await
    {
        Ok(Some(deployment)) if deployment.organization_id == connection.organization_id => {
            targets.push(deployment.agent_pubkey)
        }
        Ok(_) => {}
        Err(error) => {
            tracing::warn!(%error, %channel_id, "Cannot resolve connection agent membership notification")
        }
    }
    targets.sort_unstable();
    targets.dedup();
    for target in targets {
        match state
            .db
            .is_member(tenant.community(), channel_id, &target)
            .await
        {
            Ok(true) => {
                if let Err(error) = crate::handlers::side_effects::emit_membership_notification(
                    tenant,
                    state,
                    channel_id,
                    &target,
                    actor,
                    buzz_core::kind::KIND_MEMBER_ADDED_NOTIFICATION,
                )
                .await
                {
                    tracing::warn!(%error, %channel_id, "Connection service membership notification failed; retry routing setup");
                }
            }
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(%error, %channel_id, "Cannot verify connection service membership")
            }
        }
    }
}

/// Accepts a health/capability heartbeat from the exact configured connector.
pub(crate) async fn observe_connection(
    State(state): State<Arc<AppState>>,
    Path(connection_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{GATEWAY_PREFIX}/connections/{connection_id}/heartbeat");
    let principal = authenticate_airhop(&state, &headers, "POST", &path, Some(&body)).await?;
    let request: ObserveConnectionBody =
        parse_body(&body, "invalid channel connection heartbeat JSON")?;
    let connection = state
        .db
        .observe_airhop_channel_connection(
            &principal.tenant,
            &ObserveChannelConnectionInput {
                connection_id,
                observed_status: request.observed_status,
                observed_capabilities: request.observed_capabilities,
                error_code: request.error_code,
                connector_pubkey: principal.pubkey.to_bytes(),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "schemaVersion": "airhop.channel-connection.v1",
        "connection": connection_json(&connection),
    })))
}

/// Binds one canonical Buzz parent conversation to one provider chat.
pub(crate) async fn put_conversation_route(
    State(state): State<Arc<AppState>>,
    Path(conversation_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{CONNECTION_PREFIX}/conversations/{conversation_id}");
    let principal = authenticate_airhop(&state, &headers, "PUT", &path, Some(&body)).await?;
    require_owner_or_admin(&principal.member_role)?;
    let request: PutConversationRouteBody =
        parse_body(&body, "invalid external conversation route JSON")?;
    let provider_chat_digest = scoped_digest(
        &state,
        b"airhop.channel-gateway.chat.v1",
        principal.tenant.community().as_uuid(),
        request.connection_id,
        request.provider_chat_id.as_bytes(),
    )?;
    let route = state
        .db
        .put_airhop_external_conversation_route(
            &principal.tenant,
            &PutConversationRouteInput {
                conversation_id,
                connection_id: request.connection_id,
                provider_chat_id: request.provider_chat_id,
                provider_chat_digest,
                status: request.status,
                expected_version: request.expected_version,
                updated_by_pubkey: principal.pubkey.to_bytes(),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "schemaVersion": "airhop.external-conversation-route.v1",
        "route": route,
    })))
}

/// Resolves a provider chat to the canonical Buzz destination without
/// disclosing another connection's route or any provider credentials.
pub(crate) async fn resolve_conversation_route(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{GATEWAY_PREFIX}/routes/resolve");
    let principal = authenticate_airhop(&state, &headers, "POST", &path, Some(&body)).await?;
    let request: ResolveConversationRouteBody =
        parse_body(&body, "invalid external conversation route lookup JSON")?;
    let provider_chat_id = request.provider_chat_id.trim();
    if provider_chat_id.is_empty() || provider_chat_id.chars().count() > 300 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid provider chat id",
        ));
    }
    let provider_chat_digest = scoped_digest(
        &state,
        b"airhop.channel-gateway.chat.v1",
        principal.tenant.community().as_uuid(),
        request.connection_id,
        provider_chat_id.as_bytes(),
    )?;
    let connector_pubkey = principal.pubkey.to_bytes();
    let (route, created) = match state
        .db
        .resolve_airhop_external_conversation_route(
            &principal.tenant,
            request.connection_id,
            provider_chat_digest,
            connector_pubkey,
        )
        .await
    {
        Ok(route) => (route, false),
        Err(buzz_db::DbError::NotFound(_)) => {
            let provisioned = state
                .db
                .provision_airhop_external_conversation_route(
                    &principal.tenant,
                    &ProvisionExternalConversationRouteInput {
                        connection_id: request.connection_id,
                        provider_chat_id: provider_chat_id.to_owned(),
                        provider_chat_digest,
                        connector_pubkey,
                    },
                )
                .await
                .map_err(map_db_error)?;
            (provisioned.route, provisioned.created)
        }
        Err(error) => return Err(map_db_error(error)),
    };
    let handoff_status = match request.handoff_token_digest {
        Some(value) => {
            let digest: [u8; 32] = hex::decode(value)
                .ok()
                .and_then(|bytes| bytes.try_into().ok())
                .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "invalid handoff digest"))?;
            Some(
                state
                    .db
                    .consume_airhop_booking_handoff(
                        &principal.tenant,
                        request.connection_id,
                        route.conversation_id,
                        connector_pubkey,
                        digest,
                    )
                    .await
                    .map_err(map_db_error)?,
            )
        }
        None => None,
    };
    Ok(Json(json!({
        "schemaVersion": "airhop.external-conversation-route-resolution.v1",
        "conversationId": route.conversation_id,
        "channelId": route.channel_id,
        "rootEventId": route.root_event_id,
        "threaded": route.threaded,
        "routeStatus": route.route_status,
        "connectionStatus": route.connection_status,
        "created": created,
        "handoffStatus": handoff_status,
    })))
}

/// Accepts one signed, normalized inbound event from an exact Hermes adapter.
pub(crate) async fn ingest_inbound(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{GATEWAY_PREFIX}/inbound");
    let principal = authenticate_airhop(&state, &headers, "POST", &path, Some(&body)).await?;
    let request: GatewayInboundBody = parse_body(&body, "invalid gateway inbound JSON")?;
    let provider_event_id = request.provider_event_id.trim();
    if provider_event_id.is_empty() || provider_event_id.chars().count() > 300 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid provider event id",
        ));
    }
    let provider_event_digest = scoped_digest(
        &state,
        b"airhop.channel-gateway.inbound.v1",
        principal.tenant.community().as_uuid(),
        request.connection_id,
        provider_event_id.as_bytes(),
    )?;
    let retry = state
        .db
        .check_client_gateway_retry(
            &principal.tenant,
            &request.event,
            &buzz_db::airhop::channel_gateway::GatewayInboundContext {
                connection_id: request.connection_id,
                provider_event_digest,
                connector_pubkey: principal.pubkey.to_bytes(),
            },
        )
        .await;
    match retry {
        Ok(true) => {
            return Ok(Json(
                json!({"schemaVersion":"airhop.channel-gateway.inbound.v1","eventId":request.event.id.to_hex(),"accepted":true,"duplicate":true}),
            ))
        }
        Err(buzz_db::DbError::AccessDenied(ref reason)) if reason == "airhop_thread_changed" => {
            return Err(api_error(StatusCode::CONFLICT, "airhop_thread_changed"))
        }
        Err(error) => return Err(map_db_error(error)),
        Ok(false) => {}
    }
    let retry_event = request.event.clone();
    let result = crate::handlers::ingest::ingest_event(
        &state,
        &principal.tenant,
        request.event,
        IngestAuth::AirhopGateway {
            connector_pubkey: principal.pubkey,
            connection_id: request.connection_id,
            provider_event_digest,
            scopes: vec![buzz_auth::Scope::MessagesWrite],
        },
    )
    .await;
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            // Cutover can commit between preflight and ingestion's archive gate.
            // Recheck the durable receipt/location before classifying a failure.
            match state
                .db
                .check_client_gateway_retry(
                    &principal.tenant,
                    &retry_event,
                    &buzz_db::airhop::channel_gateway::GatewayInboundContext {
                        connection_id: request.connection_id,
                        provider_event_digest,
                        connector_pubkey: principal.pubkey.to_bytes(),
                    },
                )
                .await
            {
                Ok(true) => {
                    return Ok(Json(
                        json!({"schemaVersion":"airhop.channel-gateway.inbound.v1","eventId":retry_event.id.to_hex(),"accepted":true,"duplicate":true}),
                    ))
                }
                Err(buzz_db::DbError::AccessDenied(ref reason))
                    if reason == "airhop_thread_changed" =>
                {
                    return Err(api_error(StatusCode::CONFLICT, "airhop_thread_changed"))
                }
                _ => {}
            }
            return Err(match error {
                IngestError::Rejected(ref reason)
                    if reason == "restricted: airhop_thread_changed" =>
                {
                    api_error(StatusCode::CONFLICT, "airhop_thread_changed")
                }
                other => map_ingest_error(other),
            });
        }
    };
    Ok(Json(json!({
        "schemaVersion": "airhop.channel-gateway.inbound.v1",
        "eventId": result.event_id,
        "accepted": result.accepted,
        "duplicate": result.message == "duplicate:",
    })))
}

/// Leases provider-neutral external messages to the exact configured connector.
pub(crate) async fn claim_external_messages(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{GATEWAY_PREFIX}/outbound/claim");
    let principal = authenticate_airhop(&state, &headers, "POST", &path, Some(&body)).await?;
    let request: ClaimExternalMessagesBody = parse_body(&body, "invalid gateway claim JSON")?;
    let jobs = state
        .db
        .claim_airhop_external_messages(
            &principal.tenant,
            principal.pubkey.to_bytes(),
            request.connection_id,
            request.limit,
            request.lease_seconds,
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(json!({
        "schemaVersion": "airhop.channel-gateway.outbound-lease.v1",
        "jobs": jobs.into_iter().map(|job| json!({
            "outboxId": job.outbox_id,
            "leaseToken": job.lease_token,
            "connectionId": job.connection_id,
            "provider": job.provider,
            "providerChatId": job.provider_chat_id,
            "buzzEventId": hex::encode(job.buzz_event_id),
            "idempotencyKey": hex::encode(job.buzz_event_id),
            "event": job.event,
            "actorKind": job.actor_kind,
            "sequence": job.sequence,
            "attempt": job.attempt,
        })).collect::<Vec<_>>()
    })))
}

/// Idempotently records provider acceptance or a bounded retry.
pub(crate) async fn complete_external_message(
    State(state): State<Arc<AppState>>,
    Path(outbox_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("{GATEWAY_PREFIX}/outbound/{outbox_id}/complete");
    let principal = authenticate_airhop(&state, &headers, "POST", &path, Some(&body)).await?;
    let request: CompleteExternalMessageBody =
        parse_body(&body, "invalid gateway completion JSON")?;
    let (lease_token, completion) = match request {
        CompleteExternalMessageBody::Delivered {
            lease_token,
            provider_message_id,
        } => (
            lease_token,
            ExternalDeliveryCompletion::Delivered {
                provider_message_id,
            },
        ),
        CompleteExternalMessageBody::Failed {
            lease_token,
            error_code,
            retry_after_seconds,
            retryable,
        } => (
            lease_token,
            ExternalDeliveryCompletion::Failed {
                error_code,
                retry_after_seconds,
                retryable,
            },
        ),
    };
    let state_name = match state
        .db
        .complete_airhop_external_message(
            &principal.tenant,
            principal.pubkey.to_bytes(),
            outbox_id,
            lease_token,
            &completion,
        )
        .await
        .map_err(map_db_error)?
    {
        ExternalDeliveryAckState::Delivered => "delivered",
        ExternalDeliveryAckState::RetryScheduled => "retry_scheduled",
        ExternalDeliveryAckState::Failed => "failed",
    };
    Ok(Json(json!({
        "schemaVersion": "airhop.channel-gateway.delivery-ack.v1",
        "outboxId": outbox_id,
        "state": state_name,
    })))
}

fn parse_body<T: serde::de::DeserializeOwned>(
    body: &[u8],
    message: &str,
) -> Result<T, (StatusCode, Json<Value>)> {
    serde_json::from_slice(body).map_err(|_| api_error(StatusCode::BAD_REQUEST, message))
}

fn connection_json(connection: &ChannelConnection) -> Value {
    json!({
        "id": connection.id,
        "buzzChannelId": connection.buzz_channel_id,
        "branchId": connection.branch_id,
        "routingMode": connection.routing_mode,
        "organizationId": connection.organization_id,
        "provider": connection.provider,
        "displayName": connection.display_name,
        "connectorPubkey": hex::encode(connection.connector_pubkey),
        "status": connection.status,
        "hermesEnabled": connection.hermes_enabled,
        "capabilities": connection.capabilities,
        "observedStatus": connection.observed_status,
        "observedCapabilities": connection.observed_capabilities,
        "lastHeartbeatAt": connection.last_heartbeat_at,
        "lastErrorCode": connection.last_error_code,
        "version": connection.version,
    })
}

fn require_owner_or_admin(role: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if matches!(role, "owner" | "admin") {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::FORBIDDEN,
            "AirHop channel connection setup requires owner or admin access",
        ))
    }
}

fn require_gateway_principal(
    state: &AppState,
    pubkey: [u8; 32],
) -> Result<&crate::config::AirhopChannelGatewayConfig, (StatusCode, Json<Value>)> {
    let config = state
        .config
        .airhop_channel_gateway
        .as_ref()
        .ok_or_else(|| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "AirHop channel gateway is not configured",
            )
        })?;
    if pubkey != config.telegram_connector_pubkey() {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AirHop channel gateway access denied",
        ));
    }
    Ok(config)
}

fn valid_telegram_token_shape(token: &str) -> bool {
    if token.len() > 256 || token.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((bot_id, secret)) = token.split_once(':') else {
        return false;
    };
    (5..=20).contains(&bot_id.len())
        && bot_id.bytes().all(|value| value.is_ascii_digit())
        && (20..=220).contains(&secret.len())
        && secret
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'_' | b'-'))
}

fn valid_meta_id(value: &str) -> bool {
    (5..=40).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn valid_meta_app_secret(value: &str) -> bool {
    (16..=512).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_meta_access_token(value: &str) -> bool {
    (16..=4096).contains(&value.len())
        && !value.chars().any(char::is_whitespace)
        && value.chars().all(|character| !character.is_control())
}

fn credential_aad(community_id: Uuid, connection_id: Uuid, provider: &str) -> String {
    format!(
        "airhop.channel-credential.v1:{community_id}:{connection_id}:{}",
        provider.trim()
    )
}

fn encrypt_credential(
    key: &[u8; 32],
    nonce: &[u8; 12],
    aad: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>, (StatusCode, Json<Value>)> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| internal_error("AirHop channel credential encryption setup failed"))?;
    cipher
        .encrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| internal_error("AirHop channel credential encryption failed"))
}

fn decrypt_credential(
    key: &[u8; 32],
    nonce: &[u8; 12],
    aad: &[u8],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>, (StatusCode, Json<Value>)> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| internal_error("AirHop channel credential decryption setup failed"))?;
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| internal_error("AirHop channel credential decryption failed"))
}

fn credential_fingerprint(
    index_key: &[u8; 32],
    provider: &str,
    token: &str,
) -> Result<[u8; 32], (StatusCode, Json<Value>)> {
    let mut mac = Hmac::<Sha256>::new_from_slice(index_key)
        .map_err(|_| internal_error("AirHop channel credential index setup failed"))?;
    for component in [
        b"airhop.channel-credential-index.v1".as_slice(),
        provider.as_bytes(),
        token.as_bytes(),
    ] {
        mac.update(&(component.len() as u64).to_be_bytes());
        mac.update(component);
    }
    Ok(mac.finalize().into_bytes().into())
}

async fn verify_telegram_bot(
    origin: &str,
    token: &str,
) -> Result<TelegramBotIdentity, (StatusCode, Json<Value>)> {
    let url = format!("{}/bot{token}/getMe", origin.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| internal_error("Telegram verification client setup failed"))?;
    let response = client.get(url).send().await.map_err(|_| {
        api_error(
            StatusCode::BAD_GATEWAY,
            "Telegram is temporarily unavailable",
        )
    })?;
    if matches!(
        response.status(),
        StatusCode::BAD_REQUEST | StatusCode::UNAUTHORIZED | StatusCode::NOT_FOUND
    ) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Telegram rejected this bot token",
        ));
    }
    if !response.status().is_success() {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "Telegram is temporarily unavailable",
        ));
    }
    let envelope: TelegramApiEnvelope = response.json().await.map_err(|_| {
        api_error(
            StatusCode::BAD_GATEWAY,
            "Telegram returned an invalid response",
        )
    })?;
    let bot = envelope
        .result
        .filter(|result| envelope.ok && result.is_bot)
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "Telegram rejected this bot token"))?;
    if bot.first_name.trim().is_empty()
        || bot.first_name.chars().count() > 160
        || bot
            .username
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 160)
    {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "Telegram returned an invalid bot identity",
        ));
    }
    Ok(bot)
}

async fn verify_whatsapp_phone(
    origin: &str,
    waba_id: &str,
    phone_number_id: &str,
    access_token: &str,
) -> Result<MetaPhoneIdentity, (StatusCode, Json<Value>)> {
    let url = format!(
        "{}/{waba_id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=100",
        origin.trim_end_matches('/')
    );
    let client = meta_client()?;
    let response = client
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| api_error(StatusCode::BAD_GATEWAY, "Meta is temporarily unavailable"))?;
    if matches!(response.status().as_u16(), 400 | 401 | 403 | 404) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Meta rejected the WhatsApp token, WABA, or permissions",
        ));
    }
    if !response.status().is_success() {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "Meta is temporarily unavailable",
        ));
    }
    let envelope: MetaPhoneList = response.json().await.map_err(|_| {
        api_error(
            StatusCode::BAD_GATEWAY,
            "Meta returned an invalid WhatsApp response",
        )
    })?;
    let phone = envelope
        .data
        .into_iter()
        .find(|candidate| candidate.id == phone_number_id)
        .ok_or_else(|| {
            api_error(
                StatusCode::BAD_REQUEST,
                "Meta did not confirm that the phone number belongs to this WABA",
            )
        })?;
    if phone.id.chars().count() > 40
        || phone
            .display_phone_number
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 40)
        || phone
            .verified_name
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 160)
        || phone
            .quality_rating
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 40)
    {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "Meta returned invalid WhatsApp phone metadata",
        ));
    }
    Ok(phone)
}

async fn subscribe_whatsapp_app(
    origin: &str,
    waba_id: &str,
    access_token: &str,
) -> Result<(), (StatusCode, Json<Value>)> {
    let url = format!("{}/{waba_id}/subscribed_apps", origin.trim_end_matches('/'));
    let response = meta_client()?
        .post(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| api_error(StatusCode::BAD_GATEWAY, "Meta is temporarily unavailable"))?;
    if matches!(response.status().as_u16(), 400 | 401 | 403 | 404) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Meta rejected the WhatsApp app subscription",
        ));
    }
    if !response.status().is_success() {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "Meta is temporarily unavailable",
        ));
    }
    let envelope: MetaSuccess = response.json().await.map_err(|_| {
        api_error(
            StatusCode::BAD_GATEWAY,
            "Meta returned an invalid WhatsApp response",
        )
    })?;
    if envelope.success != Some(true) {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "Meta did not confirm the WhatsApp app subscription",
        ));
    }
    Ok(())
}

fn meta_client() -> Result<reqwest::Client, (StatusCode, Json<Value>)> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| internal_error("Meta verification client setup failed"))
}

fn scoped_digest(
    state: &AppState,
    domain: &[u8],
    community_id: &Uuid,
    connection_id: Uuid,
    value: &[u8],
) -> Result<[u8; 32], (StatusCode, Json<Value>)> {
    let root = crate::invite_token::derive_invite_key(&state.relay_keypair);
    let mut key_hasher = Sha256::new();
    key_hasher.update(root);
    key_hasher.update(b"airhop-channel-gateway-key-v1");
    let key: [u8; 32] = key_hasher.finalize().into();
    let mut mac = Hmac::<Sha256>::new_from_slice(&key)
        .map_err(|_| internal_error("AirHop gateway digest setup failed"))?;
    for component in [
        domain,
        community_id.as_bytes(),
        connection_id.as_bytes(),
        value,
    ] {
        mac.update(&(component.len() as u64).to_be_bytes());
        mac.update(component);
    }
    Ok(mac.finalize().into_bytes().into())
}

fn map_ingest_error(error: IngestError) -> (StatusCode, Json<Value>) {
    match error {
        IngestError::Rejected(message) => api_error(StatusCode::UNPROCESSABLE_ENTITY, &message),
        IngestError::AuthFailed(_) => api_error(
            StatusCode::FORBIDDEN,
            "AirHop gateway event was not authorized",
        ),
        IngestError::Internal(message) => {
            internal_error(&format!("AirHop gateway ingest failed: {message}"))
        }
    }
}

fn map_db_error(error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    match error {
        buzz_db::DbError::NotFound(_) | buzz_db::DbError::ChannelNotFound(_) => {
            api_error(StatusCode::NOT_FOUND, "AirHop gateway resource not found")
        }
        buzz_db::DbError::AccessDenied(_) => {
            api_error(StatusCode::FORBIDDEN, "AirHop gateway access denied")
        }
        buzz_db::DbError::InvalidData(message) => {
            api_error(StatusCode::UNPROCESSABLE_ENTITY, &message)
        }
        buzz_db::DbError::AirhopVersionConflict => api_error(
            StatusCode::CONFLICT,
            "AirHop gateway state changed; reload and retry",
        ),
        other => internal_error(&format!("AirHop channel gateway failed: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inbound_and_completion_contracts_reject_unknown_fields() {
        let telegram = json!({
            "token": "123456789:abcdefghijklmnopqrstuvwxyz_ABCD",
            "hermesEnabled": true,
            "connectorPubkey": "11".repeat(32),
        });
        assert!(serde_json::from_value::<ConnectTelegramBody>(telegram).is_err());

        let whatsapp = json!({
            "appId": "123456789012345",
            "appSecret": "app-secret-1234567890",
            "wabaId": "234567890123456",
            "phoneNumberId": "345678901234567",
            "accessToken": "system-user-token-1234567890",
            "verifyToken": "must-be-generated-by-server",
        });
        assert!(serde_json::from_value::<ConnectWhatsAppBody>(whatsapp).is_err());

        let connection = json!({
            "provider": "telegram",
            "displayName": "Main Telegram",
            "connectorPubkey": "11".repeat(32),
            "status": "active",
            "hermesEnabled": true,
            "capabilities": {},
            "expectedVersion": 0,
            "telegramBotToken": "must-not-be-accepted",
        });
        assert!(serde_json::from_value::<PutConnectionBody>(connection).is_err());

        let inbound = json!({
            "connectionId": Uuid::new_v4(),
            "providerEventId": "update-1",
            "event": {},
            "conversationId": Uuid::new_v4(),
        });
        assert!(serde_json::from_value::<GatewayInboundBody>(inbound).is_err());

        let completion = json!({
            "status": "delivered",
            "leaseToken": Uuid::new_v4(),
            "providerMessageId": "m-1",
            "provider": "telegram",
        });
        assert!(serde_json::from_value::<CompleteExternalMessageBody>(completion).is_err());

        let observation = json!({
            "observedStatus": "ready",
            "observedCapabilities": {},
            "token": "must-not-be-accepted",
        });
        assert!(serde_json::from_value::<ObserveConnectionBody>(observation).is_err());

        let route_lookup = json!({
            "connectionId": Uuid::new_v4(),
            "providerChatId": "42",
            "token": "must-not-be-accepted",
        });
        assert!(serde_json::from_value::<ResolveConversationRouteBody>(route_lookup).is_err());
    }

    #[test]
    fn telegram_tokens_are_bounded_and_credentials_are_aead_bound() {
        let token = "123456789:abcdefghijklmnopqrstuvwxyz_ABCD";
        assert!(valid_telegram_token_shape(token));
        assert!(!valid_telegram_token_shape("not-a-token"));
        assert!(!valid_telegram_token_shape(
            "123456789:contains whitespace in the secret"
        ));

        let key = [17_u8; 32];
        let nonce = [23_u8; 12];
        let community = Uuid::new_v4();
        let connection = Uuid::new_v4();
        let aad = credential_aad(community, connection, "telegram");
        let ciphertext =
            encrypt_credential(&key, &nonce, aad.as_bytes(), token.as_bytes()).unwrap();
        assert_ne!(ciphertext, token.as_bytes());
        let plaintext = decrypt_credential(&key, &nonce, aad.as_bytes(), &ciphertext).unwrap();
        assert_eq!(plaintext.as_slice(), token.as_bytes());
        assert!(decrypt_credential(
            &key,
            &nonce,
            credential_aad(community, Uuid::new_v4(), "telegram").as_bytes(),
            &ciphertext,
        )
        .is_err());
    }

    #[test]
    fn whatsapp_identifiers_and_secrets_are_closed_and_bounded() {
        assert!(valid_meta_id("123456789012345"));
        assert!(!valid_meta_id("+5511999999999"));
        assert!(valid_meta_app_secret("app-secret-1234567890"));
        assert!(!valid_meta_app_secret("contains whitespace"));
        assert!(valid_meta_access_token("system-user-token-1234567890"));
        assert!(!valid_meta_access_token("short"));
        assert!(!valid_meta_access_token(
            "system-user-token with whitespace"
        ));
    }

    #[tokio::test]
    async fn telegram_verification_uses_get_me_and_returns_only_safe_identity() {
        async fn get_me(Path(path): Path<String>) -> Json<Value> {
            assert_eq!(path, "bot123456789:abcdefghijklmnopqrstuvwxyz_ABCD/getMe");
            Json(json!({
                "ok": true,
                "result": {
                    "id": 123456789_i64,
                    "is_bot": true,
                    "first_name": "Airhop Demo",
                    "username": "airhop_demo_bot"
                }
            }))
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = axum::Router::new().route("/{*path}", axum::routing::get(get_me));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let bot = verify_telegram_bot(
            &format!("http://{address}"),
            "123456789:abcdefghijklmnopqrstuvwxyz_ABCD",
        )
        .await
        .unwrap();
        assert_eq!(bot.id, 123456789);
        assert_eq!(bot.username.as_deref(), Some("airhop_demo_bot"));
        server.abort();
    }

    #[tokio::test]
    async fn whatsapp_verification_requires_the_phone_in_the_selected_waba() {
        async fn phones(headers: HeaderMap) -> Json<Value> {
            assert_eq!(
                headers
                    .get("authorization")
                    .and_then(|value| value.to_str().ok()),
                Some("Bearer system-user-token-1234567890")
            );
            Json(json!({
                "data": [{
                    "id": "345678901234567",
                    "display_phone_number": "+55 11 99999-0000",
                    "verified_name": "AirHop Test",
                    "quality_rating": "GREEN"
                }]
            }))
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app =
            axum::Router::new().route("/234567890123456/phone_numbers", axum::routing::get(phones));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let phone = verify_whatsapp_phone(
            &format!("http://{address}"),
            "234567890123456",
            "345678901234567",
            "system-user-token-1234567890",
        )
        .await
        .unwrap();
        assert_eq!(
            phone.display_phone_number.as_deref(),
            Some("+55 11 99999-0000")
        );
        let error = verify_whatsapp_phone(
            &format!("http://{address}"),
            "234567890123456",
            "456789012345678",
            "system-user-token-1234567890",
        )
        .await
        .unwrap_err();
        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        server.abort();
    }

    #[tokio::test]
    async fn whatsapp_activation_uses_the_waba_subscription_endpoint() {
        async fn subscribe(headers: HeaderMap) -> Json<Value> {
            assert_eq!(
                headers
                    .get("authorization")
                    .and_then(|value| value.to_str().ok()),
                Some("Bearer system-user-token-1234567890")
            );
            Json(json!({"success": true}))
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = axum::Router::new().route(
            "/234567890123456/subscribed_apps",
            axum::routing::post(subscribe),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        subscribe_whatsapp_app(
            &format!("http://{address}"),
            "234567890123456",
            "system-user-token-1234567890",
        )
        .await
        .unwrap();
        server.abort();
    }

    #[test]
    fn gateway_digest_is_domain_and_connection_scoped() {
        let community = Uuid::new_v4();
        let connection = Uuid::new_v4();
        let key = [7_u8; 32];
        let digest = |domain: &[u8], connection_id: Uuid| {
            let mut mac = Hmac::<Sha256>::new_from_slice(&key).unwrap();
            for component in [
                domain,
                community.as_bytes(),
                connection_id.as_bytes(),
                b"same",
            ] {
                mac.update(&(component.len() as u64).to_be_bytes());
                mac.update(component);
            }
            <[u8; 32]>::from(mac.finalize().into_bytes())
        };
        assert_ne!(digest(b"inbound", connection), digest(b"chat", connection));
        assert_ne!(
            digest(b"inbound", connection),
            digest(b"inbound", Uuid::new_v4())
        );
    }
}
