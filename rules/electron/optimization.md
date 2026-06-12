# Electron Package Optimization

Agent playbook for keeping the Vimeflow desktop package small and the build honest.
Derived from a generic web-performance guideline (Core Web Vitals / bundle-splitting /
caching interview guide), reviewed against this repo on 2026-06-12 and rewritten for
the Electron + Vite + Rust-sidecar shape of this project. Extends
`../common/performance.md` (measure first, optimize the critical path).

## How to Use This Document (Agents)

1. **Measure before touching anything** — run the commands in [Measuring](#measuring)
   and record numbers. Never claim a size win without a before/after pair.
2. Work the layers top-down: package contents → renderer bundle → sidecar binary →
   compression → runtime. The biggest wins are almost always in layer 1.
3. After any packaging change, **launch the built artifact** (not just `npm run dev`)
   before claiming success. A missing file in the asar fails at runtime, not build time.
4. Append dated results to the [Findings Log](#findings-log) so the next agent
   starts from facts, not re-measurement.

## Review of the Source Guideline: What Transfers

The source guideline targets browser-served web apps. Vimeflow loads its renderer
from local disk (`file://` via asar), so several sections do not apply as written.

| Technique (source guide)                         | Applies here? | Notes                                                                                   |
| ------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------- |
| Bundle splitting / tree shaking                  | ✅ Yes        | Vite renderer build; lazy chunks load from disk (fast) but still cut startup parse cost |
| Code splitting via `React.lazy` / dynamic import | ✅ Yes        | Already used for shiki language grammars (~80 lazy chunks)                              |
| Bundle analysis                                  | ✅ Yes        | `npx vite-bundle-visualizer` or rollup-plugin-visualizer                                |
| React.memo / useMemo / virtual scrolling         | ✅ Yes        | Runtime perf, unchanged in Electron                                                     |
| Image/font optimization (WOFF2, subsetting)      | ✅ Yes        | Fonts dominate our static assets; formats already WOFF2                                 |
| Core Web Vitals (LCP/FID/CLS) targets            | ⚠️ Partially  | No SEO dimension; treat as window-ready / first-paint budgets instead                   |
| HTTP caching headers, ETag, CDN                  | ❌ No         | No HTTP layer in production; assets ship in the asar                                    |
| Service workers / offline caching                | ❌ No         | App is already local-first                                                              |
| Resource hints (preload/preconnect/dns-prefetch) | ❌ Mostly     | No third-party origins in the packaged renderer                                         |
| SSR / static generation / prerender              | ❌ No         | Desktop renderer, not a crawlable site                                                  |

What the source guideline **misses entirely** — and where Electron apps actually bloat —
is the packaging layer below the web bundle: asar contents, Chromium locales, the
sidecar binary, and installer compression. Those layers are the bulk of this document.

## Measuring

All from repo root. Build first: `npm run electron:build:linux:x64` (Linux) /
`npm run electron:build:mac:arm64` (macOS). Output lands in `release/`.

```bash
# Installer + unpacked totals
ls -lh release/*.AppImage release/*.dmg 2>/dev/null
du -sh release/linux-unpacked/* | sort -rh | head

# What is actually inside the asar (the #1 bloat source)
npx asar list release/linux-unpacked/resources/app.asar | head -50
npx asar extract release/linux-unpacked/resources/app.asar /tmp/asar-inspect
du -sh /tmp/asar-inspect/* && du -sh /tmp/asar-inspect/node_modules/* 2>/dev/null | sort -rh | head

# Renderer bundle breakdown
du -sh dist/assets/* | sort -rh | head -20

# Sidecar binary
ls -lh target/release/vimeflow-backend
```

Red flags to grep for in the asar: `node_modules/` (see below), `*.map` sourcemaps,
test files, README/docs of dependencies.

## Layer 1: Package Contents (electron-builder)

### The node_modules trap (this repo's #1 issue, found 2026-06-12)

Vite bundles **every** renderer dependency into `dist/`, and vite-plugin-electron
bundles main/preload into `dist-electron/` (verified: the built `main.js` and
`preload.mjs` import only `electron` and `node:` builtins). Yet electron-builder
auto-includes all production `dependencies` node_modules into the asar regardless
of the `files` allowlist — that duplicated ~86MB of an 85MB asar for zero runtime use.

Fix: exclude node_modules in `electron-builder.yml`:

```yaml
files:
  - dist/**/*
  - dist-electron/**/*
  - package.json
  - '!node_modules/**'
```

**Rule:** a dependency belongs in the asar's node_modules only if the main process
`require()`s it at runtime un-bundled (e.g. native `.node` addons). Everything the
renderer uses goes through Vite. When adding a main-process dependency, either let
vite-plugin-electron bundle it or explicitly re-include just that package.

**Verify after every `electron-builder.yml` or `package.json` dependency change:**
`npx asar list .../app.asar | grep -c node_modules` should be 0 (or exactly the
re-included packages), and the packaged app must launch. Dependency additions
are the most common way to introduce a native `.node` addon; local dev may pass
while the packaged app fails because `node_modules` is excluded from the asar.

### Chromium locales

Electron ships 55 locale `.pak` files (~47MB unpacked). We render an English-only UI:

```yaml
electronLanguages:
  - en-US
```

### extraResources

Only the sidecar binary and font license belong in `resources/`. Audit
`release/linux-unpacked/resources/` whenever this list changes — files here bypass
the asar and ship uncompressed in the unpacked tree.

### What you cannot remove

- `LICENSES.chromium.html` (~20MB unpacked) — license obligation, ships with every
  Electron app; it compresses well in the AppImage. Leave it.
- `icudtl.dat`, `*.pak`, `libEGL/libGLESv2/swiftshader` — Chromium runtime, required.

## Layer 2: Renderer Bundle (Vite)

- `build.minify: 'terser'` is intentional (xterm const-enum miscompile under esbuild —
  see comment in `vite.config.ts`). Do not switch back to esbuild without re-testing
  DECRQM in nvim/htop.
- Sourcemaps stay off in production builds (`build.sourcemap` unset = off). Keep it that way.
- Shiki grammars are already code-split into lazy chunks; they only load when a
  language is highlighted. Do not import shiki languages statically.
- Fonts are the biggest static assets (~3.5MB: PureNerdFont 952K, Material Symbols 728K,
  4× IoskeleyMono ~470K each, plus 4 fontsource variable families). Candidates if more
  cuts are needed: drop unused IoskeleyMono weights, subset Material Symbols to used
  glyphs, audit whether all 5 font families are referenced. Measure usage before cutting.
- To find regressions: `npx vite-bundle-visualizer` after `vite build --mode electron`.

## Layer 3: Sidecar Binary (Rust)

Default `cargo build --release` ships debug symbols and skips LTO. Workspace
`Cargo.toml` profile:

```toml
[profile.release]
lto = "thin"
codegen-units = 1
strip = "symbols"
```

- `strip = "symbols"` is the big one (typically 30–50% off). It removes the full
  symbol table, not just DWARF debug info; use `strip = "debuginfo"` instead if
  you need symbol names for crash symbolication.
- `panic = "abort"` would shave more but changes unwind semantics under the tokio
  runtime — do not add without testing PTY crash/recovery paths.
- Verify behavior after profile changes: `cargo test --release` and the e2e terminal suite.

## Layer 4: Installer Compression

- AppImage uses squashfs; electron-builder's default is fine. The win comes from
  shipping fewer bytes (layers 1–3), not stronger compression.
- `compression: maximum` in electron-builder slows every build for single-digit-%
  gains — only worth it on release CI, never for local iteration.

## Layer 5: Runtime / Startup (from the source guideline, adapted)

- Defer non-critical work past first window paint (lazy-mount heavy panes, dynamic
  import for rarely-used features like the diff viewer's worker).
- React: memoize hot components, virtualize long lists (terminal scrollback and file
  trees already handle this via xterm/virtual rendering).
- Measure startup with `ELECTRON_ENABLE_LOGGING=1` + `console.timeStamp` /
  Chromium tracing, not gut feel.
- V8 snapshot / bytecode caching exist as advanced options; not worth complexity at
  current app size.

## Verification Checklist (before any optimization PR)

- [ ] Before/after size table: AppImage (or DMG), app.asar, sidecar binary
- [ ] `npx asar list` shows no node_modules (or only intentional re-includes)
- [ ] Any new native `.node` dependency is explicitly re-included via
      `electron-builder.yml` packaging configuration
- [ ] Packaged app launches; terminal, file explorer, editor, diff all open
- [ ] `npm run lint && npm run type-check && npm run test` green
- [ ] Findings Log updated below

## Findings Log

### 2026-06-12 — baseline audit (Linux x64)

| Artifact                   | Size   | Issue                                                           |
| -------------------------- | ------ | --------------------------------------------------------------- |
| AppImage                   | 150MB  | —                                                               |
| linux-unpacked total       | ~370MB | —                                                               |
| app.asar                   | 85MB   | ~86MB node_modules duplicated inside (renderer already bundled) |
| locales/                   | 47MB   | 55 locale paks shipped, UI is English-only                      |
| sidecar (vimeflow-backend) | 8.6MB  | no `[profile.release]` tuning (no strip/LTO)                    |
| dist/ (renderer)           | 17MB   | healthy; shiki lazy-split works; fonts ~3.5MB                   |
| LICENSES.chromium.html     | 20MB   | required, leave                                                 |

### 2026-06-12 — after Linux packaging fixes (`perf/electron-linux-packaging`)

Changes: `!node_modules/**` in `files`, `electronLanguages: [en-US]`,
`[profile.release]` lto=thin / codegen-units=1 / strip=symbols.

| Artifact                   | Before | After | Δ    |
| -------------------------- | ------ | ----- | ---- |
| AppImage                   | 150MB  | 113MB | −25% |
| linux-unpacked total       | ~370MB | 279MB | −25% |
| app.asar                   | 85MB   | 16MB  | −81% |
| locales/ (pak count)       | 55     | 1     | —    |
| sidecar (vimeflow-backend) | 8.6MB  | 6.7MB | −22% |

Verified: asar contains zero node_modules entries; packaged AppImage launches,
sidecar boots and restores a PTY session. Remaining unpacked bulk is the Electron
runtime itself (~200MB Chromium binary), which compresses into the AppImage.
macOS pass (DMG measurement + confirming the same yml fields apply) pending on the
`feat/electron-optimization` dev branch.
