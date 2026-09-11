-- One MVCC snapshot for every card and breakdown; one bounded raw-event scan.
WITH events AS MATERIALIZED (
    SELECT e.*, COALESCE(l.source, NULLIF(e.source, ''),
                        NULLIF(e.referrer_host, ''), 'direct') AS source_key
    FROM airhop_site_analytics_events e
    LEFT JOIN airhop_tracking_links l
      ON l.community_id = e.community_id AND l.organization_id = e.organization_id
     AND l.id = e.tracking_link_id
    WHERE e.community_id = $1 AND e.organization_id = $2
      AND e.occurred_at >= ($3::date::timestamp AT TIME ZONE $5)
      AND e.occurred_at < LEAST(($4::date + 1)::timestamp AT TIME ZONE $5, now())
), journeys AS (
    SELECT journey_id,
           bool_or(event_type = 'booking_opened') AS opened,
           bool_or(event_type = 'booking_step_completed' AND step = 'basics') AS basics,
           bool_or(event_type = 'booking_step_completed' AND step = 'groups') AS groups,
           bool_or(event_type = 'booking_step_completed' AND step = 'occurrences') AS occurrences,
           bool_or(event_type = 'booking_step_completed' AND step = 'contact') AS contact,
           bool_or(event_type = 'booking_step_completed' AND step = 'preview') AS preview,
           bool_or(event_type = 'booking_submit') AS submitted,
           bool_or(event_type = 'booking_created') AS created
    FROM events WHERE journey_id IS NOT NULL GROUP BY journey_id
), funnel AS (
    SELECT COUNT(*) AS opened,
           COUNT(*) FILTER (WHERE basics) AS "basicsCompleted",
           COUNT(*) FILTER (WHERE groups) AS "groupsCompleted",
           COUNT(*) FILTER (WHERE occurrences) AS "occurrencesCompleted",
           COUNT(*) FILTER (WHERE contact) AS "contactCompleted",
           COUNT(*) FILTER (WHERE preview) AS "previewCompleted",
           COUNT(*) FILTER (WHERE submitted) AS submitted,
           COUNT(*) FILTER (WHERE created) AS created
    FROM journeys WHERE opened
), totals AS (
    SELECT COUNT(DISTINCT visitor_digest) AS visitors,
           COUNT(DISTINCT session_digest) AS sessions,
           COUNT(*) FILTER (WHERE event_type = 'site_page_view') AS "pageViews",
           COUNT(DISTINCT booking_id) FILTER (WHERE event_type = 'booking_created') AS "bookingsCreated",
           COUNT(*) FILTER (WHERE event_type = 'contact_click') AS "contactClicks"
    FROM events
), daily AS (
    SELECT (occurred_at AT TIME ZONE $5)::date AS day,
           COUNT(DISTINCT visitor_digest) AS visitors,
           COUNT(DISTINCT session_digest) AS sessions,
           COUNT(DISTINCT booking_id) FILTER (WHERE event_type = 'booking_created') AS bookings,
           COUNT(*) FILTER (WHERE event_type = 'contact_click') AS contacts
    FROM events GROUP BY 1
), days AS (
    SELECT d::date AS date, COALESCE(m.visitors, 0) AS visitors,
           COALESCE(m.sessions, 0) AS sessions,
           COALESCE(m.bookings, 0) AS "bookingsCreated",
           COALESCE(m.contacts, 0) AS "contactClicks"
    FROM generate_series($3::timestamp, $4::timestamp, INTERVAL '1 day') d
    LEFT JOIN daily m ON m.day = d::date
), session_sources AS (
    -- Assign each observed session to exactly one source in this window.
    SELECT DISTINCT ON (session_digest) session_digest, source_key
    FROM events WHERE session_digest IS NOT NULL
    ORDER BY session_digest, occurred_at, event_id
), sources AS (
    SELECT COALESCE(s.source_key, e.source_key) AS source,
           COUNT(DISTINCT e.session_digest) AS sessions,
           COUNT(*) FILTER (WHERE e.event_type = 'tracking_link_open') AS "trackedLinkOpens",
           COUNT(DISTINCT e.booking_id) FILTER (WHERE e.event_type = 'booking_created') AS "bookingsCreated",
           COUNT(*) FILTER (WHERE e.event_type = 'contact_click') AS "contactClicks"
    FROM events e LEFT JOIN session_sources s USING (session_digest)
    GROUP BY 1
), pages AS (
    SELECT path, COUNT(*) FILTER (WHERE event_type = 'site_page_view') AS views,
           COUNT(*) FILTER (WHERE event_type = 'contact_click') AS "contactClicks"
    FROM events WHERE path IS NOT NULL
      AND event_type IN ('site_page_view', 'contact_click') GROUP BY path
), contacts AS (
    SELECT target, COUNT(*) AS clicks FROM events
    WHERE event_type = 'contact_click' GROUP BY target
), sessions AS (
    SELECT session_digest,
           bool_or(event_type = 'site_page_view') AS viewed,
           bool_or(event_type = 'booking_opened') AS opened,
           bool_or(event_type = 'contact_click') AS contacted,
           bool_or(event_type = 'booking_created') AS booked
    FROM events WHERE session_digest IS NOT NULL GROUP BY session_digest
), site_funnel AS (
    SELECT COUNT(*) AS "viewedSessions",
           COUNT(*) FILTER (WHERE opened) AS "bookingSessions",
           COUNT(*) FILTER (WHERE contacted) AS "contactSessions",
           COUNT(*) FILTER (WHERE booked) AS "bookedSessions"
    FROM sessions WHERE viewed
)
SELECT jsonb_build_object(
    'periodStart', $3::date, 'asOfDate', $4::date, 'generatedAt', now(), 'timeZone', $5::text,
    'firstEventAt', (SELECT occurred_at FROM airhop_site_analytics_events
        WHERE community_id = $1 AND organization_id = $2 ORDER BY occurred_at, event_id LIMIT 1),
    'lastEventAt', (SELECT occurred_at FROM airhop_site_analytics_events
        WHERE community_id = $1 AND organization_id = $2 ORDER BY occurred_at DESC, event_id DESC LIMIT 1),
    'totals', (SELECT to_jsonb(t) || jsonb_build_object('bookingOpens', f.opened,
        'bookingConversionBps', CASE WHEN f.opened > 0 THEN (f.created * 10000 / f.opened)::int END)
        FROM totals t CROSS JOIN funnel f),
    'funnel', (SELECT to_jsonb(f) FROM funnel f),
    'siteFunnel', (SELECT to_jsonb(s) FROM site_funnel s),
    'days', (SELECT COALESCE(jsonb_agg(d ORDER BY date), '[]') FROM days d),
    'sources', (SELECT COALESCE(jsonb_agg(s ORDER BY sessions DESC, source), '[]')
        FROM (SELECT * FROM sources ORDER BY sessions DESC, source LIMIT 100) s),
    'sourcesTruncated', (SELECT COUNT(*) > 100 FROM sources),
    'pages', (SELECT COALESCE(jsonb_agg(p ORDER BY views DESC, path), '[]')
        FROM (SELECT * FROM pages ORDER BY views DESC, path LIMIT 100) p),
    'pagesTruncated', (SELECT COUNT(*) > 100 FROM pages),
    'contacts', (SELECT COALESCE(jsonb_agg(c ORDER BY clicks DESC, target), '[]') FROM contacts c)
)
