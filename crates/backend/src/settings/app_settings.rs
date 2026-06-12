//! Durable app-wide settings store (`app_data_dir/settings.json`).
//! Survives graceful quit and is never wiped by `clear_all` — it holds user
//! preferences, not ephemeral session state.
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

pub const CURRENT_APP_SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct AppSettings {
    pub version: u32,
    pub close_with_no_tabs: String,
    pub on_last_window_closed: String,
    pub use_system_path_prompts: bool,
    pub use_system_prompts: bool,
    pub redact_private_values: bool,
    pub cli_open_behavior: String,
    pub aesthetic: String,
    pub accent_hue: u32,
    pub density: String,
    pub ui_font: String,
    pub mono_font: String,
    pub keymap_preset: String,
    pub agent_shim_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: CURRENT_APP_SETTINGS_VERSION,
            close_with_no_tabs: "platform".into(),
            on_last_window_closed: "platform".into(),
            use_system_path_prompts: true,
            use_system_prompts: true,
            redact_private_values: false,
            cli_open_behavior: "existing".into(),
            aesthetic: "obsidian".into(),
            accent_hue: 285,
            density: "comfortable".into(),
            ui_font: "instrument".into(),
            mono_font: "jetbrains".into(),
            keymap_preset: "vimeflow".into(),
            agent_shim_enabled: true,
        }
    }
}

/// Rust-owned durable cache for `app_data_dir/settings.json`.
/// Atomic write (`tempfile.persist`) + in-memory mirror, mirroring
/// `WorkspaceLayoutCache`. Distinct file from `sessions.json`, so `clear_all`
/// (which only wipes `sessions.json`) never touches it — the durability
/// invariant.
#[derive(Debug)]
pub struct AppSettingsCache {
    path: PathBuf,
    mirror: Mutex<Option<AppSettings>>,
}

