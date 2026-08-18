//! Tenant-scoped registration of the Airhop Welcome agent manifest.

use std::collections::{BTreeMap, BTreeSet};

use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::{Db, DbError, Result};

/// Stable role keys for the product Welcome team.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AirhopWelcomeRole {
    /// Team lead and fallback coordinator.
    Fizz,
    /// Operational specialist for setup and Booking Core data.
    Administrator,
    /// Read-only analytics specialist.
    Analyst,
    /// Public-content specialist.
    ContentMarketer,
}

impl AirhopWelcomeRole {
    /// Every required product role in stable order.
    pub const ALL: [Self; 4] = [
        Self::Fizz,
        Self::Administrator,
        Self::Analyst,
        Self::ContentMarketer,
    ];

    /// Stable database/API value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fizz => "fizz",
            Self::Administrator => "administrator",
            Self::Analyst => "analyst",
            Self::ContentMarketer => "content_marketer",
        }
    }
}

impl AirhopWelcomeRole {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "fizz" => Ok(Self::Fizz),
            "administrator" => Ok(Self::Administrator),
            "analyst" => Ok(Self::Analyst),
            "content_marketer" => Ok(Self::ContentMarketer),
            _ => Err(DbError::InvalidData(format!(
                "unknown Airhop Welcome role: {value}"
            ))),
        }
    }
}

/// Why a human Welcome message was assigned to one role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WelcomeRouteReason {
    /// A registered role pubkey was explicitly mentioned.
    ExplicitMention,
    /// The localized role name or alias was addressed as a full token.
    NaturalRole,
    /// This role asked the last open question.
    LastQuestion,
    /// Fizz explicitly handed the next turn to this role.
    Handoff,
    /// No stronger signal existed, so the team lead owns the turn.
    Fallback,
}

impl WelcomeRouteReason {
    /// Stable database/API value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ExplicitMention => "explicit_mention",
            Self::NaturalRole => "natural_role",
            Self::LastQuestion => "last_question",
            Self::Handoff => "handoff",
            Self::Fallback => "fallback",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "explicit_mention" => Ok(Self::ExplicitMention),
            "natural_role" => Ok(Self::NaturalRole),
            "last_question" => Ok(Self::LastQuestion),
            "handoff" => Ok(Self::Handoff),
            "fallback" => Ok(Self::Fallback),
            _ => Err(DbError::InvalidData(format!(
                "unknown Airhop Welcome route reason: {value}"
            ))),
        }
    }
}

/// Normalized inputs used by the deterministic Welcome route selector.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WelcomeRouteInput {
    /// Human message body.
    pub content: String,
    /// Ordered, valid 32-byte pubkeys from exact Nostr `p` tags.
    pub mentioned_pubkeys: Vec<[u8; 32]>,
    /// Registered role that asked the last still-open question.
    pub last_question_role: Option<AirhopWelcomeRole>,
    /// Registered role currently holding a Fizz handoff.
    pub handoff_role: Option<AirhopWelcomeRole>,
}

impl WelcomeRouteInput {
    /// Builds an input without conversation-state hints.
    pub fn new(content: impl Into<String>, mentioned_pubkeys: Vec<[u8; 32]>) -> Self {
        Self {
            content: content.into(),
            mentioned_pubkeys,
            last_question_role: None,
            handoff_role: None,
        }
    }

    /// Adds the last-question routing hint.
    #[must_use]
    pub const fn with_last_question(mut self, role: AirhopWelcomeRole) -> Self {
        self.last_question_role = Some(role);
        self
    }

    /// Adds the active Fizz handoff routing hint.
    #[must_use]
    pub const fn with_handoff(mut self, role: AirhopWelcomeRole) -> Self {
        self.handoff_role = Some(role);
        self
    }
}

/// Persisted winner for one human Welcome event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WelcomeRouteDecision {
    /// Claimed source event.
    pub event_id: [u8; 32],
    /// Registered Welcome channel.
    pub channel_id: Uuid,
    /// Exactly one target role.
    pub target_role: AirhopWelcomeRole,
    /// Current registered pubkey for the target role.
    pub target_pubkey: [u8; 32],
    /// Strongest deterministic routing signal.
    pub reason: WelcomeRouteReason,
    /// True when another caller had already persisted the winner.
    pub replayed: bool,
}

