# Markdown reading view — design

- **Date:** 2026-05-30
- **Status:** Draft (awaiting review)
- **Area:** `src/features/editor/services/languageService.ts`, `src/features/editor/components/MarkdownReadingView.tsx` (new), `src/features/workspace/components/DockPanel.tsx`, `src/features/workspace/components/DockTab.tsx`
- **Topic:** Give the dock editor a polished READING view for markdown (specs / plans / docs) **without** replacing CodeMirror 6 or losing vim. This promotes "Option B" from the exploration ([`docs/explorations/markdown-reader-editor.html`](../../explorations/markdown-reader-editor.html)) to an implementation-ready spec.

## Goal

When the user opens a `.md` / `.markdown` file in the dock editor tab, it renders
as a **rendered document** (heading hierarchy, GFM tables, followable links,
highlighted code fences) by default, themed to the Obsidian Lens — and a
Source ⇄ Reading toggle flips back to the existing CodeMirror 6 + vim editor on
demand. Non-markdown files are **completely unaffected** — they mount the exact
same `<CodeEditor>` as today, with vim fully intact.

## Decisions locked

| #   | Decision                                                                                                                                                                                                                                                         | Source                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| D1  | Ship **Option B** (dual surface): keep CM6 + vim as the editor, add a separate `react-markdown` reading view. **Option C (WYSIWYG: Milkdown / TipTap / Lexical) is rejected** — it replaces CodeMirror for `.md` and forfeits vim.                               | exploration §4 (recommended)               |
| D2  | Markdown highlighting in source mode is a **free win**: one branch in `languageService.ts`, one dep (`@codemirror/lang-markdown`). The editor + vim wiring in `useCodeMirror.ts` is **unchanged** (purely additive).                                             | exploration §4 Option A / §5.1             |
| D3  | Reading view uses `react-markdown` + `remark-gfm` + `rehype-sanitize` + `rehype-highlight`. **Plugin order is `rehypePlugins={[rehypeSanitize, rehypeHighlight]}`** — sanitize FIRST, highlight SECOND, so highlight.js `.hljs-*` classes survive the sanitizer. | exploration §5.2 + plugin-order constraint |
| D4  | Default view mode for markdown files is **`'reading'`** so docs open pretty. The toggle lets the user drop to Source (vim) at will.                                                                                                                              | exploration §5.4 (default Reading)         |
| D5  | View-mode state lives **locally in `DockPanel`** (the only `DockPanel` consumer is `WorkspaceView.tsx:963`, and the dock already owns its own ephemeral panel state). Not persisted across reload — matches the dock's existing non-persistence stance.          | recommended default — flagged for veto     |
| D6  | The toggle is **composed alongside** `<DockSwitcher>` in the existing `DockTab` `children` slot, shown only when `tab==='editor'` AND the file is markdown. `DockSwitcher` is **not** removed.                                                                   | exploration §5.4 + `DockTab` API           |
| D7  | All reading-view theming uses **semantic Tailwind tokens / `theme()` values** — no raw hex. highlight.js token colors map to the `syn.*` tokens via a co-located `MarkdownReadingView.css`.                                                                      | project theming rule                       |

## Non-goals

- **No WYSIWYG / live-preview editing** of markdown (Option C). Revisit only if
  in-place rendered editing becomes a first-class product goal; the exploration
  flags Milkdown as the pick if so.
- **No replacement of CodeMirror 6 or the vim wiring** for any file type. The
  editor code path is only ever _added to_ (source-mode highlighting) or
  _branched around_ (reading view), never replaced.
- **No new data flow.** `MarkdownReadingView` takes the same `content: string`
  the dock already passes to `<CodeEditor>`. No new fetch, no IPC, no bindings.
- **No persistence** of the per-file view mode across app reload (D5). Easy
  follow-up later via the same localStorage mechanism other dock state could use.
- **No `rehype-slug` / `rehype-autolink-headings`** (anchored TOC) in this pass —
  flagged in the exploration as a later polish, out of scope here.
