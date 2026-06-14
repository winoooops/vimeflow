use std::fs;
use std::path::{Component, Path, PathBuf};

use super::scope::{ensure_within_home, expand_home, home_canonical, reject_parent_refs};
use super::types::{DeletePathRequest, RenamePathRequest};

#[cfg(test)]
pub fn rename_path(request: RenamePathRequest) -> Result<(), String> {
    rename_path_inner(request)
}

#[cfg(test)]
pub fn delete_path(request: DeletePathRequest) -> Result<(), String> {
    delete_path_inner(request)
}

pub(crate) fn rename_path_inner(request: RenamePathRequest) -> Result<(), String> {
    let source = resolve_existing_path(&request.path)?;
    let home = home_canonical()?;

    if source == home {
        return Err("access denied: refusing to rename home directory".to_string());
    }

    let new_name = validate_child_name(&request.new_name)?;
    let parent = source.parent().ok_or_else(|| {
        format!(
            "invalid path: no parent directory for '{}'",
            source.display()
        )
    })?;
    let target = parent.join(new_name);

    if target == source {
        return Ok(());
    }

    match fs::symlink_metadata(&target) {
        Ok(_) => {
            return Err(format!(
                "target already exists: {}",
                target.to_string_lossy()
            ));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(format!(
                "failed to stat target '{}': {}",
                target.display(),
                e
            ));
        }
    }

    log::info!(
        "Renaming path: {} -> {}",
        source.display(),
        target.display()
    );

    fs::rename(&source, &target).map_err(|e| {
        format!(
            "failed to rename '{}' to '{}': {}",
            source.display(),
            target.display(),
            e
        )
    })
}

pub(crate) fn delete_path_inner(request: DeletePathRequest) -> Result<(), String> {
    let target = resolve_existing_path(&request.path)?;
    let home = home_canonical()?;

    if target == home {
        return Err("access denied: refusing to delete home directory".to_string());
    }

    let metadata = fs::symlink_metadata(&target)
        .map_err(|e| format!("failed to stat '{}': {}", target.display(), e))?;

    log::info!("Deleting path: {}", target.display());

    if metadata.is_file() {
        fs::remove_file(&target)
            .map_err(|e| format!("failed to delete file '{}': {}", target.display(), e))
    } else if metadata.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|e| format!("failed to delete directory '{}': {}", target.display(), e))
    } else {
        Err(format!(
            "unsupported path type for delete: {}",
            target.display()
        ))
    }
}

fn resolve_existing_path(path: &str) -> Result<PathBuf, String> {
    let raw = expand_home(path);

    reject_parent_refs(&raw)?;

    if !raw.is_absolute() {
        return Err(format!(
            "access denied: path must be absolute or ~-relative: {}",
            raw.display()
        ));
    }

    let metadata =
        fs::symlink_metadata(&raw).map_err(|e| format!("invalid path '{}': {}", path, e))?;

    if metadata.file_type().is_symlink() {
        return Err(format!(
            "access denied: refusing to mutate symlink: {}",
            raw.display()
        ));
    }

    let canonical =
        fs::canonicalize(&raw).map_err(|e| format!("invalid path '{}': {}", path, e))?;
    let home = home_canonical()?;
    ensure_within_home(&canonical, &home)?;

    Ok(canonical)
}

fn validate_child_name(name: &str) -> Result<&str, String> {
    if name.is_empty() {
        return Err("invalid name: new name must not be empty".to_string());
    }

    if name.contains('/') || name.contains('\\') {
        return Err(format!(
            "invalid name: new name must be a single path component: {}",
            name
        ));
    }

    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(name),
        _ => Err(format!(
            "invalid name: new name must be a single path component: {}",
            name
        )),
    }
}
