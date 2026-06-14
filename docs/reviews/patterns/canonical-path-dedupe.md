---
id: canonical-path-dedupe
category: correctness
created: 2026-06-14
last_updated: 2026-06-14
ref_count: 0
---

# Canonical Path Dedupe

## Summary

When deduplicating work by filesystem path, every path in the comparison set
must be canonicalized through the same resolver. Mixing raw and canonicalized
paths — especially once symlinks, `..` segments, or platform-specific casing
enter the picture — makes the same physical file appear as distinct `PathBuf`
values. The result is duplicated work (multiple tailers, watchers, or importers),
inflated counters, and duplicate events.

The safest shape is to canonicalize once at the boundary where the path enters
the dedupe set, then use that canonical value as the key everywhere: children
maps, target lists, and skip-logic.

## Findings

### 1. Main wire can be tailed twice when session paths include symlinks

- **Source:** github-claude | PR #447 round 3 | 2026-06-14
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/kimi/transcript.rs` L223-L297
- **Finding:** The kimi transcript supervisor seeded the main wire from the raw caller-supplied path while `read_agent_wires` canonicalized the discovered agent wires. On symlinked kimi home/session layouts the same physical `wire.jsonl` could appear as two different `PathBuf` values, causing two tailers to read it and emit duplicate events with inflated turn counts.
- **Fix:** Canonicalized `main_wire` at the top of `run_session_supervisor` before using it as a HashMap key or target entry, so dedupe against canonicalized discovered wires is path-equality safe. Added a Unix regression test that symlinks the session dir and asserts exactly one `agent-turn` event is emitted.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. proc-fd trust check rejects authoritative binding on symlinked homes

- **Source:** github-claude | PR #447 round 4 | 2026-06-14
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/kimi/locator.rs` L197-L217
- **Finding:** `try_resolve_from_proc_fds` compared the raw `/proc/<pid>/fd` target against `home.join("sessions")` using lexical `PathBuf::starts_with`. If the effective kimi home was reached through a symlink (NFS mount, Docker volume, or `$KIMI_CODE_HOME` pointing through a symlink), the two spellings could differ even though they named the same directory, causing the authoritative per-process binding to fall back to weaker index/bucket heuristics.
- **Fix:** Canonicalized both the fd wire path and `home.join("sessions")` before the `starts_with` check, falling back to the original paths if either canonicalization fails. The proc-fd fast path now anchors to the real directory while preserving its security boundary.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
