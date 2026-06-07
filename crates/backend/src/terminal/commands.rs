//! PTY operation helpers consumed by the runtime-neutral backend state.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::debug::debug_log;
use crate::runtime::EventSink;

use super::events::{emit_pty_data, emit_pty_error, emit_pty_exit};
use super::state::{ManagedSession, PtyState, RingBuffer};
use super::types::*;

fn cleanup_generated_bridge_dir(dir: Option<&std::path::Path>) {
    if let Some(dir) = dir {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// `LC_CTYPE` injected into a spawned shell when the inherited environment
/// selects no UTF-8 locale. A non-UTF-8 (or empty) locale makes the shell
/// byte-count multibyte glyphs, so this picks the most broadly available UTF-8
/// character map per platform.
#[cfg(target_os = "macos")]
const DEFAULT_UTF8_CTYPE: &str = "en_US.UTF-8";
#[cfg(not(target_os = "macos"))]
const DEFAULT_UTF8_CTYPE: &str = "C.UTF-8";

fn is_utf8_locale(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("utf-8") || lower.contains("utf8")
}

/// Decide which `LC_CTYPE` to inject into a spawned shell from the inherited
/// locale env, evaluated in POSIX precedence order (`LC_ALL` > `LC_CTYPE` >
/// `LANG`). Returns `Some` only when no UTF-8 locale is inherited — an explicit
/// UTF-8 locale is left untouched. Targets `LC_CTYPE` (character handling)
/// rather than `LANG` so the user's message/collation language is preserved.
fn utf8_ctype_override(
    lc_all: Option<&str>,
    lc_ctype: Option<&str>,
    lang: Option<&str>,
) -> Option<&'static str> {
    let effective = [lc_all, lc_ctype, lang]
        .into_iter()
        .flatten()
        .find(|value| !value.is_empty());

    match effective {
        Some(value) if is_utf8_locale(value) => None,
        _ => Some(DEFAULT_UTF8_CTYPE),
    }
}

/// The locale env mutations to apply to a spawned shell, derived from the
/// inherited locale env in POSIX precedence order.
struct LocaleEnvPlan {
    /// `LC_CTYPE` to inject, or `None` when an inherited UTF-8 locale is kept.
    ctype: Option<&'static str>,
    /// Whether to drop `LC_ALL` from the child env. A non-empty `LC_ALL`
    /// overrides `LC_CTYPE` under POSIX precedence, so injecting `LC_CTYPE`
    /// alone would be ignored and the shell would keep byte-counting glyphs.
    clear_lc_all: bool,
}

/// Plan the locale env mutations for a spawned shell. When a UTF-8 override is
/// needed but `LC_ALL` is set to a non-empty (non-UTF-8) locale — the very
/// reason the override fired — `LC_ALL` is cleared so the injected `LC_CTYPE`
/// governs character handling; individual `LC_*`/`LANG` still drive the user's
/// message/collation language.
fn locale_env_plan(
    lc_all: Option<&str>,
    lc_ctype: Option<&str>,
    lang: Option<&str>,
) -> LocaleEnvPlan {
    let ctype = utf8_ctype_override(lc_all, lc_ctype, lang);
    let clear_lc_all = ctype.is_some() && matches!(lc_all, Some(value) if !value.is_empty());
    LocaleEnvPlan {
        ctype,
        clear_lc_all,
    }
}

/// Spawn a new PTY session with a shell
pub(crate) async fn spawn_pty_inner(
    state: PtyState,
    cache: Arc<super::cache::SessionCache>,
    events: Arc<dyn EventSink>,
    request: SpawnPtyRequest,
) -> Result<PtySession, String> {
    debug_log(
        "pty",
        &format!(
            "spawn_pty: id={}, cwd={}, bridge={}",
            request.session_id, request.cwd, request.enable_agent_bridge
        ),
    );
    log::info!(
        "Spawning PTY session: {} in {}",
        request.session_id,
        request.cwd
    );

    // Determine shell path — ignore user-supplied shell for security;
    // only allow the system default shell to prevent arbitrary binary execution.
    let shell = if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    };

    if request.shell.is_some() {
        log::warn!(
            "Ignoring user-supplied shell for session {} — only system shell is allowed",
            request.session_id
        );
    }

    log::info!("Using shell: {}", shell);

    // Create PTY system
    let pty_system = native_pty_system();

    // Create PTY pair
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open PTY: {}", e))?;

    // Expand ~ to home directory, then validate
    let raw_cwd = if request.cwd == "~" || request.cwd.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            if request.cwd == "~" {
                home
            } else {
                home.join(&request.cwd[2..])
            }
        } else {
            std::path::PathBuf::from(&request.cwd)
        }
    } else {
        std::path::PathBuf::from(&request.cwd)
    };

    // Validate cwd exists and is a directory (prevent path traversal)
    let cwd = std::fs::canonicalize(&raw_cwd)
        .map_err(|e| format!("invalid cwd '{}': {}", raw_cwd.display(), e))?;
    if !cwd.is_dir() {
        return Err(format!("cwd is not a directory: {}", cwd.display()));
    }

    // Allow-list session_id to safe characters only (UUID format).
    // Block-lists miss edge cases like newlines which enable bash injection
    // in generated bridge scripts.
    if !request
        .session_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid session_id: {}", request.session_id));
    }

    // Generate statusline bridge files.
    let (bridge_files, bridge_cleanup_dir, shim_cleanup_dir) = if request.enable_agent_bridge {
        let dir = cwd
            .join(".vimeflow")
            .join("sessions")
            .join(&request.session_id);
        let cleanup_dir = (!dir.exists()).then_some(dir.clone());
        let shim_dir = dirs::cache_dir()
            .map(|c| c.join("vimeflow-shims"))
            .unwrap_or_else(|| std::env::temp_dir().join("vimeflow-shims"))
            .join(&request.session_id);
        let shim_cleanup = (!shim_dir.exists()).then_some(shim_dir.clone());
        match super::bridge::generate_bridge_files(
            &dir.to_string_lossy(),
            &request.session_id,
            Some(&shim_dir.to_string_lossy()),
        ) {
            Ok(files) => {
                debug_log(
                    "bridge",
                    &format!(
                        "created: status={}, init={}",
                        files.status_file_path.display(),
                        files.shell_init_path.display()
                    ),
                );
                (Some(files), cleanup_dir, shim_cleanup)
            }
            Err(e) => {
                cleanup_generated_bridge_dir(cleanup_dir.as_deref());
                cleanup_generated_bridge_dir(shim_cleanup.as_deref());
                log::warn!(
                    "Failed to generate statusline bridge for session {}: {}",
                    request.session_id,
                    e
                );
                (None, None, None)
            }
        }
    } else {
        (None, None, None)
    };

    // Build command — env from IPC is ignored for security (prevents injection)
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);
    // GUI launches (desktop/AppImage) often do not inherit a terminal-capable
    // environment. xterm.js supports 256-color + truecolor, so advertise that
    // contract to child TUIs without accepting arbitrary env from IPC.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Ensure a UTF-8 locale for character handling. GUI launches frequently
    // inherit no LANG/LC_* (Terminal.app/iTerm2 set them; a dock/Finder or
    // `electron:dev` launch does not), so the shell falls back to the C locale
    // and byte-counts multibyte Powerline/Nerd Font glyphs — miscomputing line
    // width and desyncing the cursor during line editing (autocomplete,
    // redisplay). Inject LC_CTYPE only when no UTF-8 locale is inherited, so an
    // explicit user locale is preserved.
    let inherited_lc_all = std::env::var("LC_ALL").ok();
    let inherited_lc_ctype = std::env::var("LC_CTYPE").ok();
    let inherited_lang = std::env::var("LANG").ok();
    let locale_plan = locale_env_plan(
        inherited_lc_all.as_deref(),
        inherited_lc_ctype.as_deref(),
        inherited_lang.as_deref(),
    );
    if locale_plan.clear_lc_all {
        cmd.env_remove("LC_ALL");
    }
    if let Some(ctype) = locale_plan.ctype {
        cmd.env("LC_CTYPE", ctype);
    }

    // Inject a `claude` wrapper function into the interactive shell.
    //
    // We do NOT set CLAUDE_CONFIG_DIR — that would replace the user's
    // entire config directory, breaking auth, plugins, and hooks.
    // Instead, we set shell startup hooks to source our generated init script:
    // BASH_ENV/--rcfile for bash and ZDOTDIR for zsh, while preserving the
    // user's HOME-level startup files.
    if let Some(ref files) = bridge_files {
        // Pass paths via env vars — the scripts reference these variables
        // instead of embedding paths directly, which avoids injection from
        // paths containing quotes or metacharacters.
        cmd.env("BASH_ENV", files.shell_init_path.as_os_str());
        cmd.env("ENV", files.shell_init_path.as_os_str());
        cmd.env("VIMEFLOW_AGENT_INIT", files.shell_init_path.as_os_str());
        cmd.env("VIMEFLOW_CLAUDE_SHIM_DIR", files.shim_dir_path.as_os_str());
        cmd.env("VIMEFLOW_CLAUDE_SETTINGS", files.settings_path.as_os_str());
        cmd.env("VIMEFLOW_STATUS_FILE", files.status_file_path.as_os_str());

        // For interactive bash, generate a combined rcfile that sources
        // both ~/.bashrc (user config) and our init script
        let Some(init_dir) = files.shell_init_path.parent() else {
            cleanup_generated_bridge_dir(bridge_cleanup_dir.as_deref());
            cleanup_generated_bridge_dir(shim_cleanup_dir.as_deref());
            return Err("shell init path has no parent directory".to_string());
        };
        let rcfile_path = init_dir.join("bashrc");
        // Use $BASH_ENV (already set above) instead of embedding the path —
        // handles CWDs with apostrophes that would break single-quoted paths.
        let rcfile_content =
            "[ -f ~/.bashrc ] && source ~/.bashrc\nsource \"$BASH_ENV\"\n".to_string();
        if let Err(e) = std::fs::write(&rcfile_path, &rcfile_content) {
            log::warn!("Failed to write combined bashrc: {}", e);
        } else if shell.contains("bash") {
            cmd.arg("--rcfile");
            cmd.arg(rcfile_path.as_os_str());
        }

        if shell.contains("zsh") {
            cmd.env("ZDOTDIR", init_dir.as_os_str());
        }

        log::info!("Injected claude wrapper for session {}", request.session_id);
    }

    if request.env.is_some() {
        log::warn!(
            "Ignoring user-supplied env for session {} — IPC env injection not allowed",
            request.session_id
        );
    }

    // Spawn child process. We hold the child owned so that we can
    // best-effort kill it on any failure path below (try_insert cap/dup
    // race, cache.mutate failure) — the failure paths take ownership of
    // a `ManagedSession` (containing the child) and call `kill`/`wait`
    // there. Without owning the child here, a bail-out would leak the
    // process: alive but unreferenced anywhere, with its stdout buffer
    // eventually filling and the process blocking.
    let mut child = match pty_pair.slave.spawn_command(cmd) {
        Ok(child) => child,
        Err(e) => {
            cleanup_generated_bridge_dir(bridge_cleanup_dir.as_deref());
            cleanup_generated_bridge_dir(shim_cleanup_dir.as_deref());
            return Err(format!("failed to spawn shell: {}", e));
        }
    };

    let Some(pid) = child.process_id() else {
        let _ = child.kill();
        let _ = child.wait();
        cleanup_generated_bridge_dir(bridge_cleanup_dir.as_deref());
        cleanup_generated_bridge_dir(shim_cleanup_dir.as_deref());
        return Err("failed to get process ID".to_string());
    };

    log::info!("Spawned shell with PID: {}", pid);

    // Get writer from master PTY (call take_writer once and store it)
    let writer = match pty_pair.master.take_writer() {
        Ok(writer) => writer,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            cleanup_generated_bridge_dir(bridge_cleanup_dir.as_deref());
            cleanup_generated_bridge_dir(shim_cleanup_dir.as_deref());
            return Err(format!("failed to get PTY writer: {}", e));
        }
    };

    // Round 7, Finding 3 (claude MEDIUM): atomic check-and-insert against
    // the cap and duplicate id. The previous flow ran three independent
    // lock acquisitions:
    //
    //   if state.contains(...) { return Err(...) }
    //   if state.active_count() >= 64 { return Err(...) }
    //   state.insert(...)
    //
    // Two concurrent spawn_pty calls at exactly cap-1 (63) could BOTH pass
    // `active_count() == 63` and BOTH insert, ending at 65 sessions. The
    // duplicate-id race is academic given UUIDs but the cap race is real.
    // `try_insert` holds the sessions mutex across the check and the
    // insert so the race window is closed.
    //
    // Ordering note (interaction with Finding 1, claude HIGH): we do
    // try_insert FIRST (fallible) and cache.mutate SECOND. This is the
    // CLEANER of the two stack orderings:
    //
    //   - try_insert Err → no state, no cache; kill+wait the child
    //     returned in the Err tuple
    //   - cache.mutate Err → state has the entry; rollback via the
    //     INFALLIBLE `state.remove`, then kill+wait the child returned
    //
    // The reverse (cache.mutate first → try_insert second) would require
    // a fallible cache rollback closure on the try_insert-Err path,
    // nesting error handling. Finding 1's invariant is preserved:
    // whenever spawn_pty returns Err, no orphan child remains in
    // PtyState — independent of which step failed.
    let generation = state.next_generation();
    let ring = Arc::new(Mutex::new(RingBuffer::new(65536)));
    let read_ring = Arc::clone(&ring);
    let cancelled = Arc::new(AtomicBool::new(false));
    let read_cancelled = Arc::clone(&cancelled);
    let session = ManagedSession {
        master: pty_pair.master,
        writer,
        child,
        cwd: cwd.to_string_lossy().to_string(),
        shim_dir: bridge_files.as_ref().map(|f| f.shim_dir_path.to_string_lossy().to_string()),
        generation,
        ring,
        cancelled,
        started_at: std::time::SystemTime::now(),
    };
    if let Err((reason, mut rejected)) = state.try_insert(request.session_id.clone(), session, 64) {
        // Reap the child whose session we couldn't insert. portable_pty's
        // Child::Drop does not kill the process by default — we must call
        // kill explicitly so spawn_pty's failure path doesn't leak the
        // freshly-spawned shell.
        let _ = rejected.child.kill();
        let _ = rejected.child.wait();
        cleanup_generated_bridge_dir(bridge_cleanup_dir.as_deref());
        cleanup_generated_bridge_dir(shim_cleanup_dir.as_deref());
        return Err(match reason {
            crate::terminal::state::TryInsertError::AlreadyExists => format!(
                "session '{}' already exists — cannot spawn duplicate session ID",
                request.session_id
            ),
            crate::terminal::state::TryInsertError::CapReached => {
                "maximum of 64 active sessions reached — cannot spawn new session".to_string()
            }
        });
    }

    // Cache write — under the same `mutate` lock as every other state
    // change. On failure we roll back the PtyState insert via the
    // infallible `state.remove` and reap the child it carries.
    let created_at = chrono::Utc::now().to_rfc3339();
    if let Err(e) = cache.mutate(|data| {
        use super::cache::CachedSession;
        data.sessions.insert(
            request.session_id.clone(),
            CachedSession {
                cwd: cwd.to_string_lossy().to_string(),
                created_at,
                exited: false,
                last_exit_code: None,
                activity_panel_collapsed: None,
            },
        );
        data.session_order.push(request.session_id.clone());
        // Promote to active if this is the first session
        if data.active_session_id.is_none() {
            data.active_session_id = Some(request.session_id.clone());
        }
        Ok(())
    }) {
        // Roll back the PtyState insert, then reap the child. Both are
        // best-effort: surfacing the original cache error is more useful
        // than chaining a kill or remove error.
        if let Some(mut removed) = state.remove(&request.session_id) {
            let _ = removed.child.kill();
            let _ = removed.child.wait();
        }
        cleanup_generated_bridge_dir(bridge_cleanup_dir.as_deref());
        cleanup_generated_bridge_dir(shim_cleanup_dir.as_deref());
        return Err(format!("failed to write cache: {}", e));
    }

    debug_log(
        "pty",
        &format!(
            "session stored: id={}, cwd={}, pid={}",
            request.session_id,
            cwd.display(),
            pid
        ),
    );

    // Spawn blocking thread for PTY read loop (avoids starving async runtime)
    let session_id = request.session_id.clone();
    let state_clone = state.clone();
    let cache_clone = cache.clone();
    let events_clone = events.clone();
    let runtime = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        if let Err(e) = runtime.block_on(read_pty_output(
            events_clone,
            state_clone,
            cache_clone,
            session_id,
            generation,
            read_ring,
            read_cancelled,
        )) {
            log::error!("PTY output reader error: {}", e);
        }
    });

    Ok(PtySession {
        id: request.session_id,
        pid,
        cwd: cwd.to_string_lossy().to_string(),
    })
}

