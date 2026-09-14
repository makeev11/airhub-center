WITH birthday_children AS MATERIALIZED (
    SELECT c.id,c.display_name,c.birth_date FROM airhop_children c
    WHERE c.community_id=$1 AND c.organization_id=$2 AND c.status='active'
      AND EXISTS(SELECT 1 FROM airhop_families f WHERE f.community_id=c.community_id AND f.organization_id=c.organization_id AND f.id=c.family_id AND f.status='active')
      AND ((extract(month FROM c.birth_date)=extract(month FROM $3::date) AND extract(day FROM c.birth_date)=extract(day FROM $3::date))
        OR (extract(month FROM c.birth_date)=2 AND extract(day FROM c.birth_date)=29 AND to_char($3::date,'MM-DD')='02-28'
            AND extract(day FROM ($3::date+1))=1))
), links AS (
    SELECT c.id,e.group_id FROM birthday_children c JOIN airhop_enrollments e ON e.community_id=$1 AND e.organization_id=$2 AND e.child_id=c.id
    WHERE e.status='active' AND e.start_date<=$3 AND (e.end_date IS NULL OR e.end_date>=$3)
    UNION
    SELECT c.id,o.group_id FROM birthday_children c JOIN airhop_bookings b ON b.community_id=$1 AND b.organization_id=$2 AND b.child_id=c.id
    JOIN airhop_lesson_occurrences o ON o.community_id=b.community_id AND o.organization_id=b.organization_id AND o.recurrence_rule_id=b.recurrence_rule_id AND o.original_date=b.original_date
    WHERE b.status IN ('pending_confirmation','confirmed') AND o.status<>'cancelled' AND o.effective_date BETWEEN $3::date-7 AND $3::date+30
)
SELECT DISTINCT c.*,b.default_buzz_channel_id AS channel_id
FROM birthday_children c JOIN links l ON l.id=c.id
JOIN airhop_groups g ON g.community_id=$1 AND g.organization_id=$2 AND g.id=l.group_id AND g.status='active'
JOIN airhop_branches b ON b.community_id=g.community_id AND b.organization_id=g.organization_id AND b.id=g.branch_id AND b.status='active'
ORDER BY c.id,channel_id
