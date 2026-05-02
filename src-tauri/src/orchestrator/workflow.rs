use std::fmt;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const DEFAULT_POLL_INTERVAL_MS: u64 = 30_000;
const DEFAULT_MAX_CONCURRENT: u8 = 1;
const MAX_CONCURRENT_LIMIT: u8 = 4;
const DEFAULT_MAX_ATTEMPTS: u8 = 3;
const DEFAULT_MAX_RETRY_BACKOFF_MS: u64 = 300_000;
const DEFAULT_AGENT_TIMEOUT_MS: u64 = 3_600_000;
const DEFAULT_WORKSPACE_BASE_REF: &str = "main";
const DEFAULT_WORKSPACE_BRANCH_PREFIX: &str = "agent";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
    pub path: PathBuf,
    pub config: WorkflowConfig,
    pub prompt_template: String,
    #[serde(skip)]
    pub secrets: WorkflowSecrets,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowConfig {
    pub tracker: GithubTrackerConfig,
    pub polling: PollingConfig,
    pub agent: AgentConfig,
    pub workspace: WorkspaceConfig,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubTrackerConfig {
    pub kind: String,
    pub owner: String,
    pub repo: String,
    pub token_env: String,
    pub labels: Vec<String>,
    pub active_states: Vec<String>,
    pub terminal_states: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PollingConfig {
    pub interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub command: String,
    pub args: Vec<String>,
    pub max_concurrent: u8,
    pub max_attempts: u8,
    pub max_retry_backoff_ms: u64,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    pub root: Option<PathBuf>,
    pub base_ref: String,
    pub branch_prefix: String,
}

#[derive(Clone, PartialEq, Eq)]
pub struct WorkflowSecrets {
    pub tracker_token: SecretValue,
}

impl fmt::Debug for WorkflowSecrets {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowSecrets")
            .field("tracker_token", &self.tracker_token)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct SecretValue(String);

impl SecretValue {
    fn new(value: String) -> Self {
        Self(value)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[cfg(test)]
    fn expose_for_tests(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Debug for SecretValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretValue([redacted])")
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub url: Option<String>,
    pub labels: Vec<String>,
    pub priority: Option<i64>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptTemplateContext {
    pub issue: OrchestratorIssue,
    pub attempt: AttemptTemplateContext,
    pub workspace: WorkspaceTemplateContext,
    pub prompt_file: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttemptTemplateContext {
    pub number: u32,
    pub previous_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceTemplateContext {
    pub path: PathBuf,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WorkflowError {
    #[error("failed to read workflow file: {0}")]
    Read(String),
    #[error("WORKFLOW.md must start with YAML front matter delimited by ---")]
    MissingFrontMatter,
    #[error("failed to parse workflow front matter: {0}")]
    InvalidFrontMatter(String),
    #[error("missing required workflow field: {0}")]
    MissingField(&'static str),
    #[error("unsupported tracker kind: {0}")]
    UnsupportedTrackerKind(String),
    #[error("invalid workflow value: {0}")]
    InvalidValue(String),
    #[error("missing environment variable for workflow secret: {0}")]
    MissingEnv(String),
    #[error("unknown template variable: {0}")]
    UnknownTemplateVariable(String),
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawWorkflowFrontMatter {
    tracker: Option<RawTrackerConfig>,
    polling: RawPollingConfig,
    agent: Option<RawAgentConfig>,
    workspace: RawWorkspaceConfig,
}

#[derive(Debug, Deserialize)]
struct RawTrackerConfig {
    kind: Option<String>,
    owner: Option<String>,
    repo: Option<String>,
    token: Option<String>,
    labels: Option<Vec<String>>,
    active_states: Option<Vec<String>>,
    terminal_states: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Default)]
struct RawPollingConfig {
    interval_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RawAgentConfig {
    command: Option<String>,
    args: Option<Vec<String>>,
    max_concurrent: Option<u8>,
    max_attempts: Option<u8>,
    max_retry_backoff_ms: Option<u64>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize, Default)]
struct RawWorkspaceConfig {
    root: Option<String>,
    base_ref: Option<String>,
    branch_prefix: Option<String>,
}

pub fn load_workflow_from_path_with_env<F>(
    path: &Path,
    env_lookup: F,
) -> Result<WorkflowDefinition, WorkflowError>
where
    F: Fn(&str) -> Option<String>,
{
    let content =
        std::fs::read_to_string(path).map_err(|error| WorkflowError::Read(error.to_string()))?;
    let (front_matter, prompt_template) = parse_workflow_markdown(&content)?;
    let raw: RawWorkflowFrontMatter = serde_yml::from_str(&front_matter)
        .map_err(|error| WorkflowError::InvalidFrontMatter(error.to_string()))?;
    let (config, secrets) = validate_config(raw, &env_lookup)?;

    Ok(WorkflowDefinition {
        path: path.to_path_buf(),
        config,
        prompt_template,
        secrets,
    })
}

pub fn load_workflow_from_path(path: &Path) -> Result<WorkflowDefinition, WorkflowError> {
    load_workflow_from_path_with_env(path, |name| std::env::var(name).ok())
}

pub fn render_prompt(
    template: &str,
    context: &PromptTemplateContext,
) -> Result<String, WorkflowError> {
    let variable_pattern =
        Regex::new(r"\{\{\s*([^}]+?)\s*\}\}").expect("template variable regex must compile");
    let mut rendered = String::new();
    let mut last_index = 0;

    for captures in variable_pattern.captures_iter(template) {
        let token = captures.get(0).expect("capture 0 exists");
        let name = captures.get(1).expect("capture 1 exists").as_str().trim();

        rendered.push_str(&template[last_index..token.start()]);
        rendered.push_str(&resolve_template_variable(name, context)?);
        last_index = token.end();
    }

    rendered.push_str(&template[last_index..]);
    Ok(rendered)
}

fn parse_workflow_markdown(content: &str) -> Result<(String, String), WorkflowError> {
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return Err(WorkflowError::MissingFrontMatter);
    }

    let mut front_matter = Vec::new();
    let mut body = Vec::new();
    let mut found_end = false;

    for line in lines {
        if !found_end && line.trim() == "---" {
            found_end = true;
            continue;
        }

        if found_end {
            body.push(line);
        } else {
            front_matter.push(line);
        }
    }

    if !found_end {
        return Err(WorkflowError::MissingFrontMatter);
    }

    let prompt_template = body
        .join("\n")
        .trim_start_matches(|value| value == '\n' || value == '\r')
        .to_string();

    Ok((front_matter.join("\n"), prompt_template))
}

fn validate_config<F>(
    raw: RawWorkflowFrontMatter,
    env_lookup: &F,
) -> Result<(WorkflowConfig, WorkflowSecrets), WorkflowError>
where
    F: Fn(&str) -> Option<String>,
{
    let raw_tracker = raw.tracker.ok_or(WorkflowError::MissingField("tracker"))?;
    let tracker_kind = required_non_empty(raw_tracker.kind, "tracker.kind")?;

    if tracker_kind != "github_issues" {
        return Err(WorkflowError::UnsupportedTrackerKind(tracker_kind));
    }

    let token_value = required_non_empty(raw_tracker.token, "tracker.token")?;
    let token_env = parse_env_reference(&token_value, "tracker.token")?;
    let tracker_token = env_lookup(&token_env)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| WorkflowError::MissingEnv(token_env.clone()))?;

    let tracker = GithubTrackerConfig {
        kind: tracker_kind,
        owner: required_non_empty(raw_tracker.owner, "tracker.owner")?,
        repo: required_non_empty(raw_tracker.repo, "tracker.repo")?,
        token_env,
        labels: cleaned_list(raw_tracker.labels.unwrap_or_default()),
        active_states: non_empty_list(raw_tracker.active_states, vec!["open".to_string()]),
        terminal_states: non_empty_list(raw_tracker.terminal_states, vec!["closed".to_string()]),
    };

    let raw_agent = raw.agent.ok_or(WorkflowError::MissingField("agent"))?;
    let max_concurrent = raw_agent.max_concurrent.unwrap_or(DEFAULT_MAX_CONCURRENT);
    if !(1..=MAX_CONCURRENT_LIMIT).contains(&max_concurrent) {
        return Err(WorkflowError::InvalidValue(format!(
            "agent.max_concurrent must be between 1 and {MAX_CONCURRENT_LIMIT}"
        )));
    }

    let max_attempts = raw_agent.max_attempts.unwrap_or(DEFAULT_MAX_ATTEMPTS);
    if max_attempts == 0 {
        return Err(WorkflowError::InvalidValue(
            "agent.max_attempts must be at least 1".to_string(),
        ));
    }

    let polling_interval = raw.polling.interval_ms.unwrap_or(DEFAULT_POLL_INTERVAL_MS);
    if polling_interval == 0 {
        return Err(WorkflowError::InvalidValue(
            "polling.interval_ms must be at least 1".to_string(),
        ));
    }

    let workspace_root = match raw.workspace.root {
        Some(value) => Some(resolve_workspace_root(&value, env_lookup)?),
        None => None,
    };

    let config = WorkflowConfig {
        tracker,
        polling: PollingConfig {
            interval_ms: polling_interval,
        },
        agent: AgentConfig {
            command: required_non_empty(raw_agent.command, "agent.command")?,
            args: raw_agent.args.unwrap_or_default(),
            max_concurrent,
            max_attempts,
            max_retry_backoff_ms: raw_agent
                .max_retry_backoff_ms
                .unwrap_or(DEFAULT_MAX_RETRY_BACKOFF_MS),
            timeout_ms: raw_agent.timeout_ms.unwrap_or(DEFAULT_AGENT_TIMEOUT_MS),
        },
        workspace: WorkspaceConfig {
            root: workspace_root,
            base_ref: raw
                .workspace
                .base_ref
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_WORKSPACE_BASE_REF.to_string()),
            branch_prefix: raw
                .workspace
                .branch_prefix
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_WORKSPACE_BRANCH_PREFIX.to_string()),
        },
    };

    let secrets = WorkflowSecrets {
        tracker_token: SecretValue::new(tracker_token),
    };

    Ok((config, secrets))
}

fn resolve_workspace_root<F>(value: &str, env_lookup: &F) -> Result<PathBuf, WorkflowError>
where
    F: Fn(&str) -> Option<String>,
{
    let raw_path = if value.trim_start().starts_with('$') {
        let env_name = parse_env_reference(value, "workspace.root")?;
        env_lookup(&env_name)
            .filter(|resolved| !resolved.trim().is_empty())
            .ok_or(WorkflowError::MissingEnv(env_name))?
    } else {
        value.to_string()
    };
    let path = PathBuf::from(raw_path);

    if !path.is_absolute() {
        return Err(WorkflowError::InvalidValue(
            "workspace.root must resolve to an absolute path".to_string(),
        ));
    }

    path.canonicalize().map_err(|error| {
        WorkflowError::InvalidValue(format!(
            "workspace.root must be an existing directory: {error}"
        ))
    })
}

fn resolve_template_variable(
    name: &str,
    context: &PromptTemplateContext,
) -> Result<String, WorkflowError> {
    let value = match name {
        "issue.id" => context.issue.id.clone(),
        "issue.identifier" => context.issue.identifier.clone(),
        "issue.title" => context.issue.title.clone(),
        "issue.description" => context.issue.description.clone().unwrap_or_default(),
        "issue.state" => context.issue.state.clone(),
        "issue.url" => context.issue.url.clone().unwrap_or_default(),
        "issue.labels" => context.issue.labels.join(", "),
        "issue.priority" => context
            .issue
            .priority
            .map(|priority| priority.to_string())
            .unwrap_or_default(),
        "issue.updated_at" => context.issue.updated_at.clone().unwrap_or_default(),
        "attempt.number" => context.attempt.number.to_string(),
        "attempt.previous_error" => context.attempt.previous_error.clone().unwrap_or_default(),
        "workspace.path" => context.workspace.path.display().to_string(),
        "prompt_file" => context.prompt_file.display().to_string(),
        _ => return Err(WorkflowError::UnknownTemplateVariable(name.to_string())),
    };

    Ok(value)
}

fn required_non_empty(value: Option<String>, field: &'static str) -> Result<String, WorkflowError> {
    non_empty(value.unwrap_or_default(), field)
}

fn non_empty(value: String, field: &'static str) -> Result<String, WorkflowError> {
    let trimmed = value.trim().to_string();

    if trimmed.is_empty() {
        Err(WorkflowError::MissingField(field))
    } else {
        Ok(trimmed)
    }
}

fn cleaned_list(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .filter_map(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect()
}

fn non_empty_list(values: Option<Vec<String>>, fallback: Vec<String>) -> Vec<String> {
    let cleaned = cleaned_list(values.unwrap_or_default());
    if cleaned.is_empty() {
        fallback
    } else {
        cleaned
    }
}

fn parse_env_reference(value: &str, field: &'static str) -> Result<String, WorkflowError> {
    let trimmed = value.trim();
    let name = if let Some(rest) = trimmed.strip_prefix("${") {
        rest.strip_suffix('}').unwrap_or_default()
    } else if let Some(rest) = trimmed.strip_prefix('$') {
        rest
    } else {
        return Err(WorkflowError::InvalidValue(format!(
            "{field} must use $ENV_VAR indirection"
        )));
    };

    if !is_valid_env_name(name) {
        return Err(WorkflowError::InvalidValue(format!(
            "{field} must reference a valid environment variable"
        )));
    }

    Ok(name.to_string())
}

fn is_valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };

    if !(first == '_' || first.is_ascii_alphabetic()) {
        return false;
    }

    chars.all(|value| value == '_' || value.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn write_workflow(markdown: &str) -> (TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("WORKFLOW.md");
        fs::write(&path, markdown).unwrap();
        (dir, path)
    }

    fn env_lookup(values: HashMap<&str, &str>) -> impl Fn(&str) -> Option<String> + 'static {
        let values: HashMap<String, String> = values
            .into_iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();

        move |name| values.get(name).map(|value| value.to_string())
    }

    #[test]
    fn loads_github_workflow_with_defaults_and_secret_env() {
        let workspace_root = tempfile::tempdir().unwrap();
        let markdown = r#"---
tracker:
  kind: github_issues
  owner: winoooops
  repo: vimeflow
  token: $GITHUB_TOKEN
agent:
  command: codex
workspace:
  root: $WORKSPACE_ROOT
---

Fix {{ issue.identifier }} in {{ workspace.path }}.
"#;
        let (_dir, path) = write_workflow(&markdown);

        let workflow = load_workflow_from_path_with_env(
            &path,
            env_lookup(HashMap::from([
                ("GITHUB_TOKEN", "resolved-token"),
                ("WORKSPACE_ROOT", workspace_root.path().to_str().unwrap()),
            ])),
        )
        .unwrap();

        assert_eq!(workflow.config.tracker.kind, "github_issues");
        assert_eq!(workflow.config.tracker.owner, "winoooops");
        assert_eq!(workflow.config.tracker.repo, "vimeflow");
        assert_eq!(workflow.config.tracker.token_env, "GITHUB_TOKEN");
        assert_eq!(
            workflow.secrets.tracker_token.expose_for_tests(),
            "resolved-token"
        );
        assert_eq!(workflow.config.tracker.active_states, vec!["open"]);
        assert_eq!(workflow.config.tracker.terminal_states, vec!["closed"]);
        assert_eq!(workflow.config.polling.interval_ms, 30_000);
        assert_eq!(workflow.config.agent.max_concurrent, 1);
        assert_eq!(workflow.config.agent.max_attempts, 3);
        assert_eq!(workflow.config.agent.command, "codex");
        assert!(workflow.config.workspace.root.unwrap().is_absolute());
        assert_eq!(
            workflow.prompt_template.trim(),
            "Fix {{ issue.identifier }} in {{ workspace.path }}."
        );
    }

    #[test]
    fn rejects_literal_tracker_token() {
        let (_dir, path) = write_workflow(
            r#"---
tracker:
  kind: github_issues
  owner: winoooops
  repo: vimeflow
  token: plain
agent:
  command: codex
---

Prompt
"#,
        );

        let err = load_workflow_from_path_with_env(&path, |_| None).unwrap_err();

        assert!(err.to_string().contains("tracker.token must use $ENV_VAR"));
    }

    #[test]
    fn rejects_missing_secret_env_value() {
        let (_dir, path) = write_workflow(
            r#"---
tracker:
  kind: github_issues
  owner: winoooops
  repo: vimeflow
  token: $MISSING_TOKEN
agent:
  command: codex
---

Prompt
"#,
        );

        let err = load_workflow_from_path_with_env(&path, |_| None).unwrap_err();

        assert!(err.to_string().contains("MISSING_TOKEN"));
    }

    #[test]
    fn rejects_unsupported_tracker_kind_and_empty_agent_command() {
        let (_dir, path) = write_workflow(
            r#"---
tracker:
  kind: linear
agent:
  command: ''
---

Prompt
"#,
        );

        let err = load_workflow_from_path_with_env(&path, |_| None).unwrap_err();

        assert!(err.to_string().contains("unsupported tracker kind"));
    }

    #[test]
    fn rejects_empty_agent_command_for_valid_tracker() {
        let (_dir, path) = write_workflow(
            r#"---
tracker:
  kind: github_issues
  owner: winoooops
  repo: vimeflow
  token: $GITHUB_TOKEN
agent:
  command: ''
---

Prompt
"#,
        );

        let err = load_workflow_from_path_with_env(
            &path,
            env_lookup(HashMap::from([("GITHUB_TOKEN", "resolved-token")])),
        )
        .unwrap_err();

        assert!(err.to_string().contains("agent.command"));
    }

    #[test]
    fn rejects_missing_front_matter() {
        let (_dir, path) = write_workflow("Prompt only");

        let err = load_workflow_from_path_with_env(&path, |_| None).unwrap_err();

        assert_eq!(err, WorkflowError::MissingFrontMatter);
    }

    #[test]
    fn rejects_max_concurrency_above_limit() {
        let (_dir, path) = write_workflow(
            r#"---
tracker:
  kind: github_issues
  owner: winoooops
  repo: vimeflow
  token: $GITHUB_TOKEN
agent:
  command: codex
  max_concurrent: 5
---

Prompt
"#,
        );

        let err = load_workflow_from_path_with_env(
            &path,
            env_lookup(HashMap::from([("GITHUB_TOKEN", "resolved-token")])),
        )
        .unwrap_err();

        assert!(err.to_string().contains("max_concurrent"));
    }

    #[test]
    fn renders_known_prompt_variables() {
        let issue = OrchestratorIssue {
            id: "I_kw123".to_string(),
            identifier: "#108".to_string(),
            title: "Add orchestration".to_string(),
            description: Some("Build the queue".to_string()),
            state: "open".to_string(),
            url: Some("https://github.com/winoooops/vimeflow/issues/108".to_string()),
            labels: vec!["enhancement".to_string(), "agent-ready".to_string()],
            priority: Some(2),
            updated_at: Some("2026-05-02T00:00:00Z".to_string()),
        };
        let context = PromptTemplateContext {
            issue,
            attempt: AttemptTemplateContext {
                number: 2,
                previous_error: Some("previous failure".to_string()),
            },
            workspace: WorkspaceTemplateContext {
                path: "/tmp/workspace".into(),
            },
            prompt_file: "/tmp/workspace/.vimeflow/orchestrator/prompt.md".into(),
        };

        let template = [
            "Issue {{ issue.identifier }}: {{ issue.title }}",
            "Labels: {{ issue.labels }}",
            "Attempt {{ attempt.number }} after {{ attempt.previous_error }}",
            "Prompt: {{ prompt_file }}",
            "Workspace: {{ workspace.path }}",
        ]
        .join("\n");
        let rendered = render_prompt(&template, &context).unwrap();

        assert!(rendered.contains("Issue #108: Add orchestration"));
        assert!(rendered.contains("Labels: enhancement, agent-ready"));
        assert!(rendered.contains("Attempt 2 after previous failure"));
        assert!(rendered.contains("Prompt: /tmp/workspace/.vimeflow/orchestrator/prompt.md"));
        assert!(rendered.contains("Workspace: /tmp/workspace"));
    }

    #[test]
    fn rejects_unknown_prompt_variables() {
        let context = PromptTemplateContext {
            issue: OrchestratorIssue {
                id: "1".to_string(),
                identifier: "#1".to_string(),
                title: "Title".to_string(),
                description: None,
                state: "open".to_string(),
                url: None,
                labels: Vec::new(),
                priority: None,
                updated_at: None,
            },
            attempt: AttemptTemplateContext {
                number: 1,
                previous_error: None,
            },
            workspace: WorkspaceTemplateContext {
                path: "/tmp/workspace".into(),
            },
            prompt_file: "/tmp/workspace/prompt.md".into(),
        };

        let err = render_prompt("Unknown {{ issue.not_real }}", &context).unwrap_err();

        assert!(err.to_string().contains("unknown template variable"));
    }
}
