use super::*;
use crate::DbConfig;
use buzz_core::CommunityId;

#[tokio::test]
#[ignore = "requires BUZZ_TEST_DATABASE_URL pointing to an isolated Postgres database"]
async fn site_analytics_real_storage_dedup_cohorts_and_tenant_isolation() {
    let db = Db::new(&DbConfig {
        database_url: std::env::var("BUZZ_TEST_DATABASE_URL").expect("dedicated database URL"),
        min_connections: 0,
        max_connections: 3,
        ..DbConfig::default()
    })
    .await
    .expect("connect");
    db.migrate().await.expect("all production migrations");
    let mut tenants = Vec::new();
    for _ in 0..2 {
        let community = Uuid::new_v4();
        let tenant = TenantContext::resolved(
            CommunityId::from_uuid(community),
            format!("analytics-{community}.test"),
        );
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community)
            .bind(tenant.host())
            .execute(&db.pool)
            .await
            .expect("community");
        sqlx::query("INSERT INTO airhop_organizations (community_id, id, name, locale, time_zone, default_trial_policy) VALUES ($1, $2, 'Analytics test', 'ru-RU', 'Pacific/Kiritimati', $3)")
            .bind(community).bind(Uuid::new_v4()).bind(json!({"mode":"free"})).execute(&db.pool).await.expect("organization");
        tenants.push(tenant);
    }
    let tenant = &tenants[0];
    let empty = db
        .get_airhop_staff_site_analytics(tenant, 7)
        .await
        .expect("empty report");
    assert_eq!(empty.days.len(), 7);
    assert_eq!(empty.totals.visitors, 0);
    assert_eq!(empty.totals.booking_conversion_bps, None);
    assert_eq!(empty.last_event_at, None);
    assert_eq!(empty.time_zone, "Pacific/Kiritimati");
    let journey = Uuid::new_v4();
    let event = RecordSiteAnalyticsEventInput {
        event_id: Uuid::new_v4(),
        event_type: SiteAnalyticsEventType::SitePageView,
        occurred_at: Utc::now() - Duration::seconds(1),
        visitor_digest: Some([1; 32]),
        session_digest: Some([2; 32]),
        journey_id: None,
        tracking_link_id: None,
        branch_id: None,
        path: Some("/".to_owned()),
        referrer_host: Some("yandex.ru".to_owned()),
        source: None,
        campaign: None,
        step: None,
        target: None,
    };
    let opened = RecordSiteAnalyticsEventInput {
        event_id: Uuid::new_v4(),
        event_type: SiteAnalyticsEventType::BookingOpened,
        journey_id: Some(journey),
        ..event.clone()
    };
    let contact = RecordSiteAnalyticsEventInput {
        event_id: Uuid::new_v4(),
        event_type: SiteAnalyticsEventType::ContactClick,
        target: Some(SiteAnalyticsTarget::Phone),
        occurred_at: Utc::now(),
        source: Some("another-source".to_owned()),
        ..event.clone()
    };
    let batch = vec![event.clone(), opened.clone(), contact];
    assert_eq!(
        db.record_airhop_site_analytics_events(tenant, &batch)
            .await
            .expect("insert"),
        3
    );
    assert_eq!(
        db.record_airhop_site_analytics_events(tenant, &batch)
            .await
            .expect("replay"),
        0
    );
    // A step from an unobserved/prior-period journey cannot inflate this cohort.
    db.record_airhop_site_analytics_events(
        tenant,
        &[
            RecordSiteAnalyticsEventInput {
                event_id: Uuid::new_v4(),
                event_type: SiteAnalyticsEventType::BookingSubmit,
                journey_id: Some(Uuid::new_v4()),
                ..event.clone()
            },
            RecordSiteAnalyticsEventInput {
                event_id: Uuid::new_v4(),
                event_type: SiteAnalyticsEventType::BookingSubmit,
                ..opened
            },
        ],
    )
    .await
    .expect("steps");
    let report = db
        .get_airhop_staff_site_analytics(tenant, 7)
        .await
        .expect("report");
    assert_eq!(report.totals.visitors, 1);
    assert_eq!(report.totals.sessions, 1);
    assert_eq!(report.totals.page_views, 1);
    assert_eq!(report.totals.contact_clicks, 1);
    assert_eq!(report.funnel.opened, 1);
    assert_eq!(report.funnel.submitted, 1);
    assert_eq!(report.sources.iter().map(|s| s.sessions).sum::<i64>(), 1);
    assert_eq!(report.sources[0].source, "yandex.ru");
    assert_eq!(report.site_funnel.contact_sessions, 1);
    assert_eq!(report.pages[0].views, 1);
    assert_eq!(report.contacts[0].clicks, 1);
    assert!(report.last_event_at.is_some());
    assert_eq!(
        db.get_airhop_staff_site_analytics(&tenants[1], 7)
            .await
            .expect("other tenant")
            .totals
            .sessions,
        0
    );
    // A batch is transactional even if a later event has an invalid tenant branch.
    let invalid = RecordSiteAnalyticsEventInput {
        event_id: Uuid::new_v4(),
        branch_id: Some(Uuid::new_v4()),
        ..event.clone()
    };
    assert!(db
        .record_airhop_site_analytics_events(
            tenant,
            &[
                RecordSiteAnalyticsEventInput {
                    event_id: Uuid::new_v4(),
                    ..event
                },
                invalid
            ]
        )
        .await
        .is_err());
    assert_eq!(
        db.get_airhop_staff_site_analytics(tenant, 7)
            .await
            .expect("after rollback")
            .totals
            .page_views,
        1
    );

    sqlx::query("INSERT INTO airhop_site_analytics_events (community_id, organization_id, event_id, event_type, occurred_at, visitor_digest, session_digest, path) SELECT $1, o.id, gen_random_uuid(), 'site_page_view', now() - (g * INTERVAL '1 second'), digest((g % 1000)::text, 'sha256'), digest((g % 1000)::text, 'sha256'), '/load-check' FROM airhop_organizations o CROSS JOIN generate_series(1, 50000) g WHERE o.community_id = $1 AND o.status = 'active'")
        .bind(tenant.community().as_uuid()).execute(&db.pool).await.expect("load fixture");
    sqlx::query("ANALYZE airhop_site_analytics_events")
        .execute(&db.pool)
        .await
        .expect("test statistics");
    let started = std::time::Instant::now();
    let large = db
        .get_airhop_staff_site_analytics(tenant, 30)
        .await
        .expect("bounded report at 50k events");
    println!(
        "site analytics report over 50,005 events: {:?}",
        started.elapsed()
    );
    assert_eq!(large.totals.page_views, 50_001);
    assert_eq!(large.totals.sessions, 1001);
}
