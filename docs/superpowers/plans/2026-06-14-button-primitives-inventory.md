# Button Primitives — Offender Inventory (VIM-124 audit of record)

> Companion to `docs/superpowers/plans/2026-06-14-button-primitives.md` (Task 1) and
> `docs/superpowers/specs/2026-06-14-button-primitives-design.md` §5 / §7.
>
> **This inventory is the authoritative audit and the VIM-125 floor.** It is a **superset** of the
> `vimeflow/no-raw-icon-button` lint-disable set: the lint rule is a forward guardrail for the two
> common syntactic shapes (spec §5), while this document also records the **helper-classed** icon
> buttons the AST rule cannot see (their `material-symbols-outlined` class comes from a helper such
> as `DockTab`'s `tabIconClass()`, so no literal sits in the JSX). "Audited floor" = this inventory,
> not the disable count.

## How this was produced

```bash
# Shape A (glyph class on the button) + Shape B (icon span child) — what the rule flags:
npx eslint . -f json | jq '... | select(.ruleId=="vimeflow/no-raw-icon-button")'
# Helper-derived icon classes the rule cannot see:
rg -n 'material-symbols-outlined' src -g '*.tsx' -g '!*.test.tsx' | rg 'const .*Class|function|=>'
rg -n 'className=\{(tabIconClass|.*IconClass|.*ButtonClass)' src -g '*.tsx'
# Icon + text buttons (toolbar pills / rows / menu items) — present for classification, not flagged:
rg -n -U '<button[^>]*>(\s|[^<])*<span[^>]*material-symbols-outlined[^>]*>[^<]*</span>\s*[A-Za-z{]' src -g '*.tsx'
```

## Classification key

- **migrate-now** — standalone icon-only `<button>` (Shape A or B). VIM-124 in-scope; migrate to `IconButton`. Carries a plain `// eslint-disable-next-line vimeflow/no-raw-icon-button` until migrated.
- **toolbar-pill** — icon **+** visible label trigger. VIM-124 in-scope; migrate to `ToolbarButton` (or `Button` for the primary action). Not flagged (the rule requires icon-only).
- **deferred-grouped** — inside a tab strip / segmented control / toggle. **VIM-125** (out of VIM-124 scope). If the rule flags it, the disable is tagged `-- VIM-125: grouped control`; helper-classed grouped controls are invisible to the rule and are inventory-only.
- **row-menu-exception** — icon **plus** text/input in a row or menu item. Not an icon button; left raw, not flagged, not migrated.
- **not-a-button** — renders a Material Symbol but on a `<span>`/chip, not a `<button>`. Out of scope entirely.

---

## A. Rule-detected offenders (44 — every one carries an `eslint-disable`)

### A1. migrate-now (standalone icon-only) — 33

| `file:line`                                              | Shape | Variant target           | Notes                                                                                     |
| -------------------------------------------------------- | ----- | ------------------------ | ----------------------------------------------------------------------------------------- |
| `terminal/components/TerminalPane/HeaderActions.tsx:50`  | B     | `IconButton` `sm` ghost  | burner; active tint via `className` (`agent-shell-accent`) + `pressed`                    |
| `terminal/components/TerminalPane/HeaderActions.tsx:78`  | B     | `IconButton` `sm` ghost  | collapse / expand status                                                                  |
| `terminal/components/TerminalPane/HeaderActions.tsx:99`  | B     | `IconButton` `sm` ghost  | close pane                                                                                |
| `terminal/components/BurnerTerminalPopup/index.tsx:324`  | B     | `IconButton` `sm` ghost  | burner align; out-of-sync tint via `className`                                            |
| `terminal/components/BurnerTerminalPopup/index.tsx:349`  | B     | `IconButton` `sm` ghost  | burner hide                                                                               |
| `agent-status/components/AgentStatusRail.tsx:74`         | B     | `IconButton` ghost       | expand activity panel                                                                     |
| `agent-status/components/AgentStatusPanel/Header.tsx:38` | B     | `IconButton` ghost       | collapse activity panel                                                                   |
| `agent-status/components/ActivityEvent.tsx:322`          | B     | `IconButton` `sm` ghost  | copy                                                                                      |
| `sessions/components/Card.tsx:266`                       | B     | `IconButton` `sm` ghost  | kebab; `Menu` trigger, open tint via `aria-expanded`                                      |
| `browser/components/BrowserToolbar.tsx:74`               | B     | `IconButton` ghost       | nav back/forward/reload (`.map`); `disabled` + `rounded-lg` + accent via `className`      |
| `browser/components/BrowserToolbar.tsx:97`               | B     | `IconButton` ghost       | open in system browser; `disabled`                                                        |
| `diff/components/ReviewCommentRow.tsx:21`                | B     | `IconButton` `sm` ghost  | edit comment                                                                              |
| `diff/components/ReviewCommentRow.tsx:35`                | B     | `IconButton` `sm` danger | delete comment (destructive)                                                              |
| `diff/components/toolbar/PriorityPlus.tsx:199`           | B     | `IconButton` ghost       | overflow trigger; `Popover` anchor, `pressed={open}`, keep `rounded-full` via `className` |
| `diff/components/toolbar/ChangeStepper.tsx:61`           | B     | `IconButton` ghost       | prev hunk; `disabled`                                                                     |
| `diff/components/toolbar/ChangeStepper.tsx:78`           | B     | `IconButton` ghost       | next hunk; `disabled`                                                                     |
| `diff/components/toolbar/FilePill.tsx:48`                | B     | `IconButton` ghost       | previous file; `disabled`                                                                 |
| `diff/components/toolbar/FilePill.tsx:93`                | B     | `IconButton` ghost       | next file; `disabled`                                                                     |
| `diff/components/toolbar/ToolWell.tsx:57`                | B     | `IconButton` ghost       | well disabled button (forwardRef); `aria-disabled`                                        |
| `diff/components/toolbar/ToolWell.tsx:95`                | B     | `IconButton` ghost       | well button; `disabled`                                                                   |
| `diff/components/toolbar/DiffChipToolbar.tsx:279`        | B     | `IconButton` ghost       | discard all; `Popover` anchor in wrapper `<span>`, `disabled`                             |
| `diff/components/CommitInfoPanel.tsx:68`                 | A     | `IconButton` ghost       | floating reopen; fixed-position layout via `className`                                    |
| `diff/components/DiffPanelContent.tsx:1364`              | A     | `IconButton` `sm`        | gutter "+" add-comment; translate/round-full via `className`                              |
| `diff/demo/InlineCommentDemo.tsx:154`                    | A     | `IconButton` `sm`        | gutter "+" (demo mirror of DiffPanelContent)                                              |
| `editor/components/ExplorerPane.tsx:28`                  | A     | `IconButton` ghost       | floating reopen explorer; fixed-position via `className`                                  |
| `editor/components/ExplorerPane.tsx:63`                  | A     | `IconButton` ghost       | collapse / expand explorer header                                                         |
| `editor/components/ReadingStyleMenu.tsx:53`              | A     | `IconButton` ghost       | reading-style trigger; `aria-haspopup=menu`, `aria-expanded`                              |
| `workspace/components/InfoBanner.tsx:18`                 | A     | `IconButton` `sm` ghost  | dismiss banner                                                                            |
| `workspace/components/panels/FileExplorer.tsx:284`       | A     | `IconButton` `sm` ghost  | refresh file tree                                                                         |
| `workspace/components/panels/FileExplorer.tsx:302`       | A     | `IconButton` `sm` ghost  | parent directory; `disabled` in wrapper `<span>`                                          |
| `workspace/components/panels/FileExplorer.tsx:345`       | A     | `IconButton` `sm` ghost  | dismiss action error                                                                      |
| `workspace/components/panels/FileExplorer.tsx:372`       | A     | `IconButton` `sm`        | confirm rename                                                                            |
| `workspace/components/panels/FileExplorer.tsx:383`       | A     | `IconButton` `sm`        | cancel rename                                                                             |

### A2. deferred-grouped (VIM-125, rule-flagged) — 11 (tagged `-- VIM-125: grouped control`)

| `file:line`                                | Shape | Grouped control                        |
| ------------------------------------------ | ----- | -------------------------------------- |
| `workspace/components/DockTab.tsx:182`     | B     | dock actions kebab (DockTab strip)     |
| `workspace/components/DockTab.tsx:230`     | B     | collapse panel (DockTab, compact)      |
| `workspace/components/DockTab.tsx:263`     | B     | collapse panel (DockTab)               |
| `editor/components/EditorTabs.tsx:63`      | A     | per-tab close (editor tab strip)       |
| `editor/components/FileTabs.tsx:70`        | A     | per-tab close (file tab strip)         |
| `editor/components/FileTabs.tsx:87`        | A     | new file (file tab strip)              |
| `sessions/components/Tabs.tsx:183`         | B     | new session (session tab strip)        |
| `sessions/components/Tab.tsx:117`          | B     | per-tab close (session tablist)        |
| `browser/components/BrowserTabBar.tsx:93`  | B     | per-tab close (browser tab strip)      |
| `browser/components/BrowserTabBar.tsx:113` | B     | new browser tab (browser tab strip)    |
| `browser/components/BrowserTabBar.tsx:131` | B     | close browser pane (browser tab strip) |

---

## B. Inventory-only (NOT rule-flagged — no `eslint-disable`)

### B1. deferred-grouped, helper-classed (VIM-125) — rule cannot see; inventory is the record

| `file:line`                            | Grouped control                                  | Why the rule misses it                                                        |
| -------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `workspace/components/DockTab.tsx:142` | Diff Viewer dock tab (segmented, `aria-pressed`) | icon class from `tabIconClass()` helper; icon-only only when `compactActions` |
| `workspace/components/DockTab.tsx:157` | Editor dock tab (segmented, `aria-pressed`)      | same — `tabIconClass()` helper; conditional `Editor` text label               |

### B2. toolbar-pill (icon + label trigger) — VIM-124 in-scope, migrate to `ToolbarButton` / `Button`

| `file:line`                                           | Target                  | Notes                                                             |
| ----------------------------------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `diff/components/toolbar/ViewSettingsDropdown.tsx:73` | `ToolbarButton` toolbar | `tune` + "View" + `expand_more`; passed as `Menu` trigger         |
| `components/Dropdown.tsx:122`                         | `ToolbarButton` toolbar | built-in dropdown trigger (already a primitive; adopt internally) |
| `workspace/components/NewSessionButton.tsx:21`        | `Button` primary        | `add` + "New session"; reveal-animation layout via `className`    |

### B3. row-menu-exception (icon **plus** text/input) — not an icon button, left raw, not migrated

| `file:line`                                                 | Context                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `sessions/components/Card.tsx:43`                           | session-action menu item (icon + label)                                                      |
| `sessions/components/Card.tsx:155`                          | card body button (icon + session text)                                                       |
| `sessions/demo/ReorderMotionDemo.tsx`                       | demo card rows (icon + label)                                                                |
| `terminal/components/TerminalPane/RestartAffordance.tsx:20` | restart row (icon + "Restart" label)                                                         |
| `diff/components/ChangedFilesList.tsx:74`                   | changed-file row (status icon + path text)                                                   |
| `diff/components/toolbar/Toggle.tsx:21`                     | chip toggle (icon + label, `aria-pressed`) — also grouped/segmented; stays raw as icon+label |

### B4. not-a-button (Material Symbol on a `<span>`/chip) — out of scope entirely

| `file:line`                                           | Context                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `terminal/components/TerminalPane/GitRefChip.tsx:108` | worktree icon span (`account_tree`) + label, inside a chip `<span>` |
| `terminal/components/TerminalPane/GitRefChip.tsx:129` | branch icon span (`fork_right`) + label, inside a chip `<span>`     |

---

## Category counts

| Category                              | Count  | Rule-flagged?       | VIM-124 action                            |
| ------------------------------------- | ------ | ------------------- | ----------------------------------------- |
| migrate-now (A1)                      | 33     | yes (plain disable) | migrate to `IconButton` (PR1/PR3)         |
| deferred-grouped, rule-flagged (A2)   | 11     | yes (`-- VIM-125`)  | hand to VIM-125                           |
| deferred-grouped, helper-classed (B1) | 2      | no                  | hand to VIM-125                           |
| toolbar-pill (B2)                     | 3      | no                  | migrate to `ToolbarButton`/`Button` (PR2) |
| row-menu-exception (B3)               | 6      | no                  | leave raw                                 |
| not-a-button (B4)                     | 2      | no                  | out of scope                              |
| **Total audited**                     | **57** | 44 flagged          | —                                         |

**Lint-disable set = 44** (A1 33 + A2 11) — a subset of the 57-entry audit. The VIM-124 floor is reached
when every **migrate-now** (A1) and **toolbar-pill** (B2) entry — 36 total — is migrated away; the
**deferred-grouped** entries (A2 + B1 = 13) are the precise VIM-125 backlog.
