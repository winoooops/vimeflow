# Chat View UI — Design Spec

## Overview

Implement the full Chat screen as a static "dead page" — pixel-accurate to `docs/design/chat_or_main/screen.png` with all 4 columns (Icon Rail, Left Sidebar, Chat Content, Right Context Panel). No backend integration; all data is hardcoded mock data. Built with Vite + React 19 + TypeScript + Tailwind CSS using the Catppuccin Mocha palette defined in the reference HTML.

## Tech Stack

- **Bundler**: Vite (React + TypeScript template)
- **Frontend**: React 19, TypeScript (strict), arrow-function components only
- **Styling**: Tailwind CSS v4 with custom theme tokens from `docs/design/chat_or_main/code.html`
- **Fonts**: Manrope (headlines), Inter (body/labels), JetBrains Mono (code/metadata) via Google Fonts
- **Icons**: Material Symbols Outlined (Google Fonts)
- **Testing**: Vitest + Testing Library
- **Linting**: Existing ESLint flat config + Prettier (already configured in repo)
- **No Tauri**: Rust backend and `src-tauri/` are out of scope — added later

## Source of Truth

- **Visual reference**: `docs/design/chat_or_main/screen.png`
- **Implementation reference**: `docs/design/chat_or_main/code.html` — exact Tailwind classes, color tokens, spacing, and component structure
- **Design system**: `docs/design/DESIGN.md` — color theory, surface hierarchy, typography scale, elevation rules, do's and don'ts

## File Structure

```
src/
├── main.tsx                         # React root mount
├── App.tsx                          # Renders ChatView directly (no routing)
├── index.css                        # Tailwind directives, font imports, glass-panel utility, no-scrollbar
├── vite-env.d.ts                    # Vite type declarations
├── features/
│   └── chat/
│       ├── ChatView.tsx             # Full page: assembles layout shell + chat content
│       ├── components/
│       │   ├── MessageThread.tsx    # Scrollable message container
│       │   ├── UserMessage.tsx      # User message bubble with avatar + inline code
│       │   ├── AgentMessage.tsx     # Agent message with thinking state + code blocks
│       │   ├── CodeBlock.tsx        # File header + language badge + syntax-highlighted pre
│       │   ├── StatusBadge.tsx      # Uppercase pill badge (e.g. "REFACTORING")
│       │   └── MessageInput.tsx     # Glassmorphism textarea + send button
│       ├── data/
│       │   └── mockMessages.ts      # Typed sample conversation (different content from reference)
│       └── types/
│           └── index.ts             # Message, CodeSnippet, ConversationItem types
├── components/
│   └── layout/
│       ├── IconRail.tsx             # Far left 48px — brand logo, project icons, user avatar
│       ├── Sidebar.tsx              # Left 260px — search bar, conversation categories, settings
│       ├── TopTabBar.tsx            # Full-width tab bar — Chat/Files/Editor/Diff + actions
│       └── ContextPanel.tsx         # Right 280px — agent status, model info, recent actions, AI strategy
```

## Tailwind Configuration

All tokens extracted from `docs/design/chat_or_main/code.html` Tailwind config:

### Colors (Catppuccin Mocha extended)

| Token                       | Hex       | Usage                            |
| --------------------------- | --------- | -------------------------------- |
| `surface`                   | `#121221` | Base background (Level 0)        |
| `surface-container-lowest`  | `#0d0d1c` | Deepest recessed areas           |
| `surface-container-low`     | `#1a1a2a` | Sidebar backgrounds (Level 1)    |
| `surface-container`         | `#1e1e2e` | Cards, message bubbles (Level 2) |
| `surface-container-high`    | `#292839` | Elevated surfaces                |
| `surface-container-highest` | `#333344` | Code blocks, inputs (Level 3)    |
| `surface-bright`            | `#383849` | Hover states                     |
| `surface-variant`           | `#333344` | Progress bar backgrounds         |
| `on-surface`                | `#e3e0f7` | Primary text, titles             |
| `on-surface-variant`        | `#cdc3d1` | Body text, secondary text        |
| `on-background`             | `#e3e0f7` | Text on base background          |
| `primary`                   | `#e2c7ff` | Primary accent, active tab text  |
| `primary-container`         | `#cba6f7` | Primary CTA, active indicators   |
| `on-primary`                | `#3f1e66` | Text on primary surfaces         |
| `on-primary-container`      | `#57377f` | Text on primary container        |
| `secondary`                 | `#a8c8ff` | Secondary accent, code border    |
| `secondary-container`       | `#124988` | Secondary gradient end           |
| `on-secondary-container`    | `#8fbaff` | Text on secondary container      |
| `tertiary`                  | `#e2cdc9` | Tertiary accent                  |
| `error`                     | `#ffb4ab` | Error states                     |
| `outline`                   | `#968e9a` | Visible outlines                 |
| `outline-variant`           | `#4a444f` | Ghost borders (at 15% opacity)   |
| `inverse-surface`           | `#e3e0f7` | Inverse surface                  |

