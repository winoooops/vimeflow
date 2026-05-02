use crate::orchestrator::OrchestratorIssue;
use thiserror::Error;

pub trait TrackerClient {
    fn fetch_issues(&self) -> Result<Vec<OrchestratorIssue>, TrackerError>;
}

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum TrackerError {
    #[error("transient tracker error: {message}")]
    Transient { message: String },
    #[error("permanent tracker error: {message}")]
    Permanent { message: String },
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
    use super::*;

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
}