impl AppSettingsCache {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            mirror: Mutex::new(None),
        }
    }

    /// Load from disk; missing / unreadable / corrupt / version mismatch →
    /// `AppSettings::default()` (never fails — this is a convenience cache
    /// that must not block lifecycle).
    pub fn load(&self) -> AppSettings {
        let mut guard = self.mirror.lock().expect("app settings mirror poisoned");
        let settings = match fs::read(&self.path) {
            Ok(bytes) => match serde_json::from_slice::<AppSettings>(&bytes) {
                Ok(parsed) if parsed.version == CURRENT_APP_SETTINGS_VERSION => parsed,
                Ok(_) => AppSettings::default(),
                Err(_) => AppSettings::default(),
            },
            Err(_) => AppSettings::default(),
        };
        *guard = Some(settings.clone());
        settings
    }

    /// Atomically persist the assembled settings + refresh the mirror, holding
    /// the lock across the disk write so overlapping saves cannot persist out
    /// of order.
    pub fn save(&self, settings: &AppSettings) -> Result<(), String> {
        // Fail closed: never overwrite the durable file with a version `load`
        // would discard (which would silently delete the saved settings on the
        // next restore).
        if settings.version != CURRENT_APP_SETTINGS_VERSION {
            return Err(format!(
                "refusing to save unsupported app settings version {} (current {CURRENT_APP_SETTINGS_VERSION})",
                settings.version
            ));
        }
        let mut guard = self.mirror.lock().expect("app settings mirror poisoned");
        self.flush_to_disk(settings)?;
        *guard = Some(settings.clone());
        Ok(())
    }

    /// The in-memory mirror (consumed by the renderer-facing IPC path).
    #[allow(dead_code)]
    pub fn current(&self) -> Option<AppSettings> {
        self.mirror
            .lock()
            .expect("app settings mirror poisoned")
            .clone()
    }

    /// Alias for [`Self::current`].
    #[allow(dead_code)]
    pub fn get(&self) -> Option<AppSettings> {
        self.current()
    }

    fn flush_to_disk(&self, settings: &AppSettings) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "app settings path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        let mut tmp =
            tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("create tempfile: {e}"))?;
        let bytes = serde_json::to_vec_pretty(settings).map_err(|e| format!("serialize: {e}"))?;
        tmp.write_all(&bytes).map_err(|e| format!("write: {e}"))?;
        tmp.persist(&self.path)
            .map_err(|e| format!("persist: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom_settings() -> AppSettings {
        AppSettings {
            version: CURRENT_APP_SETTINGS_VERSION,
            close_with_no_tabs: "close".into(),
            on_last_window_closed: "quit".into(),
            use_system_path_prompts: false,
            use_system_prompts: false,
            redact_private_values: true,
            cli_open_behavior: "new".into(),
            aesthetic: "obsidian".into(),
            accent_hue: 300,
            density: "compact".into(),
            ui_font: "inter".into(),
            mono_font: "iosevka".into(),
            keymap_preset: "vim".into(),
            agent_shim_enabled: false,
        }
    }

    #[test]
    fn default_values_match_ui_precedent() {
        let s = AppSettings::default();
        assert_eq!(s.version, CURRENT_APP_SETTINGS_VERSION);
        assert_eq!(s.close_with_no_tabs, "platform");
        assert_eq!(s.on_last_window_closed, "platform");
        assert!(s.use_system_path_prompts);
        assert!(s.use_system_prompts);
        assert!(!s.redact_private_values);
        assert_eq!(s.cli_open_behavior, "existing");
        assert_eq!(s.aesthetic, "obsidian");
        assert_eq!(s.accent_hue, 285);
        assert_eq!(s.density, "comfortable");
        assert_eq!(s.ui_font, "instrument");
        assert_eq!(s.mono_font, "jetbrains");
        assert_eq!(s.keymap_preset, "vimeflow");
        assert!(s.agent_shim_enabled);
    }

    #[test]
    fn serializes_camel_case_fields() {
        let json = serde_json::to_string(&AppSettings::default()).unwrap();
        assert!(
            json.contains("\"closeWithNoTabs\":\"platform\""),
            "json: {json}"
        );
        assert!(
            json.contains("\"onLastWindowClosed\":\"platform\""),
            "json: {json}"
        );
        assert!(
            json.contains("\"useSystemPathPrompts\":true"),
            "json: {json}"
        );
        assert!(json.contains("\"accentHue\":285"), "json: {json}");
        assert!(json.contains("\"agentShimEnabled\":true"), "json: {json}");
        assert!(
            json.contains("\"keymapPreset\":\"vimeflow\""),
            "json: {json}"
        );
    }

    #[test]
    fn cache_save_then_load_round_trips_and_missing_loads_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let cache = AppSettingsCache::new(path.clone());
        let loaded = cache.load();
        assert_eq!(loaded, AppSettings::default()); // missing → defaults

        let settings = custom_settings();
        cache.save(&settings).unwrap();
        assert_eq!(cache.current().unwrap(), settings); // mirror refreshed

        // Fresh cache instance reads the persisted file.
        let reloaded = AppSettingsCache::new(path).load();
        assert_eq!(reloaded, settings);
    }

    #[test]
    fn malformed_json_loads_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "not json at all").unwrap();

        let loaded = AppSettingsCache::new(path).load();
        assert_eq!(loaded, AppSettings::default());
    }

    #[test]
    fn wrong_version_loads_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{"version":999,"closeWithNoTabs":"close","accentHue":123}"#,
        )
        .unwrap();

        let loaded = AppSettingsCache::new(path).load();
        assert_eq!(loaded, AppSettings::default());
    }

    #[test]
    fn partial_file_defaults_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{"version":1,"closeWithNoTabs":"nothing","accentHue":42}"#,
        )
        .unwrap();

        let loaded = AppSettingsCache::new(path).load();
        assert_eq!(loaded.close_with_no_tabs, "nothing");
        assert_eq!(loaded.accent_hue, 42);
        assert_eq!(loaded.on_last_window_closed, "platform");
        assert!(loaded.use_system_path_prompts);
        assert_eq!(loaded.density, "comfortable");
        assert_eq!(loaded.keymap_preset, "vimeflow");
    }

    #[test]
    fn save_rejects_unsupported_version_failing_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let cache = AppSettingsCache::new(path.clone());
        cache.save(&custom_settings()).unwrap();
        assert!(path.exists());

        let bad = AppSettings {
            version: 999,
            ..AppSettings::default()
        };
        assert!(cache.save(&bad).is_err());

        // Original good file survived the failed save.
        let reloaded = AppSettingsCache::new(path).load();
        assert_eq!(reloaded, custom_settings());
    }

    #[test]
    fn saved_file_is_valid_json_that_re_parses() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let cache = AppSettingsCache::new(path.clone());
        let settings = custom_settings();
        cache.save(&settings).unwrap();

        let bytes = fs::read(&path).unwrap();
        let parsed: AppSettings = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed, settings);
    }

    #[test]
    fn get_returns_mirror_after_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let cache = AppSettingsCache::new(path);
        assert!(cache.get().is_none());

        let settings = custom_settings();
        cache.save(&settings).unwrap();
        assert_eq!(cache.get().unwrap(), settings);
        assert_eq!(cache.current().unwrap(), settings);
    }
}
