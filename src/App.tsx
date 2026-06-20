import type { ReactElement } from 'react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import { WorkspaceView } from './features/workspace/WorkspaceView'
import { InlineCommentDemo } from './features/diff/demo/InlineCommentDemo'
import { ReorderMotionDemo } from './features/sessions/demo/ReorderMotionDemo'
import { SettingsProvider } from './features/settings/SettingsProvider'
import { SettingsContent } from './features/settings/SettingsContent'
import { isMacPlatform } from './lib/formatShortcut'

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

const devDemoName = (): string | null =>
  import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('demo')
    : null

const renderDemo = (demoName: string | null): ReactElement => {
  if (demoName === 'inline-comments') {
    return <InlineCommentDemo />
  }

  if (demoName === 'session-reorder') {
    return <ReorderMotionDemo />
  }

  return <WorkspaceView />
}

const isSettingsWindow = (): boolean =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('window') === 'settings'

const SettingsWindowShell = (): ReactElement => {
  const reserveWindowControls = isMacPlatform()

  return (
    <SettingsProvider>
      <main
        aria-label="Settings"
        className="flex h-screen min-h-0 flex-col bg-surface text-on-surface"
      >
        {reserveWindowControls && (
          <div
            aria-hidden="true"
            className="vf-app-drag-region h-[44px] shrink-0"
            data-testid="settings-window-drag-region"
          />
        )}
        <div className="flex min-h-0 flex-1">
          <SettingsContent />
        </div>
      </main>
    </SettingsProvider>
  )
}

const App = (): ReactElement => {
  if (isSettingsWindow()) {
    return <SettingsWindowShell />
  }

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      <SettingsProvider>{renderDemo(devDemoName())}</SettingsProvider>
    </WorkerPoolContextProvider>
  )
}

export default App