/// Write data to a PTY session
pub(crate) fn write_pty_inner(state: &PtyState, request: WritePtyRequest) -> Result<(), String> {
    log::debug!(
        "Writing to PTY {}: {} bytes",
        request.session_id,
        request.data.len()
    );

    state
        .write(&request.session_id, request.data.as_bytes())
        .map_err(|e| e.to_string())
}

/// Resize a PTY session
pub(crate) fn resize_pty_inner(state: &PtyState, request: ResizePtyRequest) -> Result<(), String> {
    log::debug!(
        "Resizing PTY {} to {}x{}",
        request.session_id,
        request.rows,
        request.cols
    );

    state
        .resize(&request.session_id, request.rows, request.cols)
        .map_err(|e| e.to_string())
}

/// Kill a PTY session.
///
/// Idempotent on the missing-session axis: if the id isn't in `PtyState`
/// (read-loop EOF already cleaned up, never spawned, etc.) the cache is
/// still scrubbed and `Ok(())` is returned — closing a tab whose PTY died
/// in the background should not surface an error to the user.
///
/// Round 9, Finding 1 (codex P1): a `KillFailed` from `state.kill` (the
/// session IS in PtyState but `child.kill()` syscall returned an error)
/// is now propagated as `Err`. Previously we swallowed every kill error
/// and removed the session entry anyway — the child kept running on a
/// disconnected PTY while React believed the tab was gone, leaking
/// processes the user could not see or close. By preserving state on
/// `KillFailed` the user can retry, and the cache stays consistent with
/// the actual process tree.
pub(crate) fn kill_pty_inner(
    state: &PtyState,
    cache: &Arc<super::cache::SessionCache>,
    request: KillPtyRequest,
) -> Result<(), String> {
    log::info!("Killing PTY session: {}", request.session_id);

    match state.kill(&request.session_id) {
        // Either we just killed it, or it was already gone — both are
        // safe to follow with cache cleanup.
        Ok(()) | Err(super::state::KillError::NotPresent) => {}
        Err(super::state::KillError::KillFailed(msg)) => {
            // Child may still be alive. Preserve PtyState + cache so a
            // retry can find the session, and surface the failure.
            // IMPORTANT: must NOT touch the cancellation flag on this
            // path — if we did, the still-alive child's next read would
            // trip the flag and `remove_if_generation` would drop the
            // session entry, orphaning the live process from app state.
            return Err(format!(
                "kill_pty: failed to kill child for session {}: {}",
                request.session_id, msg
            ));
        }
    }

    // Signal the read loop to break out promptly even if the child ignores
    // SIGTERM. Only set on the successful-kill / already-gone branches
    // above so the `KillFailed` retry contract is preserved (a live child
    // must not be cleaned up by the reader). Without this signal, an
    // ignore-SIGTERM process would keep the read thread alive (and
    // emitting `pty-data` for a removed session) until eventual EOF.
    state.set_cancelled(&request.session_id);

    // Remove from state (no-op if NotPresent, the safe path above).
    let removed = state.remove(&request.session_id);

    // Clean up bridge files and shim directory for the session.
    if let Some(session) = removed {
        let cwd = std::path::Path::new(&session.cwd);
        let bridge_dir = cwd.join(".vimeflow").join("sessions").join(&request.session_id);
        let _ = super::bridge::cleanup_bridge_files(
            &bridge_dir.to_string_lossy(),
            session.shim_dir.as_deref(),
        );
    }

    // Clean up cache: remove from sessions map and session_order
    cache
        .mutate(|data| {
            data.sessions.remove(&request.session_id);
            data.session_order.retain(|id| id != &request.session_id);
            // Drop any workspace grouping for this PTY — the pane no longer
            // exists, so it must not be reconstructed on the next restore.
            // Capture its workspace_session_id BEFORE removal so we can
            // re-index surviving siblings (cycle 18 MEDIUM): without this
            // step, sibling groupings retain the pre-kill layout (e.g.,
            // `quad` with 4 pane_indexes occupied) but the workspace now
            // only has N-1 alive PTYs. In the crash window between
            // `kill_pty` and the next `set_workspace_sessions` push (the
            // frontend heals via that effect), restore would reconstruct
            // the workspace at the stale layout with an empty slot the
            // user cannot interact with. Re-indexing here keeps the
            // workspace internally consistent in that window. Claude
            // MEDIUM on PR #290 cycle 17.
            let workspace_session_id = data
                .groupings
                .get(&request.session_id)
                .map(|g| g.workspace_session_id.clone());
            let was_active = data
                .groupings
                .get(&request.session_id)
                .map(|g| g.active)
                .unwrap_or(false);
            data.groupings.remove(&request.session_id);

            if let Some(ws_id) = workspace_session_id {
                // Collect surviving siblings in stable pane_index order.
                // Cloning keys to release the borrow before mutation.
                let mut sibling_ids: Vec<String> = data
                    .groupings
                    .iter()
                    .filter(|(_, g)| g.workspace_session_id == ws_id)
                    .map(|(id, _)| id.clone())
                    .collect();
                sibling_ids.sort_by_key(|id| {
                    data.groupings
                        .get(id)
                        .map(|g| g.pane_index)
                        .unwrap_or(u32::MAX)
                });

                // Layout-by-count for the crash window. The next
                // `set_workspace_sessions` push from the frontend
                // overwrites these with the authoritative user choice;
                // for the crash-recovery path we pick a sensible
                // default (vsplit over hsplit when N=2 — the more
                // common choice in this codebase's defaults).
                //
                // No-survivor case (workspace gone) falls through this
                // `if` block without an early return so the
                // `active_session_id` cleanup BELOW still runs. Codex
                // verify cycle 18 caught that `return Ok(())` here was
                // a closure-scope early return that would have skipped
                // that cleanup, leaving a dangling active id.
                // Prefer the survivors' existing layout when the count is
                // still compatible (e.g. keep hsplit when N=2, threeRight
                // when N=3) and only downgrade when N no longer fits.
                // Falls back to count-based defaults when the original
                // layout is incompatible or absent. Claude MEDIUM on PR #381.
                let new_layout: Option<&'static str> = if sibling_ids.is_empty() {
                    None
                } else {
                    let existing = sibling_ids
                        .first()
                        .and_then(|id| data.groupings.get(id))
                        .map(|g| g.layout.as_str());
                    let count = sibling_ids.len();
                    let compatible = match existing {
                        Some("single") => count == 1,
                        Some("vsplit") | Some("hsplit") => count == 2,
                        Some("threeRight") => count == 3,
                        Some("quad") => count >= 4,
                        _ => false,
                    };
                    if compatible {
                        existing
                    } else {
                        match count {
                            1 => Some("single"),
                            2 => Some("vsplit"),
                            3 => Some("threeRight"),
                            _ => Some("quad"),
                        }
                    }
                };

                if let Some(new_layout) = new_layout {
                    // Promote first surviving sibling to active when the
                    // killed pane held the active flag. Otherwise preserve
                    // whatever active marker already exists on a survivor.
                    let needs_active_promotion = was_active
                        && !sibling_ids.iter().any(|id| {
                            data.groupings
                                .get(id)
                                .map(|g| g.active)
                                .unwrap_or(false)
                        });

                    for (idx, sibling_id) in sibling_ids.iter().enumerate() {
                        if let Some(grouping) = data.groupings.get_mut(sibling_id) {
                            grouping.layout = new_layout.to_string();
                            grouping.pane_index = idx as u32;
                            grouping.pane_id = format!("p{}", idx);
                            if needs_active_promotion && idx == 0 {
                                grouping.active = true;
                            }
                        }
                    }
                }
            }

            // Clear active_session_id if the killed session was active.
            // The frontend owns tab-neighbor selection and persists the
            // chosen successor via set_active_session after kill_pty returns.
            // Leaving None during that short window avoids a cache/UI
            // mismatch where Rust guessed the first remaining tab while React
            // selected the same-position neighbor.
            if data.active_session_id.as_ref() == Some(&request.session_id) {
                data.active_session_id = None;
            }
            Ok(())
        })
        .map_err(|e| format!("failed to update cache: {}", e))?;

    Ok(())
}

/// List all sessions with their current status and replay data
pub(crate) fn list_sessions_inner(
    state: &PtyState,
    cache: &Arc<super::cache::SessionCache>,
) -> Result<SessionList, String> {
    let snapshot = cache.snapshot();
    let mut needs_flush = false;
    let mut session_infos = Vec::with_capacity(snapshot.session_order.len());

    for id in &snapshot.session_order {
        let cached = match snapshot.sessions.get(id) {
            Some(c) => c.clone(),
            None => continue, // session_order/sessions desync — skip
        };

        // Round 12, Finding 3 (claude LOW): acquire the PtyState sessions
        // lock once per id and snapshot pid + ring handle together.
        // The previous code called `state.get_pid()` (lock #1) then
        // `state.inner_sessions().lock()` (lock #2) — same data under two
        // locks, with a race window between them that the original code
        // had to detect and demote to Exited. Reading both fields under a
        // single short guard collapses that window and the redundant work.
        //
        // Issue #100: clone the per-session ring Arc while holding the global
        // sessions lock, then read bytes/end_offset after dropping it. That
        // preserves the ring snapshot invariant without serializing
        // list_sessions behind read-loop appends.
        let status = if cached.exited {
            SessionStatus::Exited {
                last_exit_code: cached.last_exit_code,
            }
        } else {
            let live_session = {
                let sessions_lock = state.inner_sessions().lock().expect("poisoned");
                sessions_lock.get(id).map(|session| {
                    let pid = session.child.process_id().unwrap_or(0);
                    let ring = Arc::clone(&session.ring);
                    (pid, ring)
                })
            };

            if let Some((pid, ring)) = live_session {
                let ring_guard = ring.lock().expect("ring poisoned");
                let bytes = ring_guard.bytes_snapshot();
                let end_offset = ring_guard.end_offset();
                let replay_data = String::from_utf8_lossy(&bytes).to_string();
                SessionStatus::Alive {
                    pid,
                    replay_data,
                    replay_end_offset: end_offset,
                }
            } else {
                // Lazy reconciliation: cache says alive but PtyState
                // doesn't have the session (Tauri restart, hard kill,
                // graceful close mid-loop). Flip the cache so the next
                // load sees the truth.
                needs_flush = true;
                SessionStatus::Exited {
                    last_exit_code: None,
                }
            }
        };

        session_infos.push(SessionInfo {
            id: id.clone(),
            cwd: cached.cwd,
            status,
            activity_panel_collapsed: cached.activity_panel_collapsed,
            grouping: snapshot.groupings.get(id).cloned(),
        });
    }

    // Round 14, Claude MEDIUM: after lazy reconciliation, the snapshot's
    // active_session_id may point at a session that has just been flipped
    // to Exited. Returning it unchanged lets a caller route input or
    // highlight a tab for an Exited session in the same response, which
    // is structurally inconsistent. Compute a rotation here so the
    // returned active_session_id mirrors what set_active_session /
    // kill_pty would have produced.
    //
    // Build the set of reconciled-to-Exited ids first; we use it both to
    // decide whether the active id needs rotation and to pick a
    // replacement (the first session_order entry that is NOT in the set
    // and is NOT already cached.exited).
    let reconciled_to_exited: std::collections::HashSet<String> = session_infos
        .iter()
        .filter(|info| matches!(info.status, SessionStatus::Exited { .. }))
        .filter(|info| {
            // Only the freshly reconciled ones; sessions already exited in
            // the cache snapshot don't change anything.
            snapshot.sessions.get(&info.id).is_some_and(|c| !c.exited)
        })
        .map(|info| info.id.clone())
        .collect();

    let mut active_session_id = snapshot.active_session_id.clone();
    if let Some(active) = active_session_id.as_ref() {
        if reconciled_to_exited.contains(active) {
            // Pick the first session whose status is Alive in this very
            // response — that matches the reconciliation we just did and
            // is consistent with what the caller will see.
            active_session_id = session_infos
                .iter()
                .find(|info| matches!(info.status, SessionStatus::Alive { .. }))
                .map(|info| info.id.clone());
        }
    }

    if needs_flush {
        // Flush the lazy reconciliation results back to cache. Same closure
        // also rotates active_session_id when it pointed at a reconciled
        // session; persisting this here keeps the cache in sync with the
        // response we are about to return.
        let new_active = active_session_id.clone();
        cache.mutate(|d| {
            for info in &session_infos {
                if matches!(info.status, SessionStatus::Exited { .. }) {
                    if let Some(s) = d.sessions.get_mut(&info.id) {
                        s.exited = true;
                    }
                }
            }
            if let Some(active) = d.active_session_id.as_ref() {
                if reconciled_to_exited.contains(active) {
                    d.active_session_id = new_active.clone();
                }
            }
            Ok(())
        })?;
    }

    // Restore observability: one summary line per list_sessions call. This is
    // the backend half of the fragmentation trace (the frontend logs how many
    // workspace sessions it reconstructs from these PTYs). `reconciled` counts
    // entries the cache had marked alive but PtyState no longer holds — the
    // post-crash path that flips them to Exited.
    let alive = session_infos
        .iter()
        .filter(|info| matches!(info.status, SessionStatus::Alive { .. }))
        .count();
    log::info!(
        "list_sessions: {} PTY session(s) ({} alive, {} reconciled-to-exited), active={:?}",
        session_infos.len(),
        alive,
        reconciled_to_exited.len(),
        active_session_id
    );
    debug_log(
        "restore",
        &format!(
            "list_sessions: total={}, alive={}, reconciled={}, order={:?}",
            session_infos.len(),
            alive,
            reconciled_to_exited.len(),
            snapshot.session_order
        ),
    );

    Ok(SessionList {
        active_session_id,
        sessions: session_infos,
    })
}

