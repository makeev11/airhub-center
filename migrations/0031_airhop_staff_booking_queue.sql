-- Bounded staff queue reads are tenant-scoped and ordered by booking activity.
-- Only request-workflow rows participate; direct bookings are handled from the
-- lesson roster and must not leak into the operational inbox.

CREATE INDEX airhop_bookings_staff_queue_idx
    ON airhop_bookings
    (community_id, organization_id, updated_at DESC, id DESC)
    WHERE source->>'workflow' = 'request';
