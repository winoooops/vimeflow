# Ghostty M4 Native VT Smoke Checklist

Use this checklist to close M4 against the real native Ghostty VT provider.

## Launch

Run the Electron app with the native provider enabled:

```sh
VITE_TERMINAL_RENDERER=ghostty VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER=native npm run electron:dev
```

Expected startup result:

- The terminal pane does not show `Terminal failed to start`.
- Shell output appears without clicking another UI control first.
- The prompt renders ANSI colors, powerline or Nerd Font symbols, and a blinking block cursor.
- The terminal pane has no horizontal scrollbar after narrowing the pane.

## Selection And Copy

1. In the terminal, run:

   ```sh
   printf '\033[2J\033[1;1Hnative-select$ '
   ```

2. Right-click inside the terminal and choose `Select All`.
3. Right-click again and choose `Copy`, or use the platform copy shortcut.
4. Paste into a text editor.

Expected result:

```text
native-select$
```

There should be no extra blank lines after the prompt.

## Native Command IO

Run:

```sh
printf 'native-m4:stdout\n'; printf 'native-m4:stderr\n' 1>&2; read vf_line; printf 'native-m4:stdin:%s\n' "$vf_line"
```

Then type:

```text
hello-from-ghostty
```

Expected result:

- `stdout`, `stderr`, and `stdin:hello-from-ghostty` are visible.
- The active cursor remains visible at the bottom of the viewport.
- No escape-control text such as `[2J`, `[1;1H`, or `]7;` is rendered.

## Wrapping And Cursor

Narrow the terminal pane and run:

```sh
i=0; while [ "$i" -lt 240 ]; do printf x; i=$((i + 1)); done; printf '\nwrap-done\n'
```

Expected result:

- Output wraps inside the pane width.
- No horizontal scrollbar appears.
- The cursor remains visible after the final prompt.
