---
id: terminal-control-sequence-handling
category: terminal
created: 2026-06-17
last_updated: 2026-06-18
ref_count: 3
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
- **Finding:** When `\r` arrives in one `write()` call and `\n` in the next, `applyDisplayData` moves the cursor to line-start on `\r`, then the `\n` branch inserts a newline _before_ the existing line content rather than advancing past it, producing a leading blank line and losing the prior line.
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

### 4. eraseLineInState mode 1 keeps character at cursor (off-by-one)

- **Source:** github-claude | PR #516 round 2 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/plainTextInstance.ts` L128-133
- **Finding:** `text.slice(cursor)` in erase-line mode 1 starts at the cursor index, so the character AT the cursor position survives the erase. VT100/xterm specifies that `\x1b[1K` (erase from line start to cursor) is inclusive: the cursor cell must also be cleared.
- **Fix:** Changed the slice to `text.slice(cursor + readCodePointLength(text, cursor))` so the cursor cell is removed, and added a unit test that writes `abc`, positions the cursor after `a`, emits `\x1b[1K`, and expects `c`.
- **Commit:** same commit as this entry

### 5. No-op handler TerminalDisposable discarded — parser handler set never cleaned up

- **Source:** github-claude | PR #516 round 2 | 2026-06-17
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/plainTextInstance.ts` L620-624
- **Finding:** The `onEvent(...)` call in `PlainTextTerminalModel`'s constructor returned a `TerminalDisposable` that was silently dropped, leaving the no-op handler in the parser's internal set for the parser's lifetime and providing no cleanup path if a model-level dispose were added.
- **Fix:** Stored the disposable as `private readonly noOpParserDisposable` and made `rendererHandle.dispose()` call it, aligning the internal subscription with the codebase's pattern of storing and disposing disposables.
- **Commit:** same commit as this entry

### 6. Same-chunk CRLF still skips the carriage-return cursor step

- **Source:** github-claude | PR #516 round 3 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/plainTextInstance.ts` L150
- **Finding:** `applyDisplayData` normalized `\r\n` to `\n` before iterating, so a same-chunk CRLF bypassed the `\r` branch that sets `pendingCr` and moves the cursor to line start. When the cursor was mid-line, the newline was inserted at the current cursor position rather than after the current line, making output depend on PTY chunk boundaries.
- **Fix:** Removed the `data.replace(/\r\n/g, '\n')` pre-pass so same-chunk and split-chunk CRLF both use the existing `\r` + `pendingCr` + `\n` path, and added a regression test that backspaces into the middle of a line before writing `\r\n`.
- **Commit:** same commit as this entry

### 7. Erase-line sentinels collide with visible Private Use Area glyphs

- **Source:** github-claude | PR #516 round 3 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalControlParser.ts` L16
- **Finding:** The in-band erase-line markers used U+E000 through U+E002, which are in the same BMP Private Use Area commonly used by terminal icon fonts. A real prompt glyph at one of those codepoints passed through the parser as visible text and was then consumed by `applyDisplayData` as an erase-line operation.
- **Fix:** Moved the sentinels to Supplementary Private Use Area codepoints U+F0000, U+F0001, and U+F0002, and added a regression test that writes the legacy sentinel codepoint as visible text and expects it to render unchanged.
- **Commit:** same commit as this entry

### 8. CSI 3J clear-scrollback was clearing visible text

- **Source:** github-codex-connector | PR #524 round 1 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalControlParser.ts` L284
- **Finding:** The parser emitted the same clear-screen sentinel for both `CSI 2 J` (erase whole display) and `CSI 3 J` (erase scrollback/saved lines). Because `TerminalDisplayBuffer` drops all buffered text on that sentinel, a program sending only `CSI 3 J` lost the currently visible prompt/output even though mode 3 should leave visible cells intact.
- **Fix:** Narrowed the clear-screen sentinel branch to only `mode === 2`, so `CSI 3 J` no longer clears the visible buffer.
- **Commit:** same commit as this entry
