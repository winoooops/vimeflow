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
  <div
    hidden={hidden}
    className="flex min-h-0 flex-1 flex-col"
    data-testid="files-view"
  >
    <FileExplorer cwd={cwd} onFileSelect={onFileSelect} />
  </div>
)
