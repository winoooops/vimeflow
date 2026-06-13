import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import { FileTree } from '../../../files/components/FileTree'
import { contextMenuActions } from '../../../files/data/mockFileTree'
import { useFileTree } from '../../../files/hooks/useFileTree'
import {
  createFileSystemService,
  type IFileSystemService,
} from '../../../files/services/fileSystemService'
import type {
  ContextMenuAction,
  ContextMenuActionId,
  FileNode,
} from '../../../files/types'

export interface FileExplorerProps {
  cwd?: string
  onFileSelect?: (node: FileNode) => void
  onViewDiff?: (node: FileNode) => void
  fileSystemService?: IFileSystemService
}

interface ClipboardWriter {
  writeText?: (text: string) => Promise<void>
}

const readClipboardWriter = (): ClipboardWriter | null =>
  (navigator as { clipboard?: ClipboardWriter }).clipboard ?? null

const actionIdFor = (action: ContextMenuAction): ContextMenuActionId | null => {
  if (action.id) {
    return action.id
  }

  switch (action.label) {
    case 'Rename':
      return 'rename'
    case 'Delete':
      return 'delete'
    case 'Copy Path':
      return 'copy-path'
    case 'Open in Editor':
      return 'open-in-editor'
    case 'View Diff':
      return 'view-diff'
    default:
      return null
  }
}

const displayNameFor = (node: FileNode): string => node.name.replace(/\/$/u, '')

/**
 * FileExplorer displays the file tree in the sidebar.
 * Reads real files via Tauri, falls back to mock data in browser.
 * Click a folder to navigate into it. Use the back button or breadcrumb to go up.
 */
