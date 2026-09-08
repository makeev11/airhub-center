-- First-party site and public-booking analytics owned by AirHub Center.
--
-- Raw events are deliberately separate from operational domain events: public
-- browser telemetry is high-volume, anonymous, and has no command causation.
-- Every row remains tenant fenced and append-only.

CREATE TABLE airhop_tracking_links (
    community_id       UUID         NOT NULL REFERENCES communities(id),
    organization_id    UUID         NOT NULL,
    id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
    slug               VARCHAR(80)  NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
    name               VARCHAR(160) NOT NULL CHECK (length(btrim(name)) > 0),
    source             TEXT         NOT NULL CHECK (
        source IN ('yandex_maps', 'google_maps', 'two_gis', 'qr', 'campaign', 'custom')
    ),
    goal               TEXT         NOT NULL CHECK (goal IN ('site', 'booking', 'contact')),
    destination_path   VARCHAR(512) NOT NULL CHECK (
        destination_path LIKE '/%'
        AND destination_path NOT LIKE '//%'
        AND destination_path NOT LIKE '%?%'
        AND destination_path NOT LIKE '%#%'
    ),
    branch_id          UUID,
    status             TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version            BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, slug),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, branch_id)
        REFERENCES airhop_branches (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE INDEX airhop_tracking_links_list_idx
    ON airhop_tracking_links
    (community_id, organization_id, status, created_at DESC, id);

CREATE TABLE airhop_site_analytics_events (
    community_id       UUID         NOT NULL REFERENCES communities(id),
    organization_id    UUID         NOT NULL,
    event_id           UUID         NOT NULL,
    event_type         TEXT         NOT NULL CHECK (
        event_type IN (
            'site_page_view',
            'contact_click',
            'booking_opened',
            'booking_step_viewed',
            'booking_step_completed',
            'booking_submit',
            'booking_created',
            'tracking_link_open'
        )
    ),
    occurred_at        TIMESTAMPTZ  NOT NULL,
    received_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    visitor_digest     BYTEA        CHECK (
        visitor_digest IS NULL OR length(visitor_digest) = 32
    ),
    session_digest     BYTEA        CHECK (
        session_digest IS NULL OR length(session_digest) = 32
    ),
    journey_id         UUID,
    booking_id         UUID,
    tracking_link_id   UUID,
    branch_id          UUID,
    path               VARCHAR(512),
    referrer_host      VARCHAR(253),
    source             VARCHAR(80),
    campaign           VARCHAR(160),
    step               TEXT CHECK (
        step IS NULL OR step IN ('basics', 'groups', 'occurrences', 'contact', 'preview')
    ),
    target             TEXT CHECK (
        target IS NULL OR target IN ('phone', 'email', 'telegram', 'whatsapp', 'max', 'other')
    ),
    PRIMARY KEY (community_id, event_id),
    UNIQUE (community_id, organization_id, event_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, booking_id)
        REFERENCES airhop_bookings (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, tracking_link_id)
        REFERENCES airhop_tracking_links (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, branch_id)
        REFERENCES airhop_branches (community_id, organization_id, id),
    CHECK (event_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (journey_id IS NULL OR journey_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (
        (event_type = 'booking_created' AND booking_id IS NOT NULL)
        OR (event_type <> 'booking_created' AND booking_id IS NULL)
    ),
    CHECK (
        (event_type IN ('booking_step_viewed', 'booking_step_completed') AND step IS NOT NULL)
        OR (event_type NOT IN ('booking_step_viewed', 'booking_step_completed') AND step IS NULL)
    ),
    CHECK (
        (event_type = 'contact_click' AND target IS NOT NULL)
        OR (event_type <> 'contact_click' AND target IS NULL)
    ),
    CHECK (
        (event_type IN (
            'booking_opened',
            'booking_step_viewed',
            'booking_step_completed',
            'booking_submit'
        ) AND journey_id IS NOT NULL)
        OR event_type NOT IN (
            'booking_opened',
            'booking_step_viewed',
            'booking_step_completed',
            'booking_submit'
        )
    )
);

CREATE INDEX airhop_site_analytics_events_period_idx
    ON airhop_site_analytics_events
    (community_id, organization_id, occurred_at DESC, event_id);
CREATE INDEX airhop_site_analytics_events_retention_idx
    ON airhop_site_analytics_events (occurred_at, community_id, event_id);
CREATE INDEX airhop_site_analytics_events_type_idx
    ON airhop_site_analytics_events
    (community_id, organization_id, event_type, occurred_at DESC, event_id);
CREATE INDEX airhop_site_analytics_events_journey_idx
    ON airhop_site_analytics_events
    (community_id, organization_id, journey_id, occurred_at, event_id)
    WHERE journey_id IS NOT NULL;
CREATE INDEX airhop_site_analytics_events_link_idx
    ON airhop_site_analytics_events
    (community_id, organization_id, tracking_link_id, occurred_at DESC, event_id)
    WHERE tracking_link_id IS NOT NULL;

CREATE FUNCTION airhop_site_analytics_events_append_only() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('buzz.airhop_analytics_retention', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'AirHub site analytics events are append-only'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_airhop_site_analytics_events_append_only
    BEFORE UPDATE OR DELETE ON airhop_site_analytics_events
    FOR EACH ROW EXECUTE FUNCTION airhop_site_analytics_events_append_only();

CREATE TRIGGER trg_airhop_tracking_links_tenant_immutable
    BEFORE UPDATE ON airhop_tracking_links
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
