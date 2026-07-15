import { useRef } from 'react'
import type { FocusEvent, ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import {
  chordToAriaShortcut,
  chordToShortcutInput,
} from '@/features/keymap/displayKey'
import type { Keybindings } from '@/features/keymap/useKeybindings'
import type { ShortcutInput } from '@/lib/formatShortcut'
import { sumLines } from '../utils/sumLines'
import type { ChangedFile } from '../types'

export interface ChangedFilesListProps {
  bindingFor: Keybindings['bindingFor']
  files: ChangedFile[]
  selectedFile: { path: string; staged: boolean } | null
  onSelectFile: (file: ChangedFile) => void
  onAddFileComment?: (file: ChangedFile, anchor: HTMLElement) => void
  pinned?: boolean
  onTogglePinned?: () => void
}

interface ChangedFilesListSurfaceProps {
  bindingFor: Keybindings['bindingFor']
  files: ChangedFile[]
  selectedFile: { path: string; staged: boolean } | null
  pinned: boolean
  revealed: boolean
  onReveal: () => void
  onToggle: () => void
  onScheduleHide: () => void
  onTogglePinned: () => void
  onSelectFile: (file: ChangedFile) => void
  onAddFileComment: (file: ChangedFile, anchor: HTMLElement) => void
}

interface ChangedFileItemProps {
  commentAriaKeyshortcuts: string
  commentShortcut: ShortcutInput
  file: ChangedFile
  selected: boolean
  onSelectFile: (file: ChangedFile) => void
  onAddFileComment?: (file: ChangedFile, anchor: HTMLElement) => void
}

const getDisplayName = (path: string): string => {
  const trimmedPath = path.replace(/\/+$/u, '')

  if (trimmedPath.length === 0) {
    return path
  }

  return trimmedPath.split('/').pop()!
}

const getDirectory = (path: string): string => {
  const trimmedPath = path.replace(/\/+$/u, '')
  const parts = trimmedPath.split('/')

  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}

const statusTone = (
  status: ChangedFile['status']
): { glyph: string; label: string; className: string } => {
  switch (status) {
    case 'added':
      return { glyph: 'A', label: 'Added', className: 'text-success' }
    case 'deleted':
      return { glyph: 'D', label: 'Deleted', className: 'text-error' }
    case 'renamed':
      return { glyph: 'R', label: 'Renamed', className: 'text-primary' }
    case 'untracked':
      return { glyph: 'A', label: 'Untracked', className: 'text-success' }
    case 'modified':
      return { glyph: 'M', label: 'Modified', className: 'text-secondary' }
  }
}

const ChangedFileItem = ({
  commentAriaKeyshortcuts,
  commentShortcut,
  file,
  selected,
  onSelectFile,
  onAddFileComment = undefined,
}: ChangedFileItemProps): ReactElement => {
  const fileName = getDisplayName(file.path)
  const directory = getDirectory(file.path)
  const status = statusTone(file.status)
  const isDeleted = file.status === 'deleted'

  return (
    <div
      className={`flex items-center gap-2 rounded-md px-[9px] py-[7px] text-left transition-colors ${
        selected ? 'bg-primary/15' : 'hover:bg-surface-container-high/60'
      }`}
    >
      <button
        onClick={(): void => onSelectFile(file)}
        aria-current={selected ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className={`w-3.5 shrink-0 text-center font-mono text-[10.5px] font-extrabold leading-none ${status.className}`}
          aria-label={status.label}
        >
          {status.glyph}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate font-mono text-xs ${
              selected ? 'text-primary' : 'text-on-surface'
            } ${isDeleted ? 'line-through decoration-error/50' : ''}`}
          >
            {fileName}
          </span>
          {directory.length > 0 ? (
            <span className="mt-px block truncate font-mono text-[9.5px] text-on-surface-variant/70">
              {directory}
            </span>
          ) : null}
        </span>
        <div className="flex shrink-0 items-center gap-1.5 font-code text-[10px]">
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
          shortcut={commentShortcut}
          aria-keyshortcuts={commentAriaKeyshortcuts}
          onClick={(event): void => onAddFileComment(file, event.currentTarget)}
        />
      ) : null}
    </div>
  )
}

interface ChangedFilesEdgeHintProps {
  ariaKeyshortcuts: string
  count: number
  revealed: boolean
  onReveal: () => void
  onToggle: () => void
  onScheduleHide: () => void
}

const ChangedFilesEdgeHint = ({
  ariaKeyshortcuts,
  count,
  revealed,
  onReveal,
  onToggle,
  onScheduleHide,
}: ChangedFilesEdgeHintProps): ReactElement => {
  const previewRevealRef = useRef(false)

  const handlePreviewReveal = (): void => {
    if (!revealed) {
      previewRevealRef.current = true
    }

    onReveal()
  }

  const handleActivate = (): void => {
    if (!revealed || previewRevealRef.current) {
      previewRevealRef.current = false
      onReveal()

      return
    }

    onToggle()
  }

  const handleScheduleHide = (): void => {
    previewRevealRef.current = false
    onScheduleHide()
  }

  return (
    <button
      type="button"
      aria-label={`${revealed ? 'Hide' : 'Show'} changed files (${count})`}
      aria-keyshortcuts={ariaKeyshortcuts}
      aria-expanded={revealed}
      data-testid="changed-files-edge-hint"
      className="absolute left-0 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-r-xl border border-l-0 border-outline-variant/25 bg-surface-container-high/70 px-1.5 py-2 text-on-surface shadow-xl backdrop-blur-[14px] backdrop-saturate-150 transition-all duration-200 hover:bg-surface-container-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      onClick={handleActivate}
      onFocus={handlePreviewReveal}
      onMouseEnter={handlePreviewReveal}
      onMouseLeave={handleScheduleHide}
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[17px] leading-none"
      >
        chevron_right
      </span>
      <span className="rounded-full bg-primary/20 px-1.5 py-px font-mono text-[9.5px] font-extrabold text-primary">
        {count}
      </span>
    </button>
  )
}

/**
 * ChangedFilesList component for the diff view sidebar.
 * Displays all files with git changes, sorted by status.
 */
export const ChangedFilesList = ({
  bindingFor,
  files,
  selectedFile,
  onSelectFile,
  onAddFileComment = undefined,
  pinned = false,
  onTogglePinned = undefined,
}: ChangedFilesListProps): ReactElement => {
  const totals = sumLines(files)
  const commentShortcut = bindingFor('diff-comment-file')
  const pinShortcut = bindingFor('diff-files-pin')
  const commentShortcutInput = chordToShortcutInput(commentShortcut)
  const commentAriaKeyshortcuts = chordToAriaShortcut(commentShortcut)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant/25 px-3 py-2.5">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant">
          Changed files
        </h2>
        <span className="rounded-full bg-primary/15 px-1.5 py-px font-mono text-[10px] font-bold text-primary">
          {files.length}
        </span>
        <span className="flex-1" />
        {onTogglePinned !== undefined ? (
          <IconButton
            icon={pinned ? 'keep' : 'push_pin'}
            label={pinned ? 'Unpin changed files' : 'Pin changed files'}
            pressed={pinned}
            size="sm"
            shortcut={chordToShortcutInput(pinShortcut)}
            aria-keyshortcuts={chordToAriaShortcut(pinShortcut)}
            onClick={onTogglePinned}
            className="text-on-surface-variant hover:text-primary"
          />
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 py-1.5">
        {files.map((file) => (
          <ChangedFileItem
            key={`${file.path}:${file.staged}`}
            commentAriaKeyshortcuts={commentAriaKeyshortcuts}
            commentShortcut={commentShortcutInput}
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

      <div className="flex shrink-0 items-center gap-2 border-t border-outline-variant/25 px-3.5 py-2 font-mono text-[10px] text-on-surface-variant">
        <span className="text-vcs-added">+{totals.added}</span>
        <span className="text-vcs-deleted">-{totals.removed}</span>
        <span className="flex-1" />
        <span>{files.length} files</span>
      </div>
    </div>
  )
}

export const ChangedFilesListSurface = ({
  bindingFor,
  files,
  selectedFile,
  pinned,
  revealed,
  onReveal,
  onToggle,
  onScheduleHide,
  onTogglePinned,
  onSelectFile,
  onAddFileComment,
}: ChangedFilesListSurfaceProps): ReactElement => {
  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const nextTarget = event.relatedTarget

    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return
    }

    onScheduleHide()
  }

  const list = (
    <ChangedFilesList
      bindingFor={bindingFor}
      files={files}
      selectedFile={selectedFile}
      pinned={pinned}
      onTogglePinned={onTogglePinned}
      onSelectFile={onSelectFile}
      onAddFileComment={onAddFileComment}
    />
  )

  if (pinned) {
    return (
      <div
        data-testid="changed-files-pane"
        className="h-full w-64 shrink-0 overflow-hidden border-r border-outline-variant/30 bg-surface-container-high/85"
      >
        {list}
      </div>
    )
  }

  return (
    <div className="contents" onBlur={handleBlur}>
      <ChangedFilesEdgeHint
        ariaKeyshortcuts={chordToAriaShortcut(bindingFor('diff-files-toggle'))}
        count={files.length}
        revealed={revealed}
        onReveal={onReveal}
        onToggle={onToggle}
        onScheduleHide={onScheduleHide}
      />
      {revealed ? (
        <div
          data-testid="changed-files-pane"
          className="absolute bottom-2.5 left-2.5 top-2.5 z-40 w-64 overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-high/85 shadow-2xl backdrop-blur-[34px] backdrop-brightness-110 backdrop-saturate-[180%] motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-out"
          onMouseEnter={onReveal}
          onMouseLeave={onScheduleHide}
        >
          {list}
        </div>
      ) : null}
    </div>
  )
}
