//! kimi-code session locator.
//!
//! Resolves the attach cwd to a `wire.jsonl` for the DETECTED kimi
//! process, in priority order:
//!
//! 1. proc-fd (Linux): the kimi process holds its own session's
//!    `agents/main/wire.jsonl` open — read `<proc_root>/<pid>/fd/*` and
//!    match it. Fully disambiguates per-process (mirrors codex's
//!    `open_rollout_paths_from_proc`).
//! 2. proc-environ (Linux): read the kimi process's own
//!    `KIMI_CODE_HOME` from `<proc_root>/<pid>/environ` so a per-process
//!    `KIMI_CODE_HOME=/tmp/kimi kimi` is honored.
//! 3. index fallback: `<kimi_home>/session_index.jsonl` workDir match.
//!    A `workDir` matches when it equals `cwd` OR is a component-boundary
//!    ancestor of it (kimi normalizes a worktree / subdirectory cwd to the
//!    repo root). Among matches the longest (deepest) workDir wins, then the
//!    newest (last) append-ordered entry — so it binds unconditionally even
//!    when idle (its `wire.jsonl` may predate `pty_start` before the first
//!    prompt), unless that wire does not exist yet (then it falls through).
//! 4. exact-bucket sha256 scan: last-resort newest `session_*` under
//!    this cwd's `wd_<basename>_<hex>` bucket, gated on a `pty_start`
//!    mtime freshness check (no append ordering to tell current from
//!    stale, so a stale same-cwd bucket session must not win there).
//!
//! On macOS (no `/proc`, `proc_root == None`) steps 1-2 cleanly skip and
//! resolution falls through to the index / bucket fallbacks.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Deserialize;

use crate::agent::adapter::traits::StatusSourceLocator;
use crate::agent::adapter::types::LocatedStatusSource;

// Kimi attach/locate observability — routes through the app's debug_log
// so traces land in vimeflow-debug.log alongside the pty/bridge logs.
pub(crate) fn kdbg(msg: &str) {
    crate::debug::debug_log("kimi", msg)
}

const KIMI_BIND_RETRY_INTERVAL_MS: u64 = 100;
const KIMI_BIND_RETRY_MAX_ATTEMPTS: u32 = 5;

// Slack subtracted from `pty_start` before the index freshness check, so a
// session whose wire.jsonl was created a moment before the PTY clock read
// still counts as fresh.
const KIMI_INDEX_FRESHNESS_SLACK: Duration = Duration::from_secs(3);

/// One `session_index.jsonl` line.
#[derive(Deserialize)]
struct SessionIndexEntry {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "sessionDir")]
    session_dir: Option<String>,
    #[serde(rename = "workDir")]
    work_dir: Option<String>,
}

pub(crate) struct KimiLocator {
    kimi_home: PathBuf,
    agent_pid: u32,
    pty_start: SystemTime,
    // `Some("/proc")` on Linux (or a tempdir in tests); `None` on macOS,
    // where the proc-fd / proc-environ fast-paths skip themselves.
    proc_root: Option<PathBuf>,
}

impl KimiLocator {
    pub(crate) fn new(
        kimi_home: PathBuf,
        agent_pid: u32,
        pty_start: SystemTime,
        proc_root: Option<PathBuf>,
    ) -> Self {
        Self {
            kimi_home,
            agent_pid,
            pty_start,
            proc_root,
        }
    }

    /// Effective kimi home for THIS process: the kimi process's own
    /// `KIMI_CODE_HOME` from `<proc_root>/<pid>/environ` when present,
    /// else the constructor `kimi_home`. Shared with the validator so the
    /// trust root is resolved from one source.
    pub(crate) fn effective_home(&self) -> PathBuf {
        self.proc_root
            .as_deref()
            .and_then(|root| kimi_home_from_proc_environ(root, self.agent_pid))
            .unwrap_or_else(|| self.kimi_home.clone())
    }

    fn session_index_path(&self, home: &Path) -> PathBuf {
        home.join("session_index.jsonl")
    }

    /// The detected kimi process's actual cwd (`/proc/<pid>/cwd`) when available —
    /// authoritative because kimi derives its session workDir from its own cwd, and
    /// the PTY-supplied cwd can be the stale spawn-time cwd. Falls back to `passed`
    /// when proc_root is None (e.g. macOS) or the link can't be read.
    fn process_cwd(&self, passed: &Path) -> PathBuf {
        self.proc_root
            .as_deref()
            .and_then(|root| {
                std::fs::read_link(root.join(self.agent_pid.to_string()).join("cwd")).ok()
            })
            .unwrap_or_else(|| passed.to_path_buf())
    }

    /// Wall-clock start time of the detected kimi process, from
    /// `<proc_root>/<pid>/stat` field 22 (`starttime`, ticks since boot)
    /// anchored on the system boot epoch (`btime` in `<proc_root>/stat`).
    /// `None` when proc is unavailable (macOS) or the files don't parse, so
    /// callers skip the per-process discriminator and keep newest-index.
    fn process_start(&self) -> Option<SystemTime> {
        let proc_root = self.proc_root.as_deref()?;
        let stat = std::fs::read_to_string(proc_root.join(self.agent_pid.to_string()).join("stat"))
            .ok()?;
        // `comm` (field 2) is parenthesized and may contain spaces or
        // parens, so parse the fields AFTER the last ')'. There, index 19 is
        // overall field 22 (`starttime`): fields 3.. start at index 0.
        let starttime_ticks: u64 = stat
            .rsplit_once(')')?
            .1
            .split_whitespace()
            .nth(19)?
            .parse()
            .ok()?;
        let since_boot_ms = starttime_ticks.checked_mul(1000)? / clock_ticks_per_sec();
        Some(
            SystemTime::UNIX_EPOCH
                + Duration::from_secs(read_btime(proc_root)?)
                + Duration::from_millis(since_boot_ms),
        )
    }

