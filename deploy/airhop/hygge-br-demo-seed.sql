\set ON_ERROR_STOP on

-- Isolated, noindex Hygge Brazil demonstration tenant. This fixture is additive:
-- it never updates the existing demo.airhop.ru community or its Russian data.
-- Run only against the registered Center demo target under its shared deploy lock.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM communities
    WHERE lower(host) = 'center.airhop.com.br'
      AND id <> 'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid
  ) THEN
    RAISE EXCEPTION 'center.airhop.com.br is already mapped to another community';
  END IF;
  IF EXISTS (
    SELECT 1 FROM communities
    WHERE id = 'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid
      AND lower(host) <> 'center.airhop.com.br'
  ) THEN
    RAISE EXCEPTION 'the reserved Hygge Brazil community id is already in use';
  END IF;
END $$;

INSERT INTO communities (id, host)
VALUES (
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid,
  'center.airhop.com.br'
)
ON CONFLICT (id) DO UPDATE SET archived_at = NULL;

INSERT INTO relay_members (community_id, pubkey, role, added_by)
VALUES (
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid,
  'a8decaaf6574ab64247ed88ab5100adb268628dac4ca13471b72f056cf929ed1',
  'owner',
  'hygge-br-demo-seed'
)
ON CONFLICT (community_id, pubkey) DO UPDATE SET
  role = 'owner',
  added_by = EXCLUDED.added_by,
  updated_at = now();

INSERT INTO airhop_organizations (
  community_id,
  id,
  name,
  locale,
  time_zone,
  default_trial_policy,
  public_booking_purpose,
  public_booking_appearance,
  currency
)
VALUES (
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid,
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500002'::uuid,
  'Hygge — ateliê demonstrativo',
  'pt-BR',
  'America/Sao_Paulo',
  '{"mode":"free"}'::jsonb,
  'trial',
  'light',
  'BRL'
)
ON CONFLICT (community_id) DO UPDATE SET
  name = EXCLUDED.name,
  locale = EXCLUDED.locale,
  time_zone = EXCLUDED.time_zone,
  default_trial_policy = EXCLUDED.default_trial_policy,
  public_booking_purpose = EXCLUDED.public_booking_purpose,
  public_booking_appearance = EXCLUDED.public_booking_appearance,
  currency = EXCLUDED.currency,
  status = 'active',
  updated_at = now();

INSERT INTO airhop_branches (
  community_id, organization_id, id, name, address
)
VALUES (
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid,
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500002'::uuid,
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500003'::uuid,
  'Hygge',
  'São Paulo, SP · endereço demonstrativo'
)
ON CONFLICT (community_id, id) DO UPDATE SET
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  status = 'active',
  updated_at = now();

INSERT INTO airhop_branch_working_periods (
  community_id, organization_id, branch_id, weekday, ordinal, start_time, end_time
)
SELECT
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid,
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500002'::uuid,
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500003'::uuid,
  weekday,
  0,
  '09:00'::time,
  '19:00'::time
FROM unnest(ARRAY['wednesday', 'thursday', 'saturday']) AS weekdays(weekday)
ON CONFLICT (community_id, organization_id, branch_id, weekday, ordinal)
DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;

INSERT INTO airhop_groups (
  community_id,
  organization_id,
  id,
  branch_id,
  name,
  description,
  min_age_months,
  max_age_months,
  capacity,
  trial_policy_override
)
VALUES
  (
    'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid,
    'b6a10b42-7c2c-4b7f-8e3b-9c4251500002'::uuid,
    'b6a10b42-7c2c-4b7f-8e3b-9c4251500004'::uuid,
    'b6a10b42-7c2c-4b7f-8e3b-9c4251500003'::uuid,
    'Cores e histórias',
    'Desenho para crianças de 3 a 6 anos em um cenário demonstrativo.',
    36,
    83,
    6,
    '{"mode":"free"}'::jsonb
  ),
  (
    'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid,
    'b6a10b42-7c2c-4b7f-8e3b-9c4251500002'::uuid,
    'b6a10b42-7c2c-4b7f-8e3b-9c4251500005'::uuid,
    'b6a10b42-7c2c-4b7f-8e3b-9c4251500003'::uuid,
    'Argila nas mãos',
    'Modelagem para crianças de 3 a 6 anos em um cenário demonstrativo.',
    36,
    83,
    6,
    '{"mode":"free"}'::jsonb
  )
