use super::*;

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn new_family_requires_explicit_given_name_and_surname() {
    for missing in ["first", "last", "both"] {
        let f = Fixture::new().await;
        let reference = lesson(&f).await;
        let event = inbound(&f, "Хочу записаться").await;
        let turn = f.lease(&event).await;
        let mut fields = data(reference);
        // A legacy/full display name must never be heuristically split.
        fields.parent_name = Some("Андрей Макеев".into());
        if missing != "last" {
            fields.parent_first_name = None;
        }
        if missing != "first" {
            fields.parent_last_name = None;
        }
        let draft =
            f.db.save_airhop_booking_draft(&f.tenant, &lease(&f, &turn), 0, fields)
                .await
                .unwrap();
        assert_eq!(draft.state, "collecting", "{missing}");
        assert!(draft.preview.is_none());
        assert_eq!(count(&f, "airhop_families").await, 0);
        assert_eq!(count(&f, "airhop_bookings").await, 0);
        let ready = f
            .db
            .save_airhop_booking_draft(&f.tenant, &lease(&f, &turn), draft.version, data(reference))
            .await
            .unwrap();
        assert_eq!(ready.state, "ready");
        assert!(ready.preview.unwrap().contains("Андрей Макеев"));
    }
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn surname_creates_family_and_structured_parent_without_changing_child() {
    for (first, last) in [("Андрей", "Макеев"), ("Maria Clara", "de Souza-Lima")] {
        let f = Fixture::new().await;
        let reference = lesson(&f).await;
        let event = inbound(&f, "Хочу записаться").await;
        let turn = f.lease(&event).await;
        let mut fields = data(reference);
        fields.parent_first_name = Some(first.into());
        fields.parent_last_name = Some(last.into());
        let draft =
            f.db.save_airhop_booking_draft(&f.tenant, &lease(&f, &turn), 0, fields)
                .await
                .unwrap();
        assert!(draft
            .preview
            .as_ref()
            .unwrap()
            .contains(&format!("{first} {last}")));
        publish(&f, &turn, &draft, true).await;
        let yes = inbound(&f, "Подтверждаю запись").await;
        let confirm = f.lease(&yes).await;
        let input = commit_input(&f, &confirm, draft.version);
        let result =
            f.db.commit_airhop_booking_draft(&f.tenant, &input)
                .await
                .unwrap();
        assert_eq!(result.status, BookingStatus::Confirmed);
        assert!(
            f.db.commit_airhop_booking_draft(&f.tenant, &input)
                .await
                .unwrap()
                .replayed
        );
        let profile: (String, String, Option<String>, Option<String>, String, Option<String>) = sqlx::query_as(
            "SELECT f.display_name,p.display_name,p.first_name,p.last_name,c.display_name,c.last_name FROM airhop_families f JOIN airhop_representatives p ON p.community_id=f.community_id AND p.family_id=f.id JOIN airhop_children c ON c.community_id=f.community_id AND c.family_id=f.id WHERE f.community_id=$1"
        ).bind(f.tenant.community().as_uuid()).fetch_one(&f.db.pool).await.unwrap();
        assert_eq!(
            profile,
            (
                format!("Семья {last}"),
                format!("{first} {last}"),
                Some(first.into()),
                Some(last.into()),
                "Платон".into(),
                None
            )
        );
        assert_eq!(count(&f, "airhop_families").await, 1);
    }
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn changed_surname_requires_new_delivered_summary() {
    let f = Fixture::new().await;
    let reference = lesson(&f).await;
    let (turn, draft) = prepare(&f, reference).await;
    publish(&f, &turn, &draft, true).await;
    let yes = inbound(&f, "Подтверждаю запись").await;
    let confirm = f.lease(&yes).await;
    let mut fields = draft.data.clone();
    fields.parent_last_name = Some("Петров".into());
    let changed =
        f.db.save_airhop_booking_draft(&f.tenant, &lease(&f, &confirm), draft.version, fields)
            .await
            .unwrap();
    assert!(changed.preview.as_ref().unwrap().contains("Андрей Петров"));
    assert!(f
        .db
        .commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &confirm, changed.version))
        .await
        .is_err());
    assert_eq!(count(&f, "airhop_bookings").await, 0);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn pre_upgrade_ready_draft_without_surname_cannot_create_new_family() {
    let f = Fixture::new().await;
    let reference = lesson(&f).await;
    let (turn, draft) = prepare(&f, reference).await;
    sqlx::query("UPDATE airhop_conversation_booking_drafts SET data=data-'parentFirstName'-'parentLastName' WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
    publish(&f, &turn, &draft, true).await;
    let yes = inbound(&f, "Подтверждаю запись").await;
    let confirm = f.lease(&yes).await;
    let error =
        f.db.commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &confirm, draft.version))
            .await
            .unwrap_err();
    assert!(matches!(error, DbError::InvalidData(message) if message.contains("surname")));
    assert_eq!(count(&f, "airhop_families").await, 0);
    assert_eq!(count(&f, "airhop_bookings").await, 0);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn verified_legacy_family_keeps_its_profile_without_requesting_surname_again() {
    let f = Fixture::new().await;
    let reference = lesson(&f).await;
    let (turn, draft) = prepare(&f, reference).await;
    publish(&f, &turn, &draft, true).await;
    let yes = inbound(&f, "Подтверждаю запись").await;
    let confirm = f.lease(&yes).await;
    f.db.commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &confirm, draft.version))
        .await
        .unwrap();
    let mut finished = draft.clone();
    finished.preview = Some("Запись подтверждена".into());
    publish(&f, &confirm, &finished, true).await;
    sqlx::query(
        "UPDATE airhop_representatives SET first_name=NULL,last_name=NULL WHERE community_id=$1",
    )
    .bind(f.tenant.community().as_uuid())
    .execute(&f.db.pool)
    .await
    .unwrap();
    let second = lesson(&f).await;
    let event = inbound(&f, "Хочу ещё одно занятие").await;
    let next = f.lease(&event).await;
    let mut fields = data(second);
    fields.parent_first_name = Some("Чужое".into());
    fields.parent_last_name = Some("Предположение".into());
    let ready =
        f.db.save_airhop_booking_draft(&f.tenant, &lease(&f, &next), draft.version, fields)
            .await
            .unwrap();
    assert_eq!(ready.state, "ready");
    assert_eq!(ready.data.parent_name.as_deref(), Some("Андрей Макеев"));
    assert_eq!(ready.data.parent_first_name, None);
    assert_eq!(ready.data.parent_last_name, None);
    let family: String =
        sqlx::query_scalar("SELECT display_name FROM airhop_families WHERE community_id=$1")
            .bind(f.tenant.community().as_uuid())
            .fetch_one(&f.db.pool)
            .await
            .unwrap();
    assert_eq!(family, "Семья Макеев");
}