- **No editing from the reading view.** It is read-only; to edit, toggle to
  Source. (The buffer is unchanged; toggling back shows the same content.)

## Background (the gap, grounded in our code)

What happens **today** when a `.md` spec is opened in the dock:

1. **No language, no highlight.** The dock's editing surface is
   `src/features/editor/components/CodeEditor.tsx`, a thin CM6 wrapper that
   derives its language extension purely from the filename
   (`CodeEditor.tsx:58-63`) via `getLanguageExtension()` in
   `src/features/editor/services/languageService.ts`. That `switch` maps `js`,
   `jsx`, `ts`, `tsx`, `rs`, `json`, `css`, `html`, `htm` — and **everything
   else falls through to `default: return null`** (`languageService.ts:31-32`).
   A `.md` file therefore lands on `null`: raw, unstyled monospace text — no
   heading hierarchy, no rendered tables, no highlighted fences, no followable
   links.

2. **The deps don't exist.** `package.json` declares CM6 language packs only for
   `css`, `html`, `javascript`, `json`, `rust` — there is **no
   `@codemirror/lang-markdown`** and **no renderer** (`react-markdown`,
   `markdown-it`, `marked`, `remark`, `rehype`, …) anywhere in the dependency
   tree (verified: `grep -niE 'markdown|remark|rehype|highlight' package.json`
   returns nothing).

3. **`'markdown'` is a label without an implementation.** The `FileLanguage`
   union at `src/features/editor/types/index.ts:7` _names_ `'markdown'`, but
   nothing ever produces a markdown view from it.

4. **The single integration point.** The editor surface is mounted inside the
   `tab === 'editor'` block of
   `src/features/workspace/components/DockPanel.tsx` (the `<CodeEditor>` at
   `DockPanel.tsx:313`, wrapped by the `data-testid="editor-panel"` div). `DockPanel`'s
   only consumer is `WorkspaceView.tsx:963`. (`EditorPanel.tsx` is just the
   260px sidebar "No file open" placeholder — not the live surface.)

**The constraint that shapes everything — vim.** The editor is not just
CodeMirror; it is CodeMirror **plus deeply-wired vim**, all in
`src/features/editor/hooks/useCodeMirror.ts`:

- the `vim()` extension (`useCodeMirror.ts:165`),
- a global `:w` → per-view `WeakMap` save router registered once at module load
  (`vimSaveByView` + `registerVimWriteOnce`, `useCodeMirror.ts:77-92`, bound per
  view at `:206`), safe for split-pane / multi-editor layouts, and
- a vim scroll-follow `transactionExtender`
  (`scrollCursorOnSelectionChange`, `useCodeMirror.ts:48-60`, wired at `:188`).

Any option that **replaces** CodeMirror for `.md` throws all of this away for
markdown. Preserving vim is the lens through which the decision is judged — and
Option B preserves it completely because **nothing about the editor changes**:
the reading view is a sibling React subtree, and source mode mounts the same
`<CodeEditor>` with the same `useCodeMirror` wiring.

## Decision (Option B + why)

Three coherent architectures were surveyed (exploration §4, framed as IDEA
blocks). The decision:

- **Option A — highlight-only (`@codemirror/lang-markdown`):** cheapest possible
  change, but renders _nothing_ — headings/tables/links stay raw syntax. It does
  **not** satisfy "polished reading UX" alone. It is, however, the editor half of
  Option B, so we ship it regardless.
- **Option B — dual surface (CM6 editor + `react-markdown` reading view) ✓:**
  delivers the polished, themeable reading experience directly _and_ keeps the
  untouched vim-enabled editor — the literal ask. `react-markdown` is ESM-only
  and React-19-native, returns a real element tree (no `dangerouslySetInnerHTML`,
  so the component tree is preserved for theming), is secure-by-default once
  `rehype-sanitize` is added, and its `components` prop maps every tag to our
  Catppuccin tokens. Adds the unified/rehype tree (~tens of kB gzip) and one new
  component + a small per-file view-mode flag. All low-risk and reversible.
