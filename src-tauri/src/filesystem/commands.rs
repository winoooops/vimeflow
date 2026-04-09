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

/// List directory contents (single level, sorted: folders first then files)
#[tauri::command]
pub fn list_dir(request: ListDirRequest) -> Result<Vec<FileEntry>, String> {
    let raw = expand_home(&request.path);
    let canonical = fs::canonicalize(&raw)
        .map_err(|e| format!("invalid path '{}': {}", request.path, e))?;

    if !canonical.is_dir() {
        return Err(format!("not a directory: {}", canonical.display()));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn list_dir_returns_sorted_entries() {
        let dir = std::env::temp_dir().join("vimeflow_test_list_dir");
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
        let dir = std::env::temp_dir().join("vimeflow_test_hidden");
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
}
