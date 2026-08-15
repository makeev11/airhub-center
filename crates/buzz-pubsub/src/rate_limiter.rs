//! Redis-backed rate limiter using atomic Lua script (INCR + EXPIRE).
//!
//! Implements the [`RateLimiter`] trait from `buzz-auth`.
//! Uses a single Lua script to atomically INCR and conditionally EXPIRE,
//! eliminating the crash window where a key could exist without a TTL.
//!
//! ⚠️ Fixed windows allow up to 2× burst at boundaries. Upgrade to sliding
//! window or token bucket for strict limiting.

use std::net::IpAddr;

use buzz_auth::{
    error::AuthError,
    rate_limit::{LimitType, RateLimitResult, RateLimiter},
};
use buzz_core::TenantContext;
use nostr::PublicKey;
use redis::Script;

/// Atomically INCR the key, set EXPIRE on first call, and return (count, ttl).
///
/// Using a Lua script ensures INCR and EXPIRE are executed atomically —
/// a crash between them can no longer leave a key without a TTL.
const RATE_LIMIT_SCRIPT: &str = r#"
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
"#;

/// Run the atomic rate-limit Lua script against `key` and return a
/// [`RateLimitResult`].
///
/// If the TTL comes back negative (key exists without expiry — broken state
/// from a prior crash), the key is repaired with a fresh EXPIRE and a warning
/// is logged.
async fn run_rate_limit(
    pool: &deadpool_redis::Pool,
    key: &str,
    window_secs: u64,
    limit: u64,
) -> Result<RateLimitResult, AuthError> {
    let mut conn = pool
        .get()
        .await
        .map_err(|e| AuthError::Internal(format!("Redis pool: {e}")))?;

    let script = Script::new(RATE_LIMIT_SCRIPT);
    let (count, ttl): (u64, i64) = script
        .key(key)
        .arg(window_secs as i64)
        .invoke_async(&mut *conn)
        .await
        .map_err(|e| AuthError::Internal(format!("Redis rate limit script: {e}")))?;

    // ttl == -1 means the key exists but has no expiry — broken state from a
    // prior crash between INCR and EXPIRE. Repair it now.
    let reset_in_secs = if ttl < 0 {
        tracing::warn!(key = %key, "rate limit key has no TTL — repairing");
        let _: () = redis::cmd("EXPIRE")
            .arg(key)
            .arg(window_secs as i64)
            .query_async(&mut *conn)
            .await
            .map_err(|e| AuthError::Internal(format!("Redis EXPIRE repair: {e}")))?;
        // After repair, the window resets to the full duration.
        window_secs
    } else {
        ttl.max(0) as u64
    };

    if count <= limit {
        Ok(RateLimitResult::allowed(count, limit, reset_in_secs))
    } else {
        Ok(RateLimitResult::denied(count, limit, reset_in_secs))
    }
}

/// Redis-backed rate limiter using fixed-window counters.
///
/// Pubkey keys are community-scoped via `&TenantContext`:
/// `buzz:{community}:ratelimit:{pubkey_hex}:{suffix}`. IP keys remain
/// operator-global: `buzz:ratelimit:ip:{ip}:conn`. The counter and its TTL are
/// managed atomically via a Lua script to prevent keys from persisting without
/// expiry.
pub struct RedisRateLimiter {
    pool: deadpool_redis::Pool,
}

impl RedisRateLimiter {
    /// Create a new `RedisRateLimiter` backed by the given connection pool.
    pub fn new(pool: deadpool_redis::Pool) -> Self {
        Self { pool }
    }

    /// Increments a tenant-scoped anonymous quota identified only by a keyed digest.
    ///
    /// Public unauthenticated surfaces have no pubkey, so callers first HMAC a
    /// privacy-sensitive fingerprint such as an IP address or normalized phone.
    /// Redis receives only that digest. `namespace` separates independent
    /// operations and is restricted to a small safe key alphabet.
    pub async fn check_scoped_anonymous(
        &self,
        ctx: &TenantContext,
        namespace: &str,
        fingerprint_digest: &[u8; 32],
        window_secs: u64,
        limit: u64,
    ) -> Result<RateLimitResult, AuthError> {
        let key = anonymous_rate_limit_key(ctx, namespace, fingerprint_digest)?;
        run_rate_limit(&self.pool, &key, window_secs, limit).await
    }
}

fn anonymous_rate_limit_key(
    ctx: &TenantContext,
    namespace: &str,
    fingerprint_digest: &[u8; 32],
) -> Result<String, AuthError> {
    if namespace.is_empty()
        || namespace.len() > 48
        || !namespace
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(AuthError::Internal(
            "invalid anonymous rate-limit namespace".to_owned(),
        ));
    }
    Ok(format!(
        "buzz:{}:ratelimit:anon:{namespace}:{}",
        ctx.community(),
        hex::encode(fingerprint_digest)
    ))
}

impl RateLimiter for RedisRateLimiter {
    async fn check_and_increment(
        &self,
        ctx: &TenantContext,
        pubkey: &PublicKey,
        limit_type: LimitType,
        window_secs: u64,
        limit: u64,
    ) -> Result<RateLimitResult, AuthError> {
        let key = buzz_auth::rate_limit::rate_limit_key(ctx, pubkey, &limit_type);
        run_rate_limit(&self.pool, &key, window_secs, limit).await
    }

    async fn check_ip_connection(
        &self,
        ip: &IpAddr,
        window_secs: u64,
        limit: u64,
    ) -> Result<RateLimitResult, AuthError> {
        let key = buzz_auth::rate_limit::ip_rate_limit_key(ip);
        run_rate_limit(&self.pool, &key, window_secs, limit).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::CommunityId;
    use uuid::Uuid;

    #[test]
    fn anonymous_keys_are_tenant_and_namespace_scoped_without_raw_fingerprint() {
        let first =
            TenantContext::resolved(CommunityId::from_uuid(Uuid::from_u128(1)), "first.example");
        let second =
            TenantContext::resolved(CommunityId::from_uuid(Uuid::from_u128(2)), "second.example");
        let digest = [0xab; 32];
        let first_ip =
            anonymous_rate_limit_key(&first, "airhop_ip", &digest).expect("valid anonymous key");
        let first_phone =
            anonymous_rate_limit_key(&first, "airhop_phone", &digest).expect("valid anonymous key");
        let second_ip =
            anonymous_rate_limit_key(&second, "airhop_ip", &digest).expect("valid anonymous key");
        assert_ne!(first_ip, first_phone);
        assert_ne!(first_ip, second_ip);
        assert!(first_ip.ends_with(&hex::encode(digest)));
        assert!(!first_ip.contains("first.example"));
    }

    #[test]
    fn anonymous_namespace_rejects_redis_key_delimiters() {
        let tenant =
            TenantContext::resolved(CommunityId::from_uuid(Uuid::from_u128(1)), "relay.example");
        assert!(anonymous_rate_limit_key(&tenant, "airhop:ip", &[1; 32]).is_err());
    }
}