- **Option C — WYSIWYG replacement (Milkdown / TipTap / Lexical) ✗ REJECTED:**
  **forfeits vim for markdown.** No WYSIWYG editor ships a viable vim mode (the
  only ProseMirror vim extensions are abandoned/unpublished; Lexical's custom
  core has none). It is also the heaviest option (Crepe ~439 kB gzip), reading is
  only secondary to editing here, and TipTap gates collab/AI/export behind a paid
  tier. Rejected specifically because it trades away vim for editing power we
  don't currently need.

**Recommendation (locked, D1):** ship Option B — `react-markdown` for the
reading view, `@codemirror/lang-markdown` for source-mode highlighting. It is
fully reversible (delete the component + branch, drop two deps).

## Integration design (the five points)

Each step is independently shippable; vim is never at risk because the editor
code path is only ever added to or branched around, never replaced.

### 1. CM6 markdown highlighting — the free win (`languageService.ts`)

Purely additive: add `@codemirror/lang-markdown` and two `case` branches to the
`switch` in `getLanguageExtension()`. The editor and vim wiring in
`useCodeMirror.ts` are **unchanged**, so vim is fully preserved for source mode.

```ts
import { markdown } from '@codemirror/lang-markdown'
// …inside getLanguageExtension(filename)'s switch, before `default`:
  case 'md':
  case 'markdown':
    return markdown()
```

Notes:

- The extension flows through the existing memoized `language` prop in
  `CodeEditor.tsx:60-63` and the language `Compartment.reconfigure` effect in
  `useCodeMirror.ts:245-254` — no other change. Markdown then gets syntax
  highlighting, list/blockquote auto-continue, and smart backspace inside the
  editor, inheriting our CM6 `HighlightStyle` (`catppuccinMocha`).
- The exploration sketch passed `markdown({ codeLanguages: languages })` to
  highlight fenced code _inside_ the CM6 source view. That requires
  `@codemirror/language-data` (a large grammar loader) which is **not** a listed
  dependency. To keep this step a true one-dep free win and avoid pulling a
  heavy grammar bundle, we ship the **no-argument `markdown()`** form; in-fence
  highlighting in _source_ mode is out of scope (the _reading_ view highlights
  fences via `rehype-highlight`, which is where readers see them anyway).

### 2. The reading-view component (`MarkdownReadingView.tsx`)

New presentational component beside `CodeEditor.tsx`, at
`src/features/editor/components/MarkdownReadingView.tsx`. It takes a single prop
`content: string` — the **same** string the dock already passes to
`<CodeEditor>` — so it plugs into the existing buffer with zero new data flow.
Arrow-function component, explicit `ReactElement` return type, co-located CSS
import.

```tsx
import type { ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import { markdownComponents } from './markdownComponents' // §3 token map
import './MarkdownReadingView.css' // §3 highlight.js → syn.* mapping

interface MarkdownReadingViewProps {
  content: string
}

export const MarkdownReadingView = ({
  content,
}: MarkdownReadingViewProps): ReactElement => (
  <div className="markdown-reading-view min-h-0 flex-1 overflow-auto">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize, rehypeHighlight]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  </div>
)
```

**CRITICAL plugin order (D3):** `rehypePlugins={[rehypeSanitize, rehypeHighlight]}`
— sanitize **first**, highlight **second**. `rehype-sanitize` runs an
allow-list over the hast; if it ran _after_ `rehype-highlight`, it would strip
the `class="hljs hljs-keyword …"` attributes highlight.js just added, leaving
fenced code unstyled. Running sanitize first lets highlight add classes to the
already-sanitized tree, and the classes survive to the DOM. The
`MarkdownReadingView.test.tsx` (§Testing) asserts a fenced block actually
carries an `.hljs` class — that test is the regression net for this ordering.

- `min-h-0 flex-1 overflow-auto` makes the view fill and scroll inside the dock's
  bounded flex column (matching the `min-h-0 flex-1` invariant `CodeEditor` and
  the `editor-panel` wrapper already use, `DockPanel.tsx:307-311`).
- Read-only: no `onChange`, no editor — to edit, toggle to Source.

