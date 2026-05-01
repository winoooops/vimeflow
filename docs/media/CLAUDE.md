# Media — Visual Documentation Assets

Image and animation assets referenced by `README.md` and `README.zh-CN.md`. Captured manually from a running `tauri:dev` build.

## Inventory

| Asset                      | Used in                      | Source                                                                         |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `hero-init.gif`            | README hero                  | Kooha (WebM, VP8) → ffmpeg (1.5× speed, 15 fps, 1280px wide, 80-color palette) |
| `workspace-overview.png`   | "What's Built" header        | Active-window screenshot                                                       |
| `agent-status-sidebar.png` | Agent Status Sidebar section | Active-window screenshot, cropped to right panel                               |
| `git-diff.png`             | Feature Modules section      | Active-window screenshot                                                       |
| `editor-vim.png`           | Feature Modules section      | Active-window screenshot                                                       |

## Capture pipeline (hero gif)

Kooha records WebM cleanly without dropping frames; ffmpeg converts to a small, smooth GIF afterward.

1. Open Kooha → Preferences → Format = WebM (VP9 or VP8), Save Location = `docs/media/`, Frame Rate = 30, audio off.
2. Record the scenario (open new terminal → `claude` + Enter → wait for sidebar expand → `/init` + Enter → ~5 s of tool calls → Stop).
3. Convert to GIF:

   ```bash
   # Pick the most recent recording explicitly — a bare glob silently picks
   # only the first match if multiple takes are present, or fails opaquely
   # when none match.
   WEBM=$(ls -t docs/media/Kooha-*.webm 2>/dev/null | head -1)
   [ -z "$WEBM" ] && { echo "No Kooha WebM in docs/media/" >&2; exit 1; }

   ffmpeg -y -i "$WEBM" \
     -vf "setpts=PTS/1.5,fps=15,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=80[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
     -loop 0 docs/media/hero-init.gif
   ```

   Adjust `setpts=PTS/N` for speed, `max_colors=N` for size. Target ≤ 6 MB for GitHub README embed performance.

4. Delete the WebM source after the GIF is verified.
