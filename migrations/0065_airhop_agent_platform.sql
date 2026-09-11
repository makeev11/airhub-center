-- Organization-owned agent duties, recurring work and versioned learning.
CREATE TABLE airhop_agent_policies (
    community_id UUID NOT NULL REFERENCES communities(id),
    organization_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('fizz','administrator','analyst','content_marketer','parent_administrator')),
    policy JSONB NOT NULL CHECK (jsonb_typeof(policy)='object'),
    version BIGINT NOT NULL CHECK (version>0),
    updated_by BYTEA NOT NULL CHECK (octet_length(updated_by)=32),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id, role),
    FOREIGN KEY (community_id, organization_id) REFERENCES airhop_organizations(community_id,id)
);

CREATE TABLE airhop_agent_policy_receipts (
    community_id UUID NOT NULL REFERENCES communities(id),
    event_id BYTEA NOT NULL CHECK (octet_length(event_id)=32),
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id,event_id)
);

CREATE TABLE airhop_agent_notice_jobs (
    community_id UUID NOT NULL REFERENCES communities(id),
    organization_id UUID NOT NULL,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    role TEXT NOT NULL CHECK (role IN ('administrator','analyst')),
    local_date DATE NOT NULL,
    channel_id UUID NOT NULL,
    policy_version BIGINT NOT NULL CHECK (policy_version>=0),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','cancelled')),
    event_id BYTEA CHECK (octet_length(event_id)=32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    PRIMARY KEY (community_id,id),
    UNIQUE (community_id,organization_id,role,local_date,channel_id),
    FOREIGN KEY (community_id,organization_id) REFERENCES airhop_organizations(community_id,id),
    FOREIGN KEY (community_id,channel_id) REFERENCES channels(community_id,id)
);
CREATE INDEX airhop_agent_notice_pending ON airhop_agent_notice_jobs(created_at) WHERE status='pending';

CREATE TABLE airhop_agent_duty_runs (
    community_id UUID NOT NULL REFERENCES communities(id),
    role TEXT NOT NULL,
    local_date DATE NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(community_id,role,local_date)
);
CREATE INDEX airhop_children_birthday_active_idx ON airhop_children
    (community_id,organization_id,(extract(month FROM birth_date)),(extract(day FROM birth_date)))
    WHERE status='active';

-- Routing evidence for verified ephemeral handoffs; no customer text is copied.
CREATE TABLE airhop_agent_task_sources (
    community_id UUID NOT NULL REFERENCES communities(id),
    event_id BYTEA NOT NULL CHECK(octet_length(event_id)=32),
    channel_id UUID NOT NULL,
    target_role TEXT NOT NULL,
    target_pubkey BYTEA NOT NULL CHECK(octet_length(target_pubkey)=32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(community_id,event_id),
    FOREIGN KEY(community_id,channel_id) REFERENCES channels(community_id,id)
);

CREATE TABLE airhop_agent_procedures (
    community_id UUID NOT NULL REFERENCES communities(id),
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    role TEXT NOT NULL,
    digest TEXT NOT NULL,
    plan JSONB NOT NULL,
    observations BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(community_id,id),
    UNIQUE(community_id,role,digest)
);
CREATE TABLE airhop_agent_procedure_observations (
    community_id UUID NOT NULL REFERENCES communities(id),
    reply_event_id BYTEA NOT NULL CHECK(octet_length(reply_event_id)=32),
    procedure_id UUID NOT NULL,
    PRIMARY KEY(community_id,reply_event_id),
    FOREIGN KEY(community_id,procedure_id) REFERENCES airhop_agent_procedures(community_id,id)
);
CREATE TABLE airhop_agent_procedure_versions (
    community_id UUID NOT NULL REFERENCES communities(id),
    role TEXT NOT NULL,
    version BIGINT NOT NULL CHECK(version>0),
    procedure_id UUID,
    reviewed_by BYTEA NOT NULL CHECK(octet_length(reviewed_by)=32),
    event_id BYTEA NOT NULL CHECK(octet_length(event_id)=32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(community_id,role,version),
    UNIQUE(community_id,event_id),
    FOREIGN KEY(community_id,procedure_id) REFERENCES airhop_agent_procedures(community_id,id)
);
