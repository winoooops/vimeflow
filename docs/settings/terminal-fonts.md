# Terminal Font Setting

The Terminal settings pane exposes a persisted `terminalFontFamily` preference
stored in `settings.json`. It defaults to `JetBrains Mono`.

The renderer asks the sidecar for installed monospace families through
`list_system_fonts`. The sidecar uses platform font listings where available and
falls back to an empty list if the OS command is unavailable. The UI still keeps
the bundled/default terminal font available, so the selector remains usable even
when enumeration fails.

Open terminal panes apply the selected family immediately. The xterm font stack
prepends the selected family, then falls through the bundled Nerd Symbol face
and platform monospace families. If a saved font is later removed from the
system, the terminal renders through that fallback stack without needing a
settings migration.
