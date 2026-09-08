-- One statement / one MVCC snapshot. Never join independent fact tables before
-- aggregation. All operational joins carry community and organization keys.
WITH context AS MATERIALIZED (
    SELECT community_id, id AS organization_id, time_zone, now() AS generated_at,
           (now() AT TIME ZONE time_zone)::date AS today,
           (now() AT TIME ZONE time_zone)::date - $3::int AS end_date,
           (now() AT TIME ZONE time_zone)::date - $3::int - ($2::int - 1) AS start_date
    FROM airhop_organizations WHERE community_id = $1 AND status = 'active'
), bounds AS (
    SELECT *, start_date::timestamp AT TIME ZONE time_zone AS start_at,
           least(generated_at, (end_date + 1)::timestamp AT TIME ZONE time_zone) AS end_at,
           (start_date - $2::int)::timestamp AT TIME ZONE time_zone AS previous_start_at
    FROM context
), bookings AS MATERIALIZED (
    SELECT b.*, o.group_id, o.branch_id, o.ends_at, o.status AS lesson_status,
           (b.created_at AT TIME ZONE c.time_zone)::date AS created_date,
           (b.source->>'workflow' = 'direct' OR b.status = 'confirmed' OR EXISTS (
               SELECT 1 FROM airhop_domain_events ev
               WHERE ev.community_id = b.community_id AND ev.organization_id = b.organization_id
                 AND ev.stream_type = 'booking' AND ev.stream_id = b.id
                 AND ev.event_type IN ('airhop.booking.confirmed.v1', 'airhop.booking.confirmed_by_staff.v1')
           )) AS was_confirmed,
           a.status AS attendance_status,
           COALESCE(link.source, NULLIF(attribution.source, ''),
                    NULLIF(b.source->>'channel', ''), 'unknown') AS acquisition_source,
           link.id AS tracking_link_id, link.name AS link_name,
           (attribution.event_id IS NOT NULL) AS attributed
    FROM bounds c
    JOIN airhop_bookings b ON b.community_id = c.community_id AND b.organization_id = c.organization_id
    JOIN airhop_lesson_occurrences o ON o.community_id = b.community_id AND o.organization_id = b.organization_id
        AND o.recurrence_rule_id = b.recurrence_rule_id AND o.original_date = b.original_date
    LEFT JOIN airhop_lesson_attendance a ON a.community_id = b.community_id AND a.organization_id = b.organization_id
        AND a.recurrence_rule_id = b.recurrence_rule_id AND a.original_date = b.original_date AND a.child_id = b.child_id
    LEFT JOIN LATERAL (
        SELECT event_id, source, tracking_link_id FROM airhop_site_analytics_events e
        WHERE e.community_id = b.community_id AND e.organization_id = b.organization_id
          AND e.booking_id = b.id AND e.event_type = 'booking_created'
        ORDER BY e.occurred_at, e.event_id LIMIT 1
    ) attribution ON TRUE
    LEFT JOIN airhop_tracking_links link ON link.community_id = b.community_id
        AND link.organization_id = b.organization_id AND link.id = attribution.tracking_link_id
    WHERE b.created_at >= c.start_at AND b.created_at < c.end_at
), conversions AS MATERIALIZED (
    -- Canonical single origin per enrollment prevents repeated events from
    -- multiplying students or money. Legacy events without an explicit booking
    -- reference remain unlinked rather than guessed by a child's identity.
    SELECT DISTINCT ON (ev.payload->>'enrollmentId')
           ev.payload->>'enrollmentId' AS enrollment_id,
           ev.payload->>'sourceBookingId' AS booking_id
    FROM bounds c
    JOIN airhop_domain_events ev ON ev.community_id = c.community_id AND ev.organization_id = c.organization_id
    WHERE ev.event_type = 'airhop.enrollment.created_from_trial.v1'
      AND ev.payload ? 'enrollmentId' AND ev.payload ? 'sourceBookingId'
      AND ev.occurred_at <= c.generated_at
    ORDER BY ev.payload->>'enrollmentId', ev.occurred_at, ev.id
), enrollment_money AS MATERIALIZED (
    SELECT p.enrollment_id, t.currency,
           SUM(CASE t.kind WHEN 'receipt' THEN t.amount_minor ELSE -t.amount_minor END)::bigint AS net_minor
    FROM bounds c
    JOIN airhop_payment_expectations p ON p.community_id = c.community_id AND p.organization_id = c.organization_id
    JOIN airhop_payment_transactions t ON t.community_id = p.community_id AND t.organization_id = p.organization_id
        AND t.payment_expectation_id = p.id
    WHERE t.occurred_at <= c.generated_at
    GROUP BY p.enrollment_id, t.currency
), booking_outcomes AS MATERIALIZED (
    SELECT b.*, cv.enrollment_id,
           EXISTS (SELECT 1 FROM enrollment_money m WHERE m.enrollment_id::text = cv.enrollment_id AND m.net_minor > 0) AS paying
    FROM bookings b
    LEFT JOIN conversions cv ON cv.booking_id = b.id::text
), attendance AS MATERIALIZED (
    SELECT a.child_id, a.status, o.id AS occurrence_id, o.group_id, o.branch_id,
           o.effective_date, o.ends_at, (o.ends_at >= c.start_at) AS current_period
    FROM bounds c
    JOIN airhop_lesson_occurrences o ON o.community_id = c.community_id AND o.organization_id = c.organization_id
    JOIN airhop_lesson_attendance a ON a.community_id = o.community_id AND a.organization_id = o.organization_id
        AND a.recurrence_rule_id = o.recurrence_rule_id AND a.original_date = o.original_date
    WHERE o.status <> 'cancelled' AND o.ends_at >= c.previous_start_at AND o.ends_at < c.end_at
), students AS MATERIALIZED (
    SELECT e.* FROM bounds c
    JOIN airhop_enrollments e ON e.community_id = c.community_id AND e.organization_id = c.organization_id
), recurring_children AS (
    SELECT child_id, bool_or(current_period) AS current_period, bool_or(NOT current_period) AS previous_period
    FROM attendance WHERE status = 'present' GROUP BY child_id
), upcoming AS MATERIALIZED (
    SELECT o.*, g.name AS group_name, b.name AS branch_name
    FROM bounds c
    JOIN airhop_lesson_occurrences o ON o.community_id = c.community_id AND o.organization_id = c.organization_id
    JOIN airhop_groups g ON g.community_id = o.community_id AND g.organization_id = o.organization_id AND g.id = o.group_id
    JOIN airhop_branches b ON b.community_id = o.community_id AND b.organization_id = o.organization_id AND b.id = o.branch_id
    WHERE o.status <> 'cancelled' AND o.starts_at >= c.generated_at AND o.effective_date <= c.today + 6
), roster AS MATERIALIZED (
    SELECT o.id AS occurrence_id, b.child_id
    FROM upcoming o JOIN airhop_bookings b ON b.community_id = o.community_id AND b.organization_id = o.organization_id
        AND b.recurrence_rule_id = o.recurrence_rule_id AND b.original_date = o.original_date
    WHERE b.status IN ('pending_confirmation', 'confirmed')
    UNION
    SELECT o.id, e.child_id FROM upcoming o
    JOIN students e ON e.community_id = o.community_id AND e.organization_id = o.organization_id AND e.group_id = o.group_id
    WHERE e.status = 'active' AND e.start_date <= o.effective_date AND (e.end_date IS NULL OR e.end_date >= o.effective_date)
      AND (e.assignment_state = 'needs_assignment' OR EXISTS (
          SELECT 1 FROM airhop_enrollment_schedule s WHERE s.community_id = e.community_id AND s.organization_id = e.organization_id
              AND s.enrollment_id = e.id AND s.recurrence_rule_id = o.recurrence_rule_id
              AND s.weekday = (ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])[extract(isodow FROM o.original_date)::int]
      ))
), capacity AS MATERIALIZED (
    SELECT o.*, (SELECT COUNT(*)::int FROM roster r WHERE r.occurrence_id = o.id) AS occupied
    FROM upcoming o
), movement AS MATERIALIZED (
    SELECT t.* FROM bounds c
    JOIN airhop_payment_transactions t ON t.community_id = c.community_id AND t.organization_id = c.organization_id
    WHERE t.occurred_at >= c.start_at AND t.occurred_at < c.end_at
), balances AS MATERIALIZED (
    SELECT p.*, COALESCE(paid.net_minor, 0) AS received,
           greatest(0, p.amount_minor - COALESCE(paid.net_minor, 0)) AS outstanding
    FROM bounds c
    JOIN airhop_payment_expectations p ON p.community_id = c.community_id AND p.organization_id = c.organization_id
    LEFT JOIN LATERAL (
        SELECT SUM(CASE t.kind WHEN 'receipt' THEN t.amount_minor ELSE -t.amount_minor END)::bigint AS net_minor
        FROM airhop_payment_transactions t WHERE t.community_id = p.community_id AND t.organization_id = p.organization_id
            AND t.payment_expectation_id = p.id AND t.occurred_at <= c.generated_at
    ) paid ON TRUE
    WHERE p.status <> 'cancelled'
), source_counts AS MATERIALIZED (
    SELECT acquisition_source AS source, tracking_link_id, link_name,
           COUNT(DISTINCT id) AS bookings,
           COUNT(DISTINCT id) FILTER (WHERE was_confirmed) AS confirmed,
           COUNT(DISTINCT id) FILTER (WHERE attendance_status = 'present' AND ends_at <= (SELECT generated_at FROM bounds) AND lesson_status <> 'cancelled') AS attended,
           COUNT(DISTINCT enrollment_id) AS enrollments,
           COUNT(DISTINCT enrollment_id) FILTER (WHERE paying) AS paying_enrollments
    FROM booking_outcomes GROUP BY acquisition_source, tracking_link_id, link_name
), source_money AS (
    SELECT DISTINCT b.acquisition_source AS source, b.tracking_link_id, b.enrollment_id, m.currency, m.net_minor
    FROM booking_outcomes b JOIN enrollment_money m ON m.enrollment_id::text = b.enrollment_id
), source_amounts AS (
    SELECT source, tracking_link_id, currency, SUM(net_minor)::bigint AS net_minor
    FROM source_money GROUP BY source, tracking_link_id, currency
)
SELECT jsonb_build_object(
    'version', 1, 'generatedAt', c.generated_at, 'timeZone', c.time_zone,
    'periodStart', c.start_date, 'asOfDate', c.end_date, 'today', c.today,
    'isPartial', c.end_date = c.today, 'previousPeriodStart', c.start_date - $2::int,
    'previousPeriodEnd', c.start_date - 1,
    'coverage', jsonb_build_object(
        'firstLessonDate', (SELECT min(effective_date) FROM airhop_lesson_occurrences o WHERE o.community_id = c.community_id AND o.organization_id = c.organization_id),
        'firstAttendanceDate', (SELECT min(o.effective_date) FROM airhop_lesson_attendance a JOIN airhop_lesson_occurrences o ON o.community_id = a.community_id AND o.organization_id = a.organization_id AND o.recurrence_rule_id = a.recurrence_rule_id AND o.original_date = a.original_date WHERE a.community_id = c.community_id AND a.organization_id = c.organization_id),
        'attributedBookings', (SELECT count(*) FROM bookings WHERE attributed),
        'unattributedBookings', (SELECT count(*) FROM bookings WHERE NOT attributed),
        'unmarkedLessons', (SELECT count(*) FROM airhop_lesson_occurrences o WHERE o.community_id = c.community_id AND o.organization_id = c.organization_id AND o.status <> 'cancelled' AND o.track_attendance AND o.ends_at >= c.start_at AND o.ends_at < c.end_at AND NOT EXISTS (SELECT 1 FROM airhop_lesson_attendance a WHERE a.community_id = o.community_id AND a.organization_id = o.organization_id AND a.recurrence_rule_id = o.recurrence_rule_id AND a.original_date = o.original_date))
    ),
    'cohort', (SELECT jsonb_build_object(
        'bookings', count(DISTINCT id), 'trialBookings', count(DISTINCT id) FILTER (WHERE visit_kind = 'trial'),
        'confirmed', count(DISTINCT id) FILTER (WHERE was_confirmed),
        'pending', count(DISTINCT id) FILTER (WHERE status = 'pending_confirmation'),
        'cancelled', count(DISTINCT id) FILTER (WHERE status LIKE 'cancelled%'),
        'attended', count(DISTINCT id) FILTER (WHERE attendance_status = 'present' AND ends_at <= c.generated_at AND lesson_status <> 'cancelled'),
        'enrollments', count(DISTINCT enrollment_id),
        'payingEnrollments', count(DISTINCT enrollment_id) FILTER (WHERE paying)
    ) FROM booking_outcomes),
    'attendance', (SELECT jsonb_build_object(
        'present', count(*) FILTER (WHERE status = 'present'),
        'absent', count(*) FILTER (WHERE status = 'absent'),
        'children', count(DISTINCT child_id) FILTER (WHERE status = 'present'),
        'lessons', count(DISTINCT occurrence_id)
    ) FROM attendance WHERE current_period),
    'students', jsonb_build_object(
        'active', (SELECT count(DISTINCT child_id) FROM students WHERE status = 'active' AND assignment_state = 'configured' AND start_date <= c.today AND (end_date IS NULL OR end_date >= c.today)),
        'paused', (SELECT count(DISTINCT child_id) FROM students WHERE status = 'paused'),
        'newEnrollments', (SELECT count(*) FROM students WHERE created_at >= c.start_at AND created_at < c.end_at),
        'repeatPayingEnrollments', (SELECT count(DISTINCT p.enrollment_id) FROM balances p
            WHERE p.received > 0
              AND EXISTS (SELECT 1 FROM movement t WHERE t.payment_expectation_id = p.id AND t.kind = 'receipt')
              AND EXISTS (SELECT 1 FROM balances earlier WHERE earlier.enrollment_id = p.enrollment_id
                  AND earlier.billing_period < p.billing_period AND earlier.received > 0)),
        'unlinkedEnrollments', (SELECT count(*) FROM students e WHERE created_at >= c.start_at AND created_at < c.end_at AND NOT EXISTS (SELECT 1 FROM conversions cv WHERE cv.enrollment_id = e.id::text)),
        'previousVisitors', (SELECT count(*) FROM recurring_children WHERE previous_period),
        'returnedVisitors', (SELECT count(*) FROM recurring_children WHERE previous_period AND current_period)
    ),
    'days', (SELECT jsonb_agg(jsonb_build_object(
        'date', d::date,
        'bookings', (SELECT count(*) FROM bookings WHERE created_date = d::date),
        'present', (SELECT count(*) FROM attendance WHERE current_period AND status = 'present' AND effective_date = d::date)
    ) ORDER BY d) FROM generate_series(c.start_date::timestamp, c.end_date::timestamp, interval '1 day') d),
    'attendanceGroups', COALESCE((SELECT jsonb_agg(to_jsonb(rows)) FROM (
        SELECT g.id AS "groupId", g.name AS "groupName", b.id AS "branchId", b.name AS "branchName",
               count(*) FILTER (WHERE a.status = 'present') AS present,
               count(*) FILTER (WHERE a.status = 'absent') AS absent,
               count(DISTINCT a.child_id) FILTER (WHERE a.status = 'present') AS children
        FROM attendance a JOIN airhop_groups g ON g.community_id = c.community_id AND g.organization_id = c.organization_id AND g.id = a.group_id
        JOIN airhop_branches b ON b.community_id = c.community_id AND b.organization_id = c.organization_id AND b.id = a.branch_id
        WHERE a.current_period GROUP BY g.id, g.name, b.id, b.name ORDER BY present DESC, g.name, g.id, b.id LIMIT 100
    ) rows), '[]'::jsonb),
    'attendanceGroupsTruncated', (SELECT count(DISTINCT (group_id, branch_id)) > 100 FROM attendance WHERE current_period),
    'capacity', jsonb_build_object(
        'throughDate', c.today + 6, 'lessons', (SELECT count(*) FROM capacity),
        'occupied', (SELECT COALESCE(sum(occupied), 0) FROM capacity WHERE capacity IS NOT NULL),
        'places', (SELECT COALESCE(sum(capacity), 0) FROM capacity),
        'unknownCapacityLessons', (SELECT count(*) FROM capacity WHERE capacity IS NULL),
        'overbookedLessons', (SELECT count(*) FROM capacity WHERE occupied > capacity),
        'itemsTruncated', (SELECT count(*) > 100 FROM capacity),
        'items', COALESCE((SELECT jsonb_agg(to_jsonb(rows)) FROM (
            SELECT recurrence_rule_id AS "recurrenceRuleId", original_date AS "originalDate",
                   effective_date AS date, start_time AS "startTime", group_id AS "groupId", group_name AS "groupName",
                   branch_id AS "branchId", branch_name AS "branchName", capacity, occupied
            FROM capacity ORDER BY starts_at, id LIMIT 100
        ) rows), '[]'::jsonb)
    ),
    'money', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'currency', currency,
        'receiptsMinor', COALESCE((SELECT sum(amount_minor) FROM movement WHERE currency = currencies.currency AND kind = 'receipt'), 0),
        'refundsMinor', COALESCE((SELECT sum(amount_minor) FROM movement WHERE currency = currencies.currency AND kind = 'refund'), 0),
        'outstandingMinor', COALESCE((SELECT sum(outstanding) FROM balances WHERE currency = currencies.currency), 0),
        'overdueMinor', COALESCE((SELECT sum(outstanding) FROM balances WHERE currency = currencies.currency AND due_date < c.today), 0)
    ) ORDER BY currency) FROM (SELECT currency FROM movement UNION SELECT currency FROM balances) currencies), '[]'::jsonb),
    'sourcesTruncated', (SELECT count(*) > 100 FROM source_counts),
    'sources', COALESCE((SELECT jsonb_agg(to_jsonb(rows)) FROM (
        SELECT s.source, s.tracking_link_id AS "trackingLinkId", s.link_name AS "linkName", s.bookings,
               s.confirmed, s.attended, s.enrollments, s.paying_enrollments AS "payingEnrollments",
               COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', m.currency, 'netMinor', m.net_minor) ORDER BY m.currency)
                   FROM source_amounts m WHERE m.source = s.source AND m.tracking_link_id IS NOT DISTINCT FROM s.tracking_link_id), '[]'::jsonb) AS money
        FROM source_counts s ORDER BY s.bookings DESC, s.source, s.tracking_link_id NULLS FIRST LIMIT 100
    ) rows), '[]'::jsonb)
) FROM bounds c
