//! Server-authorized internal conversations outside the onboarding channel.

use airhop_core::agent_policy::{AgentPolicy, AgentRole};
use buzz_core::TenantContext;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::welcome_agents::{
    AirhopWelcomeRole, AirhopWelcomeTeam, WelcomeRouteDecision, WelcomeRouteReason,
};
use crate::{AirhopAgentRequestDenial, AirhopAgentRequestDenialReason, DbError, Result};

impl crate::Db {
    /// Open channels are suitable for internal answers only when relay
    /// admission is enforced. Caller supplies this from server configuration.
    pub async fn require_airhop_internal_destination(
        &self,
        tenant: &TenantContext,
        channel: Uuid,
        staff_admission_required: bool,
    ) -> Result<()> {
        let visibility: Option<String> = sqlx::query_scalar("SELECT visibility::text FROM channels WHERE community_id=$1 AND id=$2 AND deleted_at IS NULL AND archived_at IS NULL")
            .bind(tenant.community().as_uuid()).bind(channel).fetch_optional(&self.pool).await?;
        if visibility.as_deref() == Some("private")
            || (visibility.as_deref() == Some("open") && staff_admission_required)
        {
            Ok(())
        } else {
            Err(DbError::AccessDenied(
                "internal answers require a private conversation or a staff-only relay".into(),
            ))
        }
    }
    /// Publication guard shared by HTTP, WebSocket and CLI paths. A model
    /// cannot bypass a revoked audience or switch destinations after a read.
    pub(super) async fn authorize_airhop_conversation_reply(
        &self,
        tenant: &TenantContext,
        actor: &[u8; 32],
        event: &nostr::Event,
        channel: Option<Uuid>,
    ) -> Result<()> {
        let team = self.get_airhop_welcome_team(tenant).await?.ok_or_else(|| {
            DbError::AccessDenied("registered internal team is unavailable".into())
        })?;
        let role = team
            .members
            .iter()
            .find_map(|(role, key)| (key == actor).then_some(*role))
            .ok_or_else(|| DbError::AccessDenied("stale internal agent identity".into()))?;
        let channel = channel
            .ok_or_else(|| DbError::AccessDenied("agent reply requires a channel".into()))?;
        let sources: Vec<_> = event
            .tags
            .iter()
            .filter(|tag| {
                matches!(
                    tag.as_slice().first().map(String::as_str),
                    Some("airhop-responds-to" | "airhop-conversation-source")
                )
            })
            .collect();
        if sources.is_empty() {
            let configured = self
                .airhop_agent_policy(
                    tenant,
                    AgentRole::parse(role.as_str())
                        .ok_or_else(|| DbError::InvalidData("internal role".into()))?,
                )
                .await?
                .0
                .communication
                .is_some();
            // Existing onboarding stages have a registered-role check and a
            // single-publication trigger for kind 9. Other kinds or arbitrary
            // stage labels must not turn this exception into a reply bypass.
            let kickoff = is_role_introduction(event, role);
            if channel == team.channel_id && (!configured || kickoff) {
                return Ok(());
            }
            return Err(DbError::AccessDenied("agent reply requires an authorized source message; CLI does not bypass conversation policy".into()));
        }
        if sources.len() > 32 {
            return Err(DbError::InvalidData("too many conversation sources".into()));
        }
        for tag in sources {
            let source = tag
                .as_slice()
                .get(1)
                .and_then(|value| hex::decode(value).ok())
                .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
                .ok_or_else(|| DbError::InvalidData("invalid conversation source".into()))?;
            let route = self
                .claim_airhop_welcome_route(tenant, source, *actor)
                .await?;
            if route.target_pubkey != *actor || route.channel_id != channel {
                return Err(DbError::AccessDenied(
                    "reply does not match the authorized conversation".into(),
                ));
            }
        }
        Ok(())
    }
}

fn is_role_introduction(event: &nostr::Event, role: AirhopWelcomeRole) -> bool {
    event.kind.as_u16() == 9
        && event.tags.iter().any(|tag| {
            let values = tag.as_slice();
            values
                .first()
                .is_some_and(|name| name == "airhop-kickoff-stage")
                && values.get(1).is_some_and(|stage| {
                    stage == &format!("{}_intro", role.as_str())
                        || role == AirhopWelcomeRole::Fizz && stage == "fizz_first_question"
                })
        })
}

