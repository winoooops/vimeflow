# Keybinding Engine — Design (VIM-136 / SP1)

**Status:** Drafting (model + scope + decisions locked with the user 2026-06-15).
Pending per-section + whole-spec codex review, then TDD implementation in worktree
`feature/vim-136` (off `feat/settings`).

**Linear:** VIM-136 (Keymap customization engine — per-binding rebinding, import/export,
custom leader). This spec covers **SP1 of 4: the engine only.** SP2 (editing UI), SP3
(customizable leader + re-introduced Vim leader chords), and SP4 (Custom / VS Code /
JetBrains presets) are separate specs that layer on this engine. Part of the Settings epic
(VIM-29 dialog, VIM-100 persistence, VIM-101 General, VIM-103 Coding Agents, VIM-104 Keymap
presets all merged into `feat/settings`).

---

## 1. Context & Problem

VIM-104 (#460) made the Keymap pane functional in a narrow sense — a preset switch
(Vimeflow ↔ Vim, persisted as `keymapPreset`) plus a **read-only**, platform-aware list of
the live bindings. It deliberately designed **around** the customization engine and deferred
it (VIM-104 design D4 / §9). VIM-136 builds that engine.

The blocker is structural: **the keymap is fully hardcoded.** Every global shortcut is its
own capture-phase `document` keydown hook with its key-match baked in —
`isCommandPaletteToggle` checks `event.key === ';'`; `usePaneShortcuts` matches `event.code`
against `/^Digit([1-4])$/` and `'Backslash'`; the workspace hooks each hardcode their combo.
The settings-pane table (`src/features/settings/sections.ts` `KEYMAP_GROUPS`) is
**display-only documentation, manually mirrored from the hooks** — it does **not** drive
dispatch. That "two sources of truth" gap already shipped a bug (keyboard-shortcut-guards
finding #23: the table advertised `⌘` on Linux/Windows because the display string and the
behavior modifier were maintained independently).

Consequently the issue's headline acceptance — **"editing a binding changes the live
shortcut and persists across restart"** — is impossible without a data-driven binding layer
that the hooks read from. SP1 builds exactly that layer, with the smallest possible blast
radius.

## 2. Scope

**SP1 delivers:**

- A central, data-driven **keybinding registry**: built-in defaults ⊕ persisted user
  overrides, resolved to one combo per command.
- A **pure conflict detector** (consumed by SP2's editing UI; SP1 ships the function + tests,
  not UI).
- A new **Rust `AppSettings.customKeybindings`** field (+ ts-rs binding regen) so overrides
  survive restart.
- **Migration of a representative subset of hooks** onto the registry so a persisted override
  changes the **live** shortcut — proving the pattern end-to-end. Commands are **granular** (one
  id per distinct action+combo, e.g. `focus-pane-1`); a single hook's listener may consult
  `bindingFor(id)` for several commands (§3).
- The settings-pane keymap list **derives from the registry** (killing the display/behavior
  drift), still read-only in SP1.

**SP1 explicitly defers** (the engine is designed so each drops in cleanly, but none is built
here):

- **SP2** — editing UI: the per-row pencil (capture chord → detect conflict → save),
  Reset / Import / Export real IO.
- **SP3** — customizable leader: making `⌘;` user-settable across the **three** places it is
  hardcoded (renderer `isCommandPaletteToggle`, Electron `before-input-event`
  `isCommandPaletteShortcutInput`, and the Linux `globalShortcut` accelerator), then
  re-introducing the Vim leader chords (`⌘;` then `h/j/k/l/w/c/s/v/o`) removed in #460.
- **SP4** — Custom / VS Code / JetBrains presets (named override sets layered on the engine).

## 3. Locked decisions (with the user, 2026-06-15)

- **D1 — Consult-only registry (Approach A).** The registry is a **pure data store** (binding
  combos + override methods). Each hook **keeps its own capture-phase listener, guards, and
  action**; it only replaces its hardcoded key-check with
  `eventMatchesChord(event, bindingFor(id))`. The registry never holds or dispatches a hook.
  _Rationale:_ preserves the 29 hard-won guards in
  `docs/reviews/patterns/keyboard-shortcut-guards.md` untouched; the change is a surgical
  one-liner per hook; one uniform path for simple and complex hooks; lowest regression risk;
  still 100% data-driven. Alternatives — B (central keydown router) and C (hybrid) — were
  rejected because generalizing the heterogeneous guards (terminal-active, dock/CodeMirror,
  out-of-range pane, layout capacity) into a router is the high-risk part SP1 exists to avoid.
  Full reasoning + citations: `docs/design/keymap-engine/dispatch-decision.zh.html` and
  `registry-role.zh.html`.
- **D2 — Subset-first migration.** SP1's first PR migrates **`usePaneShortcuts`** (the complex
  archetype: one capture-phase listener serving several **granular** commands —
  `focus-pane-1..4`, `cycle-layout`, `focus-pane-left/down/up/right` — matched via
  `event.code`) plus one **simple renderer-only global combo** (`useDockToggleShortcut`, `⌘0`).
  Together they exercise both the multi-command-per-hook consult and the single-combo consult,
  and the `'Mod'` platform abstraction. The remaining workspace hooks fast-follow in later SP1
  PRs (see §5). **The `⌘;` command-palette leader is _not_ rebindable in SP1** — it is hardcoded
  across three processes (renderer `isCommandPaletteToggle`, Electron `before-input-event`
  `isCommandPaletteShortcutInput`, the Linux `globalShortcut` accelerator) and is owned by SP3.
  SP1 carries it in the catalog as a **display-only** entry (`rebindable: false`) and leaves its
  matching untouched, so no old `⌘;` behavior is disturbed.
