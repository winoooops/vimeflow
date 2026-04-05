import type { ReactElement } from 'react'
import type { ChangedFile, GitStatus } from '../types'

export interface ChangedFilesListProps {
  files: ChangedFile[]
  selectedPath: string | null
  onSelectFile: (path: string) => void
}

/**
 * Get the appropriate icon for a file based on its extension.
 */
const getFileIcon = (filename: string): string => {
  const extension = filename.split('.').pop()?.toLowerCase()

  switch (extension) {
    case 'tsx':
    case 'ts':
    case 'jsx':
    case 'js':
      return 'code'
    case 'json':
      return 'data_object'
    case 'rs':
      return 'code_blocks'
    case 'md':
      return 'description'
    case 'css':
    case 'scss':
      return 'palette'
    case 'txt':
      return 'draft'
    default:
      return 'draft'
  }
}

/**
 * Sort changed files by status: M (modified) first, then A (added), then D (deleted).
 */
const sortFilesByStatus = (files: ChangedFile[]): ChangedFile[] => {
  const statusOrder: Record<GitStatus, number> = {
    M: 0,
    A: 1,
    D: 2,
    U: 3,
  }

  return [...files].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status]
  )
}

/**
 * ChangedFilesList component for the diff view sidebar.
 * Displays all files with git changes, sorted by status.
 */
export const ChangedFilesList = ({
  files,
  selectedPath,
  onSelectFile,
}: ChangedFilesListProps): ReactElement => {
  const sortedFiles = sortFilesByStatus(files)

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Header */}
      <h2 className="font-label text-[0.7rem] font-bold uppercase tracking-wider text-primary-container">
        CHANGED FILES
      </h2>

      {/* File List */}
      <div className="flex flex-col gap-1">
        {sortedFiles.map((file) => {
          const isActive = file.path === selectedPath
          const fileName = file.path.split('/').pop() ?? file.path
          const icon = getFileIcon(fileName)

          return (
            <button
              key={file.path}
              onClick={(): void => onSelectFile(file.path)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                isActive
                  ? 'bg-surface-container-highest/40'
                  : 'hover:bg-surface-container-highest/20'
              }`}
            >
              {/* File Icon */}
              <span
                className="material-symbols-outlined text-[1.25rem] text-on-surface-variant"
                role="img"
                aria-hidden="true"
              >
                {icon}
              </span>

              {/* File Name */}
              <span className="min-w-0 flex-1 truncate font-label text-sm text-on-surface">
                {fileName}
              </span>

              {/* Insertion/Deletion Counts */}
              <div className="flex items-center gap-2 font-code text-xs">
                {file.insertions > 0 && (
                  <span className="text-[#a6e3a1]">+{file.insertions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="text-[#f38ba8]">-{file.deletions}</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
