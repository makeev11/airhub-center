-- Authoring is distinct from the existing parent-visible publication projection.
CREATE TABLE airhop_knowledge_sources (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    id UUID NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    media_type TEXT NOT NULL,
    sha256 BYTEA NOT NULL CHECK (octet_length(sha256) = 32),
    bytes BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 10485760),
    created_by BYTEA NOT NULL CHECK (octet_length(created_by) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, sha256),
    FOREIGN KEY (community_id, organization_id) REFERENCES airhop_organizations(community_id, id)
);
CREATE TABLE airhop_knowledge_materials (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    id UUID NOT NULL,
    draft JSONB NOT NULL,
    version BIGINT NOT NULL CHECK (version > 0),
    published_version BIGINT,
    archived BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id) REFERENCES airhop_organizations(community_id, id)
);
CREATE TABLE airhop_knowledge_revisions (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    material_id UUID NOT NULL,
    version BIGINT NOT NULL,
    operation TEXT NOT NULL,
    draft JSONB NOT NULL,
    actor BYTEA CHECK (actor IS NULL OR octet_length(actor) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id, material_id, version),
    FOREIGN KEY (community_id, organization_id, material_id) REFERENCES airhop_knowledge_materials(community_id, organization_id, id)
);
CREATE TABLE airhop_knowledge_receipts (
    community_id UUID NOT NULL REFERENCES communities(id),
    event_id BYTEA NOT NULL CHECK (octet_length(event_id) = 32),
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, event_id)
);
ALTER TABLE airhop_knowledge_documents ADD COLUMN website_allowed BOOLEAN NOT NULL DEFAULT false;
-- Preserve existing published artifacts; do not silently approve website use.
INSERT INTO airhop_knowledge_materials
SELECT community_id, organization_id, id,
    jsonb_build_object('title', title, 'topic', 'imported', 'locale', locale,
        'audience', CASE WHEN audience='staff' THEN 'staff' ELSE 'parent' END,
        'websiteAllowed', false, 'scopeType', scope_type, 'scopeId', scope_id,
        'questions', '[]'::jsonb, 'markdown', markdown, 'sourceId', NULL),
    version, CASE WHEN status='published' THEN version ELSE NULL END,
    status='archived', updated_at
FROM airhop_knowledge_documents;
INSERT INTO airhop_knowledge_revisions
SELECT community_id, organization_id, id, version, 'migration', draft, NULL, updated_at
FROM airhop_knowledge_materials;
CREATE INDEX airhop_knowledge_materials_listing ON airhop_knowledge_materials(community_id, organization_id, id);
CREATE INDEX airhop_knowledge_fulltext ON airhop_knowledge_documents USING GIN
    (to_tsvector('simple', title || ' ' || markdown)) WHERE status = 'published';
