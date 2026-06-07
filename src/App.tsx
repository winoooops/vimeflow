import type { ReactElement } from 'react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import { WorkspaceView } from './features/workspace/WorkspaceView'
import { InlineCommentDemo } from './features/diff/demo/InlineCommentDemo'

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

// Dev-only gate for the PR4 inline-comment gutter demo (spec §7). Launch with
// `npm run dev` then open `?demo=inline-comments`. Guarded by `import.meta.env.DEV`
// so it can never render in a production build.
const isInlineCommentDemo = (): boolean =>
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('demo') === 'inline-comments'

const App = (): ReactElement => (
  <WorkerPoolContextProvider
    poolOptions={poolOptions}
    highlighterOptions={highlighterOptions}
  >
    {isInlineCommentDemo() ? <InlineCommentDemo /> : <WorkspaceView />}
  </WorkerPoolContextProvider>
)

export default App
