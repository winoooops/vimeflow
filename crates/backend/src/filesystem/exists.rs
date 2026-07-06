use std::fs;
use std::path::Path;

use super::scope::{ensure_within_home, expand_home, home_canonical, reject_parent_refs};
use super::types::FileExistsRequest;

/// Resolve the nearest existing ancestor of `path` and verify that it lies
/// inside the home sandbox. This prevents `file_exists` from leaking
/// existence information for paths outside the sandbox.
fn validate_ancestor_within_home(path: &Path, home_canonical: &Path) -> Result<(), String> {
    let mut ancestor = path;
    let existing_ancestor = loop {
        if ancestor.exists() {
            break ancestor;
        }
        match ancestor.parent() {
            Some(next) => ancestor = next,
            None => return Ok(()),
        }
    };

    let ancestor_canonical = fs::canonicalize(existing_ancestor)
        .map_err(|e| format!("invalid path '{}': {}", path.display(), e))?;

    ensure_within_home(&ancestor_canonical, home_canonical)
}

/// Check whether a path points to an existing regular file within the home
/// sandbox, without transferring file contents over IPC.
///
/// Symlinks are treated as non-existent so this command stays consistent with
/// `read_file`'s `O_NOFOLLOW` refusal.
pub(crate) fn file_exists_inner(request: FileExistsRequest) -> Result<bool, String> {
    let raw = expand_home(&request.path);
    reject_parent_refs(&raw)?;

    let home_canonical = home_canonical()?;
    validate_ancestor_within_home(&raw, &home_canonical)?;

    match fs::symlink_metadata(&raw) {
        Ok(meta) => Ok(meta.is_file()),
        Err(_) => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;
    use crate::filesystem::scope::home_canonical;

    #[test]
    fn file_exists_returns_true_for_existing_file() {
        let home = home_canonical().expect("home dir");
        let path = home.join("vimeflow-test-exists-file.txt");
        let _ = std::fs::remove_file(&path);
        let mut file = std::fs::File::create(&path).expect("create test file");
        file.write_all(b"hello").expect("write test file");

        let result = file_exists_inner(FileExistsRequest {
            path: path.to_string_lossy().to_string(),
        });

        assert_eq!(result, Ok(true));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn file_exists_returns_false_for_missing_file() {
        let home = home_canonical().expect("home dir");
        let path = home.join("vimeflow-test-exists-missing.txt");
        let _ = std::fs::remove_file(&path);

        let result = file_exists_inner(FileExistsRequest {
            path: path.to_string_lossy().to_string(),
        });

        assert_eq!(result, Ok(false));
    }

    #[test]
    fn file_exists_returns_false_for_directory() {
        let home = home_canonical().expect("home dir");
        let path = home.join("vimeflow-test-exists-dir");
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir(&path).expect("create test dir");

        let result = file_exists_inner(FileExistsRequest {
            path: path.to_string_lossy().to_string(),
        });

        assert_eq!(result, Ok(false));

        let _ = std::fs::remove_dir_all(&path);
    }

    #[test]
    fn file_exists_rejects_parent_traversal() {
        let result = file_exists_inner(FileExistsRequest {
            path: "~/../etc/passwd".to_string(),
        });

        assert!(result.is_err());
    }
}
