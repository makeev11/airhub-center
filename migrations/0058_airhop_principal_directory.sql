-- Canonical organization identities, not display names or global persona definitions.
-- Retain disabled registrations as service principals so employee management cannot
-- accidentally remove their keys. No identity, membership or history is rewritten.
CREATE VIEW airhop_registered_principals AS
SELECT t.community_id, t.organization_id, role.name AS role, role.pubkey,
       'agent'::text AS principal_kind, true AS enabled, NULL::uuid AS deployment_id
FROM airhop_welcome_teams t
CROSS JOIN LATERAL (VALUES
    ('fizz',t.fizz_pubkey), ('administrator',t.administrator_pubkey),
    ('analyst',t.analyst_pubkey), ('content_marketer',t.content_marketer_pubkey)
) role(name,pubkey)
UNION ALL
SELECT community_id,organization_id,role,agent_pubkey,'agent',enabled AND NOT paused,id
FROM airhop_agent_deployments
UNION ALL
SELECT community_id,organization_id,'connector',connector_pubkey,'connector',status='active',NULL::uuid
FROM airhop_channel_connections;
