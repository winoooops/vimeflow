# Command Palette — Design Spec

## Overview

A vim-style command palette for Vimeflow, triggered by pressing `:` in normal mode (i.e. when no input element is focused). The palette provides a nested command tree with fuzzy search, keyboard navigation, and smooth spring-based animations via framer-motion. It should feel as natural as vim's `:` or Zed's command palette.

## Tech Stack

- **Framework:** React 19 + TypeScript (arrow-function components, explicit return types)
- **Animation:** framer-motion (new dependency — spring physics, AnimatePresence exit animations)
- **Styling:** Tailwind 4 with existing Catppuccin Mocha design tokens
- **Icons:** Material Symbols Outlined (already available)
- **Testing:** Vitest + Testing Library (co-located test files)

## Trigger & Input Model

### Opening

- A global `keydown` listener intercepts `:` on `document`
- **Guard:** if `document.activeElement` is an `<input>`, `<textarea>`, or `[contenteditable]`, the event passes through normally (palette does not open)
- Otherwise, `preventDefault()` is called, and the palette opens with `:` pre-filled in the search input
- The search input receives focus immediately

### Closing

- `Escape` key dismisses the palette
- Clicking the backdrop dismisses the palette
- Executing a command dismisses the palette
- `Backspace` when the input contains only `:` dismisses the palette

### Keyboard Navigation

| Key                       | Action                                           |
| ------------------------- | ------------------------------------------------ |
| `Arrow Up` / `Arrow Down` | Navigate results (wraps around)                  |
| `Enter`                   | Execute selected command or drill into namespace |
| `Escape`                  | Close palette                                    |
| `Backspace` on empty `:`  | Close palette                                    |
| `Tab`                     | Autocomplete current match (bonus, not MVP)      |

## Command Tree & Registry

### Command Interface

```typescript
interface Command {
  id: string
  label: string // display name, e.g. ":open"
  description?: string // secondary helper text for non-vim users
  icon: string // Material Symbols icon name
  children?: Command[] // sub-commands (nested tree)
  execute?: (args: string) => void // leaf command handler
  match?: (query: string) => number // custom fuzzy match scorer (optional)
}
```

A command is either a **namespace** (has `children`, no `execute`) or a **leaf** (has `execute`, no `children`).

### Initial Command Tree (Stubbed)

```
:open
  ├── <filename>     → open file by name (fuzzy matched against mock file list)
  └── recent         → show recently opened files
:set
  ├── theme          → switch color theme
  └── font           → change editor font
:help                → show command reference
:new                 → create new conversation
```

All commands are stubbed with placeholder implementations for the initial build. The `:open <filename>` command fuzzy-matches against a mock file list.

### Fuzzy Matching

Custom implementation (no external library):

- Substring match + character-skip scoring
- Exact prefix matches weighted highest
- Results sorted by descending score
- Minimum score threshold to filter noise

### Feature-Owned Commands

Each feature exports its own command subtree:

- `features/files/commands.ts` → `:open` branch
- `features/chat/commands.ts` → `:new` branch
- `features/command-palette/data/defaultCommands.ts` → merges all trees

This is a static import/merge for now. Dynamic registration can be added later.

## UI Components

### Component Tree

```
CommandPalette (overlay + backdrop, AnimatePresence wrapper)
├── CommandInput (search bar with `:` prefix, ESC badge)
├── CommandResults (scrollable list of matches)
│   └── CommandResultItem (icon + label + description + Enter/keyboard hints)
└── CommandFooter (Navigate / Select hints, "Type ? for help")
```

### Layout & Styling

Matches the reference design in `docs/design/command_palette/`:

- **Overlay:** `fixed inset-0 z-[100]`, `backdrop-blur-sm bg-black/40`
- **Panel:** centered at `pt-[15vh]`, `max-w-2xl`, `bg-[#1e1e2e]/90`, `glass-panel`, `rounded-2xl`, `border border-[#4a444f]/30`, `shadow-2xl`
- **Input section:** search icon (primary-container), input with `:` pre-filled, ESC badge (top-right)
- **Results:** `p-2`, each item is a row with icon + label + optional description + keyboard hint
- **Selected item:** `bg-primary-container/10`, `border border-primary-container/10` — shows Enter badge
- **Unselected items:** transparent bg, Enter badge appears on hover (`opacity-0 group-hover:opacity-100`)
- **Footer:** `bg-surface-container-lowest/50`, keyboard hint chips (Navigate, Select), "Type ? for help" text