/// Rechecks current policy, human identity and both parties' channel membership.
/// An absent legacy policy does not authorize any additional conversation.
pub(super) async fn authorize_conversation(
    connection: &mut PgConnection,
    community: Uuid,
    team: &AirhopWelcomeTeam,
    channel: Uuid,
    role: AirhopWelcomeRole,
    actor: &[u8; 32],
) -> Result<bool> {
    let agent = team
        .members
        .get(&role)
        .ok_or_else(|| DbError::AccessDenied("agent is not registered".into()))?;
    let role_key = AgentRole::parse(role.as_str())
        .ok_or_else(|| DbError::AccessDenied("unsupported internal role".into()))?;
    let stored: Option<Value> = sqlx::query_scalar("SELECT policy FROM airhop_agent_policies WHERE community_id=$1 AND organization_id=$2 AND role=$3")
        .bind(community).bind(team.organization_id).bind(role.as_str()).fetch_optional(&mut *connection).await?;
    let policy = stored
        .map(serde_json::from_value::<AgentPolicy>)
        .transpose()
        .map_err(|error| DbError::InvalidData(error.to_string()))?
        .unwrap_or_else(|| AgentPolicy::for_role(role_key));
    if !policy.enabled {
        return Err(DbError::AccessDenied("agent is disabled".into()));
    }
    let channel_type: Option<String> = sqlx::query_scalar("SELECT channel_type::text FROM channels c WHERE community_id=$1 AND id=$2 AND deleted_at IS NULL AND archived_at IS NULL AND channel_type IN ('stream','dm') AND (channel_type<>'dm' OR visibility='private') AND EXISTS(SELECT 1 FROM channel_members m WHERE m.community_id=c.community_id AND m.channel_id=c.id AND m.pubkey=$3 AND m.removed_at IS NULL)")
        .bind(community).bind(channel).bind(agent.as_slice()).fetch_optional(&mut *connection).await?;
    let channel_type = channel_type.ok_or_else(|| {
        DbError::AccessDenied("agent must be a member of this active conversation".into())
    })?;
    let member_role: Option<String> = sqlx::query_scalar("SELECT r.role FROM relay_members r JOIN channel_members m ON m.community_id=r.community_id AND encode(m.pubkey,'hex')=r.pubkey LEFT JOIN users u ON u.community_id=m.community_id AND u.pubkey=m.pubkey WHERE r.community_id=$1 AND r.pubkey=$2 AND r.role IN ('owner','admin','member') AND m.channel_id=$3 AND m.removed_at IS NULL AND m.role<>'bot' AND u.deactivated_at IS NULL AND u.agent_owner_pubkey IS NULL AND NOT EXISTS(SELECT 1 FROM airhop_registered_principals p WHERE p.community_id=r.community_id AND p.pubkey=m.pubkey)")
        .bind(community).bind(hex::encode(actor)).bind(channel).fetch_optional(&mut *connection).await?;
    let member_role = member_role.ok_or_else(|| {
        DbError::AccessDenied("only active human employees may address internal agents".into())
    })?;
    let configured = policy.communication.is_some();
    match policy.communication {
        Some(access)
            if access.allows_actor(&hex::encode(actor), &member_role)
                && access.allows_surface(channel_type == "dm") => {}
        None if channel == team.channel_id => {} // Existing Welcome behavior only.
        _ => {
            return Err(DbError::AccessDenied(
                "agent conversation access is denied by organization policy".into(),
            ))
        }
    }
    // A permitted speaker must not turn a mixed client conversation into a
    // destination for internal center data. Build the possible audience first,
    // then apply the same effective read policy used by every read surface.
    // In particular, an unassigned parent runtime or connector is not a reader
    // merely because this is an open channel. A service identity explicitly
    // assigned to this channel remains external and therefore still blocks.
    let exposed: bool = sqlx::query_scalar(
        "WITH candidate_readers AS (
        SELECT m.pubkey
        FROM channel_members m
        WHERE m.community_id=$1 AND m.channel_id=$2 AND m.removed_at IS NULL
        UNION
        SELECT decode(r.pubkey,'hex')
        FROM relay_members r
        JOIN channels c ON c.community_id=r.community_id
        WHERE r.community_id=$1 AND c.id=$2 AND c.visibility='open'
          AND c.deleted_at IS NULL AND c.archived_at IS NULL
    )
    SELECT EXISTS(
        SELECT 1
        FROM candidate_readers reader
        LEFT JOIN relay_members r
          ON r.community_id=$1 AND r.pubkey=encode(reader.pubkey,'hex')
        LEFT JOIN users u
          ON u.community_id=$1 AND u.pubkey=reader.pubkey
        LEFT JOIN channel_members m
          ON m.community_id=$1 AND m.channel_id=$2
         AND m.pubkey=reader.pubkey AND m.removed_at IS NULL
        WHERE airhop_can_read_channel($1,$2,reader.pubkey)
          AND NOT EXISTS(
              SELECT 1 FROM airhop_registered_principals p
              WHERE p.community_id=$1 AND p.pubkey=reader.pubkey AND p.enabled
                AND p.role IN ('fizz','administrator','analyst','content_marketer')
          )
          AND (
              r.role IS NULL OR r.role NOT IN ('owner','admin','member')
              OR m.role='bot' OR u.agent_owner_pubkey IS NOT NULL
              OR u.deactivated_at IS NOT NULL
              OR EXISTS(
                  SELECT 1 FROM airhop_registered_principals p
                  WHERE p.community_id=$1 AND p.pubkey=reader.pubkey
              )
              OR EXISTS(
                  SELECT 1 FROM airhop_channel_scoped_service_principals service
                  WHERE service.community_id=$1 AND service.pubkey=reader.pubkey
              )
          )
    )",
    )
    .bind(community)
    .bind(channel)
    .fetch_one(&mut *connection)
    .await?;
    if exposed {
        return Err(DbError::AccessDenied(
            "internal agent replies require a conversation without external readers".into(),
        ));
    }
    Ok(configured)
}