    /// proc-fd primary: the kimi process holds its session's
    /// `agents/main/wire.jsonl` open, so a `<proc_root>/<pid>/fd/*`
    /// symlink resolves to it. Disambiguates per-process with no workDir
    /// ambiguity. Skips itself when `proc_root` is `None` (macOS).
    fn try_resolve_from_proc_fds(&self, home: &Path) -> Option<LocatedStatusSource> {
        let proc_root = self.proc_root.as_deref()?;
        let wire = open_wire_path_from_proc(proc_root, self.agent_pid)?;
        // Anchor the trust root to THIS process's effective home and require
        // the fd target to live under it: a detected (or spoofed) process must
        // not steer the watcher at a wire.jsonl tree outside the kimi home.
        if !wire.starts_with(home.join("sessions")) {
            return None;
        }
        let session_dir = wire.parent()?.parent()?.parent()?;
        let agent_session_id = session_dir
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_owned);
        Some(LocatedStatusSource {
            static_transcript_hint: wire.to_str().map(str::to_owned),
            status_path: wire,
            trust_root: home.to_path_buf(),
            agent_session_id,
        })
    }

    /// Resolve the best `session_index.jsonl` entry whose `workDir` matches
    /// `cwd` (equal, or a component-boundary ancestor — kimi normalizes a
    /// worktree / subdirectory cwd to the repo root), binding it
    /// unconditionally. Among all matching entries the winner is the LONGEST
    /// `workDir` (most specific / deepest ancestor beats a shallower one),
    /// breaking ties by the LAST occurrence in the append-ordered index (the
    /// newest session for that workDir IS this process's current session) —
    /// so it binds even when idle (its `wire.jsonl` may predate `pty_start`
    /// because the user has not submitted a prompt yet, leaving the
    /// transcript at its config-only metadata lines).
    ///
    /// No freshness gate runs here: the authoritative newest-index match
    /// must never be rejected just because it is idle (the bug that left
    /// the agent-status panel blank for a fresh-but-idle session). The
    /// codex-pass-3 stale-race guard is preserved only on the bucket-scan
    /// fallback (`try_resolve_fallback`), which has no append ordering to
    /// distinguish current from stale. Returns `None` when the chosen
    /// entry's `wire.jsonl` does not exist yet, so the caller retries / falls
    /// through rather than binding a path that has no transcript.
    fn try_resolve_from_index(&self, home: &Path, cwd: &Path) -> Option<LocatedStatusSource> {
        let raw = std::fs::read_to_string(self.session_index_path(home)).ok()?;

        // Gather all cwd-matching entries, then choose: PREFER a session this
        // kimi process owns — created at/after the process started (codex's
        // per-process discriminator, resolved via the session's metadata
        // `created_at`) — so a frozen same-cwd session left by an EARLIER run
        // can't win the tie-break. Within the chosen group the original rule
        // applies: longest workDir, ties to the last index occurrence. When
        // the process start is unknown (macOS / no proc) nothing is "owned",
        // so selection falls back to the prior newest-index behavior unchanged.
        let process_start = self.process_start();
        let mut matches: Vec<(usize, bool, SessionIndexEntry)> = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<SessionIndexEntry>(line) else {
                continue;
            };
            let Some(work_dir) = entry.work_dir.as_deref() else {
                continue;
            };
            if !cwd_matches_workdir(cwd, work_dir) {
                continue;
            }
            let work_len = work_dir.len();
            let owned = process_start.is_some_and(|start| {
                entry
                    .session_dir
                    .as_deref()
                    .and_then(session_created_at)
                    .is_some_and(|created| created + KIMI_INDEX_FRESHNESS_SLACK >= start)
            });
            matches.push((work_len, owned, entry));
        }

        // When the process start is KNOWN, only a session this process owns
        // may bind: a fresh attach whose index row / wire has not landed yet
        // returns None and retries rather than latching a previous same-cwd
        // run. When it is unknown (macOS / no proc) fall back to the
        // newest-index match. `max_by_key` keeps the LAST element among equal
        // keys — the append-ordered newest — preserving the original tie-break.
        let proc_known = process_start.is_some();
        let entry = matches
            .into_iter()
            .filter(|(_, owned, _)| *owned || !proc_known)
            .max_by_key(|(work_len, _, _)| *work_len)
            .map(|(_, _, entry)| entry)?;
        let session_dir = entry.session_dir?;
        let status_path = PathBuf::from(&session_dir)
            .join("agents")
            .join("main")
            .join("wire.jsonl");

        // Bind only when the transcript exists; a missing wire is the
        // fresh-attach race, so the caller retries / falls through.
        if !status_path.exists() {
            return None;
        }

        Some(LocatedStatusSource {
            static_transcript_hint: status_path.to_str().map(str::to_owned),
            status_path,
            trust_root: home.to_path_buf(),
            agent_session_id: entry.session_id,
        })
    }

    /// Best-effort fallback when the index has no fresh matching
    /// `workDir`: newest `session_*` (by mtime) whose
    /// `agents/main/wire.jsonl` is FRESH, scoped to this cwd's EXACT bucket
    /// `wd_<basename>_<hex>` (`<hex>` = `sha256(cwd)[:12]`). The exact
    /// bucket — not a basename prefix — stops a same-basename session
    /// from another project's cwd binding here.
    fn try_resolve_fallback(&self, home: &Path, cwd: &Path) -> Option<LocatedStatusSource> {
        let bucket_path = home.join("sessions").join(cwd_bucket_name(cwd)?);
        if !bucket_path.is_dir() {
            return None;
        }
        let process_start = self.process_start();
        let mut newest: Option<(SystemTime, PathBuf)> = None;

        let sessions = std::fs::read_dir(&bucket_path).ok()?;
        for session in sessions.flatten() {
            let name = session.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if !name.starts_with("session_") {
                continue;
            }
            let session_path = session.path();
            let wire = session_path.join("agents").join("main").join("wire.jsonl");
            // Same per-process discriminator as the index path: when the
            // process start is known, only a session this process created may
            // bind; otherwise fall back to the pty-start freshness gate so a
            // stale same-cwd bucket session can't bind.
            let fresh = match process_start {
                Some(start) => session_path
                    .to_str()
                    .and_then(session_created_at)
                    .is_some_and(|created| created + KIMI_INDEX_FRESHNESS_SLACK >= start),
                None => wire_is_fresh(&wire, self.pty_start),
            };
            if !fresh {
                continue;
            }
            let mtime = session
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            if newest.as_ref().map_or(true, |(seen, _)| mtime > *seen) {
                newest = Some((mtime, session_path));
            }
        }

        let (_, session_path) = newest?;
        let status_path = session_path.join("agents").join("main").join("wire.jsonl");
        let agent_session_id = session_path
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_owned);
        Some(LocatedStatusSource {
            static_transcript_hint: status_path.to_str().map(str::to_owned),
            status_path,
            trust_root: home.to_path_buf(),
            agent_session_id,
        })
    }
}

