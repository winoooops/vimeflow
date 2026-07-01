import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import type { ChangedFile } from '../types'

export interface ChangedFilesListProps {
  files: ChangedFile[]
  selectedFile: { path: string; staged: boolean } | null
  onSelectFile: (file: ChangedFile) => void
  onAddFileComment?: (file: ChangedFile) => void
}

interface ChangedFileItemProps {
  file: ChangedFile
  selected: boolean
  onSelectFile: (file: ChangedFile) => void
  onAddFileComment?: (file: ChangedFile) => void
}

const getDisplayName = (path: string): string => {
  const trimmedPath = path.replace(/\/+$/u, '')

  if (trimmedPath.length === 0) {
    return path
  }

  return trimmedPath.split('/').pop()!
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

const ChangedFileItem = ({
  file,
  selected,
  onSelectFile,
  onAddFileComment = undefined,
}: ChangedFileItemProps): ReactElement => {
  const fileName = getDisplayName(file.path)
  const icon = getFileIcon(fileName)

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
        selected
          ? 'bg-surface-container-highest/40'
          : 'hover:bg-surface-container-highest/20'
      }`}
    >
      <button
        onClick={(): void => onSelectFile(file)}
        className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
          selected ? 'bg-surface-container-highest/40' : ''
        }`}
      >
        <span
          className="material-symbols-outlined text-[1.25rem] text-on-surface-variant"
          role="img"
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate font-label text-sm text-on-surface">
          {fileName}
        </span>
        <div className="flex items-center gap-2 font-code text-xs">
          {(file.insertions ?? 0) > 0 && (
            <span className="text-vcs-added">+{file.insertions}</span>
          )}
          {(file.deletions ?? 0) > 0 && (
            <span className="text-vcs-deleted">-{file.deletions}</span>
          )}
        </div>
      </button>
      {onAddFileComment !== undefined ? (
        <IconButton
          icon="add_comment"
          label={`Comment on file ${fileName}`}
          size="sm"
          shortcut={['Shift', 'I']}
          onClick={(): void => onAddFileComment(file)}
        />
      ) : null}
    </div>
  )
}

/**
 * ChangedFilesList component for the diff view sidebar.
 * Displays all files with git changes, sorted by status.
 */
export const ChangedFilesList = ({
  files,
  selectedFile,
  onSelectFile,
  onAddFileComment = undefined,
}: ChangedFilesListProps): ReactElement => (
  <div className="flex h-full flex-col p-4">
    {/* Header — stays fixed */}
    <h2 className="mb-3 shrink-0 font-label text-[0.7rem] font-bold uppercase tracking-wider text-primary-container">
      Changed Files
      <span className="ml-2 text-on-surface-variant">{files.length}</span>
    </h2>

    {/* File List — scrollable with thin scrollbar */}
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
      {files.map((file) => (
        <ChangedFileItem
          key={`${file.path}:${file.staged}`}
          file={file}
          selected={
            selectedFile?.path === file.path &&
            selectedFile.staged === file.staged
          }
          onSelectFile={onSelectFile}
          onAddFileComment={onAddFileComment}
        />
      ))}
    </div>
  </div>
)
