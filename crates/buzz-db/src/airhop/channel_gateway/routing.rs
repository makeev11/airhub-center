//! Connection-time provisioning. Inbound processing never creates channels.
use super::*;

pub(super) async fn configure(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    organization_id: Uuid,
    input: &PutChannelConnectionInput,
) -> Result<ChannelConnection> {
    let row = sqlx::query("SELECT * FROM airhop_channel_connections WHERE community_id=$1 AND organization_id=$2 AND id=$3 FOR UPDATE")
        .bind(community_id).bind(organization_id).bind(input.connection_id)
        .fetch_one(&mut **tx).await?;
    let current_channel: Option<Uuid> = row.try_get("buzz_channel_id")?;
    // Pausing/disabling must remain possible even if Hermes or membership was
    // removed. Only an explicit routing edit (or create) may provision services.
    if input.routing.is_none() && input.expected_version > 0 {
        return connection_from_row(&row);
    }
    let selection = input.routing.clone().unwrap_or(ConnectionRouting {
        buzz_channel_id: current_channel,
        branch_id: row.try_get("branch_id")?,
    });
    let agent: Vec<u8> = sqlx::query_scalar("SELECT agent_pubkey FROM airhop_agent_deployments WHERE community_id=$1 AND organization_id=$2 AND role='parent_administrator'")
        .bind(community_id).bind(organization_id).fetch_optional(&mut **tx).await?
        .ok_or_else(|| DbError::InvalidData("Configure Hermes before connecting a messenger".into()))?;
    if agent.len() != 32 {
        return Err(DbError::InvalidData("invalid Hermes principal".into()));
    }
    let default_channel = if let Some(branch_id) = selection.branch_id {
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT default_buzz_channel_id FROM airhop_branches WHERE community_id=$1 AND organization_id=$2 AND id=$3 AND status='active' FOR SHARE")
            .bind(community_id).bind(organization_id).bind(branch_id)
            .fetch_optional(&mut **tx).await?
            .ok_or_else(|| DbError::NotFound("active branch".into()))?
    } else {
        None
    };
    let channel_id = match selection.buzz_channel_id.or(default_channel) {
        Some(id) => id,
        None if selection.branch_id.is_some() => {
            return Err(DbError::InvalidData(
                "Choose the branch's private work channel first".into(),
            ));
        }
        None => {
            // A row lock, not a display-name match, makes the central channel a singleton.
            let existing: Option<Uuid> = sqlx::query_scalar("SELECT parents_buzz_channel_id FROM airhop_organizations WHERE community_id=$1 AND id=$2 AND status='active' FOR UPDATE")
                .bind(community_id).bind(organization_id).fetch_one(&mut **tx).await?;
            match existing {
                Some(id) => id,
                None => {
                    let id = Uuid::new_v4();
                    sqlx::query("INSERT INTO channels (community_id,id,name,channel_type,visibility,description,created_by,nip29_group_id) VALUES ($1,$2,'parents','stream','private','Клиенты: отдельный тред на каждый разговор. Участники канала видят все его треды.',$3,$4)")
                        .bind(community_id).bind(id).bind(input.updated_by_pubkey.as_slice()).bind(id.to_string()).execute(&mut **tx).await?;
                    sqlx::query("UPDATE airhop_organizations SET parents_buzz_channel_id=$3 WHERE community_id=$1 AND id=$2")
                        .bind(community_id).bind(organization_id).bind(id).execute(&mut **tx).await?;
                    sqlx::query("INSERT INTO channel_members (community_id,channel_id,pubkey,role) SELECT community_id,$2,decode(pubkey,'hex'),'member' FROM relay_members WHERE community_id=$1 AND role IN ('owner','admin') ON CONFLICT DO NOTHING")
                        .bind(community_id).bind(id).execute(&mut **tx).await?;
                    id
                }
            }
        }
    };
    let accessible: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channels c JOIN channel_members m ON m.community_id=c.community_id AND m.channel_id=c.id WHERE c.community_id=$1 AND c.id=$2 AND c.visibility='private' AND c.channel_type='stream' AND c.archived_at IS NULL AND c.deleted_at IS NULL AND m.pubkey=$3 AND m.removed_at IS NULL)")
        .bind(community_id).bind(channel_id).bind(input.updated_by_pubkey.as_slice()).fetch_one(&mut **tx).await?;
    if !accessible {
        return Err(DbError::AccessDenied(
            "Connection requires an active private work channel accessible to its administrator"
                .into(),
        ));
    }
    let legacy: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_external_conversations WHERE community_id=$1 AND channel_id=$2 AND NOT threaded)")
        .bind(community_id).bind(channel_id).fetch_one(&mut **tx).await?;
    if legacy {
        return Err(DbError::InvalidData(
            "A legacy contact channel cannot become a shared parent channel".into(),
        ));
    }
    // Explicit connection setup grants only the two required service principals.
    for (pubkey, role) in [
        (input.connector_pubkey.as_slice(), "member"),
        (agent.as_slice(), "bot"),
    ] {
        sqlx::query("INSERT INTO channel_members (community_id,channel_id,pubkey,role) VALUES ($1,$2,$3,$4::member_role) ON CONFLICT (community_id,channel_id,pubkey) DO UPDATE SET role=EXCLUDED.role, removed_at=NULL, removed_by=NULL")
            .bind(community_id).bind(channel_id).bind(pubkey).bind(role).execute(&mut **tx).await?;
    }
    let row = sqlx::query("UPDATE airhop_channel_connections SET buzz_channel_id=$4,branch_id=$5,routing_mode=$6 WHERE community_id=$1 AND organization_id=$2 AND id=$3 RETURNING *")
        .bind(community_id).bind(organization_id).bind(input.connection_id).bind(channel_id).bind(selection.branch_id)
        .bind(if selection.branch_id.is_some() { "branch" } else { "central" }).fetch_one(&mut **tx).await?;
    connection_from_row(&row)
}

pub(super) async fn validate_live_channel(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    channel_id: Uuid,
    connector: &[u8],
    agent: &[u8],
) -> Result<()> {
    let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channels c WHERE c.community_id=$1 AND c.id=$2 AND c.channel_type='stream' AND c.visibility='private' AND c.archived_at IS NULL AND c.deleted_at IS NULL AND EXISTS(SELECT 1 FROM channel_members m WHERE m.community_id=c.community_id AND m.channel_id=c.id AND m.pubkey=$3 AND m.removed_at IS NULL) AND EXISTS(SELECT 1 FROM channel_members m WHERE m.community_id=c.community_id AND m.channel_id=c.id AND m.pubkey=$4 AND m.role='bot' AND m.removed_at IS NULL))")
        .bind(community_id).bind(channel_id).bind(connector).bind(agent).fetch_one(&mut **tx).await?;
    if !valid {
        return Err(DbError::AccessDenied(
            "Configured parent channel or service membership is unavailable".into(),
        ));
    }
    Ok(())
}