/// Selects exactly one product role using the documented precedence.
pub fn select_welcome_route(
    input: &WelcomeRouteInput,
    locale: &str,
    members: &BTreeMap<AirhopWelcomeRole, [u8; 32]>,
) -> (AirhopWelcomeRole, WelcomeRouteReason) {
    let explicit = unique_roles(input.mentioned_pubkeys.iter().filter_map(|pubkey| {
        members
            .iter()
            .find_map(|(role, member)| (member == pubkey).then_some(*role))
    }));
    if let Some(role) = exactly_one_or_fallback(explicit, WelcomeRouteReason::ExplicitMention) {
        return role;
    }

    let natural = unique_roles(AirhopWelcomeRole::ALL.into_iter().filter(|role| {
        welcome_role_aliases(locale, *role)
            .iter()
            .any(|alias| contains_unicode_token(&input.content, alias))
    }));
    if let Some(role) = exactly_one_or_fallback(natural, WelcomeRouteReason::NaturalRole) {
        return role;
    }

    if let Some(role) = input.last_question_role {
        return (role, WelcomeRouteReason::LastQuestion);
    }
    if let Some(role) = input.handoff_role {
        return (role, WelcomeRouteReason::Handoff);
    }
    (AirhopWelcomeRole::Fizz, WelcomeRouteReason::Fallback)
}

fn unique_roles(roles: impl IntoIterator<Item = AirhopWelcomeRole>) -> Vec<AirhopWelcomeRole> {
    roles
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn exactly_one_or_fallback(
    roles: Vec<AirhopWelcomeRole>,
    reason: WelcomeRouteReason,
) -> Option<(AirhopWelcomeRole, WelcomeRouteReason)> {
    match roles.as_slice() {
        [] => None,
        [role] => Some((*role, reason)),
        _ => Some((AirhopWelcomeRole::Fizz, WelcomeRouteReason::Fallback)),
    }
}

fn welcome_role_aliases(locale: &str, role: AirhopWelcomeRole) -> &'static [&'static str] {
    let language = locale
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match (language.as_str(), role) {
        ("ru", AirhopWelcomeRole::Fizz) => &["Физ", "Fizz"],
        ("ru", AirhopWelcomeRole::Administrator) => &["Администратор", "Админ"],
        ("ru", AirhopWelcomeRole::Analyst) => &["Аналитик"],
        ("ru", AirhopWelcomeRole::ContentMarketer) => &["Контент-маркетолог", "Контент"],
        ("pt", AirhopWelcomeRole::Fizz) => &["Fizz"],
        ("pt", AirhopWelcomeRole::Administrator) => &["Administrador", "Admin"],
        ("pt", AirhopWelcomeRole::Analyst) => &["Analista"],
        ("pt", AirhopWelcomeRole::ContentMarketer) => &["Especialista de Conteudo", "Conteudo"],
        (_, AirhopWelcomeRole::Fizz) => &["Fizz"],
        (_, AirhopWelcomeRole::Administrator) => &["Administrator", "Admin"],
        (_, AirhopWelcomeRole::Analyst) => &["Analyst"],
        (_, AirhopWelcomeRole::ContentMarketer) => &["Content Marketer", "Content"],
    }
}

fn contains_unicode_token(content: &str, alias: &str) -> bool {
    let haystack = content.to_lowercase();
    let needle = alias.to_lowercase();
    haystack.match_indices(&needle).any(|(start, matched)| {
        let end = start + matched.len();
        let before = haystack[..start].chars().next_back();
        let after = haystack[end..].chars().next();
        before.is_none_or(|value| !is_token_char(value))
            && after.is_none_or(|value| !is_token_char(value))
    })
}

fn is_token_char(value: char) -> bool {
    value.is_alphanumeric() || value == '_'
}

/// Authoritative input for registering the four Welcome agents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutWelcomeTeamInput {
    /// Organization already bound to the server-resolved community.
    pub organization_id: Uuid,
    /// Private Welcome stream containing the owner and all four bots.
    pub channel_id: Uuid,
    /// Selected organization locale.
    pub locale: String,
    /// Exact stable role to active bot pubkey mapping.
    pub members: BTreeMap<AirhopWelcomeRole, [u8; 32]>,
    /// Authenticated claimed community owner.
    pub registered_by_pubkey: [u8; 32],
}

/// Persisted safe Welcome manifest. It never contains agent secrets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirhopWelcomeTeam {
    /// Server-resolved community.
    pub community_id: Uuid,
    /// Bound Airhop organization.
    pub organization_id: Uuid,
    /// Private Welcome stream.
    pub channel_id: Uuid,
    /// Organization locale used by the team.
    pub locale: String,
    /// Exact stable role to agent public key mapping.
    pub members: BTreeMap<AirhopWelcomeRole, [u8; 32]>,
    /// Owner who last changed the manifest.
    pub registered_by_pubkey: [u8; 32],
    /// Monotonic manifest version.
    pub version: i64,
    /// Last material change time.
    pub updated_at: DateTime<Utc>,
}

