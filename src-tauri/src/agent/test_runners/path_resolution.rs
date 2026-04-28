//! Resolve a runner-emitted relative label to an absolute, contained path.

use std::path::Path;

/// Returns Some(absolute_path_string) when:
///   - label has no `..` segments
///   - label is not absolute
///   - the canonical resolved path is inside the canonical CWD
/// Returns None otherwise — the row will render non-clickable.
pub fn resolve_group_path(cwd: &Path, label: &str) -> Option<String> {
    if label.contains("..") || Path::new(label).is_absolute() {
        return None;
    }
    let candidate = cwd.join(label).canonicalize().ok()?;
    let cwd_canonical = cwd.canonicalize().ok()?;
    if !candidate.starts_with(&cwd_canonical) {
        return None;
    }
    Some(candidate.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn rejects_dotdot_escape() {
        let dir = tempdir().unwrap();
        assert_eq!(resolve_group_path(dir.path(), "../etc/passwd"), None);
    }

    #[test]
    fn rejects_absolute_label() {
        let dir = tempdir().unwrap();
        assert_eq!(resolve_group_path(dir.path(), "/etc/passwd"), None);
    }

    #[test]
    fn resolves_valid_relative_path() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("foo.test.ts");
        fs::write(&file, "").unwrap();
        let resolved = resolve_group_path(dir.path(), "foo.test.ts");
        assert!(resolved.is_some());
        assert!(resolved.unwrap().contains("foo.test.ts"));
    }

    #[test]
    fn returns_none_for_missing_file() {
        let dir = tempdir().unwrap();
        // canonicalize fails for non-existent paths
        assert_eq!(resolve_group_path(dir.path(), "missing.test.ts"), None);
    }

    #[test]
    fn rejects_symlink_pointing_outside_cwd() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let outer = tempdir().unwrap();
            let inner = tempdir().unwrap();
            let target = outer.path().join("secret.test.ts");
            fs::write(&target, "").unwrap();
            symlink(&target, inner.path().join("link.test.ts")).unwrap();
            // The symlink resolves outside the inner CWD → reject.
            assert_eq!(resolve_group_path(inner.path(), "link.test.ts"), None);
        }
    }
}
