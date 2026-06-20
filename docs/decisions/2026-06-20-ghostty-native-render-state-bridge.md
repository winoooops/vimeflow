# Ghostty Native Render-State Bridge

## Context

`VIM-180` moves the Ghostty exploration from contract-only plumbing to the first
real native render-state provider. The renderer and preload scripts are
sandboxed and cannot load arbitrary native modules directly, so `libghostty-vt`
loading is owned by Electron main.

The existing architecture remains Option A+ from
`2026-06-16-ghostty-pty-parser-boundary.zh.html`: the app talks to a renderer
adapter, the Ghostty adapter owns the parser engine, and semantic events such as
OSC 7 return through `TerminalParserEvent`.

## Options Considered

1. Load a native module directly from renderer code.
2. Add a backend command that parses every PTY chunk out-of-process.
3. Expose a narrow bridge consumed by the existing Ghostty render-state provider
   seam, with preload as a sandbox-safe proxy and Electron main as the native
   owner.

## Decision

Use option 3. The built-in provider id is `native`, selected with:

```sh
VITE_TERMINAL_RENDERER=ghostty
VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER=native
```

The renderer expects `window.vimeflow.ghosttyRenderState` to expose:

```ts
interface GhosttyRenderStateBridge {
  createDriver(effects: { onCwdChange(uri: string): void }): {
    writeBytes(bytes: Uint8Array): void
    readSnapshot(): unknown
    reset?(): void
    resize?(size: { cols: number; rows: number }): void
    dispose?(): void
  }
}
```

Electron preload exposes a sandbox-safe repository-owned bridge implemented in
`electron/ghostty-render-state-preload.ts`. The preload bridge uses synchronous
IPC to `electron/ghostty-render-state-main.ts`, where Electron main loads the
beta `@coder/libghostty-vt-node` package through `node-gyp-build`, owns native
terminal instances, maps native snapshots into the existing renderer contract,
and returns OSC7 effects to preload before `writeBytes` returns. If the native
binding cannot load or returns an invalid shape, selecting the `native` provider
fails closed before the Ghostty renderer is instantiated.

## Justification

1. Renderer and preload sandboxing stay intact. Native module loading remains in
   Electron main, outside React renderer code and outside sandboxed preload.
2. The provider gate now represents a real runtime selection path, not only a
   test hook.
3. `bytesBase64` still feeds `Uint8Array` into the driver through the existing
   Ghostty byte parser adapter.
4. Rows and cursor position still return through `displayDelta.replace` and
   `cursorOffset`.
5. OSC 7 cwd updates still use the existing `TerminalParserEvent` path.

## Packaging Constraints

- `@coder/libghostty-vt-node` is currently a beta dependency. The app owns the
  Electron main bridge so the renderer contract is insulated from upstream API
  churn.
- The native package and `node-gyp-build` must be packaged with Electron.
  `electron-builder.yml` includes both packages and unpacks
  `@coder/libghostty-vt-node/prebuilds/**/*.node` for native loading from ASAR.
- The module must be ABI-compatible with the Electron runtime, not only the
  local Node.js runtime.
- Effects such as `onCwdChange` must fire synchronously during `writeBytes`.
  The byte adapter clears its active output context immediately after
  `writeBytes` returns.
- The current Node binding exposes terminal state and optional styled cells, but
  does not expose semantic OSC callbacks. The Electron main bridge therefore
  runs a small byte-stream OSC 7 scanner before feeding bytes into the native
  terminal state, asks the native snapshot for `includeCells: true`, and returns
  cwd events to preload synchronously.
- `readSnapshot()` returns `unknown` at the bridge boundary. Renderer code
  validates rows, cursor shape, and optional styled cells before applying the
  display delta.
- Styled cells are important for prompt fidelity. A plain `visibleLines` snapshot
  loses powerline foreground/background segments and may trim trailing prompt
  cells that cursor placement depends on. The native adapter converts styled
  cells into the same SGR-style sentinel path used by the existing
  `TerminalDisplayBuffer`, so prior cell-width fixes for Nerd Font and
  powerline glyphs stay in the rendering path.
- Native snapshots are full-screen replacements, not append-only transcript
  chunks. The text surface keeps `displayDelta.replace` renders pinned to the
  viewport top so empty native viewport rows do not scroll prompt content out of
  view.
- The bridge is still a feasibility spike until manual smoke testing confirms
  the native binding behaves correctly inside the packaged Electron runtime.

## Known Risks & Mitigations

- **Native package absent or unsupported:** selecting `native` fails closed with
  an explicit bridge-unavailable error.
- **Upstream beta churn:** the app consumes only `createTerminal`, `feed`,
  `resize`, `snapshot`, and `dispose` behind the preload bridge.
- **Malformed snapshots:** the renderer rejects invalid rows/cursor data instead
  of applying a corrupt terminal state.
- **Agent observability coupling:** no agent status feature reads from the
  Ghostty driver. Agent card/status bar remain on the existing observability
  layer.
- **OSC 7 regression:** cwd is still emitted as `{ type: 'cwd', source: 'osc7' }`
  from the parser event path.

## References

- `VIM-180` Ghostty M2: first real render-state driver integration
- `docs/decisions/2026-06-16-ghostty-pty-parser-boundary.zh.html`
- `electron/ghostty-render-state-main.ts`
- `electron/ghostty-render-state-preload.ts`
- `src/features/terminal/components/TerminalPane/ghosttyNativeRenderStateBridge.ts`
