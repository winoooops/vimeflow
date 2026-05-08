import type { ReactElement } from 'react'
import type { FileNode } from '../../files/types'
import { FileExplorer } from './panels/FileExplorer'

export interface FilesViewProps {
  hidden?: boolean
  cwd: string
  onFileSelect: (file: FileNode) => void
}

export const FilesView = ({
  hidden = false,
  cwd,
  onFileSelect,
}: FilesViewProps): ReactElement => (
  // See SessionsView for why we use a conditional class instead of the HTML
  // `hidden` attribute (Tailwind v4 cascade-layer order).
  <div
    className={`min-h-0 flex-1 flex-col ${hidden ? 'hidden' : 'flex'}`}
    data-testid="files-view"
  >
    <FileExplorer cwd={cwd} onFileSelect={onFileSelect} />
  </div>
)
