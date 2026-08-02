# Third-Party Notices

This file inventories the licenses of third-party packages bundled into the Vimeflow desktop application (the AppImage produced by `npm run electron:build`).

## NPM dependencies

| Package                          | License      | Notes                                                                       |
| -------------------------------- | ------------ | --------------------------------------------------------------------------- |
| `@pierre/diffs`                  | Apache-2.0   | Diff rendering library. © Pierre Computer Company.                          |
| `@pierre/theme`                  | Apache-2.0   | Transitive theme assets used by `@pierre/diffs`. © Pierre Computer Company. |
| `@floating-ui/react`             | MIT          | Tooltip / popover positioning.                                              |
| `shiki`, `@shikijs/transformers` | MIT          | Syntax-highlight tokenizer used by `@pierre/diffs`.                         |
| `hast-util-to-html`              | MIT          | HAST → HTML serializer.                                                     |
| `lru_map`                        | MIT          | LRU cache used by `@pierre/diffs`.                                          |
| `diff`                           | BSD-3-Clause | jsdiff — diff algorithm used by `@pierre/diffs`.                            |

For the full transitive list, see `package-lock.json`. Apache-2.0 packages preserve their LICENSE / NOTICE files inside `node_modules/<package>/` during normal `npm install`; the AppImage build copies the relevant LICENSE files into the bundle.

## Bundled fonts

| Font          | License | Notes                                                                                                                                                                                                                |
| ------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ioskeley Mono | OFL-1.1 | UI / code monospace face. © 2025 Ahmed Hatem. Vendored woff2 under `src/assets/fonts/ioskeley/`; the full OFL text ships at `resources/licenses/IoskeleyMono-OFL.txt` (see `electron-builder.yml` `extraResources`). |

## Bundled native assets

| Asset                  | License | Notes                                                                                                                                                                                            |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ghostty cursor shaders | MIT     | Cursor effects by Sahaj Bhatt, bundled from `sahaj-b/ghostty-cursor-shaders` commit `0a274beac8b93ee6ce6b94402b7313a0417b8e38`; the license ships at `resources/ghostty-parent/shaders/LICENSE`. |

## Statically linked into `libghostty`

The macOS build links `libghostty` from
[`winoooops/libghostty-spm-shaders`](https://github.com/winoooops/libghostty-spm-shaders),
which keeps Ghostty's GLSL shader compiler so the cursor effects above can run.
That pulls two libraries into the shipped binary that upstream `libghostty-spm`
compiles out:

| Library     | License                                                | Notes                                                                                                                                    |
| ----------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| glslang     | BSD-3-Clause, BSD-2-Clause, MIT, Apache-2.0 (see file) | Khronos GLSL front end. Compiles the cursor shaders to SPIR-V at runtime. Notices vendored at `ThirdPartyLicenses/glslang/` in the fork. |
| SPIRV-Cross | Apache-2.0 (plus MIT, CC-BY-4.0, Khronos Free Use)     | Translates SPIR-V to Metal Shading Language. Notices vendored at `ThirdPartyLicenses/SPIRV-Cross/` in the fork.                          |

Both are statically linked, so their notices must travel with any redistributed
binary. The fork copies them from the exact dependency tarballs Ghostty pins —
not those projects' current `main` — so they match what is actually linked.

These apply only to the macOS native Ghostty build. A build made against
upstream `libghostty-spm`, or with `--no-custom-shaders`, contains neither.

## Rust dependencies

For the Rust sidecar (`vimeflow-backend`), see `Cargo.lock` and the `LICENSE` files in each crate's source. The sidecar depends only on MIT / Apache-2.0 / BSD-3-Clause crates as of this release.
