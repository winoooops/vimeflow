use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use thiserror::Error;

use crate::orchestrator::{OrchestratorIssue, WorkflowDefinition};

const DEFAULT_WORKSPACE_ROOT: &[&str] = &[".vimeflow", "orchestrator", "workspaces"];
const PROMPT_DIR: &[&str] = &[".vimeflow", "orchestrator"];
const PROMPT_FILE_NAME: &str = "prompt.md";
const DEFAULT_BRANCH_PREFIX: &str = "agent";
const MAX_WORKSPACE_SLUG_LEN: usize = 96;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePlan {
    pub issue_id: String,
    pub issue_identifier: String,
    pub workspace_slug: String,
    pub path: PathBuf,
    pub base_ref: String,
    pub branch_name: String,
    pub prompt_file: PathBuf,
}

#[derive(Debug, Clone)]
pub struct WorkspaceManager {
    root: PathBuf,
    base_ref: String,
    branch_prefix: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WorkspaceError {
    #[error("workflow path has no parent directory")]
    MissingWorkflowParent,
    #[error("invalid workspace config: {0}")]
    InvalidConfig(String),
    #[error("failed to create workspace directory: {0}")]
    Create(String),
    #[error("workspace path escapes root: {path} is outside {root}")]
    PathEscape { path: PathBuf, root: PathBuf },
}

impl WorkspaceManager {
    pub fn new(
        root: impl AsRef<Path>,
        base_ref: impl AsRef<str>,
        branch_prefix: impl AsRef<str>,
    ) -> Result<Self, WorkspaceError> {
        let root = root.as_ref();
        let base_ref = base_ref.as_ref().trim();
        if base_ref.is_empty() {
            return Err(WorkspaceError::InvalidConfig(
                "workspace base_ref must not be empty".to_string(),
            ));
        }

        validate_root(root)?;
        fs::create_dir_all(root)
            .map_err(|error| WorkspaceError::Create(format!("{}: {error}", root.display())))?;
        let root = root.canonicalize().map_err(|error| {
            WorkspaceError::InvalidConfig(format!(
                "workspace root must be canonicalizable: {error}"
            ))
        })?;
        if !root.is_dir() {
            return Err(WorkspaceError::InvalidConfig(format!(
                "workspace root must be a directory: {}",
                root.display()
            )));
        }

        Ok(Self {
            root,
            base_ref: base_ref.to_string(),
            branch_prefix: sanitize_branch_prefix(branch_prefix.as_ref()),
        })
    }

