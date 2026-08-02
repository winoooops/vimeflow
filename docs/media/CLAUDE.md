# Media — Visual Documentation Assets

Image and animation assets referenced by `README.md` and `README.zh-CN.md`. Capture new assets from a running build — use `VIMEFLOW_USER_DATA_DIR=/tmp/vimeflow-demo npm run electron:dev:ghostty` so the demo profile never touches your real sessions. Older assets may predate the current UI; keep captions accurate when replacing them.

## Inventory

| Asset                      | Used in                            | Scenario                                                                                           |
| -------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `hero-workspace.gif`       | README hero                        | Create a session in a demo project, launch `claude` in a Ghostty pane, agent panel streams traces  |
| `ghostty-resize.gif`       | "Native Ghostty Terminals" section | Drag a pane divider (or window edge) while a terminal renders live — show the smooth reflow        |
| `ghostty-tui.png`          | "Native Ghostty Terminals" section | `nvim` full-screen in one pane, an agent session beside it                                         |
| `multi-agent-grid.png`     | "Many Agents, One Workspace"       | Quad layout — `claude`, `codex`, `kimi`, `opencode` one per pane, status panel expanded            |
| `agent-context.png`        | "Reading the status sidebar"       | Context-reservoir gauge (fill + % + tokens left) from the expanded agent sidebar                   |
| `agent-cache.png`          | "Reading the status sidebar"       | Cache-rate ring ("CACHED THIS TURN") with cached / wrote / fresh counts                            |
| `agent-traces.png`         | "Reading the status sidebar"       | The Traces feed — a list of recent tool calls (tool · args · result) from the agent sidebar        |
| `agent-rail-collapsed.png` | "Reading the status sidebar"       | Collapsed sidebar rail — the compact vertical context reservoir (CTX) above the small cache ring   |
| `usage-bars.png`           | "Many Agents" → Plan usage         | Agent status card with model, turn count, and the 5-hour + weekly plan-usage bars (Claude)         |
| `kimi-usage.png`           | "Many Agents" → Plan usage         | Kimi Code plan-usage card (`kimi-code/k3`) with the "Turn off plan-usage tracking" control         |
| `hunk-review.png`          | "Review Changes Hunk By Hunk"      | Diff dock (`⌘G`): a resolved review thread on a changed line (comment → agent reply → resolved)    |
| `worktree-chip.png`        | "Seamless Worktree Integration"    | The git chip's copy popover (Copy worktree / path / branch) over the worktree → branch status chip |
| `command-palette.png`      | "Command Palette And Settings"     | Palette open (`⌘;`) with fuzzy-matched commands visible                                            |
| `theme-tour.gif`           | "BYOT: Bring Your Own Theme"       | `:theme` live-previewing the built-in themes                                                       |
| `cursor-warp.gif`          | "Cursor Effects"                   | Warp effect — the cursor stretches between positions on a large jump                               |
| `cursor-sweep.gif`         | "Cursor Effects"                   | Sweep effect — a band sweeps along the path the cursor travels                                     |
| `cursor-tail.gif`          | "Cursor Effects"                   | Tail effect — a fading streak follows the cursor through the buffer                                |
| `cursor-ripple.gif`        | "Cursor Effects"                   | Ripple effect — a ring expands from each position the cursor lands on                              |
| `cursor-sonic-boom.gif`    | "Cursor Effects"                   | Sonic Boom effect — a shockwave bursts on fast, long-distance movement                             |
| `linux-workspace.png`      | "On Linux"                         | Vimeflow running the full workspace on Linux (xterm.js terminals)                                  |

## Capture pipeline (macOS)

Keep the window at a fixed size for every asset so crops and aspect ratios match across the README. The app opens at its default 1400×900 (no bounds are persisted), so just launch fresh and don't resize between shots.

**Screenshots** — `⌘⇧4`, then `Space`, then click the window: captures the active window with rounded corners and shadow on a transparent background. Save as PNG into `docs/media/`.

**Recordings** — `⌘⇧5` → "Record Selected Portion" → drag the region to the window bounds → record the scenario → stop from the menu bar. The `.mov` lands in the configured save location; convert to GIF:

```bash
# Pick the most recent recording explicitly — a bare glob silently picks
# only the first match if multiple takes are present, or fails opaquely
# when none match.
MOV=$(ls -t ~/Desktop/Screen*.mov 2>/dev/null | head -1)
[ -z "$MOV" ] && { echo "No screen recording found" >&2; exit 1; }

NAME=<name>
FRAMES=$(mktemp -d)

# Trim here, not in gifski — it has no seek. Drop -ss/-t for the whole clip;
# for the middle N seconds, start at (duration - N) / 2.
ffmpeg -v error -ss <start> -t <seconds> -i "$MOV" \
  -vf "scale=900:-2:flags=lanczos" -r 20 "$FRAMES/%04d.png"

gifski --fps 20 --quality 90 -o "docs/media/$NAME.gif" "$FRAMES"/*.png
rm -rf "$FRAMES"
```

Use 900 wide for near-square crops (a pane) and 1280 for full-window landscape captures — match the `width` the README embeds it at. Target ≤ 6 MB per GIF for GitHub README embed performance. Delete the `.mov` source after the GIF is verified.

`gifski` (`brew install gifski`) quantizes per frame, so it holds up on smooth gradients — shader cursor trails, theme transitions — where a single 80-color global palette bands visibly. For flat UI chrome the older single-pass `ffmpeg` `palettegen`/`paletteuse` filter is still fine and faster.

(The Linux pipeline recorded WebM with Kooha and used the same ffmpeg conversion.)
