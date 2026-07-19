//! Stores unfinished diff-review work so it survives an app restart.
//!
//! Review drafts and replies cannot live only in the browser because closing the
//! window would lose them. This module keeps a versioned JSON record for each
//! repository and pane owner, validates it when loading, and replaces the file
//! atomically when saving so a partial write cannot destroy the previous copy.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{Map, Value};

const CURRENT_VERSION: u64 = 1;
const MAX_KEY_BYTES: usize = 512;
const MAX_REVIEW_STATE_BYTES: usize = 4 * 1024 * 1024;
const MAX_STORE_BYTES: usize = 32 * 1024 * 1024;
const MAX_STORE_RECORDS: usize = 1_024;

#[derive(Debug, Default)]
struct ReviewStateStore {
    records: BTreeMap<String, BTreeMap<String, Value>>,
    writable: bool,
}

#[derive(Debug)]
pub struct ReviewStateCache {
    path: PathBuf,
    data: Mutex<ReviewStateStore>,
}

impl ReviewStateCache {
    pub fn new(path: PathBuf) -> Self {
        let data = load_store(&path);

        Self {
            path,
            data: Mutex::new(data),
        }
    }

    pub fn load(&self, repository_id: &str, owner_key: &str) -> Option<Value> {
        self.data
            .lock()
            .expect("review-state mutex poisoned")
            .records
            .get(repository_id)
            .and_then(|owners| owners.get(owner_key))
            .cloned()
    }

    pub fn save(
        &self,
        repository_id: &str,
        owner_key: &str,
        state: Option<Value>,
    ) -> Result<(), String> {
        self.save_with_aliases(repository_id, &[], owner_key, state)
    }

    pub fn save_with_aliases(
        &self,
        repository_id: &str,
        repository_aliases: &[String],
        owner_key: &str,
        state: Option<Value>,
    ) -> Result<(), String> {
        validate_key("repository id", repository_id)?;
        for alias in repository_aliases {
            validate_key("repository alias", alias)?;
        }
        validate_key("owner key", owner_key)?;
        if let Some(value) = state.as_ref() {
            if !value.is_object() {
                return Err("review state must be an object".to_string());
            }
            let size = serde_json::to_vec(value)
                .map_err(|e| format!("serialize review state: {e}"))?
                .len();
            if size > MAX_REVIEW_STATE_BYTES {
                return Err(format!(
                    "review state exceeds {MAX_REVIEW_STATE_BYTES} bytes"
                ));
            }
        }

        self.mutate(|records| {
            match state {
                Some(value) => {
                    records
                        .entry(repository_id.to_string())
                        .or_default()
                        .insert(owner_key.to_string(), value);
                }
                None => remove_record(records, repository_id, owner_key),
            }
            for alias in repository_aliases {
                if alias != repository_id {
                    remove_record(records, alias, owner_key);
                }
            }
            Ok(())
        })
    }

    pub fn delete_owner(&self, owner_key: &str) -> Result<(), String> {
        validate_key("owner key", owner_key)?;
        self.mutate(|records| {
            records.retain(|_, owners| {
                owners.remove(owner_key);
                !owners.is_empty()
            });
            Ok(())
        })
    }

    fn mutate<F>(&self, change: F) -> Result<(), String>
    where
        F: FnOnce(&mut BTreeMap<String, BTreeMap<String, Value>>) -> Result<(), String>,
    {
        let mut guard = self.data.lock().expect("review-state mutex poisoned");
        if !guard.writable {
            return Err(format!(
                "review-state version is unsupported; refusing to overwrite {}",
                self.path.display()
            ));
        }

        let mut next = guard.records.clone();
        change(&mut next)?;
        flush_to_disk(&self.path, &next)?;
        guard.records = next;
        Ok(())
    }
}

fn validate_key(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > MAX_KEY_BYTES || value.contains('\0') {
        return Err(format!(
            "{label} must be non-empty, contain no NUL, and be at most {MAX_KEY_BYTES} bytes"
        ));
    }
    Ok(())
}

fn remove_record(
    records: &mut BTreeMap<String, BTreeMap<String, Value>>,
    repository_id: &str,
    owner_key: &str,
) {
    let Some(owners) = records.get_mut(repository_id) else {
        return;
    };
    owners.remove(owner_key);
    if owners.is_empty() {
        records.remove(repository_id);
    }
}

