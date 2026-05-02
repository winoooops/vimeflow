use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::orchestrator::{
    load_workflow_from_path, CommandAgentRunner, ControlBatch, DispatchBatch, GithubIssuesTracker,
    OrchestratorEvent, OrchestratorRuntime, OrchestratorSnapshot, WorkspaceManager,
};

const ORCHESTRATOR_EVENT: &str = "orchestrator:event";
const WORKFLOW_FILE_NAME: &str = "WORKFLOW.md";
const NOT_LOADED_ERROR: &str = "orchestrator workflow is not loaded";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadOrchestratorWorkflowRequest {
    pub workflow_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetOrchestratorPausedRequest {
    pub paused: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorIssueControlRequest {
    pub issue_id: String,
}

pub struct OrchestratorCommandState {
    service: Mutex<Option<OrchestratorService>>,
}

struct OrchestratorService {
    runtime: OrchestratorRuntime<GithubIssuesTracker>,
    workspace_manager: WorkspaceManager,
    runner: CommandAgentRunner,
}

impl OrchestratorCommandState {
    pub fn new() -> Self {
        Self {
            service: Mutex::new(None),
        }
    }

    fn replace_service(&self, service: OrchestratorService) -> Result<(), String> {
        let mut guard = self.lock_service()?;
        *guard = Some(service);
        Ok(())
    }

    fn with_service<F, T>(&self, callback: F) -> Result<T, String>
    where
        F: FnOnce(&mut OrchestratorService) -> Result<T, String>,
    {
        let mut guard = self.lock_service()?;
        let Some(service) = guard.as_mut() else {
            return Err(NOT_LOADED_ERROR.to_string());
        };

        callback(service)
    }

    fn lock_service(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<OrchestratorService>>, String> {
        self.service
            .lock()
            .map_err(|_| "orchestrator command state lock is poisoned".to_string())
    }
}

impl Default for OrchestratorCommandState {
    fn default() -> Self {
        Self::new()
    }
}

impl OrchestratorService {
    fn from_workflow_path(path: &Path) -> Result<Self, String> {
        let workflow = load_workflow_from_path(path).map_err(|error| error.to_string())?;
        let workspace_manager =
            WorkspaceManager::from_workflow(&workflow).map_err(|error| error.to_string())?;
        let tracker = GithubIssuesTracker::from_workflow(&workflow);
        let runtime = OrchestratorRuntime::new(workflow, tracker);

        Ok(Self {
            runtime,
            workspace_manager,
            runner: CommandAgentRunner::default(),
        })
    }

    fn snapshot(&mut self, timestamp: &str) -> Result<ControlBatch, String> {
        let events = self
            .runtime
            .reconcile_finished_runs(&self.runner, timestamp);
        let snapshot = self.runtime.snapshot().map_err(|error| error.to_string())?;

        Ok(ControlBatch { snapshot, events })
    }

    fn set_paused(&mut self, paused: bool) {
        self.runtime.set_paused(paused);
    }

    fn dispatch_once(&mut self, timestamp: &str) -> Result<DispatchBatch, String> {
        self.runtime
            .dispatch_ready(&self.workspace_manager, &self.runner, timestamp)
            .map_err(|error| error.to_string())
    }

    fn stop_run(&mut self, issue_id: &str, timestamp: &str) -> Result<ControlBatch, String> {
        self.runtime
            .stop_run(&self.runner, issue_id, timestamp)
            .map_err(|error| error.to_string())
    }

    fn retry_issue(&mut self, issue_id: &str, timestamp: &str) -> Result<DispatchBatch, String> {
        self.runtime
            .retry_issue_now(&self.workspace_manager, &self.runner, issue_id, timestamp)
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub async fn load_orchestrator_workflow(
    state: State<'_, OrchestratorCommandState>,
    request: LoadOrchestratorWorkflowRequest,
) -> Result<OrchestratorSnapshot, String> {
    let workflow_path = validate_workflow_path(&request.workflow_path)?;
    let mut service = OrchestratorService::from_workflow_path(&workflow_path)?;
    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let batch = service.snapshot(&timestamp)?;
    state.replace_service(service)?;

    Ok(batch.snapshot)
}

#[tauri::command]
pub async fn refresh_orchestrator_snapshot<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OrchestratorCommandState>,
) -> Result<ControlBatch, String> {
    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let batch = state.with_service(|service| service.snapshot(&timestamp))?;

    emit_orchestrator_events(&app, &batch.events);

    Ok(batch)
}

#[tauri::command]
pub async fn set_orchestrator_paused<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OrchestratorCommandState>,
    request: SetOrchestratorPausedRequest,
) -> Result<ControlBatch, String> {
    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let batch = state.with_service(|service| {
        service.set_paused(request.paused);
        service.snapshot(&timestamp)
    })?;

    emit_orchestrator_events(&app, &batch.events);

    Ok(batch)
}

#[tauri::command]
pub async fn dispatch_orchestrator_once<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OrchestratorCommandState>,
) -> Result<DispatchBatch, String> {
    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let batch = state.with_service(|service| service.dispatch_once(&timestamp))?;

    emit_orchestrator_events(&app, &batch.events);

    Ok(batch)
}

#[tauri::command]
pub async fn stop_orchestrator_run<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OrchestratorCommandState>,
    request: OrchestratorIssueControlRequest,
) -> Result<ControlBatch, String> {
    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let batch = state.with_service(|service| service.stop_run(&request.issue_id, &timestamp))?;

    emit_orchestrator_events(&app, &batch.events);

    Ok(batch)
}

#[tauri::command]
pub async fn retry_orchestrator_issue<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OrchestratorCommandState>,
    request: OrchestratorIssueControlRequest,
) -> Result<DispatchBatch, String> {
    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let batch = state.with_service(|service| service.retry_issue(&request.issue_id, &timestamp))?;

    emit_orchestrator_events(&app, &batch.events);

    Ok(batch)
}

