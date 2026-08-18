ALTER TABLE airhop_enrollments
    ADD COLUMN payment_generation_from DATE;

ALTER TABLE airhop_enrollments
    ADD CONSTRAINT airhop_enrollments_payment_generation_from_valid
    CHECK (payment_generation_from IS NULL OR payment_generation_from >= start_date);

COMMENT ON COLUMN airhop_enrollments.payment_generation_from IS
    'Inclusive local date floor for new payment expectations after an enrollment resumes; NULL preserves the original start-date floor.';