- **D3 — Persist in `settings.json`, not SQLite.** Extend the existing atomic
  `AppSettingsCache` with a `customKeybindings` map. _Grounded in verified prior art:_ both
  Zed (`keymap.json`) and VS Code (`keybindings.json`) persist keybindings in **hot-reloaded
  JSON**, never in the SQLite they ship for window/session state (see §4, §_Prior art_).
- **D4 — Single combos only in SP1.** No multi-key chord **sequences** (`ctrl+k ctrl+s`). The
  existing `⌘;` 500 ms leader window remains its own mechanism and is owned by SP3; SP1 does
  not rebind it.
- **D5 — Reset, not unbind.** SP1 supports setting an override and **resetting to default**.
  "Unbind to nothing" (VS Code `-command` / Zed `null` sentinel) is deferred to SP2.
- **D6 — Lightweight `context` tag.** Each catalog command carries a `context` drawn from the
  surfaces the hooks' guards already distinguish —
  `'global' | 'terminal' | 'editor' | 'diff' | 'dock'` — used **only** by the pure conflict
  detector. §5.4 defines the exact overlap rule: `global` overlaps every surface, and the surface
  values are mutually exclusive among themselves (so e.g. a `dock`-scoped combo and a
  `terminal`-scoped combo do not conflict, but either conflicts with a `global` combo on the
  same keys). Runtime context stays the hooks' existing guards — there is **no** declarative
  `when` engine in SP1.

## 4. Prior art (verified)

A deep-research pass over Zed and VS Code (primary sources: VS Code `main` source + docs, Zed
source + gpui rustdoc; 25/25 extracted claims survived 3-vote adversarial verification, June
2026) grounds this model:

- **Binding data is kept separate from the handler.** VS Code's `KeybindingsRegistry` stores
  `{ command: string, key, when }`; its `CommandsRegistry` separately stores
  `{ id, handler }`. Zed's `keymap.json` maps keystrokes → action-**id** strings; the gpui
  `Action` trait is pure identity (`boxed_clone`/`partial_eq`/`name` — **no** `run()`/
  `execute()`), with handlers attached on the element tree via `on_action`. → Validates D1:
  the registry stays ignorant of hook internals; store the **id**, never the hook.
- **Defaults immutable; user overrides layered last-wins**, with a removal sentinel
  (`-command` / `null`). → Validates the defaults ⊕ overrides model; D5 keeps reset and defers
  the unbind sentinel.
- **Persistence is hot-reloaded JSON, not SQLite** — for both editors, even though both ship
  SQLite for other state. → D3.

These docs capture the full comparison + citations:
`docs/design/keymap-engine/dispatch-decision.zh.html`, `registry-role.zh.html`.

---

## 5. Data model

All types live in a new feature module `src/features/keymap/` — a pure, framework-agnostic core
(`catalog.ts`, `chord.ts`, `resolve.ts`, `conflicts.ts`) plus a thin React access layer (§6.3).
The module is the **single source of truth** the settings pane's display also derives from
(retiring the hand-mirrored `KEYMAP_GROUPS`).

### 5.1 Chord

A chord is one physical key plus its modifier set. SP1 supports a **single** chord per binding
(D4 — no `ctrl+k ctrl+s` sequences).

```ts
type Mod = 'Mod' | 'Ctrl' | 'Shift' | 'Alt' // 'Mod' = platform super: ⌘ on macOS, Ctrl elsewhere
interface Chord {
  code: string           // KeyboardEvent.code — physical key (layout-safe; guards finding #27)
  mods: ReadonlySet<Mod> // e.g. {'Mod'}, {'Mod','Shift'}, {'Ctrl'}
}
```

- `code` is the physical key (`'KeyC'`, `'Digit1'`, `'Backslash'`, `'ArrowLeft'`, `'Backquote'`),
  never the logical `event.key` — the layout-independence guard the existing hooks already honor.
- `'Mod'` stays canonical (not pre-expanded) so a catalog default is written once and
  renders / matches per platform.

**Serialization** (on disk + as the comparison key): a canonical token string — mods in fixed
order `Mod, Ctrl, Alt, Shift`, then the code, joined by `+`:

```
formatChord({code:'KeyC',     mods:{'Mod'}})          → "Mod+KeyC"
formatChord({code:'ArrowLeft', mods:{'Mod','Shift'}}) → "Mod+Shift+ArrowLeft"
parseChord("Ctrl+Backquote")                          → {code:'Backquote', mods:{'Ctrl'}}
```

`parseChord` returns `null` on a malformed token, so a hand-edited / forward-incompatible
`settings.json` value degrades to "use default" instead of throwing (mirrors the `keymapPreset`
unknown-value → non-vim degradation).

**Matching policy — required mods + a per-command `Shift`/`Alt` rule.** A chord's `mods` are the
modifiers that must be **present**, and matching always **forbids any super not required** (`'Mod'`
⇒ platform super down + counterpart up; literal `'Ctrl'` ⇒ `ctrlKey && !metaKey`). What differs per
command is how _unlisted_ `Shift`/`Alt` are treated — a `matchPolicy` on the descriptor (§5.2):

- **`'exact'` (default):** an unlisted `Shift`/`Alt` that is **down forbids the match**. This is what
  most hooks already do — `useNewSessionShortcut` (`⌘N` rejects Shift), `useBurnerToggleShortcut`
  ("exactly `` Ctrl+` ``"), `useDockShortcuts` (`⌘E/⌘G` reject Shift/Alt), `useSidebarShortcut`,
  `useSessionNavShortcut`. It lets `⌘N` and `⌘⇧N` stay distinct.
- **`'tolerant'`:** unlisted `Shift`/`Alt` are **ignored**. Only the layout-sensitive physical keys
  need this — `usePaneShortcuts` (digits, `Backslash`) and `useDockToggleShortcut` (`Digit0`) accept
  `Shift`/`AltGr` so AZERTY/QWERTZ (which reach those keys via a modifier) keep working.

A command that _requires_ `Shift` (e.g. directional focus, `{'Mod','Shift'}`) lists it in `mods` under
either policy. Each migrated command's policy is set to **reproduce its current hook's behavior** (the
behavior-preservation test asserts this, §8); consult-only also keeps every hook's bespoke guards (§6),
so the shared matcher only needs the common case.

**Super exclusivity.** A chord has **at most one super** — `'Mod'` _xor_ literal `'Ctrl'`; they map to
mutually-exclusive `metaKey`/`ctrlKey` requirements (§6.1), so a `{'Mod','Ctrl'}` chord is
unsatisfiable and `parseChord` returns `null` for it. A _rebindable_ command (default **or** override)
must have **exactly one** super (terminal-safety, §6.2); only display-only bare-key rows have none.

### 5.2 Command catalog

A static array of descriptors — one per rebindable (or display-only) action.

```ts
type BindingContext = 'global' | 'terminal' | 'editor' | 'diff' | 'dock'

interface CommandDescriptor {
  id: string                                        // unique within CATALOG: 'focus-pane-1', 'dock-toggle', 'palette', …
  label: string                                     // shown in the Keymap pane
  group: string                                     // display grouping: 'Global' | 'Panes & Layout' | …
  context: BindingContext                           // conflict scoping (D6)
  matchPolicy: 'exact' | 'tolerant'                 // unlisted Shift/Alt: 'exact' forbids (default) · 'tolerant' ignores (§5.1)
  defaultCombo: Chord | ((isMac: boolean) => Chord) // platform-aware, mirrors today's keys:(isMac)=>…
  rebindable: boolean                               // true ⟺ hook migrated (registry-wired); false ⇒ display-only
}

// CommandId is the literal union of the catalog's ids (CATALOG declared `as const`), so a typo or
// unknown id is a compile error and `bindingFor(id)` is total — every id has a descriptor → a default.
const CATALOG = [/* …descriptors… */] as const
type CommandId = (typeof CATALOG)[number]['id']
```

- **Granularity:** one descriptor per distinct action+combo. `usePaneShortcuts` alone maps to
  `focus-pane-1..4`, `cycle-layout`, and `focus-pane-left/down/up/right`; its one listener
  consults `bindingFor` for each (§6).
- `defaultCombo` is `(isMac)=>Chord` only where the platform default genuinely differs beyond the
  `Mod` swap (e.g. new-session `⌘N` vs `Ctrl+Shift+N`); otherwise a plain `Chord`.
- The catalog **supersedes** `KEYMAP_GROUPS` as the source of truth; the Keymap pane renders from
  it (§6.4). The Vim ex-command rows (`:w`, `:q`, …) are command-**palette** text commands, not
  keybindings, and stay their own display data.
- **Display-only entries are never matched.** A `rebindable:false` command (e.g. the `⌘;` palette
  leader, SP3-owned) is rendered in the Keymap pane from its `defaultCombo` but is **not**
  dispatched by the engine — its real key handling stays in the untouched hook (the palette keeps
  its `event.key === ';'` logic). Its catalog `defaultCombo` (`{code:'Semicolon', mods:{'Mod'}}`)
  therefore drives **display only**, so the physical-`code` model never has to encode the logical
  `;`. The conflict detector reserves it by that **default physical code**, so on standard layouts a
  user override onto `⌘;` is rejected (§5.4). _Limitation:_ because the live palette hook matches the
  **logical** `event.key === ';'` and is not migrated until SP3, SP1 cannot reserve the leader on
  exotic layouts where `;` originates from a different physical key — perfect logical-key reservation
  is an SP3 concern (when the leader is migrated and its representation settled).