fn load_store(path: &Path) -> ReviewStateStore {
    if let Ok(metadata) = fs::metadata(path) {
        if metadata.len() > MAX_STORE_BYTES as u64 {
            log::warn!(
                "review-state file exceeds {MAX_STORE_BYTES} bytes in {}; leaving it untouched",
                path.display()
            );
            return ReviewStateStore::default();
        }
    }

    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return ReviewStateStore {
                writable: true,
                ..ReviewStateStore::default()
            };
        }
        Err(err) => {
            log::warn!("review-state read failed for {}: {err}", path.display());
            return ReviewStateStore::default();
        }
    };

    let root: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(err) => {
            log::warn!(
                "review-state parse failed for {}: {err}; moving aside",
                path.display()
            );
            let backup = path.with_extension(format!(
                "json.corrupt-{}",
                chrono::Utc::now().format("%Y%m%d%H%M%S")
            ));
            let _ = fs::rename(path, backup);
            return ReviewStateStore {
                writable: true,
                ..ReviewStateStore::default()
            };
        }
    };

    if root.get("version").and_then(Value::as_u64) != Some(CURRENT_VERSION) {
        log::warn!(
            "review-state version unsupported in {}; leaving file untouched",
            path.display()
        );
        return ReviewStateStore::default();
    }

    let records = root
        .get("records")
        .and_then(Value::as_object)
        .map(parse_records)
        .unwrap_or_default();

    if record_count(&records) > MAX_STORE_RECORDS {
        log::warn!(
            "review-state exceeds {MAX_STORE_RECORDS} records in {}; leaving it untouched",
            path.display()
        );
        return ReviewStateStore::default();
    }

    ReviewStateStore {
        records,
        writable: true,
    }
}

fn parse_records(raw: &Map<String, Value>) -> BTreeMap<String, BTreeMap<String, Value>> {
    raw.iter()
        .filter_map(|(repository_id, owners)| {
            validate_key("repository id", repository_id).ok()?;
            let valid_owners = owners
                .as_object()?
                .iter()
                .filter(|(owner_key, state)| {
                    validate_key("owner key", owner_key).is_ok()
                        && state.is_object()
                        && serde_json::to_vec(state)
                            .is_ok_and(|bytes| bytes.len() <= MAX_REVIEW_STATE_BYTES)
                })
                .map(|(owner_key, state)| (owner_key.clone(), state.clone()))
                .collect::<BTreeMap<_, _>>();

            (!valid_owners.is_empty()).then(|| (repository_id.clone(), valid_owners))
        })
        .collect()
}

fn record_count(records: &BTreeMap<String, BTreeMap<String, Value>>) -> usize {
    records.values().map(BTreeMap::len).sum()
}

