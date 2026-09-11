use super::*;
use crate::{airhop::knowledge::ParentKnowledgeScope, DbConfig};
use airhop_core::knowledge::{KnowledgeDraft, KnowledgeQuestion};
use buzz_core::CommunityId;

#[tokio::test]
#[ignore = "requires BUZZ_TEST_DATABASE_URL for an isolated PostgreSQL"]
async fn knowledge_publication_is_atomic_private_versioned_and_retry_safe() {
    let db = Db::new(&DbConfig {
        database_url: std::env::var("BUZZ_TEST_DATABASE_URL").expect("isolated DB URL"),
        min_connections: 0,
        max_connections: 4,
        ..DbConfig::default()
    })
    .await
    .unwrap();
    db.migrate().await.unwrap();
    let actor = [7; 32];
    let mut tenants = Vec::new();
    for _ in 0..2 {
        let community = Uuid::new_v4();
        let tenant = TenantContext::resolved(
            CommunityId::from_uuid(community),
            format!("knowledge-{community}.test"),
        );
        sqlx::query("INSERT INTO communities(id,host) VALUES($1,$2)")
            .bind(community)
            .bind(tenant.host())
            .execute(&db.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO airhop_organizations(community_id,id,name,locale,time_zone,default_trial_policy) VALUES($1,$2,'Knowledge test','ru-RU','Europe/Moscow',$3)").bind(community).bind(Uuid::new_v4()).bind(json!({"mode":"free"})).execute(&db.pool).await.unwrap();
        sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,'owner')")
            .bind(community)
            .bind(hex::encode(actor))
            .execute(&db.pool)
            .await
            .unwrap();
        tenants.push(tenant);
    }
    let tenant = &tenants[0];
    let other = &tenants[1];
    let scope = ParentKnowledgeScope {
        locale: "ru-RU".into(),
        branch_ids: vec![],
        group_ids: vec![],
    };
    let mut draft = KnowledgeDraft {
        title: "Первое посещение".into(),
        topic: "preparation_and_arrival".into(),
        locale: "ru-RU".into(),
        audience: "parent".into(),
        website_allowed: false,
        scope_type: "organization".into(),
        scope_id: None,
        questions: vec![
            KnowledgeQuestion {
                question: "Что взять?".into(),
                answer: "Возьмите сменную обувь.".into(),
            },
            KnowledgeQuestion {
                question: "НЕОТВЕЧЕННЫЙ".into(),
                answer: "".into(),
            },
        ],
        markdown: "".into(),
        source_id: None,
    };
    let id = Uuid::new_v4();
    let save = KnowledgeCommand::Save {
        id,
        expected_version: 0,
        draft: draft.clone(),
    };
    let first = db
        .apply_knowledge_command(tenant, &actor, &[1; 32], &save)
        .await
        .unwrap();
    assert_eq!(first["version"], 1);
    assert_eq!(
        db.apply_knowledge_command(tenant, &actor, &[1; 32], &save)
            .await
            .unwrap(),
        first
    );
    assert!(db
        .search_airhop_parent_knowledge(tenant, &scope, "обувь", 5)
        .await
        .unwrap()
        .is_empty());
    assert!(db.knowledge_manifest(other, None).await.unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(db.knowledge_material(other, id).await.is_err());
    let publish = KnowledgeCommand::Publish {
        id,
        expected_version: 1,
    };
    db.apply_knowledge_command(tenant, &actor, &[2; 32], &publish)
        .await
        .unwrap();
    let catalog = db
        .knowledge_artifact_page(tenant, false, None, None, None)
        .await
        .unwrap();
    assert_eq!(catalog["includesText"], false);
    assert!(catalog["documents"][0].get("markdown").is_none());
    let selected = db
        .knowledge_artifact_page(tenant, false, None, None, Some(id))
        .await
        .unwrap();
    assert!(selected["documents"][0]["markdown"]
        .as_str()
        .unwrap()
        .contains("обувь"));
    let search = db
        .knowledge_artifact_page(tenant, false, Some("обувью"), None, None)
        .await
        .unwrap();
    assert_eq!(search["documents"][0]["id"], id.to_string());
    assert!(db
        .knowledge_artifact_page(other, false, None, None, Some(id))
        .await
        .unwrap()["documents"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(db
        .knowledge_artifact_page(tenant, true, None, None, Some(id))
        .await
        .unwrap()["documents"]
        .as_array()
        .unwrap()
        .is_empty());

    // A prospective parent can select public scope, without Family credentials;
    // a foreign branch/group or a mismatched pair never widens that scope.
    let org = db
        .get_airhop_organization(tenant)
        .await
        .unwrap()
        .unwrap()
        .id;
    let branch = Uuid::new_v4();
    let group = Uuid::new_v4();
    sqlx::query("INSERT INTO airhop_branches(community_id,organization_id,id,name,address) VALUES($1,$2,$3,'Test branch','Test address')")
        .bind(tenant.community().as_uuid()).bind(org).bind(branch).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_groups(community_id,organization_id,id,branch_id,name) VALUES($1,$2,$3,$4,'Test group')")
        .bind(tenant.community().as_uuid()).bind(org).bind(group).bind(branch).execute(&db.pool).await.unwrap();
    assert_eq!(
        db.resolve_parent_knowledge_selection(tenant, None, Some(group))
            .await
            .unwrap(),
        (vec![branch], vec![group])
    );
    assert!(db
        .resolve_parent_knowledge_selection(other, None, Some(group))
        .await
        .is_err());
    assert!(db
        .resolve_parent_knowledge_selection(tenant, Some(Uuid::new_v4()), Some(group))
        .await
        .is_err());
    let found = db
        .search_airhop_parent_knowledge(tenant, &scope, "обувь", 5)
        .await
        .unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].version, 2);
    assert!(!found[0].markdown.contains("НЕОТВЕЧЕННЫЙ"));
    assert!(db
        .search_airhop_parent_knowledge(other, &scope, "обувь", 5)
        .await
        .unwrap()
        .is_empty());
    assert!(db
        .knowledge_artifact_page(tenant, true, None, None, None)
        .await
        .unwrap()["documents"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        db.knowledge_artifact_page(tenant, false, None, None, None)
            .await
            .unwrap()["documents"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // Morphology and default-language fallback retain the real source version.
    assert_eq!(
        db.search_airhop_parent_knowledge(tenant, &scope, "сменная", 5)
            .await
            .unwrap()
            .len(),
        1
    );
    let fallback = ParentKnowledgeScope {
        locale: "en-US".into(),
        ..scope.clone()
    };
    assert_eq!(
        db.search_airhop_parent_knowledge(tenant, &fallback, "обувь", 5)
            .await
            .unwrap()[0]
            .locale,
        "ru-RU"
    );
    draft.questions[0].answer = "Возьмите воду.".into();
    draft.website_allowed = true;
    let edit = KnowledgeCommand::Save {
        id,
        expected_version: 2,
        draft: draft.clone(),
    };
    db.apply_knowledge_command(tenant, &actor, &[3; 32], &edit)
        .await
        .unwrap();
    assert_eq!(
        db.search_airhop_parent_knowledge(tenant, &scope, "обувь", 5)
            .await
            .unwrap()[0]
            .version,
        2
    );
    assert!(matches!(
        db.apply_knowledge_command(tenant, &actor, &[4; 32], &edit)
            .await,
        Err(DbError::AirhopVersionConflict)
    ));
    let publish = KnowledgeCommand::Publish {
        id,
        expected_version: 3,
    };
    db.apply_knowledge_command(tenant, &actor, &[5; 32], &publish)
        .await
        .unwrap();
    assert!(db
        .search_airhop_parent_knowledge(tenant, &scope, "обувь", 5)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        db.knowledge_artifact_page(tenant, true, None, None, None)
            .await
            .unwrap()["documents"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    db.apply_knowledge_command(
        tenant,
        &actor,
        &[6; 32],
        &KnowledgeCommand::Restore {
            id,
            expected_version: 4,
            revision: 1,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        db.search_airhop_parent_knowledge(tenant, &scope, "воду", 5)
            .await
            .unwrap()[0]
            .version,
        4
    );
    db.apply_knowledge_command(
        tenant,
        &actor,
        &[7; 32],
        &KnowledgeCommand::Archive {
            id,
            expected_version: 5,
        },
    )
    .await
    .unwrap();
    assert!(db
        .search_airhop_parent_knowledge(tenant, &scope, "воду", 5)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        db.knowledge_material(tenant, id).await.unwrap()["history"]
            .as_array()
            .unwrap()
            .len(),
        6
    );
    // Staff-only source is never retrievable by parents or the website agent.
    let private = Uuid::new_v4();
    draft.audience = "staff".into();
    draft.website_allowed = false;
    db.apply_knowledge_command(
        tenant,
        &actor,
        &[8; 32],
        &KnowledgeCommand::Save {
            id: private,
            expected_version: 0,
            draft: draft.clone(),
        },
    )
    .await
    .unwrap();
    db.apply_knowledge_command(
        tenant,
        &actor,
        &[9; 32],
        &KnowledgeCommand::Publish {
            id: private,
            expected_version: 1,
        },
    )
    .await
    .unwrap();
    assert!(db
        .search_airhop_parent_knowledge(tenant, &scope, "воду", 5)
        .await
        .unwrap()
        .is_empty());
    assert!(db
        .knowledge_artifact_page(tenant, true, None, None, None)
        .await
        .unwrap()["documents"]
        .as_array()
        .unwrap()
        .is_empty());
    // A foreign attachment cannot be referenced, even by an editor of both tenants.
    let source = db
        .store_knowledge_source(
            other,
            &actor,
            "notes.txt",
            "text/plain",
            &[1; 32],
            b"Original",
        )
        .await
        .unwrap();
    assert!(db.knowledge_source(tenant, source).await.is_err());
    draft.source_id = Some(source);
    assert!(db
        .apply_knowledge_command(
            tenant,
            &actor,
            &[10; 32],
            &KnowledgeCommand::Save {
                id: private,
                expected_version: 2,
                draft
            }
        )
        .await
        .is_err());
    assert_eq!(
        db.knowledge_material(tenant, private).await.unwrap()["version"],
        2
    );
    assert!(matches!(
        db.apply_knowledge_command(
            tenant,
            &[8; 32],
            &[11; 32],
            &KnowledgeCommand::Archive {
                id: private,
                expected_version: 2
            }
        )
        .await,
        Err(DbError::AccessDenied(_))
    ));
    // Competing writers: exactly one succeeds; the other gets an optimistic conflict.
    let a = KnowledgeCommand::Archive {
        id: private,
        expected_version: 2,
    };
    let (a, b) = tokio::join!(
        db.apply_knowledge_command(tenant, &actor, &[12; 32], &a),
        db.apply_knowledge_command(tenant, &actor, &[13; 32], &a)
    );
    assert_ne!(a.is_ok(), b.is_ok());
}
