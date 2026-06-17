---
id: terminal-control-sequence-handling
category: terminal
created: 2026-06-17
last_updated: 2026-06-17
ref_count: 0
---

# Terminal Control Sequence Handling

## Summary

The plain-text terminal renderer processes PTY output as a stream of visible
characters and control sequences. Correctness depends on state that spans
multiple `write()` calls (cursor position, pending carriage returns) and on
control sequences that are stripped or reinterpreted by the parser. Fixes in
this area must preserve ordering between control sequences and visible text,
must keep partial sequences pending across chunk boundaries, and must carry
all required state through pure display-state helpers.

## Findings

### 1. Split \r\n across writes inserts blank line instead of advancing cursor

- **Source:** github-claude | PR #516 round 1 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/plainTextInstance.ts` L103-126
- **Finding:** When `\r` arrives in one `write()` call and `\n` in the next, `applyDisplayData` moves the cursor to line-start on `\r`, then the `\n` branch inserts a newline *before* the existing line content rather than advancing past it, producing a leading blank line and losing the prior line.
- **Fix:** Added `pendingCr` to `DisplayState`; set it on `\r`, clear it on any other character, and advance the cursor to the end of the current line before inserting the newline when `\n` follows a pending `\r`. Narrowed `writeDisplayCharacter`'s return type and preserved `pendingCr` through `trimScrollbackLines`.
- **Commit:** same commit as this entry

### 2. Handle erase-line CSI before stripping it

- **Source:** github-codex-connector | PR #516 round 1 | 2026-06-17
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalControlParser.ts` L163
- **Finding:** The parser dropped every CSI sequence before the display layer could act on it. For progress output like `building 100%\r\x1b[Kdone`, stripping `ESC[K` left stale characters (`doneing 100%`) instead of clearing the line.
- **Fix:** The parser now replaces CSI `K` sequences with private-use sentinels that encode the erase mode (0, 1, or 2). `applyDisplayData` interprets each sentinel at its original stream position, so ordering between erase-line and later visible text in the same chunk is preserved. A no-op parser-event subscription keeps the plain-text renderer in sequence-stripping mode.
- **Commit:** same commit as this entry

### 3. Buffer split ESC prefixes across chunks

- **Source:** github-codex-connector | PR #516 round 1 | 2026-06-17
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalControlParser.ts` L167
- **Finding:** When a PTY chunk ended with just `ESC` and the next chunk started `[38;...m`, the parser emitted the escape byte as visible output and advanced, so the following chunk no longer matched `CSI_PREFIX` and rendered literal color/control text.
- **Fix:** When an `ESC` byte appears at the very end of a chunk, store it in `pendingControlSequence` instead of emitting it as visible output, allowing the next chunk to complete the sequence.
- **Commit:** same commit as this entry
