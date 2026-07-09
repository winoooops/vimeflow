use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

const SYSTEM_FONT_ENUMERATION_TIMEOUT: Duration = Duration::from_secs(2);
const SYSTEM_FONT_COMMAND_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct SystemFont {
    pub family: String,
}

pub async fn list_system_fonts() -> Vec<SystemFont> {
    tokio::time::timeout(
        SYSTEM_FONT_ENUMERATION_TIMEOUT,
        list_system_monospace_font_families(),
    )
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|family| SystemFont { family })
    .collect()
}

async fn list_system_monospace_font_families() -> Vec<String> {
    let candidates = if cfg!(target_os = "macos") {
        list_macos_monospace_font_families().await
    } else if cfg!(target_os = "windows") {
        list_windows_font_families()
            .await
            .into_iter()
            .filter(|family| looks_like_monospace_family(family))
            .collect()
    } else {
        list_fontconfig_families().await
    };

    unique_sorted_families(candidates)
}

async fn list_fontconfig_families() -> Vec<String> {
    command_stdout("fc-list", &[":spacing=100", "family"])
        .await
        .map(|stdout| parse_fontconfig_families(&stdout))
        .unwrap_or_default()
}

async fn list_macos_monospace_font_families() -> Vec<String> {
    if let Some(stdout) = command_stdout("fc-list", &[":spacing=100", "family"]).await {
        let families = parse_fontconfig_families(&stdout);
        if !families.is_empty() {
            return families;
        }
    }

    command_stdout("system_profiler", &["SPFontsDataType", "-json"])
        .await
        .and_then(|stdout| serde_json::from_str::<Value>(&stdout).ok())
        .map(|value| parse_system_profiler_families(&value))
        .map(|families| {
            families
                .into_iter()
                .filter(|family| looks_like_monospace_family(family))
                .collect()
        })
        .unwrap_or_default()
}

async fn list_windows_font_families() -> Vec<String> {
    command_stdout(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts' -ErrorAction SilentlyContinue | ForEach-Object { $_.PSObject.Properties | ForEach-Object { $_.Name } }",
        ],
    )
    .await
    .map(|stdout| parse_windows_registry_fonts(&stdout))
    .unwrap_or_default()
}

async fn command_stdout(program: &str, args: &[&str]) -> Option<String> {
    let child = Command::new(program)
        .kill_on_drop(true)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    let output =
        match tokio::time::timeout(SYSTEM_FONT_COMMAND_TIMEOUT, child.wait_with_output()).await {
            Ok(Ok(output)) => output,
            Ok(Err(_)) => return None,
            Err(_) => return None,
        };

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout).ok()
}

fn parse_fontconfig_families(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .flat_map(|line| line.split(':').next().unwrap_or(line).split(','))
        .filter_map(normalize_family_name)
        .collect()
}

fn parse_windows_registry_fonts(stdout: &str) -> Vec<String> {
    stdout.lines().filter_map(normalize_family_name).collect()
}

fn parse_system_profiler_families(value: &Value) -> Vec<String> {
    let mut families = Vec::new();
    collect_system_profiler_families(value, &mut families);
    families
}

fn collect_system_profiler_families(value: &Value, families: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, nested) in map {
                if matches!(key.as_str(), "family" | "_name") {
                    if let Some(family) = nested.as_str().and_then(normalize_family_name) {
                        families.push(family);
                    }
                }
                collect_system_profiler_families(nested, families);
            }
        }
        Value::Array(values) => {
            for nested in values {
                collect_system_profiler_families(nested, families);
            }
        }
        _ => {}
    }
}

