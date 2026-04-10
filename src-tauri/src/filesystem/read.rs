use std::fs;

use super::scope::{ensure_within_home, expand_home, home_canonical, open_nofollow};
use super::types::ReadFileRequest;

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
