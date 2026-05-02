use std::fmt::Write;

use crate::orchestrator::workflow::{GithubTrackerConfig, SecretValue, WorkflowDefinition};
use crate::orchestrator::OrchestratorIssue;
use serde::Deserialize;
use thiserror::Error;

const GITHUB_PER_PAGE: usize = 100;
const MAX_GITHUB_PAGES: u16 = 20;

pub trait TrackerClient {
    fn fetch_issues(&self) -> Result<Vec<OrchestratorIssue>, TrackerError>;
}

pub trait GithubHttpClient {
    fn get(&self, request: &GithubRequest) -> Result<String, TrackerError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubRequest {
    url: String,
    token: SecretValue,
}

impl GithubRequest {
    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn token(&self) -> &SecretValue {
        &self.token
    }
}

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum TrackerError {
    #[error("transient tracker error: {message}")]
    Transient { message: String },
    #[error("permanent tracker error: {message}")]
    Permanent { message: String },
}

#[derive(Debug, Clone)]
pub struct GithubIssuesTracker<C = UreqGithubHttpClient> {
    config: GithubTrackerConfig,
    token: SecretValue,
    client: C,
}

impl<C> GithubIssuesTracker<C> {
    pub fn new(config: GithubTrackerConfig, token: SecretValue, client: C) -> Self {
        Self {
            config,
            token,
            client,
        }
    }
}

impl GithubIssuesTracker<UreqGithubHttpClient> {
    pub fn from_workflow(workflow: &WorkflowDefinition) -> Self {
        Self::new(
            workflow.config.tracker.clone(),
            workflow.secrets.tracker_token.clone(),
            UreqGithubHttpClient,
        )
    }
}

impl<C> TrackerClient for GithubIssuesTracker<C>
where
    C: GithubHttpClient,
{
    fn fetch_issues(&self) -> Result<Vec<OrchestratorIssue>, TrackerError> {
        let mut normalized = Vec::new();

        for page in 1..=MAX_GITHUB_PAGES {
            let issues = self.fetch_issue_page(page)?;
            let page_len = issues.len();
            normalized.extend(
                issues
                    .into_iter()
                    .filter(|issue| issue.pull_request.is_none())
                    .filter(|issue| self.is_configured_state(&issue.state))
                    .map(|issue| self.normalize_issue(issue)),
            );

            if page_len < GITHUB_PER_PAGE {
                return Ok(normalized);
            }
        }

        Err(TrackerError::Transient {
            message: format!("GitHub issue pagination exceeded {MAX_GITHUB_PAGES} pages"),
        })
    }
}

impl<C> GithubIssuesTracker<C> {
    fn fetch_issue_page(&self, page: u16) -> Result<Vec<GithubApiIssue>, TrackerError>
    where
        C: GithubHttpClient,
    {
        let body = self.client.get(&GithubRequest {
            url: self.request_url(page),
            token: self.token.clone(),
        })?;
        serde_json::from_str(&body).map_err(|error| TrackerError::Permanent {
            message: format!("failed to parse GitHub issues response: {error}"),
        })
    }

    fn request_url(&self, page: u16) -> String {
        let owner = percent_encode(&self.config.owner);
        let repo = percent_encode(&self.config.repo);
        let mut url = format!(
            "https://api.github.com/repos/{owner}/{repo}/issues?state=all&per_page={GITHUB_PER_PAGE}&page={page}"
        );

        if !self.config.labels.is_empty() {
            let labels = percent_encode(&self.config.labels.join(","));
            url.push_str("&labels=");
            url.push_str(&labels);
        }

        url
    }

    fn is_configured_state(&self, state: &str) -> bool {
        self.config.active_states.iter().any(|value| value == state)
            || self
                .config
                .terminal_states
                .iter()
                .any(|value| value == state)
    }

