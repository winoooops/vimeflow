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

## Rust dependencies

For the Rust sidecar (`vimeflow-backend`), see `Cargo.lock` and the `LICENSE` files in each crate's source. The sidecar depends only on MIT / Apache-2.0 / BSD-3-Clause crates as of this release.
