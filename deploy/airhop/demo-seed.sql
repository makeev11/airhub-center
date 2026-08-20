\set ON_ERROR_STOP on

-- Local/demo-only operational fixture. This populates the real AirHop tables
-- used by Booking Core; the public UI and API remain completely unmocked.
BEGIN;

INSERT INTO airhop_organizations (
    community_id,
    id,
    name,
    locale,
    time_zone,
    default_trial_policy,
    public_booking_purpose,
    public_booking_appearance
)
SELECT
    id,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'AirHop Demo Center',
    'ru-RU',
    'Europe/Moscow',
    '{"mode":"free"}'::jsonb,
    'trial',
    'light'
FROM communities
WHERE lower(host) = lower(:'community_host')
ON CONFLICT (community_id) DO UPDATE SET
    name = EXCLUDED.name,
    locale = EXCLUDED.locale,
    time_zone = EXCLUDED.time_zone,
    default_trial_policy = EXCLUDED.default_trial_policy,
    public_booking_purpose = EXCLUDED.public_booking_purpose,
    public_booking_appearance = EXCLUDED.public_booking_appearance,
    status = 'active',
    updated_at = now();

INSERT INTO airhop_branches (
    community_id, organization_id, id, name, address
)
SELECT
    organization.community_id,
    organization.id,
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'Сокол',
    'Ленинградский проспект, 75'
FROM airhop_organizations organization
JOIN communities community ON community.id = organization.community_id
WHERE lower(community.host) = lower(:'community_host')
ON CONFLICT (community_id, id) DO UPDATE SET
    name = EXCLUDED.name,
    address = EXCLUDED.address,
    status = 'active',
    updated_at = now();

INSERT INTO airhop_branch_working_periods (
    community_id, organization_id, branch_id, weekday, ordinal,
    start_time, end_time
)
SELECT
    branch.community_id,
    branch.organization_id,
    branch.id,
    weekday,
    0,
    '09:00'::time,
    '21:00'::time
FROM airhop_branches branch
JOIN communities community ON community.id = branch.community_id
CROSS JOIN unnest(ARRAY[
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday'
]) AS weekdays(weekday)
WHERE lower(community.host) = lower(:'community_host')
  AND branch.id = 'a1000000-0000-4000-8000-000000000002'::uuid
ON CONFLICT (community_id, organization_id, branch_id, weekday, ordinal)
DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;

INSERT INTO airhop_rooms (
    community_id, organization_id, id, branch_id, name
)
SELECT
    branch.community_id,
    branch.organization_id,
    'a1000000-0000-4000-8000-000000000003'::uuid,
    branch.id,
    'Зал «Облако»'
FROM airhop_branches branch
JOIN communities community ON community.id = branch.community_id
WHERE lower(community.host) = lower(:'community_host')
  AND branch.id = 'a1000000-0000-4000-8000-000000000002'::uuid
ON CONFLICT (community_id, id) DO UPDATE SET
    name = EXCLUDED.name,
    status = 'active',
    updated_at = now();

INSERT INTO airhop_teachers (
    community_id, organization_id, id, display_name
)
SELECT
    organization.community_id,
    organization.id,
    'a1000000-0000-4000-8000-000000000004'::uuid,
    'Анна Смирнова'
