use super::*;
use std::fs;
use std::path::PathBuf;

#[test]
fn rejects_parent_refs_basic() {
    // Direct unit test of scope::reject_parent_refs. Covers finding #4
    // (traversal rejected before any filesystem mutation).
    let with_parent = PathBuf::from("/home/user/../etc/evil");
    let result = reject_parent_refs_helper(&with_parent);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("parent traversal"));

    let clean = PathBuf::from("/home/user/docs/file.txt");
    assert!(reject_parent_refs_helper(&clean).is_ok());
}

#[test]
fn canonicalize_within_home_resolves_nested_nonexistent() {
    // Happy path: the parent doesn't exist yet, canonicalize_within_home
    // walks up to find an existing ancestor, canonicalizes it, and
    // re-anchors the tail. The result is a canonical path inside home.
    let dir = home_test_dir("scope_canon_happy");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let nested = dir.join("a").join("b").join("c");
    let home_canon = fs::canonicalize(dirs::home_dir().unwrap()).unwrap();
    let result = canonicalize_within_home_helper(&nested, &home_canon);

    assert!(
        result.is_ok(),
        "happy path should succeed: {:?}",
        result.err()
    );
    let resolved = result.unwrap();
    assert!(resolved.starts_with(&home_canon));
    assert!(resolved.exists(), "segments should have been created");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn canonicalize_within_home_rejects_escape() {
    // If the parent resolves outside home, canonicalize_within_home
    // must reject WITHOUT creating any directories. Covers findings
    // #10 and #11 at the unit level.
    let outside = std::env::temp_dir().join(".vimeflow_scope_escape_unit");
    let _ = fs::remove_dir_all(&outside);

    let home_canon = fs::canonicalize(dirs::home_dir().unwrap()).unwrap();
    let result = canonicalize_within_home_helper(&outside, &home_canon);

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("access denied"));
    assert!(
        !outside.exists(),
        "escape rejection must not create directories: {}",
        outside.display()
    );
}

// Thin wrappers that let this test module call the private scope helpers
// via the tests/mod.rs re-exports.
fn reject_parent_refs_helper(path: &std::path::Path) -> Result<(), String> {
    scope_reject_parent_refs(path)
}

fn canonicalize_within_home_helper(
    parent: &std::path::Path,
    home_canonical: &std::path::Path,
) -> Result<PathBuf, String> {
    scope_canonicalize_within_home(parent, home_canonical)
}
