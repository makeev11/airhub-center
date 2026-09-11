-- Enquiries started in the selected local-date window; outcomes observed now.
-- No inferred backfill and no cross-channel metadata disclosure.
WITH context AS MATERIALIZED (
    SELECT community_id,id AS organization_id,time_zone,now() AS generated_at,
      EXISTS(SELECT 1 FROM airhop_welcome_teams team WHERE team.community_id=airhop_organizations.community_id
        AND team.organization_id=airhop_organizations.id AND ($2=team.analyst_pubkey OR $2=team.fizz_pubkey)) AS aggregate_reader,
      ((now() AT TIME ZONE time_zone)::date-$4::int-($3::int-1))::timestamp AT TIME ZONE time_zone AS start_at,
      least(now(),((now() AT TIME ZONE time_zone)::date-$4::int+1)::timestamp AT TIME ZONE time_zone) AS end_at
    FROM airhop_organizations WHERE community_id=$1 AND status='active'
), visible AS MATERIALIZED (
    SELECT v.*,c.aggregate_reader FROM context c
    JOIN airhop_external_conversations v ON v.community_id=c.community_id AND v.organization_id=c.organization_id
    JOIN channels ch ON ch.community_id=v.community_id AND ch.id=v.channel_id AND ch.deleted_at IS NULL
    WHERE c.aggregate_reader OR EXISTS(
      SELECT 1 FROM channel_members m JOIN relay_members staff
        ON staff.community_id=m.community_id AND staff.pubkey=encode(m.pubkey,'hex')
      WHERE m.community_id=v.community_id AND m.channel_id=v.channel_id AND m.pubkey=$2 AND m.removed_at IS NULL AND m.role<>'bot')
), cohort AS MATERIALIZED (
    SELECT s.*,v.aggregate_reader,v.title,v.channel_id,v.root_event_id,v.owner,v.hermes_paused,v.branch_id,
      c.generated_at, b.name AS branch_name, r.connection_id, con.display_name AS connection_name,
      con.provider
    FROM context c JOIN airhop_consultations s ON s.community_id=c.community_id AND s.organization_id=c.organization_id
    JOIN visible v ON v.community_id=s.community_id AND v.organization_id=s.organization_id AND v.id=s.conversation_id
    LEFT JOIN airhop_branches b ON b.community_id=v.community_id AND b.organization_id=v.organization_id AND b.id=v.branch_id
    LEFT JOIN airhop_external_conversation_routes r ON r.community_id=v.community_id AND r.organization_id=v.organization_id AND r.conversation_id=v.id
    LEFT JOIN airhop_channel_connections con ON con.community_id=r.community_id AND con.organization_id=r.organization_id AND con.id=r.connection_id
    WHERE s.started_at>=c.start_at AND s.started_at<c.end_at
), observations AS MATERIALIZED (
    SELECT q.*,o.status AS delivery_status,o.delivered_at,
      EXISTS(SELECT 1 FROM airhop_gateway_inbound_receipts incoming
        WHERE incoming.community_id=s.community_id AND incoming.organization_id=s.organization_id AND incoming.conversation_id=s.conversation_id
        AND incoming.received_at>o.delivered_at AND incoming.received_at<=COALESCE(s.closed_at,s.generated_at)) AS answered
    FROM cohort s JOIN airhop_consultation_questions q ON q.community_id=s.community_id AND q.organization_id=s.organization_id AND q.consultation_id=s.id
    LEFT JOIN airhop_external_message_outbox o ON o.community_id=q.community_id AND o.organization_id=q.organization_id AND o.buzz_event_id=q.event_id
), facts AS MATERIALIZED (
    SELECT s.*,q.question,q.event_id AS question_event_id,q.delivered_at,q.delivery_status,q.answered,
      incoming.received_at AS last_inbound_at, outgoing.created_at AS last_outbound_at,
      outgoing.delivered_at AS last_delivered_at, outgoing.status AS last_delivery_status,
      outgoing.buzz_event_id AS last_outbound_event_id,
      EXISTS(SELECT 1 FROM observations x WHERE x.consultation_id=s.id AND x.question='confirmation' AND x.delivery_status='delivered') AS confirmation_shown
    FROM cohort s
    LEFT JOIN LATERAL (SELECT * FROM observations x WHERE x.consultation_id=s.id ORDER BY x.created_at DESC,x.event_id DESC LIMIT 1) q ON TRUE
    LEFT JOIN LATERAL (SELECT i.received_at FROM airhop_gateway_inbound_receipts i WHERE i.community_id=s.community_id AND i.organization_id=s.organization_id AND i.conversation_id=s.conversation_id AND i.received_at<=COALESCE(s.closed_at,s.generated_at) ORDER BY i.received_at DESC LIMIT 1) incoming ON TRUE
    LEFT JOIN LATERAL (SELECT o.created_at,o.delivered_at,o.status,o.buzz_event_id FROM airhop_external_message_outbox o WHERE o.community_id=s.community_id AND o.organization_id=s.organization_id AND o.conversation_id=s.conversation_id AND o.created_at>=s.started_at AND o.created_at<=COALESCE(s.closed_at,s.generated_at) ORDER BY o.created_at DESC,o.sequence DESC,o.id DESC LIMIT 1) outgoing ON TRUE
), classified AS MATERIALIZED (
    SELECT *, CASE
      WHEN closed_reason IS NOT NULL THEN closed_reason
      WHEN owner='human' OR hermes_paused THEN 'with_staff'
      WHEN last_delivery_status='failed' THEN 'delivery_issue'
      WHEN last_inbound_at IS NOT NULL AND last_inbound_at>COALESCE(last_outbound_at,started_at) THEN 'agent_waiting'
      WHEN question IS NOT NULL AND (last_outbound_event_id=question_event_id OR last_outbound_event_id IS NULL)
        AND COALESCE(delivery_status,'pending') IN ('pending','leased') THEN 'delivery_pending'
      WHEN question IS NOT NULL AND last_outbound_event_id=question_event_id AND delivery_status='delivered' AND NOT answered
        THEN CASE WHEN generated_at-delivered_at>=interval '48 hours' THEN 'quiet' ELSE 'waiting' END
      ELSE 'ongoing' END AS status
    FROM facts
), totals AS (
    SELECT count(*) AS started,
      count(*) FILTER(WHERE status='booked') AS booked,
      count(*) FILTER(WHERE status='quiet') AS quiet,
      count(*) FILTER(WHERE status='waiting') AS waiting,
      count(*) FILTER(WHERE status='agent_waiting') AS agent_waiting,
      count(*) FILTER(WHERE status='with_staff') AS with_staff,
      count(*) FILTER(WHERE status='declined') AS declined,
      count(*) FILTER(WHERE status='cancelled') AS cancelled,
      count(*) FILTER(WHERE status IN ('delivery_issue','delivery_pending')) AS delivery,
      count(*) FILTER(WHERE status='ongoing') AS ongoing
    FROM classified
), stages AS (
    SELECT 1 AS position,'started' AS key,count(*) AS reached FROM classified
    UNION ALL SELECT 2,'group',count(*) FROM classified WHERE group_selected_at IS NOT NULL
    UNION ALL SELECT 3,'time',count(*) FROM classified WHERE time_selected_at IS NOT NULL
    UNION ALL SELECT 4,'details',count(*) FROM classified WHERE details_complete_at IS NOT NULL
    UNION ALL SELECT 5,'confirmation',count(*) FROM classified WHERE confirmation_shown
    UNION ALL SELECT 6,'booked',count(*) FROM classified WHERE closed_reason='booked'
), questions AS (
    SELECT key,
      (SELECT count(DISTINCT consultation_id) FROM observations WHERE question=key AND delivery_status='delivered') AS asked,
      (SELECT count(DISTINCT consultation_id) FROM observations WHERE question=key AND delivery_status='delivered' AND answered) AS answered,
      (SELECT count(*) FROM classified WHERE question=key AND status='waiting') AS waiting,
      (SELECT count(*) FROM classified WHERE question=key AND status='quiet') AS quiet
    FROM unnest(ARRAY['age','branch','activity','time','contact','confirmation','other']) key
), version_facts AS MATERIALIZED (
    SELECT s.*,e.configuration,e.version_count,e.family_linked,e.handed_off,
      s.generated_at>=s.started_at+interval '7 days' AS mature,
      s.closed_reason='booked' AND s.closed_at<=s.started_at+interval '7 days' AS booked_in_window,
      b.status AS booking_status_now
    FROM classified s LEFT JOIN LATERAL (
      SELECT count(DISTINCT configuration) AS version_count,
        (array_agg(configuration ORDER BY recorded_at,turn_id))[1] AS configuration,
        (array_agg(family_linked ORDER BY recorded_at,turn_id))[1] AS family_linked,
        bool_or(handed_off) AS handed_off
      FROM airhop_consultation_exposures e
      WHERE e.community_id=s.community_id AND e.organization_id=s.organization_id AND e.consultation_id=s.id
        AND e.recorded_at<=s.started_at+interval '7 days'
    ) e ON TRUE
    LEFT JOIN airhop_bookings b ON b.community_id=s.community_id AND b.organization_id=s.organization_id AND b.id=s.booking_id
), version_groups AS MATERIALIZED (
    SELECT configuration,min(started_at) AS first_started_at,max(started_at) AS last_started_at,
      count(*) AS started,count(*) FILTER(WHERE mature) AS eligible,
      count(*) FILTER(WHERE mature AND booked_in_window) AS booked,
      count(*) FILTER(WHERE NOT mature) AS pending,
      count(*) FILTER(WHERE mature AND handed_off) AS handed_off,
      count(*) FILTER(WHERE mature AND closed_reason='declined' AND closed_at<=started_at+interval '7 days') AS declined,
      count(*) FILTER(WHERE mature AND closed_reason='cancelled' AND closed_at<=started_at+interval '7 days') AS draft_cancelled,
      count(*) FILTER(WHERE mature AND booked_in_window AND booking_status_now IN ('cancelled_by_parent','cancelled_by_center')) AS booking_cancelled_now,
      count(*) FILTER(WHERE mature AND booked_in_window AND booking_status_now='rejected') AS booking_rejected_now
    FROM version_facts WHERE version_tracking_started AND version_count=1
    GROUP BY configuration
), version_segments AS (
    SELECT configuration,branch_name,provider,family_linked,
      count(*) FILTER(WHERE mature) AS eligible,
      count(*) FILTER(WHERE mature AND booked_in_window) AS booked
    FROM version_facts WHERE version_tracking_started AND version_count=1
    GROUP BY configuration,branch_name,provider,family_linked
), learning AS (
    SELECT jsonb_build_object(
      'windowDays',7,'comparison','observational','metric','booking_created_within_7_days',
      'scope',CASE WHEN (SELECT bool_or(aggregate_reader) FROM context) THEN 'organization_aggregate' ELSE 'accessible_channels' END,
      'eligible',count(*) FILTER(WHERE mature),
      'booked',count(*) FILTER(WHERE mature AND booked_in_window),
      'pending',count(*) FILTER(WHERE NOT mature),
      'mixed',count(*) FILTER(WHERE version_tracking_started AND version_count>1),
      'unattributed',count(*) FILTER(WHERE NOT version_tracking_started OR version_count=0),
      'versionsTruncated',(SELECT count(*)>20 FROM version_groups),
      'versions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'configuration',g.configuration,'firstStartedAt',g.first_started_at,'lastStartedAt',g.last_started_at,
        'started',g.started,'eligible',g.eligible,'booked',g.booked,'pending',g.pending,
        'handedOff',g.handed_off,'declined',g.declined,'draftCancelled',g.draft_cancelled,'bookingCancelledNow',g.booking_cancelled_now,'bookingRejectedNow',g.booking_rejected_now,
        'segments',(SELECT jsonb_agg(jsonb_build_object('branchName',v.branch_name,'provider',v.provider,
          'familyLinked',v.family_linked,'eligible',v.eligible,'booked',v.booked))
          FROM version_segments v WHERE v.configuration=g.configuration)
      ) ORDER BY g.last_started_at DESC,g.configuration::text)
      FROM (SELECT * FROM version_groups ORDER BY last_started_at DESC,configuration::text LIMIT 20) g),'[]'::jsonb)
    ) AS value FROM version_facts
), items AS (
    SELECT * FROM classified WHERE NOT aggregate_reader ORDER BY
      CASE status WHEN 'quiet' THEN 0 WHEN 'delivery_issue' THEN 1 WHEN 'agent_waiting' THEN 2 WHEN 'with_staff' THEN 3 ELSE 4 END,
      COALESCE(delivered_at,started_at),id LIMIT 200
)
SELECT jsonb_build_object(
    'version',1,'generatedAt',now(),'quietHours',48,
    'learning',(SELECT value FROM learning),
    'summary',(SELECT jsonb_build_object('started',started,'booked',booked,'quiet',quiet,'waiting',waiting,'agentWaiting',agent_waiting,'withStaff',with_staff,'declined',declined,'cancelled',cancelled,'delivery',delivery,'ongoing',ongoing) FROM totals),
    'stages',(SELECT jsonb_agg(jsonb_build_object('key',key,'reached',reached) ORDER BY position) FROM stages),
    'questions',(SELECT jsonb_agg(jsonb_build_object('key',key,'asked',asked,'answered',answered,'waiting',waiting,'quiet',quiet)) FROM questions),
    'itemsTruncated',(SELECT count(*)>200 FROM classified WHERE NOT aggregate_reader),
    'untrackedConversations',(SELECT count(DISTINCT t.conversation_id) FROM context c JOIN airhop_hermes_turn_receipts t ON t.community_id=c.community_id AND t.organization_id=c.organization_id JOIN visible v ON v.community_id=t.community_id AND v.id=t.conversation_id WHERE t.started_at>=c.start_at AND t.started_at<c.end_at AND NOT EXISTS(SELECT 1 FROM airhop_consultations s WHERE s.community_id=t.community_id AND s.conversation_id=t.conversation_id)),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'conversationId',conversation_id,'channelId',channel_id,'rootEventId',encode(root_event_id,'hex'),
      'title',title,'branchName',branch_name,'connectionName',connection_name,'provider',provider,
      'startedAt',started_at,'status',status,'question',question,
      'questionEventId',encode(question_event_id,'hex'),'waitingSince',CASE WHEN status IN ('waiting','quiet') THEN delivered_at ELSE NULL END,
      'bookingId',booking_id
    )) FROM items),'[]'::jsonb)
)