impl StatusSourceLocator for KimiLocator {
    fn locate(&self, cwd: &Path, _session_id: &str) -> Result<LocatedStatusSource, String> {
        let home = self.effective_home();
        kdbg(&format!(
            "LOCATE start: passed_cwd={} agent_pid={} proc_root={:?} home={}",
            cwd.display(),
            self.agent_pid,
            self.proc_root,
            home.display()
        ));
        // The PTY-supplied `cwd` can be the stale spawn-time cwd (OSC 7 `cd`
        // updates never reach PtyState). Prefer the kimi process's real
        // `/proc/<pid>/cwd`, since kimi derives its session workDir from there.
        let cwd = self.process_cwd(cwd);
        kdbg(&format!("LOCATE process_cwd={}", cwd.display()));

        for attempt in 0..KIMI_BIND_RETRY_MAX_ATTEMPTS {
            // proc-fd is authoritative and unambiguous — try it first.
            let proc_fd = self.try_resolve_from_proc_fds(&home);
            kdbg(&format!(
                "LOCATE proc_fd={:?}",
                proc_fd.as_ref().map(|l| l.status_path.display().to_string())
            ));
            if let Some(located) = proc_fd {
                kdbg(&format!(
                    "LOCATE => OK status_path={} sid={:?}",
                    located.status_path.display(),
                    located.agent_session_id
                ));
                return Ok(located);
            }
            // Then the newest same-cwd index match (binds even when idle).
            let index = self.try_resolve_from_index(&home, &cwd);
            kdbg(&format!(
                "LOCATE index={:?}",
                index.as_ref().map(|l| l.status_path.display().to_string())
            ));
            if let Some(located) = index {
                kdbg(&format!(
                    "LOCATE => OK status_path={} sid={:?}",
                    located.status_path.display(),
                    located.agent_session_id
                ));
                return Ok(located);
            }
            if attempt + 1 < KIMI_BIND_RETRY_MAX_ATTEMPTS {
                std::thread::sleep(std::time::Duration::from_millis(
                    KIMI_BIND_RETRY_INTERVAL_MS,
                ));
            }
        }

        // Neither proc-fd nor a fresh index match — best-effort fallback.
        if let Some(located) = self.try_resolve_fallback(&home, &cwd) {
            kdbg(&format!(
                "LOCATE => OK status_path={} sid={:?}",
                located.status_path.display(),
                located.agent_session_id
            ));
            return Ok(located);
        }

        let err = format!(
            "kimi locator: no fresh session for cwd={} (pid={}) and no fallback session under {}",
            cwd.display(),
            self.agent_pid,
            home.join("sessions").display(),
        );
        kdbg(&format!("LOCATE => ERR {}", err));
        Err(err)
    }
}

/// System boot time (epoch seconds) from `<proc_root>/stat`'s `btime` line.
fn read_btime(proc_root: &Path) -> Option<u64> {
    std::fs::read_to_string(proc_root.join("stat"))
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix("btime "))
        .and_then(|value| value.trim().parse().ok())
}

/// Kernel tick rate (`sysconf(_SC_CLK_TCK)`, 100 on typical Linux). `libc`
/// is a Unix-only dependency; non-Unix has no `/proc` (so `process_start`
/// already returns `None`) and just takes the 100 fallback.
fn clock_ticks_per_sec() -> u64 {
    #[cfg(unix)]
    {
        let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
        if hz > 0 {
            return hz as u64;
        }
    }
    100
}

/// A session's creation time, read from its `agents/main/wire.jsonl`
/// `metadata` event (`created_at`, epoch ms). `None` when absent — the
/// caller then treats the session as not provably owned by this process.
fn session_created_at(session_dir: &str) -> Option<SystemTime> {
    let wire = PathBuf::from(session_dir)
        .join("agents")
        .join("main")
        .join("wire.jsonl");
    for line in std::fs::read_to_string(wire).ok()?.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value.get("type").and_then(serde_json::Value::as_str) == Some("metadata") {
            let ms = value.get("created_at").and_then(serde_json::Value::as_u64)?;
            return Some(SystemTime::UNIX_EPOCH + Duration::from_millis(ms));
        }
    }
    None
}

/// Read `<proc_root>/<pid>/fd/*` and return the first symlink target that
/// looks like a kimi session wire: ends with `agents/main/wire.jsonl` and
/// lives under a `.../sessions/wd_*/session_*/` path.
fn open_wire_path_from_proc(proc_root: &Path, pid: u32) -> Option<PathBuf> {
    let fd_dir = proc_root.join(pid.to_string()).join("fd");
    let entries = std::fs::read_dir(fd_dir).ok()?;
    for entry in entries.flatten() {
        let Ok(target) = std::fs::read_link(entry.path()) else {
            continue;
        };
        if is_kimi_session_wire(&target) {
            return Some(target);
        }
    }
    None
}

/// True when `path` ends with `agents/main/wire.jsonl` and sits under a
/// `.../sessions/wd_*/session_*/` layout — the shape a kimi session's
/// open transcript fd resolves to.
fn is_kimi_session_wire(path: &Path) -> bool {
    if !path.ends_with(Path::new("agents/main/wire.jsonl")) {
        return false;
    }
    let Some(session_dir) = path.parent().and_then(Path::parent).and_then(Path::parent) else {
        return false;
    };
    let session_named = session_dir
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("session_"));
    let wd_named = session_dir
        .parent()
        .and_then(Path::file_name)
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("wd_"));
    let under_sessions = session_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .is_some_and(|n| n == "sessions");
    session_named && wd_named && under_sessions
}