fn emit_orchestrator_events<R: Runtime>(app: &AppHandle<R>, events: &[OrchestratorEvent]) {
    for event in events {
        if let Err(error) = app.emit(ORCHESTRATOR_EVENT, event) {
            log::warn!("failed to emit orchestrator event: {error}");
        }
    }
}

fn validate_workflow_path(raw_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw_path);
    if !path.is_absolute() {
        return Err("workflow path must be absolute".to_string());
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("workflow path must not contain parent references".to_string());
    }
    if path.file_name().and_then(|name| name.to_str()) != Some(WORKFLOW_FILE_NAME) {
        return Err(format!("workflow path must point to {WORKFLOW_FILE_NAME}"));
    }

    let canonical = path
        .canonicalize()
        .map_err(|error| format!("workflow path is not readable: {error}"))?;
    if canonical.file_name().and_then(|name| name.to_str()) != Some(WORKFLOW_FILE_NAME) {
        return Err(format!(
            "workflow path must resolve to {WORKFLOW_FILE_NAME}"
        ));
    }
    if !canonical.is_file() {
        return Err("workflow path must be a file".to_string());
    }

    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use tempfile::TempDir;

    use super::*;

    #[test]
    fn validate_workflow_path_accepts_absolute_workflow_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("WORKFLOW.md");
        fs::write(&path, "---\n---\nPrompt").unwrap();

        let resolved = validate_workflow_path(&path.display().to_string()).unwrap();

        assert_eq!(resolved, path.canonicalize().unwrap());
    }

    #[test]
    fn validate_workflow_path_rejects_relative_paths() {
        let error = validate_workflow_path("WORKFLOW.md").unwrap_err();

        assert!(error.contains("absolute"));
    }

    #[test]
    fn validate_workflow_path_rejects_non_workflow_filename() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("OTHER.md");
        fs::write(&path, "---\n---\nPrompt").unwrap();

        let error = validate_workflow_path(&path.display().to_string()).unwrap_err();

        assert!(error.contains("WORKFLOW.md"));
    }

    #[test]
    fn validate_workflow_path_rejects_parent_references() {
        let path = PathBuf::from("/tmp/repo/../WORKFLOW.md");

        let error = validate_workflow_path(&path.display().to_string()).unwrap_err();

        assert!(error.contains("parent references"));
    }

    #[test]
    fn command_state_requires_loaded_service() {
        let state = OrchestratorCommandState::new();

        let error = state.with_service(|_| Ok(())).unwrap_err();

        assert_eq!(error, "orchestrator workflow is not loaded");
    }
}