fn validate_welcome_team_input(input: &PutWelcomeTeamInput) -> Result<()> {
    let locale = input.locale.trim();
    if !(2..=32).contains(&locale.len()) {
        return Err(DbError::InvalidData(
            "Airhop Welcome locale must contain 2-32 bytes".to_owned(),
        ));
    }
    if input.members.len() != AirhopWelcomeRole::ALL.len()
        || AirhopWelcomeRole::ALL
            .iter()
            .any(|role| !input.members.contains_key(role))
    {
        return Err(DbError::InvalidData(
            "Airhop Welcome manifest requires exactly four product roles".to_owned(),
        ));
    }
    let unique: BTreeSet<[u8; 32]> = input.members.values().copied().collect();
    if unique.len() != AirhopWelcomeRole::ALL.len() {
        return Err(DbError::InvalidData(
            "Airhop Welcome roles require distinct bot pubkeys".to_owned(),
        ));
    }
    Ok(())
}

impl Db {
    /// Registers or updates the Welcome team after validating tenant authority,
    /// private-stream identity, and active bot membership.
    pub async fn put_airhop_welcome_team(
        &self,
        tenant: &TenantContext,
        input: &PutWelcomeTeamInput,
    ) -> Result<AirhopWelcomeTeam> {
        validate_welcome_team_input(input)?;
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;

        let organization_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM airhop_organizations              WHERE community_id = $1 AND id = $2 AND status = 'active')",
        )
        .bind(community_id)
        .bind(input.organization_id)
        .fetch_one(&mut *tx)
        .await?;
        if !organization_exists {
            return Err(DbError::NotFound(
                "active Airhop organization for Welcome manifest".to_owned(),
            ));
        }

        let owner_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM relay_members              WHERE community_id = $1 AND pubkey = $2 AND role = 'owner')",
        )
        .bind(community_id)
        .bind(hex::encode(input.registered_by_pubkey))
        .fetch_one(&mut *tx)
        .await?;
        if !owner_exists {
            return Err(DbError::AccessDenied(
                "only the claimed community owner may register Airhop agents".to_owned(),
            ));
        }

        let private_stream_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM channels              WHERE community_id = $1 AND id = $2                AND channel_type = 'stream' AND visibility = 'private'                AND archived_at IS NULL AND deleted_at IS NULL)",
        )
        .bind(community_id)
        .bind(input.channel_id)
        .fetch_one(&mut *tx)
        .await?;
        if !private_stream_exists {
            return Err(DbError::InvalidData(
                "Airhop Welcome channel must be an active private stream".to_owned(),
            ));
        }

        let owner_is_channel_member: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM channel_members              WHERE community_id = $1 AND channel_id = $2 AND pubkey = $3                AND removed_at IS NULL)",
        )
        .bind(community_id)
        .bind(input.channel_id)
        .bind(input.registered_by_pubkey.as_slice())
        .fetch_one(&mut *tx)
        .await?;
        if !owner_is_channel_member {
            return Err(DbError::AccessDenied(
                "Airhop Welcome owner must be an active channel member".to_owned(),
            ));
        }

        for role in AirhopWelcomeRole::ALL {
            let pubkey = input.members[&role];
            let active_bot: bool = sqlx::query_scalar(
                "SELECT EXISTS(                      SELECT 1 FROM channel_members member                      JOIN users profile                        ON profile.community_id = member.community_id                       AND profile.pubkey = member.pubkey                      WHERE member.community_id = $1 AND member.channel_id = $2                        AND member.pubkey = $3 AND member.role = 'bot'                        AND member.removed_at IS NULL AND profile.deactivated_at IS NULL                  )",
            )
            .bind(community_id)
            .bind(input.channel_id)
            .bind(pubkey.as_slice())
            .fetch_one(&mut *tx)
            .await?;
            if !active_bot {
                return Err(DbError::InvalidData(format!(
                    "Airhop Welcome {} must be an active bot member",
                    role.as_str()
                )));
            }
        }

        let fizz = input.members[&AirhopWelcomeRole::Fizz];
        let administrator = input.members[&AirhopWelcomeRole::Administrator];
        let analyst = input.members[&AirhopWelcomeRole::Analyst];
        let content_marketer = input.members[&AirhopWelcomeRole::ContentMarketer];
        let row = sqlx::query(
            "INSERT INTO airhop_welcome_teams (                  community_id, organization_id, channel_id, locale,                  fizz_pubkey, administrator_pubkey, analyst_pubkey,                  content_marketer_pubkey, registered_by_pubkey              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)              ON CONFLICT (community_id) DO UPDATE SET                  organization_id = EXCLUDED.organization_id,                  channel_id = EXCLUDED.channel_id,                  locale = EXCLUDED.locale,                  fizz_pubkey = EXCLUDED.fizz_pubkey,                  administrator_pubkey = EXCLUDED.administrator_pubkey,                  analyst_pubkey = EXCLUDED.analyst_pubkey,                  content_marketer_pubkey = EXCLUDED.content_marketer_pubkey,                  registered_by_pubkey = EXCLUDED.registered_by_pubkey,                  version = CASE WHEN (                      airhop_welcome_teams.organization_id, airhop_welcome_teams.channel_id,                      airhop_welcome_teams.locale, airhop_welcome_teams.fizz_pubkey,                      airhop_welcome_teams.administrator_pubkey, airhop_welcome_teams.analyst_pubkey,                      airhop_welcome_teams.content_marketer_pubkey,                      airhop_welcome_teams.registered_by_pubkey                  ) IS DISTINCT FROM (                      EXCLUDED.organization_id, EXCLUDED.channel_id, EXCLUDED.locale,                      EXCLUDED.fizz_pubkey, EXCLUDED.administrator_pubkey,                      EXCLUDED.analyst_pubkey, EXCLUDED.content_marketer_pubkey,                      EXCLUDED.registered_by_pubkey                  ) THEN airhop_welcome_teams.version + 1                    ELSE airhop_welcome_teams.version END,                  updated_at = CASE WHEN (                      airhop_welcome_teams.organization_id, airhop_welcome_teams.channel_id,                      airhop_welcome_teams.locale, airhop_welcome_teams.fizz_pubkey,                      airhop_welcome_teams.administrator_pubkey, airhop_welcome_teams.analyst_pubkey,                      airhop_welcome_teams.content_marketer_pubkey,                      airhop_welcome_teams.registered_by_pubkey                  ) IS DISTINCT FROM (                      EXCLUDED.organization_id, EXCLUDED.channel_id, EXCLUDED.locale,                      EXCLUDED.fizz_pubkey, EXCLUDED.administrator_pubkey,                      EXCLUDED.analyst_pubkey, EXCLUDED.content_marketer_pubkey,                      EXCLUDED.registered_by_pubkey                  ) THEN now() ELSE airhop_welcome_teams.updated_at END              RETURNING community_id, organization_id, channel_id, locale,                  fizz_pubkey, administrator_pubkey, analyst_pubkey,                  content_marketer_pubkey, registered_by_pubkey, version, updated_at",
        )
        .bind(community_id)
        .bind(input.organization_id)
        .bind(input.channel_id)
        .bind(input.locale.trim())
        .bind(fizz.as_slice())
        .bind(administrator.as_slice())
        .bind(analyst.as_slice())
        .bind(content_marketer.as_slice())
        .bind(input.registered_by_pubkey.as_slice())
        .fetch_one(&mut *tx)
        .await?;

        let manifest = welcome_team_from_row(&row)?;
        tx.commit().await?;
        Ok(manifest)
    }

    /// Atomically claims one human Welcome event for exactly one registered
    /// agent. Every concurrent/replayed caller receives the persisted winner.
    pub async fn claim_airhop_welcome_route(
        &self,
        tenant: &TenantContext,
        event_id: [u8; 32],
        claimant_pubkey: [u8; 32],
    ) -> Result<WelcomeRouteDecision> {
        let community_id = *tenant.community().as_uuid();
        let mut tx = self.pool.begin().await?;

        let team_row = sqlx::query(
            "SELECT community_id, organization_id, channel_id, locale,
                    fizz_pubkey, administrator_pubkey, analyst_pubkey,
                    content_marketer_pubkey, registered_by_pubkey, version, updated_at
             FROM airhop_welcome_teams WHERE community_id = $1 FOR SHARE",
        )
        .bind(community_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("Airhop Welcome team".to_owned()))?;
        let team = welcome_team_from_row(&team_row)?;
        if !team
            .members
            .values()
            .any(|pubkey| *pubkey == claimant_pubkey)
        {
            return Err(DbError::AccessDenied(
                "only a registered Welcome agent may claim a route".to_owned(),
            ));
        }

        let event_row = sqlx::query(
            "SELECT pubkey, kind, tags, content, channel_id
             FROM events
             WHERE community_id = $1 AND id = $2 AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(community_id)
        .bind(event_id.as_slice())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| DbError::NotFound("live Welcome source event".to_owned()))?;
        let channel_id: Option<Uuid> = event_row.try_get("channel_id")?;
        if channel_id != Some(team.channel_id) {
            return Err(DbError::AccessDenied(
                "source event is outside the registered Welcome channel".to_owned(),
            ));
        }
        let kind: i32 = event_row.try_get("kind")?;
        if kind != i32::from(buzz_core::kind::KIND_STREAM_MESSAGE as u16) {
            return Err(DbError::InvalidData(
                "only human stream messages may be claimed".to_owned(),
            ));
        }
        let source_author = vec_to_pubkey(event_row.try_get("pubkey")?, "source author")?;
        if team.members.values().any(|pubkey| *pubkey == source_author) {
            return Err(DbError::AccessDenied(
                "agent-authored events do not use the human route claim".to_owned(),
            ));
        }

        let state_row = sqlx::query(
            "SELECT active_role, active_agent_pubkey, last_question_event_id, handoff_role
             FROM airhop_welcome_conversation_state
             WHERE community_id = $1 AND channel_id = $2",
        )
        .bind(community_id)
        .bind(team.channel_id)
        .fetch_optional(&mut *tx)
        .await?;
        let (last_question_role, handoff_role) = if let Some(row) = state_row {
            let active_role: Option<String> = row.try_get("active_role")?;
            let active_agent: Option<Vec<u8>> = row.try_get("active_agent_pubkey")?;
            let last_question: Option<Vec<u8>> = row.try_get("last_question_event_id")?;
            let last_role = match (active_role, active_agent, last_question) {
                (Some(role), Some(agent), Some(_)) => {
                    let role = AirhopWelcomeRole::parse(&role)?;
                    let agent = vec_to_pubkey(agent, "active agent")?;
                    (team.members.get(&role) == Some(&agent)).then_some(role)
                }
                _ => None,
            };
            let handoff = row
                .try_get::<Option<String>, _>("handoff_role")?
                .map(|value| AirhopWelcomeRole::parse(&value))
                .transpose()?;
            (last_role, handoff)
        } else {
            (None, None)
        };

        let tags: serde_json::Value = event_row.try_get("tags")?;
        let content: String = event_row.try_get("content")?;
        let input = WelcomeRouteInput {
            content,
            mentioned_pubkeys: p_tag_pubkeys(&tags),
            last_question_role,
            handoff_role,
        };
        let (selected_role, selected_reason) =
            select_welcome_route(&input, &team.locale, &team.members);
        let selected_pubkey = team.members[&selected_role];

        let inserted = sqlx::query(
            "INSERT INTO airhop_welcome_routes (
                community_id, organization_id, channel_id, event_id,
                source_author_pubkey, target_role, target_pubkey, reason
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (community_id, event_id) DO NOTHING",
        )
        .bind(community_id)
        .bind(team.organization_id)
        .bind(team.channel_id)
        .bind(event_id.as_slice())
        .bind(source_author.as_slice())
        .bind(selected_role.as_str())
        .bind(selected_pubkey.as_slice())
        .bind(selected_reason.as_str())
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;

        let winner = sqlx::query(
            "SELECT channel_id, target_role, target_pubkey, reason
             FROM airhop_welcome_routes
             WHERE community_id = $1 AND event_id = $2",
        )
        .bind(community_id)
        .bind(event_id.as_slice())
        .fetch_one(&mut *tx)
        .await?;
        let decision = WelcomeRouteDecision {
            event_id,
            channel_id: winner.try_get("channel_id")?,
            target_role: AirhopWelcomeRole::parse(winner.try_get("target_role")?)?,
            target_pubkey: vec_to_pubkey(winner.try_get("target_pubkey")?, "target agent")?,
            reason: WelcomeRouteReason::parse(winner.try_get("reason")?)?,
            replayed: !inserted,
        };
        tx.commit().await?;
        Ok(decision)
    }

    /// Reads the Welcome manifest only inside the server-resolved community.
    pub async fn get_airhop_welcome_team(
        &self,
        tenant: &TenantContext,
    ) -> Result<Option<AirhopWelcomeTeam>> {
        let row = sqlx::query(
            "SELECT community_id, organization_id, channel_id, locale,                  fizz_pubkey, administrator_pubkey, analyst_pubkey,                  content_marketer_pubkey, registered_by_pubkey, version, updated_at              FROM airhop_welcome_teams WHERE community_id = $1",
        )
        .bind(tenant.community().as_uuid())
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(welcome_team_from_row).transpose()
    }
}