/// Claims an explicitly addressed stream message or an agent DM using current
/// membership. No fallback to Fizz in an unrelated stream is allowed.
pub(super) async fn claim_conversation(
    connection: &mut PgConnection,
    tenant: &TenantContext,
    team: &AirhopWelcomeTeam,
    source_event: ([u8; 32], DateTime<Utc>),
    channel: Uuid,
    source: [u8; 32],
    tags: &Value,
) -> Result<WelcomeRouteDecision> {
    let (event_id, source_created_at) = source_event;
    let community = *tenant.community().as_uuid();
    let channel_type: Option<String> = sqlx::query_scalar("SELECT channel_type::text FROM channels WHERE community_id=$1 AND id=$2 AND deleted_at IS NULL AND archived_at IS NULL")
        .bind(community).bind(channel).fetch_optional(&mut *connection).await?;
    let channel_type =
        channel_type.ok_or_else(|| DbError::AccessDenied("conversation is unavailable".into()))?;
    let members: Vec<Vec<u8>> = sqlx::query_scalar("SELECT pubkey FROM channel_members WHERE community_id=$1 AND channel_id=$2 AND removed_at IS NULL")
        .bind(community).bind(channel).fetch_all(&mut *connection).await?;
    let mentioned = super::welcome_agents::p_tag_pubkeys(tags);
    let candidates: Vec<_> = team
        .members
        .iter()
        .filter(|(_, key)| {
            members
                .iter()
                .any(|member| member.as_slice() == key.as_slice())
        })
        .filter(|(_, key)| channel_type == "dm" || mentioned.contains(key))
        .collect();
    if candidates.len() != 1 {
        return Err(DbError::AccessDenied(
            "address exactly one registered agent in this conversation".into(),
        ));
    }
    let (&role, &agent) = candidates[0];
    if let Err(error) =
        authorize_conversation(connection, community, team, channel, role, &source).await
    {
        if let Some(reason) = author_visible_denial_reason(&error) {
            return Err(DbError::AirhopAgentRequestDenied(Box::new(
                AirhopAgentRequestDenial {
                    source_event_id: event_id,
                    source_created_at,
                    source_author_pubkey: source,
                    channel_id: channel,
                    target_pubkey: agent,
                    target_role: role.as_str().to_owned(),
                    locale: team.locale.clone(),
                    reason,
                },
            )));
        }
        return Err(error);
    }
    let inserted = sqlx::query("INSERT INTO airhop_welcome_routes(community_id,organization_id,channel_id,event_id,source_author_pubkey,target_role,target_pubkey,reason) VALUES($1,$2,$3,$4,$5,$6,$7,'explicit_mention') ON CONFLICT(community_id,event_id) DO NOTHING")
        .bind(community).bind(team.organization_id).bind(channel).bind(event_id.as_slice()).bind(source.as_slice()).bind(role.as_str()).bind(agent.as_slice()).execute(&mut *connection).await?.rows_affected()==1;
    let previous = sqlx::query("SELECT channel_id,target_role,target_pubkey FROM airhop_welcome_routes WHERE community_id=$1 AND event_id=$2")
        .bind(community).bind(event_id.as_slice()).fetch_one(&mut *connection).await?;
    if previous.try_get::<Uuid, _>("channel_id")? != channel
        || previous.try_get::<&str, _>("target_role")? != role.as_str()
        || previous.try_get::<Vec<u8>, _>("target_pubkey")? != agent
    {
        return Err(DbError::AccessDenied(
            "conversation route changed; do not reuse a stale claim".into(),
        ));
    }
    Ok(WelcomeRouteDecision {
        event_id,
        channel_id: channel,
        target_role: role,
        target_pubkey: agent,
        reason: WelcomeRouteReason::ExplicitMention,
        replayed: !inserted,
        ephemeral: false,
        communication_configured: true,
    })
}

