-- Additive rollout: legacy histories stay untouched until an explicit cutover.
ALTER TABLE airhop_organizations ADD COLUMN parents_buzz_channel_id UUID,
    ADD FOREIGN KEY (community_id, parents_buzz_channel_id) REFERENCES channels(community_id, id);

ALTER TABLE airhop_channel_connections
    ADD COLUMN buzz_channel_id UUID,
    ADD COLUMN branch_id UUID,
    ADD COLUMN routing_mode TEXT NOT NULL DEFAULT 'central' CHECK (routing_mode IN ('central', 'branch')),
    ADD FOREIGN KEY (community_id, buzz_channel_id) REFERENCES channels(community_id, id),
    ADD FOREIGN KEY (community_id, organization_id, branch_id) REFERENCES airhop_branches(community_id, organization_id, id),
    ADD CHECK ((routing_mode = 'central' AND branch_id IS NULL) OR (routing_mode = 'branch' AND branch_id IS NOT NULL));

ALTER TABLE airhop_external_conversations
    DROP CONSTRAINT airhop_external_conversations_community_id_channel_id_key,
    ADD COLUMN threaded BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN root_event_id BYTEA CHECK (root_event_id IS NULL OR octet_length(root_event_id) = 32),
    ADD COLUMN branch_id UUID,
    ADD COLUMN assignee_pubkey BYTEA CHECK (assignee_pubkey IS NULL OR octet_length(assignee_pubkey) = 32),
    ADD COLUMN title VARCHAR(200) NOT NULL DEFAULT 'Новый контакт',
    ADD COLUMN queue_status TEXT NOT NULL DEFAULT 'waiting_staff' CHECK (queue_status IN ('waiting_staff', 'waiting_parent', 'resolved')),
    ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    ADD COLUMN last_inbound_at TIMESTAMPTZ,
    ADD COLUMN resolved_at TIMESTAMPTZ,
    ADD FOREIGN KEY (community_id, organization_id, branch_id) REFERENCES airhop_branches(community_id, organization_id, id),
    ADD CHECK (threaded OR root_event_id IS NULL);

CREATE UNIQUE INDEX airhop_legacy_conversation_channel_idx
    ON airhop_external_conversations(community_id, channel_id) WHERE NOT threaded;
CREATE UNIQUE INDEX airhop_conversation_root_idx
    ON airhop_external_conversations(community_id, channel_id, root_event_id) WHERE root_event_id IS NOT NULL;
CREATE INDEX airhop_client_inbox_idx
    ON airhop_external_conversations(community_id, organization_id, branch_id, queue_status, updated_at DESC, id)
    WHERE status = 'active';

CREATE TABLE airhop_branch_client_responsibles (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    pubkey BYTEA NOT NULL CHECK (octet_length(pubkey) = 32),
    PRIMARY KEY (community_id, branch_id, pubkey),
    FOREIGN KEY (community_id, organization_id, branch_id) REFERENCES airhop_branches(community_id, organization_id, id)
);

CREATE TABLE airhop_conversation_changes (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    idempotency_key UUID NOT NULL,
    conversation_id UUID NOT NULL,
    actor_pubkey BYTEA NOT NULL CHECK (octet_length(actor_pubkey) = 32),
    request JSONB NOT NULL,
    result JSONB NOT NULL,
    notification_event_id BYTEA,
    notification_dispatched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, idempotency_key),
    FOREIGN KEY (community_id, organization_id, conversation_id) REFERENCES airhop_external_conversations(community_id, organization_id, id)
);

CREATE TABLE airhop_branch_client_routing_changes (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    idempotency_key UUID NOT NULL,
    actor_pubkey BYTEA NOT NULL CHECK (octet_length(actor_pubkey)=32),
    request JSONB NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id,idempotency_key),
    FOREIGN KEY (community_id,organization_id,branch_id) REFERENCES airhop_branches(community_id,organization_id,id)
);

ALTER TABLE airhop_external_conversation_cycles
    DROP CONSTRAINT airhop_external_conversation_cycles_started_by_check,
    ADD CHECK (started_by IN ('registration', 'staff_resume', 'parent_reopened'));

CREATE TABLE airhop_conversation_legacy_locations (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    new_root_event_id BYTEA NOT NULL CHECK (octet_length(new_root_event_id) = 32),
    migrated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, channel_id),
    UNIQUE (community_id, conversation_id),
    FOREIGN KEY (community_id, organization_id, conversation_id) REFERENCES airhop_external_conversations(community_id, organization_id, id),
    FOREIGN KEY (community_id, channel_id) REFERENCES channels(community_id, id)
);

-- Inbound acceptance records work even if the relay crashes before notifying staff.
CREATE TABLE airhop_client_inbound_notifications (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    source_event_id BYTEA NOT NULL CHECK(octet_length(source_event_id)=32),
    notification_event_id BYTEA,
    notification_dispatched_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(community_id,source_event_id),
    FOREIGN KEY(community_id,organization_id,conversation_id)
        REFERENCES airhop_external_conversations(community_id,organization_id,id)
);
CREATE INDEX airhop_client_inbound_notice_pending_idx
    ON airhop_client_inbound_notifications(next_attempt_at,created_at) WHERE notification_dispatched_at IS NULL;
