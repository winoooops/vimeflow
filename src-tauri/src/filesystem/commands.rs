use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

use super::scope::{
    canonicalize_within_home, ensure_within_home, expand_home, home_canonical, open_nofollow,
    reject_parent_refs,
};
use super::types::*;

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

/// Read file contents as UTF-8 string.
/// Restricted to the user's home directory.
///
/// Uses `scope::open_nofollow` to close the TOCTOU window between the
/// canonical scope check and the actual open: without `O_NOFOLLOW` a
/// concurrent unlink+symlink race could swap the validated file for a
/// symlink pointing outside home, and `fs::read_to_string` would happily
/// follow it and leak the contents back to the webview.
#[tauri::command]
pub fn read_file(request: ReadFileRequest) -> Result<String, String> {
    let raw = expand_home(&request.path);
    let canonical =
        fs::canonicalize(&raw).map_err(|e| format!("invalid path '{}': {}", request.path, e))?;

    let home_canonical = home_canonical()?;
    ensure_within_home(&canonical, &home_canonical)?;

    if !canonical.is_file() {
        return Err(format!("not a file: {}", canonical.display()));
    }

    log::info!("Reading file: {}", canonical.display());

    use std::io::Read;
    let mut options = fs::OpenOptions::new();
    options.read(true);

    let mut file = open_nofollow(&canonical, options)?;

    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("failed to read file '{}': {}", canonical.display(), e))?;

    Ok(content)
}

/// Per-process monotonic counter for write_file temp-file names. Ensures
/// concurrent saves to the same target don't collide on `create_new(true)`
/// (which would fail with EEXIST even though both calls are legitimate).
/// See finding #14 in `docs/reviews/patterns/filesystem-scope.md`.
static WRITE_FILE_TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write content to a file.
/// Restricted to the user's home directory. Creates parent directories if needed.
///
/// Scope enforcement happens **before** any filesystem mutation so a
/// malicious path (e.g. `~/../etc/evil.txt`) cannot trigger `create_dir_all`
/// outside of home even when the parent path doesn't exist yet. The final
/// write uses an atomic temp-file + rename pattern so a mid-write failure
/// cannot leave the target at zero length.
#[tauri::command]
pub fn write_file(request: WriteFileRequest) -> Result<(), String> {
    let raw = expand_home(&request.path);

    reject_parent_refs(&raw)?;

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

    let home_canonical = home_canonical()?;
    let resolved_parent = canonicalize_within_home(parent, &home_canonical)?;

    let file_name = raw
        .file_name()
        .ok_or_else(|| format!("invalid path: no file name in '{}'", raw.display()))?;
    let target = resolved_parent.join(file_name);

    // Final-path symlink guard. `fs::write` follows symlinks by default, so
    // even with the parent directory validated, a symlink at the target
    // position (e.g. `~/evil_link -> /etc/passwd`) would let the write
    // escape the home sandbox. Reject any symlink at the target outright —
    // regardless of where it points — to close the TOCTOU window.
    //
    // Using `symlink_metadata` means we don't follow the link; `metadata()`
    // / `exists()` would return info about the link target, not the link.
    match fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "access denied: refusing to write through symlink: {}",
                    target.display()
                ));
            }

            // If the target exists as a regular file, canonicalize it (which
            // resolves any symlinks in its full path — including the parent
            // chain we already validated) and verify it's still inside home.
            // This matches the pattern used by `read_file`.
            let target_canonical = fs::canonicalize(&target).map_err(|e| {
                format!(
                    "failed to canonicalize target '{}': {}",
                    target.display(),
                    e
                )
            })?;
            ensure_within_home(&target_canonical, &home_canonical)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // New file — nothing to follow, parent directory is already
            // validated against the canonical home root.
        }
        Err(e) => {
            return Err(format!(
                "failed to stat target '{}': {}",
                target.display(),
                e
            ));
        }
    }

    log::info!("Writing file: {}", target.display());

    // Atomic write via temp file + rename. See finding #13 in the review
    // knowledge base. `OpenOptions::truncate(true)` would zero the target
    // the moment `open()` returns, before any bytes are written — silent
    // data loss if `write_all` fails. The atomic rename pattern keeps the
    // target untouched until the temp file is fully written and synced.
    use std::io::Write;

    // Per-process atomic counter ensures concurrent saves don't collide on
    // `create_new(true)`. See finding #14.
    let tmp_counter = WRITE_FILE_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(
        ".{}.vimeflow.tmp.{}.{}",
        file_name.to_string_lossy(),
        std::process::id(),
        tmp_counter
    );
    let tmp_path = resolved_parent.join(&tmp_name);

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);

    let write_to_temp = || -> Result<(), String> {
        let mut tmp_file = open_nofollow(&tmp_path, options)?;

        tmp_file
            .write_all(request.content.as_bytes())
            .map_err(|e| format!("failed to write temp file '{}': {}", tmp_path.display(), e))?;

        // `sync_all` before rename so the replacement file is durable on
        // disk even if the machine crashes immediately after rename.
        tmp_file
            .sync_all()
            .map_err(|e| format!("failed to sync temp file '{}': {}", tmp_path.display(), e))?;

        Ok(())
    };

    if let Err(e) = write_to_temp() {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }

    // Atomic rename onto the target. On failure, clean up the temp file
    // so we don't leave droppings in the user's directory.
    if let Err(e) = fs::rename(&tmp_path, &target) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "failed to rename '{}' -> '{}': {}",
            tmp_path.display(),
            target.display(),
            e
        ));
    }

    Ok(())
}