- **`rebindable` tracks migration status.** A command is `rebindable:true` only once its hook
  consults the registry (§6.2). Until then — and for the SP3-owned leader — it stays
  `rebindable:false`, so `resolveBinding` returns its **default** and ignores any persisted override
  (§5.3). The Keymap pane therefore shows the default for unmigrated commands, which is exactly what
  their still-hardcoded hook dispatches → **no display/behavior drift** during subset migration. Each
  migration PR flips its commands to `rebindable:true`.

### 5.3 Resolver — defaults ⊕ overrides

```ts
type CustomKeybindings = Partial<Record<CommandId, string>> // override tokens; only overridden ids present

resolveDefault(cmd, isMac): Chord // unwrap Chord | ((isMac)=>Chord)

// The SINGLE 'valid user override' predicate — one source of truth, used at BOTH the read boundary
// (resolveBindings) and the write boundary (setUserBinding, §6.3), and in their tests:
exactlyOneSuper(chord): boolean                // 'Mod' xor literal 'Ctrl' (terminal-safety + §5.1)
overrideCollides(chord, id, resolved): boolean // shares (super, code) with another command, contexts overlap (§5.4)

// resolveBindings validates the FINAL candidate set (not each override against partial state), so a
// clean A↔B swap keeps BOTH overrides while hand-edited invalid/colliding entries are neutralised:
function resolveBindings(catalog, overrides, isMac): Map<CommandId, Chord> {
  const resolved = new Map(catalog.map((c) => [c.id, resolveDefault(c, isMac)])) // 1. defaults
  for (const c of catalog) {                                                     // 2. apply every
    const chord = c.rebindable && overrides[c.id] != null ? parseChord(overrides[c.id]) : null
    if (chord && exactlyOneSuper(chord)) resolved.set(c.id, chord)               //    structurally-valid override
  }
  return dropResidualConflicts(catalog, resolved, isMac) // 3. revert commands still colliding (catalog
}                                                        //    order; fixed rebindable:false reservations win)
resolveBinding(cmd, overrides, isMac): Chord // = resolveBindings(...).get(cmd.id)
```

- An override is a single concrete token captured on the user's machine; absent ⇒ default.
- Defaults are **never mutated**; an override is additive and is dropped by `resetBinding` (§6.3). A
  `rebindable:false` command **ignores** any stored override.
- **Read-boundary enforcement (defends against hand-edits).** `resolveBindings` applies every
  structurally-valid override (parses + **exactly one super**, `exactlyOneSuper`), then validates the
  **final candidate set**, reverting only commands still in a conflict (catalog order; fixed
  `rebindable:false` reservations always win). Validating the final set — not each override against
  partial state — lets a clean A↔B **swap** keep both overrides, while a hand-edited super-less /
  both-super / leader-shadowing / colliding override is silently **neutralised**. So terminal-safety
  (§6.2) and leader-reservation (§5.2) hold even when `setUserBinding` is bypassed.
- A malformed or unknown-`CommandId` override is ignored (forward / back-compat — §7).
- The Rust `customKeybindings` field uses **tolerant field-level deserialization** (§7) so a
  malformed hand-edited entry drops only that entry — it can **not** fail the whole-struct load and
  default the entire `settings.json` (preserving the durability invariant). `parseChord` is the
  second line of defense for a syntactically-valid-but-unparseable token.

### 5.4 Conflict detector (pure)

```ts
interface Conflict { key: string; commandIds: CommandId[]; contexts: BindingContext[] }
detectConflicts(catalog, overrides, isMac): Conflict[]
```

- **Conflict key = `(super, code)` + a policy-aware `Shift`/`Alt` overlap.** `super` is
  `'meta' | 'ctrl' | 'none'` (`'Mod'` → platform super; literal `'Ctrl'` → `'ctrl'`; bare key →
  `'none'`). Two resolved bindings on the same `(super, code)` overlap iff some `Shift`/`Alt`
  assignment matches **both** under their `matchPolicy` (§5.1): an `'exact'` command fixes each
  modifier (listed ⇒ down, unlisted ⇒ up) to a single value; a `'tolerant'` command leaves unlisted
  `Shift`/`Alt` free. **Overlap ⟺ same `(super, code)` AND the `Shift` value-sets intersect AND the
  `Alt` value-sets intersect.** So two `'tolerant'` commands on the same key+super always overlap
  (`{'Mod'}+Digit1` vs `{'Mod','Shift'}+Digit1`); two `'exact'` commands differing only by `Shift` do
  **not** (`⌘N` vs `⌘⇧N`); an `'exact'` vs `'tolerant'` overlap iff the exact one's fixed values fall
  in the tolerant one's free set.
