---
id: string-construction-hygiene
category: code-quality
created: 2026-06-15
last_updated: 2026-06-15
ref_count: 0
---

# String Construction Hygiene

## Summary

When building structured strings (SVG path commands, query fragments, log lines,
etc.) by accumulating values in a loop, the accumulator often carries a trailing
separator or whitespace. Interpolating that accumulator into a larger template
without trimming or using a join-based approach produces doubled delimiters,
trailing spaces, or malformed commands. The defect is usually silent because the
consumer (SVG parser, shell, template engine) tolerates the extra whitespace,
but it makes the output inconsistent and can mask real formatting bugs. Prefer
`Array.join` for separators, or trim the accumulator before interpolation.

## Findings

### 1. SVG fill path built from untrimmed crest accumulator

- **Source:** github-claude | PR #457 round 2 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/agent-status/hooks/useReservoirFlow.ts`
- **Finding:** `buildReservoirSurface` built `fill` by interpolating the raw `crest` accumulator (`fill: \`${crest}L ${TANK_WIDTH} ${height} L 0 ${height} Z\``). The loop appended a trailing space after each point, leaving a double space before the closing commands. SVG parsers tolerate the extra whitespace, but the returned `fill`was inconsistent with the already-trimmed`crest`.
- **Fix:** Trimmed the accumulator before interpolation: `fill: \`${crest.trim()} L ${TANK_WIDTH} ${height} L 0 ${height} Z\``.
- **Commit:** same commit as this entry