    fn normalize_issue(&self, issue: GithubApiIssue) -> OrchestratorIssue {
        OrchestratorIssue {
            id: format!(
                "github:{}/{}#{}",
                self.config.owner, self.config.repo, issue.number
            ),
            identifier: format!("#{}", issue.number),
            title: issue.title,
            description: issue.body,
            state: issue.state,
            url: issue.html_url,
            labels: issue.labels.into_iter().map(|label| label.name).collect(),
            priority: None,
            updated_at: issue.updated_at,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct UreqGithubHttpClient;

impl GithubHttpClient for UreqGithubHttpClient {
    fn get(&self, request: &GithubRequest) -> Result<String, TrackerError> {
        let authorization = format!("Bearer {}", request.token.as_str());
        let response = ureq::get(request.url())
            .set("Accept", "application/vnd.github+json")
            .set("Authorization", &authorization)
            .set("X-GitHub-Api-Version", "2022-11-28")
            .set("User-Agent", "vimeflow-orchestrator")
            .call();

        match response {
            Ok(response) => response
                .into_string()
                .map_err(|error| TrackerError::Transient {
                    message: format!("failed to read GitHub response: {error}"),
                }),
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                Err(classify_http_status(status, &body))
            }
            Err(ureq::Error::Transport(error)) => Err(TrackerError::Transient {
                message: format!("GitHub request failed: {error}"),
            }),
        }
    }
}

#[derive(Debug, Deserialize)]
struct GithubApiIssue {
    number: u64,
    title: String,
    #[serde(default)]
    body: Option<String>,
    state: String,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    labels: Vec<GithubApiLabel>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    pull_request: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct GithubApiLabel {
    name: String,
}

fn classify_http_status(status: u16, body: &str) -> TrackerError {
    let message = github_status_message(status, body);
    if status == 408 || status == 429 || status >= 500 {
        TrackerError::Transient { message }
    } else {
        TrackerError::Permanent { message }
    }
}

fn github_status_message(status: u16, body: &str) -> String {
    let detail = body.lines().next().unwrap_or_default().trim();
    if detail.is_empty() {
        return format!("GitHub returned HTTP {status}");
    }

    let excerpt: String = detail.chars().take(160).collect();
    format!("GitHub returned HTTP {status}: {excerpt}")
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if is_unreserved(byte) {
            encoded.push(byte as char);
        } else {
            write!(&mut encoded, "%{byte:02X}").expect("writing to a string cannot fail");
        }
    }
    encoded
}

fn is_unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub struct FakeTracker {
    issues: Vec<OrchestratorIssue>,
    error: Option<TrackerError>,
}

#[cfg(test)]
impl FakeTracker {
    pub fn with_issues(issues: Vec<OrchestratorIssue>) -> Self {
        Self {
            issues,
            error: None,
        }
    }

    pub fn with_error(message: &str) -> Self {
        Self {
            issues: Vec::new(),
            error: Some(TrackerError::Transient {
                message: message.to_string(),
            }),
        }
    }
}

#[cfg(test)]
impl TrackerClient for FakeTracker {
    fn fetch_issues(&self) -> Result<Vec<OrchestratorIssue>, TrackerError> {
        if let Some(error) = &self.error {
            return Err(error.clone());
        }

        Ok(self.issues.clone())
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::fs;
    use std::rc::Rc;

    use tempfile::TempDir;

    use super::*;
    use crate::orchestrator::load_workflow_from_path_with_env;
    use crate::orchestrator::WorkflowDefinition;

    fn issue(id: &str, identifier: &str) -> OrchestratorIssue {
        OrchestratorIssue {
            id: id.to_string(),
            identifier: identifier.to_string(),
            title: format!("Issue {identifier}"),
            description: None,
            state: "open".to_string(),
            url: None,
            labels: Vec::new(),
            priority: None,
            updated_at: None,
        }
    }

    #[test]
    fn fake_tracker_returns_configured_issues() {
        let tracker = FakeTracker::with_issues(vec![issue("issue-108", "#108")]);

        let issues = tracker.fetch_issues().unwrap();

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].identifier, "#108");
    }

    #[test]
    fn fake_tracker_returns_configured_error() {
        let tracker = FakeTracker::with_error("tracker offline");

        let err = tracker.fetch_issues().unwrap_err();

        assert_eq!(
            err,
            TrackerError::Transient {
                message: "tracker offline".to_string(),
            }
        );
    }

    #[test]
    fn github_tracker_fetches_issues_and_skips_pull_requests() {
        let workflow = github_workflow();
        let http = RecordingGithubHttpClient::with_response(
            r##"[
              {
                "id": 9001,
                "number": 108,
                "title": "Feature: Add orchestration",
                "body": "Build the orchestrator",
                "state": "open",
                "html_url": "https://github.com/winoooops/vimeflow/issues/108",
                "labels": [{ "name": "agent-ready" }, { "name": "enhancement" }],
                "updated_at": "2026-05-02T07:00:00Z"
              },
              {
                "id": 9002,
                "number": 109,
                "title": "Closed follow-up",
                "body": null,
                "state": "closed",
                "html_url": "https://github.com/winoooops/vimeflow/issues/109",
                "labels": [],
                "updated_at": "2026-05-02T07:05:00Z"
              },
              {
                "id": 9003,
                "number": 110,
                "title": "Pull request, not an issue",
                "body": null,
                "state": "open",
                "html_url": "https://github.com/winoooops/vimeflow/pull/110",
                "labels": [],
                "updated_at": "2026-05-02T07:10:00Z",
                "pull_request": {}
              }
            ]"##,
        );
        let requests = http.requests();
        let tracker = GithubIssuesTracker::new(
            workflow.config.tracker,
            workflow.secrets.tracker_token,
            http,
        );

        let issues = tracker.fetch_issues().unwrap();

        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].id, "github:winoooops/vimeflow#108");
        assert_eq!(issues[0].identifier, "#108");
        assert_eq!(issues[0].title, "Feature: Add orchestration");
        assert_eq!(
            issues[0].description.as_deref(),
            Some("Build the orchestrator")
        );
        assert_eq!(issues[0].state, "open");
        assert_eq!(
            issues[0].url.as_deref(),
            Some("https://github.com/winoooops/vimeflow/issues/108")
        );
        assert_eq!(issues[0].labels, vec!["agent-ready", "enhancement"]);
        assert_eq!(
            issues[0].updated_at.as_deref(),
            Some("2026-05-02T07:00:00Z")
        );
        assert_eq!(issues[1].state, "closed");