- On Linux `Mod+B` and literal `Ctrl+B` collide (both → `'ctrl'`); on macOS they do not (`'meta'` vs
  `'ctrl'`). The `'none'` bucket holds only **display-only bare-key** rows (diff `j`/`k`, etc.); since
  every rebindable override must keep a super (terminal-safety, §6.2), **no user override can enter
  `'none'`**, so those rows never collide with a user change.
- Within a conflict group, report a `Conflict` when ≥2 commands' contexts **overlap**: `global`
  overlaps every surface; the surface values (`terminal`/`editor`/`diff`/`dock`) are mutually
  exclusive among themselves. (A `terminal`-only and a `dock`-only command may share a key without
  conflict; either conflicts with a `global` one on the same key.)
- **Dispatch is never blocked** (consult-only — §6), but the detector is **enforced at the write
  boundary:** `setUserBinding` (§6.3) rejects an override that collides with a `rebindable:false`
  **fixed reservation** (e.g. the `⌘;` leader) or that drops the required super — so a persisted
  override can never silently shadow the untouched leader hook. SP2's capture UI surfaces the same
  rejection; SP1 enforces + tests it.
- SP1 ships the function + tests; SP2's editing UI also consumes it for live capture warnings.
  Cross-platform checking (both `isMac` values) is a possible SP2 refinement; SP1 checks the current
  platform.

---

## 6. Dispatch & migration (consult-only)

Per D1 the engine **never owns a listener.** Each hook keeps its capture-phase listener, guards,
and action; only its hardcoded key-check is replaced with a registry consult. Three pieces make
this work: a pure matcher (§6.1), the React access layer that feeds it (§6.3), and the mechanical
per-hook swap (§6.2).

### 6.1 The matcher — `eventMatchesChord` (pure)

```ts
type PlatformSuper = 'meta' | 'ctrl' // resolved 'Mod' (WorkspaceView already derives this as preferModifier)
function eventMatchesChord(event, chord: Chord, superKey: PlatformSuper, policy: 'exact' | 'tolerant' = 'exact'): boolean
```

Returns true iff **all** hold:

