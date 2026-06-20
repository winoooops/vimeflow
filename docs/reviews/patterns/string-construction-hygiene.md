---
id: string-construction-hygiene
category: code-quality
created: 2026-06-15
last_updated: 2026-06-19
ref_count: 1
---

# String Construction Hygiene

## Summary

When building structured strings (JSON records, SVG path commands, query fragments, log lines,
etc.), prefer a proper serializer or join/trim utilities over manual interpolation. Manual
templating forgets escaping (quotes, backslashes, delimiters), leaves trailing separators or
whitespace, and produces malformed output that consumers often swallow silently. For JSON and
similar formats, always use a serialization library; for delimited lists, use `Array.join` or
trim the accumulator before interpolation.

## Findings

### 1. SVG fill path built from untrimmed crest accumulator

- **Source:** github-claude | PR #457 round 2 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/agent-status/hooks/useReservoirFlow.ts`
- **Finding:** `buildReservoirSurface` built `fill` by interpolating the raw `crest` accumulator (`fill: \`${crest}L ${TANK_WIDTH} ${height} L 0 ${height} Z\``). The loop appended a trailing space after each point, leaving a double space before the closing commands. SVG parsers tolerate the extra whitespace, but the returned `fill`was inconsistent with the already-trimmed`crest`.
- **Fix:** Trimmed the accumulator before interpolation: `fill: \`${crest.trim()} L ${TANK_WIDTH} ${height} L 0 ${height} Z\``.
- **Commit:** same commit as this entry

### 2. Kimi E2E `session_index.jsonl` built with manual JSON interpolation

- **Source:** github-claude | PR #563 round 7 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `crates/backend/src/runtime/state.rs`
- **Finding:** `e2e_start_kimi_watcher` wrote `session_index.jsonl` with `format!("{{\"sessionId\":\"{}\",\"sessionDir\":\"{}\",\"workDir\":\"{}\"}}\n", ...)`. If the working directory contained `"` or `\\`, the JSONL line became malformed and the Kimi locator silently failed to resolve the seeded wire file.
- **Fix:** Replaced manual interpolation with `serde_json::json!({"sessionId": session_dir_name, "sessionDir": ..., "workDir": cwd}).to_string()` followed by a newline.
- **Commit:** same commit as this entry
