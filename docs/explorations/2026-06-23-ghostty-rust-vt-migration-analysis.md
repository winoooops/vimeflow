# Ghostty VT — Rust migration analysis

**Date:** 2026-06-23
**Question:** Take everything built for the `@coder/libghostty-vt-node` **UI/frontend capability** (the VIM-216 lineage) and map it onto the **new Rust VT approach** so it can all land there.
**Inputs:** two worktrees — `ghostty-verify` (JS path, VIM-216 committed) and the Rust path: the **`rust-libghostty-vt`** approach (currently the `worktrees/ghostty-official-vt-investigation` worktree, uncommitted WIP). "rust-libghostty-vt" is the exact name for the approach below.

---

## 0. TL;DR

The Rust approach is **architecturally cleaner and already renders shell/codex through the same `TerminalTextSurface`** — so most of the JS bridge isn't _ported_, it's **deleted**. But the Rust render-state is **viewport-only**: it has **no scrollback, no alt-screen flag**, so **none of the VIM-216 capability exists on the Rust path yet**. The VIM-216 _DOM_ pieces (static region, scroll machine, selection) are engine-agnostic and stay; the _work_ is on the **Rust side** — expose scrollback + alt-screen + lazy scrollback fetch — plus re-homing the `attachScrollback` delta protocol off the (now-deleted) driver seam.

**Shape of the migration:** ~60% of the JS code **deletes**, the DOM renderer **stays**, and the real new build is **Rust-side render-state extensions**.

---

## 1. Two parallel implementations (both branched from `5b65cd1f`)