1. `event.code === chord.code` (physical key — never `event.key`).
2. **Super modifiers are exact.** Every super the chord requires must be down and every super it does
   _not_ require must be up: `'Mod'` ⇒ platform super down + counterpart up
   (`superKey==='meta' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey`); literal
   `'Ctrl'` ⇒ `event.ctrlKey && !event.metaKey` (e.g. the burner `` Ctrl+` ``); no super in `mods`
   (bare key) ⇒ both up. Extra `Ctrl`/`Meta` are therefore **forbidden** — only `Shift`/`Alt` are
   tolerated.
3. **`Shift` / `Alt` (per `policy`):** a listed modifier **must be down**; an **unlisted** one is
   **forbidden if down** when `policy==='exact'` (the default — `⌘N` ≠ `⌘⇧N`) and **ignored** when
   `policy==='tolerant'` (digits / `Backslash` / `Digit0`, for AZERTY/QWERTZ). See §5.1.

This is the single home for the `⌘-only` / opposite-super / `event.code` logic currently duplicated
across hooks (guards-pattern classes 1, 4, 6). It is exhaustively unit-tested (§8) and is the only
new code on the hot keydown path.

### 6.2 Migration — the mechanical swap

Each migrated hook moves its **key + modifier match** — the hardcoded `event.code` test _and_ any
shared platform-super gate — into per-command `eventMatchesChord`. Everything else is untouched: the
**context / action guards** (dialog, terminal-active, out-of-range, capacity, already-active), the
listener lifecycle, and every per-branch `return` (finding #29).

`useDockToggleShortcut` (simple, single command):

```ts
// before:  if (event.code !== 'Digit0') return
//          const isMeta = modKey === '⌘'; const expected = isMeta ? event.metaKey : event.ctrlKey; …
// after:
if (!matches(event, 'dock-toggle')) return // matches = eventMatchesChord(event, bindingFor(id), superKey, policyFor(id))
// …unchanged: DIALOG_SELECTOR guard → preventDefault/stopPropagation → onToggle()
```

`usePaneShortcuts` (one listener, several granular commands): resolves the active session exactly as
today, then asks the registry per command instead of hardcoding `Digit([1-4])` / `Backslash` / arrows:

```ts
if (matches(event, 'focus-pane-1')) { /* …existing pane-1 guards + action… */ }
// focus-pane-2..4, cycle-layout, focus-pane-left/down/up/right — each its own bindingFor(id),
// each keeping its existing dialog / terminal-active / out-of-range / capacity guards + return.
```

The digit and directional context guards (out-of-range, already-active, capacity, dialog,
terminal-active) move **with their branch** and are not touched — they were never about _which_ key,
only about whether to act once a key matched. The migration is behavior-preserving by construction
whenever the default bindings equal today's hardcoded combos — an invariant a test asserts (§8).

**Why the shared super gate must move.** `usePaneShortcuts` today factors its platform-super check
into a single top-level early-return above the branches. That gate is **subsumed by** each command's
`eventMatchesChord` (which checks the super per binding), so an override that changes the modifier
actually takes effect. Keeping the shared gate would pin every override to the original super — so
removing it is required for rebinding to work, and is the one structural (not one-line) part of the
`usePaneShortcuts` migration.

**Terminal-safety constraint (preserves §2's core principle).** Only `⌘`/`Ctrl`-modified combos never
reach a focused TUI's PTY, so a rebindable override **must keep a super** (`'Mod'` or literal
`'Ctrl'`). `setUserBinding` (§6.3) rejects a bare-key / `Shift`-or-`Alt`-only / both-super override,
and the read boundary `resolveBindings` independently drops any such override that bypassed it (the
shared `exactlyOneSuper` predicate, §5.3). Moving the super match into the matcher therefore never
opens a path to steal a bare key from the terminal.

**Out of scope: internal focus-handoff keys.** `useDockShortcuts`'s `b` branch (dock→terminal reclaim)
is **not** a catalog command and stays hardcoded. It is a context-gated overload — on macOS it shares
`⌘B` with the global sidebar toggle, firing only when the dock is focused (the sidebar's `⌘B` fires
otherwise). Consult-only has no central context-dispatch to arbitrate such a shared key, so SP1 keeps
the reclaim internal — only `⌘E`/`⌘G` from `useDockShortcuts` become rebindable. The narrow cost: a
user override onto `⌘B` isn't flagged against the hardcoded reclaim, but the two are context-disjoint
so they never actually clash.

### 6.3 React access layer — `useKeybindings`

```ts
interface Keybindings {
  bindingFor: (id: CommandId) => Chord                              // resolved default ⊕ override (memoized)
  matches: (event: KeyboardEvent, id: CommandId) => boolean        // eventMatchesChord(event, bindingFor(id), superKey, policyFor(id))
  setUserBinding: (id: CommandId, chord: Chord) => SetBindingResult // validate → persist via update()
  resetBinding: (id: CommandId) => void                            // drops the override
  conflicts: Conflict[]                                            // detectConflicts(...) memoized (for SP2)
}
type SetBindingResult = { ok: true } | { ok: false; reason: 'invalid-super' | 'reserved' | 'conflict' }
function useKeybindings(): Keybindings
```

- Backed by `useSettings()`: `resolveBindings(catalog, settings.customKeybindings, isMac)`, memoized
  on `[settings.customKeybindings, isMac]`. `isMac` / `superKey` come from the same source
  `WorkspaceView` already uses for `preferModifier`.
- `setUserBinding` **validates before persisting** via the shared predicate (§5.3), rejecting with a
  typed `SetBindingResult` the caller surfaces (SP2's capture UI): `'invalid-super'` (not exactly one
  super — bare-key / `Shift`-only / both-super), `'reserved'` (collides with a `rebindable:false`
  fixed reservation, e.g. the `⌘;` leader), or `'conflict'` (collides with another **rebindable**
  command). **SP1 rejects `'conflict'` outright** — consult-only has no central precedence, so two
  commands sharing a key would double-fire / be branch-order-dependent; **SP2** may relax this to
  warn-and-allow with explicit precedence. Only a valid override reaches
  `update({ customKeybindings: { …next } })`; the serial save-queue persists it and `saveError`
  surfaces I/O failures (same contract as every other pane). `resetBinding` drops the override. SP1
  wires + tests these; the only SP1 callers are tests + (later) SP2's UI — **no SP1 surface mutates
  bindings.**
- **Injection:** `WorkspaceView` calls `useKeybindings()` once and threads `matches` into
  `usePaneShortcuts` / `useDockToggleShortcut` via their existing options objects — mirroring how
  `preferModifier` is derived once and passed down. The hooks stay context-free and unit-testable by
  passing a fake `matches`.

### 6.4 Display derives from the catalog

`KeymapPane` renders from the catalog instead of `KEYMAP_GROUPS`: group descriptors by `group`,
resolve each via `resolveBinding`, render through the existing `formatShortcut` with a small
`code → display-key` adapter (`'KeyC'→'C'`, `'Digit1'→'1'`, `'Backslash'→'\\'`, `'ArrowLeft'→'←'`, …).
This **eliminates** the hand-mirrored display data behind finding #23. `rebindable:false` rows (the
palette leader, from its display-only catalog entry) and the Vim ex-command rows (from their own
palette-command data) still render — read-only in SP1; SP2 adds the per-row pencil, SP3 brings the
leader into the rebindable set. Because `resolveBinding` returns the default for `rebindable:false`
(unmigrated / SP3-owned) commands (§5.2), every rendered row matches what dispatch honors — the pane
can never advertise an override the hooks don't yet obey.

---

## 7. Persistence (Rust + frontend)

The override map extends the existing atomic `AppSettings` store (D3) — **no SQLite, no version
bump.**

### 7.1 Rust — `AppSettings.custom_keybindings`

In `crates/backend/src/settings/app_settings.rs`:

```rust
#[serde(default, deserialize_with = "lenient_string_map")]
pub custom_keybindings: HashMap<String, String>, // camelCase customKeybindings; absent ⇒ empty
```

- `#[serde(default)]` ⇒ an absent field loads empty, so old `settings.json` files round-trip
  unchanged and **`CURRENT_APP_SETTINGS_VERSION` stays 1** — a new optional field is
  backward-compatible by construction, exactly like every other field's `default`.
- **Tolerant deserializer** (resolves §5.3 / the durability invariant — a bad entry must never
  default the _whole_ file):

```rust
fn lenient_string_map<'de, D: Deserializer<'de>>(d: D) -> Result<HashMap<String, String>, D::Error> {
    let v = serde_json::Value::deserialize(d)?; // any valid JSON token ⇒ never errors the struct load
    Ok(match v {
        serde_json::Value::Object(m) => m
            .into_iter()
            .filter_map(|(k, val)| val.as_str().map(|s| (k, s.to_string())))
            .collect(),
        _ => HashMap::new(), // wrong outer shape ⇒ empty, not fatal
    })
}
```

  `AppSettingsCache::load` already parses the whole file as JSON before field deserialization, so the
  field value is always a valid JSON token when `lenient_string_map` runs — the function is **total**
  (never `Err`). A malformed entry drops/skips; the durable file is never wiped.
- `impl Default for AppSettings` adds `custom_keybindings: HashMap::new()`.
- Test fixtures gain the field: `custom_settings()` (a sample map), `default_values_match_ui_precedent`
  (empty default), `serializes_camel_case_fields` (`"customKeybindings"`), `partial_file_defaults_…`
  (absent ⇒ empty). **New test:** a file with a non-string value (`{"focus-pane-1": 5}`) loads with
  that entry dropped and **all other settings intact**.

### 7.2 Frontend — generated binding + default mirror

- `npm run generate:bindings` regenerates `src/bindings/AppSettings.ts` (ts-rs emits
  `customKeybindings: Record<string, string>`); re-run prettier on `src/bindings/` (the generator
  re-exports as an unformatted one-liner — the known ts-rs clobber).
- `src/features/settings/store/settingsDefaults.ts` `DEFAULT_SETTINGS` gains `customKeybindings: {}`
  (it must match the Rust default — the file already documents that invariant).
- The access layer (§6.3) aliases the generated field as
  `CustomKeybindings = Partial<Record<CommandId, string>>` for safe (`| undefined`) indexing,
  independent of whether the repo enables `noUncheckedIndexedAccess`.

### 7.3 Write path (unchanged contract)

`setUserBinding` / `resetBinding` (§6.3) call `update({ customKeybindings })`; `SettingsProvider`'s
serial save-queue (`saveQueueRef`) persists via `window.vimeflow.settings.*` → `AppSettingsCache.save`
(atomic temp-file + rename) and mirrors to the main process via `bridge.syncSnapshot` — byte-for-byte
the path `keymapPreset` and every other setting already use. **No new IPC surface.**

---

## 8. Testing

TDD per `rules/typescript/testing` (≥80%, co-located `*.test.ts`, `test()` not `it()`). Pure cores are
exhaustively table-tested; hooks/components use Testing Library; Rust uses `#[test]` round-trips.

**Pure core (`src/features/keymap/`):**

- `chord.ts` — `formatChord`/`parseChord` round-trip for every token shape; `parseChord` → `null` on
  malformed / empty / extra-`+`; canonical mod ordering is stable.
- `resolve.ts` — default when no override; valid override wins for `rebindable:true`; override
  **ignored** for `rebindable:false`; malformed / **super-less** / **both-super** / **colliding**
  override → default (read-boundary predicate, §5.3); a valid **A↔B swap keeps both** (final-set
  validation); `(isMac)=>Chord` defaults unwrap per platform.
- `conflicts.ts` — table-driven: same `(super, code)` → conflict iff contexts overlap; `'Mod'` vs
  literal `'Ctrl'` collide on Linux not macOS; the `'none'` bucket never collides with a super
  override; two `'tolerant'` `{'Mod'}+Digit1` vs `{'Mod','Shift'}+Digit1` **is** flagged; two `'exact'`
  `⌘N` vs `⌘⇧N` is **not**; `'exact'` vs `'tolerant'` follows the value-set rule (§5.4).
- `eventMatchesChord` — required super down + any non-required super up (forbidden); literal `Ctrl`;
  listed `Shift`/`Alt` enforced; **unlisted `Shift`/`Alt` forbidden under `'exact'`, tolerated under
  `'tolerant'`** (AZERTY/QWERTZ); `event.code` not `event.key` (a Cyrillic `event.key` with
  `code:'KeyB'` still matches).

**Catalog invariants:** ids unique; `CommandId` union compiles; and the **behavior-preservation
table** — for every migrated command, `resolveDefault(cmd, isMac)` equals today's hardcoded combo (the
invariant §6.2 relies on), asserted for both `isMac` values.