/// Set the active session ID in the cache.
///
/// Round 4, Finding 3 (codex P2): the membership check happens INSIDE the
/// `mutate` closure so it's serialized with the write under one lock.
/// Without this, a concurrent `kill_pty` could remove the id between the
/// snapshot-based check and the write — the check passed against the old
/// state and we'd then write a now-stale `active_session_id`.
pub(crate) fn set_active_session_inner(
    cache: &Arc<crate::terminal::cache::SessionCache>,
    request: SetActiveSessionRequest,
) -> Result<(), String> {
    cache.mutate(|d| {
        if !d.session_order.contains(&request.id) {
            return Err("unknown session".into());
        }
        d.active_session_id = Some(request.id.clone());
        Ok(())
    })
}

/// Reorder the session list in the cache.
///
/// Round 4, Finding 3 (codex P2): the permutation check happens INSIDE the
/// `mutate` closure so the validation and the write are atomic under one
/// lock. Previously the check ran against `cache.snapshot()` (taking and
/// releasing the lock briefly), then a SECOND `mutate` call wrote the new
/// order. A concurrent `spawn_pty` or `kill_pty` between those two locks
/// could change `session_order`; the permutation check passed against the
/// OLD state and the subsequent write overwrote the NEWER state with stale
/// ids — dropping a just-spawned session from `session_order` even though
/// its PTY was still alive (the ghost only appeared after a reload).
///
/// Round 6, Finding 2 (codex HIGH): the permutation check uses a
/// sort-and-compare against the CURRENT `session_order` rather than a
/// `HashSet` equality. `HashSet` collapses duplicates — `[a, b, c]` and
/// `[a, b, c, c]` produce the same set `{a, b, c}` and pass validation,
/// then `d.session_order = request.ids.clone()` persists the duplicate id.
/// On the next reload, `list_sessions` returns a duplicate session entry,
/// React tab keys collide, and active-tab selection becomes unstable.
/// Comparing sorted vectors enforces equal length AND equal multiset.
pub(crate) fn reorder_sessions_inner(
    cache: &Arc<crate::terminal::cache::SessionCache>,
    request: ReorderSessionsRequest,
) -> Result<(), String> {
    cache.mutate(|d| {
        let mut current_sorted = d.session_order.clone();
        let mut proposed_sorted = request.ids.clone();
        current_sorted.sort();
        proposed_sorted.sort();
        if current_sorted != proposed_sorted {
            return Err("invalid reorder: not a permutation".into());
        }
        d.session_order = request.ids.clone();
        Ok(())
    })
}

/// Update the current working directory for a session in the cache.
///
/// Round 4, Finding 3 (codex P2): membership check moved INSIDE the
/// `mutate` closure so a concurrent `kill_pty` cannot remove the session
/// between the check and the write. Path validation stays outside — it's
/// stateless and doesn't touch cache state.
///
/// Round 8, Finding 4 (claude LOW): canonicalize the path before storing,
/// matching `spawn_pty`. Without this, OSC 7 emissions like `/tmp/./` or
/// `/home/user/../user/projects` were stored verbatim, leading to spurious
/// inequality checks and confusing output in tests / debug logs. Canonical
/// paths also serve as a safety net against directory-traversal-style cwds
/// that pass the absolute + is_dir checks but mask the actual location.
pub(crate) fn update_session_cwd_inner(
    cache: &Arc<crate::terminal::cache::SessionCache>,
    request: UpdateSessionCwdRequest,
) -> Result<(), String> {
    // UUID-shape allow-list (same as spawn_pty)
    if !request
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid session id".into());
    }
    // Canonicalize before storing. `canonicalize` resolves symlinks, strips
    // `.`/`..` components, and verifies the path exists in one shot.
    // Mirrors the validation `spawn_pty` performs at session creation.
    let path = std::fs::canonicalize(std::path::PathBuf::from(&request.cwd))
        .map_err(|e| format!("invalid cwd: {e}"))?;
    if !path.is_dir() {
        return Err(format!("invalid cwd: not a directory: {}", path.display()));
    }
    let canonical_cwd = path.to_string_lossy().to_string();

    cache.mutate(|d| match d.sessions.get_mut(&request.id) {
        Some(s) => {
            s.cwd = canonical_cwd.clone();
            Ok(())
        }
        None => Err("unknown session".into()),
    })
}

pub(crate) fn set_session_activity_panel_collapsed_inner(
    cache: &Arc<crate::terminal::cache::SessionCache>,
    request: SetSessionActivityPanelCollapsedRequest,
) -> Result<(), String> {
    cache.mutate(|d| {
        let session = d
            .sessions
            .get_mut(&request.id)
            .ok_or_else(|| format!("session not found: {}", request.id))?;
        session.activity_panel_collapsed = Some(request.collapsed);
        Ok(())
    })
}

/// Persist the frontend's full workspace-session grouping snapshot so a later
/// restore can reconstruct the multi-pane layout instead of fragmenting each
/// PTY into its own single-pane session.
///
/// Two cache fields are rebuilt under one `mutate`:
///
/// 1. `groupings` — keyed by PTY id; rewritten from scratch from the snapshot.
///    Panes closed since the previous push simply don't appear and their
///    grouping is dropped. PTYs the snapshot references but the cache does
///    not know about (spawn/kill race) are skipped — they would be dangling
///    grouping entries that `list_sessions` could never surface anyway.
///
/// 2. `session_order` — the canonical PTY display order. Pre-multi-pane this
///    field was owned by `reorder_sessions`, but that IPC validates against a
///    permutation of all PTYs while the frontend's reorder payload contains
///    only one active PTY per workspace; for any workspace with >1 pane the
///    permutation check rejects the request and the cache's order silently
///    diverges from the UI. Rebuilding `session_order` here closes that gap
///    atomically with the grouping write. PTYs that exist in the cache but
///    were absent from the snapshot (spawn/kill race, or any never-grouped
///    legacy PTY) keep their existing relative order and are appended after
///    the snapshot's ordering, so a transient race never drops a tab.
pub(crate) fn set_workspace_sessions_inner(
    cache: &Arc<crate::terminal::cache::SessionCache>,
    request: SetWorkspaceSessionsRequest,
) -> Result<(), String> {
    cache.mutate(|d| {
        let mut groupings = std::collections::HashMap::new();
        let mut new_order: Vec<String> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        for session in &request.sessions {
            for pane in &session.panes {
                if !d.sessions.contains_key(&pane.pty_id) {
                    continue;
                }
                // Both `groupings.insert` and `new_order.push` are gated by
                // the same `seen` dedup. Without this, a malformed snapshot
                // that lists the same `pty_id` under two workspace sessions
                // would silently overwrite the first session's grouping
                // with the second's (PR #290 cycle 11 — Claude MEDIUM). The
                // first-wins policy preserves the earlier workspace and
                // logs a warning so a regression in the frontend snapshot
                // builder is visible.
                if seen.insert(pane.pty_id.clone()) {
                    groupings.insert(
                        pane.pty_id.clone(),
                        PaneGrouping {
                            workspace_session_id: session.id.clone(),
                            layout: session.layout.clone(),
                            workspace_directory: session.working_directory.clone(),
                            pane_id: pane.pane_id.clone(),
                            pane_index: pane.pane_index,
                            agent_type: pane.agent_type.clone(),
                            active: pane.active,
                        },
                    );
                    new_order.push(pane.pty_id.clone());
                } else {
                    log::warn!(
                        "set_workspace_sessions: duplicate pty_id '{}' in request — \
                         keeping first occurrence, ignoring later entry under workspace '{}'",
                        pane.pty_id,
                        session.id,
                    );
                }
            }
        }

        // Preserve PTYs in cache that the snapshot didn't mention — appended
        // in their existing relative order so a transient race window cannot
        // drop a session. Symmetrically preserve their grouping entry too:
        // wiping `d.groupings` while keeping the PTY alive in `session_order`
        // would surface those panes as solo single-pane sessions on the next
        // `list_sessions`, peeling them out of their original workspace
        // (caught by Claude reviewer as a MEDIUM during PR #290 cycle 3).
        for pty_id in &d.session_order {
            if !seen.contains(pty_id) && d.sessions.contains_key(pty_id) {
                new_order.push(pty_id.clone());
                if let Some(existing) = d.groupings.get(pty_id) {
                    groupings.insert(pty_id.clone(), existing.clone());
                }
            }
        }

        d.groupings = groupings;
        d.session_order = new_order;
        Ok(())
    })
}

