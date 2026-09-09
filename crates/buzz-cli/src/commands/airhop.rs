use crate::{client::BuzzClient, error::CliError, AirhopCmd};

/// Uses the authenticated Airhop surface appropriate to the requested role.
pub async fn dispatch(cmd: AirhopCmd, client: &BuzzClient) -> Result<(), CliError> {
    let path = match cmd {
        AirhopCmd::Parent { request } => {
            let body: serde_json::Value = serde_json::from_str(&request)
                .map_err(|error| CliError::Other(format!("invalid parent request: {error}")))?;
            let grant = match std::env::var("BUZZ_AIRHOP_CONTEXT_GRANT_FILE") {
                Ok(path) => std::fs::read_to_string(path)
                    .map_err(|_| CliError::Other("cannot read parent context grant file".into()))?,
                Err(_) => std::env::var("BUZZ_AIRHOP_CONTEXT_GRANT").map_err(|_| {
                    CliError::Other("a supervisor-issued parent context grant is required".into())
                })?,
            };
            println!(
                "{}",
                client
                    .call_airhop_parent_backend(&body, grant.trim())
                    .await?
            );
            return Ok(());
        }
        AirhopCmd::CenterAnalytics { days, yesterday } => format!(
            "/api/airhop/staff/v1/booking-funnel-analytics?view=center&days={days}&until={}",
            if yesterday { "yesterday" } else { "today" }
        ),
        AirhopCmd::SiteAnalytics { days, yesterday } => {
            format!(
                "/api/airhop/staff/v1/site-analytics?days={days}{}",
                if yesterday { "&until=yesterday" } else { "" }
            )
        }
        AirhopCmd::TrackingLinks => "/api/airhop/staff/v1/tracking-links".to_owned(),
    };
    let report = client.get_authed(&path).await?;
    let value: serde_json::Value = serde_json::from_str(&report)
        .map_err(|error| CliError::Other(format!("invalid Airhop report: {error}")))?;
    println!("{value}");
    Ok(())
}
