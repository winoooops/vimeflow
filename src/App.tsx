import type { ReactElement } from 'react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import { WorkspaceView } from './features/workspace/WorkspaceView'

// Pierre's worker entry is exposed as a dedicated package export so Vite
// bundles it via `new Worker(url, ...)` with the worker config in
// vite.config.ts. The provider is dev-mode-safe (its singleton handles HMR
// without leaking workers).
const workerFactory = (): Worker =>
  new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
    type: 'module',
  })

const poolOptions = {
  workerFactory,
  // poolSize defaults to 8 per WorkerPoolOptions; override only if profiling
  // shows otherwise.
}

const highlighterOptions = {
  // Singular `theme` per WorkerRenderingOptions (NOT plural `themes`).
  // v1 ships only the default; per-render theme switches lazy-load.
  theme: 'pierre-dark' as const,
}

const App = (): ReactElement => (
  <WorkerPoolContextProvider
    poolOptions={poolOptions}
    highlighterOptions={highlighterOptions}
  >
    <WorkspaceView />
  </WorkerPoolContextProvider>
)

export default App