**File-size guard.** If `MarkdownReadingView.tsx` + the `components` map exceed
the <400-line limit when combined, the `markdownComponents` map is split into a
sibling `markdownComponents.tsx` (each with its own co-located test). Keeping the
component thin (markup only) and the token map separate is the default shape.

### 3. Theming the reading view to the Obsidian Lens (D7 — no raw hex)

Two complementary mechanisms, both token-only:

**(a) Per-tag `components` map → Tailwind semantic classes.** The
`react-markdown` `components` prop maps each element to a styled tag carrying
Tailwind semantic classes (no hex). Indicative mapping (final classes tuned in
implementation, but tokens are fixed):

| Element               | Tailwind classes (semantic tokens)                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `h1`–`h6`             | `text-on-surface font-headline font-semibold` (descending sizes; generous top margin)                    |
| `p`, `li`             | `text-on-surface-variant font-body leading-relaxed`                                                      |
| `a`                   | `text-secondary hover:underline` (the link role token)                                                   |
| `strong`              | `text-on-surface font-semibold`                                                                          |
| `ul` / `ol`           | list spacing + `text-on-surface-variant` (markers inherit)                                               |
| `blockquote`          | `border-l-2 border-outline-variant text-on-surface-muted` + left padding                                 |
| inline `code`         | `font-mono text-primary bg-surface-container-lowest` + small padding + `rounded`                         |
| `pre` (code block)    | `font-mono bg-surface-container-lowest overflow-x-auto` + padding + `rounded-md` (thin scrollbar)        |
| `table` / `th` / `td` | `border-outline-variant` cells, `th` → `text-on-surface font-headline`, body → `text-on-surface-variant` |
| `hr`                  | `border-outline-variant`                                                                                 |

The root `<div className="markdown-reading-view …">` also sets a comfortable
measure (a `max-w-*` reading width, centered) and base `leading-relaxed` so long
specs are readable. All classes resolve to tokens already defined in
`tailwind.config.js` (`on-surface`, `on-surface-variant`, `on-surface-muted`,
`secondary`, `primary`, `surface-container-lowest`, `outline-variant`,
`font-headline`, `font-body`, `font-mono`).

**(b) highlight.js token colors → `syn.*` via co-located CSS.**
`rehype-highlight` emits `.hljs`, `.hljs-keyword`, `.hljs-string`,
`.hljs-comment`, `.hljs-function`/`.hljs-title`, `.hljs-type`,
`.hljs-variable`, `.hljs-tag`, etc. These are styled by a small co-located
stylesheet `MarkdownReadingView.css`, **scoped under `.markdown-reading-view`**,
mapping each `.hljs-*` class to the matching `syn.*` token via Tailwind's
`theme()` (so the colors stay in lockstep with the editor's own syntax palette
and there is **no raw hex**):

```css
/* MarkdownReadingView.css — scoped, token-driven (no raw hex) */
.markdown-reading-view .hljs {
  color: theme('colors.on-surface');
  background: theme('colors.surface-container-lowest');
}
.markdown-reading-view .hljs-keyword,
.markdown-reading-view .hljs-built_in {
  color: theme('colors.syn.keyword');
}
.markdown-reading-view .hljs-string,
.markdown-reading-view .hljs-attr {
  color: theme('colors.syn.string');
}
.markdown-reading-view .hljs-title,
.markdown-reading-view .hljs-title.function_ {
  color: theme('colors.syn.fn');
}
.markdown-reading-view .hljs-comment {
  color: theme('colors.syn.comment');
}
.markdown-reading-view .hljs-type,
.markdown-reading-view .hljs-number {
  color: theme('colors.syn.type');
}
.markdown-reading-view .hljs-variable {
  color: theme('colors.syn.var');
}
.markdown-reading-view .hljs-tag,
.markdown-reading-view .hljs-name {
  color: theme('colors.syn.tag');
}
```

