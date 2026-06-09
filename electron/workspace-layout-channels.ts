// Channel names for the renderer<->main workspace-layout surface (spec §3.2).
// These are Electron preload channels, NOT the renderer->Rust allowlist in
// backend-methods.ts. Main is the single assembler/writer; the renderer pushes
// a shape-only DTO and triggers restore through these channels.

// renderer -> main (invoke): push the latest shape-only session DTO.
export const WORKSPACE_LAYOUT_PUSH_SHAPE = 'workspace-layout:push-shape'

// renderer -> main (invoke): load the durable store for restore, carrying the
// active project context; resolves to the shape (tabs/history stay main-side).
export const WORKSPACE_LAYOUT_LOAD_FOR_RESTORE =
  'workspace-layout:load-for-restore'

// main -> renderer (send): ask the renderer for one fresh shape push during the
// window-close flush; the renderer answers via WORKSPACE_LAYOUT_PUSH_SHAPE.
export const WORKSPACE_LAYOUT_REQUEST_FINAL_SHAPE =
  'workspace-layout:request-final-shape'

// renderer -> main (invoke): bracket a restore so the writer suppresses writes
// until every restore pane has settled.
export const WORKSPACE_LAYOUT_BEGIN_HYDRATION =
  'workspace-layout:begin-hydration'

export const WORKSPACE_LAYOUT_END_HYDRATION = 'workspace-layout:end-hydration'
