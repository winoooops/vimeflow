use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

use super::scope::{
    canonicalize_within_home, ensure_within_home, expand_home, home_canonical, open_nofollow,
    reject_parent_refs,
};
use super::types::WriteFileRequest;
#[cfg(not(test))]
use crate::runtime::BackendState;

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
#[cfg(not(test))]
#[tauri::command]
pub fn write_file(
    state: tauri::State<'_, std::sync::Arc<BackendState>>,
    request: WriteFileRequest,
) -> Result<(), String> {
    state.write_file(request)
}

#[cfg(test)]
pub fn write_file(request: WriteFileRequest) -> Result<(), String> {
    write_file_inner(request)
}

pub(crate) fn write_file_inner(request: WriteFileRequest) -> Result<(), String> {
    let raw = expand_home(&request.path);

    reject_parent_refs(&raw)?;

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

    // Final-path symlink guard. See findings #5 and #7 in the review
    // knowledge base.
    match fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "access denied: refusing to write through symlink: {}",
                    target.display()
                ));
            }

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
            // New file — nothing to follow.
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

    // Atomic write via temp file + rename. See finding #13.
    use std::io::Write;

    // Per-process counter: see finding #14.
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
