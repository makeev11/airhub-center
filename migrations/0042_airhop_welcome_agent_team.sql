-- Tenant-fenced Airhop Welcome agent team, routing, kickoff, and action ledger.

CREATE TABLE airhop_welcome_teams (
    community_id UUID NOT NULL PRIMARY KEY REFERENCES communities(id),
    organization_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    locale TEXT NOT NULL CHECK (length(btrim(locale)) BETWEEN 2 AND 32),
    fizz_pubkey BYTEA NOT NULL CHECK (octet_length(fizz_pubkey) = 32),
    administrator_pubkey BYTEA NOT NULL CHECK (octet_length(administrator_pubkey) = 32),
    analyst_pubkey BYTEA NOT NULL CHECK (octet_length(analyst_pubkey) = 32),
    content_marketer_pubkey BYTEA NOT NULL CHECK (octet_length(content_marketer_pubkey) = 32),
    registered_by_pubkey BYTEA NOT NULL CHECK (octet_length(registered_by_pubkey) = 32),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (community_id, channel_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, channel_id) REFERENCES channels (community_id, id),
    CHECK (fizz_pubkey <> administrator_pubkey AND fizz_pubkey <> analyst_pubkey
        AND fizz_pubkey <> content_marketer_pubkey
        AND administrator_pubkey <> analyst_pubkey
        AND administrator_pubkey <> content_marketer_pubkey
        AND analyst_pubkey <> content_marketer_pubkey)
);

CREATE TABLE airhop_welcome_routes (
    community_id UUID NOT NULL REFERENCES communities(id),
    organization_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    event_id BYTEA NOT NULL CHECK (octet_length(event_id) = 32),
    source_author_pubkey BYTEA NOT NULL CHECK (octet_length(source_author_pubkey) = 32),
    target_role TEXT NOT NULL CHECK (
        target_role IN ('fizz', 'administrator', 'analyst', 'content_marketer')),
    target_pubkey BYTEA NOT NULL CHECK (octet_length(target_pubkey) = 32),
    reason TEXT NOT NULL CHECK (
        reason IN ('explicit_mention', 'natural_role', 'last_question', 'handoff', 'fallback')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, event_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, channel_id) REFERENCES channels (community_id, id)
);
CREATE INDEX airhop_welcome_routes_channel_created_idx
    ON airhop_welcome_routes (community_id, channel_id, created_at DESC);

CREATE TABLE airhop_welcome_conversation_state (
    community_id UUID NOT NULL REFERENCES communities(id),
    organization_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    active_role TEXT CHECK (active_role IS NULL OR active_role IN
        ('fizz', 'administrator', 'analyst', 'content_marketer')),
    active_agent_pubkey BYTEA CHECK (
        active_agent_pubkey IS NULL OR octet_length(active_agent_pubkey) = 32),
    last_question_event_id BYTEA CHECK (
        last_question_event_id IS NULL OR octet_length(last_question_event_id) = 32),
    handoff_role TEXT CHECK (handoff_role IS NULL OR handoff_role IN
        ('fizz', 'administrator', 'analyst', 'content_marketer')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, channel_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, channel_id) REFERENCES channels (community_id, id)
);

CREATE TABLE airhop_welcome_kickoff_receipts (
    community_id UUID NOT NULL REFERENCES communities(id),
    organization_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('fizz_intro', 'administrator_intro',
        'analyst_intro', 'content_marketer_intro', 'fizz_first_question')),
    task_id UUID NOT NULL,
    agent_pubkey BYTEA NOT NULL CHECK (octet_length(agent_pubkey) = 32),
    receipt_event_id BYTEA NOT NULL CHECK (octet_length(receipt_event_id) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, channel_id, stage),
    UNIQUE (community_id, task_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, channel_id) REFERENCES channels (community_id, id)
);

CREATE TABLE airhop_agent_actions (
    community_id UUID NOT NULL REFERENCES communities(id),
    organization_id UUID NOT NULL,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL,
    triggering_event_id BYTEA NOT NULL CHECK (octet_length(triggering_event_id) = 32),
    initiator_pubkey BYTEA NOT NULL CHECK (octet_length(initiator_pubkey) = 32),
    prepared_by_agent_pubkey BYTEA NOT NULL CHECK (octet_length(prepared_by_agent_pubkey) = 32),
    specialist_role TEXT NOT NULL CHECK (
        specialist_role IN ('administrator', 'analyst', 'content_marketer')),
    command JSONB NOT NULL CHECK (jsonb_typeof(command) = 'object'),
    command_digest BYTEA NOT NULL CHECK (octet_length(command_digest) = 32),
    expected_versions JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(expected_versions) = 'object'),
    preview_event_id BYTEA CHECK (
        preview_event_id IS NULL OR octet_length(preview_event_id) = 32),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'cancelled', 'committed', 'expired', 'failed')),
    expires_at TIMESTAMPTZ NOT NULL,
    confirmed_by_pubkey BYTEA CHECK (
        confirmed_by_pubkey IS NULL OR octet_length(confirmed_by_pubkey) = 32),
    reaction_event_id BYTEA CHECK (
        reaction_event_id IS NULL OR octet_length(reaction_event_id) = 32),
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    committed_at TIMESTAMPTZ,
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, triggering_event_id, command_digest),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, channel_id) REFERENCES channels (community_id, id),
    CHECK ((status = 'committed' AND preview_event_id IS NOT NULL
        AND confirmed_by_pubkey IS NOT NULL AND reaction_event_id IS NOT NULL
        AND result IS NOT NULL AND committed_at IS NOT NULL) OR status <> 'committed')
);
CREATE UNIQUE INDEX airhop_agent_actions_preview_event_idx
    ON airhop_agent_actions (community_id, preview_event_id)
    WHERE preview_event_id IS NOT NULL;
CREATE INDEX airhop_agent_actions_pending_idx
    ON airhop_agent_actions (community_id, organization_id, expires_at)
    WHERE status = 'pending';
