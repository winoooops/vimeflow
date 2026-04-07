import type { ReactElement } from 'react'
import { CommandPalette } from './features/command-palette/CommandPalette'
import { WorkspaceView } from './features/workspace/WorkspaceView'

const App = (): ReactElement => (
  <>
    <WorkspaceView />
    <CommandPalette />
  </>
)

export default App