Plus all remaining tokens from the reference config (`surface-tint`, `surface-dim`, `primary-fixed`, `primary-fixed-dim`, `secondary-fixed`, `secondary-fixed-dim`, `tertiary-fixed`, `tertiary-fixed-dim`, `error-container`, `on-error`, `on-error-container`, `on-tertiary`, `on-tertiary-container`, `on-secondary`, `on-secondary-fixed`, `on-secondary-fixed-variant`, `on-primary-fixed`, `on-primary-fixed-variant`, `on-tertiary-fixed`, `on-tertiary-fixed-variant`, `inverse-on-surface`, `inverse-primary`).

### Fonts

```
fontFamily: {
  headline: ["Manrope"],
  body: ["Inter"],
  label: ["Inter"],
  mono: ["JetBrains Mono"]
}
```

### Border Radius

```
borderRadius: {
  DEFAULT: "0.25rem",
  lg: "0.5rem",
  xl: "0.75rem",
  "2xl": "1rem",
  full: "9999px"
}
```

## Component Specifications

### IconRail (48px, far left)

- Fixed position, full height, `bg-[#1a1a2a]/80 backdrop-blur-xl`
- Brand logo: "V" in `text-[#cba6f7] font-headline font-black text-xl`
- Project icons: `w-9 h-9 rounded-full`, active has left indicator bar (`w-1 h-8 bg-[#cba6f7] rounded-r-full`) and `bg-[#cba6f7]/20` background
- Inactive icons: `bg-surface-container`, hover `bg-[#333344]/50`
- Notification dot: `w-2.5 h-2.5 bg-secondary rounded-full` on project icons with activity
- User avatar at bottom: `w-8 h-8 rounded-full` with `border border-outline-variant/30`
- Add project button: `bg-surface-container-highest/40`

### Sidebar (260px, left)

- Fixed position, `bg-[#1a1a2a]`, border-right `border-[#4a444f]/15`
- macOS traffic lights: 3 dots (red `#ff5f56`, yellow `#ffbd2e`, green `#27c93f`), `w-3 h-3 rounded-full`
- Search bar: `bg-surface-container-highest/50 rounded-lg`, keyboard hint `⌘K`
- Category headers: `text-[10px] font-bold tracking-widest uppercase font-headline text-on-surface-variant`
- Active conversation: `bg-[#1e1e2e] rounded-md`, icon in `bg-primary-container/20`, sub-thread indicator with `border-l border-outline-variant/30`
- Inactive conversation: hover `bg-[#1e1e2e]/50`, unread dot `w-1.5 h-1.5 bg-secondary rounded-full`
- Settings at bottom with `border-t border-[#4a444f]/10`

### TopTabBar (full width, top of main content)

- `h-14`, `bg-[#121221]/90 backdrop-blur-md`, border-bottom `border-[#4a444f]/15`
- Active tab: `text-[#e2c7ff] border-b-2 border-[#cba6f7] font-headline font-semibold`
- Inactive tabs: `text-on-surface-variant`, hover `text-on-surface bg-[#1e1e2e]`, rounded-lg pill
- Right side: notification bell + more menu icons

### MessageThread

- `flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar`
- Messages centered: `max-w-3xl mx-auto`

### UserMessage