/// Extract a non-empty `KIMI_CODE_HOME` from the kimi process's environ
/// (`<proc_root>/<pid>/environ`, NUL-separated `KEY=VALUE`).
fn kimi_home_from_proc_environ(proc_root: &Path, pid: u32) -> Option<PathBuf> {
    let path = proc_root.join(pid.to_string()).join("environ");
    let content = std::fs::read(path).ok()?;
    for entry in content.split(|&b| b == 0) {
        let entry = String::from_utf8_lossy(entry);
        if let Some(value) = entry.strip_prefix("KIMI_CODE_HOME=") {
            if !value.is_empty() {
                return Some(PathBuf::from(value));
            }
        }
    }
    None
}

/// True when `wire` exists and its mtime is `>= pty_start - slack`. A
/// missing file (fresh-attach race) or a too-old mtime (stale same-cwd
/// entry) both return false, so the caller retries / falls through.
fn wire_is_fresh(wire: &Path, pty_start: SystemTime) -> bool {
    let Ok(mtime) = std::fs::metadata(wire).and_then(|m| m.modified()) else {
        return false;
    };
    let floor = pty_start
        .checked_sub(KIMI_INDEX_FRESHNESS_SLACK)
        .unwrap_or(pty_start);
    mtime >= floor
}

/// True when an index `workDir` matches the attach `cwd` by path-component
/// semantics: `cwd == workDir` OR `workDir` is a component-boundary ancestor
/// of `cwd` (kimi normalizes a worktree — and any project subdirectory — cwd
/// to the repo root, so the registered `workDir` is the ancestor of the pane
/// cwd). Canonicalizes both sides (resolves symlinks / `..`); falls back to
/// the raw paths if either side fails to canonicalize. A `starts_with` over
/// `Path` components — not a string prefix — so `/proj` does NOT match
/// `/proj-other` (only a real `/` boundary counts).
fn cwd_matches_workdir(cwd: &Path, work_dir: &str) -> bool {
    let work_path = Path::new(work_dir);
    let canonical_cwd = canonical_or_owned(cwd);
    let canonical_work = canonical_or_owned(work_path);
    canonical_cwd.starts_with(&canonical_work)
}