fn normalize_family_name(value: &str) -> Option<String> {
    let mut name = value.trim().trim_matches('"').trim().to_string();

    loop {
        let mut changed = false;

        for suffix in [
            " (TrueType)",
            " (OpenType)",
            " Regular",
            " Bold Italic",
            " Bold",
            " Italic",
            " Medium",
            " Light",
            " Thin",
            " Black",
        ] {
            if name.ends_with(suffix) {
                name.truncate(name.len() - suffix.len());
                name = name.trim().to_string();
                changed = true;
                break;
            }
        }

        if !changed {
            break;
        }
    }

    if name.is_empty() || name.starts_with('.') {
        return None;
    }

    Some(name.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn looks_like_monospace_family(family: &str) -> bool {
    let lower = family.to_lowercase();

    if lower.contains("emoji") || lower.contains("symbol") {
        return false;
    }

    [
        "mono",
        "code",
        "console",
        "consolas",
        "courier",
        "menlo",
        "monaco",
        "iosevka",
        "hack",
        "fira code",
        "fira mono",
        "firacode",
        "cascadia",
        "inconsolata",
        "source code",
        "anonymous pro",
        "commitmono",
        "monaspace",
        "0xproto",
        "berkeley",
        "operator",
        "cartograph",
        "input mono",
        "victor",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn unique_sorted_families(families: Vec<String>) -> Vec<String> {
    let mut by_key = BTreeMap::new();

    for family in families {
        let key = family.to_lowercase();
        by_key.entry(key).or_insert(family);
    }

    by_key.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_fontconfig_families_splits_and_normalizes_candidates() {
        let families = parse_fontconfig_families(
            "JetBrains Mono,JetBrainsMono Nerd Font:style=Regular\nMenlo\n",
        );

        assert_eq!(
            families,
            vec![
                "JetBrains Mono".to_string(),
                "JetBrainsMono Nerd Font".to_string(),
                "Menlo".to_string()
            ]
        );
    }

    #[test]
    fn parse_windows_registry_fonts_strips_font_suffixes() {
        let families =
            parse_windows_registry_fonts("Cascadia Mono (TrueType)\nCourier New Bold (OpenType)\n");

        assert_eq!(
            families,
            vec!["Cascadia Mono".to_string(), "Courier New".to_string()]
        );
    }

    #[test]
    fn parse_system_profiler_families_collects_nested_family_names() {
        let value = serde_json::json!({
            "SPFontsDataType": [
                {
                    "_name": "Menlo",
                    "typefaces": [
                        { "family": "Menlo", "style": "Regular" },
                        { "family": "JetBrains Mono", "style": "Regular" }
                    ]
                }
            ]
        });

        assert_eq!(
            parse_system_profiler_families(&value),
            vec![
                "Menlo".to_string(),
                "Menlo".to_string(),
                "JetBrains Mono".to_string()
            ]
        );
    }

    #[test]
    fn list_system_fonts_filters_to_text_monospace_families() {
        let fonts = unique_sorted_families(vec![
            "Arial".to_string(),
            "Menlo".to_string(),
            "Symbols Nerd Font Mono".to_string(),
            "Fira Sans".to_string(),
            "Input Sans".to_string(),
            "Input Serif".to_string(),
            "Iosevka".to_string(),
            "menlo".to_string(),
        ])
        .into_iter()
        .filter(|family| looks_like_monospace_family(family))
        .collect::<Vec<_>>();

        assert_eq!(fonts, vec!["Iosevka".to_string(), "Menlo".to_string()]);
    }

    #[test]
    fn fontconfig_families_are_trusted_as_monospace_candidates() {
        let fonts = unique_sorted_families(parse_fontconfig_families(
            "Terminus:style=Regular\nNimbus Mono PS:style=Regular\n",
        ));

        assert_eq!(
            fonts,
            vec!["Nimbus Mono PS".to_string(), "Terminus".to_string()]
        );
    }

    #[test]
    fn monospace_heuristic_keeps_explicit_fira_and_input_mono_variants() {
        for family in ["Fira Code", "Fira Mono", "FiraCode Nerd Font", "Input Mono"] {
            assert!(looks_like_monospace_family(family));
        }
    }

    #[test]
    fn monospace_heuristic_rejects_proportional_fira_and_input_variants() {
        for family in [
            "Fira Sans",
            "Fira Sans Condensed",
            "Input Sans",
            "Input Serif",
        ] {
            assert!(!looks_like_monospace_family(family));
        }
    }
}
