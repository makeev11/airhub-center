use super::*;

// ── is_dev_data_dir_name predicate ──────────────────────────────────────────

#[test]
fn recognizes_airhop_dev_identifiers_only() {
    assert!(!is_dev_data_dir_name("ru.airhop.centers.app"));
    assert!(is_dev_data_dir_name("ru.airhop.centers.app.dev"));
    assert!(is_dev_data_dir_name(
        "ru.airhop.centers.app.dev.some-worktree"
    ));
    assert!(!is_dev_data_dir_name("xyz.block.buzz.app.dev"));
}

/// Prefix-collision guard: an identifier that merely starts with the dev
/// prefix but is not dot-separated must be treated as prod, not dev.
/// `ru.airhop.centers.app.developer` is a hypothetical prod variant, not a
/// worktree of `ru.airhop.centers.app.dev`.
#[test]
fn is_dev_data_dir_name_rejects_prefix_collision() {
    assert!(!is_dev_data_dir_name("ru.airhop.centers.app.developer"));
}
