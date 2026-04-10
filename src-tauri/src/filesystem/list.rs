use std::fs;

use super::scope::{ensure_within_home, expand_home, home_canonical};
use super::types::{EntryType, FileEntry, ListDirRequest};

/// List directory contents (single level, sorted: folders first then files).
/// Restricted to the user's home directory to prevent arbitrary filesystem enumeration.
#[tauri::command]
pub fn list_dir(request: ListDirRequest) -> Result<Vec<FileEntry>, String> {
    let raw = expand_home(&request.path);
    let canonical =
        fs::canonicalize(&raw).map_err(|e| format!("invalid path '{}': {}", request.path, e))?;

    if !canonical.is_dir() {
        return Err(format!("not a directory: {}", canonical.display()));
    }

    let home_canonical = home_canonical()?;
    ensure_within_home(&canonical, &home_canonical)?;

    log::info!("Listing directory: {}", canonical.display());

    let mut folders: Vec<FileEntry> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();

    let entries =
        fs::read_dir(&canonical).map_err(|e| format!("failed to read directory: {}", e))?;

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