|                        | **JS path** (`ghostty-verify`, VIM-216, committed)                               | **Rust path** (`official-vt`, 43-file uncommitted WIP)                                                  |
| ---------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| VT engine              | `@coder/libghostty-vt-node` in **Electron main**                                 | official **`libghostty-vt 0.2.0` Rust crate** in the sidecar (`crates/backend/src/terminal/ghostty.rs`) |
| Terminal-state owner   | Electron-main JS process (a 2nd VT)                                              | **the Rust sidecar** (already the PTY owner — the doc's explicit requirement)                           |
| Render-state transport | **dedicated sync-IPC bridge** (`ghostty-render-state-*`, `ipcRenderer.sendSync`) | **piggybacks the existing async `pty-data` event** (`PtyDataEvent.ghosttySnapshot`, stdout JSON-RPC)    |
| Color/style source     | `terminal.formatHtml()` → HTML walked + parsed in main                           | **structured cells with `#rrggbb` resolved by libghostty**                                              |
| The JS bridge          | home of all VIM-216 work                                                         | **deleted** (`-channels/-main/-preload`, `ghosttyNativeRenderStateBridge` all `D`)                      |
| Renderer               | `TerminalTextSurface` (custom DOM)                                               | **same `TerminalTextSurface`**                                                                          |

The Rust WIP deletes the exact bridge VIM-216 sits on, so VIM-216 capability does **not** carry over for free.

---

## 2. The Rust render-state (what the engine actually emits today)

`GhosttyVtRenderSnapshot` (`crates/backend/src/terminal/types.rs`):

```
{ rows: Vec<String>,                       // viewport rows, trailing-space trimmed
  cursor?: { rowIndex, columnOffset, visible? },
  cells?: [{ row, col, text, width,        // width 2 for wide; spacer cells skipped
             bold?, italic?, underline?, reverse?,
             foreground?: "#rrggbb", background?: "#rrggbb" }] }  // colors RGB-resolved
```

- Delivered **inline on every `pty-data` chunk** (`ghosttySnapshot`), plus on `list_sessions` for restore (`latest_snapshot`). Gated on `VITE_TERMINAL_RENDERER=ghostty`.
- Frontend consumes it via a **short-circuit** in `GhosttyControlSequenceParserEngine.parseOutput`: when `chunk.ghosttySnapshot` is present it calls `createGhosttyVtRenderSnapshotOutput(snapshot)` directly → SGR-sentinel `displayText` → `TerminalTextSurface`. **This bypasses the entire `GhosttyVtRenderStateDriver` seam.**

**Implemented:** VT parse, styled cells, truecolor (RGB-resolved), wide chars, cursor pos + `visible`, OSC7 cwd, resize, session restore.
**Missing / stubbed (the gaps):** **scrollback rows** (10k buffer configured but not serialized), **alt-screen flag**, 256-color fallback (`RgbColor` only — `None` → silent no-color), dirty regions (full snapshot per chunk), mouse/key encoding, reflow visibility, `formatHtml` (gone — replaced by structured cells, which is the win).

---

## 3. Capability → Rust landing map

Source inventory: the VIM-216 frontend capability list (A = Electron-main bridge, B = TS frontend).

### 3a. DELETE — JS bridge workarounds the Rust engine makes unnecessary

| JS capability                                                                                     | Why it dies on Rust                                                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A.1 native `.node` binding load                                                                   | Rust crate; no `.node`                                                 |
| A.3 sync-IPC dispatch (8 channels) + A.14 channel registry                                        | render-state rides the async `pty-data` event                          |
| A.4 OSC7 scanner, A.5 cursor-visibility scanner                                                   | libghostty resolves both natively (OSC7 callback + `cursor_visible()`) |
| **A.6 `formatHtml` bg/reverse synthesis**                                                         | structured cells carry fg/bg directly — the whole HTML walk is gone    |
| **A.7 `computeRowShift`, A.8 cell-merge, A.11 `readStyledCellsFromHtml`, A.12 palette-from-HTML** | all exist only to reconstruct cells from `formatHtml`; obsolete        |
| B.1 preload bridge, B.2 `ghosttyNativeRenderStateBridge`                                          | the sync-IPC surface is gone                                           |

~All of section A + the sync-IPC plumbing. This is the bulk of the line-count savings.

### 3b. KEEP — engine-agnostic DOM/render (already consuming the Rust snapshot)

`createGhosttyVtRenderSnapshotOutput` (B.5), `encodeScrollback` (B.6), `TerminalTextSurface` two-region layout (B.7), **scroll machine** (B.8), **cross-region selection** (B.9), block glyphs (B.10), cursor element + cell-width (B.11), theme/OSC CSS vars (B.12), `TerminalDisplayBuffer` (B.13), parser-engine byte routing (B.14), `GhosttyTerminalModel` rAF coalescing (B.16), DEC-2026 sync-frame tracker (B.4).

These don't care where the snapshot came from. **VIM-216's static region + scroll machine + selection are ready to use — they're just starved of scrollback data.**

### 3c. REWORK — the seam

- **B.3 `attachScrollback` / `cachedScrollbackRowCount` (the VIM-216 scrollback-delta protocol).** Today it lives in the `GhosttyVtRenderStateDriver.flushOutput` coalescer and lazily calls `readScrollback` on count-change, emitting the tri-state `output.scrollback` payload the static region consumes. On Rust, `parseOutput` short-circuits the driver entirely → this protocol must be **re-homed into the snapshot path** (compute the tri-state payload where the Rust snapshot arrives).
- **B.15 byte-parser adapter, A.2/A.13 driver lifecycle + reset/resize** → become async sidecar commands; the `GhosttyVtRenderStateDriver` abstraction is **redundant on the Rust path** (decision: keep for the JS path/tests, or delete).

---

## 4. The critical gap: VIM-216 scrollback has no data source on Rust

The DOM consumers (3b) are present, but the Rust snapshot is **viewport-only**. To light up VIM-216 on Rust, the **Rust engine must grow**, in order:

1. **`scrollbackRowCount` + `isAltScreen`** on the snapshot (cheap — libghostty has both). Unblocks the static region's show/clear gating and VIM-216 alt-screen suppression. _This alone makes the region appear/disappear correctly._
2. **A scrollback fetch** returning styled rows (same cell shape as viewport). Two options:
   - **Inline** in every snapshot — simplest, but pays the full-history cost per chunk (the VIM-224 anti-pattern).
   - **Lazy command** — a `read_scrollback(session, range)` sidecar command, gated on actual scroll-up. **Recommended** — it's exactly VIM-224's "gate scrollback work on scroll-up," and it mirrors the JS `READ_SCROLLBACK` contract that `attachScrollback` already speaks (minimal TS change).
3. **Re-home `attachScrollback`**: keep the tri-state `output.scrollback` (unchanged/replace/clear) but drive it from `(scrollbackRowCount, isAltScreen)` in the snapshot + the lazy fetch — feeding the unchanged `TerminalTextSurface.renderScrollback`.

Net: VIM-216's **DOM side is a no-op port**; the **engine side is new Rust work**.

---

## 5. Other gaps to close (so everything truly lands)

| Gap                                             | Impact                                                    | Action                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **alt-screen flag**                             | VIM-216 suppression + **VIM-223** (claude is alt-screen)  | surface `screen.mode` on the snapshot                                                                     |
| **256-color fallback**                          | indexed colors silently drop if libghostty returns `None` | verify libghostty resolves indexed→RGB; else port `palette256ToRgb` Rust-side                             |
| **cursor visibility / parked-cursor heuristic** | JS `shouldHideImplicitParkedCursor` is a hack             | resolve authoritatively in Rust where possible                                                            |
| **mouse / key encoding**                        | **VIM-223** claude scroll; future input fidelity          | libghostty-vt ships encoders — wire them instead of raw `write_pty`                                       |
| **per-chunk full snapshot, no dirty regions**   | perf — a snapshot per PTY chunk, whole-viewport replace   | rAF coalescing (B.16) already dedupes on TS side; consider Rust-side coalescing or a dirty-row hint later |

---

## 6. Working procedure — Electron path as the reference map

**Guiding principle:** keep the Electron / JS path (`ghostty-verify`, `@coder/libghostty-vt-node`) **untouched as a living reference** while porting the frontend capability into the Rust build. We always have a working implementation to diff against; the JS path is deleted **only at the very end**, after parity is verified.

0. **Reference baseline.** Leave `ghostty-verify` as-is — it is the behavioral spec / map. Commit the Rust WIP behind the `ghostty` opt-in so the Rust path renders shell/codex through the same `TerminalTextSurface`.
1. **Port the frontend functionality into the Rust build, capability by capability**, using the Electron implementation as the map. Most DOM pieces (§3b) already exist in the Rust worktree; reconcile any divergence against the reference and verify each before moving on.
2. **Land the current scrolling work into the new worktree.** Bring VIM-216's static scrollback region + scroll machine + cross-region selection into the Rust worktree, wired to the Rust snapshot. Prerequisites on the Rust side:
   - snapshot **`scrollbackRowCount` + `isAltScreen`** (cheap; unblocks region show/clear + alt-screen behavior),
   - a **lazy `read_scrollback` command gated on scroll-up** (≙ the JS `READ_SCROLLBACK` contract `attachScrollback` already speaks; also VIM-224's perf fix),
   - re-home `attachScrollback` onto it — the DOM consumers are unchanged.
3. **Verify parity** of each ported capability against the Electron reference (render fidelity, scrollback, alt-screen, restore, selection) before proceeding.
4. **Close the engine gaps** in §5 (alt-screen consumers, 256-color fallback, cursor visibility), then **mouse/key encoding (VIM-223)** via libghostty's encoders.
5. **Revisit scrolling to refine** — once all the previous (foundational) frontend work is ported and verified. (VIM-224 perf falls out here: the lazy fetch is the gate-on-scroll-up; the per-frame `formatHtml` walk is already gone.)
6. **Only then delete the JS path** — `electron/ghostty-render-state-*`, `ghosttyNativeRenderStateBridge`, `@coder/libghostty-vt-node`, the redundant `GhosttyVtRenderStateDriver` seam — once Rust parity is green and the reference is no longer needed.

---

## 7. Risks & open decisions

- **`libghostty-vt 0.2.0` API is explicitly unstable** (per the genesis investigation) — pin the version, isolate the engine boundary in `ghostty.rs`.
- **Keep or drop `GhosttyVtRenderStateDriver`?** It's dead weight on the Rust path but still backs the JS path + a lot of tests. Recommend: keep until the JS path is deleted (step 5), then remove.
- **Snapshot-per-chunk volume** — confirm the rAF coalescing holds under fast streaming; if not, coalesce snapshot emission Rust-side.
- **Packaging** — bundling the Rust lib + artifacts for macOS/Linux (the WIP already touches `electron-builder.yml`); Windows is out of scope for ghostty per the genesis doc.
- **Parity test harness** — the JS path has rich main-process + bridge tests that mostly delete; the Rust path needs equivalent coverage (snapshot shape, scrollback, alt-screen, restore) before the JS path is removed.