export const FileExplorer = ({
  cwd = '~',
  onFileSelect = undefined,
  onViewDiff = undefined,
  fileSystemService: providedFileSystemService = undefined,
}: FileExplorerProps): ReactElement => {
  const defaultFileSystemService = useMemo(() => createFileSystemService(), [])

  const fileSystemService =
    providedFileSystemService ?? defaultFileSystemService

  const [actionError, setActionError] = useState<string | null>(null)

  const {
    nodes,
    currentPath,
    isLoading,
    error,
    refresh,
    navigateTo,
    navigateUp,
  } = useFileTree(cwd, fileSystemService)

  const handleNodeSelect = useCallback(
    (node: FileNode, fullPath: string): void => {
      if (node.type === 'folder') {
        // Navigate into the folder — the `fullPath` already includes the ancestry.
        navigateTo(fullPath)
      } else {
        // File: emit with canonical full path as the id so consumers can read/save it.
        onFileSelect?.({ ...node, id: fullPath })
      }
    },
    [navigateTo, onFileSelect]
  )

  const runContextMenuAction = useCallback(
    async (
      action: ContextMenuAction,
      node: FileNode,
      fullPath: string
    ): Promise<void> => {
      setActionError(null)

      const actionId = actionIdFor(action)
      const displayName = displayNameFor(node)

      if (actionId === 'rename') {
        const nextName = window.prompt('Rename to', displayName)
        if (nextName === null) {
          return
        }

        const trimmedName = nextName.trim()
        if (trimmedName.length === 0 || trimmedName === displayName) {
          return
        }

        try {
          await fileSystemService.renamePath(fullPath, trimmedName)
          refresh()
        } catch (caughtError: unknown) {
          const message =
            caughtError instanceof Error
              ? caughtError.message
              : String(caughtError)
          setActionError(`Failed to rename ${displayName}: ${message}`)
        }

        return
      }

      if (actionId === 'delete') {
        const confirmed = window.confirm(`Delete ${displayName}?`)
        if (!confirmed) {
          return
        }

        try {
          await fileSystemService.deletePath(fullPath)
          refresh()
        } catch (caughtError: unknown) {
          const message =
            caughtError instanceof Error
              ? caughtError.message
              : String(caughtError)
          setActionError(`Failed to delete ${displayName}: ${message}`)
        }

        return
      }

      if (actionId === 'copy-path') {
        const clipboard = readClipboardWriter()

        if (typeof clipboard?.writeText !== 'function') {
          setActionError('Clipboard is unavailable')

          return
        }

        try {
          await clipboard.writeText(fullPath)
        } catch (caughtError: unknown) {
          const message =
            caughtError instanceof Error
              ? caughtError.message
              : String(caughtError)
          setActionError(`Failed to copy path: ${message}`)
        }

        return
      }

      if (actionId === 'open-in-editor') {
        if (node.type !== 'file') {
          setActionError('Only files can be opened in the editor')

          return
        }

        onFileSelect?.({ ...node, id: fullPath })

        return
      }

      if (actionId === 'view-diff') {
        if (node.type !== 'file') {
          setActionError('Only files can be opened in the diff viewer')

          return
        }

        onViewDiff?.({ ...node, id: fullPath })
      }
    },
    [fileSystemService, onFileSelect, onViewDiff, refresh]
  )

  const handleContextMenuAction = useCallback(
    (action: ContextMenuAction, node: FileNode, fullPath: string): void => {
      void runContextMenuAction(action, node, fullPath)
    },
    [runContextMenuAction]
  )

  // Display a short label for the current path
  const pathLabel =
    currentPath === '~'
      ? '~'
      : (currentPath.split('/').filter(Boolean).pop() ?? currentPath)

  const isRoot = currentPath === '~' || currentPath === '/'

  return (
    <div
      className="flex h-full min-h-0 flex-col px-4 pt-3"
      data-testid="file-explorer"
    >
      {/* Header */}
      <div className="mb-1 flex items-center gap-2">
        <span className="material-symbols-outlined text-base text-on-surface/50">
          folder_open
        </span>
        <h3 className="flex-1 font-label text-xs font-semibold uppercase tracking-wider text-on-surface/50">
          File Explorer
        </h3>
        <Tooltip content="Refresh">
          <button
            type="button"
            onClick={refresh}
            className="material-symbols-outlined text-sm text-on-surface/30 transition-colors hover:text-on-surface/60"
            aria-label="Refresh file tree"
          >
            refresh
          </button>
        </Tooltip>
      </div>

      {/* Path bar */}
      <div className="mb-1 flex items-center gap-1">
        {/* Wrapper span keeps the tooltip alive in the root state — disabled
            buttons swallow pointer events, so the span is the hover target. */}
        <Tooltip content="Parent directory">
          <span className="inline-flex">
            <button
              type="button"
              onClick={navigateUp}
              disabled={isRoot}
              className={`material-symbols-outlined shrink-0 rounded p-0.5 text-sm transition-colors ${
                isRoot
                  ? 'text-on-surface/20'
                  : 'text-on-surface/50 hover:bg-wash-subtle hover:text-on-surface'
              }`}
              aria-label="Go to parent directory"
            >
              arrow_upward
            </button>
          </span>
        </Tooltip>
        <Tooltip content={currentPath}>
          <span className="min-w-0 truncate font-mono text-xs text-on-surface/50">
            {pathLabel}
          </span>
        </Tooltip>
      </div>

      {/* Content — `min-h-0` is required so this `flex-1` child can shrink
          below the intrinsic height of its content. Without it, the
          `overflow-y-auto` never engages because the flex child's default
          `min-height: auto` forces the container to grow to fit the entire
          tree, which pushed the scrollbar offscreen and made `scrollIntoView`
          walk up to the wrong ancestor. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && (
          <div className="py-4 text-center font-mono text-xs text-on-surface/40">
            Loading...
          </div>
        )}
        {error && (
          <div className="py-4 text-center font-mono text-xs text-error">
            {error}
          </div>
        )}
        {actionError && (
          <div className="mb-2 rounded bg-error/10 px-2 py-1 font-mono text-xs text-error">
            {actionError}
          </div>
        )}
        {!isLoading && !error && (
          <FileTree
            nodes={nodes}
            contextMenuActions={contextMenuActions}
            rootPath={currentPath}
            onNodeSelect={handleNodeSelect}
            onContextMenuAction={handleContextMenuAction}
          />
        )}
      </div>
    </div>
  )
}
