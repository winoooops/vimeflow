# AGENTS.md

Instructions for agents editing `src/components/**`.

## Read First

- `src/components/README.md`
- `docs/design/UNIFIED.md` component contracts
- Relevant existing primitive and sibling tests before changing an API

## Boundary Rules

- Public primitives live flat in `src/components/*.tsx`.
- `src/components/base/**` is package-private substrate. Do not make feature code import it.
- Do not import `@floating-ui/react` outside `src/components/base/floating/**` or `src/components/Tooltip.tsx`.
- Do not add native `title=` attributes.
- Do not add raw icon-only Material Symbols buttons outside the existing button primitives.

## Extraction Rules

- Start from real call sites. Name the duplicated behavior before naming the component.
- Keep feature domain logic out of shared primitives.
- Shared primitives should own accessibility, focus, keyboard behavior, dismissal policy, tokenized chrome, and stable sizing contracts.
- Expose narrow props and documented presets. Avoid broad restyle props that reopen visual drift.
- Add a sibling test for every new source file and keep consumer tests focused on integration.
- When a primitive becomes canonical, update `docs/design/UNIFIED.md` and any relevant lint guard.

## Dialog Work

For the VIM-116 dialog follow-up, treat `Dialog` as an app-level modal shell, not a replacement for anchored `Popover`.

- First targets: `UnsavedChangesDialog` and the `CommandPalette` shell.
- Keep anchored non-blocking dialog-like surfaces on `Popover` / `base/floating`.
- Do not force `Dialog` through `SurfacePanel`; viewport modals should not depend on anchor-positioning state unless a smaller shared chrome helper is extracted.
- Validation target: `BurnerTerminalPopup`, because it needs persistent mount, terminal focus handoff, and custom overlay behavior.
- Out of scope: inline `role="dialog"` surfaces such as `ReviewCommentComposer`.
