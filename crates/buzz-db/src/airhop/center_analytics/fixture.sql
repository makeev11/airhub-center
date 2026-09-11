-- Synthetic operational fixture for an isolated integration-test transaction.
DO $$
DECLARE
    c uuid := current_setting('airhop.test_community')::uuid;
    org uuid; d date; z text;
    branch uuid := gen_random_uuid(); grp uuid := gen_random_uuid(); rule uuid := gen_random_uuid(); cancelled_rule uuid := gen_random_uuid();
    family uuid := gen_random_uuid(); parent uuid := gen_random_uuid(); child_a uuid := gen_random_uuid(); child_b uuid := gen_random_uuid();
    consent uuid := gen_random_uuid(); command uuid := gen_random_uuid(); trial uuid := gen_random_uuid();
    enrollment_a uuid := gen_random_uuid(); enrollment_b uuid := gen_random_uuid(); tariff uuid := gen_random_uuid();
    payment_a uuid := gen_random_uuid(); payment_b uuid := gen_random_uuid(); payment_earlier uuid := gen_random_uuid(); link uuid := gen_random_uuid();
    offset_days int; origin date; effective date; name_of_day text;
BEGIN
    SELECT id,time_zone,(now() AT TIME ZONE time_zone)::date INTO org,z,d FROM airhop_organizations WHERE community_id=c;
    INSERT INTO airhop_branches(community_id,organization_id,id,name,address) VALUES(c,org,branch,'Test branch','Test address');
    INSERT INTO airhop_groups(community_id,organization_id,id,branch_id,name,capacity) VALUES(c,org,grp,branch,'Test group',2);
    INSERT INTO airhop_recurrence_rules(community_id,organization_id,id,group_id,starts_on,ends_on,start_time,end_time)
        VALUES(c,org,rule,grp,d-10,d+10,'10:00','11:00'),(c,org,cancelled_rule,grp,d-10,d+10,'12:00','13:00');
    INSERT INTO airhop_recurrence_weekdays(community_id,organization_id,recurrence_rule_id,weekday)
        SELECT c,org,rule,unnest(ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);
    FOREACH offset_days IN ARRAY ARRAY[-2,-1,1,2,3] LOOP
        origin := d+offset_days; effective := CASE WHEN offset_days=2 THEN origin+1 ELSE origin END;
        INSERT INTO airhop_lesson_occurrences(community_id,organization_id,recurrence_rule_id,original_date,group_id,branch_id,
            original_start_time,original_end_time,effective_date,start_time,end_time,starts_at,ends_at,time_zone,capacity,
            trial_policy,allow_single_visits,track_attendance,status,source_rule_version,source_group_version,source_organization_version)
        VALUES(c,org,rule,origin,grp,branch,'10:00','11:00',effective,'10:00','11:00',
            (effective+time '10:00') AT TIME ZONE z,(effective+time '11:00') AT TIME ZONE z,z,
            CASE WHEN offset_days=2 THEN NULL ELSE 2 END,'{"mode":"free"}',true,true,
            CASE WHEN offset_days=2 THEN 'moved' ELSE 'scheduled' END,1,1,1);
    END LOOP;
    INSERT INTO airhop_lesson_occurrences(community_id,organization_id,recurrence_rule_id,original_date,group_id,branch_id,
        original_start_time,original_end_time,effective_date,start_time,end_time,starts_at,ends_at,time_zone,capacity,
        trial_policy,allow_single_visits,track_attendance,status,source_rule_version,source_group_version,source_organization_version)
    VALUES(c,org,cancelled_rule,d-1,grp,branch,'12:00','13:00',d-1,'12:00','13:00',
        ((d-1)+time '12:00') AT TIME ZONE z,((d-1)+time '13:00') AT TIME ZONE z,z,2,'{"mode":"free"}',true,true,'cancelled',1,1,1);
    INSERT INTO airhop_families(community_id,organization_id,id,display_name,primary_representative_id) VALUES(c,org,family,'Synthetic family',parent);
    INSERT INTO airhop_representatives(community_id,organization_id,id,family_id,display_name,phone_normalized,phone_display,phone_match_digest)
        VALUES(c,org,parent,family,'Synthetic parent','+12025550124','+12025550124',digest(parent::text,'sha256'));
    INSERT INTO airhop_children(community_id,organization_id,id,family_id,display_name,birth_date)
        VALUES(c,org,child_a,family,'Synthetic A',d-2000),(c,org,child_b,family,'Synthetic B',d-2000);
    INSERT INTO airhop_consents(community_id,organization_id,id,representative_id,purpose,channel,policy_version,status,effective_at)
        VALUES(c,org,consent,parent,'public_booking','staff_ui','test','granted',now());
    INSERT INTO airhop_commands(community_id,organization_id,id,command_type,idempotency_digest,request_hash,actor_kind,correlation_id)
        VALUES(c,org,command,'TestAnalytics',digest(command::text,'sha256'),digest(command::text,'sha256'),'system',command);
    INSERT INTO airhop_bookings(community_id,organization_id,id,family_id,representative_id,child_id,consent_id,recurrence_rule_id,
        original_date,command_id,applicant_snapshot,visit_kind,status,management_token_digest,management_key_version,source,actor_kind,created_by,created_at)
    VALUES(c,org,trial,family,parent,child_a,consent,rule,d-1,command,'{}','trial','confirmed',digest(trial::text,'sha256'),1,
        '{"channel":"website","workflow":"request"}','system','test',((d-1)+time '08:00') AT TIME ZONE z),
        (c,org,gen_random_uuid(),family,parent,child_b,consent,rule,d-1,command,'{}','single','cancelled_by_parent',digest('cancelled','sha256'),1,
        '{"channel":"phone","workflow":"request"}','system','test',((d-1)+time '08:00') AT TIME ZONE z),
        (c,org,gen_random_uuid(),family,parent,child_a,consent,rule,d+1,command,'{}','single','confirmed',digest('future-a','sha256'),1,
        '{"channel":"visit","workflow":"direct"}','system','test',((d-1)+time '08:00') AT TIME ZONE z),
        (c,org,gen_random_uuid(),family,parent,child_b,consent,rule,d+1,command,'{}','single','pending_confirmation',digest('future-b','sha256'),1,
        '{"channel":"phone","workflow":"request"}','system','test',now()-interval '1 second');
    INSERT INTO airhop_lesson_attendance(community_id,organization_id,recurrence_rule_id,original_date,child_id,status,marked_by_pubkey)
        VALUES(c,org,rule,d-2,child_a,'present',digest('test','sha256')),
              (c,org,rule,d-1,child_a,'present',digest('test','sha256')),
              (c,org,rule,d-1,child_b,'absent',digest('test','sha256')),
              (c,org,cancelled_rule,d-1,child_a,'present',digest('test','sha256'));
    INSERT INTO airhop_tariffs(community_id,organization_id,id,name,price_minor,currency,weekly_schedule_limit)
        VALUES(c,org,tariff,'Test',1000,'EUR',2);
    INSERT INTO airhop_enrollments(community_id,organization_id,id,family_id,child_id,group_id,tariff_id,start_date,assignment_state,source,created_by,created_at)
        VALUES(c,org,enrollment_a,family,child_a,grp,tariff,d-1,'configured','staff_ui','test',now()-interval '1 second'),
              (c,org,enrollment_b,family,child_b,grp,tariff,d-1,'configured','staff_ui','test',((d-1)+time '09:00') AT TIME ZONE z);
    name_of_day := (ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])[extract(isodow FROM d+1)::int];
    INSERT INTO airhop_enrollment_schedule(community_id,organization_id,enrollment_id,group_id,recurrence_rule_id,weekday)
        VALUES(c,org,enrollment_a,grp,rule,name_of_day);
    -- B selects the original weekday of the moved lesson, not its effective weekday.
    name_of_day := (ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])[extract(isodow FROM d+2)::int];
    INSERT INTO airhop_enrollment_schedule(community_id,organization_id,enrollment_id,group_id,recurrence_rule_id,weekday)
        VALUES(c,org,enrollment_b,grp,rule,name_of_day);
    INSERT INTO airhop_payment_expectations(community_id,organization_id,id,family_id,child_id,enrollment_id,tariff_id,tariff_name_snapshot,amount_minor,currency,due_date,billing_period)
        VALUES(c,org,payment_a,family,child_a,enrollment_a,tariff,'Test',1000,'EUR',d-1,date_trunc('month',d)::date),
              (c,org,payment_b,family,child_b,enrollment_b,tariff,'Test',2000,'RUB',d-1,date_trunc('month',d)::date),
              (c,org,payment_earlier,family,child_b,enrollment_b,tariff,'Test',2000,'RUB',d-35,(date_trunc('month',d)-interval '1 month')::date);
    INSERT INTO airhop_payment_transactions(community_id,organization_id,payment_expectation_id,kind,amount_minor,currency,payment_method,occurred_at,recorded_by)
        VALUES(c,org,payment_a,'receipt',600,'EUR','cash',((d-1)+time '14:00') AT TIME ZONE z,'test'),
              (c,org,payment_a,'refund',200,'EUR','cash',now()-interval '1 second','test'),
              (c,org,payment_b,'receipt',1000,'RUB','cash',((d-1)+time '14:00') AT TIME ZONE z,'test'),
              (c,org,payment_b,'refund',200,'RUB','cash',((d-1)+time '15:00') AT TIME ZONE z,'test'),
              (c,org,payment_earlier,'receipt',2000,'RUB','cash',((d-35)+time '14:00') AT TIME ZONE z,'test');
    INSERT INTO airhop_tracking_links(community_id,organization_id,id,slug,name,source,goal,destination_path)
        VALUES(c,org,link,'test-map-link','Test map','yandex_maps','site','/');
    INSERT INTO airhop_site_analytics_events(community_id,organization_id,event_id,event_type,occurred_at,booking_id,tracking_link_id)
        VALUES(c,org,gen_random_uuid(),'booking_created',((d-1)+time '08:00') AT TIME ZONE z,trial,link);
    -- Repeated audit events must not duplicate a conversion or its money.
    INSERT INTO airhop_domain_events(community_id,organization_id,stream_type,stream_id,stream_version,event_type,occurred_at,actor_kind,causation_id,correlation_id,payload)
        SELECT c,org,'enrollment',enrollment_a,v,'airhop.enrollment.created_from_trial.v1',now()-interval '1 second','system',command,command,
            jsonb_build_object('enrollmentId',enrollment_a,'sourceBookingId',trial) FROM generate_series(1,2) v;
END $$;
