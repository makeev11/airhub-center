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
