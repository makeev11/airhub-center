use airhop_core::BookingStatus;
use buzz_core::{CommunityId, TenantContext};
use chrono::{TimeZone, Utc};
use serde_json::json;

use super::*;
use crate::DbConfig;

#[test]
fn database_enums_are_validated_before_crossing_the_api_boundary() {
    assert_eq!(
        parse_booking_status("confirmed").unwrap(),
        BookingStatus::Confirmed
    );
    assert!(parse_booking_status("mystery").is_err());
    assert!(validate_value("active", &["active", "archived"], "status").is_ok());
    assert!(validate_value("mystery", &["active", "archived"], "status").is_err());
}

#[test]
fn representative_serialization_exposes_channels_but_not_provider_identity() {
    let representative = StaffFamilyRepresentative {
        id: Uuid::new_v4(),
        display_name: "Мария".to_owned(),
        first_name: Some("Мария".to_owned()),
        last_name: Some("Иванова".to_owned()),
        phone_normalized: "+79990000000".to_owned(),
        phone_display: "+7 999 000-00-00".to_owned(),
        preferred_contact_channel: "telegram".to_owned(),
        verified_messenger_channels: vec!["telegram".to_owned()],
        status: "active".to_owned(),
        version: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    let value = serde_json::to_value(representative).unwrap();
    assert_eq!(value["verifiedMessengerChannels"], json!(["telegram"]));
    assert_eq!(value["firstName"], json!("Мария"));
    assert_eq!(value["lastName"], json!("Иванова"));
    assert!(value.get("externalUserId").is_none());
    assert!(value.get("displayHandle").is_none());
}

#[tokio::test]
#[ignore = "requires a dedicated migrated Postgres database"]
async fn family_detail_is_tenant_scoped_coherent_and_privacy_bounded() {
    let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
        .expect("BUZZ_TEST_DATABASE_URL must point to a dedicated migrated database");
    let db = Db::new(&DbConfig {
        database_url,
        max_connections: 5,
        min_connections: 0,
        ..DbConfig::default()
    })
    .await
    .expect("connect test database");
    db.migrate().await.expect("migrate test database");

    let tenant_a_id = Uuid::new_v4();
    let tenant_b_id = Uuid::new_v4();
    let organization_a = Uuid::new_v4();
    let organization_b = Uuid::new_v4();
    let family_a = insert_family_fixture(&db, tenant_a_id, organization_a, "a", true).await;
    let family_b = insert_family_fixture(&db, tenant_b_id, organization_b, "b", false).await;
    let tenant_a = tenant(tenant_a_id, "family-a.test");
    let tenant_b = tenant(tenant_b_id, "family-b.test");

    let detail = db
        .get_airhop_staff_family_detail(&tenant_a, family_a.family_id)
        .await
        .expect("tenant A family detail");
    assert_eq!(detail.organization.id, organization_a);
    assert_eq!(detail.family.id, family_a.family_id);
    assert_eq!(
        detail.family.primary_representative_id,
        family_a.representative_id
    );
    assert_eq!(detail.representatives.len(), 1);
    assert_eq!(
        detail.representatives[0].first_name.as_deref(),
        Some("Мария")
    );
    assert_eq!(
        detail.representatives[0].last_name.as_deref(),
        Some("Соколова")
    );
    assert_eq!(
        detail.representatives[0].verified_messenger_channels,
        vec!["telegram"]
    );
    assert_eq!(detail.children.len(), 1);
    assert_eq!(detail.children[0].first_name.as_deref(), Some("Лев"));
    assert_eq!(detail.children[0].last_name.as_deref(), Some("Петров"));
    assert_eq!(detail.children[0].note.as_deref(), Some("Любит футбол"));
    assert_eq!(detail.enrollments.len(), 1);
    assert_eq!(detail.enrollments[0].schedule.len(), 1);
    assert_eq!(detail.bookings.len(), 1);
    assert_eq!(
        detail.bookings[0].status,
        BookingStatus::PendingConfirmation
    );
    assert!(detail.has_pending_duplicate);
    assert!(!detail.booking_history_truncated);

    let cross_tenant = db
        .get_airhop_staff_family_detail(&tenant_b, family_a.family_id)
        .await;
    assert!(matches!(cross_tenant, Err(DbError::NotFound(_))));
    let other = db
        .get_airhop_staff_family_detail(&tenant_b, family_b.family_id)
        .await
        .expect("tenant B family detail");
    assert_eq!(other.organization.id, organization_b);
    assert_ne!(other.family.id, family_a.family_id);
}

#[derive(Debug)]
struct FamilyFixture {
    family_id: Uuid,
    representative_id: Uuid,
}

fn tenant(community_id: Uuid, host: &str) -> TenantContext {
    TenantContext::resolved(CommunityId::from_uuid(community_id), host.to_owned())
}

async fn insert_family_fixture(
    db: &Db,
    community_id: Uuid,
    organization_id: Uuid,
    suffix: &str,
    with_operations: bool,
) -> FamilyFixture {
    let family_id = Uuid::new_v4();
    let representative_id = Uuid::new_v4();
    let child_id = Uuid::new_v4();
    let mut transaction = db.pool.begin().await.expect("begin family fixture");
    sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
        .bind(community_id)
        .bind(format!("family-{suffix}-{}.test", Uuid::new_v4()))
        .execute(&mut *transaction)
        .await
        .expect("insert community");
    sqlx::query(
        "INSERT INTO airhop_organizations (\
             community_id, id, name, locale, time_zone, default_trial_policy\
         ) VALUES ($1, $2, $3, 'ru-RU', 'Europe/Moscow', $4)",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(format!("Center {suffix}"))
    .bind(json!({"mode": "free"}))
    .execute(&mut *transaction)
    .await
    .expect("insert organization");
    sqlx::query(
        "INSERT INTO airhop_families (\
             community_id, organization_id, id, display_name, primary_representative_id\
         ) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(family_id)
    .bind(format!("Семья {suffix}"))
    .bind(representative_id)
    .execute(&mut *transaction)
    .await
    .expect("insert family");
    sqlx::query(
        "INSERT INTO airhop_representatives (\
             community_id, organization_id, id, family_id, display_name,\
             first_name, last_name, phone_normalized, phone_display, phone_match_digest,\
             preferred_contact_channel\
         ) VALUES ($1, $2, $3, $4, $5, 'Мария', 'Соколова', $6, $6, $7, 'telegram')",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(representative_id)
    .bind(family_id)
    .bind(format!("Родитель {suffix}"))
    .bind(if suffix == "a" {
        "+79990000001"
    } else {
        "+79990000002"
    })
    .bind(vec![if suffix == "a" { 1_u8 } else { 2_u8 }; 32])
    .execute(&mut *transaction)
    .await
    .expect("insert representative");
    sqlx::query(
        "INSERT INTO airhop_children (\
             community_id, organization_id, id, family_id, display_name, first_name, last_name,\
             birth_date, note\
         ) VALUES ($1, $2, $3, $4, $5, 'Лев', 'Петров', '2020-05-20', $6)",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(child_id)
    .bind(family_id)
    .bind(format!("Ребёнок {suffix}"))
    .bind(with_operations.then_some("Любит футбол"))
    .execute(&mut *transaction)
    .await
    .expect("insert child");

    if with_operations {
        insert_messenger_fixtures(
            &mut transaction,
            community_id,
            organization_id,
            representative_id,
        )
        .await;
        insert_operational_fixtures(
            &mut transaction,
            community_id,
            organization_id,
            family_id,
            representative_id,
            child_id,
        )
        .await;
    }
    transaction.commit().await.expect("commit family fixture");
    FamilyFixture {
        family_id,
        representative_id,
    }
}

async fn insert_messenger_fixtures(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    organization_id: Uuid,
    representative_id: Uuid,
) {
    for (channel, verified, seed) in [("telegram", true, 11_u8), ("whatsapp", false, 12_u8)] {
        sqlx::query(
            "INSERT INTO airhop_messenger_accounts (\
                 community_id, organization_id, representative_id, channel, external_user_id,\
                 external_user_digest, verified_at, verified_by_pubkey\
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(community_id)
        .bind(organization_id)
        .bind(representative_id)
        .bind(channel)
        .bind(format!("provider-{channel}"))
        .bind(vec![seed; 32])
        .bind(verified.then(Utc::now))
        .bind(verified.then_some(vec![seed.saturating_add(20); 32]))
        .execute(&mut **transaction)
        .await
        .expect("insert messenger account");
    }
}

async fn insert_operational_fixtures(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: Uuid,
    organization_id: Uuid,
    family_id: Uuid,
    representative_id: Uuid,
    child_id: Uuid,
) {
    let branch_id = Uuid::new_v4();
    let group_id = Uuid::new_v4();
    let rule_id = Uuid::new_v4();
    let occurrence_id = Uuid::new_v4();
    let tariff_id = Uuid::new_v4();
    let enrollment_id = Uuid::new_v4();
    let consent_id = Uuid::new_v4();
    let command_id = Uuid::new_v4();
    let booking_id = Uuid::new_v4();
    let event_time = Utc
        .with_ymd_and_hms(2026, 8, 16, 8, 0, 0)
        .single()
        .expect("fixture timestamp");
    sqlx::query(
        "INSERT INTO airhop_branches (community_id, organization_id, id, name, address)\
         VALUES ($1, $2, $3, 'Сокол', 'Адрес')",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(branch_id)
    .execute(&mut **transaction)
    .await
    .expect("insert branch");
    sqlx::query(
        "INSERT INTO airhop_groups (community_id, organization_id, id, branch_id, name)\
         VALUES ($1, $2, $3, $4, 'Football 6-7')",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(group_id)
    .bind(branch_id)
    .execute(&mut **transaction)
    .await
    .expect("insert group");
    sqlx::query(
        "INSERT INTO airhop_recurrence_rules (\
             community_id, organization_id, id, group_id, starts_on, ends_on, start_time, end_time\
         ) VALUES ($1, $2, $3, $4, '2026-08-01', '2026-08-31', '10:00', '11:00')",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(rule_id)
    .bind(group_id)
    .execute(&mut **transaction)
    .await
    .expect("insert recurrence rule");
    sqlx::query(
        "INSERT INTO airhop_recurrence_weekdays (\
             community_id, organization_id, recurrence_rule_id, weekday\
         ) VALUES ($1, $2, $3, 'thursday')",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(rule_id)
    .execute(&mut **transaction)
    .await
    .expect("insert recurrence weekday");
    sqlx::query(
        "INSERT INTO airhop_lesson_occurrences (\
             community_id, organization_id, id, recurrence_rule_id, original_date, group_id,\
             branch_id, original_start_time, original_end_time, effective_date, start_time,\
             end_time, starts_at, ends_at, time_zone, trial_policy, allow_single_visits,\
             track_attendance, status, source_rule_version\
         ) VALUES ($1, $2, $3, $4, '2026-08-20', $5, $6, '10:00', '11:00',\
                   '2026-08-20', '10:00', '11:00', '2026-08-20T07:00:00Z',\
                   '2026-08-20T08:00:00Z', 'Europe/Moscow', $7, FALSE, TRUE, 'scheduled', 1)",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(occurrence_id)
    .bind(rule_id)
    .bind(group_id)
    .bind(branch_id)
    .bind(json!({"mode": "free"}))
    .execute(&mut **transaction)
    .await
    .expect("insert occurrence");
    sqlx::query(
        "INSERT INTO airhop_tariffs (\
             community_id, organization_id, id, name, price_minor, currency, weekly_schedule_limit\
         ) VALUES ($1, $2, $3, '8 занятий', 800000, 'RUB', 1)",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(tariff_id)
    .execute(&mut **transaction)
    .await
    .expect("insert tariff");
    sqlx::query(
        "INSERT INTO airhop_enrollments (\
             community_id, organization_id, id, family_id, child_id, group_id, tariff_id,\
             start_date, status, assignment_state, source, created_by\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-08-01', 'active',\
                   'configured', 'staff_ui', 'fixture')",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(enrollment_id)
    .bind(family_id)
    .bind(child_id)
    .bind(group_id)
    .bind(tariff_id)
    .execute(&mut **transaction)
    .await
    .expect("insert enrollment");
    sqlx::query(
        "INSERT INTO airhop_enrollment_schedule (\
             community_id, organization_id, enrollment_id, group_id, recurrence_rule_id, weekday\
         ) VALUES ($1, $2, $3, $4, $5, 'thursday')",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(enrollment_id)
    .bind(group_id)
    .bind(rule_id)
    .execute(&mut **transaction)
    .await
    .expect("insert enrollment schedule");
    sqlx::query(
        "INSERT INTO airhop_consents (\
             community_id, organization_id, id, representative_id, purpose, channel,\
             policy_version, status, effective_at\
         ) VALUES ($1, $2, $3, $4, 'public_booking', 'web', 'v1', 'granted', $5)",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(consent_id)
    .bind(representative_id)
    .bind(event_time)
    .execute(&mut **transaction)
    .await
    .expect("insert consent");
    sqlx::query(
        "INSERT INTO airhop_commands (\
             community_id, organization_id, id, command_type, idempotency_digest, request_hash,\
             actor_kind, correlation_id, status, result, finished_at\
         ) VALUES ($1, $2, $3, 'Fixture', $4, $5, 'public', $6, 'committed',\
                   '{}'::jsonb, $7)",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(command_id)
    .bind(vec![31_u8; 32])
    .bind(vec![32_u8; 32])
    .bind(Uuid::new_v4())
    .bind(event_time)
    .execute(&mut **transaction)
    .await
    .expect("insert command");
    sqlx::query(
        "INSERT INTO airhop_bookings (\
             community_id, organization_id, id, family_id, representative_id, child_id, consent_id,\
             recurrence_rule_id, original_date, command_id, applicant_snapshot, visit_kind, status,\
             management_token_digest, management_key_version, source, actor_kind, created_by\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '2026-08-20', $9, $10, 'trial',\
                   'pending_confirmation', $11, 1, $12, 'public', 'fixture')",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(booking_id)
    .bind(family_id)
    .bind(representative_id)
    .bind(child_id)
    .bind(consent_id)
    .bind(rule_id)
    .bind(command_id)
    .bind(json!({"childName": "Ребёнок a"}))
    .bind(vec![33_u8; 32])
    .bind(json!({"workflow": "request"}))
    .execute(&mut **transaction)
    .await
    .expect("insert booking");
    sqlx::query(
        "INSERT INTO airhop_duplicate_candidates (\
             community_id, organization_id, new_entity_type, new_entity_id,\
             existing_entity_type, existing_entity_id, signals\
         ) VALUES ($1, $2, 'child', $3, 'child', $4, ARRAY['name_and_birth_date'])",
    )
    .bind(community_id)
    .bind(organization_id)
    .bind(child_id)
    .bind(Uuid::new_v4())
    .execute(&mut **transaction)
    .await
    .expect("insert duplicate candidate");
}