ON CONFLICT (community_id, id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  min_age_months = EXCLUDED.min_age_months,
  max_age_months = EXCLUDED.max_age_months,
  capacity = EXCLUDED.capacity,
  trial_policy_override = EXCLUDED.trial_policy_override,
  status = 'active',
  updated_at = now();

WITH schedule(rule_id, group_id, weekday, start_time, end_time) AS (
  VALUES
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500006'::uuid, 'b6a10b42-7c2c-4b7f-8e3b-9c4251500004'::uuid, 'wednesday', '17:00'::time, '18:00'::time),
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500007'::uuid, 'b6a10b42-7c2c-4b7f-8e3b-9c4251500004'::uuid, 'saturday',  '11:00'::time, '12:00'::time),
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500008'::uuid, 'b6a10b42-7c2c-4b7f-8e3b-9c4251500005'::uuid, 'thursday',  '17:00'::time, '18:00'::time),
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500009'::uuid, 'b6a10b42-7c2c-4b7f-8e3b-9c4251500005'::uuid, 'saturday',  '12:30'::time, '13:30'::time)
)
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
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid,
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500002'::uuid,
  rule_id,
  group_id,
  (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  (now() AT TIME ZONE 'America/Sao_Paulo')::date + 90,
  start_time,
  end_time
FROM schedule
ON CONFLICT (community_id, id) DO UPDATE SET
  starts_on = EXCLUDED.starts_on,
  ends_on = EXCLUDED.ends_on,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  status = 'active',
  updated_at = now();

WITH schedule(rule_id, weekday) AS (
  VALUES
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500006'::uuid, 'wednesday'),
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500007'::uuid, 'saturday'),
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500008'::uuid, 'thursday'),
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500009'::uuid, 'saturday')
)
INSERT INTO airhop_recurrence_weekdays (
  community_id, organization_id, recurrence_rule_id, weekday
)
SELECT
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid,
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500002'::uuid,
  rule_id,
  weekday
FROM schedule
ON CONFLICT DO NOTHING;

WITH schedule(rule_id, group_id, isodow, start_time, end_time) AS (
  VALUES
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500006'::uuid, 'b6a10b42-7c2c-4b7f-8e3b-9c4251500004'::uuid, 3, '17:00'::time, '18:00'::time),
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500007'::uuid, 'b6a10b42-7c2c-4b7f-8e3b-9c4251500004'::uuid, 6, '11:00'::time, '12:00'::time),
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500008'::uuid, 'b6a10b42-7c2c-4b7f-8e3b-9c4251500005'::uuid, 4, '17:00'::time, '18:00'::time),
    ('b6a10b42-7c2c-4b7f-8e3b-9c4251500009'::uuid, 'b6a10b42-7c2c-4b7f-8e3b-9c4251500005'::uuid, 6, '12:30'::time, '13:30'::time)
),
local_dates AS (
  SELECT day::date AS lesson_date
  FROM generate_series(
    (now() AT TIME ZONE 'America/Sao_Paulo')::date + 1,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date + 90,
    interval '1 day'
  ) day
)
INSERT INTO airhop_lesson_occurrences (
  community_id,
  organization_id,
  id,
  recurrence_rule_id,
  original_date,
  group_id,
  branch_id,
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
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid,
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500002'::uuid,
  gen_random_uuid(),
  schedule.rule_id,
  date.lesson_date,
  schedule.group_id,
  'b6a10b42-7c2c-4b7f-8e3b-9c4251500003'::uuid,
  schedule.start_time,
  schedule.end_time,
  date.lesson_date,
  schedule.start_time,
  schedule.end_time,
  (date.lesson_date + schedule.start_time) AT TIME ZONE 'America/Sao_Paulo',
  (date.lesson_date + schedule.end_time) AT TIME ZONE 'America/Sao_Paulo',
  'America/Sao_Paulo',
  6,
  '{"mode":"free"}'::jsonb,
  false,
  true,
  'scheduled',
  1
FROM schedule
CROSS JOIN local_dates date
WHERE extract(isodow FROM date.lesson_date) = schedule.isodow
ON CONFLICT (community_id, organization_id, recurrence_rule_id, original_date)
DO NOTHING;

\if :dry_run
ROLLBACK;
SELECT 'dry-run-rolled-back' AS status;
\else
COMMIT;

SELECT json_build_object(
  'host', community.host,
  'communityId', community.id,
  'organizationId', organization.id,
  'locale', organization.locale,
  'timeZone', organization.time_zone,
  'currency', organization.currency,
  'branches', count(DISTINCT branch.id),
  'groups', count(DISTINCT group_row.id),
  'futureOccurrences', count(DISTINCT occurrence.id) FILTER (WHERE occurrence.starts_at > now())
)
FROM communities community
JOIN airhop_organizations organization ON organization.community_id = community.id
LEFT JOIN airhop_branches branch ON branch.community_id = community.id
LEFT JOIN airhop_groups group_row ON group_row.community_id = community.id
LEFT JOIN airhop_lesson_occurrences occurrence ON occurrence.community_id = community.id
WHERE community.id = 'b6a10b42-7c2c-4b7f-8e3b-9c4251500001'::uuid
GROUP BY community.host, community.id, organization.id, organization.locale,
  organization.time_zone, organization.currency;
\endif