- Layout: `flex gap-4` — avatar on left, content on right
- Avatar: `w-10 h-10 rounded-full border-2 border-surface-container-highest`
- Name row: `text-sm font-semibold text-on-surface` + timestamp `text-[10px] text-on-surface-variant/60 font-label uppercase`
- Bubble: `bg-surface-container p-4 rounded-xl rounded-tl-none text-sm text-on-surface leading-relaxed shadow-sm`
- Inline code: `font-label bg-surface-container-highest px-1.5 py-0.5 rounded text-secondary`

### AgentMessage

- Layout: same `flex gap-4` as UserMessage
- Avatar: `w-10 h-10 rounded-full bg-primary-container/10 border border-primary-container/20`, psychology icon filled
- Name: `text-sm font-semibold text-primary` ("VIBM Agent")
- StatusBadge next to name
- Bubble: `bg-surface-container-low/40 border border-outline-variant/10 p-5 rounded-xl rounded-tl-none`
- Thinking text: `text-sm text-on-surface-variant italic`

### CodeBlock

- Container: `bg-surface-container-highest rounded-lg p-4 font-label text-[13px] border-l-4 border-secondary shadow-inner`
- Header row: file name with icon + language badge (`text-[10px] text-secondary`), separated by `border-b border-outline-variant/20 pb-2 mb-3`
- Code: `<pre>` with syntax-colored spans (keywords `#ff79c6`, comments `#6272a4`, strings in appropriate color)

### StatusBadge

- `bg-secondary/10 text-secondary text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider`

### MessageInput

- Outer: `p-6`, inner `max-w-3xl mx-auto relative`
- Textarea: `bg-surface-container-highest/30 border-none rounded-2xl p-4 pr-16 focus:ring-2 focus:ring-primary/20 text-sm resize-none glass-panel`
- Placeholder: `"Ask anything or ' / ' for commands..."`
- Send button: `bg-primary-container text-on-primary-container rounded-lg p-2 shadow-lg shadow-primary-container/20`, hover scale effect

### ContextPanel (280px, right)

- Fixed position, `bg-[#1a1a2a]`, border-left `border-[#4a444f]/15`
- Header: `font-headline text-xs font-bold tracking-widest text-on-surface-variant uppercase` ("AGENT STATUS")
- Model info card: `bg-surface-container rounded-xl border border-outline-variant/5`
  - Model badge: `bg-secondary/10 text-secondary text-[10px] font-bold rounded`
  - Context usage progress bar: `bg-gradient-to-r from-secondary to-secondary-container`
  - Stats grid: Latency + Tokens/s in `bg-surface-container-low rounded-lg` cards
- Recent actions: timeline dots (`w-2 h-2 rounded-full`), primary-container for newest, secondary for mid, outline-variant for oldest (with opacity fade)
- AI Strategy card: `bg-primary-container/5 rounded-xl border border-primary-container/10`
- System health footer: `bg-surface-container-lowest/50`, green pulse dot + "System Online" + version

## Custom CSS Utilities

```css
.glass-panel {
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
```

## Mock Data

Sample conversation with different content from the reference, exercising all component variants:

- 1 user message with inline code spans
- 1 agent message in "thinking" state with a code block
- Types: `Message` (union of `UserMessage | AgentMessage`), `CodeSnippet` (file, language, content), `ConversationItem` (sidebar entries)

## Design Rules (from DESIGN.md)

These rules must be followed in implementation:

- **No-Line Rule**: No `1px solid` borders for sectioning — use background color shifts only
- **Glass & Gradient Rule**: Floating elements use glassmorphism (60-80% opacity fill, 12-20px backdrop blur)
- **Ghost Border Fallback**: If border needed, `outline-variant` at 15% opacity
- **Hierarchy Rule**: `on-surface-variant` for body text, `on-surface` for titles/active states
- **Lists**: No divider lines — use spacing (`1rem`) to separate items
- **No pure black/white**: Use provided surface/on-surface tokens
- **No sharp corners**: Everything rounded per the border-radius scale
- **Ambient shadows**: `0px 10px 40px rgba(0, 0, 0, 0.4)` for floating elements

## Out of Scope

- Tauri backend / Rust / `src-tauri/`
- React Router / page navigation (Chat tab is always active)
- Real data fetching or IPC commands
- Interactive behavior (clicking conversations, sending messages)
- Other screens (Files, Editor, Diff, Command Palette)
- Storybook stories (can be added later)
