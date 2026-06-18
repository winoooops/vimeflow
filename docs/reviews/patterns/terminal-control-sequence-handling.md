---
id: terminal-control-sequence-handling
category: terminal
created: 2026-06-17
last_updated: 2026-06-18
ref_count: 5
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

### 9. CSI D/C/G explicit zero count is treated as no movement

- **Source:** github-claude | PR #524 round 2 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalControlParser.ts` L288-325
- **Finding:** The parser passed `parseCsiIntegerParameter` results directly to sentinel emission for `CSI D`, `CSI C`, and `CSI G`. For cursor movement/count parameters, an omitted value and an explicit `0` should both behave as the default count/column `1`. The original code emitted no D/C movement for `CSI 0D`/`CSI 0C` and only a carriage return for `CSI 0G`, which corrupts progress or prompt redraw output.
- **Fix:** Normalized parsed zero values to `1` in the D, C, and G branches before emitting cursor-left/cursor-right/carriage-return sentinels, and added a regression test that asserts `CSI 0D`, `CSI 0C`, and `CSI 0G` each produce the same result as the default value.
- **Commit:** same commit as this entry

### 10. Cursor inside a styled run splits it into two sibling `data-terminal-style-run` spans

- **Source:** github-claude | PR #530 round 1 | 2026-06-18
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts` L530-572
- **Finding:** `createOutputFragments` split a styled run at the cursor offset into two separate `<span data-terminal-style-run>` elements, each carrying identical CSS. Code that queries `data-terminal-style-run` elements to read run text or style (including E2E helpers) saw a fragmented view of what is logically one run.
- **Fix:** When the cursor lands strictly inside a styled run, wrap the cursor element inside a single `data-terminal-style-run` span rather than emitting two sibling spans. Added a regression test that asserts only one style-run span exists and that it contains the cursor element.
- **Commit:** same commit as this entry

### 11. applySgrStyle: invalid color sub-params fall through, misread as style codes

- **Source:** github-claude | PR #530 round 2 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalDisplayBuffer.ts` L254-288
- **Finding:** When a `38;2;R;G;B` true-color sequence has invalid or missing component values, the guard rejected the color but did not advance the parameter index past the sub-parameters. Control fell through to `index += 1`, so the color-mode byte (`2` or `5`) was consumed as a standalone SGR attribute in the next iteration, applying `dim` or corrupting subsequent styles.
- **Fix:** Restructured the true-color and indexed branches to advance `index` by the full arity (5 for mode 2, 3 for mode 5) unconditionally, applying the style only when the color resolves. Added a regression test for out-of-range RGB and truncated indexed sequences.
- **Commit:** same commit as this entry

### 12. eraseDisplayInState mode 1 (ESC[1J) has no buffer-level test

- **Source:** github-claude | PR #534 round 1 | 2026-06-18
- **Severity:** HIGH
- **File:** `src/features/terminal/components/TerminalPane/terminalDisplayBuffer.ts` L728-736
- **Finding:** `eraseDisplayInState` is called for both mode 0 and mode 1, but `terminalDisplayBuffer.test.ts` only exercises mode 0 (`getEraseDisplaySentinel(0)`). The mode 1 branch (lines 728–736) — which removes text from position 0 through the cursor character ...
- **Fix:** Addressed in the same commit that appended this entry.
- **Commit:** same commit as this entry

### 13. softWrapAtCursor inserts duplicate newline after erase on wrapped line

- **Source:** github-claude | PR #534 round 1 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalDisplayBuffer.ts` L408-431
- **Finding:** `eraseLineInState` mode 2 splices `[lineStart, lineEnd)` where `lineEnd` is the index of `\n`, so the soft-wrap `\n` is kept as the first character of remaining text. When new content is then written from `cursor = 0`, `writeDisplayCharacter` inserts...
- **Fix:** Addressed in the same commit that appended this entry.
- **Commit:** same commit as this entry

### 14. parseCsiCursorPosition calls content.split(';') twice

- **Source:** github-claude | PR #534 round 1 | 2026-06-18
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/terminalControlParser.ts` L312-332
- **Finding:** `parseCsiCursorPosition` destructures `content.split(';')` into `[rowText, columnText]` and then calls `content.split(';')` again solely to check `.length > 2`. Use `const parts = content.split(';')` once, destructure from `parts`, and compare `parts...
- **Fix:** Addressed in the same commit that appended this entry.
- **Commit:** same commit as this entry

### 15. Avoid inserting wrap rows over existing TUI rows

- **Source:** github-codex-connector | PR #534 round 1 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalDisplayBuffer.ts` L430-430
- **Finding:** When repainting an existing screen row that is exactly `columns` wide, the next printable cell should wrap onto the already-existing next row and overwrite there. This branch always inserts a new `\n` at the cursor, so a redraw like an existing `abcd...
- **Fix:** Addressed in the same commit that appended this entry.
- **Commit:** same commit as this entry

### 16. ESC[G (cursor horizontal absolute) skips columns inside wide characters

- **Source:** github-claude | PR #534 round 2 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalControlParser.ts` L522-540
- **Finding:** The `ESC[nG` handler translated the sequence to `\r` plus cursor-right sentinels. `moveCursorRight` advances by whole glyphs, so when the target column fell inside a wide character the cursor overshot to the character after it.
- **Fix:** Added a dedicated `CursorHorizontalAbsoluteSentinel` that carries only the target column. The display buffer resolves it on the current row using a column lookup that lands on the wide-glyph start when the target falls inside the glyph.
- **Commit:** same commit as this entry

### 17. Create missing rows for cursor-down moves

- **Source:** github-codex-connector | PR #534 round 2 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalDisplayBuffer.ts` L466-478
- **Finding:** `moveCursorDown` returned the end of the last buffered line when asked to move below it. A subsequent `\r` then operated on the original line and overwrote it, so `line1\x1b[Eline2` rendered as `line2` instead of two rows.
- **Fix:** In `applyDisplayData`, when a cursor-down sentinel is at the last line, route through `moveCursorToPosition(row + 1, current column + 1)` so the new row is materialized and padded to the original horizontal position.
- **Commit:** same commit as this entry

### 18. Wrap wide glyphs before appending them at the margin

- **Source:** github-codex-connector | PR #534 round 2 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/terminalDisplayBuffer.ts` L626-643
- **Finding:** `softWrapAtCursor` wrapped only when the current line width reached `columns`. A two-cell glyph written at `columns - 1` therefore produced a line wider than the terminal, clipping the glyph and throwing off later cursor math.
- **Fix:** Pass the incoming character to `softWrapAtCursor` and wrap when `lineCellWidth + readTerminalCellWidth(character, 0) > columns`.
- **Commit:** same commit as this entry
