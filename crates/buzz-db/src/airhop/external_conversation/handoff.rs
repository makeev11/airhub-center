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
        conversation_id: Uuid,
    ) -> Result<Vec<HermesHandoffTarget>> {
        let mut tx = self.pool.begin().await?;
        let targets = targets(&mut tx, *tenant.community().as_uuid(), conversation_id).await?;
        tx.commit().await?;
        Ok(targets)
    }
}

async fn targets(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    conversation_id: Uuid,
) -> Result<Vec<HermesHandoffTarget>> {
    let scope=sqlx::query("SELECT organization_id,channel_id,branch_id FROM airhop_external_conversations WHERE community_id=$1 AND id=$2 AND status='active'")
        .bind(community_id).bind(conversation_id).fetch_optional(&mut **tx).await?.ok_or_else(||DbError::NotFound("conversation".into()))?;
    let selected = crate::airhop::client_threads::responsibles(
        tx,
        community_id,
        scope.try_get("organization_id")?,
        scope.try_get("channel_id")?,
        scope.try_get("branch_id")?,
    )
    .await?;
    let rows=sqlx::query("SELECT encode(key,'hex') AS pubkey,COALESCE(NULLIF(profile.display_name,''),encode(key,'hex')) AS display_name FROM unnest($2::bytea[]) WITH ORDINALITY AS chosen(key,n) LEFT JOIN users profile ON profile.community_id=$1 AND profile.pubkey=chosen.key ORDER BY n")
        .bind(community_id).bind(selected).fetch_all(&mut **tx).await?;

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
    conversation_id: Uuid,
    input: &CommitHermesReplyInput,
) -> Result<()> {
    let event = input
        .events
        .last()
        .ok_or_else(|| DbError::InvalidData("missing handoff".to_owned()))?;
    let recipients = mentioned_pubkeys(event);
    let actual: BTreeSet<_> = recipients.iter().cloned().collect();
    let expected: BTreeSet<_> = targets(tx, community_id, conversation_id)
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
