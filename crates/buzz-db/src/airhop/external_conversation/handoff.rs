//! Internal staff handoff through the existing signed-message outbox.

use std::collections::BTreeSet;

use super::*;

/// An active staff recipient already allowed to read this conversation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesHandoffTarget {
    /// Nostr identity; selected by the server, not by the parent or the model.
    pub pubkey: String,
    /// Current staff profile name for an ordinary Buzz mention.
    pub display_name: String,
}

/// Whether a signed message declares the bounded internal handoff operation.
/// This is a discriminator, not authorization; recipients are rechecked at commit.
pub fn is_hermes_handoff_event(event: &Event) -> bool {
    event
        .tags
        .iter()
        .any(|tag| tag.as_slice() == ["airhop-handoff", "responsible"])
}

impl Db {
    /// Resolves the owner/admin fallback for a conversation with no known branch.
    /// Does not invite new people or broaden private-channel membership.
    pub async fn get_airhop_conversation_handoff_targets(
        &self,
        tenant: &TenantContext,
        channel_id: Uuid,
    ) -> Result<Vec<HermesHandoffTarget>> {
        let mut tx = self.pool.begin().await?;
        let targets = targets(&mut tx, *tenant.community().as_uuid(), channel_id).await?;
        tx.commit().await?;
        Ok(targets)
    }
}

async fn targets(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    channel_id: Uuid,
) -> Result<Vec<HermesHandoffTarget>> {
    let rows = sqlx::query(
        "SELECT encode(member.pubkey, 'hex') AS pubkey,
                COALESCE(NULLIF(profile.display_name, ''), encode(member.pubkey, 'hex')) AS display_name
         FROM channel_members member
         JOIN relay_members staff
           ON staff.community_id = member.community_id
          AND staff.pubkey = encode(member.pubkey, 'hex')
         LEFT JOIN users profile
           ON profile.community_id = member.community_id AND profile.pubkey = member.pubkey
         WHERE member.community_id = $1 AND member.channel_id = $2
           AND member.removed_at IS NULL AND member.role <> 'bot'
           AND staff.role IN ('owner', 'admin') AND profile.deactivated_at IS NULL
         ORDER BY CASE staff.role WHEN 'owner' THEN 0 ELSE 1 END, member.pubkey
         LIMIT 8",
    )
    .bind(community_id)
    .bind(channel_id)
    .fetch_all(&mut **tx)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(HermesHandoffTarget {
                pubkey: row.try_get("pubkey")?,
                display_name: row.try_get("display_name")?,
            })
        })
        .collect()
}

pub(super) async fn validate_handoff_targets(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    channel_id: Uuid,
    input: &CommitHermesReplyInput,
) -> Result<()> {
    let event = input
        .events
        .last()
        .ok_or_else(|| DbError::InvalidData("missing handoff".to_owned()))?;
    let recipients = mentioned_pubkeys(event);
    let actual: BTreeSet<_> = recipients.iter().cloned().collect();
    let expected: BTreeSet<_> = targets(tx, community_id, channel_id)
        .await?
        .into_iter()
        .map(|target| target.pubkey)
        .collect();
    if expected.is_empty() || actual != expected || actual.len() != recipients.len() {
        return Err(DbError::AccessDenied(
            "Hermes handoff requires the current authorized staff recipients".to_owned(),
        ));
    }
    Ok(())
}
