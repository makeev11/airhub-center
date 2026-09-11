ALTER TABLE airhop_organizations
    ADD COLUMN currency TEXT NOT NULL DEFAULT 'RUB'
    CHECK (currency ~ '^[A-Z]{3}$');

-- Preserve a known existing currency; do not infer exchange rates or rewrite money.
UPDATE airhop_organizations organization
SET currency = COALESCE(
    organization.default_trial_policy #>> '{price,currency}',
    (SELECT min(tariff.currency)::text FROM airhop_tariffs tariff
     WHERE tariff.community_id = organization.community_id
       AND tariff.organization_id = organization.id
     HAVING count(DISTINCT tariff.currency) = 1),
    'RUB');
