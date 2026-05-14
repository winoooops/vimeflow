import type { BackendApi } from '../lib/backend'

declare global {
  interface Window {
    /**
     * Electron preload's contextBridge exposes the backend API here
     * starting in PR-D. Undefined during PR-C — the bridge in
     * `src/lib/backend.ts` falls back to the current Tauri transport in
     * that case. Tests fabricate this object to exercise the
     * production-target code path.
     */
    vimeflow?: BackendApi
  }
}

export {}
