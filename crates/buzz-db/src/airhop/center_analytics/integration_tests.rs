use super::*;
use crate::DbConfig;
use buzz_core::CommunityId;
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires isolated BUZZ_TEST_DATABASE_URL"]
async fn center_analytics_snapshot_bounds_and_tenancy() {
    let db = Db::new(&DbConfig {
        database_url: std::env::var("BUZZ_TEST_DATABASE_URL").expect("isolated test database"),
        min_connections: 0,
        max_connections: 3,
        ..DbConfig::default()
    })
    .await
    .expect("database");
    db.migrate().await.expect("migrations");
    let id = Uuid::new_v4();
    let tenant = TenantContext::resolved(CommunityId::from_uuid(id), format!("center-{id}.test"));
    sqlx::query("INSERT INTO communities(id,host) VALUES ($1,$2)")
        .bind(id)
        .bind(tenant.host())
        .execute(&db.pool)
        .await
        .expect("community");
    sqlx::query("INSERT INTO airhop_organizations(community_id,id,name,locale,time_zone,default_trial_policy) VALUES ($1,$2,'Analytics','ru-RU','Pacific/Kiritimati',$3)")
        .bind(id).bind(Uuid::new_v4()).bind(json!({"mode":"free"})).execute(&db.pool).await.expect("organization");
    let today = db
        .get_airhop_staff_center_analytics(&tenant, 1, false)
        .await
        .expect("today");
    let yesterday = db
        .get_airhop_staff_center_analytics(&tenant, 1, true)
        .await
        .expect("yesterday");
    assert_eq!(today["isPartial"], true);
    assert_eq!(yesterday["isPartial"], false);
    assert_eq!(yesterday["days"].as_array().unwrap().len(), 1);
    assert_eq!(yesterday["asOfDate"], today["previousPeriodEnd"]);
    assert_eq!(today["cohort"]["bookings"], 0);
    assert_eq!(today["capacity"]["places"], 0);
    assert_eq!(today["coverage"]["firstAttendanceDate"], Value::Null);
    assert_eq!(today["money"], json!([]));
    assert!(db
        .get_airhop_staff_center_analytics(&tenant, 0, false)
        .await
        .is_err());
    assert!(db
        .get_airhop_staff_center_analytics(&tenant, 367, false)
        .await
        .is_err());
    let missing = TenantContext::resolved(CommunityId::from_uuid(Uuid::new_v4()), "missing.test");
    assert!(db
        .get_airhop_staff_center_analytics(&missing, 30, false)
        .await
        .is_err());

    let mut fixture = db.pool.begin().await.expect("fixture transaction");
    sqlx::query("SELECT set_config('airhop.test_community', $1, true)")
        .bind(id.to_string())
        .execute(&mut *fixture)
        .await
        .expect("fixture context");
    sqlx::raw_sql(include_str!("fixture.sql"))
        .execute(&mut *fixture)
        .await
        .expect("operational fixture");
    fixture.commit().await.expect("fixture commit");
    let report = db
        .get_airhop_staff_center_analytics(&tenant, 1, true)
        .await
        .expect("populated report");
    assert_eq!(report["cohort"]["bookings"], 3);
    assert_eq!(report["cohort"]["confirmed"], 2);
    assert_eq!(report["cohort"]["cancelled"], 1);
    assert_eq!(report["cohort"]["attended"], 1);
    assert_eq!(report["cohort"]["enrollments"], 1);
    assert_eq!(report["cohort"]["payingEnrollments"], 1);
    assert_eq!(report["attendance"]["present"], 1);
    assert_eq!(report["attendance"]["absent"], 1);
    assert_eq!(report["students"]["active"], 2);
    assert_eq!(report["students"]["previousVisitors"], 1);
    assert_eq!(report["students"]["returnedVisitors"], 1);
    assert_eq!(report["students"]["newEnrollments"], 1);
    assert_eq!(report["students"]["repeatPayingEnrollments"], 1);
    assert_eq!(report["students"]["unlinkedEnrollments"], 1);
    assert_eq!(report["coverage"]["attributedBookings"], 1);
    assert_eq!(report["coverage"]["unattributedBookings"], 2);
    assert_eq!(report["capacity"]["lessons"], 3);
    assert_eq!(report["capacity"]["occupied"], 2); // booking + enrollment dedup
    assert_eq!(report["capacity"]["places"], 4);
    assert_eq!(report["capacity"]["unknownCapacityLessons"], 1);
    let moved = report["capacity"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["capacity"].is_null())
        .unwrap();
    assert_eq!(moved["occupied"], 1); // moved lesson original weekday
    let euro = report["money"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["currency"] == "EUR")
        .unwrap();
    assert_eq!(euro["receiptsMinor"], 600);
    assert_eq!(euro["refundsMinor"], 0); // today's refund excluded from yesterday cash
    assert_eq!(euro["outstandingMinor"], 600); // balance is current, including today's refund
    let origin = report["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["source"] == "yandex_maps")
        .unwrap();
    assert_eq!(origin["enrollments"], 1);
    assert_eq!(origin["money"][0]["netMinor"], 400);
    let own_today = db
        .get_airhop_staff_center_analytics(&tenant, 1, false)
        .await
        .expect("today facts");
    assert_eq!(own_today["cohort"]["bookings"], 1);
    assert_eq!(own_today["attendance"]["present"], 0);
    let site_yesterday = db
        .get_airhop_staff_site_analytics_ending(&tenant, 1, true)
        .await
        .expect("site yesterday");
    assert_eq!(
        site_yesterday.as_of_date.to_string(),
        report["asOfDate"].as_str().unwrap()
    );
    assert_eq!(site_yesterday.totals.bookings_created, 1);

    // Unrelated telemetry must not multiply operational counts or source money.
    sqlx::query("INSERT INTO airhop_site_analytics_events(community_id,organization_id,event_id,event_type,occurred_at,path) SELECT o.community_id,o.id,gen_random_uuid(),'site_page_view',now(),'/synthetic-scale' FROM airhop_organizations o CROSS JOIN generate_series(1,10000) WHERE o.community_id=$1")
        .bind(id).execute(&db.pool).await.expect("synthetic telemetry volume");

    // A second fully populated tenant must not change this tenant's facts.
    let second_id = Uuid::new_v4();
    sqlx::query("INSERT INTO communities(id,host) VALUES ($1,$2)")
        .bind(second_id)
        .bind(format!("other-{second_id}.test"))
        .execute(&db.pool)
        .await
        .expect("second community");
    sqlx::query("INSERT INTO airhop_organizations(community_id,id,name,locale,time_zone,default_trial_policy) VALUES ($1,$2,'Other','ru-RU','Pacific/Kiritimati',$3)")
        .bind(second_id).bind(Uuid::new_v4()).bind(json!({"mode":"free"}))
        .execute(&db.pool).await.expect("second organization");
    let mut second_fixture = db.pool.begin().await.expect("second fixture");
    sqlx::query("SELECT set_config('airhop.test_community', $1, true)")
        .bind(second_id.to_string())
        .execute(&mut *second_fixture)
        .await
        .expect("second context");
    sqlx::raw_sql(include_str!("fixture.sql"))
        .execute(&mut *second_fixture)
        .await
        .expect("second data");
    second_fixture
        .commit()
        .await
        .expect("second fixture commit");
    let started = std::time::Instant::now();
    let isolated = db
        .get_airhop_staff_center_analytics(&tenant, 1, true)
        .await
        .expect("isolated report");
    eprintln!(
        "Center report with 10,000 unrelated page events: {:?}",
        started.elapsed()
    );
    for key in [
        "cohort",
        "attendance",
        "students",
        "coverage",
        "capacity",
        "money",
        "sources",
        "days",
    ] {
        assert_eq!(isolated[key], report[key], "tenant isolation for {key}");
    }
}