(The `syn.*` Tailwind keys — `keyword`/`string`/`fn`/`var`/`comment`/`type`/`tag`
— are defined in `tailwind.config.js:86-94` and mirror the `--syn-*` CSS vars in
`docs/design/tokens.css:50-56`. `theme()` resolves at build time via the
`@config` directive already wired in `src/index.css:3`.) Scoping every rule under
`.markdown-reading-view` guarantees these styles never leak to the CM6 editor or
the rest of the app.

### 4. View switch per file type (`DockPanel.tsx`)

Inside the existing `tab === 'editor'` block (the `data-testid="editor-panel"`
wrapper around `<CodeEditor>` at `DockPanel.tsx:308-324`), branch on the file
extension and the view-mode flag. The `<CodeEditor>` branch is rendered
**exactly as today** (same props, same `editorHandleRef`), so non-markdown files
and source-mode markdown both keep full vim:

```tsx
const isMarkdown = /\.(md|markdown)$/i.test(selectedFilePath ?? '')

// inside the editor-panel wrapper:
{
  isMarkdown && viewMode === 'reading' ? (
    <MarkdownReadingView content={content} />
  ) : (
    <CodeEditor
      ref={editorHandleRef}
      filePath={selectedFilePath}
      content={content}
      onContentChange={onContentChange}
      onSave={onSave}
      isDirty={isDirty}
      isLoading={isLoading}
      shouldAutoFocus={isFocused}
    />
  )
}
```

Non-markdown files: `isMarkdown` is `false`, so the ternary always renders
`<CodeEditor>` — **completely unaffected**.

### 5. The Source ⇄ Reading toggle (`DockPanel` + `DockTab`)