### Helper Text for Non-Vim Users

Secondary description text appears below or beside command labels in a muted color (`text-on-surface-variant`). This provides context for users unfamiliar with vim command syntax. Examples:

- `:open` → "Open a file by name"
- `:set theme` → "Change the color theme"
- Footer shows "Type '?' for help" as a progressive disclosure entry point

This is a bonus feature — present in the UI but not gating the core implementation.

### Animation (framer-motion)

**Backdrop:**

- Fade in: `opacity: 0 → 1`, duration 150ms

**Palette panel:**

- Open: `scale: 0.96 → 1`, `opacity: 0 → 1`, `y: -8 → 0` — spring with `stiffness: 400, damping: 30`
- Close: reverse with faster easing, 100ms duration

**Results list:**

- Staggered children entrance: each item fades in 30ms apart
- Selected item highlight: `layoutId` for smooth selection indicator movement

**Exit:**

- `AnimatePresence` wraps the palette for clean unmount animations

## File Structure

```
src/features/command-palette/
├── CommandPalette.tsx            # Root overlay (AnimatePresence, backdrop, panel)
├── components/
│   ├── CommandInput.tsx          # Search icon + input + ESC badge
│   ├── CommandResults.tsx        # Scrollable results container
│   ├── CommandResultItem.tsx     # Single result row (icon, label, desc, hint)
│   └── CommandFooter.tsx         # Keyboard shortcut hints bar
├── hooks/
│   └── useCommandPalette.ts     # Global `:` listener, open/close, navigation state
├── registry/
│   ├── types.ts                 # Command, CommandTree interfaces
│   ├── commandTree.ts           # Tree builder, merge, traversal, namespace lookup
│   └── fuzzyMatch.ts            # Substring + char-skip scoring algorithm
├── data/
│   └── defaultCommands.ts       # Stub commands, merges feature command exports
└── types/
    └── index.ts                 # Re-exports from registry/types
```

Co-located test files for every `.tsx` and `.ts` file (e.g. `CommandPalette.test.tsx`, `fuzzyMatch.test.ts`).

## Integration

### App.tsx

The palette renders at the root level, alongside the active view:

```tsx
<>
  {activeTab === 'Chat' ? <ChatView ... /> : <FilesView ... />}
  <CommandPalette />
</>
```

No changes to existing components. The palette is purely additive.

### Z-Index

The palette uses `z-[100]`, above all existing layers (IconRail/Sidebar at z-40/50, TopTabBar at z-30).

### Accessibility

- `role="dialog"`, `aria-modal="true"`, `aria-label="Command palette"`
- Focus trap inside the palette when open
- `role="listbox"` on results, `role="option"` on each item
- `aria-activedescendant` tracks the selected item

## Testing Strategy

### Unit Tests

- `fuzzyMatch.ts` — scoring accuracy, edge cases (empty query, exact match, no match, special characters)
- `commandTree.ts` — tree traversal, merge two trees, namespace lookup, leaf lookup

### Component Tests

- `CommandInput` — renders with `:` prefix, ESC badge, fires onChange
- `CommandResultItem` — renders icon, label, description, selected state
- `CommandResults` — renders list, keyboard navigation updates selection
- `CommandFooter` — renders keyboard hints
- `CommandPalette` — full integration: open, type, navigate, select, close

### Hook Tests

- `useCommandPalette` — `:` opens palette when no input focused, suppressed when input focused, Escape closes, Backspace on empty `:` closes

### Coverage Target

80%+ line coverage across all new files.

## Dependencies

### New

- `framer-motion` — spring-based animations, AnimatePresence for exit animations

### Existing (no changes)

- React 19, Tailwind 4, Material Symbols, Vitest, Testing Library

## Out of Scope

- Real file system integration (commands are stubbed)
- Persistent command history
- Custom user-defined commands
- Editor insert-mode detection (future — for now, guard is input/textarea/contenteditable)
