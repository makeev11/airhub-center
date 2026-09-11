//! Guest eligibility is derived from the current tenant's registered team and
//! signed stage receipts, never from text or a caller-supplied channel ID.

use buzz_core::{
    welcome_guest::{GuestInvitation, GuestLanguage},
    TenantContext,
};
use nostr::{Event, EventId, PublicKey};
use sqlx::Row;

use crate::{Db, DbError, Result};

impl Db {
    /// Returns only a bounded presentation task to the current Hermes key.
    /// No channel membership, history or business-data permission is granted.
    pub async fn airhop_welcome_guest_invitation(
        &self,
        tenant: &TenantContext,
        guest_pubkey: &[u8; 32],
    ) -> Result<Option<GuestInvitation>> {
        let row = sqlx::query(
            "SELECT team.channel_id, team.locale, intro.id, intro.created_at
             FROM airhop_welcome_teams team
             JOIN airhop_agent_deployments deployment
               ON deployment.community_id = team.community_id
              AND deployment.organization_id = team.organization_id
              AND deployment.role = 'parent_administrator'
              AND deployment.enabled AND NOT deployment.paused
              AND deployment.agent_pubkey = $2
             JOIN channels channel ON channel.community_id = team.community_id
              AND channel.id = team.channel_id AND channel.archived_at IS NULL
              AND channel.deleted_at IS NULL
             JOIN airhop_organizations organization
               ON organization.community_id = team.community_id
              AND organization.id = team.organization_id AND organization.status = 'active'
             JOIN events intro ON intro.community_id = team.community_id
              AND intro.channel_id = team.channel_id AND intro.deleted_at IS NULL
              AND intro.pubkey = team.content_marketer_pubkey AND intro.kind = 9
              AND intro.tags @> '[[\"airhop-kickoff-stage\",\"content_marketer_intro\"]]'::jsonb
             WHERE team.community_id = $1
               AND NOT EXISTS (
                 SELECT 1 FROM events question
                 WHERE question.community_id = team.community_id
                   AND question.channel_id = team.channel_id
                   AND question.pubkey = team.registered_by_pubkey
                   AND question.kind = 9 AND question.deleted_at IS NULL
                   AND length(btrim(question.content)) > 0
                   AND NOT EXISTS (
                     SELECT 1 FROM events answer
                     WHERE answer.community_id = team.community_id
                       AND answer.channel_id = team.channel_id
                       AND answer.deleted_at IS NULL AND answer.kind = 9
                       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(answer.tags) tag
                         WHERE tag->>0 = 'airhop-kickoff-stage')
                       AND answer.pubkey IN (team.fizz_pubkey, team.administrator_pubkey,
                         team.analyst_pubkey, team.content_marketer_pubkey)
                       AND answer.tags @> jsonb_build_array(jsonb_build_array(
                         'airhop-responds-to', encode(question.id, 'hex')))
                   )
               )
               AND NOT EXISTS (
                 SELECT 1 FROM (VALUES
                   ('fizz_intro', team.fizz_pubkey),
                   ('administrator_intro', team.administrator_pubkey),
                   ('analyst_intro', team.analyst_pubkey)
                 ) required(stage, author)
                 WHERE NOT EXISTS (SELECT 1 FROM events receipt
                   WHERE receipt.community_id = team.community_id
                     AND receipt.channel_id = team.channel_id
                     AND receipt.pubkey = required.author AND receipt.kind = 9
                     AND receipt.deleted_at IS NULL
                     AND receipt.tags @> jsonb_build_array(jsonb_build_array('airhop-kickoff-stage', required.stage)))
               )
             ORDER BY intro.created_at ASC, intro.id ASC LIMIT 1",
        )
        .bind(tenant.community().as_uuid())
        .bind(guest_pubkey.as_slice())
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        let id: Vec<u8> = row.try_get("id")?;
        let channel_id: uuid::Uuid = row.try_get("channel_id")?;
        let predecessor_time: chrono::DateTime<chrono::Utc> = row.try_get("created_at")?;
        let reservation = sqlx::query(
            "INSERT INTO airhop_welcome_guest_invitations
               (community_id,channel_id,guest_pubkey,predecessor_id,message_created_at)
             VALUES ($1,$2,$3,$4,GREATEST(floor(extract(epoch FROM clock_timestamp()))::bigint,$5::bigint+1))
             ON CONFLICT (community_id,channel_id) DO UPDATE SET
               guest_pubkey=EXCLUDED.guest_pubkey,
               predecessor_id=EXCLUDED.predecessor_id,
               message_created_at=CASE WHEN
                 airhop_welcome_guest_invitations.message_created_at < EXCLUDED.message_created_at-300
                 OR airhop_welcome_guest_invitations.guest_pubkey <> EXCLUDED.guest_pubkey
                 OR airhop_welcome_guest_invitations.predecessor_id <> EXCLUDED.predecessor_id
                 THEN EXCLUDED.message_created_at
                 ELSE airhop_welcome_guest_invitations.message_created_at END
             WHERE airhop_welcome_guest_invitations.published_event_id IS NULL
             RETURNING message_created_at",
        )
        .bind(tenant.community().as_uuid())
        .bind(channel_id)
        .bind(guest_pubkey.as_slice())
        .bind(&id)
        .bind(predecessor_time.timestamp())
        .fetch_optional(&self.pool)
        .await?;
        let Some(reservation) = reservation else {
            return Ok(None);
        };
        let created_at = u64::try_from(reservation.try_get::<i64, _>("message_created_at")?)
            .map_err(|_| DbError::InvalidData("invalid guest invitation timestamp".into()))?;
        Ok(Some(GuestInvitation {
            channel_id,
            invitation_id: EventId::from_slice(&id)
                .map_err(|_| DbError::InvalidData("invalid invitation event ID".into()))?,
            guest_pubkey: PublicKey::from_slice(guest_pubkey)
                .map_err(|_| DbError::InvalidData("invalid Hermes public key".into()))?,
            language: GuestLanguage::from_locale(&row.try_get::<String, _>("locale")?),
            created_at,
        }))
    }

    /// Revalidate publication against the current deployment and exact envelope.
    /// The ordinary ingest pipeline must still verify scopes and persistence.
    pub async fn is_authorized_airhop_guest_reply(
        &self,
        tenant: &TenantContext,
        event: &Event,
    ) -> Result<bool> {
        let invitation = self
            .airhop_welcome_guest_invitation(tenant, event.pubkey.as_bytes())
            .await?;
        Ok(invitation.is_some_and(|invitation| invitation.matches_reply(event)))
    }
}
