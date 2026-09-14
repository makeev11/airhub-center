//! Staff-reviewed template messages use the ordinary signed event/outbox path.
use super::*;

pub(super) async fn validate_template(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    connection_id: Uuid,
    event: &Event,
    actor_kind: &str,
) -> Result<()> {
    let tags: Vec<_> = event
        .tags
        .iter()
        .filter(|t| {
            t.as_slice()
                .first()
                .is_some_and(|v| v == "airhop-whatsapp-template")
        })
        .collect();
    if tags.is_empty() {
        return Ok(());
    }
    if actor_kind != "staff" || tags.len() != 1 || tags[0].as_slice().len() != 2 {
        return Err(DbError::AccessDenied(
            "WhatsApp templates require an explicit staff message".into(),
        ));
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Spec {
        name: String,
        language: String,
        parameters: Vec<String>,
    }
    let spec: Spec = serde_json::from_str(&tags[0].as_slice()[1])?;
    if spec.parameters.len() > 10
        || spec.parameters.iter().any(|v| {
            v.trim().is_empty()
                || v.chars().count() > 500
                || v.contains(['\n', '\r', '\t', '{', '}'])
        })
    {
        return Err(DbError::InvalidData(
            "invalid WhatsApp template parameters".into(),
        ));
    }
    // Serialize sends per connection for the hourly bound. Provider catalog is
    // supplied by the authenticated gateway and rechecked with Meta at dispatch.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("whatsapp-templates:{community_id}:{connection_id}"))
        .execute(&mut **tx)
        .await?;
    let caps:Option<Value>=sqlx::query_scalar("SELECT observed_capabilities FROM airhop_channel_connections WHERE community_id=$1 AND id=$2 AND provider='whatsapp_cloud' AND status='active'")
        .bind(community_id).bind(connection_id).fetch_optional(&mut **tx).await?;
    let caps =
        caps.ok_or_else(|| DbError::AccessDenied("active WhatsApp connection required".into()))?;
    let synced = caps
        .get("templatesSyncedAt")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if chrono::Utc::now().timestamp() - synced > 600
        || synced > chrono::Utc::now().timestamp() + 300
    {
        return Err(DbError::InvalidData(
            "WhatsApp templates need synchronization".into(),
        ));
    }
    let template = caps
        .get("utilityTemplates")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|t| t["name"] == spec.name && t["language"] == spec.language)
        })
        .ok_or_else(|| {
            DbError::InvalidData("approved WhatsApp utility template unavailable".into())
        })?;
    let mut body = template
        .get("body")
        .and_then(Value::as_str)
        .ok_or_else(|| DbError::InvalidData("invalid WhatsApp template body".into()))?
        .to_owned();
    if template.get("parameterCount").and_then(Value::as_u64) != Some(spec.parameters.len() as u64)
    {
        return Err(DbError::InvalidData(
            "WhatsApp template parameters changed".into(),
        ));
    }
    for (i, value) in spec.parameters.iter().enumerate() {
        body = body.replace(&format!("{{{{{}}}}}", i + 1), value);
    }
    let rendered = [
        template.get("header").and_then(Value::as_str).unwrap_or(""),
        body.as_str(),
        template.get("footer").and_then(Value::as_str).unwrap_or(""),
    ]
    .into_iter()
    .filter(|v| !v.is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    if rendered != event.content || rendered.chars().count() > 4096 || rendered.contains(['{', '}'])
    {
        return Err(DbError::InvalidData(
            "WhatsApp template preview no longer matches approved content".into(),
        ));
    }
    let duplicate:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM airhop_external_message_outbox WHERE community_id=$1 AND buzz_event_id=$2)")
        .bind(community_id).bind(event.id.as_bytes().as_slice()).fetch_one(&mut **tx).await?;
    if !duplicate {
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM airhop_external_message_outbox WHERE community_id=$1 AND connection_id=$2 AND created_at>now()-interval '1 hour' AND EXISTS(SELECT 1 FROM jsonb_array_elements(event_json->'tags') tag WHERE tag->>0='airhop-whatsapp-template')")
            .bind(community_id).bind(connection_id).fetch_one(&mut **tx).await?;
        if count >= 20 {
            return Err(DbError::InvalidData(
                "WhatsApp service template hourly limit reached".into(),
            ));
        }
    }
    Ok(())
}
