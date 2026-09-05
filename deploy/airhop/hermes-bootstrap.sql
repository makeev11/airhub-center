\set ON_ERROR_STOP on

-- Demo/pilot operator bootstrap. Product settings continue through the normal
-- authenticated control-plane API after this initial deployment record exists.
BEGIN;

INSERT INTO airhop_agent_deployments (
    community_id,
    organization_id,
    id,
    blueprint_key,
    blueprint_version,
    role,
    agent_pubkey,
    profile_ref,
    runtime_revision,
    persona_revision,
    skills_revision,
    model_revision,
    enabled,
    paused,
    manage_bookings,
    registered_by_pubkey
)
SELECT
    organization.community_id,
    organization.id,
    'a1000000-0000-4000-8000-000000000007'::uuid,
    'airhop.hermes.parent_administrator',
    1,
    'parent_administrator',
    decode(:'agent_pubkey', 'hex'),
    'organizations/' || organization.id::text || '/hermes',
    'hermes-agent@e624e9fde561e1add9388384012b295fde669ade+airhop.v1',
    'airhop-hermes-parent.v1',
    'airhop-agent-mcp.v1',
    :'model_revision',
    TRUE,
    FALSE,
    TRUE,
    decode(:'owner_pubkey', 'hex')
FROM airhop_organizations organization
JOIN communities community ON community.id = organization.community_id
JOIN users agent
  ON agent.community_id = organization.community_id
 AND agent.pubkey = decode(:'agent_pubkey', 'hex')
 AND agent.deactivated_at IS NULL
WHERE lower(community.host) = lower(:'community_host')
  AND organization.status = 'active'
ON CONFLICT (community_id, organization_id, role) DO UPDATE SET
    runtime_revision = EXCLUDED.runtime_revision,
    persona_revision = EXCLUDED.persona_revision,
    skills_revision = EXCLUDED.skills_revision,
    model_revision = EXCLUDED.model_revision,
    registered_by_pubkey = EXCLUDED.registered_by_pubkey,
    version = airhop_agent_deployments.version + 1,
    updated_at = now();

SELECT count(*) = 1 AS deployment_matches
  FROM airhop_agent_deployments deployment
  JOIN communities community ON community.id = deployment.community_id
 WHERE lower(community.host) = lower(:'community_host')
   AND deployment.role = 'parent_administrator'
   AND deployment.agent_pubkey = decode(:'agent_pubkey', 'hex')
\gset

\if :deployment_matches
\else
    \echo 'Hermes deployment missing or bound to a different agent pubkey.'
    \quit 1
\endif

COMMIT;

SELECT
    deployment.id,
    deployment.role,
    encode(deployment.agent_pubkey, 'hex') AS agent_pubkey,
    deployment.runtime_revision,
    deployment.model_revision,
    deployment.enabled,
    deployment.paused
FROM airhop_agent_deployments deployment
JOIN communities community ON community.id = deployment.community_id
WHERE lower(community.host) = lower(:'community_host')
  AND deployment.role = 'parent_administrator';
