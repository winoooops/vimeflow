//! Durable coding-agent alias store (`~/.config/vimeflow/aliases.toml`).
//!
//! User-defined shell aliases are injected into every spawned pane's shell
//! via the bridge `init.sh` (see `terminal::bridge`). They are never written
//! to the user's rc files.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub const CURRENT_AGENT_ALIASES_VERSION: u32 = 1;

/// User-defined alias for launching a coding agent (or arbitrary shell command).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct AgentAlias {
    pub id: String,
    pub alias: String,
    pub agent: String,
    pub model: String,
    pub extra: String,
    pub account: Option<String>,
}

impl Default for AgentAlias {
    fn default() -> Self {
        Self {
            id: String::new(),
            alias: String::new(),
            agent: String::new(),
            model: String::new(),
            extra: String::new(),
            account: None,
        }
    }
}

/// On-disk wrapper for the alias store.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct AgentAliasesStore {
    pub version: u32,
    pub aliases: Vec<AgentAlias>,
}

impl Default for AgentAliasesStore {
    fn default() -> Self {
        Self {
            version: CURRENT_AGENT_ALIASES_VERSION,
            aliases: Vec::new(),
        }
    }
}

/// Rust-owned durable cache for `~/.config/vimeflow/aliases.toml`.
///
/// Mirrors `AppSettingsCache`: atomic write (`tempfile.persist`) + in-memory
/// mirror. Missing / corrupt / version-mismatched files load as the default
/// empty store.
#[derive(Debug)]
pub struct AliasesCache {
    path: PathBuf,
    mirror: Mutex<Option<AgentAliasesStore>>,
}

impl AliasesCache {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            mirror: Mutex::new(None),
        }
    }

    /// Resolve the canonical aliases.toml path (`~/.config/vimeflow/aliases.toml`).
    pub fn default_path() -> PathBuf {
        dirs::home_dir()
            .map(|home| home.join(".config"))
            .or_else(dirs::config_dir)
            .unwrap_or_else(std::env::temp_dir)
            .join("vimeflow")
            .join("aliases.toml")
    }

    /// Load from disk; missing / unreadable / corrupt / version mismatch →
    /// `AgentAliasesStore::default()` (never fails).
    pub fn load(&self) -> AgentAliasesStore {
        let mut guard = self.mirror.lock().expect("aliases mirror poisoned");
        let store = match fs::read(&self.path) {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                match toml::from_str::<AgentAliasesStore>(&text) {
                    Ok(parsed) if parsed.version == CURRENT_AGENT_ALIASES_VERSION => parsed,
                    Ok(_) => AgentAliasesStore::default(),
                    Err(_) => AgentAliasesStore::default(),
                }
            }
            Err(_) => AgentAliasesStore::default(),
        };
        *guard = Some(store.clone());
        store
    }

    /// Atomically persist the assembled store + refresh the mirror, holding
    /// the lock across the disk write so overlapping saves cannot persist out
    /// of order.
    pub fn save(&self, store: &AgentAliasesStore) -> Result<(), String> {
        if store.version != CURRENT_AGENT_ALIASES_VERSION {
            return Err(format!(
                "refusing to save unsupported aliases version {} (current {CURRENT_AGENT_ALIASES_VERSION})",
                store.version
            ));
        }
        let mut guard = self.mirror.lock().expect("aliases mirror poisoned");
        self.flush_to_disk(store)?;
        *guard = Some(store.clone());
        Ok(())
    }

    /// The in-memory mirror (consumed by the renderer-facing IPC path).
    pub fn current(&self) -> Option<AgentAliasesStore> {
        self.mirror.lock().expect("aliases mirror poisoned").clone()
    }

    fn flush_to_disk(&self, store: &AgentAliasesStore) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "aliases path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        let mut tmp =
            tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("create tempfile: {e}"))?;
        let text = toml::to_string(store).map_err(|e| format!("serialize: {e}"))?;
        tmp.write_all(text.as_bytes())
            .map_err(|e| format!("write: {e}"))?;
        tmp.persist(&self.path)
            .map_err(|e| format!("persist: {e}"))?;
        Ok(())
    }
}