/// Background task to read PTY output and emit events
async fn read_pty_output(
    events: Arc<dyn EventSink>,
    state: PtyState,
    cache: std::sync::Arc<crate::terminal::cache::SessionCache>,
    session_id: SessionId,
    generation: u64,
    ring: Arc<Mutex<RingBuffer>>,
    cancelled: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    log::info!("Starting PTY output reader for session: {}", session_id);

    // Clone the reader while keeping the session available in state
    // This prevents race conditions where concurrent writes/resizes would fail
    // with "session not found" if we removed the session temporarily
    let mut reader = state.clone_reader(&session_id)?;

    // Read loop
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                // EOF - process exited
                log::info!("PTY session {} exited (EOF)", session_id);
                // Mark cache as exited
                let _ = cache.mutate(|d| {
                    if let Some(s) = d.sessions.get_mut(&session_id) {
                        s.exited = true;
                        // last_exit_code stays None in v1 — capturing requires
                        // child.try_wait() with locking; deferred to follow-up.
                    }
                    Ok(())
                });
                emit_pty_exit(
                    events.as_ref(),
                    &PtyExitEvent {
                        session_id: session_id.clone(),
                        code: None,
                    },
                )
                .ok();
                break;
            }
            Ok(n) => {
                // Honor a `kill_pty`-driven cancellation BEFORE appending
                // or emitting. Checking after emit would let the first
                // post-kill chunk leak to the UI; checking here drops it
                // along with any further data so the contract "no
                // pty-data after kill_pty completes" holds. Ignore-SIGTERM
                // children would otherwise keep the read thread alive
                // indefinitely.
                if cancelled.load(Ordering::Relaxed) {
                    log::info!(
                        "PTY session {} read loop exiting (cancelled by kill_pty)",
                        session_id
                    );
                    break;
                }

                // Atomically: append to ring buffer, get chunk_start, drop the lock
                let chunk_start = {
                    let mut ring = ring.lock().expect("ring poisoned");
                    ring.append(&buf[..n])
                };
                let data = String::from_utf8_lossy(&buf[..n]).to_string();
                emit_pty_data(
                    events.as_ref(),
                    &PtyDataEvent {
                        session_id: session_id.clone(),
                        data,
                        offset_start: chunk_start,
                        // Raw byte count — the unit the producer's offset
                        // arithmetic (RingBuffer::append) used. Subscribers
                        // MUST advance their cursor with this, NOT with the
                        // length of `data` (lossy UTF-8 inflates invalid
                        // bytes to U+FFFD, which is 3 bytes when re-encoded).
                        byte_len: n as u64,
                    },
                )
                .ok();
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {
                // Interrupted - retry
                continue;
            }
            Err(e) => {
                // Error - emit error event and exit
                log::error!("PTY read error for session {}: {}", session_id, e);
                emit_pty_error(
                    events.as_ref(),
                    &PtyErrorEvent {
                        session_id: session_id.clone(),
                        message: e.to_string(),
                    },
                )
                .ok();
                break;
            }
        }
    }

    // Clean up session only if this reader's generation still owns it.
    // If the session was replaced (ID reuse), a newer generation owns the slot.
    let removed = state.remove_if_generation(&session_id, generation);

    // Clean up bridge files and shim directory for the session.
    if let Some(session) = removed {
        let cwd = std::path::Path::new(&session.cwd);
        let bridge_dir = cwd.join(".vimeflow").join("sessions").join(&session_id);
        let _ = super::bridge::cleanup_bridge_files(
            &bridge_dir.to_string_lossy(),
            session.shim_dir.as_deref(),
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::cache::SessionCache;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    fn create_test_state_with_cache() -> (
        PtyState,
        Arc<SessionCache>,
        Arc<dyn crate::runtime::EventSink>,
        TempDir,
    ) {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        let cache_path = temp_dir.path().join("sessions.json");
        let cache = SessionCache::load(cache_path).expect("failed to load cache");
        let cache = Arc::new(cache);
        let events = Arc::new(crate::runtime::FakeEventSink::new());

        (PtyState::new(), cache, events, temp_dir)
    }

    #[test]
    fn utf8_ctype_override_injects_default_when_locale_unset() {
        assert_eq!(
            utf8_ctype_override(None, None, None),
            Some(DEFAULT_UTF8_CTYPE)
        );
    }

    #[test]
    fn utf8_ctype_override_injects_for_non_utf8_or_empty_locale() {
        assert_eq!(
            utf8_ctype_override(None, None, Some("C")),
            Some(DEFAULT_UTF8_CTYPE)
        );
        assert_eq!(
            utf8_ctype_override(None, None, Some("")),
            Some(DEFAULT_UTF8_CTYPE)
        );
    }

    #[test]
    fn utf8_ctype_override_preserves_inherited_utf8_locale() {
        assert_eq!(utf8_ctype_override(None, None, Some("en_US.UTF-8")), None);
        assert_eq!(utf8_ctype_override(None, Some("zh_CN.UTF-8"), None), None);
        assert_eq!(utf8_ctype_override(Some("en_US.utf8"), None, None), None);
    }

    #[test]
    fn utf8_ctype_override_follows_posix_precedence() {
        // LC_ALL (UTF-8) wins even when LANG is non-UTF-8.
        assert_eq!(
            utf8_ctype_override(Some("en_US.UTF-8"), None, Some("C")),
            None
        );
        // A non-UTF-8 LC_CTYPE overrides a UTF-8 LANG, so injection still wins.
        assert_eq!(
            utf8_ctype_override(None, Some("C"), Some("en_US.UTF-8")),
            Some(DEFAULT_UTF8_CTYPE)
        );
    }

    #[test]
    fn locale_env_plan_clears_non_utf8_lc_all_when_injecting() {
        // A non-UTF-8 LC_ALL is effective and would override an injected
        // LC_CTYPE, so it must be cleared alongside the injection.
        let plan = locale_env_plan(Some("C"), None, None);
        assert_eq!(plan.ctype, Some(DEFAULT_UTF8_CTYPE));
        assert!(plan.clear_lc_all);

        // Even when a lower-precedence UTF-8 locale exists, the non-UTF-8
        // LC_ALL still wins, so both the injection and the clear must happen.
        let plan = locale_env_plan(Some("POSIX"), None, Some("de_DE.UTF-8"));
        assert_eq!(plan.ctype, Some(DEFAULT_UTF8_CTYPE));
        assert!(plan.clear_lc_all);
    }

    #[test]
    fn locale_env_plan_keeps_lc_all_when_no_override() {
        // A UTF-8 LC_ALL needs no override and must not be cleared.
        let plan = locale_env_plan(Some("en_US.UTF-8"), None, Some("C"));
        assert_eq!(plan.ctype, None);
        assert!(!plan.clear_lc_all);
    }

    #[test]
    fn locale_env_plan_does_not_clear_unset_or_empty_lc_all() {
        // No LC_ALL: inject LC_CTYPE only, nothing to clear.
        let plan = locale_env_plan(None, None, Some("C"));
        assert_eq!(plan.ctype, Some(DEFAULT_UTF8_CTYPE));
        assert!(!plan.clear_lc_all);

        // Empty LC_ALL behaves as unset under POSIX, so it need not be cleared.
        let plan = locale_env_plan(Some(""), None, Some("C"));
        assert_eq!(plan.ctype, Some(DEFAULT_UTF8_CTYPE));
        assert!(!plan.clear_lc_all);
    }

    #[tokio::test]
    async fn spawn_pty_creates_session() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let request = SpawnPtyRequest {
            session_id: "test-session".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        let result = spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request).await;

        assert!(result.is_ok(), "spawn_pty should succeed");
        let session = result.unwrap();
        assert_eq!(session.id, "test-session");
        assert!(session.pid > 0);

        // Cleanup
        let _ = state.remove(&"test-session".to_string());
    }

    #[tokio::test]
    async fn spawn_pty_agent_bridge_env_writes_status_file_with_path_chars() {
        let (state, cache, events, temp_dir) = create_test_state_with_cache();
        let cwd = temp_dir.path().join("workspace with spaces and quote's");
        std::fs::create_dir_all(&cwd).expect("create cwd");
        let session_id = "bridge-live-test".to_string();
        let status_path = cwd
            .join(".vimeflow")
            .join("sessions")
            .join(&session_id)
            .join("status.json");

        let request = SpawnPtyRequest {
            session_id: session_id.clone(),
            cwd: cwd.to_string_lossy().to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: true,
        };

        let result = spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request).await;

        assert!(result.is_ok(), "spawn_pty should succeed: {result:?}");
        assert!(
            status_path.parent().expect("status parent").exists(),
            "spawn_pty should create the bridge session directory"
        );

        write_pty_inner(
            &state,
            WritePtyRequest {
                session_id: session_id.clone(),
                data: "printf '%s' '{\"ok\":true}' > \"$VIMEFLOW_STATUS_FILE\"\n".to_string(),
            },
        )
        .expect("write status command");

        let written = (0..160)
            .find_map(|_| match std::fs::read_to_string(&status_path) {
                Ok(value) if value == "{\"ok\":true}" => Some(value),
                _ => {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                    None
                }
            })
            .expect("shell should write the configured VIMEFLOW_STATUS_FILE");

        assert_eq!(written, "{\"ok\":true}");

        kill_pty_inner(
            &state,
            &cache,
            KillPtyRequest {
                session_id: session_id.clone(),
            },
        )
        .expect("kill bridge test session");
    }

    #[tokio::test]
    async fn write_pty_fails_for_nonexistent_session() {
        let (state, _cache, _events, _temp_dir) = create_test_state_with_cache();

        let request = WritePtyRequest {
            session_id: "nonexistent".to_string(),
            data: "test\n".to_string(),
        };

        let result = write_pty_inner(&state, request);

        assert!(
            result.is_err(),
            "write_pty should fail for nonexistent session"
        );
    }

    #[tokio::test]
    async fn resize_pty_fails_for_nonexistent_session() {
        let (state, _cache, _events, _temp_dir) = create_test_state_with_cache();

        let request = ResizePtyRequest {
            session_id: "nonexistent".to_string(),
            rows: 24,
            cols: 80,
        };

        let result = resize_pty_inner(&state, request);

        assert!(
            result.is_err(),
            "resize_pty should fail for nonexistent session"
        );
    }

    #[tokio::test]
    async fn kill_pty_removes_session() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        // First spawn a session
        let spawn_request = SpawnPtyRequest {
            session_id: "test-kill".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty_inner(state.clone(), cache.clone(), events.clone(), spawn_request)
            .await
            .expect("spawn should succeed");

        // Give background reader task time to initialize session
        std::thread::sleep(std::time::Duration::from_millis(50));

        // Verify session exists
        assert!(state.contains(&"test-kill".to_string()));

        // Kill it
        let _ = state.remove(&"test-kill".to_string());

        assert!(
            !state.contains(&"test-kill".to_string()),
            "session should be removed after kill"
        );
    }

    #[tokio::test]
    async fn write_pty_succeeds_multiple_times() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        // Spawn a session
        let spawn_request = SpawnPtyRequest {
            session_id: "test-multi-write".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty_inner(state.clone(), cache.clone(), events.clone(), spawn_request)
            .await
            .expect("spawn should succeed");

        // Write first command
        let write1 = WritePtyRequest {
            session_id: "test-multi-write".to_string(),
            data: "echo hello\n".to_string(),
        };

        let result1 = write_pty_inner(&state, write1);
        assert!(result1.is_ok(), "first write should succeed");

        // Write second command - this exposes the bug
        let write2 = WritePtyRequest {
            session_id: "test-multi-write".to_string(),
            data: "echo world\n".to_string(),
        };

        let result2 = write_pty_inner(&state, write2);
        assert!(
            result2.is_ok(),
            "second write should succeed (bug: take_writer consumes writer)"
        );

        // Write third command
        let write3 = WritePtyRequest {
            session_id: "test-multi-write".to_string(),
            data: "exit\n".to_string(),
        };

        let result3 = write_pty_inner(&state, write3);
        assert!(result3.is_ok(), "third write should succeed");

        // Cleanup
        let _ = state.remove(&"test-multi-write".to_string());
    }

    #[tokio::test]
    async fn session_remains_accessible_during_reader_startup() {
        // This test verifies the fix for the race condition where session was
        // temporarily removed from state during reader cloning, causing concurrent
        // writes/resizes to fail with "session not found"
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        // Spawn a session (this starts the background reader task)
        let spawn_request = SpawnPtyRequest {
            session_id: "test-race".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty_inner(state.clone(), cache.clone(), events.clone(), spawn_request)
            .await
            .expect("spawn should succeed");

        // Immediately try to write (before reader task finishes initialization)
        // This would fail with the old code that removed session from state
        let write_request = WritePtyRequest {
            session_id: "test-race".to_string(),
            data: "echo test\n".to_string(),
        };

        let write_result = write_pty_inner(&state, write_request);
        assert!(
            write_result.is_ok(),
            "write should succeed immediately after spawn (session must remain in state)"
        );

        // Also verify resize works
        let resize_request = ResizePtyRequest {
            session_id: "test-race".to_string(),
            rows: 40,
            cols: 120,
        };

        let resize_result = resize_pty_inner(&state, resize_request);
        assert!(
            resize_result.is_ok(),
            "resize should succeed immediately after spawn (session must remain in state)"
        );

        // Cleanup
        let _ = state.remove(&"test-race".to_string());
    }

    #[tokio::test]
    async fn spawn_pty_returns_error_on_existing_session_id() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let request = SpawnPtyRequest {
            session_id: "duplicate-id".to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        // First spawn should succeed
        let result1 = spawn_pty_inner(
            state.clone(),
            cache.clone(),
            events.clone(),
            request.clone(),
        )
        .await;
        assert!(result1.is_ok(), "first spawn should succeed");

        // Second spawn with same ID should fail
        let result2 = spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request).await;
        assert!(result2.is_err(), "second spawn with same ID should fail");
        assert!(
            result2.unwrap_err().contains("already exists"),
            "error should mention session already exists"
        );

        // Cleanup
        let _ = state.remove(&"duplicate-id".to_string());
    }

    #[tokio::test]
    async fn spawn_pty_appends_to_session_order_and_promotes_active() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Spawn first session
        let request1 = SpawnPtyRequest {
            session_id: "session-1".to_string(),
            cwd: cwd.clone(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request1)
            .await
            .expect("first spawn should succeed");

        // Check cache: session-1 should be active and first in order
        let snap1 = cache.snapshot();
        assert_eq!(snap1.active_session_id.as_deref(), Some("session-1"));
        assert_eq!(snap1.session_order, vec!["session-1"]);
        assert!(snap1.sessions.contains_key("session-1"));

        // Spawn second session
        let request2 = SpawnPtyRequest {
            session_id: "session-2".to_string(),
            cwd,
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };

        spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request2)
            .await
            .expect("second spawn should succeed");

        // Check cache: session-1 still active, session-2 appended to order
        let snap2 = cache.snapshot();
        assert_eq!(snap2.active_session_id.as_deref(), Some("session-1"));
        assert_eq!(snap2.session_order, vec!["session-1", "session-2"]);
        assert!(snap2.sessions.contains_key("session-2"));

        // Cleanup
        let _ = state.remove(&"session-1".to_string());
        let _ = state.remove(&"session-2".to_string());
    }

    #[tokio::test]
    async fn spawn_pty_caps_at_64_active_sessions() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd_temp_dir = TempDir::new().expect("failed to create cwd temp dir");
        let cwd = cwd_temp_dir.path().to_string_lossy().to_string();

        // Spawn 64 sessions
        for i in 0..64 {
            let request = SpawnPtyRequest {
                session_id: format!("session-{}", i),
                cwd: cwd.clone(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            };

            spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request)
                .await
                .expect(&format!("spawn {} should succeed", i));
        }

        // 65th session should fail
        let request_65 = SpawnPtyRequest {
            session_id: "session-65".to_string(),
            cwd,
            shell: None,
            env: None,
            enable_agent_bridge: true,
        };
        let rejected_bridge_dir = cwd_temp_dir
            .path()
            .join(".vimeflow")
            .join("sessions")
            .join("session-65");

        let result =
            spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request_65).await;
        assert!(result.is_err(), "65th spawn should fail due to cap");
        let err = result.unwrap_err();
        assert!(
            err.contains("maximum") || err.contains("64"),
            "error should mention session cap"
        );
        assert!(
            !rejected_bridge_dir.exists(),
            "failed spawn should remove generated bridge directory"
        );

        // Cleanup: remove all 64 sessions
        for i in 0..64 {
            let _ = state.remove(&format!("session-{}", i));
        }
    }

    #[tokio::test]
    async fn kill_pty_is_idempotent_for_missing_session() {
        let (state, cache, _events, _temp_dir) = create_test_state_with_cache();

        let request = KillPtyRequest {
            session_id: "nonexistent".to_string(),
        };

        let result = kill_pty_inner(&state, &cache, request);
        assert!(
            result.is_ok(),
            "kill_pty should be idempotent for missing session"
        );
    }

    /// Fake `Child` whose `kill()` returns an `io::Error` — exercises the
    /// `KillError::KillFailed` branch in the kill_pty regression test below.
    /// Mirrors the helper in `state::tests` (kept duplicated to avoid
    /// re-exporting `tests` modules across files).
    #[derive(Debug)]
    struct FailingKillChild;

    impl portable_pty::ChildKiller for FailingKillChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "synthetic kill failure",
            ))
        }
        fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
            Box::new(FailingKillChild)
        }
    }

    impl portable_pty::Child for FailingKillChild {
        fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
            Ok(None)
        }
        fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
            Ok(portable_pty::ExitStatus::with_exit_code(0))
        }
        fn process_id(&self) -> Option<u32> {
            Some(1)
        }
    }

    fn make_failing_kill_session() -> crate::terminal::state::ManagedSession {
        use crate::terminal::state::{ManagedSession, RingBuffer};
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        // Spawn a no-op child and reap immediately. We only need the pair to
        // source a real master + writer of the correct trait-object types;
        // the synthetic child below replaces the real one for the kill path.
        let cmd = CommandBuilder::new(test_true_path());
        let mut helper_child = pty_pair.slave.spawn_command(cmd).expect("spawn");
        let _ = helper_child.wait();
        let writer = pty_pair.master.take_writer().expect("take_writer");
        ManagedSession {
            master: pty_pair.master,
            writer,
            child: Box::new(FailingKillChild),
            cwd: "/tmp".into(),
            shim_dir: None,
            generation: 0,
            ring: Arc::new(Mutex::new(RingBuffer::new(64))),
            cancelled: Arc::new(AtomicBool::new(false)),
            started_at: std::time::SystemTime::now(),
        }
    }

    fn test_true_path() -> &'static str {
        if cfg!(target_os = "macos") {
            "/usr/bin/true"
        } else {
            "/bin/true"
        }
    }

    /// Round 9, Finding 1 (codex P1) regression — when `state.kill` returns
    /// `KillError::KillFailed` (the session IS in `PtyState` but the OS-level
    /// `child.kill()` syscall failed), `kill_pty` must propagate the error
    /// AND leave both `PtyState` and the cache untouched. The previous
    /// implementation swallowed every error and unconditionally cleaned up,
    /// so a failed kill silently orphaned the live PTY child while React
    /// believed the tab was gone.
    ///
    /// The fake child below is wired through `state.insert` (test-only),
    /// not `spawn_pty`, so the cache entry has to be primed manually to
    /// match what `spawn_pty` would have written.
    #[tokio::test]
    async fn kill_pty_preserves_state_and_cache_when_child_kill_fails() {
        use crate::terminal::cache::CachedSession;

        let (state, cache, _events, _temp_dir) = create_test_state_with_cache();

        let id = "stuck-session".to_string();

        // Seed PtyState with a session whose child.kill() always errors.
        state.insert(id.clone(), make_failing_kill_session());

        // Mirror the cache entry spawn_pty would have written so we can
        // verify it survives the failed kill.
        cache
            .mutate(|data| {
                data.sessions.insert(
                    id.clone(),
                    CachedSession {
                        cwd: "/tmp".to_string(),
                        created_at: "2026-04-25T00:00:00Z".to_string(),
                        exited: false,
                        last_exit_code: None,
                        activity_panel_collapsed: None,
                    },
                );
                data.session_order.push(id.clone());
                data.active_session_id = Some(id.clone());
                Ok(())
            })
            .expect("seed cache");

        let request = KillPtyRequest {
            session_id: id.clone(),
        };
        let result = kill_pty_inner(&state, &cache, request);

        // The OS-level kill syscall failed; kill_pty must surface that.
        let err = match result {
            Err(e) => e,
            Ok(()) => panic!("expected Err propagating KillFailed, got Ok"),
        };
        assert!(
            err.contains("synthetic kill failure"),
            "error should carry the underlying kill message, got {err:?}"
        );

        // PtyState retained — the user (or a retry) needs to see the
        // session so they can try again instead of orphaning the child.
        assert!(
            state.contains(&id),
            "session must remain in PtyState when kill failed"
        );

        // Cache untouched — no removal from session_order, sessions map,
        // or rotation of active_session_id.
        let snap = cache.snapshot();
        assert!(
            snap.session_order.iter().any(|x| x == &id),
            "session must remain in session_order"
        );
        assert!(
            snap.sessions.contains_key(&id),
            "session metadata must remain in cache"
        );
        assert_eq!(
            snap.active_session_id.as_deref(),
            Some(id.as_str()),
            "active_session_id must not rotate when kill failed"
        );

        // Cleanup: drop the synthetic session so the next test starts clean.
        let _ = state.remove(&id);
    }

    #[tokio::test]
    async fn kill_pty_removes_from_session_order_and_cache() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Spawn two sessions
        let request1 = SpawnPtyRequest {
            session_id: "session-1".to_string(),
            cwd: cwd.clone(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };
        spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request1)
            .await
            .expect("first spawn should succeed");

        let request2 = SpawnPtyRequest {
            session_id: "session-2".to_string(),
            cwd,
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };
        spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request2)
            .await
            .expect("second spawn should succeed");

        // Verify both sessions are in cache
        let snap_before = cache.snapshot();
        assert_eq!(snap_before.session_order, vec!["session-1", "session-2"]);
        assert!(snap_before.sessions.contains_key("session-1"));
        assert!(snap_before.sessions.contains_key("session-2"));

        // Kill session-1
        let kill_request = KillPtyRequest {
            session_id: "session-1".to_string(),
        };
        kill_pty_inner(&state, &cache, kill_request).expect("kill_pty should succeed");

        // Verify session-1 is removed from session_order and sessions map
        let snap_after = cache.snapshot();
        assert_eq!(snap_after.session_order, vec!["session-2"]);
        assert!(!snap_after.sessions.contains_key("session-1"));
        assert!(snap_after.sessions.contains_key("session-2"));

        // Cleanup
        let _ = state.remove(&"session-2".to_string());
    }

    #[tokio::test]
    async fn kill_pty_clears_active_when_active_killed() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Spawn three sessions
        let request1 = SpawnPtyRequest {
            session_id: "session-1".to_string(),
            cwd: cwd.clone(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };
        spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request1)
            .await
            .expect("first spawn should succeed");

        let request2 = SpawnPtyRequest {
            session_id: "session-2".to_string(),
            cwd: cwd.clone(),
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };
        spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request2)
            .await
            .expect("second spawn should succeed");

        let request3 = SpawnPtyRequest {
            session_id: "session-3".to_string(),
            cwd,
            shell: None,
            env: None,
            enable_agent_bridge: false,
        };
        spawn_pty_inner(state.clone(), cache.clone(), events.clone(), request3)
            .await
            .expect("third spawn should succeed");

        // Verify session-1 is active
        let snap_before = cache.snapshot();
        assert_eq!(snap_before.active_session_id.as_deref(), Some("session-1"));
        assert_eq!(
            snap_before.session_order,
            vec!["session-1", "session-2", "session-3"]
        );

        // Kill session-1 (the active session)
        let kill_request = KillPtyRequest {
            session_id: "session-1".to_string(),
        };
        kill_pty_inner(&state, &cache, kill_request).expect("kill_pty should succeed");

        // Verify active_session_id is unresolved until the frontend persists
        // its selected same-position neighbor via set_active_session.
        let snap_after = cache.snapshot();
        assert!(snap_after.active_session_id.is_none());
        assert_eq!(snap_after.session_order, vec!["session-2", "session-3"]);

        // Cleanup
        let _ = state.remove(&"session-2".to_string());
        let _ = state.remove(&"session-3".to_string());
    }

    // PR #290 cycle 18 — Claude MEDIUM. kill_pty was only removing the
    // killed PTY's grouping entry but left sibling groupings in the same
    // workspace at the pre-kill (layout, pane_index) values. In the
    // crash window between kill_pty and the next set_workspace_sessions
    // push, restore would reconstruct the workspace at the stale layout
    // (e.g. quad with an empty slot). kill_pty now re-indexes survivors
    // and shrinks the layout to match the new pane count.
    #[tokio::test]
    async fn kill_pty_reindexes_sibling_groupings_in_same_workspace() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Spawn four PTYs that share one quad workspace.
        for id in ["pty-a", "pty-b", "pty-c", "pty-d"] {
            spawn_pty_inner(
                state.clone(),
                cache.clone(),
                events.clone(),
                SpawnPtyRequest {
                    session_id: id.into(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .expect("spawn should succeed");
        }

        set_workspace_sessions_inner(
            &cache,
            SetWorkspaceSessionsRequest {
                sessions: vec![WorkspaceSessionSnapshot {
                    id: "ws-quad".into(),
                    layout: "quad".into(),
                    working_directory: Some(cwd.clone()),
                    panes: vec![
                        WorkspacePaneSnapshot {
                            pty_id: "pty-a".into(),
                            pane_id: "p0".into(),
                            pane_index: 0,
                            agent_type: "claude-code".into(),
                            active: true,
                        },
                        WorkspacePaneSnapshot {
                            pty_id: "pty-b".into(),
                            pane_id: "p1".into(),
                            pane_index: 1,
                            agent_type: "generic".into(),
                            active: false,
                        },
                        WorkspacePaneSnapshot {
                            pty_id: "pty-c".into(),
                            pane_id: "p2".into(),
                            pane_index: 2,
                            agent_type: "generic".into(),
                            active: false,
                        },
                        WorkspacePaneSnapshot {
                            pty_id: "pty-d".into(),
                            pane_id: "p3".into(),
                            pane_index: 3,
                            agent_type: "generic".into(),
                            active: false,
                        },
                    ],
                }],
            },
        )
        .expect("set_workspace_sessions should succeed");

        // Kill the middle pane (pane_index = 2).
        kill_pty_inner(
            &state,
            &cache,
            KillPtyRequest {
                session_id: "pty-c".into(),
            },
        )
        .expect("kill_pty should succeed");

        let snap = cache.snapshot();

        // Killed pane's grouping gone.
        assert!(!snap.groupings.contains_key("pty-c"));

        // Three survivors re-indexed 0/1/2 in original pane_index order,
        // layout shrunk to threeRight (3-capacity), pane_id renumbered.
        let a = snap.groupings.get("pty-a").expect("pty-a grouping");
        let b = snap.groupings.get("pty-b").expect("pty-b grouping");
        let d = snap.groupings.get("pty-d").expect("pty-d grouping");

        for g in [a, b, d] {
            assert_eq!(g.layout, "threeRight");
            assert_eq!(g.workspace_session_id, "ws-quad");
        }

        assert_eq!(a.pane_index, 0);
        assert_eq!(a.pane_id, "p0");
        assert!(a.active, "originally active pane stays active");
        assert_eq!(b.pane_index, 1);
        assert_eq!(b.pane_id, "p1");
        assert!(!b.active);
        assert_eq!(d.pane_index, 2);
        assert_eq!(d.pane_id, "p2");
        assert!(!d.active);

        for id in ["pty-a", "pty-b", "pty-d"] {
            let _ = state.remove(&id.to_string());
        }
    }

    // Cycle 18 follow-up: when the killed pane was active and survivors
    // remain, the first surviving pane (by pane_index) is promoted to
    // active so restore always has exactly one active pane per workspace.
    #[tokio::test]
    async fn kill_pty_promotes_first_sibling_when_active_killed() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        for id in ["pty-a", "pty-b"] {
            spawn_pty_inner(
                state.clone(),
                cache.clone(),
                events.clone(),
                SpawnPtyRequest {
                    session_id: id.into(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .expect("spawn should succeed");
        }

        // pty-b is active; we'll kill it and expect pty-a to be promoted.
        set_workspace_sessions_inner(
            &cache,
            SetWorkspaceSessionsRequest {
                sessions: vec![WorkspaceSessionSnapshot {
                    id: "ws-vs".into(),
                    layout: "vsplit".into(),
                    working_directory: Some(cwd.clone()),
                    panes: vec![
                        WorkspacePaneSnapshot {
                            pty_id: "pty-a".into(),
                            pane_id: "p0".into(),
                            pane_index: 0,
                            agent_type: "generic".into(),
                            active: false,
                        },
                        WorkspacePaneSnapshot {
                            pty_id: "pty-b".into(),
                            pane_id: "p1".into(),
                            pane_index: 1,
                            agent_type: "generic".into(),
                            active: true,
                        },
                    ],
                }],
            },
        )
        .expect("set_workspace_sessions should succeed");

        kill_pty_inner(
            &state,
            &cache,
            KillPtyRequest {
                session_id: "pty-b".into(),
            },
        )
        .expect("kill_pty should succeed");

        let snap = cache.snapshot();
        let a = snap.groupings.get("pty-a").expect("pty-a grouping");
        assert_eq!(a.layout, "single");
        assert_eq!(a.pane_index, 0);
        assert_eq!(a.pane_id, "p0");
        assert!(
            a.active,
            "first surviving pane promoted to active when the killed pane was active"
        );

        let _ = state.remove(&"pty-a".to_string());
    }

    // Cycle 18 codex-verify rev 2: when the killed pane was the LAST in
    // its grouped workspace, the no-survivor branch must not bypass the
    // `active_session_id` cleanup that runs later in the same
    // `cache.mutate` closure. The original draft used `return Ok(())`
    // inside the closure for the zero-sibling case, which exited the
    // whole closure and left a dangling active id pointing at a removed
    // PTY. The fix structures the sibling-repair as an `if let
    // Some(layout)` so the no-survivor case falls through.
    #[tokio::test]
    async fn kill_pty_clears_active_when_last_grouped_pane_killed() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        spawn_pty_inner(
            state.clone(),
            cache.clone(),
            events.clone(),
            SpawnPtyRequest {
                session_id: "pty-only".into(),
                cwd: cwd.clone(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .expect("spawn should succeed");

        set_workspace_sessions_inner(
            &cache,
            SetWorkspaceSessionsRequest {
                sessions: vec![WorkspaceSessionSnapshot {
                    id: "ws-solo".into(),
                    layout: "single".into(),
                    working_directory: Some(cwd),
                    panes: vec![WorkspacePaneSnapshot {
                        pty_id: "pty-only".into(),
                        pane_id: "p0".into(),
                        pane_index: 0,
                        agent_type: "generic".into(),
                        active: true,
                    }],
                }],
            },
        )
        .expect("set_workspace_sessions should succeed");

        // spawn_pty_inner sets active; confirm precondition.
        assert_eq!(
            cache.snapshot().active_session_id.as_deref(),
            Some("pty-only")
        );

        kill_pty_inner(
            &state,
            &cache,
            KillPtyRequest {
                session_id: "pty-only".into(),
            },
        )
        .expect("kill_pty should succeed");

        let snap = cache.snapshot();
        assert!(
            snap.active_session_id.is_none(),
            "active_session_id must be cleared for the killed pane even when its workspace has no surviving siblings"
        );
        assert!(!snap.groupings.contains_key("pty-only"));
    }

    #[tokio::test]
    async fn read_loop_eof_marks_cache_exited() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        spawn_pty_inner(
            state.clone(),
            cache.clone(),
            events.clone(),
            SpawnPtyRequest {
                session_id: "eof-test".into(),
                cwd,
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        // Force EOF by sending exit
        write_pty_inner(
            &state,
            WritePtyRequest {
                session_id: "eof-test".into(),
                data: "exit\n".into(),
            },
        )
        .unwrap();

        let mut exited = false;
        for _ in 0..100 {
            let snap = cache.snapshot();
            let entry = snap
                .sessions
                .get("eof-test")
                .expect("session should still be in cache after exit");
            if entry.exited {
                exited = true;
                break;
            }

            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }

        assert!(exited, "cache entry should be marked exited after EOF");
    }

    #[tokio::test]
    async fn list_sessions_returns_alive_for_running_pty() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        spawn_pty_inner(
            state.clone(),
            cache.clone(),
            events.clone(),
            SpawnPtyRequest {
                session_id: "alive-1".into(),
                cwd: std::env::current_dir()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        let result = list_sessions_inner(&state, &cache).unwrap();
        assert_eq!(result.sessions.len(), 1);
        assert_eq!(result.sessions[0].id, "alive-1");
        assert!(matches!(
            result.sessions[0].status,
            SessionStatus::Alive { .. }
        ));

        let _ = kill_pty_inner(
            &state,
            &cache,
            KillPtyRequest {
                session_id: "alive-1".into(),
            },
        );
    }

    #[tokio::test]
    async fn list_sessions_reconciles_alive_cache_with_empty_pty_state() {
        use crate::terminal::cache;

        let (state, cache_state, _events, _temp_dir) = create_test_state_with_cache();

        // Manually plant an "alive but missing" entry in the cache
        cache_state
            .mutate(|d| {
                d.session_order.push("phantom".into());
                d.sessions.insert(
                    "phantom".into(),
                    cache::CachedSession {
                        cwd: "/tmp".into(),
                        created_at: "2026-04-25T00:00:00Z".into(),
                        exited: false,
                        last_exit_code: None,
                        activity_panel_collapsed: None,
                    },
                );
                Ok(())
            })
            .unwrap();

        let result = list_sessions_inner(&state, &cache_state).unwrap();
        assert_eq!(result.sessions.len(), 1);
        match &result.sessions[0].status {
            SessionStatus::Exited { last_exit_code } => assert_eq!(*last_exit_code, None),
            other => panic!("expected Exited, got {:?}", other),
        }

        // Verify lazy reconciliation flushed back to cache
        let snap = cache_state.snapshot();
        assert!(snap.sessions["phantom"].exited);
    }

    /// Round 14, Claude MEDIUM: when lazy reconciliation flips the active
    /// session to Exited, list_sessions must rotate active_session_id in
    /// both the response AND the cache so callers don't see an Exited
    /// session as the "active" one.
    #[tokio::test]
    async fn list_sessions_rotates_active_id_when_reconciled_to_exited() {
        use crate::terminal::cache;

        let (state, cache_state, events, _temp_dir) = create_test_state_with_cache();

        // Spawn a real Alive session first so there's a rotation target.
        spawn_pty_inner(
            state.clone(),
            cache_state.clone(),
            events.clone(),
            SpawnPtyRequest {
                session_id: "alive-real".into(),
                cwd: std::env::current_dir()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        // Plant a phantom alive cache entry AND make it the active id.
        // session_order ordering matters — put phantom FIRST so rotation
        // has to scan past it to find alive-real.
        cache_state
            .mutate(|d| {
                d.session_order.insert(0, "phantom".into());
                d.sessions.insert(
                    "phantom".into(),
                    cache::CachedSession {
                        cwd: "/tmp".into(),
                        created_at: "2026-04-25T00:00:00Z".into(),
                        exited: false,
                        last_exit_code: None,
                        activity_panel_collapsed: None,
                    },
                );
                d.active_session_id = Some("phantom".into());
                Ok(())
            })
            .unwrap();

        let result = list_sessions_inner(&state, &cache_state).unwrap();

        // Response active_session_id rotated away from phantom to alive-real.
        assert_eq!(result.active_session_id, Some("alive-real".into()));

        // Cache also persisted the rotation so subsequent calls are consistent.
        let snap = cache_state.snapshot();
        assert_eq!(snap.active_session_id, Some("alive-real".into()));
        assert!(snap.sessions["phantom"].exited);

        // Cleanup: kill the live session so the test doesn't leak a process.
        let _ = kill_pty_inner(
            &state,
            &cache_state,
            KillPtyRequest {
                session_id: "alive-real".into(),
            },
        );
    }

    #[tokio::test]
    async fn list_sessions_returns_in_session_order() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for id in &["zebra", "alpha", "mike"] {
            spawn_pty_inner(
                state.clone(),
                cache.clone(),
                events.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .unwrap();
        }

        let result = list_sessions_inner(&state, &cache).unwrap();
        let ids: Vec<_> = result.sessions.iter().map(|s| s.id.clone()).collect();
        assert_eq!(ids, vec!["zebra", "alpha", "mike"]);

        for id in &["zebra", "alpha", "mike"] {
            let _ = kill_pty_inner(
                &state,
                &cache,
                KillPtyRequest {
                    session_id: id.to_string(),
                },
            );
        }
    }

    #[tokio::test]
    async fn list_sessions_replay_end_offset_matches_buffer_contents() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        spawn_pty_inner(
            state.clone(),
            cache.clone(),
            events.clone(),
            SpawnPtyRequest {
                session_id: "off-test".into(),
                cwd: std::env::current_dir()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        // Write some output and let the read loop process
        write_pty_inner(
            &state,
            WritePtyRequest {
                session_id: "off-test".into(),
                data: "echo hello\n".into(),
            },
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));

        let result = list_sessions_inner(&state, &cache).unwrap();
        match &result.sessions[0].status {
            SessionStatus::Alive {
                replay_data,
                replay_end_offset,
                ..
            } => {
                // Ring buffer contents may be longer than just the echo
                // (prompt, command echo, output, new prompt)
                let bytes_in_buffer = replay_data.bytes().count() as u64;
                // end_offset >= buffer length (truncation tolerance)
                assert!(
                    *replay_end_offset >= bytes_in_buffer,
                    "end_offset {} < buffer len {}",
                    replay_end_offset,
                    bytes_in_buffer
                );
            }
            other => panic!("expected Alive, got {:?}", other),
        }

        let _ = kill_pty_inner(
            &state,
            &cache,
            KillPtyRequest {
                session_id: "off-test".into(),
            },
        );
    }

    #[tokio::test]
    async fn set_active_session_persists_to_cache() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for id in &["a", "b"] {
            spawn_pty_inner(
                state.clone(),
                cache.clone(),
                events.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .unwrap();
        }

        set_active_session_inner(&cache, SetActiveSessionRequest { id: "b".into() }).unwrap();

        assert_eq!(cache.snapshot().active_session_id.as_deref(), Some("b"));

        for id in &["a", "b"] {
            let _ = kill_pty_inner(
                &state,
                &cache,
                KillPtyRequest {
                    session_id: id.to_string(),
                },
            );
        }
    }

    #[test]
    fn set_active_session_rejects_unknown_id() {
        let (_state, cache, _events, _temp_dir) = create_test_state_with_cache();

        let result =
            set_active_session_inner(&cache, SetActiveSessionRequest { id: "nope".into() });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown session"));
    }

    #[tokio::test]
    async fn reorder_sessions_persists_to_cache() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for id in &["a", "b", "c"] {
            spawn_pty_inner(
                state.clone(),
                cache.clone(),
                events.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .unwrap();
        }

        reorder_sessions_inner(
            &cache,
            ReorderSessionsRequest {
                ids: vec!["c".into(), "a".into(), "b".into()],
            },
        )
        .unwrap();

        assert_eq!(cache.snapshot().session_order, vec!["c", "a", "b"]);

        for id in &["a", "b", "c"] {
            let _ = kill_pty_inner(
                &state,
                &cache,
                KillPtyRequest {
                    session_id: id.to_string(),
                },
            );
        }
    }

    #[tokio::test]
    async fn reorder_sessions_rejects_non_permutation() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        spawn_pty_inner(
            state.clone(),
            cache.clone(),
            events.clone(),
            SpawnPtyRequest {
                session_id: "only".into(),
                cwd: std::env::current_dir().unwrap().to_string_lossy().into(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        let result = reorder_sessions_inner(
            &cache,
            ReorderSessionsRequest {
                ids: vec!["only".into(), "extra".into()],
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a permutation"));

        let _ = kill_pty_inner(
            &state,
            &cache,
            KillPtyRequest {
                session_id: "only".into(),
            },
        );
    }

    /// Round 6, Finding 2 (codex HIGH): the permutation check must reject
    /// a request whose ids contain a duplicate already present in
    /// session_order, even though the SET of unique ids matches the SET in
    /// session_order. Sort+compare catches the length mismatch; the previous
    /// HashSet-based check let the duplicate through and persisted it,
    /// producing a duplicate session entry on reload (React key collision +
    /// unstable active-tab selection).
    #[tokio::test]
    async fn reorder_sessions_rejects_duplicate_id() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for id in &["a", "b", "c"] {
            spawn_pty_inner(
                state.clone(),
                cache.clone(),
                events.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .unwrap();
        }

        // Proposed order has the SAME unique ids as current ([a, b, c])
        // but adds a duplicate of `c`. HashSet equality would pass; the
        // multiset (sort+compare) catches the duplicate.
        let result = reorder_sessions_inner(
            &cache,
            ReorderSessionsRequest {
                ids: vec!["a".into(), "b".into(), "c".into(), "c".into()],
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a permutation"));

        // Cache must be unchanged — no duplicate `c` got persisted.
        let snapshot = cache.snapshot();
        assert_eq!(snapshot.session_order.len(), 3);
        assert!(snapshot.session_order.contains(&"a".to_string()));
        assert!(snapshot.session_order.contains(&"b".to_string()));
        assert!(snapshot.session_order.contains(&"c".to_string()));

        for id in &["a", "b", "c"] {
            let _ = kill_pty_inner(
                &state,
                &cache,
                KillPtyRequest {
                    session_id: id.to_string(),
                },
            );
        }
    }

    #[tokio::test]
    async fn update_session_cwd_persists_to_cache() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        spawn_pty_inner(
            state.clone(),
            cache.clone(),
            events.clone(),
            SpawnPtyRequest {
                session_id: "cwd-test".into(),
                cwd: cwd.clone(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .unwrap();

        // Round 8, Finding 4 (claude LOW): the OSC 7 path is canonicalized
        // BEFORE persisting. Pass `/tmp/./` (a non-canonical form) and assert
        // the stored value is the canonical `/tmp` (or `/private/tmp` on
        // macOS). Mirrors `spawn_pty`'s canonicalize step so reload sees the
        // same path the OS reports for the cwd.
        update_session_cwd_inner(
            &cache,
            UpdateSessionCwdRequest {
                id: "cwd-test".into(),
                cwd: "/tmp/./".into(),
            },
        )
        .unwrap();

        let stored = &cache.snapshot().sessions["cwd-test"].cwd;
        let expected_canonical = std::fs::canonicalize("/tmp")
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(stored, &expected_canonical);

        let _ = kill_pty_inner(
            &state,
            &cache,
            KillPtyRequest {
                session_id: "cwd-test".into(),
            },
        );
    }

    #[test]
    fn update_session_cwd_rejects_invalid_path() {
        let (_state, cache, _events, _temp_dir) = create_test_state_with_cache();

        let result = update_session_cwd_inner(
            &cache,
            UpdateSessionCwdRequest {
                id: "any".into(),
                cwd: "/nonexistent/totally/fake/path".into(),
            },
        );
        assert!(result.is_err());
        // Round 8, Finding 4 (claude LOW): canonicalize() fails on
        // non-existent paths before the is_dir check runs, so the error
        // message comes from std::fs::canonicalize ("No such file or
        // directory" on POSIX, similar on Windows). Just assert it's an
        // "invalid cwd" prefix and the upstream path failure produced
        // a recognizable error.
        let err = result.unwrap_err();
        assert!(
            err.contains("invalid cwd"),
            "expected 'invalid cwd' prefix, got: {err}"
        );
    }

    #[test]
    fn set_session_activity_panel_collapsed_inner_updates_cache() {
        let (_state, cache, _events, _temp_dir) = create_test_state_with_cache();
        cache
            .mutate(|d| {
                d.sessions.insert(
                    "pty-1".into(),
                    super::super::cache::CachedSession {
                        cwd: "/home/x".into(),
                        created_at: "2026-05-21T00:00:00Z".into(),
                        exited: false,
                        last_exit_code: None,
                        activity_panel_collapsed: None,
                    },
                );
                Ok(())
            })
            .unwrap();

        set_session_activity_panel_collapsed_inner(
            &cache,
            SetSessionActivityPanelCollapsedRequest {
                id: "pty-1".into(),
                collapsed: true,
            },
        )
        .unwrap();

        let snap = cache.snapshot();
        assert_eq!(
            snap.sessions.get("pty-1").unwrap().activity_panel_collapsed,
            Some(true)
        );
    }

    #[test]
    fn set_session_activity_panel_collapsed_inner_errors_when_session_missing() {
        let (_state, cache, _events, _temp_dir) = create_test_state_with_cache();

        let err = set_session_activity_panel_collapsed_inner(
            &cache,
            SetSessionActivityPanelCollapsedRequest {
                id: "ghost-pty".into(),
                collapsed: true,
            },
        )
        .unwrap_err();
        assert!(
            err.contains("session not found"),
            "expected `session not found` error, got: {err}"
        );
    }

    #[test]
    fn list_sessions_surfaces_activity_panel_collapsed() {
        let (state, cache, _events, _temp_dir) = create_test_state_with_cache();
        cache
            .mutate(|d| {
                d.sessions.insert(
                    "pty-1".into(),
                    super::super::cache::CachedSession {
                        cwd: "/home/x".into(),
                        created_at: "2026-05-21T00:00:00Z".into(),
                        exited: false,
                        last_exit_code: None,
                        activity_panel_collapsed: Some(true),
                    },
                );
                d.session_order.push("pty-1".into());
                Ok(())
            })
            .unwrap();

        let list = list_sessions_inner(&state, &cache).unwrap();
        let info = list
            .sessions
            .iter()
            .find(|s| s.id == "pty-1")
            .expect("session must surface");
        assert_eq!(info.activity_panel_collapsed, Some(true));
    }

    /// Round 4, Finding 3 (codex P2) regression test.
    ///
    /// The pre-fix `reorder_sessions` flow was:
    ///   1. snapshot → take HashSet of session_order under the lock
    ///   2. drop the lock
    ///   3. validate that request.ids is a permutation of the snapshot
    ///   4. take the lock AGAIN and assign d.session_order = request.ids
    ///
    /// Between (2) and (4) a concurrent mutation could change session_order.
    /// This test drives that race directly by mutating the cache from a
    /// helper thread between the snapshot/check and the assignment.
    ///
    /// We can't easily drive the race against the actual `reorder_sessions`
    /// async fn (no hook to inject between snapshot and mutate), so we
    /// assert the equivalent invariant on `cache.mutate`: a closure that
    /// observes the in-memory state through `&mut SessionCacheData` will
    /// always see the SAME state it then writes — i.e. the permutation
    /// check inside the closure cannot pass against an old state and then
    /// overwrite a newer one.
    #[test]
    fn reorder_sessions_validates_under_same_lock_as_write() {
        use crate::terminal::cache::CachedSession;
        use std::sync::Arc as StdArc;
        use std::thread;

        let temp_dir = TempDir::new().expect("temp");
        let cache =
            StdArc::new(SessionCache::load(temp_dir.path().join("sessions.json")).expect("load"));

        // Seed two sessions, "a" and "b", in a known order.
        let cache_seed = StdArc::clone(&cache);
        cache_seed
            .mutate(|d| {
                for id in ["a", "b"] {
                    d.session_order.push(id.into());
                    d.sessions.insert(
                        id.into(),
                        CachedSession {
                            cwd: "/tmp".into(),
                            created_at: "2026-04-25T00:00:00Z".into(),
                            exited: false,
                            last_exit_code: None,
                            activity_panel_collapsed: None,
                        },
                    );
                }
                Ok(())
            })
            .unwrap();

        // Thread A: emulates reorder_sessions(["b","a"]). Under the old
        // implementation it would snapshot, see {"a","b"} == {"b","a"} as
        // sets, then write d.session_order = ["b","a"] AFTER thread B
        // appended "c". With the round-4 fix, the validation runs INSIDE
        // the same mutate closure that does the write, so by the time the
        // closure observes session_order, it already contains "c" and the
        // permutation check rejects (request.ids missing "c").
        let cache_a = StdArc::clone(&cache);
        let handle_a = thread::spawn(move || {
            cache_a.mutate(|d| {
                let current: std::collections::HashSet<_> =
                    d.session_order.iter().cloned().collect();
                let proposed: std::collections::HashSet<_> =
                    ["b", "a"].iter().map(|s| (*s).to_string()).collect();
                if current != proposed {
                    return Err("invalid reorder: not a permutation".into());
                }
                d.session_order = vec!["b".into(), "a".into()];
                Ok(())
            })
        });

        // Thread B: emulates spawn_pty("c") inserting into session_order.
        // Without giving thread A a head start, the test-thread scheduler
        // may run B first; that's fine — both interleavings preserve the
        // invariant we're asserting (no session is lost).
        let cache_b = StdArc::clone(&cache);
        let handle_b = thread::spawn(move || {
            cache_b
                .mutate(|d| {
                    d.session_order.push("c".into());
                    d.sessions.insert(
                        "c".into(),
                        CachedSession {
                            cwd: "/tmp".into(),
                            created_at: "2026-04-25T00:00:00Z".into(),
                            exited: false,
                            last_exit_code: None,
                            activity_panel_collapsed: None,
                        },
                    );
                    Ok(())
                })
                .unwrap();
        });

        let result_a = handle_a.join().unwrap();
        handle_b.join().unwrap();

        let snap = cache.snapshot();

        // Strong invariant: session "c" must be in session_order. Under
        // the OLD code, this assertion could fail if thread A's stale
        // permutation check passed before thread B's write. Under the
        // new code, this invariant ALWAYS holds:
        //
        //   - If A locks first → A writes ["b","a"], B then appends → ["b","a","c"]
        //   - If B locks first → A's closure sees ["a","b","c"] and rejects;
        //     session_order stays ["a","b","c"]
        //
        // Either way "c" survives.
        assert!(
            snap.session_order.contains(&"c".to_string()),
            "race lost session 'c'; session_order = {:?}",
            snap.session_order
        );

        // Plus: if A succeeded, it must have observed B's write (so its
        // assignment was ["b","a"] only when B hadn't yet inserted "c");
        // if A failed, the order ends in [a,b,c] from B alone.
        if result_a.is_ok() {
            assert_eq!(snap.session_order, vec!["b", "a", "c"]);
        } else {
            assert_eq!(snap.session_order, vec!["a", "b", "c"]);
            assert!(result_a.unwrap_err().contains("not a permutation"));
        }
    }

    /// Round 4, Finding 3 (codex P2): a closure that returns Err must NOT
    /// leave the in-memory mirror partially modified. Without rollback, a
    /// closure that mutated `d` before validating would leave the cache in
    /// an invalid state visible via `snapshot()`.
    #[test]
    fn mutate_rolls_back_on_err() {
        let temp_dir = TempDir::new().expect("temp");
        let cache = SessionCache::load(temp_dir.path().join("sessions.json")).expect("load");

        cache
            .mutate(|d| {
                d.session_order.push("seed".into());
                Ok(())
            })
            .unwrap();

        let result = cache.mutate(|d| {
            d.session_order.push("partial".into());
            Err("validation failed".into())
        });
        assert!(result.is_err());

        // The in-memory mirror must be unchanged from before the failed
        // mutate — "partial" must NOT have leaked into session_order.
        let snap = cache.snapshot();
        assert_eq!(snap.session_order, vec!["seed".to_string()]);
    }

    /// Round 4, Finding 3 (codex P2) follow-up: set_active_session must
    /// reject ids not in session_order even when the check is now inside
    /// the mutate closure.
    #[test]
    fn set_active_session_rejects_unknown_id_under_lock() {
        let (_state, cache, _events, _temp_dir) = create_test_state_with_cache();

        let result =
            set_active_session_inner(&cache, SetActiveSessionRequest { id: "ghost".into() });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown session"));
        // Mirror unchanged — no half-written active id.
        assert!(cache.snapshot().active_session_id.is_none());
    }

    /// Round 4, Finding 3 (codex P2) follow-up: update_session_cwd must
    /// reject unknown ids under the same lock as the write — and must NOT
    /// leave a half-modified cwd if an entry exists but for a different id.
    #[test]
    fn update_session_cwd_rejects_unknown_id_under_lock() {
        let (_state, cache, _events, _temp_dir) = create_test_state_with_cache();

        let result = update_session_cwd_inner(
            &cache,
            UpdateSessionCwdRequest {
                id: "ghost".into(),
                cwd: "/tmp".into(),
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown session"));
        assert!(cache.snapshot().sessions.is_empty());
    }

    /// Round 7, Finding 1 (claude HIGH) regression test.
    ///
    /// Verifies the cache-first ordering in `spawn_pty`. Before the fix, the
    /// flow was:
    ///
    ///   1. spawn child (owned)
    ///   2. take_writer
    ///   3. state.insert(session)        // line 236
    ///   4. cache.mutate(...)?           // line 259, `?` propagates Err
    ///   5. spawn read loop
    ///
    /// If step (4) returned Err the function bailed via `?`, but step (3)
    /// had already moved the child into `PtyState`. The read loop in step
    /// (5) never started, so the PTY master's kernel buffer would fill and
    /// the child would block on stdout — and `list_sessions` iterates
    /// `cache.session_order` (NOT `PtyState`), so the orphan was permanently
    /// invisible to the frontend until app exit.
    ///
    /// The fixed flow is:
    ///
    ///   1. spawn child (owned, mut so we can kill on failure)
    ///   2. take_writer
    ///   3. cache.mutate(...) — if Err, kill+wait child and return Err
    ///   4. state.insert(session)        // infallible after this point
    ///   5. spawn read loop
    ///
    /// We use the `cache::test_force_mutate_err::arm` test hook to force
    /// step (3) to fail. Asserts:
    ///   - `spawn_pty` returns Err with "failed to write cache"
    ///   - `state.contains(session_id) == false` — no orphan in PtyState
    ///   - `cache.snapshot()` is unchanged — no half-written cache entry
    #[tokio::test]
    async fn spawn_pty_does_not_orphan_state_when_cache_mutate_fails() {
        use crate::terminal::cache::test_force_mutate_err;

        let (state, cache, events, _temp_dir) = create_test_state_with_cache();

        // Snapshot pre-state so we can verify the cache stayed unchanged.
        let pre_snapshot = cache.snapshot();
        assert!(pre_snapshot.session_order.is_empty());
        assert!(pre_snapshot.sessions.is_empty());
        assert!(pre_snapshot.active_session_id.is_none());

        // Force the next cache.mutate call (the one inside spawn_pty) to
        // return Err, simulating a disk-full / perm-denied write OR a
        // future closure that bails on validation under the lock.
        test_force_mutate_err::arm("simulated cache write failure");

        let result = spawn_pty_inner(
            state.clone(),
            cache.clone(),
            events.clone(),
            SpawnPtyRequest {
                session_id: "orphan-test".to_string(),
                cwd: std::env::current_dir()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await;

        // 1. spawn_pty must surface the cache failure to the caller.
        assert!(
            result.is_err(),
            "spawn_pty should fail when cache.mutate fails"
        );
        let err = result.unwrap_err();
        assert!(
            err.contains("failed to write cache"),
            "error should mention cache write failure, got: {}",
            err
        );

        // 2. PtyState must NOT contain the session — the previous code
        //    inserted into PtyState BEFORE the cache.mutate call, so this
        //    assertion would have caught the orphan: state.insert ran, the
        //    `?` from cache.mutate propagated Err, and the session was
        //    permanently stuck in PtyState with no read loop.
        assert!(
            !state.contains(&"orphan-test".to_string()),
            "PtyState must not contain the session — child should be reaped, not orphaned"
        );

        // 3. Cache must be unchanged — no half-written entry that a later
        //    list_sessions could surface as a phantom session.
        let post_snapshot = cache.snapshot();
        assert_eq!(post_snapshot.session_order, pre_snapshot.session_order);
        assert_eq!(post_snapshot.sessions.len(), pre_snapshot.sessions.len());
        assert_eq!(
            post_snapshot.active_session_id,
            pre_snapshot.active_session_id
        );
    }

    /// `set_workspace_sessions` persists pane grouping for every PTY in the
    /// snapshot that the cache still knows about, and `list_sessions` then
    /// surfaces it on each `SessionInfo`. PTYs not mentioned in the snapshot
    /// have their grouping dropped (e.g. a pane that was closed since the last
    /// push). PTYs referenced by the snapshot but not in cache (spawn/kill
    /// race) are silently skipped — no dangling entries.
    #[tokio::test]
    async fn set_workspace_sessions_persists_grouping_and_list_sessions_surfaces_it() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();
        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Spawn two PTYs that will be the panes of one workspace session, plus
        // a third PTY that simulates a separate single-pane session.
        for id in &["pty-a", "pty-b", "pty-solo"] {
            spawn_pty_inner(
                state.clone(),
                cache.clone(),
                events.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .expect("spawn should succeed");
        }

        // Push a snapshot: pty-a + pty-b form a vsplit workspace; pty-solo is
        // a single. Also include a phantom pty-id the backend doesn't know
        // about — must be skipped without error.
        set_workspace_sessions_inner(
            &cache,
            SetWorkspaceSessionsRequest {
                sessions: vec![
                    WorkspaceSessionSnapshot {
                        id: "ws-quad".into(),
                        layout: "vsplit".into(),
                        working_directory: None,
                        panes: vec![
                            WorkspacePaneSnapshot {
                                pty_id: "pty-a".into(),
                                pane_id: "p0".into(),
                                pane_index: 0,
                                agent_type: "claude-code".into(),
                                active: true,
                            },
                            WorkspacePaneSnapshot {
                                pty_id: "pty-b".into(),
                                pane_id: "p1".into(),
                                pane_index: 1,
                                agent_type: "generic".into(),
                                active: false,
                            },
                            WorkspacePaneSnapshot {
                                pty_id: "pty-ghost".into(), // unknown to cache
                                pane_id: "p2".into(),
                                pane_index: 2,
                                agent_type: "generic".into(),
                                active: false,
                            },
                        ],
                    },
                    WorkspaceSessionSnapshot {
                        id: "ws-solo".into(),
                        layout: "single".into(),
                        working_directory: None,
                        panes: vec![WorkspacePaneSnapshot {
                            pty_id: "pty-solo".into(),
                            pane_id: "p0".into(),
                            pane_index: 0,
                            agent_type: "generic".into(),
                            active: true,
                        }],
                    },
                ],
            },
        )
        .expect("set_workspace_sessions should succeed");

        // list_sessions surfaces the grouping on the right PTYs.
        let list = list_sessions_inner(&state, &cache).expect("list_sessions");
        let by_id: std::collections::HashMap<_, _> =
            list.sessions.iter().map(|s| (s.id.clone(), s)).collect();

        let a = by_id.get("pty-a").expect("pty-a");
        let a_group = a.grouping.as_ref().expect("pty-a grouping");
        assert_eq!(a_group.workspace_session_id, "ws-quad");
        assert_eq!(a_group.layout, "vsplit");
        assert_eq!(a_group.pane_id, "p0");
        assert_eq!(a_group.pane_index, 0);
        assert!(a_group.active);
        assert_eq!(a_group.agent_type, "claude-code");

        let b_group = by_id
            .get("pty-b")
            .and_then(|s| s.grouping.as_ref())
            .expect("pty-b grouping");
        assert_eq!(b_group.workspace_session_id, "ws-quad");
        assert!(!b_group.active);

        let solo_group = by_id
            .get("pty-solo")
            .and_then(|s| s.grouping.as_ref())
            .expect("pty-solo grouping");
        assert_eq!(solo_group.workspace_session_id, "ws-solo");
        assert_eq!(solo_group.layout, "single");

        // The phantom pty was skipped: no entry in the cache groupings map.
        assert!(!cache.snapshot().groupings.contains_key("pty-ghost"));

        // session_order now reflects the snapshot's workspace * pane-index
        // ordering, atomically with the grouping write. This is what closes
        // the multi-pane reorder bug: the legacy `reorder_sessions` IPC could
        // only express active-pane-per-workspace and silently rejected for
        // multi-pane workspaces; `set_workspace_sessions` is now the canonical
        // owner of session_order.
        assert_eq!(
            cache.snapshot().session_order,
            vec!["pty-a".to_string(), "pty-b".into(), "pty-solo".into()],
        );

        // Push a NEW snapshot that REORDERS the workspaces (ws-solo first,
        // then ws-quad) AND drops pty-b — verifies (a) session_order follows
        // the new snapshot order, (b) PTYs the snapshot omits keep their
        // grouping cleared, and (c) PTYs omitted but still alive in cache
        // are appended in their existing relative order rather than dropped.
        set_workspace_sessions_inner(
            &cache,
            SetWorkspaceSessionsRequest {
                sessions: vec![
                    WorkspaceSessionSnapshot {
                        id: "ws-solo".into(),
                        layout: "single".into(),
                        working_directory: None,
                        panes: vec![WorkspacePaneSnapshot {
                            pty_id: "pty-solo".into(),
                            pane_id: "p0".into(),
                            pane_index: 0,
                            agent_type: "generic".into(),
                            active: true,
                        }],
                    },
                    WorkspaceSessionSnapshot {
                        id: "ws-quad".into(),
                        layout: "single".into(),
                        working_directory: None,
                        panes: vec![WorkspacePaneSnapshot {
                            pty_id: "pty-a".into(),
                            pane_id: "p0".into(),
                            pane_index: 0,
                            agent_type: "claude-code".into(),
                            active: true,
                        }],
                    },
                ],
            },
        )
        .expect("reorder snapshot should succeed");

        assert_eq!(
            cache.snapshot().session_order,
            // ws-solo first, then ws-quad (snapshot order); pty-b not in the
            // snapshot but still in cache — appended last preserving its
            // existing relative order from the previous session_order.
            vec!["pty-solo".to_string(), "pty-a".into(), "pty-b".into()],
        );

        // Push a third snapshot that omits both pty-b and pty-solo. They
        // are still alive in cache (kill_pty wasn't called for them), so
        // the preservation loop must keep BOTH `session_order` AND
        // `groupings` for them — see the dedicated
        // `set_workspace_sessions_preserves_grouping_for_race_window_ptys`
        // test below for why dropping the grouping here would incorrectly
        // peel race-window panes out of their original workspace on
        // the next restore.
        set_workspace_sessions_inner(
            &cache,
            SetWorkspaceSessionsRequest {
                sessions: vec![WorkspaceSessionSnapshot {
                    id: "ws-quad".into(),
                    layout: "single".into(),
                    working_directory: None,
                    panes: vec![WorkspacePaneSnapshot {
                        pty_id: "pty-a".into(),
                        pane_id: "p0".into(),
                        pane_index: 0,
                        agent_type: "claude-code".into(),
                        active: true,
                    }],
                }],
            },
        )
        .expect("third snapshot should succeed");

        let list = list_sessions_inner(&state, &cache).expect("list_sessions");
        let by_id: std::collections::HashMap<_, _> =
            list.sessions.iter().map(|s| (s.id.clone(), s)).collect();
        // Omitted-but-alive PTYs keep their grouping from the previous push.
        assert!(by_id.get("pty-a").unwrap().grouping.is_some());
        assert!(
            by_id.get("pty-b").unwrap().grouping.is_some(),
            "pty-b grouping must be preserved across a race-window omission"
        );
        assert!(
            by_id.get("pty-solo").unwrap().grouping.is_some(),
            "pty-solo grouping must be preserved across a race-window omission"
        );

        // Cleanup
        for id in &["pty-a", "pty-b", "pty-solo"] {
            let _ = state.remove(&id.to_string());
        }
    }

    /// Claude reviewer MEDIUM on PR #290 cycle 3: the preservation loop for
    /// race-window PTYs writes back to `session_order` but not to
    /// `groupings`. That asymmetry would peel a race-window pane out of its
    /// original workspace on the next restore (grouping `None` → solo
    /// single-pane session). Both must be preserved symmetrically.
    #[tokio::test]
    async fn set_workspace_sessions_preserves_grouping_for_race_window_ptys() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();
        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        // Spawn two PTYs that form a vsplit workspace.
        for id in &["pty-1", "pty-2"] {
            spawn_pty_inner(
                state.clone(),
                cache.clone(),
                events.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .expect("spawn");
        }

        // First snapshot groups both into one workspace.
        set_workspace_sessions_inner(
            &cache,
            SetWorkspaceSessionsRequest {
                sessions: vec![WorkspaceSessionSnapshot {
                    id: "ws-1".into(),
                    layout: "vsplit".into(),
                    working_directory: None,
                    panes: vec![
                        WorkspacePaneSnapshot {
                            pty_id: "pty-1".into(),
                            pane_id: "p0".into(),
                            pane_index: 0,
                            agent_type: "claude-code".into(),
                            active: true,
                        },
                        WorkspacePaneSnapshot {
                            pty_id: "pty-2".into(),
                            pane_id: "p1".into(),
                            pane_index: 1,
                            agent_type: "generic".into(),
                            active: false,
                        },
                    ],
                }],
            },
        )
        .expect("initial snapshot");
        assert!(cache.snapshot().groupings.contains_key("pty-2"));

        // A second snapshot lands that — because of a race — omits pty-2
        // (e.g. an addPane was in flight when the push was built). The
        // preservation loop must keep pty-2 in BOTH session_order AND the
        // groupings map. Without the symmetric preservation, pty-2 would
        // survive in session_order but lose grouping and restore as a solo
        // single-pane session on the next reload.
        set_workspace_sessions_inner(
            &cache,
            SetWorkspaceSessionsRequest {
                sessions: vec![WorkspaceSessionSnapshot {
                    id: "ws-1".into(),
                    layout: "vsplit".into(),
                    working_directory: None,
                    panes: vec![WorkspacePaneSnapshot {
                        pty_id: "pty-1".into(),
                        pane_id: "p0".into(),
                        pane_index: 0,
                        agent_type: "claude-code".into(),
                        active: true,
                    }],
                }],
            },
        )
        .expect("race-window snapshot");

        let snap = cache.snapshot();
        // Both PTYs survive in order.
        assert_eq!(
            snap.session_order,
            vec!["pty-1".to_string(), "pty-2".into()]
        );
        // Both groupings survive — pty-2's original entry is preserved.
        let pty_2_grouping = snap
            .groupings
            .get("pty-2")
            .expect("pty-2 grouping must be preserved across the race window");
        assert_eq!(pty_2_grouping.workspace_session_id, "ws-1");
        assert_eq!(pty_2_grouping.pane_id, "p1");

        // Cleanup
        for id in &["pty-1", "pty-2"] {
            let _ = state.remove(&id.to_string());
        }
    }

    /// Codex P2 on PR #290 cycle 7: a workspace session's baseline cwd
    /// (used by `addPane` for new shells) must be persisted alongside the
    /// grouping. Without it, restore derives `workingDirectory` from the
    /// active pane's live cwd, so a session whose active pane drifted via
    /// OSC 7 into a worktree subdir would have new panes opening there
    /// instead of the original project root. Pin: `working_directory` on
    /// `WorkspaceSessionSnapshot` lands on every pane's
    /// `PaneGrouping.workspace_directory` after `set_workspace_sessions`.
    #[tokio::test]
    async fn set_workspace_sessions_persists_workspace_directory() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();
        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        for id in &["pty-x", "pty-y"] {
            spawn_pty_inner(
                state.clone(),
                cache.clone(),
                events.clone(),
                SpawnPtyRequest {
                    session_id: id.to_string(),
                    cwd: cwd.clone(),
                    shell: None,
                    env: None,
                    enable_agent_bridge: false,
                },
            )
            .await
            .expect("spawn");
        }

        set_workspace_sessions_inner(
            &cache,
            SetWorkspaceSessionsRequest {
                sessions: vec![WorkspaceSessionSnapshot {
                    id: "ws-project".into(),
                    layout: "vsplit".into(),
                    working_directory: Some("/home/will/project-root".into()),
                    panes: vec![
                        WorkspacePaneSnapshot {
                            pty_id: "pty-x".into(),
                            pane_id: "p0".into(),
                            pane_index: 0,
                            agent_type: "claude-code".into(),
                            active: true,
                        },
                        WorkspacePaneSnapshot {
                            pty_id: "pty-y".into(),
                            pane_id: "p1".into(),
                            pane_index: 1,
                            agent_type: "generic".into(),
                            active: false,
                        },
                    ],
                }],
            },
        )
        .expect("snapshot");

        let snap = cache.snapshot();
        for id in &["pty-x", "pty-y"] {
            let g = snap
                .groupings
                .get(*id)
                .unwrap_or_else(|| panic!("missing grouping for {id}"));
            assert_eq!(
                g.workspace_directory.as_deref(),
                Some("/home/will/project-root")
            );
        }

        // Cleanup
        for id in &["pty-x", "pty-y"] {
            let _ = state.remove(&id.to_string());
        }
    }

    /// Claude reviewer MEDIUM on PR #290 cycle 10: `groupings.insert` was
    /// called for every pane BEFORE the `seen` dedup, so a malformed
    /// snapshot listing the same `pty_id` under two workspaces would
    /// silently overwrite the first session's grouping with the second's.
    /// Both writes must go through the same dedup. First-wins.
    #[tokio::test]
    async fn set_workspace_sessions_dedups_duplicate_pty_id_first_wins() {
        let (state, cache, events, _temp_dir) = create_test_state_with_cache();
        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        spawn_pty_inner(
            state.clone(),
            cache.clone(),
            events.clone(),
            SpawnPtyRequest {
                session_id: "pty-shared".into(),
                cwd: cwd.clone(),
                shell: None,
                env: None,
                enable_agent_bridge: false,
            },
        )
        .await
        .expect("spawn");

        // Both ws-first and ws-second claim pty-shared. The dedup must
        // keep the FIRST workspace's grouping and ignore the later
        // duplicate without crashing or corrupting state.
        set_workspace_sessions_inner(
            &cache,
            SetWorkspaceSessionsRequest {
                sessions: vec![
                    WorkspaceSessionSnapshot {
                        id: "ws-first".into(),
                        layout: "single".into(),
                        working_directory: None,
                        panes: vec![WorkspacePaneSnapshot {
                            pty_id: "pty-shared".into(),
                            pane_id: "p0".into(),
                            pane_index: 0,
                            agent_type: "claude-code".into(),
                            active: true,
                        }],
                    },
                    WorkspaceSessionSnapshot {
                        id: "ws-second".into(),
                        layout: "single".into(),
                        working_directory: None,
                        panes: vec![WorkspacePaneSnapshot {
                            pty_id: "pty-shared".into(),
                            pane_id: "p0".into(),
                            pane_index: 0,
                            agent_type: "generic".into(),
                            active: true,
                        }],
                    },
                ],
            },
        )
        .expect("snapshot");

        let snap = cache.snapshot();
        // The PTY appears EXACTLY ONCE in session_order.
        assert_eq!(snap.session_order, vec!["pty-shared".to_string()]);
        // Its grouping points at the FIRST workspace, not the duplicate.
        let g = snap
            .groupings
            .get("pty-shared")
            .expect("pty-shared grouping");
        assert_eq!(g.workspace_session_id, "ws-first");
        assert_eq!(g.agent_type, "claude-code");

        // Cleanup
        let _ = state.remove(&"pty-shared".to_string());
    }
}
