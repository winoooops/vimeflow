//! opencode adapter (observability v1).
//!
//! M2 lands the opencode-side bridge plugin + its auto-installer and the wire
//! DTOs the later milestones consume. M3 adds the filesystem locator + the
//! per-process types + the transcript-path validator. The parser / transcript
//! modules arrive in M4–M5.

// M2 defines the install + wire-DTO API surface; M3 adds the locator + types.
// M4 adds the snapshot decoder (parser). Their first production callers land in
// M5 (bindings dispatch), so the public items here are still "dead" by
// exhaustiveness analysis even though they are exercised by unit tests — mirror
// the staged-code `#[allow(dead_code)]` precedent used in `adapter/attach.rs`
// rather than leave warnings.
#[allow(dead_code)]
pub(crate) mod install;
#[allow(dead_code)]
pub(crate) mod locator;
#[allow(dead_code)]
pub(crate) mod parser;
#[allow(dead_code)]
pub(crate) mod transcript_dto;
#[allow(dead_code)]
pub(crate) mod types;

#[cfg(test)]
use std::ffi::OsString;
#[cfg(test)]
use std::sync::{Mutex, MutexGuard};

#[cfg(test)]
use once_cell::sync::Lazy;

/// Serializes every test that mutates the process-wide opencode env vars
/// (`VIMEFLOW_OPENCODE_BRIDGE_DIR`, `VIMEFLOW_OPENCODE_PLUGINS_DIR`,
/// `XDG_DATA_HOME`, `HOME`, `OPENCODE_HOME`) so concurrent tests don't observe
/// each other's mutations.
#[cfg(test)]
static OPENCODE_ENV_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// The env vars [`OpencodeEnvGuard`] snapshots + restores. Kept together so the
/// guard always leaves the process environment exactly as it found it.
#[cfg(test)]
const GUARDED_ENV_KEYS: &[&str] = &[
    "VIMEFLOW_OPENCODE_BRIDGE_DIR",
    "VIMEFLOW_OPENCODE_PLUGINS_DIR",
    "XDG_DATA_HOME",
    "HOME",
    "OPENCODE_HOME",
];

/// RAII guard: locks [`OPENCODE_ENV_LOCK`] so env-mutating tests serialize,
/// snapshots the guarded vars, and restores them on drop.
#[cfg(test)]
pub(crate) struct OpencodeEnvGuard {
    _lock: MutexGuard<'static, ()>,
    prev: Vec<(&'static str, Option<OsString>)>,
}

#[cfg(test)]
impl OpencodeEnvGuard {
    pub(crate) fn acquire() -> Self {
        let lock = OPENCODE_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let prev = GUARDED_ENV_KEYS
            .iter()
            .map(|key| (*key, std::env::var_os(key)))
            .collect();

        Self { _lock: lock, prev }
    }
}

#[cfg(test)]
impl Drop for OpencodeEnvGuard {
    fn drop(&mut self) {
        for (key, value) in self.prev.drain(..) {
            match value {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
    }
}