- **State (D5).** Add a local `viewMode` state to `DockPanel`:
  `const [viewMode, setViewMode] = useState<'reading' | 'source'>('reading')`
  (default Reading, D4). It is ephemeral dock state, not persisted (matches the
  dock's existing stance). Because the only consumer is `WorkspaceView.tsx:963`,
  no prop plumbing is required.
- **Default-on-markdown nuance.** A user who toggles to Source on one doc, then
  opens another, should still see the default. Reset `viewMode` to `'reading'`
  whenever `selectedFilePath` changes to a (different) markdown file — a small
  `useEffect` keyed on `selectedFilePath`. (Tunable: a per-path map is the
  heavier alternative; the reset-on-file-change default is simpler and matches
  "docs open pretty.")
- **The control (D6).** A small segmented toggle (two buttons: `Source` /
  `Reading`), rendered in the `DockTab` `children` slot **alongside** the
  existing `<DockSwitcher>` — NOT replacing it:

  ```tsx
  <DockTab … >
    {isMarkdown && tab === 'editor' ? (
      <ViewModeToggle value={viewMode} onChange={setViewMode} />
    ) : null}
    <DockSwitcher position={position} onPick={onPositionChange} />
  </DockTab>
  ```

  `DockTab` already renders `children` in a `shrink-0` cluster for inline layout
  (`DockTab.tsx:250`) and inside the compact-actions menu for narrow side docks
  (`DockTab.tsx:228`), so composing two children works in both layouts with no
  `DockTab` change. (If the segmented toggle is awkward inside the compact menu,
  the fallback is to show it inline only — decided in implementation; both keep
  `DockSwitcher` intact.)

- **Styling — match `tabButtonClass`.** The toggle buttons reuse the existing
  tab-button look (`DockTab.tsx:35-42`): `font-mono text-[10.5px]`, `rounded-md`,
  active state primary-tinted (`bg-[rgba(226,199,255,0.08)]`,
  `border-[rgba(203,166,247,0.3)]`, `text-[#e2c7ff]`), inactive
  `text-[#8a8299] hover:text-[#e2c7ff]`. These specific literals are the
  established dock-chrome convention (the same hex literals already live in
  `DockTab.tsx` and are asserted in `DockPanel.test.tsx`), so the toggle is
  visually consistent with the Editor/Diff tabs. `aria-pressed` reflects the
  active mode for accessibility.
- **Optional polish (out of scope, noted):** a vim-friendly keymap entry
  (`:view` or a keybinding) to flip modes without the mouse. Deferred.

## Testing strategy

Co-located, TDD, `import { test, expect, vi, … } from 'vitest'` in every new
test file (globals don't satisfy `tsc -b` / lint-staged). `test()` not `it()`.

### `MarkdownReadingView.test.tsx` (new)

Render the real component (no mocking of react-markdown) with markdown input and
assert against the DOM:

- **Heading:** `# Hello` renders an `<h1>` with text "Hello"
  (`getByRole('heading', { level: 1, name: /hello/i })`).
- **GFM table:** a pipe table renders a `<table>` with the expected header and
  cell text — proves `remark-gfm` is active.
- **Fenced code + highlight survives sanitize (D3 regression):** a ` ```ts `
  fence renders a `<pre><code>` whose element carries an **`.hljs`** class
  (query the `<code>`/`<pre>` and assert `className` matches `/\bhljs\b/`). This
  is the proof that `rehypeSanitize` _before_ `rehypeHighlight` does **not**
  strip highlight.js classes.
- **Sanitize works (XSS):** input containing `<script>alert(1)</script>` (and an
  `<img src=x onerror=…>`) renders with **no executable `<script>` element** in
  the output and no `onerror` attribute — assert `container.querySelector('script')`
  is `null`. Proves the sanitizer boundary holds.

### `DockPanel.test.tsx` (update the existing file — do not break it)

The existing suite mocks `useCodeMirror`, `useVimMode`, `getLanguageExtension`
(`DockPanel.test.tsx:13-15`) and asserts `codemirror-container` is present for a
`.ts` file. Preserve every existing assertion (regression net), and add:

- **Markdown defaults to reading:** `selectedFilePath: '/x/README.md'` shows the
  reading view (assert the rendered markdown / a `markdown-reading-view`
  root or a `data-testid` on the reading container) and **not**
  `codemirror-container`.
- **Toggle to Source shows CodeEditor:** after clicking the `Source` toggle
  button (`getByRole('button', { name: /source/i })`), `codemirror-container`
  is in the document (CM6 + vim path). `react-markdown` either stays mocked or
  is rendered; the assertion is on which surface mounts, keyed off `viewMode`.
- **Non-markdown unaffected:** `selectedFilePath: '/x/test.ts'` still shows
  `codemirror-container` and **no** toggle (the existing
  `shows CodeEditor when file is selected` test already covers the
  `codemirror-container` half; add the "no Source/Reading toggle for `.ts`"
  assertion).
- **Toggle visibility:** the Source/Reading toggle is present for a `.md` file
  on the editor tab and absent on the diff tab / for non-markdown files.
  `DockSwitcher` (`dock: <position>` button) remains present in all cases
  (D6 — confirms it was composed, not replaced).

To keep `react-markdown` (ESM-only) cheap in jsdom, `DockPanel.test.tsx` may
`vi.mock` `../../editor/components/MarkdownReadingView` to a stub exposing a
`data-testid` — the DockPanel test only needs to prove _which_ surface mounts per
`viewMode`; the real rendering/sanitize behavior is covered by
`MarkdownReadingView.test.tsx`.

### `languageService.test.ts` (update if present, else add)

- `getLanguageExtension('notes.md')` and `('notes.markdown')` return a non-null
  `Extension` (the markdown `LanguageSupport`); a non-markdown unknown extension
  (e.g. `'foo.xyz'`) still returns `null`. Confirms the additive branch and the
  preserved `default`.

### `ViewModeToggle.test.tsx` (new, if extracted as its own component)

- Renders two buttons; `aria-pressed` reflects `value`; clicking each calls
  `onChange` with `'source'` / `'reading'`; active button carries the
  primary-tinted classes (matches `tabButtonClass`).

### Build / dependency verification (manual, per exploration §5.6)

- `npm ls @codemirror/state` shows a **single deduped** version after adding
  `@codemirror/lang-markdown` (CM6 footgun: duplicate `@codemirror/state`
  silently breaks the editor).
- `npm run build` (`tsc -b && vite build`), `npm run lint`, `npm run test` all
  green.

## Risks / edge cases

- **Plugin order (highest-value risk).** Getting `rehypePlugins` order wrong
  (`[rehypeHighlight, rehypeSanitize]`) silently strips `.hljs` classes →
  unstyled fences with no error. Mitigated by D3 + the explicit `.hljs`-class
  assertion in `MarkdownReadingView.test.tsx`.
- **ESM-only deps in jsdom/Vitest.** `react-markdown` and the unified stack are
  ESM-only. Vitest/Vite handle ESM, but if a transform hiccup appears, the
  `DockPanel.test.tsx` mock of `MarkdownReadingView` isolates the heavy import;
  `MarkdownReadingView.test.tsx` exercises the real path directly.
- **`@codemirror/state` duplication.** Adding `@codemirror/lang-markdown` can
  pull a second `@codemirror/state` if versions drift, breaking the editor.
  Mitigated by the `npm ls @codemirror/state` check; pin to the range already in
  the lockfile if dedupe is needed.
- **Bundle weight.** The unified/rehype tree + highlight.js subset add ~tens of
  kB gzip (bundlephobia's headline figures count grammars/CM internals we
  already ship — reason about the _marginal_ add). Acceptable for the reading
  UX; reversible if it ever isn't.
- **Untrusted input.** Rendered docs are locally-authored and trusted today, but
  `rehype-sanitize` is included by default as cheap insurance if a rendered file
  ever comes from an agent or a clone. (Covered by the XSS test.)
- **`theme()` in a co-located CSS file.** `MarkdownReadingView.css` must be
  processed by the Tailwind/PostCSS pipeline for `theme()` to resolve. It is
  imported by the component (a `.tsx` under `src/**`), and `src/index.css` wires
  `@config '../tailwind.config.js'` — the same pipeline that resolves `theme()`
  elsewhere. If `theme()` in an imported component CSS proves problematic under
  the Tailwind v4 setup, the fallback is `var(--syn-keyword)` etc. (the CSS vars
  from `tokens.css`, imported first in `index.css:1`) — still **no raw hex**.
- **Toggle inside the compact-actions menu.** For narrow side docks, `DockTab`
  routes `children` into the dropdown (`DockTab.tsx:228`); a segmented control
  there may be cramped. Fallback (decided in implementation): render the toggle
  inline only. Either way `DockSwitcher` stays intact (D6).
- **Focus / `focusEditor`.** `DockPanel`'s `focusEditor` delegates to the
  `CodeEditor` handle (`DockPanel.tsx:127-141`). In reading mode there is no
  CodeEditor mounted, so `editorHandleRef.current` is null and `focusEditor`
  already falls back to `sectionRef.focus()` — existing behavior, no change
  needed; the reading container is scrollable and focusable via the section.

## Dependencies

Exact install (run in this worktree):

```bash
npm install \
  react-markdown@^10.1.0 \
  remark-gfm@^4.0.1 \
  rehype-highlight@^7.0.2 \
  rehype-sanitize@^6.0.0 \
  @codemirror/lang-markdown@^6.5.0
```

After install, verify a single deduped `@codemirror/state` (`npm ls @codemirror/state`).

## Sequencing

1. **Deps** — install the five packages above; verify `@codemirror/state` dedupe.
2. **Step 1** — `languageService.ts` markdown branch + `languageService.test.ts`
   (free win; independently shippable, vim untouched).
3. **Step 2 + 3** — `MarkdownReadingView.tsx` + `markdownComponents` map +
   `MarkdownReadingView.css` + `MarkdownReadingView.test.tsx` (the reading
   surface, fully tested in isolation incl. sanitize + `.hljs` survival).
4. **Step 4 + 5** — `DockPanel.tsx` branch + `viewMode` state + `ViewModeToggle`
   composed in the `DockTab` `children` slot; update `DockPanel.test.tsx`
   (regression net + new markdown/source/non-markdown assertions).
5. **Verify** — `npm run build` / `lint` / `test` green; manual smoke of a real
   `.md` spec in the dock (default Reading, toggle to Source → vim works).

Each step is independently reviewable. Exact branch/PR strategy (single PR vs.
stacked) is deferred to the implementation plan.