**Access layer + hooks:**

- `useKeybindings` — `bindingFor` reflects a valid override; `setUserBinding` persists via a mocked
  `update`, and **rejects** `'invalid-super'` (bare / Shift-only / both-super), `'reserved'`
  (leader-colliding), and `'conflict'` (rebindable-colliding) overrides without persisting;
  `resetBinding` clears.
- `usePaneShortcuts` / `useDockToggleShortcut` — re-run the **existing** suites unchanged (guards
  preserved), plus: with a fake `bindingFor` returning an override, the hook fires on the **new** combo
  and **not** the old; all context guards (dialog / terminal-active / out-of-range / capacity) still
  hold; bare keys still pass through.
- `KeymapPane` — renders rows from the catalog; platform-correct display (`⌘` vs `Ctrl+⇧`); shows the
  override for a `rebindable:true` row and the default for a `rebindable:false` row (no drift).

**Rust (`app_settings.rs`):** the updated fixtures (§7.1) + a **new lenient-deser test** — a file with
a non-string `customKeybindings` value loads with that entry dropped and **all other settings intact**;
round-trip of a valid override map.

**Acceptance (the headline):** an integration test sets `customKeybindings` for a migrated command and
asserts the migrated hook now dispatches on the new combo and not the default — "editing a binding
changes the live shortcut," persisted through the settings round-trip.