/// Build a block of `alias <name>='<cmd>'` lines for injection into `init.sh`.
///
/// * `claude`/`codex`/`gemini` agents emit `<binary> --model <model> <extra>`.
/// * `shell` agent emits only `<extra>`.
/// * Omits `--model <model>` when `model` is empty.
/// * Appends trimmed `extra` when non-empty.
/// * Skips aliases whose name is empty or not a safe shell identifier.
/// * Single-quotes the command and escapes embedded single quotes as `\'\'\'`.
pub fn build_alias_lines(aliases: &[AgentAlias]) -> String {
    let mut out = String::new();
    let name_re = regex::Regex::new(r"^[A-Za-z_][A-Za-z0-9_-]*$").expect("valid alias name regex");

    for alias in aliases {
        if alias.alias.is_empty() || !name_re.is_match(&alias.alias) {
            continue;
        }

        let cmd = build_alias_command(alias);
        let escaped = cmd.replace('\'', "'\\''");
        out.push_str(&format!("alias {}='{}'\n", alias.alias, escaped));
    }

    out
}

fn normalize_alias_field(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    normalized
        .split('\n')
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn build_alias_command(alias: &AgentAlias) -> String {
    let binary = match alias.agent.as_str() {
        "claude" | "codex" | "gemini" => Some(alias.agent.as_str()),
        "shell" => None,
        _ => None,
    };

    let mut parts: Vec<String> = Vec::new();

    if let Some(binary) = binary {
        parts.push(binary.to_string());
        let model = normalize_alias_field(&alias.model);
        if !model.is_empty() {
            parts.push(format!("--model {}", model));
        }
    }

    let extra = normalize_alias_field(&alias.extra);
    if !extra.is_empty() {
        parts.push(extra.to_string());
    }

    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_alias(alias: &str, agent: &str, model: &str, extra: &str) -> AgentAlias {
        AgentAlias {
            id: format!("id-{alias}"),
            alias: alias.to_string(),
            agent: agent.to_string(),
            model: model.to_string(),
            extra: extra.to_string(),
            account: None,
        }
    }

    fn custom_store() -> AgentAliasesStore {
        AgentAliasesStore {
            version: CURRENT_AGENT_ALIASES_VERSION,
            aliases: vec![make_alias("c", "claude", "sonnet", "--print ok")],
        }
    }

    #[test]
    fn default_store_is_version_one_with_empty_aliases() {
        let s = AgentAliasesStore::default();
        assert_eq!(s.version, CURRENT_AGENT_ALIASES_VERSION);
        assert!(s.aliases.is_empty());
    }

    #[test]
    fn default_alias_is_empty() {
        let a = AgentAlias::default();
        assert!(a.id.is_empty());
        assert!(a.alias.is_empty());
        assert!(a.agent.is_empty());
        assert!(a.model.is_empty());
        assert!(a.extra.is_empty());
        assert_eq!(a.account, None);
    }

    #[test]
    fn serializes_camel_case_fields() {
        let toml_text = toml::to_string(&AgentAliasesStore {
            version: CURRENT_AGENT_ALIASES_VERSION,
            aliases: vec![AgentAlias {
                id: "a1".into(),
                alias: "c".into(),
                agent: "claude".into(),
                model: "sonnet".into(),
                extra: "".into(),
                account: Some("work".into()),
            }],
        })
        .unwrap();
        assert!(toml_text.contains("version = 1"), "toml: {toml_text}");
        assert!(toml_text.contains("[[aliases]]"), "toml: {toml_text}");
        assert!(toml_text.contains("id = \"a1\""), "toml: {toml_text}");
        assert!(toml_text.contains("alias = \"c\""), "toml: {toml_text}");
        assert!(
            toml_text.contains("agent = \"claude\""),
            "toml: {toml_text}"
        );
        assert!(
            toml_text.contains("model = \"sonnet\""),
            "toml: {toml_text}"
        );
        assert!(
            toml_text.contains("account = \"work\""),
            "toml: {toml_text}"
        );
    }

    #[test]
    fn cache_save_then_load_round_trips_and_missing_loads_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("aliases.toml");
        let cache = AliasesCache::new(path.clone());
        let loaded = cache.load();
        assert_eq!(loaded, AgentAliasesStore::default());

        let store = custom_store();
        cache.save(&store).unwrap();
        assert_eq!(cache.current().unwrap(), store);

        let reloaded = AliasesCache::new(path).load();
        assert_eq!(reloaded, store);
    }

    #[test]
    fn malformed_toml_loads_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("aliases.toml");
        fs::write(&path, "not toml at all [[").unwrap();

        let loaded = AliasesCache::new(path).load();
        assert_eq!(loaded, AgentAliasesStore::default());
    }

    #[test]
    fn wrong_version_loads_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("aliases.toml");
        fs::write(&path, "version = 999\naliases = []").unwrap();

        let loaded = AliasesCache::new(path).load();
        assert_eq!(loaded, AgentAliasesStore::default());
    }

    #[test]
    fn partial_file_defaults_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("aliases.toml");
        fs::write(
            &path,
            r#"version = 1

[[aliases]]
id = "a1"
alias = "c"
"#,
        )
        .unwrap();

        let loaded = AliasesCache::new(path).load();
        assert_eq!(loaded.aliases.len(), 1);
        assert_eq!(loaded.aliases[0].id, "a1");
        assert_eq!(loaded.aliases[0].alias, "c");
        assert_eq!(loaded.aliases[0].agent, "");
        assert_eq!(loaded.aliases[0].model, "");
        assert_eq!(loaded.aliases[0].extra, "");
        assert_eq!(loaded.aliases[0].account, None);
    }

    #[test]
    fn save_rejects_unsupported_version_failing_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("aliases.toml");
        let cache = AliasesCache::new(path.clone());
        cache.save(&custom_store()).unwrap();
        assert!(path.exists());

        let bad = AgentAliasesStore {
            version: 999,
            ..AgentAliasesStore::default()
        };
        assert!(cache.save(&bad).is_err());

        let reloaded = AliasesCache::new(path).load();
        assert_eq!(reloaded, custom_store());
    }

    #[test]
    fn saved_file_is_valid_toml_that_re_parses() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("aliases.toml");
        let cache = AliasesCache::new(path.clone());
        let store = custom_store();
        cache.save(&store).unwrap();

        let bytes = fs::read(&path).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        let parsed: AgentAliasesStore = toml::from_str(&text).unwrap();
        assert_eq!(parsed, store);
    }

    #[test]
    fn current_returns_mirror_after_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("aliases.toml");
        let cache = AliasesCache::new(path);
        assert!(cache.current().is_none());

        let store = custom_store();
        cache.save(&store).unwrap();
        assert_eq!(cache.current().unwrap(), store);
    }

    #[test]
    fn build_alias_lines_claude_includes_model_and_extra() {
        let aliases = vec![make_alias("c", "claude", "sonnet", "--print ok")];
        let lines = build_alias_lines(&aliases);
        assert_eq!(lines, "alias c='claude --model sonnet --print ok'\n");
    }

    #[test]
    fn build_alias_lines_codex_includes_model_and_extra() {
        let aliases = vec![make_alias(
            "cx",
            "codex",
            "o3",
            "--dangerously-skip-permissions",
        )];
        let lines = build_alias_lines(&aliases);
        assert_eq!(
            lines,
            "alias cx='codex --model o3 --dangerously-skip-permissions'\n"
        );
    }

    #[test]
    fn build_alias_lines_gemini_includes_model_and_extra() {
        let aliases = vec![make_alias("g", "gemini", "pro", "--some-flag")];
        let lines = build_alias_lines(&aliases);
        assert_eq!(lines, "alias g='gemini --model pro --some-flag'\n");
    }

    #[test]
    fn build_alias_lines_omits_model_when_empty() {
        let aliases = vec![make_alias("c", "claude", "", "--print ok")];
        let lines = build_alias_lines(&aliases);
        assert_eq!(lines, "alias c='claude --print ok'\n");
    }

    #[test]
    fn build_alias_lines_shell_agent_is_extra_only() {
        let aliases = vec![AgentAlias {
            id: "s1".into(),
            alias: "lint".into(),
            agent: "shell".into(),
            model: "ignored".into(),
            extra: "npm run lint".into(),
            account: None,
        }];
        let lines = build_alias_lines(&aliases);
        assert_eq!(lines, "alias lint='npm run lint'\n");
    }

    #[test]
    fn build_alias_lines_escapes_single_quotes() {
        let aliases = vec![make_alias(
            "c",
            "claude",
            "sonnet",
            "--prompt 'hello world'",
        )];
        let lines = build_alias_lines(&aliases);
        assert_eq!(
            lines,
            "alias c='claude --model sonnet --prompt '\\\''hello world'\\\'''\n"
        );
    }

    #[test]
    fn build_alias_lines_skips_empty_name() {
        let aliases = vec![
            AgentAlias {
                id: "bad".into(),
                alias: "".into(),
                agent: "claude".into(),
                model: "sonnet".into(),
                extra: "".into(),
                account: None,
            },
            make_alias("good", "claude", "sonnet", ""),
        ];
        let lines = build_alias_lines(&aliases);
        assert_eq!(lines, "alias good='claude --model sonnet'\n");
    }

    #[test]
    fn build_alias_lines_skips_invalid_names() {
        let aliases = vec![
            make_alias("123bad", "claude", "sonnet", ""),
            make_alias("has space", "claude", "sonnet", ""),
            make_alias("semi;bad", "claude", "sonnet", ""),
            make_alias("good_name-1", "claude", "sonnet", ""),
        ];
        let lines = build_alias_lines(&aliases);
        assert_eq!(lines, "alias good_name-1='claude --model sonnet'\n");
    }

    #[test]
    fn build_alias_lines_ignores_unknown_agent() {
        let aliases = vec![make_alias("u", "unknown", "sonnet", "--extra")];
        let lines = build_alias_lines(&aliases);
        assert_eq!(lines, "alias u='--extra'\n");
    }

    #[test]
    fn build_alias_lines_replaces_newlines_with_space() {
        let aliases = vec![
            make_alias("c", "claude", "son\nnet", "--print\rok"),
            AgentAlias {
                id: "s1".into(),
                alias: "lint".into(),
                agent: "shell".into(),
                model: "ignored\nmodel".into(),
                extra: "npm run lint\r\n--fix".into(),
                account: None,
            },
        ];
        let lines = build_alias_lines(&aliases);
        assert_eq!(
            lines,
            "alias c='claude --model son net --print ok'\nalias lint='npm run lint --fix'\n"
        );
    }

    #[test]
    fn build_alias_lines_multiline_input_does_not_create_multiple_alias_commands() {
        let aliases = vec![AgentAlias {
            id: "a1".into(),
            alias: "evil".into(),
            agent: "shell".into(),
            model: "".into(),
            extra: "echo first\necho second".into(),
            account: None,
        }];
        let lines = build_alias_lines(&aliases);
        assert!(
            lines.starts_with("alias evil='echo first echo second'"),
            "unexpected multiline alias output: {lines}"
        );
        assert_eq!(
            lines.lines().count(),
            1,
            "alias output spanned multiple lines: {lines}"
        );
    }

    #[test]
    fn build_alias_lines_ignores_account_field() {
        let aliases = vec![AgentAlias {
            id: "a1".into(),
            alias: "c".into(),
            agent: "claude".into(),
            model: "sonnet".into(),
            extra: "".into(),
            account: Some("work".into()),
        }];
        let lines = build_alias_lines(&aliases);
        assert_eq!(lines, "alias c='claude --model sonnet'\n");
    }
}
