import { useState } from 'react'
import type { ReactElement } from 'react'
import { ChangedFilesList } from '../../../diff/components/ChangedFilesList'
import type { ChangedFile } from '../../../diff/types'

// Mock changed files data for the diff panel
const mockChangedFiles: ChangedFile[] = [
  {
    path: 'src/components/NavBar.tsx',
    status: 'M',
    insertions: 12,
    deletions: 3,
    staged: false,
  },
  {
    path: 'src/utils/api-helper.rs',
    status: 'A',
    insertions: 45,
    deletions: 0,
    staged: false,
  },
  {
    path: 'tsconfig.json',
    status: 'D',
    insertions: 0,
    deletions: 28,
    staged: false,
  },
]

/**
 * DiffPanel displays git changed files in the sidebar context panel (260px width).
 * Shows files with git status badges (M/A/D) in a scrollable list.
 */
export const DiffPanel = (): ReactElement => {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="diff-panel"
    >
      <ChangedFilesList
        files={mockChangedFiles}
        selectedPath={selectedPath}
        onSelectFile={setSelectedPath}
      />
    </div>
  )
}