fn author_visible_denial_reason(error: &DbError) -> Option<AirhopAgentRequestDenialReason> {
    let DbError::AccessDenied(message) = error else {
        return None;
    };
    match message.as_str() {
        "agent is disabled" => Some(AirhopAgentRequestDenialReason::AgentDisabled),
        "agent must be a member of this active conversation" => {
            Some(AirhopAgentRequestDenialReason::AgentNotInChannel)
        }
        "agent conversation access is denied by organization policy" => {
            Some(AirhopAgentRequestDenialReason::PolicyDenied)
        }
        "internal agent replies require a conversation without external readers" => {
            Some(AirhopAgentRequestDenialReason::ExternalReaders)
        }
        _ => None,
    }
}

/// Delegation carries the original human evidence, not just an agent-authored
/// task. Legacy tasks without it cannot enter an explicitly restricted role.
pub(super) async fn authorize_handoff(
    connection: &mut PgConnection,
    community: Uuid,
    team: &AirhopWelcomeTeam,
    role: AirhopWelcomeRole,
    source: Option<&[u8]>,
) -> Result<bool> {
    if let Some(source) = source {
        let human: Option<Vec<u8>> = sqlx::query_scalar("SELECT pubkey FROM events WHERE community_id=$1 AND id=$2 AND channel_id=$3 AND kind IN (9,46010) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")
            .bind(community).bind(source).bind(team.channel_id).fetch_optional(&mut *connection).await?;
        let human: [u8; 32] = human
            .and_then(|value| value.try_into().ok())
            .ok_or_else(|| {
                DbError::AccessDenied(
                    "handoff requires a current human message in the same conversation".into(),
                )
            })?;
        authorize_conversation(
            connection,
            community,
            team,
            team.channel_id,
            AirhopWelcomeRole::Fizz,
            &human,
        )
        .await?;
        return authorize_conversation(connection, community, team, team.channel_id, role, &human)
            .await;
    }
    let configured: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_agent_policies WHERE community_id=$1 AND role=$2 AND (policy->'communication' IS NOT NULL AND policy->'communication'<>'null'::jsonb OR policy->>'enabled'='false'))")
        .bind(community).bind(role.as_str()).fetch_one(connection).await?;
    if configured {
        Err(DbError::AccessDenied(
            "handoff must carry the original human source for a configured conversation policy"
                .into(),
        ))
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod introduction_tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    #[test]
    fn introduction_exception_cannot_be_forged_with_another_kind_stage_or_role() {
        for (kind, stage, expected) in [
            (9, "analyst_intro", true),
            (9, "fizz_intro", false),
            (9, "anything", false),
            (9, "hermes_guest_intro", false),
            (46010, "analyst_intro", false),
            (46010, "anything", false),
        ] {
            let event = EventBuilder::new(Kind::Custom(kind), "intro")
                .tags([Tag::parse(["airhop-kickoff-stage", stage]).unwrap()])
                .sign_with_keys(&Keys::generate())
                .unwrap();
            assert_eq!(
                is_role_introduction(&event, AirhopWelcomeRole::Analyst),
                expected
            );
        }
    }
}
