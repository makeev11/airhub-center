-- Bounded read-model access paths; no new business facts or mutable counters.
CREATE INDEX airhop_site_analytics_booking_idx
    ON airhop_site_analytics_events (community_id, organization_id, booking_id, occurred_at, event_id)
    WHERE event_type = 'booking_created';
CREATE INDEX airhop_center_conversion_idx
    ON airhop_domain_events (community_id, organization_id, occurred_at, id)
    WHERE event_type = 'airhop.enrollment.created_from_trial.v1';
CREATE INDEX airhop_payment_transactions_period_idx
    ON airhop_payment_transactions (community_id, organization_id, occurred_at, id);
CREATE INDEX airhop_bookings_analytics_period_idx
    ON airhop_bookings (community_id, organization_id, created_at, id);
