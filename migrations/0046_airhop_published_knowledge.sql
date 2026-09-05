-- Versioned, tenant-scoped Markdown used by AirHop agents for approved answers.

CREATE TABLE airhop_knowledge_documents (
    community_id      UUID        NOT NULL REFERENCES communities(id),
    organization_id   UUID        NOT NULL,
    id                UUID        NOT NULL,
    slug              TEXT        NOT NULL,
    title             TEXT        NOT NULL,
    markdown          TEXT        NOT NULL,
    locale            TEXT        NOT NULL,
    audience          TEXT        NOT NULL,
    scope_type        TEXT        NOT NULL,
    scope_id          UUID,
    status            TEXT        NOT NULL DEFAULT 'draft',
    version           BIGINT      NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
    CHECK (length(title) BETWEEN 1 AND 200),
    CHECK (length(markdown) BETWEEN 1 AND 50000),
    CHECK (length(locale) BETWEEN 2 AND 35),
    CHECK (audience IN ('public', 'parent', 'staff')),
    CHECK (scope_type IN ('organization', 'branch', 'group')),
    CHECK ((scope_type = 'organization' AND scope_id IS NULL)
        OR (scope_type IN ('branch', 'group') AND scope_id IS NOT NULL)),
    CHECK (status IN ('draft', 'published', 'archived')),
    CHECK (version > 0)
);

CREATE UNIQUE INDEX airhop_knowledge_identity_idx
    ON airhop_knowledge_documents
       (community_id, organization_id, locale, audience, scope_type,
        COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

CREATE INDEX airhop_knowledge_published_search_idx
    ON airhop_knowledge_documents
       (community_id, organization_id, locale, audience, scope_type, scope_id)
    WHERE status = 'published';
