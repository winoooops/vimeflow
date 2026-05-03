//! Path trust checks for adapter-provided status sources.

use std::fs;
use std::path::Path;

pub(super) fn ensure_status_source_under_trust_root(
    status_path: &Path,
    trust_root: &Path,
) -> Result<(), String> {
    let canonical_root = fs::canonicalize(trust_root)
        .map_err(|e| format!("trust_root not resolvable: {}: {}", trust_root.display(), e))?;

    let parent = status_path
        .parent()
        .ok_or_else(|| "status file path has no parent directory".to_string())?;

    let mut probe = parent;
    let canonical_ancestor = loop {
        if probe.exists() {
            break fs::canonicalize(probe)
                .map_err(|e| format!("failed to canonicalize status ancestor: {}", e))?;
        }

        probe = probe
            .parent()
            .ok_or_else(|| format!("status path escapes filesystem root: {}", parent.display()))?;
    };

    if !canonical_ancestor.starts_with(&canonical_root) {
        return Err(format!(
            "status source path escapes trust_root: {} not under {}",
            canonical_ancestor.display(),
            canonical_root.display()
        ));
    }

    fs::create_dir_all(parent).map_err(|e| format!("failed to create status directory: {}", e))?;

    let canonical_parent = fs::canonicalize(parent)
        .map_err(|e| format!("failed to canonicalize status directory: {}", e))?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err(format!(
            "status parent escapes trust_root after create: {} not under {}",
            canonical_parent.display(),
            canonical_root.display()
        ));
    }

    Ok(())
}
