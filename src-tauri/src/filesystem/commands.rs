use std::fs;
use std::path::PathBuf;

use super::types::*;

/// Expand ~ to home directory
fn expand_home(path: &str) -> PathBuf {
    if path == "~" || path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            if path == "~" {
                return home;
            }
            return home.join(&path[2..]);
        }
    }
    PathBuf::from(path)
}

/// List directory contents (single level, sorted: folders first then files).
/// Restricted to the user's home directory to prevent arbitrary filesystem enumeration.
#[tauri::command]
pub fn list_dir(request: ListDirRequest) -> Result<Vec<FileEntry>, String> {
    let raw = expand_home(&request.path);
    let canonical = fs::canonicalize(&raw)
        .map_err(|e| format!("invalid path '{}': {}", request.path, e))?;

    if !canonical.is_dir() {
        return Err(format!("not a directory: {}", canonical.display()));
    }

    // Enforce scope: only allow paths under the user's home directory
    let home = dirs::home_dir().ok_or_else(|| "cannot determine home directory".to_string())?;
    let home_canonical =
        fs::canonicalize(&home).map_err(|e| format!("cannot resolve home dir: {}", e))?;
    if !canonical.starts_with(&home_canonical) {
        return Err(format!(
            "access denied: path is outside home directory: {}",
            canonical.display()
        ));
    }

    log::info!("Listing directory: {}", canonical.display());

    let mut folders: Vec<FileEntry> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();

    let entries = fs::read_dir(&canonical)
        .map_err(|e| format!("failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/folders
        if name.starts_with('.') {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to get file type: {}", e))?;

        if file_type.is_dir() {
            folders.push(FileEntry {
                name,
                entry_type: EntryType::Folder,
                children: None,
            });
        } else if file_type.is_file() {
            files.push(FileEntry {
                name,
                entry_type: EntryType::File,
                children: None,
            });
        }
    }

    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    folders.append(&mut files);

    Ok(folders)
}

/// Read file contents as UTF-8 string.
/// Restricted to the user's home directory.
#[tauri::command]
pub fn read_file(request: ReadFileRequest) -> Result<String, String> {
    let raw = expand_home(&request.path);
    let canonical =
        fs::canonicalize(&raw).map_err(|e| format!("invalid path '{}': {}", request.path, e))?;

    let home = dirs::home_dir().ok_or_else(|| "cannot determine home directory".to_string())?;
    let home_canonical =
        fs::canonicalize(&home).map_err(|e| format!("cannot resolve home dir: {}", e))?;
    if !canonical.starts_with(&home_canonical) {
        return Err(format!(
            "access denied: path is outside home directory: {}",
            canonical.display()
        ));
    }

    if !canonical.is_file() {
        return Err(format!("not a file: {}", canonical.display()));
    }

    log::info!("Reading file: {}", canonical.display());

    fs::read_to_string(&canonical)
        .map_err(|e| format!("failed to read file '{}': {}", canonical.display(), e))
}

/// Write content to a file.
/// Restricted to the user's home directory. Creates parent directories if needed.
///
/// Scope enforcement is done **before** any filesystem mutation so a malicious
/// path (e.g. `~/../etc/evil.txt`) cannot trigger `create_dir_all` outside of
/// home even when the parent path doesn't exist yet.
#[tauri::command]
pub fn write_file(request: WriteFileRequest) -> Result<(), String> {
    let raw = expand_home(&request.path);

    // Reject any `..` segments outright. Legitimate UI paths are built from
    // the current working directory plus a basename, so `..` is always
    // suspicious and blocking it sidesteps the subtle interaction between
    // lexical `Path::parent()` walks and OS-level `..` resolution.
    if raw
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!(
            "access denied: path contains parent traversal segments: {}",
            raw.display()
        ));
    }

    // Require an absolute path once `~` has been expanded. A relative input
    // would otherwise be resolved against the process cwd, which is not
    // necessarily inside home.
    if !raw.is_absolute() {
        return Err(format!(
            "access denied: path must be absolute or ~-relative: {}",
            raw.display()
        ));
    }

    let parent = raw
        .parent()
        .ok_or_else(|| "invalid path: no parent directory".to_string())?;

    let home = dirs::home_dir().ok_or_else(|| "cannot determine home directory".to_string())?;
    let home_canonical =
        fs::canonicalize(&home).map_err(|e| format!("cannot resolve home dir: {}", e))?;

    // Walk up the parent chain until we find an existing ancestor we can
    // canonicalize (resolving symlinks), then confirm the resolved ancestor
    // is still inside home. This rejects escape attempts *before* any
    // directory is created. Because we already rejected `..` components,
    // lexical `Path::parent()` and OS-level resolution agree here.
    let mut ancestor = parent;
    let existing_ancestor = loop {
        if ancestor.exists() {
            break ancestor;
        }
        match ancestor.parent() {
            Some(next) => ancestor = next,
            None => {
                return Err(format!(
                    "access denied: path has no existing ancestor under home: {}",
                    raw.display()
                ));
            }
        }
    };

    let ancestor_canonical = fs::canonicalize(existing_ancestor)
        .map_err(|e| format!("invalid ancestor path '{}': {}", request.path, e))?;

    if !ancestor_canonical.starts_with(&home_canonical) {
        return Err(format!(
            "access denied: path is outside home directory: {}",
            ancestor_canonical.display()
        ));
    }

    // Re-anchor the requested parent onto the canonical ancestor so any
    // remaining unresolved segments are interpreted relative to a trusted,
    // in-home prefix.
    let relative_tail = parent.strip_prefix(existing_ancestor).map_err(|_| {
        format!(
            "invalid path: cannot rebase '{}' onto '{}'",
            parent.display(),
            existing_ancestor.display()
        )
    })?;
    let resolved_parent = ancestor_canonical.join(relative_tail);

    if !resolved_parent.starts_with(&home_canonical) {
        return Err(format!(
            "access denied: path is outside home directory: {}",
            resolved_parent.display()
        ));
    }

    // Safe to create any missing directories now — every segment is known to
    // land inside the home-canonical root.
    if !resolved_parent.exists() {
        fs::create_dir_all(&resolved_parent)
            .map_err(|e| format!("failed to create parent directories: {}", e))?;
    }

    let file_name = raw
        .file_name()
        .ok_or_else(|| format!("invalid path: no file name in '{}'", raw.display()))?;
    let target = resolved_parent.join(file_name);

    log::info!("Writing file: {}", target.display());

    fs::write(&target, &request.content)
        .map_err(|e| format!("failed to write file '{}': {}", target.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a temp dir under $HOME so it passes the home-directory scope check
    fn home_test_dir(name: &str) -> std::path::PathBuf {
        dirs::home_dir()
            .expect("HOME must be set for tests")
            .join(format!(".vimeflow_test_{}", name))
    }

    #[test]
    fn list_dir_returns_sorted_entries() {
        let dir = home_test_dir("list_dir");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir(dir.join("beta")).unwrap();
        fs::create_dir(dir.join("alpha")).unwrap();
        fs::write(dir.join("zebra.txt"), "").unwrap();
        fs::write(dir.join("apple.txt"), "").unwrap();

        let result = list_dir(ListDirRequest {
            path: dir.to_string_lossy().to_string(),
        });

        assert!(result.is_ok());
        let entries = result.unwrap();
        assert_eq!(entries.len(), 4);
        // Folders first, sorted
        assert_eq!(entries[0].name, "alpha");
        assert_eq!(entries[0].entry_type, EntryType::Folder);
        assert_eq!(entries[1].name, "beta");
        assert_eq!(entries[1].entry_type, EntryType::Folder);
        // Files second, sorted
        assert_eq!(entries[2].name, "apple.txt");
        assert_eq!(entries[2].entry_type, EntryType::File);
        assert_eq!(entries[3].name, "zebra.txt");
        assert_eq!(entries[3].entry_type, EntryType::File);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_dir_skips_hidden_files() {
        let dir = home_test_dir("hidden");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(".hidden"), "").unwrap();
        fs::write(dir.join("visible.txt"), "").unwrap();

        let result = list_dir(ListDirRequest {
            path: dir.to_string_lossy().to_string(),
        });

        assert!(result.is_ok());
        let entries = result.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "visible.txt");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_dir_rejects_nonexistent_path() {
        let result = list_dir(ListDirRequest {
            path: "/nonexistent/path/abc123".to_string(),
        });
        assert!(result.is_err());
    }

    #[test]
    fn read_file_returns_content() {
        let dir = home_test_dir("read_file");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("hello.txt"), "hello world").unwrap();

        let result = read_file(ReadFileRequest {
            path: dir.join("hello.txt").to_string_lossy().to_string(),
        });

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "hello world");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_file_rejects_path_outside_home() {
        let result = read_file(ReadFileRequest {
            path: "/etc/passwd".to_string(),
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("access denied"));
    }

    #[test]
    fn read_file_rejects_directory() {
        let dir = home_test_dir("read_file_dir");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let result = read_file(ReadFileRequest {
            path: dir.to_string_lossy().to_string(),
        });

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a file"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_file_creates_file() {
        let dir = home_test_dir("write_file");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let file_path = dir.join("new_file.txt");
        let result = write_file(WriteFileRequest {
            path: file_path.to_string_lossy().to_string(),
            content: "test content".to_string(),
        });

        assert!(result.is_ok());
        assert!(file_path.exists());
        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "test content");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_file_creates_parent_dirs() {
        let dir = home_test_dir("write_file_nested");
        let _ = fs::remove_dir_all(&dir);

        let file_path = dir.join("subdir").join("nested").join("file.txt");
        let result = write_file(WriteFileRequest {
            path: file_path.to_string_lossy().to_string(),
            content: "nested content".to_string(),
        });

        assert!(result.is_ok());
        assert!(file_path.exists());
        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "nested content");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_file_rejects_path_outside_home() {
        let result = write_file(WriteFileRequest {
            path: "/etc/test_forbidden.txt".to_string(),
            content: "forbidden".to_string(),
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("access denied"));
    }

    #[test]
    fn write_file_rejects_traversal_into_sibling_of_home() {
        // A path like `~/../etc/evil.txt` must be rejected WITHOUT creating
        // any directories on disk (the P1 fix) — the previous implementation
        // ran `create_dir_all` before canonicalizing, which could mutate the
        // filesystem outside the home scope.
        let home = dirs::home_dir().expect("HOME must be set for tests");
        let home_parent = home
            .parent()
            .expect("home dir should have a parent in tests");

        // Forge a path that escapes home via `..`
        let evil = home.join("..").join(".vimeflow_traversal_test").join("evil.txt");
        let marker = home_parent.join(".vimeflow_traversal_test");
        let _ = fs::remove_dir_all(&marker);

        let result = write_file(WriteFileRequest {
            path: evil.to_string_lossy().to_string(),
            content: "should be rejected".to_string(),
        });

        assert!(result.is_err(), "traversal path must be rejected");
        assert!(result.unwrap_err().contains("access denied"));

        // Crucial: verify that NO directory was created outside home.
        assert!(
            !marker.exists(),
            "traversal fix must not create directories outside home: {}",
            marker.display()
        );
    }

    #[test]
    fn write_file_overwrites_existing() {
        let dir = home_test_dir("write_file_overwrite");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let file_path = dir.join("overwrite.txt");
        fs::write(&file_path, "original").unwrap();

        let result = write_file(WriteFileRequest {
            path: file_path.to_string_lossy().to_string(),
            content: "updated".to_string(),
        });

        assert!(result.is_ok());
        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "updated");

        let _ = fs::remove_dir_all(&dir);
    }
}