    pub fn from_workflow(workflow: &WorkflowDefinition) -> Result<Self, WorkspaceError> {
        let root = match &workflow.config.workspace.root {
            Some(root) => root.clone(),
            None => workflow_default_root(workflow)?,
        };

        Self::new(
            root,
            &workflow.config.workspace.base_ref,
            &workflow.config.workspace.branch_prefix,
        )
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn plan_for_issue(
        &self,
        issue: &OrchestratorIssue,
    ) -> Result<WorkspacePlan, WorkspaceError> {
        let workspace_slug = workspace_slug(issue);
        let path = self.root.join(&workspace_slug);
        ensure_no_parent_refs(&path)?;
        ensure_within_root(&path, &self.root)?;

        let prompt_file = PROMPT_DIR
            .iter()
            .fold(path.clone(), |parent, segment| parent.join(segment))
            .join(PROMPT_FILE_NAME);
        ensure_no_parent_refs(&prompt_file)?;
        ensure_within_root(&prompt_file, &path)?;

        Ok(WorkspacePlan {
            issue_id: issue.id.clone(),
            issue_identifier: issue.identifier.clone(),
            workspace_slug: workspace_slug.clone(),
            path,
            base_ref: self.base_ref.clone(),
            branch_name: format!("{}/{}", self.branch_prefix, workspace_slug),
            prompt_file,
        })
    }

    pub fn prepare_workspace(
        &self,
        issue: &OrchestratorIssue,
    ) -> Result<WorkspacePlan, WorkspaceError> {
        let plan = self.plan_for_issue(issue)?;
        let workspace_path =
            create_contained_dir(&self.root, &[plan.workspace_slug.as_str()], &self.root)?;
        let prompt_parent = create_contained_dir(&workspace_path, PROMPT_DIR, &workspace_path)?;
        let prompt_file = prompt_parent.join(PROMPT_FILE_NAME);
        ensure_no_parent_refs(&prompt_file)?;
        ensure_within_root(&prompt_file, &workspace_path)?;

        Ok(WorkspacePlan {
            path: workspace_path,
            prompt_file,
            ..plan
        })
    }

    pub fn recover_workspace(
        &self,
        issue: &OrchestratorIssue,
    ) -> Result<Option<WorkspacePlan>, WorkspaceError> {
        let plan = self.plan_for_issue(issue)?;
        if !plan.path.exists() {
            return Ok(None);
        }

        let workspace_path = plan.path.canonicalize().map_err(|error| {
            WorkspaceError::InvalidConfig(format!(
                "workspace directory must be canonicalizable: {error}"
            ))
        })?;
        ensure_within_root(&workspace_path, &self.root)?;
        if !workspace_path.is_dir() {
            return Err(WorkspaceError::InvalidConfig(format!(
                "workspace path must be a directory: {}",
                workspace_path.display()
            )));
        }

        let prompt_file = PROMPT_DIR
            .iter()
            .fold(workspace_path.clone(), |parent, segment| {
                parent.join(segment)
            })
            .join(PROMPT_FILE_NAME);
        ensure_no_parent_refs(&prompt_file)?;
        ensure_within_root(&prompt_file, &workspace_path)?;

        Ok(Some(WorkspacePlan {
            path: workspace_path,
            prompt_file,
            ..plan
        }))
    }
}

fn workflow_default_root(workflow: &WorkflowDefinition) -> Result<PathBuf, WorkspaceError> {
    let workflow_dir = workflow
        .path
        .parent()
        .ok_or(WorkspaceError::MissingWorkflowParent)?;
    let workflow_dir = workflow_dir.canonicalize().map_err(|error| {
        WorkspaceError::InvalidConfig(format!(
            "workflow directory must be canonicalizable: {error}"
        ))
    })?;

    Ok(DEFAULT_WORKSPACE_ROOT
        .iter()
        .fold(workflow_dir, |root, segment| root.join(segment)))
}

fn validate_root(root: &Path) -> Result<(), WorkspaceError> {
    if !root.is_absolute() {
        return Err(WorkspaceError::InvalidConfig(
            "workspace root must be absolute".to_string(),
        ));
    }
    ensure_no_parent_refs(root)
}

fn create_contained_dir(
    base: &Path,
    segments: &[&str],
    boundary: &Path,
) -> Result<PathBuf, WorkspaceError> {
    let mut current = base.to_path_buf();
    ensure_within_root(&current, boundary)?;

    for segment in segments {
        let next = current.join(segment);
        ensure_no_parent_refs(&next)?;
        ensure_within_root(&next, boundary)?;

        match fs::create_dir(&next) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(WorkspaceError::Create(format!(
                    "{}: {error}",
                    next.display()
                )));
            }
        }

        let canonical = next.canonicalize().map_err(|error| {
            WorkspaceError::InvalidConfig(format!(
                "workspace directory must be canonicalizable: {error}"
            ))
        })?;
        ensure_within_root(&canonical, boundary)?;
        current = canonical;
    }

    Ok(current)
}

fn workspace_slug(issue: &OrchestratorIssue) -> String {
    let identifier = sanitize_path_segment(&issue.identifier);
    let id = sanitize_path_segment(&issue.id);
    let combined = if identifier == id {
        identifier
    } else {
        format!("{identifier}-{id}")
    };

    truncate_slug(&combined)
}

fn sanitize_branch_prefix(value: &str) -> String {
    sanitize_optional_path_segment(value).unwrap_or_else(|| DEFAULT_BRANCH_PREFIX.to_string())
}

fn sanitize_path_segment(value: &str) -> String {
    sanitize_optional_path_segment(value).unwrap_or_else(|| "issue".to_string())
}

fn sanitize_optional_path_segment(value: &str) -> Option<String> {
    let mut output = String::new();
    let mut needs_separator = false;

    for value in value.chars() {
        if value.is_ascii_alphanumeric() {
            if needs_separator && !output.is_empty() {
                output.push('-');
            }
            output.push(value.to_ascii_lowercase());
            needs_separator = false;
        } else {
            needs_separator = true;
        }
    }

    (!output.is_empty()).then_some(output)
}

fn truncate_slug(value: &str) -> String {
    if value.len() <= MAX_WORKSPACE_SLUG_LEN {
        return value.to_string();
    }

    let mut truncated = value[..MAX_WORKSPACE_SLUG_LEN]
        .trim_end_matches('-')
        .to_string();
    if truncated.is_empty() {
        truncated = "issue".to_string();
    }
    truncated
}

fn ensure_no_parent_refs(path: &Path) -> Result<(), WorkspaceError> {
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(WorkspaceError::InvalidConfig(format!(
            "workspace path contains parent traversal: {}",
            path.display()
        )));
    }
    Ok(())
}

