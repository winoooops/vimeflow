use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use super::types::*;

/// Per-process monotonic counter for write_file temp-file names. Ensures
/// concurrent saves to the same target don't collide on `create_new(true)`
/// (which would fail with EEXIST even though both calls are legitimate).
static WRITE_FILE_TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

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
///
/// Uses O_NOFOLLOW (Unix) / FILE_FLAG_OPEN_REPARSE_POINT (Windows) to
/// close the TOCTOU window between the canonical scope check and the
/// actual open, mirroring the hardening applied in `write_file`. Without
/// this a concurrent unlink+symlink race could swap the validated file
/// for a symlink pointing outside home, and `fs::read_to_string` would
/// happily follow it and leak the contents back to the webview.
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

    use std::io::Read;
    let mut options = fs::OpenOptions::new();
    options.read(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // O_NOFOLLOW: refuse to follow a symlink at the final path component.
        options.custom_flags(libc::O_NOFOLLOW);
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_OPEN_REPARSE_POINT: open the reparse point itself
        // rather than following it. Subsequent metadata check rejects
        // if we landed on one.
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x00200000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }

    let mut file = options
        .open(&canonical)
        .map_err(|e| format!("failed to open '{}' for reading: {}", canonical.display(), e))?;

    // On Windows, opening a reparse point with FILE_FLAG_OPEN_REPARSE_POINT
    // gives us a handle to the reparse data itself. Reject before the
    // subsequent read would leak the symlink's metadata back to the webview.
    #[cfg(windows)]
    {
        let metadata = file
            .metadata()
            .map_err(|e| format!("failed to stat '{}': {}", canonical.display(), e))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "access denied: refusing to read through symlink: {}",
                canonical.display()
            ));
        }
    }

    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("failed to read file '{}': {}", canonical.display(), e))?;

    Ok(content)
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
    let lexical_parent = ancestor_canonical.join(relative_tail);

    if !lexical_parent.starts_with(&home_canonical) {
        return Err(format!(
            "access denied: path is outside home directory: {}",
            lexical_parent.display()
        ));
    }

    // Create missing directory segments ONE AT A TIME, canonicalizing
    // after each step. `create_dir_all` in a single shot would leave a
    // TOCTOU window where a concurrent process creates a symlink at an
    // intermediate not-yet-existing component and redirects subsequent
    // segments outside home. Even if the eventual write is blocked by
    // the final scope re-check plus `O_NOFOLLOW`, `create_dir_all`
    // itself would have already created empty directories outside the
    // sandbox along the way.
    //
    // Walking the segments one at a time and canonicalizing after each
    // `create_dir` means the first out-of-scope segment is detected
    // immediately, before any further creations happen — at worst one
    // stray empty dir can be created per call. Full mitigation would
    // need `openat(2)` with `O_NOFOLLOW` per component, but that is a
    // larger refactor; this approach closes the practical window for
    // the single-user desktop threat model.
    let mut resolved_parent = ancestor_canonical.clone();
    for segment in relative_tail.components() {
        let next = resolved_parent.join(segment);
        if !next.exists() {
            // `exists()` + `create_dir` is not atomic: a concurrent
            // process could create the same directory in the gap. The
            // `AlreadyExists` case is benign — the directory we wanted
            // to create is already there — so swallow it and let the
            // subsequent canonicalize + scope check verify the final
            // state is still inside home. Any OTHER error is fatal.
            match fs::create_dir(&next) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => {
                    return Err(format!(
                        "failed to create directory '{}': {}",
                        next.display(),
                        e
                    ));
                }
            }
        }
        let next_canonical = fs::canonicalize(&next).map_err(|e| {
            format!("failed to canonicalize '{}': {}", next.display(), e)
        })?;
        if !next_canonical.starts_with(&home_canonical) {
            return Err(format!(
                "access denied: path segment resolves outside home directory: {}",
                next_canonical.display()
            ));
        }
        resolved_parent = next_canonical;
    }

    // Final check in case the loop didn't run (no tail segments) and
    // the ancestor has somehow ceased to be under home (belt and braces).
    if !resolved_parent.starts_with(&home_canonical) {
        return Err(format!(
            "access denied: parent resolves outside home directory: {}",
            resolved_parent.display()
        ));
    }

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
                format!("failed to canonicalize target '{}': {}", target.display(), e)
            })?;
            if !target_canonical.starts_with(&home_canonical) {
                return Err(format!(
                    "access denied: target resolves outside home directory: {}",
                    target_canonical.display()
                ));
            }
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

    // Atomic write: write to a sibling temp file, then `fs::rename` over
    // the target. `rename(2)` is atomic on POSIX (within the same
    // filesystem) — the target either points at the old bytes or the
    // new bytes, never at a partially-written or zero-length file.
    //
    // Why not write directly to the target? `OpenOptions::truncate(true)`
    // zeroes the target the moment `open()` returns, BEFORE any bytes
    // are written. If `write_all` then fails (disk full, I/O error,
    // signal), the original file content is gone and the new content
    // was never committed — silent data loss. The atomic rename pattern
    // avoids this by keeping the target untouched until the temp file
    // is fully written and synced.
    //
    // The temp file is created with O_NOFOLLOW (Unix) /
    // FILE_FLAG_OPEN_REPARSE_POINT (Windows) and O_EXCL / create_new
    // so a racing symlink at the temp path is refused rather than
    // followed. The subsequent `rename` replaces the target atomically;
    // since we already rejected target symlinks in the pre-check above
    // and `resolved_parent` is a canonical in-home path, `rename` is
    // bounded to the home sandbox.
    use std::io::Write;

    // Name the temp file with `<target>.vimeflow.tmp.<pid>.<counter>`.
    // The per-process atomic counter makes the name unique even if two
    // concurrent write_file IPC calls race to save the same target —
    // without it, both would collide on `create_new(true)` and the
    // second would surface a confusing `File exists` error even though
    // the user's data is safe. (Rapid `:w :w` from vim is a common
    // trigger since the callback fires on every keypress.)
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

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x00200000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }

    let write_to_temp = || -> Result<(), String> {
        let mut tmp_file = options.open(&tmp_path).map_err(|e| {
            format!(
                "failed to open temp file '{}' for writing: {}",
                tmp_path.display(),
                e
            )
        })?;

        // Windows post-open symlink check (Unix is already covered by O_NOFOLLOW).
        #[cfg(windows)]
        {
            let metadata = tmp_file.metadata().map_err(|e| {
                format!("failed to stat temp file '{}': {}", tmp_path.display(), e)
            })?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "access denied: refusing to write through symlink: {}",
                    tmp_path.display()
                ));
            }
        }

        tmp_file
            .write_all(request.content.as_bytes())
            .map_err(|e| {
                format!(
                    "failed to write temp file '{}': {}",
                    tmp_path.display(),
                    e
                )
            })?;

        // `sync_all` before rename so the replacement file is durable on
        // disk even if the machine crashes immediately after rename.
        // Without this a post-crash state could show the rename landed
        // but the contents are zero-length.
        tmp_file.sync_all().map_err(|e| {
            format!("failed to sync temp file '{}': {}", tmp_path.display(), e)
        })?;

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
