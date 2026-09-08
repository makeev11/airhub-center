use crate::{client::BuzzClient, error::CliError, AirhopCmd};

/// Reads the same NIP-98-protected report used by Center and the Analyst.
pub async fn dispatch(cmd: AirhopCmd, client: &BuzzClient) -> Result<(), CliError> {
    let path = match cmd {
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