fn flush_to_disk(
    path: &Path,
    records: &BTreeMap<String, BTreeMap<String, Value>>,
) -> Result<(), String> {
    if record_count(records) > MAX_STORE_RECORDS {
        return Err(format!("review-state exceeds {MAX_STORE_RECORDS} records"));
    }

    let parent = path
        .parent()
        .ok_or_else(|| "review-state path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("review-state mkdir: {e}"))?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("review-state create tempfile: {e}"))?;
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "version": CURRENT_VERSION,
        "records": records,
    }))
    .map_err(|e| format!("serialize review-state store: {e}"))?;
    if bytes.len() > MAX_STORE_BYTES {
        return Err(format!("review-state exceeds {MAX_STORE_BYTES} bytes"));
    }
    tmp.write_all(&bytes)
        .map_err(|e| format!("write review-state store: {e}"))?;
    tmp.persist(path)
        .map_err(|e| format!("persist review-state store: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    #[test]
    fn round_trip_and_owner_cleanup_preserve_unrelated_records() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("review-state.json");
        let cache = ReviewStateCache::new(path.clone());

        cache
            .save(
                "repo-a",
                "session-a:p0",
                Some(json!({ "version": 1, "annotations": [1] })),
            )
            .unwrap();
        cache
            .save(
                "repo-b",
                "session-b:p0",
                Some(json!({ "version": 1, "annotations": [2] })),
            )
            .unwrap();

        let reloaded = ReviewStateCache::new(path.clone());
        assert_eq!(
            reloaded.load("repo-a", "session-a:p0"),
            Some(json!({ "version": 1, "annotations": [1] }))
        );

        reloaded.delete_owner("session-a:p0").unwrap();

        let after_cleanup = ReviewStateCache::new(path);
        assert_eq!(after_cleanup.load("repo-a", "session-a:p0"), None);
        assert_eq!(
            after_cleanup.load("repo-b", "session-b:p0"),
            Some(json!({ "version": 1, "annotations": [2] }))
        );
    }

    #[test]
    fn save_migrates_owner_state_from_repository_aliases() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("review-state.json");
        let cache = ReviewStateCache::new(path);

        cache
            .save(
                "old-repository-id",
                "session-a:p0",
                Some(json!({ "version": 1, "draft": { "text": "old" } })),
            )
            .unwrap();
        cache
            .save_with_aliases(
                "new-repository-id",
                &["old-repository-id".to_string()],
                "session-a:p0",
                Some(json!({ "version": 1, "draft": { "text": "new" } })),
            )
            .unwrap();

        assert_eq!(cache.load("old-repository-id", "session-a:p0"), None);
        assert_eq!(
            cache.load("new-repository-id", "session-a:p0"),
            Some(json!({ "version": 1, "draft": { "text": "new" } }))
        );
    }

    #[test]
    fn malformed_record_does_not_hide_or_overwrite_valid_siblings() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("review-state.json");
        std::fs::write(
            &path,
            serde_json::to_vec(&json!({
                "version": 1,
                "records": {
                    "repo-a": {
                        "valid-owner": { "version": 1, "annotations": [] },
                        "broken-owner": "not an object"
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let cache = ReviewStateCache::new(path.clone());
        assert_eq!(
            cache.load("repo-a", "valid-owner"),
            Some(json!({ "version": 1, "annotations": [] }))
        );
        assert_eq!(cache.load("repo-a", "broken-owner"), None);

        cache
            .save(
                "repo-a",
                "new-owner",
                Some(json!({ "version": 1, "draft": { "text": "kept" } })),
            )
            .unwrap();

        let reloaded = ReviewStateCache::new(path);
        assert_eq!(
            reloaded.load("repo-a", "valid-owner"),
            Some(json!({ "version": 1, "annotations": [] }))
        );
        assert!(reloaded.load("repo-a", "new-owner").is_some());
    }

    #[test]
    fn unsupported_store_version_is_left_untouched() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("review-state.json");
        let unsupported = br#"{"version":99,"records":{"repo":{"owner":{"version":99}}}}"#;
        std::fs::write(&path, unsupported).unwrap();

        let cache = ReviewStateCache::new(path.clone());
        assert_eq!(cache.load("repo", "owner"), None);
        assert!(cache
            .save("repo", "owner", Some(json!({ "version": 1 })))
            .is_err());
        assert_eq!(std::fs::read(path).unwrap(), unsupported);
    }

    #[test]
    fn oversized_store_is_not_loaded_or_overwritten() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("review-state.json");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_STORE_BYTES as u64 + 1).unwrap();

        let cache = ReviewStateCache::new(path.clone());
        assert_eq!(cache.load("repo", "owner"), None);
        assert!(cache
            .save("repo", "owner", Some(json!({ "version": 1 })))
            .is_err());
        assert_eq!(
            std::fs::metadata(path).unwrap().len(),
            MAX_STORE_BYTES as u64 + 1
        );
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_store_is_not_overwritten() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("review-state.json");
        let original = br#"{"version":1,"records":{"repo":{"owner":{"version":1}}}}"#;
        std::fs::write(&path, original).unwrap();

        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o000);
        std::fs::set_permissions(&path, permissions).unwrap();

        if std::fs::read(&path).is_ok() {
            let mut permissions = std::fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o600);
            std::fs::set_permissions(&path, permissions).unwrap();
            return;
        }

        let cache = ReviewStateCache::new(path.clone());
        let result = cache.save("other-repo", "other-owner", Some(json!({ "version": 1 })));

        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o600);
        std::fs::set_permissions(&path, permissions).unwrap();

        assert!(result.is_err());
        assert_eq!(std::fs::read(path).unwrap(), original);
    }
}
