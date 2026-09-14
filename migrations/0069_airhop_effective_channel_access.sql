-- Channel-scoped AirHop service identities must not inherit the relay-wide
-- visibility of ordinary employees.  Their effective read access is the
-- intersection of an active channel membership and an active client-channel
-- assignment.  Keep this policy in one database function so history, search,
-- COUNT, live fan-out and internal-agent exposure checks cannot drift.

CREATE VIEW airhop_channel_scoped_service_principals AS
SELECT community_id, organization_id, agent_pubkey AS pubkey,
       'parent_administrator'::text AS service_kind
FROM airhop_agent_deployments
WHERE role = 'parent_administrator'
UNION
SELECT community_id, organization_id, connector_pubkey AS pubkey,
       'connector'::text AS service_kind
FROM airhop_channel_connections;

CREATE VIEW airhop_channel_service_grants AS
SELECT connection.community_id, connection.organization_id,
       connection.connector_pubkey AS pubkey,
       connection.buzz_channel_id AS channel_id
FROM airhop_channel_connections connection
WHERE connection.status = 'active'
  AND connection.buzz_channel_id IS NOT NULL
UNION
SELECT connection.community_id, connection.organization_id,
       deployment.agent_pubkey AS pubkey,
       connection.buzz_channel_id AS channel_id
FROM airhop_channel_connections connection
JOIN airhop_agent_deployments deployment
  ON deployment.community_id = connection.community_id
 AND deployment.organization_id = connection.organization_id
 AND deployment.role = 'parent_administrator'
WHERE connection.status = 'active'
  AND connection.hermes_enabled
  AND connection.buzz_channel_id IS NOT NULL
  AND deployment.enabled
  AND NOT deployment.paused
UNION
SELECT connection.community_id, connection.organization_id,
       connection.connector_pubkey AS pubkey,
       conversation.channel_id
FROM airhop_external_conversation_routes route
JOIN airhop_channel_connections connection
  ON connection.community_id = route.community_id
 AND connection.organization_id = route.organization_id
 AND connection.id = route.connection_id
JOIN airhop_external_conversations conversation
  ON conversation.community_id = route.community_id
 AND conversation.organization_id = route.organization_id
 AND conversation.id = route.conversation_id
WHERE connection.status = 'active'
  AND route.status = 'active'
  AND conversation.status = 'active'
UNION
SELECT connection.community_id, connection.organization_id,
       deployment.agent_pubkey AS pubkey,
       conversation.channel_id
FROM airhop_external_conversation_routes route
JOIN airhop_channel_connections connection
  ON connection.community_id = route.community_id
 AND connection.organization_id = route.organization_id
 AND connection.id = route.connection_id
JOIN airhop_external_conversations conversation
  ON conversation.community_id = route.community_id
 AND conversation.organization_id = route.organization_id
 AND conversation.id = route.conversation_id
JOIN airhop_agent_deployments deployment
  ON deployment.community_id = connection.community_id
 AND deployment.organization_id = connection.organization_id
 AND deployment.role = 'parent_administrator'
WHERE connection.status = 'active'
  AND connection.hermes_enabled
  AND route.status = 'active'
  AND conversation.status = 'active'
  AND deployment.enabled
  AND NOT deployment.paused;

CREATE FUNCTION airhop_can_read_channel(
    target_community UUID,
    target_channel UUID,
    reader_pubkey BYTEA
) RETURNS BOOLEAN
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
    SELECT EXISTS(
        SELECT 1
        FROM channels channel
        LEFT JOIN channel_members membership
          ON membership.community_id = channel.community_id
         AND membership.channel_id = channel.id
         AND membership.pubkey = reader_pubkey
         AND membership.removed_at IS NULL
        WHERE channel.community_id = target_community
          AND channel.id = target_channel
          AND channel.deleted_at IS NULL
          AND (
              (
                  NOT EXISTS(
                      SELECT 1
                      FROM airhop_channel_scoped_service_principals service
                      WHERE service.community_id = target_community
                        AND service.pubkey = reader_pubkey
                  )
                  AND (channel.visibility = 'open' OR membership.channel_id IS NOT NULL)
              )
              OR (
                  membership.channel_id IS NOT NULL
                  AND EXISTS(
                      SELECT 1
                      FROM airhop_channel_service_grants grant_row
                      WHERE grant_row.community_id = target_community
                        AND grant_row.channel_id = target_channel
                        AND grant_row.pubkey = reader_pubkey
                  )
              )
          )
    )
$$;