fn p_tag_pubkeys(tags: &serde_json::Value) -> Vec<[u8; 32]> {
    tags.as_array()
        .into_iter()
        .flatten()
        .filter_map(|tag| {
            let parts = tag.as_array()?;
            if parts.first()?.as_str()? != "p" {
                return None;
            }
            let bytes = hex::decode(parts.get(1)?.as_str()?).ok()?;
            bytes.try_into().ok()
        })
        .collect()
}

fn vec_to_pubkey(value: Vec<u8>, name: &str) -> Result<[u8; 32]> {
    value.try_into().map_err(|value: Vec<u8>| {
        DbError::InvalidData(format!(
            "Airhop Welcome {name} must contain 32 bytes, got {}",
            value.len()
        ))
    })
}

fn welcome_team_from_row(row: &sqlx::postgres::PgRow) -> Result<AirhopWelcomeTeam> {
    let mut members = BTreeMap::new();
    members.insert(AirhopWelcomeRole::Fizz, pubkey_column(row, "fizz_pubkey")?);
    members.insert(
        AirhopWelcomeRole::Administrator,
        pubkey_column(row, "administrator_pubkey")?,
    );
    members.insert(
        AirhopWelcomeRole::Analyst,
        pubkey_column(row, "analyst_pubkey")?,
    );
    members.insert(
        AirhopWelcomeRole::ContentMarketer,
        pubkey_column(row, "content_marketer_pubkey")?,
    );
    Ok(AirhopWelcomeTeam {
        community_id: row.try_get("community_id")?,
        organization_id: row.try_get("organization_id")?,
        channel_id: row.try_get("channel_id")?,
        locale: row.try_get("locale")?,
        members,
        registered_by_pubkey: pubkey_column(row, "registered_by_pubkey")?,
        version: row.try_get("version")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn pubkey_column(row: &sqlx::postgres::PgRow, name: &str) -> Result<[u8; 32]> {
    let value: Vec<u8> = row.try_get(name)?;
    value.try_into().map_err(|value: Vec<u8>| {
        DbError::InvalidData(format!(
            "Airhop Welcome {name} must contain 32 bytes, got {}",
            value.len()
        ))
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn input() -> PutWelcomeTeamInput {
        PutWelcomeTeamInput {
            organization_id: Uuid::new_v4(),
            channel_id: Uuid::new_v4(),
            locale: "ru-RU".to_owned(),
            members: BTreeMap::from([
                (AirhopWelcomeRole::Fizz, [6; 32]),
                (AirhopWelcomeRole::Administrator, [7; 32]),
                (AirhopWelcomeRole::Analyst, [8; 32]),
                (AirhopWelcomeRole::ContentMarketer, [9; 32]),
            ]),
            registered_by_pubkey: [1; 32],
        }
    }

    #[test]
    fn manifest_validation_requires_exact_roles_and_distinct_pubkeys() {
        let mut manifest = input();
        manifest
            .members
            .insert(AirhopWelcomeRole::Administrator, [6; 32]);
        assert!(validate_welcome_team_input(&manifest).is_err());

        manifest = input();
        manifest.members.remove(&AirhopWelcomeRole::Analyst);
        assert!(validate_welcome_team_input(&manifest).is_err());
    }

    #[test]
    fn manifest_validation_rejects_unsafe_locale() {
        let mut manifest = input();
        manifest.locale = " ".to_owned();
        assert!(validate_welcome_team_input(&manifest).is_err());
    }

    #[test]
    fn welcome_route_precedence_is_deterministic_and_unicode_safe() {
        let members = input().members;
        let explicit = WelcomeRouteInput::new(
            "что с расписанием?",
            vec![members[&AirhopWelcomeRole::Administrator]],
        );
        assert_eq!(
            select_welcome_route(&explicit, "ru-RU", &members),
            (
                AirhopWelcomeRole::Administrator,
                WelcomeRouteReason::ExplicitMention
            )
        );

        let natural = WelcomeRouteInput::new("Администратор, проверь расписание", vec![]);
        assert_eq!(
            select_welcome_route(&natural, "ru-RU", &members),
            (
                AirhopWelcomeRole::Administrator,
                WelcomeRouteReason::NaturalRole
            )
        );

        let last_question = WelcomeRouteInput::new("Да, всё верно", vec![])
            .with_last_question(AirhopWelcomeRole::Analyst);
        assert_eq!(
            select_welcome_route(&last_question, "ru-RU", &members),
            (AirhopWelcomeRole::Analyst, WelcomeRouteReason::LastQuestion)
        );

        let handoff = WelcomeRouteInput::new("Давайте", vec![])
            .with_handoff(AirhopWelcomeRole::ContentMarketer);
        assert_eq!(
            select_welcome_route(&handoff, "ru-RU", &members),
            (
                AirhopWelcomeRole::ContentMarketer,
                WelcomeRouteReason::Handoff
            )
        );

        let ambiguous = WelcomeRouteInput::new("Нужен административный отчёт", vec![]);
        assert_eq!(
            select_welcome_route(&ambiguous, "ru-RU", &members),
            (AirhopWelcomeRole::Fizz, WelcomeRouteReason::Fallback)
        );
    }

    #[tokio::test]
    #[ignore = "requires a dedicated migrated Postgres database"]
    async fn welcome_route_claim_is_atomic_replay_safe_and_tenant_fenced() {
        use buzz_core::{CommunityId, TenantContext};
        use nostr::{EventBuilder, Keys, Kind, Tag};

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
        let other_community_id = Uuid::new_v4();
        let tenant = TenantContext::resolved(
            CommunityId::from_uuid(community_id),
            format!("route-{community_id}.test"),
        );
        let other_tenant = TenantContext::resolved(
            CommunityId::from_uuid(other_community_id),
            format!("route-{other_community_id}.test"),
        );
        for context in [&tenant, &other_tenant] {
            sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
                .bind(context.community().as_uuid())
                .bind(context.host())
                .execute(&db.pool)
                .await
                .expect("insert community");
        }

        let owner_keys = Keys::generate();
        let owner = owner_keys.public_key().to_bytes();
        db.bootstrap_owner(tenant.community(), &hex::encode(owner))
            .await
            .expect("bootstrap owner");
        let organization_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_organizations (
                community_id, id, name, locale, time_zone, default_trial_policy
             ) VALUES ($1, $2, 'Route test', 'ru-RU', 'Europe/Moscow', $3)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(serde_json::json!({"mode": "free"}))
        .execute(&db.pool)
        .await
        .expect("insert organization");
        let channel = crate::channel::create_channel(
            &db.pool,
            tenant.community(),
            "Welcome route",
            crate::channel::ChannelType::Stream,
            crate::channel::ChannelVisibility::Private,
            None,
            &owner,
            None,
        )
        .await
        .expect("create Welcome channel");
        let other_channel = crate::channel::create_channel(
            &db.pool,
            tenant.community(),
            "Other",
            crate::channel::ChannelType::Stream,
            crate::channel::ChannelVisibility::Private,
            None,
            &owner,
            None,
        )
        .await
        .expect("create other channel");

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
            .expect("insert bot profile");
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
            .expect("insert bot membership");
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
        .expect("register Welcome team");

        let h_tag = Tag::parse(["h", &channel.id.to_string()]).unwrap();
        let p_tag = Tag::parse([
            "p",
            &hex::encode(members[&AirhopWelcomeRole::Administrator]),
        ])
        .unwrap();
        let event = EventBuilder::new(Kind::Custom(9), "проверь расписание")
            .tags([h_tag, p_tag])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &event, Some(channel.id))
            .await
            .expect("insert human event");
        let event_id = *event.id.as_bytes();

        let fizz =
            db.claim_airhop_welcome_route(&tenant, event_id, members[&AirhopWelcomeRole::Fizz]);
        let administrator = db.claim_airhop_welcome_route(
            &tenant,
            event_id,
            members[&AirhopWelcomeRole::Administrator],
        );
        let analyst =
            db.claim_airhop_welcome_route(&tenant, event_id, members[&AirhopWelcomeRole::Analyst]);
        let content = db.claim_airhop_welcome_route(
            &tenant,
            event_id,
            members[&AirhopWelcomeRole::ContentMarketer],
        );
        let (fizz, administrator, analyst, content) =
            tokio::join!(fizz, administrator, analyst, content);
        let decisions = [
            fizz.unwrap(),
            administrator.unwrap(),
            analyst.unwrap(),
            content.unwrap(),
        ];
        assert!(decisions.iter().all(|decision| {
            decision.target_pubkey == members[&AirhopWelcomeRole::Administrator]
        }));
        assert_eq!(
            decisions
                .iter()
                .filter(|decision| !decision.replayed)
                .count(),
            1
        );
        let route_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM airhop_welcome_routes
             WHERE community_id = $1 AND event_id = $2",
        )
        .bind(community_id)
        .bind(event_id.as_slice())
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(route_count, 1);

        assert!(db
            .claim_airhop_welcome_route(&tenant, event_id, [42; 32])
            .await
            .is_err());
        assert!(db
            .claim_airhop_welcome_route(
                &other_tenant,
                event_id,
                members[&AirhopWelcomeRole::Administrator],
            )
            .await
            .is_err());

        let outside = EventBuilder::new(Kind::Custom(9), "outside")
            .tags([Tag::parse(["h", &other_channel.id.to_string()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &outside, Some(other_channel.id))
            .await
            .unwrap();
        assert!(db
            .claim_airhop_welcome_route(
                &tenant,
                *outside.id.as_bytes(),
                members[&AirhopWelcomeRole::Administrator],
            )
            .await
            .is_err());

        let agent_authored = EventBuilder::new(Kind::Custom(9), "agent")
            .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
            .sign_with_keys(&agent_keys[0])
            .unwrap();
        db.insert_event(tenant.community(), &agent_authored, Some(channel.id))
            .await
            .unwrap();
        assert!(db
            .claim_airhop_welcome_route(
                &tenant,
                *agent_authored.id.as_bytes(),
                members[&AirhopWelcomeRole::Administrator],
            )
            .await
            .is_err());

        let deleted = EventBuilder::new(Kind::Custom(9), "deleted")
            .tags([Tag::parse(["h", &channel.id.to_string()]).unwrap()])
            .sign_with_keys(&owner_keys)
            .unwrap();
        db.insert_event(tenant.community(), &deleted, Some(channel.id))
            .await
            .unwrap();
        db.soft_delete_event(tenant.community(), deleted.id.as_bytes())
            .await
            .unwrap();
        assert!(db
            .claim_airhop_welcome_route(
                &tenant,
                *deleted.id.as_bytes(),
                members[&AirhopWelcomeRole::Administrator],
            )
            .await
            .is_err());
    }

    #[tokio::test]
    #[ignore = "requires a dedicated migrated Postgres database"]
    async fn registration_is_tenant_safe_idempotent_and_membership_fenced() {
        use buzz_core::{CommunityId, TenantContext};

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
        let other_community_id = Uuid::new_v4();
        let host = format!("welcome-agents-{}.test", community_id.simple());
        let other_host = format!("welcome-agents-{}.test", other_community_id.simple());
        let tenant = TenantContext::resolved(CommunityId::from_uuid(community_id), host.clone());
        let other_tenant = TenantContext::resolved(
            CommunityId::from_uuid(other_community_id),
            other_host.clone(),
        );
        for (id, name) in [(community_id, &host), (other_community_id, &other_host)] {
            sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
                .bind(id)
                .bind(name)
                .execute(&db.pool)
                .await
                .expect("insert community");
        }

        let organization_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO airhop_organizations (community_id, id, name, locale,                  time_zone, default_trial_policy)              VALUES ($1, $2, 'Welcome test', 'ru-RU', 'Europe/Moscow', $3)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(serde_json::json!({"mode": "free"}))
        .execute(&db.pool)
        .await
        .expect("insert organization");

        let owner = [1; 32];
        db.bootstrap_owner(tenant.community(), &hex::encode(owner))
            .await
            .expect("bootstrap owner");
        let open_channel = crate::channel::create_channel(
            &db.pool,
            tenant.community(),
            "Open Welcome",
            crate::channel::ChannelType::Stream,
            crate::channel::ChannelVisibility::Open,
            None,
            &owner,
            None,
        )
        .await
        .expect("create open stream");
        let channel = crate::channel::create_channel(
            &db.pool,
            tenant.community(),
            "Welcome",
            crate::channel::ChannelType::Stream,
            crate::channel::ChannelVisibility::Private,
            None,
            &owner,
            None,
        )
        .await
        .expect("create private stream");

        let members = input().members;
        for pubkey in members.values() {
            sqlx::query(
                "INSERT INTO users (community_id, pubkey, agent_type)                  VALUES ($1, $2, 'managed-agent')",
            )
            .bind(community_id)
            .bind(pubkey.as_slice())
            .execute(&db.pool)
            .await
            .expect("insert bot profile");
            sqlx::query(
                "INSERT INTO channel_members (community_id, channel_id, pubkey, role, invited_by)                  VALUES ($1, $2, $3, 'bot', $4)",
            )
            .bind(community_id)
            .bind(channel.id)
            .bind(pubkey.as_slice())
            .bind(owner.as_slice())
            .execute(&db.pool)
            .await
            .expect("insert bot membership");
        }

        let manifest = PutWelcomeTeamInput {
            organization_id,
            channel_id: channel.id,
            locale: "ru-RU".to_owned(),
            members,
            registered_by_pubkey: owner,
        };
        let mut non_private = manifest.clone();
        non_private.channel_id = open_channel.id;
        assert!(db
            .put_airhop_welcome_team(&tenant, &non_private)
            .await
            .is_err());

        let first = db
            .put_airhop_welcome_team(&tenant, &manifest)
            .await
            .expect("register manifest");
        let replay = db
            .put_airhop_welcome_team(&tenant, &manifest)
            .await
            .expect("replay manifest");
        assert_eq!(first.version, 1);
        assert_eq!(replay.version, 1);
        assert_eq!(first.updated_at, replay.updated_at);
        assert!(db
            .get_airhop_welcome_team(&other_tenant)
            .await
            .expect("read other tenant")
            .is_none());

        let mut changed = manifest.clone();
        let replacement = [10; 32];
        sqlx::query(
            "INSERT INTO users (community_id, pubkey, agent_type)              VALUES ($1, $2, 'managed-agent')",
        )
        .bind(community_id)
        .bind(replacement.as_slice())
        .execute(&db.pool)
        .await
        .expect("insert replacement profile");
        sqlx::query(
            "INSERT INTO channel_members (community_id, channel_id, pubkey, role, invited_by)              VALUES ($1, $2, $3, 'bot', $4)",
        )
        .bind(community_id)
        .bind(channel.id)
        .bind(replacement.as_slice())
        .bind(owner.as_slice())
        .execute(&db.pool)
        .await
        .expect("insert replacement membership");
        changed
            .members
            .insert(AirhopWelcomeRole::Analyst, replacement);
        assert_eq!(
            db.put_airhop_welcome_team(&tenant, &changed)
                .await
                .expect("change manifest")
                .version,
            2
        );

        let missing_bot = [11; 32];
        changed
            .members
            .insert(AirhopWelcomeRole::Analyst, missing_bot);
        assert!(db.put_airhop_welcome_team(&tenant, &changed).await.is_err());
    }
}