## 9. Implementation stages, risks & forward-compat

**PR plan** (each: `type-check` + scoped ESLint + repo-wide `format:check` + touched `vitest`, plus
`cargo test` for PR1; codex review; one PR to `feat/settings` labeled `auto-review` / `auto-approve`,
plain-text `Part of VIM-136` — SP1 does **not** close the umbrella issue):

- **PR1 — engine core + first migration.** `src/features/keymap/{chord,catalog,resolve,conflicts}.ts`
  + `eventMatchesChord` + `useKeybindings` (all tested); Rust `custom_keybindings` field + lenient
  deserializer + fixtures + `generate:bindings` (+ prettier on `src/bindings/`); `DEFAULT_SETTINGS`
  mirror; migrate **`usePaneShortcuts`** (removing the shared super gate) + **`useDockToggleShortcut`**,
  flipping their commands to `rebindable:true`; `KeymapPane` renders from the catalog. Ships the
  headline acceptance for the subset.
- **PR2 — remaining workspace hooks.** Migrate `useNewSessionShortcut`, `useSidebarShortcut`,
  `useSidebarTabShortcut`, `useSessionNavShortcut`, `useDockShortcuts` (⌘E/⌘G only — its `b` reclaim
  stays hardcoded, §6.2), `useBurnerToggleShortcut`
  → catalog entries + `rebindable:true`, each with its `matchPolicy` set to reproduce today's
  behavior (most are `'exact'`; splittable if large). Terminal copy/paste/interrupt and diff
  `j/k/…` stay **display-only** catalog rows (owned by xterm / the diff surface). The `⌘;` leader stays
  `rebindable:false` (SP3).

**Risks / mitigations:**

- **Behavior drift on migration** → the behavior-preservation table test (§8) + re-running each hook's
  existing suite unchanged; defaults are byte-equal to today's combos.
- **ts-rs binding clobber / CI "Code Quality" gate** (ESLint + prettier `--check` + type-check, all
  **repo-wide**) → re-run `generate:bindings` then prettier on `src/bindings/`; run
  `lint && format:check && type-check` before pushing, not just `eslint src`.
- **Durability** (a bad override wiping `settings.json`) → the total lenient deserializer (§7.1) + test.
- **Terminal-safety** (an override stealing a bare key) → `setUserBinding`'s `'invalid-super'` rejection
  + `resolveBindings` dropping super-less / both-super overrides via the shared predicate (§5.3, §6.2).

**Forward-compat — how SP2/3/4 drop in:**

- **SP2 (editing UI)** consumes the already-built `catalog` + `detectConflicts` + `setUserBinding` /
  `resetBinding`. The pencil captures a `KeyboardEvent` → `Chord` (a small helper), shows conflicts,
  and calls `setUserBinding` (whose `SetBindingResult` drives the warning). Import/Export = (de)serialize
  the `customKeybindings` map. The unbind sentinel (D5) is added here.
- **SP3 (leader)** flips `palette` to `rebindable:true` and wires `bindingFor('palette')` through the
  **three** hardcoded sites (renderer `isCommandPaletteToggle`, Electron `isCommandPaletteShortcutInput`,
  Linux accelerator), then re-introduces `useVimLeaderChords` (preset-gated) on the now-customizable
  leader.
- **SP4 (presets)** models VS Code / JetBrains / Custom as **named `CustomKeybindings` sets** layered by
  the existing resolver (Zed's `base_keymap` shape) — no engine change.

<!-- codex-reviewed: 2026-06-16T04:05:18Z -->
