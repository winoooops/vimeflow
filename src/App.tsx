import type { ReactElement } from 'react'
import { CommandPalette } from './features/command-palette/CommandPalette'

const App = (): ReactElement => (
  // Workspace layout will be added here in feature #16
  <>
    <div className="h-screen w-screen bg-surface flex items-center justify-center">
      <div className="text-on-surface-variant text-center">
        <h1 className="text-2xl font-headline mb-2">
          Vimeflow Workspace (Phase 2)
        </h1>
        <p className="text-sm">
          Workspace layout components will be added next
        </p>
      </div>
    </div>
    <CommandPalette />
  </>
)

export default App
