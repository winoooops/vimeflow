# Handoff delta — Icon Rail + Settings dialog

Two changes since the previous handoff:

1. **Icon Rail trimmed.** Files / Editor / Git Diff / Context Bucket icons were removed — those views live in the session-tabs + dock now, so the rail no longer competes with them. The rail keeps only **global utilities** at the bottom (Command Palette + Settings) and **identity** at the top (the user avatar now sits where the V brand mark used to be).

2. **Settings dialog** added. Wired to the rail's gear icon and `⌘,`. Modal overlay with the same Obsidian Lens vocabulary as the rest of the app.

## What's new — Icon Rail (`src/shell.jsx`)

```
old rail               new rail
─────────              ────────
[V brand]              [w avatar]   ← user identity, top
[bolt]                              ← gone (was Agent Workspace)
[folder]                            ← gone (Files lives in dock)
[code]                              ← gone (Editor lives in dock)
[diff]                              ← gone (Diff lives in dock)
[inventory]                         ← gone (Context lives in sidebar tab)
...spacer...           ...spacer...
[terminal]             [terminal]   ← Command Palette (⌘K)
[settings]             [settings]   ← Settings (⌘,)
[w avatar]                          ← moved to top
```

The `IconRail` component now takes an extra `onSettings` callback in addition to
`onCommand`. The `activeArea` / `onArea` props are still accepted (so existing
callers don't break) but are unused inside the rail body.

## What's new — Settings dialog (`src/settings.jsx`, NEW)

Modal overlay at z-index 110 with backdrop blur, ~920×640px panel.

| Region           | Contents                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Title bar        | Just a close `✕` button on the right.                                                                                                  |
| Sidebar (220 px) | Search input + 14 categories with chevron icons. Active row gets the lavender left accent bar and `rgba(203,166,247,0.10)` background. |
| Header           | `User / vimeflow` scope tabs (active gets a 1.5 px lavender underline), then "Edit in settings.json" button right-aligned.             |
| Right pane       | Scrollable pane that renders the selected section.                                                                                     |
| Footer           | `ctrl+shift+e Focus Navbar` (left) · `esc close` (right) — mono, gold-soft.                                                            |

### Wired panes

- **General** — placeholder Zed-style rows (close-behaviour selectors, system-prompt toggles, redact-private-values toggle, CLI default-open selector).
- **Appearance** — color scheme grid with 4 swatches (Obsidian Lens / Editorial / Dense / W.W. Navigator), each card shows a mini-surface preview + accent line. Cards drive the existing `aesthetic` tweak so the dialog re-themes live. Below: Import / Export / Browse-community buttons, accent hue slider, density, UI/mono font selectors.
- **Keymap** — preset selector (Vimeflow / Vim / VS Code / JetBrains / Custom) + a bindings table with `<Kbd>` chips for every shortcut and an edit pencil per row. Reset / Import / Export buttons at the bottom.
- **Coding Agents** — single toggle for "manage agent shell aliases" plus an editable table:

  | Alias | Agent  | Model       | Extra flags |
  | ----- | ------ | ----------- | ----------- |
  | cc    | Claude | sonnet-4    | --continue  |
  | cdx   | Codex  | gpt-5-codex |             |
  | gem   | Gemini | gemini-2.5  | --chat      |

  Each row is fully editable; trash-can icon removes; "Add alias" appends. **The whole point:** these aliases are injected into each pane's PTY environment by Vimeflow itself — `~/.bashrc` / `~/.zshrc` are _never_ written to. An info note at the bottom of the pane spells this out and references `~/.config/vimeflow/aliases.toml`.

- **Editor / Terminal / Languages & Tools / Search & Files / Window & Layout / Panels / Version Control / Collaboration / AI / Network** — every other category renders a dashed placeholder card so the information architecture is visible without me inventing copy.

### Primitives exposed for reuse

The settings file also exports a small kit of pane primitives — agents can lift these for new settings panes without re-inventing them:

```ts
<Row label hint last>{control}</Row>
<PaneTitle title sub />
<Toggle on onChange />
<Select value options onChange width />
<GhostButton onClick>...</GhostButton>
<TextInput value onChange placeholder mono width />
```

## Bugfix included

The W.W. Navigator scheme was added to the swatch grid but missing from
`window.VIMEFLOW_AESTHETICS`, so selecting it threw on `aesthetic.displayFont`.
Fixed in two places:

- `src/tokens.js` — registered the `navigator` aesthetic entry.
- `src/app.jsx` — defensive fallback (`aesthetic = AESTHETICS[id] || AESTHETICS.obsidian`) so any future unknown scheme falls back gracefully.

## Wiring (`src/app.jsx`)

```jsx
// New state
const [settingsOpen, setSettingsOpen] = useState(false);

// Keyboard shortcut
useEffect(() => {
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      setSettingsOpen(o => !o);
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, []);

// Rail
<IconRail
  activeArea={activeArea}
  onArea={onArea}
  onCommand={()=>setPaletteOpen(true)}
  onSettings={()=>setSettingsOpen(true)}
/>

// Dialog
<SettingsDialog
  open={settingsOpen}
  onClose={()=>setSettingsOpen(false)}
  tweaks={tweaks}
  onChange={updateTweaks}
/>
```

## HTML (`Vimeflow.html`)

One line added — load `settings.jsx` after `splitview.jsx`, before `overlays.jsx`:

```html
<script type="text/babel" src="src/splitview.jsx"></script>
<script type="text/babel" src="src/settings.jsx"></script>
<!-- NEW -->
<script type="text/babel" src="src/overlays.jsx"></script>
```

## Files in this delta

```
prototype/src/shell.jsx          (modified — trimmed rail)
prototype/src/settings.jsx       (NEW — Settings dialog)
prototype/src/app.jsx            (modified — wiring + fallback)
prototype/src/tokens.js          (modified — added navigator aesthetic)
prototype/Vimeflow.html          (modified — added settings.jsx <script>)
```

Drop these over the matching paths in your existing handoff bundle. No other
files in the project changed.