        let request = requests.borrow();
        assert_eq!(request.len(), 1);
        assert_eq!(
            request[0].url,
            "https://api.github.com/repos/winoooops/vimeflow/issues?state=all&per_page=100&page=1&labels=agent-ready%2Cbug"
        );
        assert_eq!(request[0].token.as_str(), "secret-token");
        assert!(!format!("{:?}", request[0]).contains("secret-token"));
    }

    #[test]
    fn github_tracker_fetches_next_page_when_page_is_full() {
        let workflow = github_workflow();
        let first_page = format!(
            "[{}]",
            (1..=100)
                .map(|number| github_issue_json(number, "open"))
                .collect::<Vec<_>>()
                .join(",")
        );
        let second_page = format!("[{}]", github_issue_json(200, "open"));
        let http = RecordingGithubHttpClient::with_responses(vec![first_page, second_page]);
        let requests = http.requests();
        let tracker = GithubIssuesTracker::new(
            workflow.config.tracker,
            workflow.secrets.tracker_token,
            http,
        );

        let issues = tracker.fetch_issues().unwrap();

        assert_eq!(issues.len(), 101);
        assert_eq!(issues[100].identifier, "#200");
        let request = requests.borrow();
        assert_eq!(request.len(), 2);
        assert!(request[0].url.contains("page=1"));
        assert!(request[1].url.contains("page=2"));
    }

    #[test]
    fn github_tracker_filters_states_outside_workflow_config() {
        let workflow = github_workflow();
        let http = RecordingGithubHttpClient::with_response(
            r##"[
              {
                "id": 9004,
                "number": 111,
                "title": "Unsupported state",
                "body": null,
                "state": "draft",
                "html_url": "https://github.com/winoooops/vimeflow/issues/111",
                "labels": [],
                "updated_at": "2026-05-02T07:15:00Z"
              }
            ]"##,
        );
        let tracker = GithubIssuesTracker::new(
            workflow.config.tracker,
            workflow.secrets.tracker_token,
            http,
        );

        let issues = tracker.fetch_issues().unwrap();

        assert!(issues.is_empty());
    }

    #[test]
    fn github_tracker_rejects_invalid_response_json() {
        let workflow = github_workflow();
        let tracker = GithubIssuesTracker::new(
            workflow.config.tracker,
            workflow.secrets.tracker_token,
            RecordingGithubHttpClient::with_response("not json"),
        );

        let error = tracker.fetch_issues().unwrap_err();

        assert!(matches!(error, TrackerError::Permanent { .. }));
        assert!(error.to_string().contains("failed to parse GitHub issues"));
    }

    #[test]
    fn github_http_status_errors_are_classified() {
        assert!(matches!(
            classify_http_status(401, "bad credentials"),
            TrackerError::Permanent { .. }
        ));
        assert!(matches!(
            classify_http_status(404, "missing repo"),
            TrackerError::Permanent { .. }
        ));
        assert!(matches!(
            classify_http_status(500, "server down"),
            TrackerError::Transient { .. }
        ));
    }

    #[derive(Debug, Clone)]
    struct RecordingGithubHttpClient {
        responses: Rc<RefCell<Vec<Result<String, TrackerError>>>>,
        requests: Rc<RefCell<Vec<GithubRequest>>>,
    }

    impl RecordingGithubHttpClient {
        fn with_response(response: &str) -> Self {
            Self::with_responses(vec![response.to_string()])
        }

        fn with_responses(responses: Vec<String>) -> Self {
            Self {
                responses: Rc::new(RefCell::new(responses.into_iter().map(Ok).collect())),
                requests: Rc::new(RefCell::new(Vec::new())),
            }
        }

        fn requests(&self) -> Rc<RefCell<Vec<GithubRequest>>> {
            Rc::clone(&self.requests)
        }
    }

    impl GithubHttpClient for RecordingGithubHttpClient {
        fn get(&self, request: &GithubRequest) -> Result<String, TrackerError> {
            self.requests.borrow_mut().push(request.clone());
            self.responses.borrow_mut().remove(0)
        }
    }

    fn github_issue_json(number: u64, state: &str) -> String {
        format!(
            r#"{{
              "id": {number},
              "number": {number},
              "title": "Issue {number}",
              "body": null,
              "state": "{state}",
              "html_url": "https://github.com/winoooops/vimeflow/issues/{number}",
              "labels": [],
              "updated_at": "2026-05-02T07:15:00Z"
            }}"#
        )
    }

    fn github_workflow() -> WorkflowDefinition {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("WORKFLOW.md");
        fs::write(
            &path,
            r#"---
tracker:
  kind: github_issues
  owner: winoooops
  repo: vimeflow
  token: $GITHUB_TOKEN
  labels:
    - agent-ready
    - bug
  active_states:
    - open
  terminal_states:
    - closed
agent:
  command: codex
---
Fix {{ issue.identifier }}.
"#,
        )
        .unwrap();

        load_workflow_from_path_with_env(&path, |name| {
            (name == "GITHUB_TOKEN").then_some("secret-token".to_string())
        })
        .unwrap()
    }
}
