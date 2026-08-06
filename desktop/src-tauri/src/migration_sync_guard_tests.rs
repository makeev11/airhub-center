use super::*;

// ── is_dev_data_dir_name predicate ──────────────────────────────────────────

#[test]
fn recognizes_airhop_dev_identifiers_only() {
    assert!(!is_dev_data_dir_name("ru.airhop.centers"));
    assert!(is_dev_data_dir_name("ru.airhop.centers.dev"));
    assert!(is_dev_data_dir_name(
        "ru.airhop.centers.dev.some-worktree"
    ));
    assert!(!is_dev_data_dir_name("xyz.block.buzz.app.dev"));
}

/// Prefix-collision guard: an identifier that merely starts with the dev
/// prefix but is not dot-separated must be treated as prod, not dev.
/// `ru.airhop.centers.developer` is a hypothetical prod variant, not a
/// worktree of `ru.airhop.centers.dev`.
#[test]
fn is_dev_data_dir_name_rejects_prefix_collision() {
    assert!(!is_dev_data_dir_name("ru.airhop.centers.developer"));
}

#[test]
fn airhop_imports_buzz_data_without_mutating_the_legacy_source() {
    let root = tempfile::tempdir().unwrap();
    let current = root.path().join("ru.airhop.centers");
    let legacy = root.path().join("xyz.block.buzz.app");
    std::fs::create_dir_all(&legacy).unwrap();
    std::fs::write(legacy.join("identity.key"), "legacy-key").unwrap();

    assert_eq!(
        legacy_app_data_dir(&current).as_deref(),
        Some(legacy.as_path())
    );
    copy_dir_all(&legacy, &current).unwrap();

    assert_eq!(
        std::fs::read_to_string(current.join("identity.key")).unwrap(),
        "legacy-key"
    );
    assert_eq!(
        std::fs::read_to_string(legacy.join("identity.key")).unwrap(),
        "legacy-key"
    );
    assert!(legacy.exists(), "legacy Buzz storage must remain untouched");
}