fn ensure_within_root(path: &Path, root: &Path) -> Result<(), WorkspaceError> {
    if !path.starts_with(root) {
        return Err(WorkspaceError::PathEscape {
            path: path.to_path_buf(),
            root: root.to_path_buf(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Component;

    use tempfile::TempDir;

    use super::*;
    use crate::orchestrator::load_workflow_from_path_with_env;
    use crate::orchestrator::OrchestratorIssue;

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
    fn plan_for_issue_uses_deterministic_sanitized_paths() {
        let root = TempDir::new().unwrap();
        let manager = WorkspaceManager::new(root.path(), "main", "agent").unwrap();
        let issue = issue("gid://github/Issue/108", "#108: Workspace Manager");

        let first = manager.plan_for_issue(&issue).unwrap();
        let second = manager.plan_for_issue(&issue).unwrap();

        assert_eq!(first, second);
        assert_eq!(
            first.workspace_slug,
            "108-workspace-manager-gid-github-issue-108"
        );
        assert_eq!(
            first.branch_name,
            "agent/108-workspace-manager-gid-github-issue-108"
        );
        assert!(first.path.starts_with(manager.root()));
        assert!(first.prompt_file.starts_with(&first.path));
    }

    #[test]
    fn plan_for_issue_never_uses_raw_traversal_segments() {
        let root = TempDir::new().unwrap();
        let manager = WorkspaceManager::new(root.path(), "main", "../agent").unwrap();
        let issue = issue("../secret", "../../etc/passwd");

        let plan = manager.plan_for_issue(&issue).unwrap();

        assert_eq!(plan.workspace_slug, "etc-passwd-secret");
        assert_eq!(plan.branch_name, "agent/etc-passwd-secret");
        assert!(plan.path.starts_with(manager.root()));
        assert!(!plan
            .path
            .components()
            .any(|component| matches!(component, Component::ParentDir)));
    }

    #[test]
    fn prepare_workspace_creates_workspace_and_prompt_directory() {
        let root = TempDir::new().unwrap();
        let manager = WorkspaceManager::new(root.path(), "main", "agent").unwrap();
        let issue = issue("issue-108", "#108");

        let prepared = manager.prepare_workspace(&issue).unwrap();

        assert!(prepared.path.is_dir());
        assert!(prepared.prompt_file.parent().unwrap().is_dir());
        assert!(prepared.path.starts_with(manager.root()));
        assert!(prepared.prompt_file.starts_with(&prepared.path));
    }

    #[test]
    fn recover_workspace_returns_existing_workspace_without_creating_missing_one() {
        let root = TempDir::new().unwrap();
        let manager = WorkspaceManager::new(root.path(), "main", "agent").unwrap();
        let issue = issue("issue-108", "#108");

        assert!(manager.recover_workspace(&issue).unwrap().is_none());

        let prepared = manager.prepare_workspace(&issue).unwrap();
        let recovered = manager.recover_workspace(&issue).unwrap().unwrap();

        assert_eq!(recovered.workspace_slug, prepared.workspace_slug);
        assert_eq!(recovered.path, prepared.path);
        assert_eq!(recovered.prompt_file, prepared.prompt_file);
    }

    #[cfg(unix)]
    #[test]
    fn prepare_workspace_rejects_existing_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let manager = WorkspaceManager::new(root.path(), "main", "agent").unwrap();
        let issue = issue("issue-108", "#108");
        let plan = manager.plan_for_issue(&issue).unwrap();
        symlink(outside.path(), &plan.path).unwrap();

        let error = manager.prepare_workspace(&issue).unwrap_err();

        assert!(matches!(error, WorkspaceError::PathEscape { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn recover_workspace_rejects_existing_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let manager = WorkspaceManager::new(root.path(), "main", "agent").unwrap();
        let issue = issue("issue-108", "#108");
        let plan = manager.plan_for_issue(&issue).unwrap();
        symlink(outside.path(), &plan.path).unwrap();

        let error = manager.recover_workspace(&issue).unwrap_err();

        assert!(matches!(error, WorkspaceError::PathEscape { .. }));
    }

    #[test]
    fn from_workflow_uses_repo_owned_default_root() {
        let repo = TempDir::new().unwrap();
        let workflow_path = repo.path().join("WORKFLOW.md");
        fs::write(
            &workflow_path,
            r#"---
tracker:
  kind: github_issues
  owner: winoooops
  repo: vimeflow
  token: $GITHUB_TOKEN
agent:
  command: codex
---
Fix {{ issue.identifier }}.
"#,
        )
        .unwrap();
        let workflow = load_workflow_from_path_with_env(&workflow_path, |name| {
            (name == "GITHUB_TOKEN").then_some("token".to_string())
        })
        .unwrap();

        let manager = WorkspaceManager::from_workflow(&workflow).unwrap();

        assert!(manager.root().is_dir());
        assert_eq!(
            manager.root(),
            repo.path()
                .join(".vimeflow")
                .join("orchestrator")
                .join("workspaces")
                .canonicalize()
                .unwrap()
        );
    }
}
