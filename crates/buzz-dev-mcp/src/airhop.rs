//! Role-scoped MCP tools for the Airhop product agent team.

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

use base64::Engine as _;
use nostr::{Event, EventBuilder, Keys, Kind, PublicKey, Tag};
use reqwest::Method;
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router,
    transport::stdio,
    ErrorData, ServerHandler, ServiceExt,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const MAX_MESSAGES: usize = 3;
const MAX_MESSAGE_CHARS: usize = 1_200;
const MAX_ASSIGNMENT_CHARS: usize = 4_000;
const SETTINGS_PATH: &str = "/api/airhop/staff/v1/settings";
const SITE_CONTENT_CONTEXT_PATH: &str = "/api/airhop/agents/v1/site-content/context";
const AGENT_BACKEND_PATH: &str = "/api/airhop/agents/v1/backend";
const AGENT_CONTEXT_HEADER: &str = "x-airhop-agent-context";

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum AirhopRole {
    Fizz,
    Administrator,
    Analyst,
    ContentMarketer,
    ParentAdministrator,
}

impl AirhopRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fizz => "fizz",
            Self::Administrator => "administrator",
            Self::Analyst => "analyst",
            Self::ContentMarketer => "content_marketer",
            Self::ParentAdministrator => "parent_administrator",
        }
    }

    pub fn parse_config(value: &str) -> Result<Self, AirhopError> {
        match value.trim() {
            "fizz" => Ok(Self::Fizz),
            "administrator" => Ok(Self::Administrator),
            "analyst" => Ok(Self::Analyst),
            "content_marketer" => Ok(Self::ContentMarketer),
            "parent_administrator" => Ok(Self::ParentAdministrator),
            value => Err(AirhopError(format!(
                "unsupported BUZZ_AIRHOP_ROLE value: {value}"
            ))),
        }
    }

    pub fn allows(self, resource: &ReadResource) -> bool {
        match self {
            Self::Fizz => matches!(
                resource,
                ReadResource::OrganizationSettings
                    | ReadResource::Schedule
                    | ReadResource::PaymentAnalytics
                    | ReadResource::BookingFunnel
                    | ReadResource::PublicBookingSettings
            ),
            Self::Administrator => matches!(
                resource,
                ReadResource::OrganizationSettings
                    | ReadResource::Families
                    | ReadResource::FamilyDetail { .. }
                    | ReadResource::Schedule
                    | ReadResource::PublicBookingSettings
            ),
            Self::Analyst => matches!(
                resource,
                ReadResource::OrganizationSettings
                    | ReadResource::PaymentAnalytics
                    | ReadResource::BookingFunnel
            ),
            Self::ContentMarketer => matches!(
                resource,
                ReadResource::OrganizationSettings
                    | ReadResource::Schedule
                    | ReadResource::PublicBookingSettings
            ),
            Self::ParentAdministrator => false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum WelcomeKickoffStage {
    FizzIntro,
    FizzInviteAdministrator,
    AdministratorIntro,
    FizzInviteAnalyst,
    AnalystIntro,
    FizzInviteContentMarketer,
    ContentMarketerIntro,
    FizzExplainTeam,
    FizzFirstQuestion,
}

impl WelcomeKickoffStage {
    const fn as_str(self) -> &'static str {
        match self {
            Self::FizzIntro => "fizz_intro",
            Self::FizzInviteAdministrator => "fizz_invite_administrator",
            Self::AdministratorIntro => "administrator_intro",
            Self::FizzInviteAnalyst => "fizz_invite_analyst",
            Self::AnalystIntro => "analyst_intro",
            Self::FizzInviteContentMarketer => "fizz_invite_content_marketer",
            Self::ContentMarketerIntro => "content_marketer_intro",
            Self::FizzExplainTeam => "fizz_explain_team",
            Self::FizzFirstQuestion => "fizz_first_question",
        }
    }

    const fn role(self) -> AirhopRole {
        match self {
            Self::FizzIntro
            | Self::FizzInviteAdministrator
            | Self::FizzInviteAnalyst
            | Self::FizzInviteContentMarketer
            | Self::FizzExplainTeam
            | Self::FizzFirstQuestion => AirhopRole::Fizz,
            Self::AdministratorIntro => AirhopRole::Administrator,
            Self::AnalystIntro => AirhopRole::Analyst,
            Self::ContentMarketerIntro => AirhopRole::ContentMarketer,
        }
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendMessagesParams {
    #[schemars(with = "String")]
    pub channel_id: Uuid,
    pub messages: Vec<String>,
    #[serde(default)]
    pub expects_reply: bool,
    #[serde(default)]
    pub kickoff_stage: Option<WelcomeKickoffStage>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendParentReplyParams {
    pub messages: Vec<String>,
    /// When present, atomically notify authorized staff and pause Hermes.
    #[serde(default)]
    pub handoff_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DelegateParams {
    #[schemars(with = "String")]
    pub channel_id: Uuid,
    pub target_role: AirhopRole,
    pub assignment: String,
}

#[derive(Debug, Clone)]
pub enum ReadResource {
    OrganizationSettings,
    Families,
    FamilyDetail { family_id: Uuid },
    Schedule,
    PaymentAnalytics,
    BookingFunnel,
    PublicBookingSettings,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReadResourceKind {
    OrganizationSettings,
    Families,
    FamilyDetail,
    Schedule,
    PaymentAnalytics,
    BookingFunnel,
    PublicBookingSettings,
}

impl ReadResource {
    const fn name(&self) -> &'static str {
        match self {
            Self::OrganizationSettings => "organization_settings",
            Self::Families => "families",
            Self::FamilyDetail { .. } => "family_detail",
            Self::Schedule => "schedule",
            Self::PaymentAnalytics => "payment_analytics",
            Self::BookingFunnel => "booking_funnel",
            Self::PublicBookingSettings => "public_booking_settings",
        }
    }

    fn path(&self) -> Option<String> {
        match self {
            Self::OrganizationSettings | Self::PublicBookingSettings => None,
            Self::Families => Some("/api/airhop/staff/v1/families".to_owned()),
            Self::FamilyDetail { family_id } => {
                Some(format!("/api/airhop/staff/v1/families/{family_id}"))
            }
            Self::Schedule => Some("/api/airhop/staff/v1/branches".to_owned()),
            Self::PaymentAnalytics => Some("/api/airhop/staff/v1/payment-analytics".to_owned()),
            Self::BookingFunnel => Some("/api/airhop/staff/v1/booking-funnel-analytics".to_owned()),
        }
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadParams {
    #[schemars(with = "String")]
    pub channel_id: Uuid,
    pub resource: ReadResourceKind,
    #[schemars(with = "Option<String>")]
    pub family_id: Option<Uuid>,
}

impl ReadParams {
    fn resolve_resource(&self) -> Result<ReadResource, AirhopError> {
        match (self.resource, self.family_id) {
            (ReadResourceKind::OrganizationSettings, None) => {
                Ok(ReadResource::OrganizationSettings)
            }
            (ReadResourceKind::Families, None) => Ok(ReadResource::Families),
            (ReadResourceKind::FamilyDetail, Some(family_id)) => {
                Ok(ReadResource::FamilyDetail { family_id })
            }
            (ReadResourceKind::Schedule, None) => Ok(ReadResource::Schedule),
            (ReadResourceKind::PaymentAnalytics, None) => Ok(ReadResource::PaymentAnalytics),
            (ReadResourceKind::BookingFunnel, None) => Ok(ReadResource::BookingFunnel),
            (ReadResourceKind::PublicBookingSettings, None) => {
                Ok(ReadResource::PublicBookingSettings)
            }
            (ReadResourceKind::FamilyDetail, None) => Err(AirhopError(
                "familyId is required for family_detail".to_owned(),
            )),
            (_, Some(_)) => Err(AirhopError(
                "familyId is only valid for family_detail".to_owned(),
            )),
        }
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareActionParams {
    #[schemars(with = "String")]
    pub channel_id: Uuid,
    /// Hex event ID shown in the triggering `[Event]` block of the turn.
    pub triggering_event_id: String,
    pub command: PrepareAgentCommand,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposeSiteContentParams {
    #[schemars(with = "String")]
    pub channel_id: Uuid,
    /// Hex event ID of the owner's request that caused this proposal.
    pub triggering_event_id: String,
    /// HQ-validated typed site-content changes. For a visible page heading use
    /// `marketing.headline`; for the browser/search title use
    /// `marketing.seo_title`.
    pub changes: Vec<SiteContentChange>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteContentChange {
    pub key: SiteContentKey,
    pub value: Value,
}

/// Public site field changed by the Content Marketer. The serialized values
/// are the canonical HQ contract; common model guesses for a visible heading
/// are accepted as input aliases and always normalized before signing.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize, JsonSchema,
)]
pub enum SiteContentKey {
    #[serde(rename = "business.public_name")]
    BusinessPublicName,
    #[serde(rename = "business.public_address")]
    BusinessPublicAddress,
    #[serde(rename = "contacts.public_phone")]
    ContactsPublicPhone,
    #[serde(rename = "contacts.public_email")]
    ContactsPublicEmail,
    #[serde(rename = "contacts.telegram")]
    ContactsTelegram,
    #[serde(rename = "contacts.whatsapp")]
    ContactsWhatsapp,
    #[serde(rename = "operations.hours")]
    OperationsHours,
    #[serde(rename = "operations.schedule")]
    OperationsSchedule,
    #[serde(rename = "operations.prices")]
    OperationsPrices,
    #[serde(rename = "links.booking")]
    LinksBooking,
    #[serde(
        rename = "marketing.headline",
        alias = "headline",
        alias = "title",
        alias = "site_title"
    )]
    MarketingHeadline,
    #[serde(rename = "marketing.summary")]
    MarketingSummary,
    #[serde(rename = "marketing.faq")]
    MarketingFaq,
    #[serde(rename = "marketing.seo_title")]
    MarketingSeoTitle,
    #[serde(rename = "marketing.seo_description")]
    MarketingSeoDescription,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmSiteContentParams {
    #[schemars(with = "String")]
    pub channel_id: Uuid,
    /// Event ID returned by `airhop_propose_site_content`.
    pub preview_event_id: String,
    /// Hex event ID of the owner's exact confirmation phrase.
    pub confirmation_event_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SiteContentContext {
    hq_api_origin: String,
    installation_id: Uuid,
    welcome_channel_id: Uuid,
}

/// Closed setup-command discriminator exposed to the Administrator model.
/// The relay performs the authoritative per-command body parse using the same
/// DTOs as its staff HTTP API.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(
    tag = "type",
    content = "input",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PrepareAgentCommand {
    PutOrganizationSettings(Value),
    CreateBranch(Value),
    CreateRoom {
        #[schemars(with = "String")]
        branch_id: Uuid,
        body: Value,
    },
    CreateTeacher(Value),
    CreateGroup(Value),
    CreateTariff(Value),
    CreateFamily(Value),
    EnrollParticipant(Value),
    MutatePayment {
        #[schemars(with = "String")]
        payment_id: Uuid,
        body: Value,
    },
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GetTurnContextParams {}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GetFamilyParams {}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BookingPurpose {
    Trial,
    Lesson,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListBookingOptionsParams {
    #[schemars(with = "Option<String>")]
    pub branch_id: Option<Uuid>,
    #[schemars(with = "Option<String>")]
    pub group_id: Option<Uuid>,
    pub purpose: Option<BookingPurpose>,
    pub age_years: Option<u8>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchKnowledgeParams {
    pub query: String,
    pub locale: Option<String>,
    #[serde(default = "default_parent_knowledge_limit")]
    pub limit: u8,
}

const fn default_parent_knowledge_limit() -> u8 {
    8
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ParentBookingAction {
    ConfirmOnline,
    Cancel,
    RequestTransfer { comment: Option<String> },
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManageBookingParams {
    #[schemars(with = "String")]
    pub booking_id: Uuid,
    pub action: ParentBookingAction,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParentContextClaims {
    channel_id: Uuid,
    turn_id: Uuid,
    turn_lease_token: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParentHandoffTarget {
    pubkey: String,
    display_name: String,
}

#[derive(Debug, Clone)]
pub struct AirhopError(String);

impl fmt::Display for AirhopError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for AirhopError {}

#[derive(Clone)]
struct AirhopConfig {
    role: AirhopRole,
    channel_id: Option<Uuid>,
    context_grant: Option<String>,
    context_grant_file: Option<PathBuf>,
    relay_url: String,
    keys: Keys,
    auth_tag: Option<Tag>,
    auth_tag_json: Option<String>,
    http: reqwest::Client,
}

impl AirhopConfig {
    fn from_env() -> Result<Self, AirhopError> {
        let role = AirhopRole::parse_config(&required_env("BUZZ_AIRHOP_ROLE")?)?;
        let channel_id = match env::var("BUZZ_AIRHOP_WELCOME_CHANNEL_ID") {
            Ok(value) if !value.trim().is_empty() => {
                let value = value.trim();
                Some(Uuid::parse_str(value).map_err(|_| {
                    AirhopError(format!("invalid BUZZ_AIRHOP_WELCOME_CHANNEL_ID: {value}"))
                })?)
            }
            _ if role == AirhopRole::ParentAdministrator => None,
            _ => {
                return Err(AirhopError(
                    "BUZZ_AIRHOP_WELCOME_CHANNEL_ID is required for Welcome agents".to_owned(),
                ))
            }
        };
        let context_grant = env::var("BUZZ_AIRHOP_CONTEXT_GRANT")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let context_grant_file = env::var("BUZZ_AIRHOP_CONTEXT_GRANT_FILE")
            .ok()
            .map(|value| PathBuf::from(value.trim()))
            .filter(|value| !value.as_os_str().is_empty());
        if context_grant.is_some() && context_grant_file.is_some() {
            return Err(AirhopError(
                "configure only one of BUZZ_AIRHOP_CONTEXT_GRANT and BUZZ_AIRHOP_CONTEXT_GRANT_FILE"
                    .to_owned(),
            ));
        }
        if role == AirhopRole::ParentAdministrator
            && context_grant.is_none()
            && context_grant_file.is_none()
        {
            return Err(AirhopError(
                "parent_administrator requires an AirHop context grant source".to_owned(),
            ));
        }
        let relay_url = normalize_relay_url(&required_env("BUZZ_RELAY_URL")?)?;
        let private_key = required_env("BUZZ_PRIVATE_KEY")?;
        let keys = Keys::parse(&private_key)
            .map_err(|error| AirhopError(format!("invalid BUZZ_PRIVATE_KEY: {error}")))?;
        let (auth_tag, auth_tag_json) = match env::var("BUZZ_AUTH_TAG") {
            Ok(raw) if !raw.trim().is_empty() => {
                let tag = buzz_sdk::nip_oa::parse_auth_tag(&raw)
                    .map_err(|error| AirhopError(format!("BUZZ_AUTH_TAG is malformed: {error}")))?;
                buzz_sdk::nip_oa::verify_auth_tag(&raw, &keys.public_key()).map_err(|error| {
                    AirhopError(format!("BUZZ_AUTH_TAG verification failed: {error}"))
                })?;
                let canonical = serde_json::to_string(tag.as_slice()).map_err(|error| {
                    AirhopError(format!("BUZZ_AUTH_TAG serialization failed: {error}"))
                })?;
                (Some(tag), Some(canonical))
            }
            _ => (None, None),
        };
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|error| AirhopError(error.to_string()))?;
        Ok(Self {
            role,
            channel_id,
            context_grant,
            context_grant_file,
            relay_url,
            keys,
            auth_tag,
            auth_tag_json,
            http,
        })
    }

    #[cfg(test)]
    fn for_test(role: AirhopRole, channel_id: Uuid, relay_url: &str, keys: Keys) -> Self {
        Self {
            role,
            channel_id: Some(channel_id),
            context_grant: None,
            context_grant_file: None,
            relay_url: relay_url.trim_end_matches('/').to_owned(),
            keys,
            auth_tag: None,
            auth_tag_json: None,
            http: reqwest::Client::new(),
        }
    }

    fn require_channel(&self, channel_id: Uuid) -> Result<(), AirhopError> {
        if self.channel_id == Some(channel_id) {
            Ok(())
        } else {
            Err(AirhopError(format!(
                "channel {channel_id} is not the registered Airhop Welcome channel"
            )))
        }
    }

    fn sign_event(&self, builder: EventBuilder) -> Result<Event, AirhopError> {
        let builder = if let Some(tag) = &self.auth_tag {
            builder.tags([tag.clone()])
        } else {
            builder
        };
        builder
            .sign_with_keys(&self.keys)
            .map_err(|error| AirhopError(format!("event signing failed: {error}")))
    }

    fn current_context_grant(&self) -> Result<Option<String>, AirhopError> {
        if let Some(path) = &self.context_grant_file {
            let value = std::fs::read_to_string(path).map_err(|error| {
                AirhopError(format!(
                    "cannot read AirHop context grant file {}: {error}",
                    path.display()
                ))
            })?;
            let value = value.trim();
            if value.is_empty() || value.len() > 24_000 {
                return Err(AirhopError(
                    "AirHop context grant file is empty or oversized".to_owned(),
                ));
            }
            return Ok(Some(value.to_owned()));
        }
        Ok(self.context_grant.clone())
    }

    fn nip98_header(
        &self,
        method: &Method,
        url: &str,
        body: Option<&[u8]>,
    ) -> Result<String, AirhopError> {
        let mut tags = vec![
            parse_tag(["u", url])?,
            parse_tag(["method", method.as_str()])?,
            parse_tag(["nonce", Uuid::new_v4().to_string().as_str()])?,
        ];
        if let Some(body) = body {
            let digest = hex::encode(Sha256::digest(body));
            tags.push(parse_tag(["payload", digest.as_str()])?);
        }
        let event = EventBuilder::new(Kind::HttpAuth, "")
            .tags(tags)
            .sign_with_keys(&self.keys)
            .map_err(|error| AirhopError(format!("NIP-98 signing failed: {error}")))?;
        let bytes = serde_json::to_vec(&event)
            .map_err(|error| AirhopError(format!("NIP-98 serialization failed: {error}")))?;
        Ok(format!(
            "Nostr {}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }

    async fn request_json(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, AirhopError> {
        let url = format!("{}{}", self.relay_url, path);
        let body_bytes = body
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|error| AirhopError(format!("request serialization failed: {error}")))?;
        let auth = self.nip98_header(&method, &url, body_bytes.as_deref())?;
        let mut request = self
            .http
            .request(method, &url)
            .header("Authorization", auth)
            .header("Accept", "application/json");
        if let Some(auth_tag) = &self.auth_tag_json {
            request = request.header("x-auth-tag", auth_tag);
        }
        if let Some(context_grant) = self.current_context_grant()? {
            request = request.header(AGENT_CONTEXT_HEADER, context_grant);
        }
        if let Some(bytes) = body_bytes {
            request = request
                .header("Content-Type", "application/json")
                .body(bytes);
        }
        let response = request
            .send()
            .await
            .map_err(|error| AirhopError(format!("Airhop request failed: {error}")))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| AirhopError(format!("Airhop response failed: {error}")))?;
        if !status.is_success() {
            let detail = String::from_utf8_lossy(&bytes);
            return Err(AirhopError(format!(
                "Airhop {path} returned HTTP {status}: {}",
                detail.chars().take(600).collect::<String>()
            )));
        }
        if bytes.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&bytes)
            .map_err(|error| AirhopError(format!("Airhop returned invalid JSON: {error}")))
    }

    async fn request_absolute_json(
        &self,
        method: Method,
        url: &str,
        body: Option<&Value>,
    ) -> Result<Value, AirhopError> {
        let body_bytes = body
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|error| AirhopError(format!("request serialization failed: {error}")))?;
        let auth = self.nip98_header(&method, url, body_bytes.as_deref())?;
        let mut request = self
            .http
            .request(method, url)
            .header("Authorization", auth)
            .header("Accept", "application/json");
        if let Some(bytes) = body_bytes {
            request = request
                .header("Content-Type", "application/json")
                .body(bytes);
        }
        let response = request
            .send()
            .await
            .map_err(|error| AirhopError(format!("HQ content request failed: {error}")))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| AirhopError(format!("HQ content response failed: {error}")))?;
        if !status.is_success() {
            let detail = String::from_utf8_lossy(&bytes);
            return Err(AirhopError(format!(
                "HQ content request returned HTTP {status}: {}",
                detail.chars().take(600).collect::<String>()
            )));
        }
        serde_json::from_slice(&bytes)
            .map_err(|error| AirhopError(format!("HQ content response is invalid: {error}")))
    }

    async fn get_json(&self, path: &str) -> Result<Value, AirhopError> {
        self.request_json(Method::GET, path, None).await
    }

    async fn post_json(&self, path: &str, body: &Value) -> Result<Value, AirhopError> {
        self.request_json(Method::POST, path, Some(body)).await
    }

    async fn submit_event(&self, event: &Event) -> Result<Value, AirhopError> {
        let value = serde_json::to_value(event)
            .map_err(|error| AirhopError(format!("event serialization failed: {error}")))?;
        self.post_json("/events", &value).await
    }
}

fn required_env(name: &str) -> Result<String, AirhopError> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AirhopError(format!("{name} is required for airhop-agent-mcp")))
}

fn normalize_relay_url(value: &str) -> Result<String, AirhopError> {
    let trimmed = value.trim().trim_end_matches('/');
    let normalized = if let Some(rest) = trimmed.strip_prefix("wss://") {
        format!("https://{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("ws://") {
        format!("http://{rest}")
    } else {
        trimmed.to_owned()
    };
    if normalized.starts_with("http://") || normalized.starts_with("https://") {
        Ok(normalized)
    } else {
        Err(AirhopError(format!("invalid BUZZ_RELAY_URL: {value}")))
    }
}

fn parse_tag<const N: usize>(parts: [&str; N]) -> Result<Tag, AirhopError> {
    Tag::parse(parts).map_err(|error| AirhopError(format!("invalid Airhop tag: {error}")))
}

fn validate_messages(messages: &[String]) -> Result<(), AirhopError> {
    if !(1..=MAX_MESSAGES).contains(&messages.len()) {
        return Err(AirhopError(format!(
            "messages must contain 1..={MAX_MESSAGES} items"
        )));
    }
    for (index, message) in messages.iter().enumerate() {
        let chars = message.chars().count();
        if message.trim().is_empty() || chars > MAX_MESSAGE_CHARS {
            return Err(AirhopError(format!(
                "message {} must contain 1..={MAX_MESSAGE_CHARS} characters",
                index + 1
            )));
        }
    }
    Ok(())
}

fn decode_parent_context(config: &AirhopConfig) -> Result<ParentContextClaims, AirhopError> {
    let token = config.current_context_grant()?.ok_or_else(|| {
        AirhopError("parent administrator has no active context grant".to_owned())
    })?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&token)
        .map_err(|_| AirhopError("parent context grant is malformed".to_owned()))?;
    let envelope: Event = serde_json::from_slice(&bytes)
        .map_err(|_| AirhopError("parent context grant envelope is malformed".to_owned()))?;
    serde_json::from_str(&envelope.content)
        .map_err(|_| AirhopError("parent context grant claims are malformed".to_owned()))
}

fn build_parent_reply_events(
    config: &AirhopConfig,
    claims: &ParentContextClaims,
    messages: Vec<String>,
) -> Result<Vec<Event>, AirhopError> {
    validate_messages(&messages)?;
    let channel = claims.channel_id.to_string();
    let turn_id = claims.turn_id.to_string();
    messages
        .into_iter()
        .map(|message| {
            config.sign_event(
                EventBuilder::new(
                    Kind::Custom(buzz_core::kind::KIND_STREAM_MESSAGE as u16),
                    message,
                )
                .tags([
                    parse_tag(["h", channel.as_str()])?,
                    parse_tag([
                        "airhop-agent-turn",
                        AirhopRole::ParentAdministrator.as_str(),
                    ])?,
                    parse_tag(["airhop-hermes-turn", turn_id.as_str()])?,
                ]),
            )
        })
        .collect()
}

fn build_parent_handoff_event(
    config: &AirhopConfig,
    claims: &ParentContextClaims,
    reason: &str,
    targets: &[ParentHandoffTarget],
) -> Result<Event, AirhopError> {
    if targets.is_empty() || targets.len() > 8 {
        return Err(AirhopError(
            "no authorized staff is available for this conversation".to_owned(),
        ));
    }
    let mut tags = vec![
        parse_tag(["h", claims.channel_id.to_string().as_str()])?,
        parse_tag(["airhop-handoff", "responsible"])?,
        parse_tag(["airhop-hermes-turn", claims.turn_id.to_string().as_str()])?,
    ];
    let mut mentions = Vec::with_capacity(targets.len());
    for target in targets {
        let pubkey = PublicKey::from_hex(&target.pubkey)
            .map_err(|_| AirhopError("invalid server staff identity".to_owned()))?;
        tags.push(parse_tag(["p", pubkey.to_hex().as_str()])?);
        mentions.push(format!("@{}", target.display_name));
    }
    config.sign_event(
        EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_STREAM_MESSAGE as u16),
            format!("{}\n{}", mentions.join(" "), reason.trim()),
        )
        .tags(tags),
    )
}

fn build_message_events(
    config: &AirhopConfig,
    params: SendMessagesParams,
) -> Result<Vec<Event>, AirhopError> {
    config.require_channel(params.channel_id)?;
    validate_messages(&params.messages)?;
    if let Some(stage) = params.kickoff_stage {
        if stage.role() != config.role {
            return Err(AirhopError(format!(
                "kickoff stage {} belongs to {}, not {}",
                stage.as_str(),
                stage.role().as_str(),
                config.role.as_str()
            )));
        }
    }
    let message_count = params.messages.len();
    params
        .messages
        .into_iter()
        .enumerate()
        .map(|(index, message)| {
            let channel = params.channel_id.to_string();
            let mut tags = vec![
                parse_tag(["h", channel.as_str()])?,
                parse_tag(["airhop-agent-turn", config.role.as_str()])?,
            ];
            if params.expects_reply && index + 1 == message_count {
                tags.push(parse_tag(["airhop-question", config.role.as_str()])?);
            }
            if let Some(stage) = params.kickoff_stage {
                tags.push(parse_tag(["airhop-kickoff-stage", stage.as_str()])?);
            }
            config.sign_event(
                EventBuilder::new(
                    Kind::Custom(buzz_core::kind::KIND_STREAM_MESSAGE as u16),
                    message,
                )
                .tags(tags),
            )
        })
        .collect()
}

fn build_delegate_event(
    config: &AirhopConfig,
    params: DelegateParams,
    target_pubkey: PublicKey,
) -> Result<Event, AirhopError> {
    config.require_channel(params.channel_id)?;
    if config.role != AirhopRole::Fizz {
        return Err(AirhopError(
            "only Fizz may delegate work to Airhop specialists".to_owned(),
        ));
    }
    if params.target_role == AirhopRole::Fizz {
        return Err(AirhopError(
            "Fizz delegation must target a specialist role".to_owned(),
        ));
    }
    let assignment = params.assignment.trim();
    if assignment.is_empty() || assignment.chars().count() > MAX_ASSIGNMENT_CHARS {
        return Err(AirhopError(format!(
            "assignment must contain 1..={MAX_ASSIGNMENT_CHARS} characters"
        )));
    }
    let channel = params.channel_id.to_string();
    let target = target_pubkey.to_hex();
    let task_id = Uuid::new_v4().to_string();
    let tags = vec![
        parse_tag(["h", channel.as_str()])?,
        parse_tag(["p", target.as_str()])?,
        parse_tag(["airhop-agent-turn", AirhopRole::Fizz.as_str()])?,
        parse_tag(["airhop-handoff", params.target_role.as_str()])?,
        parse_tag(["airhop-task", task_id.as_str()])?,
    ];
    config.sign_event(
        EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_AIRHOP_AGENT_TASK as u16),
            assignment,
        )
        .tags(tags),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WelcomeManifest {
    channel_id: Uuid,
    members: BTreeMap<AirhopRole, String>,
}

#[derive(Clone)]
struct AirhopService {
    config: Arc<AirhopConfig>,
}

impl AirhopService {
    fn new(config: AirhopConfig) -> Self {
        Self {
            config: Arc::new(config),
        }
    }

    async fn send_messages(&self, params: SendMessagesParams) -> Result<Value, AirhopError> {
        let events = build_message_events(&self.config, params)?;
        let mut event_ids = Vec::with_capacity(events.len());
        for event in events {
            self.config.submit_event(&event).await?;
            event_ids.push(event.id.to_hex());
        }
        Ok(json!({ "eventIds": event_ids }))
    }

    async fn send_parent_reply(&self, params: SendParentReplyParams) -> Result<Value, AirhopError> {
        if self.config.role != AirhopRole::ParentAdministrator {
            return Err(AirhopError(
                "only the Parent Administrator may commit a parent reply".to_owned(),
            ));
        }
        let claims = decode_parent_context(&self.config)?;
        let mut events = build_parent_reply_events(&self.config, &claims, params.messages)?;
        if let Some(reason) = params.handoff_reason {
            if reason.trim().is_empty() || reason.len() > 2000 {
                return Err(AirhopError(
                    "handoffReason must contain 1–2000 bytes".to_owned(),
                ));
            }
            let context = self.get_turn_context().await?;
            let targets: Vec<ParentHandoffTarget> = serde_json::from_value(
                context
                    .pointer("/data/handoffTargets")
                    .cloned()
                    .unwrap_or(Value::Null),
            )
            .map_err(|_| AirhopError("staff handoff targets are unavailable".to_owned()))?;
            events.push(build_parent_handoff_event(
                &self.config,
                &claims,
                &reason,
                &targets,
            )?);
        }
        let path = format!("/api/airhop/agents/v1/turns/{}/reply", claims.turn_id);
        self.config
            .post_json(
                &path,
                &json!({
                    "leaseToken": claims.turn_lease_token,
                    "events": events,
                }),
            )
            .await
    }

    async fn delegate(&self, params: DelegateParams) -> Result<Value, AirhopError> {
        self.config.require_channel(params.channel_id)?;
        if self.config.role != AirhopRole::Fizz {
            return Err(AirhopError(
                "only Fizz may delegate work to Airhop specialists".to_owned(),
            ));
        }
        let manifest_value = self
            .config
            .get_json("/api/airhop/agents/v1/welcome-team")
            .await?;
        let manifest: WelcomeManifest = serde_json::from_value(manifest_value)
            .map_err(|error| AirhopError(format!("invalid Welcome manifest: {error}")))?;
        if Some(manifest.channel_id) != self.config.channel_id {
            return Err(AirhopError(
                "Welcome manifest channel does not match the configured channel".to_owned(),
            ));
        }
        let target_hex = manifest.members.get(&params.target_role).ok_or_else(|| {
            AirhopError(format!(
                "Welcome manifest has no {} agent",
                params.target_role.as_str()
            ))
        })?;
        let target = PublicKey::from_hex(target_hex)
            .map_err(|error| AirhopError(format!("invalid target pubkey: {error}")))?;
        let target_role = params.target_role;
        let event = build_delegate_event(&self.config, params, target)?;
        self.config.submit_event(&event).await?;
        Ok(json!({
            "eventId": event.id.to_hex(),
            "targetRole": target_role,
            "targetPubkey": target.to_hex(),
        }))
    }

    async fn read(&self, params: ReadParams) -> Result<Value, AirhopError> {
        self.config.require_channel(params.channel_id)?;
        let resource = params.resolve_resource()?;
        if !self.config.role.allows(&resource) {
            return Err(AirhopError(format!(
                "{} may not read {}",
                self.config.role.as_str(),
                resource.name()
            )));
        }
        read_authoritative(&self.config, &resource).await
    }

    async fn prepare_action(&self, params: PrepareActionParams) -> Result<Value, AirhopError> {
        self.config.require_channel(params.channel_id)?;
        if self.config.role != AirhopRole::Administrator {
            return Err(AirhopError(
                "only the Administrator may prepare Airhop setup actions".to_owned(),
            ));
        }
        let triggering_event_id = params.triggering_event_id.trim();
        if triggering_event_id.len() != 64
            || !triggering_event_id
                .bytes()
                .all(|value| value.is_ascii_hexdigit())
        {
            return Err(AirhopError(
                "triggeringEventId must be a 64-character hex event ID".to_owned(),
            ));
        }
        let command = serde_json::to_value(params.command)
            .map_err(|error| AirhopError(format!("command serialization failed: {error}")))?;
        self.config
            .post_json(
                "/api/airhop/agents/v1/actions/prepare",
                &json!({
                    "channelId": params.channel_id,
                    "triggeringEventId": triggering_event_id,
                    "command": command,
                }),
            )
            .await
    }

    async fn site_content_context(&self) -> Result<SiteContentContext, AirhopError> {
        let value = self.config.get_json(SITE_CONTENT_CONTEXT_PATH).await?;
        let context: SiteContentContext = serde_json::from_value(value)
            .map_err(|error| AirhopError(format!("invalid site-content context: {error}")))?;
        if self.config.channel_id != Some(context.welcome_channel_id) {
            return Err(AirhopError(
                "site-content context is bound to another Welcome channel".to_owned(),
            ));
        }
        Ok(context)
    }

    async fn propose_site_content(
        &self,
        params: ProposeSiteContentParams,
    ) -> Result<Value, AirhopError> {
        self.config.require_channel(params.channel_id)?;
        if self.config.role != AirhopRole::ContentMarketer {
            return Err(AirhopError(
                "only the Content Marketer may prepare site content".to_owned(),
            ));
        }
        validate_hex_event_id(&params.triggering_event_id, "triggeringEventId")?;
        validate_site_content_changes(&params.changes)?;
        let context = self.site_content_context().await?;
        let base = format!(
            "{}/api/hq/v1/center/installations/{}/site-content",
            context.hq_api_origin.trim_end_matches('/'),
            context.installation_id
        );
        let delivery = self
            .config
            .request_absolute_json(Method::GET, &base, None)
            .await?;
        let revision = delivery
            .pointer("/content/revision")
            .and_then(Value::as_i64)
            .filter(|value| *value > 0)
            .ok_or_else(|| AirhopError("HQ site content has no valid revision".to_owned()))?;
        let changes = serde_json::to_value(params.changes)
            .map_err(|error| AirhopError(format!("changes serialization failed: {error}")))?;
        let request_digest = hex::encode(Sha256::digest(
            serde_json::to_vec(&changes)
                .map_err(|error| AirhopError(format!("changes serialization failed: {error}")))?,
        ));
        let proposal = self
            .config
            .request_absolute_json(
                Method::POST,
                &format!("{base}/previews"),
                Some(&json!({
                    "expectedContentRevision": revision,
                    "changes": changes,
                    "source": {
                        "channel": "center",
                        "conversationId": params.channel_id,
                        "messageId": params.triggering_event_id,
                    },
                    "idempotencyKey": format!(
                        "center-propose:{}:{}",
                        params.triggering_event_id,
                        &request_digest[..32]
                    ),
                })),
            )
            .await?;
        let preview_id = required_json_str(&proposal, "/preview/id", "HQ preview id")?;
        let preview_text = required_json_str(
            &proposal,
            "/centerConfirmation/previewText",
            "HQ preview text",
        )?;
        let preview_digest = required_json_str(
            &proposal,
            "/centerConfirmation/previewDigest",
            "HQ preview digest",
        )?;
        let confirmation_phrase = required_json_str(
            &proposal,
            "/centerConfirmation/confirmationPhrase",
            "HQ confirmation phrase",
        )?;
        let channel = params.channel_id.to_string();
        let installation = context.installation_id.to_string();
        let event = self.config.sign_event(
            EventBuilder::new(
                Kind::Custom(buzz_core::kind::KIND_STREAM_MESSAGE as u16),
                preview_text,
            )
            .tags([
                parse_tag(["h", channel.as_str()])?,
                parse_tag(["airhop-agent-turn", AirhopRole::ContentMarketer.as_str()])?,
                parse_tag(["airhop-question", AirhopRole::ContentMarketer.as_str()])?,
                parse_tag([
                    "airhop-site-preview",
                    installation.as_str(),
                    preview_id,
                    "1",
                    preview_digest,
                ])?,
            ]),
        )?;
        self.config.submit_event(&event).await?;
        Ok(json!({
            "confirmationPhrase": confirmation_phrase,
            "expiresAt": proposal.pointer("/preview/expiresAt"),
            "hqPreviewId": preview_id,
            "previewEventId": event.id.to_hex(),
            "status": "waiting_for_owner_confirmation",
        }))
    }

    async fn confirm_site_content(
        &self,
        params: ConfirmSiteContentParams,
    ) -> Result<Value, AirhopError> {
        self.config.require_channel(params.channel_id)?;
        if self.config.role != AirhopRole::ContentMarketer {
            return Err(AirhopError(
                "only the Content Marketer may submit site confirmation".to_owned(),
            ));
        }
        validate_hex_event_id(&params.preview_event_id, "previewEventId")?;
        validate_hex_event_id(&params.confirmation_event_id, "confirmationEventId")?;
        let context = self.site_content_context().await?;
        let queried = self
            .config
            .post_json(
                "/query",
                &json!([{
                    "ids": [params.preview_event_id, params.confirmation_event_id],
                    "kinds": [buzz_core::kind::KIND_STREAM_MESSAGE],
                }]),
            )
            .await?;
        let events = queried
            .as_array()
            .ok_or_else(|| AirhopError("Center event query is not an array".to_owned()))?;
        let preview_event = find_event(events, &params.preview_event_id)?;
        let confirmation_event = find_event(events, &params.confirmation_event_id)?;
        let preview_tag = preview_event
            .get("tags")
            .and_then(Value::as_array)
            .and_then(|tags| {
                tags.iter().find_map(|tag| {
                    let parts = tag.as_array()?;
                    (parts.first()?.as_str()? == "airhop-site-preview").then_some(parts)
                })
            })
            .ok_or_else(|| AirhopError("preview event has no site-preview tag".to_owned()))?;
        let tag_part = |index: usize| preview_tag.get(index).and_then(Value::as_str);
        let installation_id = context.installation_id.to_string();
        if tag_part(1) != Some(installation_id.as_str()) || tag_part(3) != Some("1") {
            return Err(AirhopError(
                "preview event belongs to another Center installation".to_owned(),
            ));
        }
        let preview_id = tag_part(2)
            .ok_or_else(|| AirhopError("preview event has no HQ preview id".to_owned()))?;
        let url = format!(
            "{}/api/hq/v1/center/installations/{}/site-content/previews/{preview_id}/confirm",
            context.hq_api_origin.trim_end_matches('/'),
            context.installation_id,
        );
        let result = self
            .config
            .request_absolute_json(
                Method::POST,
                &url,
                Some(&json!({
                    "idempotencyKey": format!(
                        "center-confirm:{}:{}",
                        preview_id,
                        params.confirmation_event_id
                    ),
                    "centerEvidence": {
                        "previewEvent": preview_event,
                        "confirmationEvent": confirmation_event,
                    },
                })),
            )
            .await?;
        Ok(json!({
            "contentRevision": result.pointer("/content/revision"),
            "deploymentJobId": result.pointer("/deploymentJob/id"),
            "deploymentStatus": result.pointer("/deploymentJob/status"),
            "hqPreviewId": preview_id,
            "status": "confirmed_and_queued_for_deploy",
        }))
    }

    async fn call_parent_backend(&self, request: Value) -> Result<Value, AirhopError> {
        if self.config.role != AirhopRole::ParentAdministrator {
            return Err(AirhopError(
                "only the Parent Administrator may use the parent Agent Backend".to_owned(),
            ));
        }
        self.config.post_json(AGENT_BACKEND_PATH, &request).await
    }

    async fn get_turn_context(&self) -> Result<Value, AirhopError> {
        self.call_parent_backend(json!({ "operation": "get_turn_context" }))
            .await
    }

    async fn get_family(&self) -> Result<Value, AirhopError> {
        self.call_parent_backend(json!({ "operation": "get_family" }))
            .await
    }

    async fn list_booking_options(
        &self,
        params: ListBookingOptionsParams,
    ) -> Result<Value, AirhopError> {
        self.call_parent_backend(json!({
            "operation": "list_booking_options",
            "branchId": params.branch_id,
            "groupId": params.group_id,
            "purpose": params.purpose,
            "ageYears": params.age_years,
        }))
        .await
    }

    async fn search_knowledge(&self, params: SearchKnowledgeParams) -> Result<Value, AirhopError> {
        self.call_parent_backend(json!({
            "operation": "search_knowledge",
            "query": params.query,
            "locale": params.locale,
            "limit": params.limit,
        }))
        .await
    }

    async fn manage_booking(&self, params: ManageBookingParams) -> Result<Value, AirhopError> {
        self.call_parent_backend(json!({
            "operation": "manage_booking",
            "bookingId": params.booking_id,
            "action": params.action,
        }))
        .await
    }
}

fn validate_hex_event_id(value: &str, name: &str) -> Result<(), AirhopError> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(AirhopError(format!(
            "{name} must be a 64-character hex event ID"
        )))
    }
}

fn validate_site_content_changes(changes: &[SiteContentChange]) -> Result<(), AirhopError> {
    if changes.is_empty() || changes.len() > 100 {
        return Err(AirhopError("changes must contain 1..=100 items".to_owned()));
    }
    let mut seen = BTreeSet::new();
    for change in changes {
        if !seen.insert(change.key) {
            return Err(AirhopError("site-content keys must be unique".to_owned()));
        }
    }
    Ok(())
}

fn required_json_str<'a>(
    value: &'a Value,
    pointer: &str,
    label: &str,
) -> Result<&'a str, AirhopError> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AirhopError(format!("{label} is missing")))
}

fn find_event<'a>(events: &'a [Value], event_id: &str) -> Result<&'a Value, AirhopError> {
    events
        .iter()
        .find(|event| event.get("id").and_then(Value::as_str) == Some(event_id))
        .ok_or_else(|| AirhopError(format!("Center event {event_id} was not found")))
}

async fn read_authoritative(
    config: &AirhopConfig,
    resource: &ReadResource,
) -> Result<Value, AirhopError> {
    let settings = config.get_json(SETTINGS_PATH).await?;
    let organization = settings.get("organization").ok_or_else(|| {
        AirhopError("organization settings response has no organization".to_owned())
    })?;
    let locale = organization
        .get("locale")
        .and_then(Value::as_str)
        .ok_or_else(|| AirhopError("organization settings response has no locale".to_owned()))?
        .to_owned();
    let time_zone = organization
        .get("timeZone")
        .and_then(Value::as_str)
        .ok_or_else(|| AirhopError("organization settings response has no timeZone".to_owned()))?
        .to_owned();
    let data = match resource {
        ReadResource::OrganizationSettings => settings,
        ReadResource::PublicBookingSettings => json!({
            "organizationId": organization.get("id"),
            "name": organization.get("name"),
            "publicBooking": organization.get("publicBooking"),
        }),
        _ => {
            config
                .get_json(
                    resource
                        .path()
                        .as_deref()
                        .expect("non-settings resources have an endpoint"),
                )
                .await?
        }
    };
    Ok(json!({
        "resource": resource.name(),
        "locale": locale,
        "timeZone": time_zone,
        "data": data,
    }))
}

fn tools_for(role: AirhopRole) -> BTreeSet<String> {
    if role == AirhopRole::ParentAdministrator {
        return BTreeSet::from([
            "airhop_get_turn_context".to_owned(),
            "airhop_get_family".to_owned(),
            "airhop_list_booking_options".to_owned(),
            "airhop_search_knowledge".to_owned(),
            "airhop_manage_booking".to_owned(),
            "airhop_send_parent_reply".to_owned(),
        ]);
    }
    let mut tools = BTreeSet::from(["airhop_read".to_owned(), "airhop_send_messages".to_owned()]);
    match role {
        AirhopRole::Fizz => {
            tools.insert("airhop_delegate".to_owned());
        }
        AirhopRole::Administrator => {
            tools.insert("airhop_prepare_action".to_owned());
        }
        AirhopRole::ContentMarketer => {
            tools.insert("airhop_propose_site_content".to_owned());
            tools.insert("airhop_confirm_site_content".to_owned());
        }
        AirhopRole::Analyst | AirhopRole::ParentAdministrator => {}
    }
    tools
}

fn as_tool_result(result: Result<Value, AirhopError>) -> CallToolResult {
    match result {
        Ok(value) => CallToolResult::success(vec![Content::text(value.to_string())]),
        Err(error) => CallToolResult::error(vec![Content::text(error.to_string())]),
    }
}

#[derive(Clone)]
struct AirhopMcp {
    service: AirhopService,
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl AirhopMcp {
    fn new(config: AirhopConfig) -> Self {
        let role = config.role;
        let allowed = tools_for(role);
        let mut tool_router = Self::tool_router();
        for name in [
            "airhop_send_messages",
            "airhop_delegate",
            "airhop_read",
            "airhop_prepare_action",
            "airhop_propose_site_content",
            "airhop_confirm_site_content",
            "airhop_get_turn_context",
            "airhop_get_family",
            "airhop_list_booking_options",
            "airhop_search_knowledge",
            "airhop_manage_booking",
            "airhop_send_parent_reply",
        ] {
            if !allowed.contains(name) {
                tool_router.disable_route(name.to_owned());
            }
        }
        Self {
            service: AirhopService::new(config),
            tool_router,
        }
    }

    #[tool(
        name = "airhop_send_messages",
        description = "Send one to three short top-level messages to the registered Airhop Welcome channel. The final message can remain an open question. Never creates a thread."
    )]
    async fn send_messages(
        &self,
        Parameters(params): Parameters<SendMessagesParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(self.service.send_messages(params).await))
    }

    #[tool(
        name = "airhop_delegate",
        description = "Fizz only: assign one concrete task to a registered Airhop specialist in the same Welcome channel."
    )]
    async fn delegate(
        &self,
        Parameters(params): Parameters<DelegateParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(self.service.delegate(params).await))
    }

    #[tool(
        name = "airhop_read",
        description = "Read current, authoritative Airhop organization data allowed for this specialist role. Results include organization locale and time zone."
    )]
    async fn read(
        &self,
        Parameters(params): Parameters<ReadParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(self.service.read(params).await))
    }

    #[tool(
        name = "airhop_prepare_action",
        description = "Administrator only: prepare a typed Airhop setup action for explicit human confirmation. This does not commit the mutation."
    )]
    async fn prepare_action(
        &self,
        Parameters(params): Parameters<PrepareActionParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(self.service.prepare_action(params).await))
    }

    #[tool(
        name = "airhop_propose_site_content",
        description = "Content Marketer only: create an immutable HQ site-content preview and post the exact confirmation prompt in the Airhop Welcome channel. Does not publish. Use marketing.headline for the visible main page heading and marketing.seo_title only for the browser/search title."
    )]
    async fn propose_site_content(
        &self,
        Parameters(params): Parameters<ProposeSiteContentParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(
            self.service.propose_site_content(params).await,
        ))
    }

    #[tool(
        name = "airhop_confirm_site_content",
        description = "Content Marketer only: submit the owner's exact signed confirmation message for an immutable Center preview. HQ verifies the owner proof and queues deployment."
    )]
    async fn confirm_site_content(
        &self,
        Parameters(params): Parameters<ConfirmSiteContentParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(
            self.service.confirm_site_content(params).await,
        ))
    }

    #[tool(
        name = "airhop_get_turn_context",
        description = "Parent Administrator only: load the immutable server-authorized scope for this turn, including organization, verified Family summary, and granted capabilities. Call this before acting."
    )]
    async fn get_turn_context(
        &self,
        Parameters(_params): Parameters<GetTurnContextParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(self.service.get_turn_context().await))
    }

    #[tool(
        name = "airhop_get_family",
        description = "Parent Administrator only: load the parent-safe Family, children, enrollments, and bookings bound to this turn. The model cannot choose another Family."
    )]
    async fn get_family(
        &self,
        Parameters(_params): Parameters<GetFamilyParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(self.service.get_family().await))
    }

    #[tool(
        name = "airhop_list_booking_options",
        description = "Parent Administrator only: list current authoritative booking options. Optional filters narrow the result but cannot change the organization or Family scope."
    )]
    async fn list_booking_options(
        &self,
        Parameters(params): Parameters<ListBookingOptionsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(
            self.service.list_booking_options(params).await,
        ))
    }

    #[tool(
        name = "airhop_search_knowledge",
        description = "Parent Administrator only: search published parent-visible knowledge in the current organization and verified Family scope."
    )]
    async fn search_knowledge(
        &self,
        Parameters(params): Parameters<SearchKnowledgeParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(self.service.search_knowledge(params).await))
    }

    #[tool(
        name = "airhop_manage_booking",
        description = "Parent Administrator only: confirm_online for the verified online-handoff booking, cancel or request transfer of one booking in the granted Family. Confirmation rechecks current Core rules and requires enabled auto-confirm policy. Report confirmation only after a successful authoritative receipt; otherwise hand off to staff."
    )]
    async fn manage_booking(
        &self,
        Parameters(params): Parameters<ManageBookingParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(self.service.manage_booking(params).await))
    }

    #[tool(
        name = "airhop_send_parent_reply",
        description = "Parent Administrator only: atomically commit the final one-to-three-message parent reply. Set handoffReason to notify the server-selected staff in a separate INTERNAL mention and pause Hermes until an explicit staff resume. This is the only way to actually hand off a parent request. Never promise a handoff without a successful receipt."
    )]
    async fn send_parent_reply(
        &self,
        Parameters(params): Parameters<SendParentReplyParams>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(as_tool_result(self.service.send_parent_reply(params).await))
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for AirhopMcp {
    fn get_info(&self) -> ServerInfo {
        let instructions = if self.service.config.role == AirhopRole::ParentAdministrator {
            "Use only the visible server-scoped Airhop tools. Load turn context first. Never infer or request identifiers outside the granted conversation and Family scope. Send parent-facing output only through airhop_send_parent_reply; never use a generic Buzz send tool."
        } else {
            "Use only the visible role-scoped Airhop tools. Keep Welcome flat and concise."
        };
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(rmcp::model::Implementation::new(
                "airhop-agent-mcp",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(instructions)
    }
}

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = AirhopConfig::from_env()?;
    let service = AirhopMcp::new(config).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::sync::{Arc, Mutex};

    use axum::body::Bytes;
    use axum::extract::State;
    use axum::http::HeaderMap;
    use axum::response::Json;
    use axum::routing::{get, post};
    use axum::Router;
    use nostr::Keys;
    use uuid::Uuid;

    use super::*;

    fn set(values: &[&str]) -> BTreeSet<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn airhop_read_wire_shape_accepts_uuid_strings() {
        let channel_id = Uuid::new_v4();
        let family_id = Uuid::new_v4();
        let params: ReadParams = serde_json::from_value(json!({
            "channelId": channel_id,
            "resource": "family_detail",
            "familyId": family_id,
        }))
        .expect("valid airhop_read parameters");
        assert_eq!(params.channel_id, channel_id);
        assert!(matches!(
            params.resolve_resource().expect("valid family detail"),
            ReadResource::FamilyDetail { family_id: parsed } if parsed == family_id
        ));
        assert!(serde_json::from_value::<ReadParams>(json!({
            "channelId": channel_id,
            "resource": "families",
            "unexpected": true,
        }))
        .is_err());
        let missing_family_id: ReadParams = serde_json::from_value(json!({
            "channelId": channel_id,
            "resource": "family_detail",
        }))
        .expect("valid wire shape");
        assert!(missing_family_id.resolve_resource().is_err());
        let stray_family_id: ReadParams = serde_json::from_value(json!({
            "channelId": channel_id,
            "resource": "families",
            "familyId": family_id,
        }))
        .expect("valid wire shape");
        assert!(stray_family_id.resolve_resource().is_err());
    }

    #[test]
    fn airhop_role_capabilities_are_hidden_not_runtime_denied() {
        assert_eq!(
            tools_for(AirhopRole::Fizz),
            set(&["airhop_delegate", "airhop_read", "airhop_send_messages",])
        );
        assert!(!tools_for(AirhopRole::Fizz).contains("airhop_prepare_action"));
        assert!(tools_for(AirhopRole::Administrator).contains("airhop_prepare_action"));
        assert!(!tools_for(AirhopRole::ContentMarketer).contains("airhop_publish"));
        assert_eq!(
            tools_for(AirhopRole::ParentAdministrator),
            set(&[
                "airhop_get_turn_context",
                "airhop_get_family",
                "airhop_list_booking_options",
                "airhop_search_knowledge",
                "airhop_manage_booking",
                "airhop_send_parent_reply",
            ])
        );
        assert!(!tools_for(AirhopRole::ParentAdministrator).contains("airhop_read"));
        assert!(AirhopRole::parse_config("").is_err());
        assert!(AirhopRole::parse_config("owner").is_err());

        assert_eq!(
            tools_for(AirhopRole::ContentMarketer),
            set(&[
                "airhop_confirm_site_content",
                "airhop_propose_site_content",
                "airhop_read",
                "airhop_send_messages",
            ])
        );

        for role in [
            AirhopRole::Fizz,
            AirhopRole::Administrator,
            AirhopRole::Analyst,
            AirhopRole::ContentMarketer,
            AirhopRole::ParentAdministrator,
        ] {
            let mcp = AirhopMcp::new(AirhopConfig::for_test(
                role,
                Uuid::new_v4(),
                "http://127.0.0.1:1",
                Keys::generate(),
            ));
            let listed: BTreeSet<String> = mcp
                .tool_router
                .list_all()
                .into_iter()
                .map(|tool| tool.name.into_owned())
                .collect();
            assert_eq!(listed, tools_for(role));
        }
    }

    #[test]
    fn parent_backend_tool_wire_shapes_are_closed() {
        let booking_id = Uuid::new_v4();
        let options: ListBookingOptionsParams = serde_json::from_value(json!({
            "branchId": Uuid::new_v4(),
            "purpose": "trial",
            "ageYears": 7,
        }))
        .expect("booking filters");
        assert!(matches!(options.purpose, Some(BookingPurpose::Trial)));

        let search: SearchKnowledgeParams = serde_json::from_value(json!({
            "query": "что взять с собой"
        }))
        .expect("knowledge search");
        assert_eq!(search.limit, default_parent_knowledge_limit());

        let transfer: ManageBookingParams = serde_json::from_value(json!({
            "bookingId": booking_id,
            "action": {
                "type": "request_transfer",
                "comment": "Нужен другой день"
            }
        }))
        .expect("transfer action");
        assert_eq!(transfer.booking_id, booking_id);
        assert!(matches!(
            transfer.action,
            ParentBookingAction::RequestTransfer { .. }
        ));

        assert!(serde_json::from_value::<ManageBookingParams>(json!({
            "bookingId": booking_id,
            "action": {"type": "delete"}
        }))
        .is_err());
        assert!(serde_json::from_value::<GetTurnContextParams>(json!({
            "familyId": Uuid::new_v4()
        }))
        .is_err());
    }

    #[test]
    fn parent_reply_uses_hidden_grant_scope_and_signed_top_level_events() {
        let channel_id = Uuid::new_v4();
        let turn_id = Uuid::new_v4();
        let lease_token = Uuid::new_v4();
        let keys = Keys::generate();
        let grant = EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_AIRHOP_AGENT_CONTEXT_GRANT as u16),
            json!({
                "channelId": channel_id,
                "turnId": turn_id,
                "turnLeaseToken": lease_token,
            })
            .to_string(),
        )
        .sign_with_keys(&Keys::generate())
        .unwrap();
        let mut config = AirhopConfig::for_test(
            AirhopRole::ParentAdministrator,
            Uuid::new_v4(),
            "http://127.0.0.1:3000",
            keys,
        );
        config.channel_id = None;
        config.context_grant = Some(
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(&grant).unwrap()),
        );
        let claims = decode_parent_context(&config).unwrap();
        assert_eq!(claims.channel_id, channel_id);
        assert_eq!(claims.turn_id, turn_id);
        assert_eq!(claims.turn_lease_token, lease_token);

        let events = build_parent_reply_events(&config, &claims, vec!["Всё готово.".into()])
            .expect("signed parent reply");
        assert_eq!(events.len(), 1);
        assert!(events[0].verify_signature());
        assert!(events[0].tags.iter().any(|tag| {
            let values = tag.as_slice();
            values.len() >= 2 && values[0] == "h" && values[1] == channel_id.to_string()
        }));
        assert!(!events[0]
            .tags
            .iter()
            .any(|tag| tag.as_slice().first().is_some_and(|value| value == "e")));
        let staff = Keys::generate();
        let handoff = build_parent_handoff_event(
            &config,
            &claims,
            "Нужна помощь",
            &[ParentHandoffTarget {
                pubkey: staff.public_key().to_hex(),
                display_name: "Андрей".into(),
            }],
        )
        .unwrap();
        assert!(handoff.verify_signature());
        assert_eq!(handoff.pubkey, events[0].pubkey);
        assert!(handoff
            .tags
            .iter()
            .any(|tag| tag.as_slice() == ["p", staff.public_key().to_hex().as_str()]));
        assert!(handoff
            .tags
            .iter()
            .any(|tag| tag.as_slice() == ["airhop-handoff", "responsible"]));
        assert_eq!(handoff.content, "@Андрей\nНужна помощь");
        assert!(build_parent_handoff_event(&config, &claims, "help", &[]).is_err());
    }

    #[test]
    fn prepare_action_wire_is_closed_and_requires_a_trigger_event() {
        let channel_id = Uuid::new_v4();
        let params: PrepareActionParams = serde_json::from_value(json!({
            "channelId": channel_id,
            "triggeringEventId": "ab".repeat(32),
            "command": {
                "type": "create_room",
                "input": {
                    "branchId": Uuid::new_v4(),
                    "body": {"name": "Blue"}
                }
            }
        }))
        .expect("closed setup command");
        assert!(matches!(
            params.command,
            PrepareAgentCommand::CreateRoom { .. }
        ));
        assert!(serde_json::from_value::<PrepareActionParams>(json!({
            "channelId": channel_id,
            "triggeringEventId": "ab".repeat(32),
            "command": {"type": "delete_everything", "input": {}}
        }))
        .is_err());
        assert!(serde_json::from_value::<PrepareActionParams>(json!({
            "channelId": channel_id,
            "command": {"type": "create_teacher", "input": {"displayName": "Ann"}}
        }))
        .is_err());
    }

    #[test]
    fn site_content_changes_are_closed_and_role_safe() {
        let valid: ProposeSiteContentParams = serde_json::from_value(json!({
            "channelId": Uuid::new_v4(),
            "triggeringEventId": "ab".repeat(32),
            "changes": [{
                "key": "operations.schedule",
                "value": [{"title": "Рисование", "days": "Вт, Чт", "time": "19:00"}]
            }]
        }))
        .expect("canonical site content should parse");
        assert!(validate_site_content_changes(&valid.changes).is_ok());
        assert!(validate_site_content_changes(&[]).is_err());
        assert!(serde_json::from_value::<ProposeSiteContentParams>(json!({
            "channelId": Uuid::new_v4(),
            "triggeringEventId": "ab".repeat(32),
            "changes": [{"key": "internal.ssh_key", "value": "secret"}]
        }))
        .is_err());
        assert!(serde_json::from_value::<ProposeSiteContentParams>(json!({
            "channelId": Uuid::new_v4(),
            "triggeringEventId": "ab".repeat(32),
            "changes": [{"key": "marketing.headline", "value": "A", "publish": true}]
        }))
        .is_err());

        let duplicate: ProposeSiteContentParams = serde_json::from_value(json!({
            "channelId": Uuid::new_v4(),
            "triggeringEventId": "ab".repeat(32),
            "changes": [
                {"key": "marketing.headline", "value": "A"},
                {"key": "marketing.headline", "value": "B"}
            ]
        }))
        .expect("duplicate keys are a semantic validation error");
        assert!(validate_site_content_changes(&duplicate.changes).is_err());
    }

    #[test]
    fn site_content_heading_aliases_normalize_to_hq_contract() {
        for alias in ["headline", "title", "site_title"] {
            let change: SiteContentChange = serde_json::from_value(json!({
                "key": alias,
                "value": "Проверка публикации"
            }))
            .expect("common heading alias should parse");
            assert_eq!(change.key, SiteContentKey::MarketingHeadline);
            assert_eq!(
                serde_json::to_value(change).expect("change should serialize"),
                json!({
                    "key": "marketing.headline",
                    "value": "Проверка публикации"
                })
            );
        }
    }

    #[test]
    fn airhop_channel_and_message_contract_is_flat_and_bounded() {
        let channel_id = Uuid::new_v4();
        let config = AirhopConfig::for_test(
            AirhopRole::Administrator,
            channel_id,
            "http://127.0.0.1:1",
            Keys::generate(),
        );
        let events = build_message_events(
            &config,
            SendMessagesParams {
                channel_id,
                messages: vec!["Первое".into(), "Второе".into()],
                expects_reply: true,
                kickoff_stage: Some(WelcomeKickoffStage::AdministratorIntro),
            },
        )
        .expect("valid Welcome messages");
        assert_eq!(events.len(), 2);
        for (index, event) in events.into_iter().enumerate() {
            let tags: Vec<Vec<String>> = event
                .tags
                .iter()
                .map(|tag| tag.as_slice().to_vec())
                .collect();
            assert!(tags
                .iter()
                .any(|tag| tag == &["h", &channel_id.to_string()]));
            assert!(tags.iter().any(|tag| tag[0] == "airhop-agent-turn"));
            assert_eq!(
                tags.iter().any(|tag| tag[0] == "airhop-question"),
                index == 1
            );
            assert!(tags.iter().any(|tag| tag[0] == "airhop-kickoff-stage"));
            assert!(!tags.iter().any(|tag| tag[0] == "e"));
        }

        let wrong_channel = SendMessagesParams {
            channel_id: Uuid::new_v4(),
            messages: vec!["Нет".into()],
            expects_reply: false,
            kickoff_stage: None,
        };
        assert!(build_message_events(&config, wrong_channel).is_err());
        assert!(build_message_events(
            &config,
            SendMessagesParams {
                channel_id,
                messages: vec!["1".into(), "2".into(), "3".into(), "4".into()],
                expects_reply: false,
                kickoff_stage: None,
            },
        )
        .is_err());
    }

    #[test]
    fn delegation_targets_one_registered_specialist_and_only_fizz_can_send_it() {
        let channel_id = Uuid::new_v4();
        let target = Keys::generate().public_key();
        let fizz = AirhopConfig::for_test(
            AirhopRole::Fizz,
            channel_id,
            "http://127.0.0.1:1",
            Keys::generate(),
        );
        let event = build_delegate_event(
            &fizz,
            DelegateParams {
                channel_id,
                target_role: AirhopRole::Analyst,
                assignment: "Посчитай воронку записи".into(),
            },
            target,
        )
        .expect("Fizz delegation");
        let tags: Vec<Vec<String>> = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        assert!(tags.iter().any(|tag| tag == &["p", &target.to_hex()]));
        assert!(tags.iter().any(|tag| tag == &["airhop-handoff", "analyst"]));
        assert!(!tags.iter().any(|tag| tag[0] == "e"));

        let administrator = AirhopConfig::for_test(
            AirhopRole::Administrator,
            channel_id,
            "http://127.0.0.1:1",
            Keys::generate(),
        );
        assert!(build_delegate_event(
            &administrator,
            DelegateParams {
                channel_id,
                target_role: AirhopRole::Analyst,
                assignment: "Нельзя".into(),
            },
            target,
        )
        .is_err());
    }

    #[test]
    fn authoritative_reads_are_role_scoped() {
        assert!(AirhopRole::Administrator.allows(&ReadResource::Families));
        assert!(AirhopRole::Administrator.allows(&ReadResource::Schedule));
        assert!(AirhopRole::Analyst.allows(&ReadResource::PaymentAnalytics));
        assert!(AirhopRole::Analyst.allows(&ReadResource::BookingFunnel));
        assert!(AirhopRole::ContentMarketer.allows(&ReadResource::Schedule));
        assert!(AirhopRole::ContentMarketer.allows(&ReadResource::PublicBookingSettings));
        assert!(
            !AirhopRole::ContentMarketer.allows(&ReadResource::FamilyDetail {
                family_id: Uuid::new_v4(),
            })
        );
    }

    #[derive(Clone, Default)]
    struct MockState(Arc<Mutex<Vec<HeaderMap>>>);

    async fn settings(State(state): State<MockState>, headers: HeaderMap) -> Json<Value> {
        state.0.lock().unwrap().push(headers);
        Json(json!({
            "organization": {
                "id": Uuid::nil(),
                "name": "Airhop Test",
                "locale": "pt-PT",
                "timeZone": "Europe/Lisbon",
                "publicBooking": { "appearance": "automatic", "purpose": "trial" }
            },
            "version": 1,
            "replayed": false
        }))
    }

    async fn analytics(State(state): State<MockState>, headers: HeaderMap) -> Json<Value> {
        state.0.lock().unwrap().push(headers);
        Json(json!({ "analytics": { "expectedMinor": 4200 } }))
    }

    #[derive(Clone, Default)]
    struct ParentMockState {
        requests: Arc<Mutex<Vec<(HeaderMap, Value)>>>,
        handoff_targets: Vec<Value>,
    }

    async fn parent_backend(
        State(state): State<ParentMockState>,
        headers: HeaderMap,
        body: Bytes,
    ) -> Json<Value> {
        let body = serde_json::from_slice(&body).unwrap();
        state.requests.lock().unwrap().push((headers, body));
        Json(json!({
            "schemaVersion": "airhop.agent.read.v1",
            "data": {
                "capabilities": ["read_organization_public"],
                "handoffTargets": state.handoff_targets,
            }
        }))
    }

    #[tokio::test]
    async fn authoritative_read_uses_nip98_and_returns_locale_time_zone_and_json() {
        let state = MockState::default();
        let app = Router::new()
            .route(SETTINGS_PATH, get(settings))
            .route("/api/airhop/staff/v1/payment-analytics", get(analytics))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let config = AirhopConfig::for_test(
            AirhopRole::Analyst,
            Uuid::new_v4(),
            &format!("http://{address}"),
            Keys::generate(),
        );
        let result = read_authoritative(&config, &ReadResource::PaymentAnalytics)
            .await
            .unwrap();
        assert_eq!(result["locale"], "pt-PT");
        assert_eq!(result["timeZone"], "Europe/Lisbon");
        assert_eq!(result["data"]["analytics"]["expectedMinor"], 4200);
        let headers = state.0.lock().unwrap();
        assert_eq!(headers.len(), 2);
        assert!(headers.iter().all(|headers| headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("Nostr "))));
        server.abort();
    }

    #[tokio::test]
    async fn parent_tool_forwards_signed_context_and_server_scoped_operation() {
        let state = ParentMockState::default();
        let app = Router::new()
            .route(AGENT_BACKEND_PATH, post(parent_backend))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let mut config = AirhopConfig::for_test(
            AirhopRole::ParentAdministrator,
            Uuid::new_v4(),
            &format!("http://{address}"),
            Keys::generate(),
        );
        config.channel_id = None;
        config.context_grant = Some("relay-signed-turn-context".into());
        let result = AirhopService::new(config).get_turn_context().await.unwrap();
        assert_eq!(
            result["data"]["capabilities"][0],
            "read_organization_public"
        );

        let requests = state.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].1, json!({"operation": "get_turn_context"}));
        assert_eq!(
            requests[0]
                .0
                .get(AGENT_CONTEXT_HEADER)
                .and_then(|value| value.to_str().ok()),
            Some("relay-signed-turn-context")
        );
        assert!(requests[0]
            .0
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("Nostr ")));
        server.abort();
    }

    #[tokio::test]
    async fn parent_handoff_tool_posts_one_signed_batch_with_server_selected_internal_recipient() {
        let staff = Keys::generate();
        let state = ParentMockState {
            handoff_targets: vec![json!({
                "pubkey": staff.public_key().to_hex(), "displayName": "Андрей"
            })],
            ..ParentMockState::default()
        };
        let turn_id = Uuid::new_v4();
        let channel_id = Uuid::new_v4();
        let lease_token = Uuid::new_v4();
        let reply_path = format!("/api/airhop/agents/v1/turns/{turn_id}/reply");
        let app = Router::new()
            .route(AGENT_BACKEND_PATH, post(parent_backend))
            .route(&reply_path, post(parent_backend))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let grant = EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_AIRHOP_AGENT_CONTEXT_GRANT as u16),
            json!({
                "channelId": channel_id, "turnId": turn_id, "turnLeaseToken": lease_token,
            })
            .to_string(),
        )
        .sign_with_keys(&Keys::generate())
        .unwrap();
        let mut config = AirhopConfig::for_test(
            AirhopRole::ParentAdministrator,
            Uuid::new_v4(),
            &format!("http://{address}"),
            Keys::generate(),
        );
        config.context_grant = Some(
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(&grant).unwrap()),
        );
        AirhopService::new(config)
            .send_parent_reply(SendParentReplyParams {
                messages: vec!["Подключаю сотрудника.".into()],
                handoff_reason: Some("Родитель просит помочь с записью.".into()),
            })
            .await
            .unwrap();
        let requests = state.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].1, json!({"operation": "get_turn_context"}));
        assert_eq!(requests[1].1["leaseToken"], json!(lease_token));
        let events: Vec<Event> = serde_json::from_value(requests[1].1["events"].clone()).unwrap();
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|event| event.verify_signature()));
        assert!(!events[0].tags.iter().any(|tag| tag.as_slice()[0] == "p"));
        assert!(events[1]
            .tags
            .iter()
            .any(|tag| { tag.as_slice() == ["p", staff.public_key().to_hex().as_str()] }));
        assert_eq!(
            events[1].content,
            "@Андрей\nРодитель просит помочь с записью."
        );
        assert!(requests
            .iter()
            .all(|(headers, _)| headers.contains_key("authorization")));
        server.abort();
    }
}