FROM airhop_organizations organization
JOIN communities community ON community.id = organization.community_id
WHERE lower(community.host) = lower(:'community_host')
ON CONFLICT (community_id, id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    status = 'active',
    updated_at = now();

INSERT INTO airhop_groups (
    community_id,
    organization_id,
    id,
    branch_id,
    room_id,
    name,
    description,
    min_age_months,
    max_age_months,
    capacity,
    trial_policy_override
)
SELECT
    branch.community_id,
    branch.organization_id,
    'a1000000-0000-4000-8000-000000000005'::uuid,
    branch.id,
    'a1000000-0000-4000-8000-000000000003'::uuid,
    'Воздушная гимнастика 6–10 лет',
    'Пробная группа для проверки полного сценария записи.',
    72,
    120,
    8,
    '{"mode":"free"}'::jsonb
FROM airhop_branches branch
JOIN communities community ON community.id = branch.community_id
WHERE lower(community.host) = lower(:'community_host')
  AND branch.id = 'a1000000-0000-4000-8000-000000000002'::uuid
ON CONFLICT (community_id, id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    min_age_months = EXCLUDED.min_age_months,
    max_age_months = EXCLUDED.max_age_months,
    capacity = EXCLUDED.capacity,
    trial_policy_override = EXCLUDED.trial_policy_override,
    status = 'active',
    updated_at = now();

INSERT INTO airhop_group_teachers (
    community_id, organization_id, group_id, teacher_id
)
SELECT
    group_row.community_id,
    group_row.organization_id,
    group_row.id,
    'a1000000-0000-4000-8000-000000000004'::uuid
FROM airhop_groups group_row
JOIN communities community ON community.id = group_row.community_id
WHERE lower(community.host) = lower(:'community_host')
  AND group_row.id = 'a1000000-0000-4000-8000-000000000005'::uuid
ON CONFLICT DO NOTHING;

INSERT INTO airhop_recurrence_rules (
    community_id,
    organization_id,
    id,
    group_id,
    starts_on,
    ends_on,
    start_time,
    end_time
)
SELECT
    group_row.community_id,
    group_row.organization_id,
    'a1000000-0000-4000-8000-000000000006'::uuid,
    group_row.id,
    current_date,
    current_date + 90,
    '18:00'::time,
    '19:00'::time
FROM airhop_groups group_row
JOIN communities community ON community.id = group_row.community_id
WHERE lower(community.host) = lower(:'community_host')
  AND group_row.id = 'a1000000-0000-4000-8000-000000000005'::uuid
ON CONFLICT (community_id, id) DO UPDATE SET
    starts_on = EXCLUDED.starts_on,
    ends_on = EXCLUDED.ends_on,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    status = 'active',
    updated_at = now();

INSERT INTO airhop_recurrence_weekdays (
    community_id, organization_id, recurrence_rule_id, weekday
)
SELECT
    rule.community_id,
    rule.organization_id,
    rule.id,
    weekday
FROM airhop_recurrence_rules rule
JOIN communities community ON community.id = rule.community_id
CROSS JOIN unnest(ARRAY['tuesday', 'thursday', 'saturday']) AS weekdays(weekday)
WHERE lower(community.host) = lower(:'community_host')
  AND rule.id = 'a1000000-0000-4000-8000-000000000006'::uuid
ON CONFLICT DO NOTHING;

INSERT INTO airhop_recurrence_teachers (
    community_id, organization_id, recurrence_rule_id, teacher_id
)
SELECT
    rule.community_id,
    rule.organization_id,
    rule.id,
    'a1000000-0000-4000-8000-000000000004'::uuid
FROM airhop_recurrence_rules rule
JOIN communities community ON community.id = rule.community_id
WHERE lower(community.host) = lower(:'community_host')
  AND rule.id = 'a1000000-0000-4000-8000-000000000006'::uuid
ON CONFLICT DO NOTHING;

WITH demo_scope AS (
    SELECT
        rule.community_id,
        rule.organization_id,
        rule.id AS recurrence_rule_id,
        rule.group_id,
        group_row.branch_id,
        group_row.room_id,
        organization.time_zone,
        rule.version AS source_rule_version
    FROM airhop_recurrence_rules rule
    JOIN airhop_groups group_row
      ON group_row.community_id = rule.community_id
     AND group_row.organization_id = rule.organization_id
     AND group_row.id = rule.group_id
    JOIN airhop_organizations organization
      ON organization.community_id = rule.community_id
     AND organization.id = rule.organization_id
    JOIN communities community ON community.id = rule.community_id
    WHERE lower(community.host) = lower(:'community_host')
      AND rule.id = 'a1000000-0000-4000-8000-000000000006'::uuid
),
future_dates AS (
    SELECT day::date AS lesson_date
    FROM generate_series(current_date + 1, current_date + 21, interval '1 day') day
    WHERE extract(isodow FROM day) IN (2, 4, 6)
)
INSERT INTO airhop_lesson_occurrences (
    community_id,
    organization_id,
    id,
    recurrence_rule_id,
    original_date,
    group_id,
    branch_id,
    room_id,
    original_start_time,
    original_end_time,
    effective_date,
    start_time,
    end_time,
    starts_at,
    ends_at,
    time_zone,
    capacity,
    trial_policy,
    allow_single_visits,
    track_attendance,
    status,
    source_rule_version
)
SELECT
    scope.community_id,
    scope.organization_id,
    gen_random_uuid(),
    scope.recurrence_rule_id,
    date.lesson_date,
    scope.group_id,
    scope.branch_id,
    scope.room_id,
    '18:00'::time,
    '19:00'::time,
    date.lesson_date,
    '18:00'::time,
    '19:00'::time,
    (date.lesson_date + '18:00'::time) AT TIME ZONE scope.time_zone,
    (date.lesson_date + '19:00'::time) AT TIME ZONE scope.time_zone,
    scope.time_zone,
    8,
    '{"mode":"free"}'::jsonb,
    false,
    true,
    'scheduled',
    scope.source_rule_version
FROM demo_scope scope
CROSS JOIN future_dates date
ON CONFLICT (community_id, organization_id, recurrence_rule_id, original_date)
DO UPDATE SET
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    capacity = EXCLUDED.capacity,
    status = 'scheduled',
    source_rule_version = EXCLUDED.source_rule_version,
    updated_at = now();

INSERT INTO airhop_occurrence_teachers (
    community_id, organization_id, occurrence_id, teacher_id
)
SELECT
    occurrence.community_id,
    occurrence.organization_id,
    occurrence.id,
    'a1000000-0000-4000-8000-000000000004'::uuid
FROM airhop_lesson_occurrences occurrence
JOIN communities community ON community.id = occurrence.community_id
WHERE lower(community.host) = lower(:'community_host')
  AND occurrence.recurrence_rule_id = 'a1000000-0000-4000-8000-000000000006'::uuid
ON CONFLICT DO NOTHING;

COMMIT;

SELECT
    organization.name AS organization,
    count(DISTINCT branch.id) AS branches,
    count(DISTINCT group_row.id) AS groups,
    count(DISTINCT occurrence.id) FILTER (WHERE occurrence.starts_at > now()) AS future_occurrences
FROM airhop_organizations organization
JOIN communities community ON community.id = organization.community_id
LEFT JOIN airhop_branches branch
  ON branch.community_id = organization.community_id
 AND branch.organization_id = organization.id
LEFT JOIN airhop_groups group_row
  ON group_row.community_id = organization.community_id
 AND group_row.organization_id = organization.id
LEFT JOIN airhop_lesson_occurrences occurrence
  ON occurrence.community_id = organization.community_id
 AND occurrence.organization_id = organization.id
WHERE lower(community.host) = lower(:'community_host')
GROUP BY organization.name;
