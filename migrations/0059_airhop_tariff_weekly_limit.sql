-- Count weekly lesson slots, not distinct weekdays: up to three lessons daily.
ALTER TABLE airhop_tariffs
    DROP CONSTRAINT airhop_tariffs_weekly_schedule_limit_check,
    ADD CONSTRAINT airhop_tariffs_weekly_schedule_limit_check
        CHECK (weekly_schedule_limit BETWEEN 1 AND 21);