fn canonical_or_owned(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// kimi's exact session-bucket name for a cwd: `wd_<basename>_<hex>` where
/// `<hex>` is the first 12 hex chars of `sha256(cwd)`. Mirrors how kimi-code
/// names `<kimi_home>/sessions/` buckets.
fn cwd_bucket_name(cwd: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    let basename = cwd.file_name()?.to_str()?;
    let digest = Sha256::digest(cwd.to_string_lossy().as_bytes());
    let hex: String = digest.iter().take(6).map(|b| format!("{b:02x}")).collect();
    Some(format!("wd_{basename}_{hex}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::Duration;

    fn write_wire(session_dir: &Path) -> PathBuf {
        let wire = session_dir.join("agents").join("main").join("wire.jsonl");
        std::fs::create_dir_all(wire.parent().expect("parent")).expect("mkdir wire");
        std::fs::write(&wire, b"{\"type\":\"metadata\"}\n").expect("write wire");
        wire
    }

    // Like `write_wire` but stamps the session's creation time into the
    // `metadata` event so the per-process discriminator can read it.
    fn write_wire_created(session_dir: &Path, created_ms: u64) -> PathBuf {
        let wire = session_dir.join("agents").join("main").join("wire.jsonl");
        std::fs::create_dir_all(wire.parent().expect("parent")).expect("mkdir wire");
        std::fs::write(
            &wire,
            format!("{{\"type\":\"metadata\",\"created_at\":{created_ms}}}\n"),
        )
        .expect("write wire");
        wire
    }

    // Fake `<proc_root>/stat` carrying a `btime` line.
    fn write_proc_btime(proc_root: &Path, btime: u64) {
        std::fs::write(proc_root.join("stat"), format!("cpu 0 0\nbtime {btime}\n"))
            .expect("write proc stat");
    }

    // Fake `<proc_root>/<pid>/stat` whose field 22 is `starttime_ticks`
    // (comm parenthesized, 17 filler fields before starttime).
    fn write_proc_stat(proc_root: &Path, pid: u32, starttime_ticks: u64) {
        let pid_dir = proc_root.join(pid.to_string());
        std::fs::create_dir_all(&pid_dir).expect("pid dir");
        let filler = "0 ".repeat(17);
        std::fs::write(
            pid_dir.join("stat"),
            format!("{pid} (kimi) S 1 {filler}{starttime_ticks}\n"),
        )
        .expect("write pid stat");
    }

    fn write_index(kimi_home: &Path, entries: &[(&str, &Path, &Path)]) {
        let path = kimi_home.join("session_index.jsonl");
        let mut file = std::fs::File::create(&path).expect("create index");
        for (session_id, session_dir, work_dir) in entries {
            writeln!(
                file,
                r#"{{"sessionId":"{}","sessionDir":"{}","workDir":"{}"}}"#,
                session_id,
                session_dir.display(),
                work_dir.display(),
            )
            .expect("write index line");
        }
    }

    // A kimi-shaped session dir under <home>/sessions/<wd>/<session>.
    fn session_under(home: &Path, wd: &str, session: &str) -> PathBuf {
        home.join("sessions").join(wd).join(session)
    }

    // Symlink <proc_root>/<pid>/fd/<fd> → target (so proc-fd resolves it).
    fn write_fd(proc_root: &Path, pid: u32, fd: &str, target: &Path) {
        let fd_dir = proc_root.join(pid.to_string()).join("fd");
        std::fs::create_dir_all(&fd_dir).expect("create fake fd dir");
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, fd_dir.join(fd)).expect("symlink fd");
    }

    // Write <proc_root>/<pid>/environ from NUL-joined KEY=VALUE entries.
    fn write_environ(proc_root: &Path, pid: u32, entries: &[&str]) {
        let pid_dir = proc_root.join(pid.to_string());
        std::fs::create_dir_all(&pid_dir).expect("create fake pid dir");
        let mut bytes = Vec::new();
        for entry in entries {
            bytes.extend_from_slice(entry.as_bytes());
            bytes.push(0);
        }
        std::fs::write(pid_dir.join("environ"), bytes).expect("write environ");
    }

    // Force a file's mtime via std `File::set_modified` (no `filetime` dep).
    fn set_mtime(path: &Path, when: SystemTime) {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(path)
            .expect("open for mtime");
        file.set_modified(when).expect("set mtime");
    }

    fn locator_with(kimi_home: &Path, pid: u32, pty_start: SystemTime) -> KimiLocator {
        KimiLocator::new(kimi_home.to_path_buf(), pid, pty_start, None)
    }

    fn locator_with_proc(
        kimi_home: &Path,
        pid: u32,
        pty_start: SystemTime,
        proc_root: &Path,
    ) -> KimiLocator {
        KimiLocator::new(
            kimi_home.to_path_buf(),
            pid,
            pty_start,
            Some(proc_root.to_path_buf()),
        )
    }

    #[test]
    fn resolves_status_path_and_session_id_from_index() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let session_dir = session_under(kimi_home.path(), "wd_x", "session_abc");
        let wire = write_wire(&session_dir);
        write_index(
            kimi_home.path(),
            &[("session_abc", &session_dir, work.path())],
        );

        let locator = locator_with(kimi_home.path(), 4242, SystemTime::now());
        let located = locator.locate(work.path(), "pty-1").expect("locate ok");

        assert_eq!(
            located.status_path, wire,
            "status_path points at agents/main/wire.jsonl"
        );
        assert_eq!(located.trust_root, kimi_home.path());
        assert_eq!(located.agent_session_id.as_deref(), Some("session_abc"));
        assert_eq!(located.static_transcript_hint.as_deref(), wire.to_str());
    }

    #[test]
    fn takes_last_matching_workdir_entry() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let old_dir = session_under(kimi_home.path(), "wd_x", "session_old");
        let new_dir = session_under(kimi_home.path(), "wd_x", "session_new");
        write_wire(&old_dir);
        let new_wire = write_wire(&new_dir);
        write_index(
            kimi_home.path(),
            &[
                ("session_old", &old_dir, work.path()),
                ("session_new", &new_dir, work.path()),
            ],
        );

        let locator = locator_with(kimi_home.path(), 4242, SystemTime::now());
        let located = locator.locate(work.path(), "pty-1").expect("locate ok");
        assert_eq!(located.status_path, new_wire);
        assert_eq!(located.agent_session_id.as_deref(), Some("session_new"));
    }

    /// proc-fd is authoritative: even when `session_index.jsonl` has a
    /// DIFFERENT (stale) same-cwd entry, the wire.jsonl the kimi process
    /// holds open wins. Proves P1 (stale same-cwd session) is fixed.
    #[test]
    fn proc_fd_wins_over_stale_same_cwd_index_entry() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let proc_root = tempfile::tempdir().expect("proc root");
        let work = tempfile::tempdir().expect("work dir");

        // The fresh session this process actually holds open.
        let fresh_dir = session_under(kimi_home.path(), "wd_a", "session_abc");
        let fresh_wire = write_wire(&fresh_dir);

        // A stale same-cwd index entry pointing at a DIFFERENT session.
        let stale_dir = session_under(kimi_home.path(), "wd_a", "session_stale");
        write_wire(&stale_dir);
        write_index(
            kimi_home.path(),
            &[("session_stale", &stale_dir, work.path())],
        );

        let pid = 7777;
        write_fd(proc_root.path(), pid, "3", &fresh_wire);

        let locator = locator_with_proc(kimi_home.path(), pid, SystemTime::now(), proc_root.path());
        let located = locator
            .locate(work.path(), "pty-1")
            .expect("proc-fd resolves");

        assert_eq!(
            located.status_path, fresh_wire,
            "proc-fd must bind the process's own session, not the stale index entry"
        );
        assert_eq!(located.agent_session_id.as_deref(), Some("session_abc"));
        assert_eq!(located.trust_root, kimi_home.path());
    }

    /// proc-environ P2: the kimi process launched with
    /// `KIMI_CODE_HOME=<tmp>` writes state under `<tmp>`; the locator
    /// reads that env from `<proc>/<pid>/environ` even though its
    /// constructor `kimi_home` points elsewhere.
    #[test]
    fn proc_environ_resolves_per_process_home() {
        let env_home = tempfile::tempdir().expect("env home");
        let wrong_home = tempfile::tempdir().expect("constructor home");
        let proc_root = tempfile::tempdir().expect("proc root");
        let work = tempfile::tempdir().expect("work dir");

        let session_dir = session_under(env_home.path(), "wd_e", "session_env");
        let wire = write_wire(&session_dir);
        write_index(
            env_home.path(),
            &[("session_env", &session_dir, work.path())],
        );

        let pid = 8888;
        write_environ(
            proc_root.path(),
            pid,
            &[&format!("KIMI_CODE_HOME={}", env_home.path().display())],
        );

        // Constructor home is the WRONG dir; only proc-environ points to env_home.
        let locator =
            locator_with_proc(wrong_home.path(), pid, SystemTime::now(), proc_root.path());
        let located = locator
            .locate(work.path(), "pty-1")
            .expect("proc-environ home resolves");

        assert_eq!(located.status_path, wire);
        assert!(
            located.status_path.starts_with(env_home.path()),
            "status_path must resolve under the proc-environ KIMI_CODE_HOME"
        );
        assert_eq!(located.trust_root, env_home.path());
    }

    /// The index is append-ordered, so the LAST same-cwd entry is the
    /// current session and binds — even when an EARLIER same-cwd entry has
    /// a newer `wire.jsonl` mtime. Pins that the newest-index match is
    /// authoritative and no longer freshness-gated on the index path.
    #[test]
    fn index_binds_newest_entry_regardless_of_wire_mtime() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");

        let older_dir = session_under(kimi_home.path(), "wd_a", "session_older");
        let older_wire = write_wire(&older_dir);
        let current_dir = session_under(kimi_home.path(), "wd_a", "session_current");
        let current_wire = write_wire(&current_dir);

        let pty_start = SystemTime::now();
        // The current (last-listed) session's wire is IDLE — its mtime
        // predates pty_start — while the earlier session's wire looks fresh.
        // The newest index entry must still win.
        set_mtime(&current_wire, pty_start - Duration::from_secs(3600));
        set_mtime(&older_wire, pty_start + Duration::from_secs(1));

        write_index(
            kimi_home.path(),
            &[
                ("session_older", &older_dir, work.path()),
                ("session_current", &current_dir, work.path()),
            ],
        );

        let locator = locator_with(kimi_home.path(), 4242, pty_start);
        let located = locator
            .locate(work.path(), "pty-1")
            .expect("newest index entry resolves");
        assert_eq!(
            located.status_path, current_wire,
            "newest (last) index entry binds even when its wire predates pty_start"
        );
        assert_eq!(located.agent_session_id.as_deref(), Some("session_current"));
    }

    /// Regression pin for the blank-agent-status bug: an IDLE session whose
    /// `wire.jsonl` mtime is well before `pty_start` (the user opened kimi
    /// but never submitted a prompt) and which is the sole/newest index
    /// entry for the cwd MUST bind, so the status watcher attaches and the
    /// config-only model + context window stream to the panel.
    #[test]
    fn idle_sole_index_entry_binds() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");

        let idle_dir = session_under(kimi_home.path(), "wd_a", "session_idle");
        let idle_wire = write_wire(&idle_dir);
        let pty_start = SystemTime::now();
        // Idle: wire created long before the PTY clock read, never updated.
        set_mtime(&idle_wire, pty_start - Duration::from_secs(3600));
        write_index(
            kimi_home.path(),
            &[("session_idle", &idle_dir, work.path())],
        );

        let locator = locator_with(kimi_home.path(), 4242, pty_start);
        let located = locator
            .locate(work.path(), "pty-1")
            .expect("idle sole index entry must bind");
        assert_eq!(located.status_path, idle_wire);
        assert_eq!(located.agent_session_id.as_deref(), Some("session_idle"));
    }

    /// The "5-minutes-ago" bug / codex P2: two same-`workDir` sessions where
    /// the FROZEN earlier run is listed last. With the live process's start
    /// time known, the locator must bind the session THIS process created
    /// (its `metadata.created_at` is at/after the process start), not the
    /// last index row.
    #[test]
    fn index_binds_session_owned_by_the_live_process() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let proc_root = tempfile::tempdir().expect("proc root");

        let pid = 4242u32;
        let hz = clock_ticks_per_sec();
        let btime = 1_700_000_000u64;
        let starttime_ticks = 50 * hz;
        // process_start = btime + 50s.
        let process_start_ms = (btime + 50) * 1000;
        write_proc_btime(proc_root.path(), btime);
        write_proc_stat(proc_root.path(), pid, starttime_ticks);

        // Owned: created exactly at process start. Stale: created 50s before
        // it (well outside the freshness slack) yet listed LAST in the index.
        let owned_dir = session_under(kimi_home.path(), "wd_a", "session_owned");
        let owned_wire = write_wire_created(&owned_dir, process_start_ms);
        let stale_dir = session_under(kimi_home.path(), "wd_a", "session_stale");
        write_wire_created(&stale_dir, process_start_ms - 50_000);

        write_index(
            kimi_home.path(),
            &[
                ("session_owned", &owned_dir, work.path()),
                ("session_stale", &stale_dir, work.path()),
            ],
        );

        let locator =
            locator_with_proc(kimi_home.path(), pid, SystemTime::now(), proc_root.path());
        let located = locator
            .locate(work.path(), "pty-1")
            .expect("owned session resolves");
        assert_eq!(
            located.status_path, owned_wire,
            "must bind the session this process created, not the last index row"
        );
        assert_eq!(located.agent_session_id.as_deref(), Some("session_owned"));
    }

    /// codex follow-up: with the process start known but the live session's
    /// row/wire not landed yet, every same-cwd row is unowned — the resolver
    /// must NOT latch a previous run's stale row; it returns None so locate
    /// retries instead of binding the wrong transcript.
    #[test]
    fn proc_known_without_owned_session_does_not_bind_stale() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let proc_root = tempfile::tempdir().expect("proc root");

        let pid = 4242u32;
        let hz = clock_ticks_per_sec();
        let btime = 1_700_000_000u64;
        let process_start_ms = (btime + 50) * 1000;
        write_proc_btime(proc_root.path(), btime);
        write_proc_stat(proc_root.path(), pid, 50 * hz);

        // Only a stale session exists (created an hour before the process),
        // and it lives under `wd_a` — NOT this cwd's real bucket — so the
        // fallback can't pick it up either.
        let stale_dir = session_under(kimi_home.path(), "wd_a", "session_stale");
        write_wire_created(&stale_dir, process_start_ms - 3_600_000);
        write_index(kimi_home.path(), &[("session_stale", &stale_dir, work.path())]);

        let locator =
            locator_with_proc(kimi_home.path(), pid, SystemTime::now(), proc_root.path());
        assert!(
            locator.locate(work.path(), "pty-1").is_err(),
            "must not bind a session created before this process started"
        );
    }

    /// Recompute kimi's exact bucket name for a cwd in the test (same
    /// `sha256(cwd)[:12]` the locator derives), so the fixture builds the
    /// bucket the fallback will actually scan.
    fn bucket_for(cwd: &Path) -> String {
        use sha2::{Digest, Sha256};
        let basename = cwd.file_name().and_then(|n| n.to_str()).expect("basename");
        let digest = Sha256::digest(cwd.to_string_lossy().as_bytes());
        let hex: String = digest.iter().take(6).map(|b| format!("{b:02x}")).collect();
        format!("wd_{basename}_{hex}")
    }

    /// `sha256("/home/will/projects/vimeflow")[:12]` sanity anchor.
    #[test]
    fn cwd_bucket_name_hex_matches_known_sha() {
        let name = cwd_bucket_name(Path::new("/home/will/projects/vimeflow")).expect("bucket");
        assert_eq!(name, "wd_vimeflow_6650d9cdb25d");
    }

    #[test]
    fn fallback_is_scoped_to_cwd_bucket() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let other_work = tempfile::tempdir().expect("other work");
        let base = work
            .path()
            .file_name()
            .and_then(|n| n.to_str())
            .expect("work basename");

        // Session in THIS cwd's EXACT bucket (wd_<basename>_<sha256[:12]>) → must win.
        let scoped = kimi_home
            .path()
            .join("sessions")
            .join(bucket_for(work.path()))
            .join("session_scoped");
        let scoped_wire = write_wire(&scoped);

        // Newer decoy: SAME basename, DIFFERENT hash → must be ignored.
        let decoy = kimi_home
            .path()
            .join("sessions")
            .join(format!("wd_{base}_ffffffffffff"))
            .join("session_decoy");
        write_wire(&decoy);

        // Index entry is for a different workDir, so the index never matches.
        write_index(
            kimi_home.path(),
            &[("session_scoped", &scoped, other_work.path())],
        );

        let locator = locator_with(kimi_home.path(), 4242, SystemTime::now());
        let located = locator
            .locate(work.path(), "pty-1")
            .expect("scoped fallback resolves");
        assert_eq!(
            located.status_path, scoped_wire,
            "fallback must pick the session in this cwd's bucket, not the newer decoy"
        );
        assert_eq!(located.agent_session_id.as_deref(), Some("session_scoped"));
    }

    /// Exact-bucket freshness: a STALE bucket session (wire mtime far
    /// before pty_start) is rejected while a FRESH one wins, even though
    /// the stale dir is newer by directory mtime.
    #[test]
    fn fallback_freshness_prefers_fresh_over_stale_in_bucket() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let bucket = kimi_home
            .path()
            .join("sessions")
            .join(bucket_for(work.path()));

        // FRESH created first, STALE second: the stale dir is newer by mtime,
        // so a naive newest-wins scan would pick it — the gate must skip it.
        let fresh = bucket.join("session_fresh");
        let fresh_wire = write_wire(&fresh);
        let stale = bucket.join("session_stale");
        let stale_wire = write_wire(&stale);

        let pty_start = SystemTime::now();
        set_mtime(&stale_wire, pty_start - Duration::from_secs(3600));
        set_mtime(&fresh_wire, pty_start + Duration::from_secs(1));

        // Index never matches this cwd so resolution falls to the bucket scan.
        write_index(kimi_home.path(), &[]);

        let locator = locator_with(kimi_home.path(), 4242, pty_start);
        let located = locator
            .locate(work.path(), "pty-1")
            .expect("fresh bucket session resolves");
        assert_eq!(
            located.status_path, fresh_wire,
            "fallback must reject the stale bucket session and bind the fresh one"
        );
        assert_eq!(located.agent_session_id.as_deref(), Some("session_fresh"));
    }

    /// A stale-only EXACT bucket (the single session's wire predates
    /// pty_start) must error rather than bind the stale transcript.
    #[test]
    fn fallback_stale_only_bucket_errors() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let bucket = kimi_home
            .path()
            .join("sessions")
            .join(bucket_for(work.path()));
        let stale = bucket.join("session_stale");
        let stale_wire = write_wire(&stale);

        let pty_start = SystemTime::now();
        set_mtime(&stale_wire, pty_start - Duration::from_secs(3600));
        write_index(kimi_home.path(), &[]);

        let locator = locator_with(kimi_home.path(), 4242, pty_start);
        let err = locator
            .locate(work.path(), "pty-1")
            .expect_err("stale-only bucket must not bind");
        assert!(err.contains("kimi locator"), "got: {}", err);
    }

    #[test]
    fn errors_when_no_index_and_no_sessions() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let locator = locator_with(kimi_home.path(), 4242, SystemTime::now());
        let err = locator
            .locate(work.path(), "pty-1")
            .expect_err("empty kimi home should error");
        assert!(err.contains("kimi locator"), "got: {}", err);
    }

    /// `cwd_matches_workdir` component-boundary semantics: equal binds;
    /// an ancestor binds; a sibling that shares a string prefix but no path
    /// boundary (`/proj` vs `/proj-other`) does NOT; an unrelated path does
    /// NOT. Uses real on-disk dirs so canonicalize succeeds on both sides.
    #[test]
    fn cwd_matches_workdir_component_boundary_semantics() {
        let root = tempfile::tempdir().expect("root");
        let proj = root.path().join("proj");
        let nested = proj.join("worktrees").join("wt");
        let sibling = root.path().join("proj-other");
        let unrelated = root.path().join("elsewhere");
        for dir in [&nested, &sibling, &unrelated] {
            std::fs::create_dir_all(dir).expect("mkdir");
        }

        let proj_str = proj.to_string_lossy().into_owned();

        // Equal: workDir == cwd.
        assert!(cwd_matches_workdir(&proj, &proj_str));
        // Ancestor: cwd is under workDir at a real boundary.
        assert!(cwd_matches_workdir(&nested, &proj_str));
        // Sibling sharing a string prefix but no path boundary: must NOT match.
        assert!(!cwd_matches_workdir(&sibling, &proj_str));
        // Unrelated: must NOT match.
        assert!(!cwd_matches_workdir(&unrelated, &proj_str));
    }

    /// Deeper-vs-shallower precedence: when both a deep `workDir` and its
    /// shallower ancestor match the cwd, the LONGEST (most specific) workDir
    /// wins, so the more specific session binds.
    #[test]
    fn index_prefers_deepest_matching_workdir() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let root = tempfile::tempdir().expect("work root");
        let shallow = root.path().to_path_buf();
        let deep = root.path().join("nested");
        let cwd = deep.join("leaf");
        std::fs::create_dir_all(&cwd).expect("mkdir cwd");

        let shallow_dir = session_under(kimi_home.path(), "wd_shallow", "session_shallow");
        let shallow_wire = write_wire(&shallow_dir);
        let deep_dir = session_under(kimi_home.path(), "wd_deep", "session_deep");
        let deep_wire = write_wire(&deep_dir);

        // Deep entry listed FIRST so a last-wins tiebreak can't explain a deep win.
        write_index(
            kimi_home.path(),
            &[
                ("session_deep", &deep_dir, &deep),
                ("session_shallow", &shallow_dir, &shallow),
            ],
        );

        let locator = locator_with(kimi_home.path(), 4242, SystemTime::now());
        let located = locator
            .locate(&cwd, "pty-1")
            .expect("deepest workDir resolves");
        assert_eq!(
            located.status_path, deep_wire,
            "the longest (deepest) matching workDir must win over a shallower ancestor"
        );
        assert_eq!(located.agent_session_id.as_deref(), Some("session_deep"));
        assert_ne!(located.status_path, shallow_wire);
    }

    /// Regression for the worktree-cwd bug: kimi registers a worktree (or any
    /// subdirectory) cwd under its GIT-ROOT `workDir`. An index entry with
    /// `workDir=/proj` MUST bind when locating `cwd=/proj/worktrees/wt`
    /// (component-boundary ancestor match), and a sibling cwd `/proj-other`
    /// (string prefix, no path boundary) MUST NOT bind to it.
    #[test]
    fn index_binds_ancestor_workdir_for_worktree_cwd() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let proj_root = tempfile::tempdir().expect("proj root");
        let proj = proj_root.path().join("proj");
        let worktree = proj.join("worktrees").join("wt");
        let sibling = proj_root.path().join("proj-other");
        std::fs::create_dir_all(&worktree).expect("mkdir worktree");
        std::fs::create_dir_all(&sibling).expect("mkdir sibling");

        let session_dir = session_under(kimi_home.path(), "wd_proj", "session_root");
        let wire = write_wire(&session_dir);
        write_index(kimi_home.path(), &[("session_root", &session_dir, &proj)]);

        // Ancestor match: the worktree cwd binds the repo-root workDir session.
        let locator = locator_with(kimi_home.path(), 4242, SystemTime::now());
        let located = locator
            .locate(&worktree, "pty-1")
            .expect("worktree cwd binds its repo-root ancestor session");
        assert_eq!(located.status_path, wire);
        assert_eq!(located.agent_session_id.as_deref(), Some("session_root"));

        // Boundary: a sibling sharing a string prefix must NOT bind, so the
        // ancestor index never matches and the bucket fallback (absent) errors.
        let sibling_locator = locator_with(kimi_home.path(), 4242, SystemTime::now());
        let err = sibling_locator
            .locate(&sibling, "pty-1")
            .expect_err("sibling cwd must not bind the ancestor workDir");
        assert!(err.contains("kimi locator"), "got: {}", err);
    }

    // Symlink <proc_root>/<pid>/cwd → target (so process_cwd resolves it).
    fn write_proc_cwd(proc_root: &Path, pid: u32, target: &Path) {
        let pid_dir = proc_root.join(pid.to_string());
        std::fs::create_dir_all(&pid_dir).expect("create fake pid dir");
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, pid_dir.join("cwd")).expect("symlink cwd");
    }

    /// Root-cause regression: the PTY supplies the STALE spawn-time cwd, but
    /// the kimi process's real cwd (`/proc/<pid>/cwd`) is the project dir its
    /// session was registered under. `process_cwd` must override the passed
    /// (stale) cwd so the index match binds — otherwise `locate` returns Err
    /// and the agent-status panel stays blank.
    #[test]
    fn process_cwd_overrides_stale_passed_cwd_for_index_match() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let proc_root = tempfile::tempdir().expect("proc root");
        // The kimi process's REAL cwd (where it registered its session).
        let real_cwd = tempfile::tempdir().expect("real cwd");

        let session_dir = session_under(kimi_home.path(), "wd_real", "session_real");
        let wire = write_wire(&session_dir);
        write_index(
            kimi_home.path(),
            &[("session_real", &session_dir, real_cwd.path())],
        );

        let pid = 9191;
        write_proc_cwd(proc_root.path(), pid, real_cwd.path());

        let locator = locator_with_proc(kimi_home.path(), pid, SystemTime::now(), proc_root.path());
        // Passed cwd is STALE/wrong — it does not match the index workDir.
        let located = locator
            .locate(Path::new("/some/unrelated/stale/cwd"), "sid")
            .expect("process cwd from /proc/<pid>/cwd must bind the real session");

        assert_eq!(
            located.status_path, wire,
            "must bind via the process cwd, overriding the stale passed cwd"
        );
        assert_eq!(located.agent_session_id.as_deref(), Some("session_real"));
    }

    /// With `proc_root == None` (macOS, no `/proc`), `process_cwd` cannot read
    /// the link, so it falls back to the passed cwd and the index match uses
    /// that. Pins the documented fallback path.
    #[test]
    fn process_cwd_falls_back_to_passed_cwd_without_proc_root() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let session_dir = session_under(kimi_home.path(), "wd_fb", "session_fb");
        let wire = write_wire(&session_dir);
        write_index(
            kimi_home.path(),
            &[("session_fb", &session_dir, work.path())],
        );

        // proc_root is None → process_cwd returns the passed cwd unchanged.
        let locator = locator_with(kimi_home.path(), 4242, SystemTime::now());
        let located = locator
            .locate(work.path(), "sid")
            .expect("passed cwd binds when proc_root is None");
        assert_eq!(located.status_path, wire);
        assert_eq!(located.agent_session_id.as_deref(), Some("session_fb"));
    }

    /// macOS path: with `proc_root == None`, the proc fast-paths skip and
    /// resolution still binds via the (fresh) index match.
    #[test]
    fn no_proc_root_falls_through_to_index() {
        let kimi_home = tempfile::tempdir().expect("kimi home");
        let work = tempfile::tempdir().expect("work dir");
        let session_dir = session_under(kimi_home.path(), "wd_x", "session_mac");
        let wire = write_wire(&session_dir);
        write_index(
            kimi_home.path(),
            &[("session_mac", &session_dir, work.path())],
        );

        let locator = KimiLocator::new(
            kimi_home.path().to_path_buf(),
            4242,
            SystemTime::now() - Duration::from_secs(60),
            None,
        );
        let located = locator.locate(work.path(), "pty-1").expect("index binds");
        assert_eq!(located.status_path, wire);
    }
}
