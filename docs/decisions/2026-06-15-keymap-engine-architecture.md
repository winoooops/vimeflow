# Keymap customization engine — architecture (VIM-136 / SP1)

**Status:** Accepted (locked with the user 2026-06-15; spec + PR1 plan codex-reviewed).

## Context

The Keymap pane shipped read-only in VIM-104 (#460); the customization engine was deferred. The
blocker is structural: the keymap is **fully hardcoded** — every shortcut is its own capture-phase
`document` keydown hook with its key-match baked in, and `sections.ts` `KEYMAP_GROUPS` is display-only
documentation manually mirrored from those hooks (it does not drive dispatch). So VIM-136's headline
acceptance — "editing a binding changes the live shortcut and persists across restart" — needs a
data-driven binding layer the hooks read from. The hard constraint is the 29 hard-won guards in
`docs/reviews/patterns/keyboard-shortcut-guards.md` (capture-phase, `⌘`-only intercept, `event.code`
not `event.key`, main-process/renderer parity, per-branch `return`, …) — the engine must preserve
them, not flatten them.

## Options considered

- **A — Consult-only data registry.** Registry holds binding _data_ + override methods only. Each hook
  keeps its own listener, guards, and action; it swaps just its hardcoded key-check for
  `eventMatchesChord(event, bindingFor(id))`.
- **B — Central keydown router.** One listener owns all keydown, resolves event→commandId, invokes a
  registered handler. Hooks become `registerCommand(id, handler, guards)`.
- **C — Hybrid.** Central router for the simple uniform-guard globals; bespoke listeners (consulting a
  shared matcher) for the context-heavy hooks.

Persistence options: **(P1)** extend the existing atomic `settings.json` with a `customKeybindings`
map vs **(P2)** introduce SQLite.

## Decision

- **Engine: Option A (consult-only).** The registry is a pure data store; the hook in each component
  is the dispatcher and keeps every guard. `register(id, hook, combo)` lives as a component-side
  `useKeybindings()` helper — the hook never enters the registry.
- **Persistence: P1.** Extend `settings.json` with a `customKeybindings` map (a tolerant Rust
  deserializer keeps a malformed entry from wiping the durable file). No SQLite.
- Supporting model decisions: per-command `matchPolicy` (`exact` default / `tolerant` for layout-
  sensitive digit/backslash keys); a terminal-safety invariant (a rebindable override must keep
  exactly one super); a final-set resolver (defaults ⊕ overrides validated as a set so swaps survive);
  a pure conflict detector. Full data model in the spec.
- **Decomposition:** SP1 (this engine + migrate `usePaneShortcuts`/`useDockToggleShortcut`); SP2
  (editing UI); SP3 (customizable `⌘;` leader across renderer + Electron + Linux accelerator, +
  re-introduce the Vim leader chords removed in #460); SP4 (Custom / VS Code / JetBrains presets).

## Justification

1. **Preserves the 29 guards.** Option A is a surgical one-spot change per hook; the subtle, platform-
   specific, bug-bought guards stay untouched — the whole reason for engine-first.
2. **The unification B buys isn't worth it here.** Our guards are genuinely heterogeneous (terminal-
   active, dock/CodeMirror, out-of-range pane, layout capacity); a central router would move those
   `if`s from the hooks into the router — risk concentrated, complexity not removed. Worst on the
   most complex hook (`usePaneShortcuts`).
3. **Prior art backs both the split and the storage.** A verified deep-research pass over Zed and VS
   Code (25/25 claims survived 3-vote adversarial verification) found both keep the _id_ in the
   keybinding layer and the handler elsewhere (VS Code `KeybindingsRegistry` vs `CommandsRegistry`;
   Zed `keymap.json` action-ids vs gpui `Action` + `on_action`), and both persist keybindings in
   **hot-reloaded JSON, never SQLite** — even though both ship SQLite for window/session state.
4. **Incremental + reversible.** A migrates one hook per PR; un-migrated hooks keep working. A's
   sediment (catalog, chord, matcher, resolver) is exactly the foundation B would need later, so A
   does not foreclose B; B is hard to walk back.

## Alternatives rejected

- **B (central router)** — highest regression risk against the 29 guards; can't migrate incrementally
  (the router must handle every command before any hook is removed). Rejected for SP1.
- **C (hybrid)** — two dispatch paths to reason about, and the "which commands go where" line drifts.
  Rejected; A handles simple and complex hooks uniformly.
- **P2 (SQLite)** — overkill, and contradicted by both reference editors. Rejected.
- **`effects: hook` stored in the binding entry** (the user's first sketch) — both editors keep the
  handler out of the binding entry; storing only the id keeps the registry ignorant of hook
  internals. Adjusted before locking.

## Known risks & mitigations

- **Behavior drift on migration** → a behavior-preservation table test (`resolveDefault(cmd, isMac)`
  == today's hardcoded combo) + re-running each hook's existing guard suite unchanged.
- **Durability** (a bad override wiping `settings.json`) → a total, tolerant Rust field deserializer.
- **Terminal-safety** (an override stealing a bare key) → overrides must keep a super, enforced at
  both the write (`setUserBinding`) and read (`resolveBindings`) boundaries.
- **Leader reservation on exotic layouts** → the `⌘;` leader is reserved by its default physical code
  for standard layouts; perfect logical-key reservation is deferred to SP3 (when the leader migrates).

## References

- Spec: `docs/superpowers/specs/2026-06-15-keybinding-engine-design.md` (codex-reviewed).
- PR1 plan: `docs/superpowers/plans/2026-06-15-keybinding-engine-pr1.md` (codex-reviewed).
- Visual decision notes (中文): [`dispatch model A/B/C`](./2026-06-15-keymap-engine-dispatch-model.zh.html),
  [`registry role`](./2026-06-15-keymap-engine-registry-role.zh.html).
- Prior art: VS Code `keybindingsRegistry.ts` / `commands.ts` / `keybindingService.ts`; Zed gpui
  `Action` trait / `key_dispatch.md` / `keymap.json`.
- Guard constraints: `docs/reviews/patterns/keyboard-shortcut-guards.md`.
- Linear: VIM-136.
