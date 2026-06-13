import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
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

const actionIdFor = (action: ContextMenuAction): ContextMenuActionId | null =>
  action.id ?? null

const displayNameFor = (node: FileNode): string => node.name.replace(/\/$/u, '')

interface PendingRename {
  node: FileNode
  fullPath: string
  value: string
}

interface PendingDelete {
  node: FileNode
  fullPath: string
}

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
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

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

  const executeRename = useCallback(
    async (pending: PendingRename): Promise<void> => {
      const displayName = displayNameFor(pending.node)
      const trimmedName = pending.value.trim()

      if (trimmedName.length === 0 || trimmedName === displayName) {
        setPendingRename(null)

        return
      }

      if (trimmedName.includes('/')) {
        setActionError(`Name must not contain "/": ${trimmedName}`)
        setPendingRename(null)

        return
      }

      try {
        await fileSystemService.renamePath(pending.fullPath, trimmedName)
        setPendingRename(null)
        refresh()
      } catch (caughtError: unknown) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : String(caughtError)
        setActionError(`Failed to rename ${displayName}: ${message}`)
        setPendingRename(null)
      }
    },
    [fileSystemService, refresh]
  )

  const executeDelete = useCallback(
    async (pending: PendingDelete): Promise<void> => {
      const displayName = displayNameFor(pending.node)

      try {
        await fileSystemService.deletePath(pending.fullPath)
        setPendingDelete(null)
        refresh()
      } catch (caughtError: unknown) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : String(caughtError)
        setActionError(`Failed to delete ${displayName}: ${message}`)
        setPendingDelete(null)
      }
    },
    [fileSystemService, refresh]
  )

  const startRename = useCallback((node: FileNode, fullPath: string): void => {
    setActionError(null)
    setPendingRename({
      node,
      fullPath,
      value: displayNameFor(node),
    })

    // Focus the input on the next tick so the DOM element is mounted.
    requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
  }, [])

  const startDelete = useCallback((node: FileNode, fullPath: string): void => {
    setActionError(null)
    setPendingDelete({ node, fullPath })
  }, [])

  const cancelRename = useCallback((): void => {
    setPendingRename(null)
  }, [])

  const cancelDelete = useCallback((): void => {
    setPendingDelete(null)
  }, [])

  const handleRenameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter' && pendingRename) {
        event.preventDefault()
        void executeRename(pendingRename)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancelRename()
      }
    },
    [pendingRename, executeRename, cancelRename]
  )

  const handleContextMenuAction = useCallback(
    (action: ContextMenuAction, node: FileNode, fullPath: string): void => {
      setActionError(null)

      const actionId = actionIdFor(action)

      if (actionId === 'rename') {
        startRename(node, fullPath)

        return
      }

      if (actionId === 'delete') {
        startDelete(node, fullPath)

        return
      }

      if (actionId === 'copy-path') {
        const clipboard = readClipboardWriter()

        if (typeof clipboard?.writeText !== 'function') {
          setActionError('Clipboard is unavailable')

          return
        }

        void (async (): Promise<void> => {
          try {
            await clipboard.writeText(fullPath)
          } catch (caughtError: unknown) {
            const message =
              caughtError instanceof Error
                ? caughtError.message
                : String(caughtError)
            setActionError(`Failed to copy path: ${message}`)
          }
        })()

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
    [startRename, startDelete, onFileSelect, onViewDiff]
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
          <div className="mb-2 flex items-center gap-2 rounded bg-error/10 px-2 py-1 font-mono text-xs text-error">
            <span className="flex-1">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="material-symbols-outlined shrink-0 text-sm hover:text-error/80"
              aria-label="Dismiss error"
            >
              close
            </button>
          </div>
        )}

        {pendingRename && (
          <div className="mb-2 flex items-center gap-2 rounded bg-surface px-2 py-1.5">
            <input
              ref={renameInputRef}
              type="text"
              value={pendingRename.value}
              onChange={(event) =>
                setPendingRename((current) =>
                  current ? { ...current, value: event.target.value } : null
                )
              }
              onKeyDown={handleRenameKeyDown}
              className="flex-1 rounded border border-on-surface/20 bg-base px-1.5 py-1 font-mono text-xs text-on-surface outline-none focus:border-secondary"
              aria-label="Rename file"
            />
            <button
              type="button"
              onClick={() => {
                void executeRename(pendingRename)
              }}
              className="material-symbols-outlined text-sm text-secondary hover:text-secondary/80"
              aria-label="Confirm rename"
            >
              check
            </button>
            <button
              type="button"
              onClick={cancelRename}
              className="material-symbols-outlined text-sm text-on-surface/50 hover:text-on-surface"
              aria-label="Cancel rename"
            >
              close
            </button>
          </div>
        )}

        {pendingDelete && (
          <div className="mb-2 flex items-center gap-2 rounded bg-error/10 px-2 py-1.5 font-mono text-xs text-error">
            <span className="flex-1">
              Delete <strong>{displayNameFor(pendingDelete.node)}</strong>?
            </span>
            <button
              type="button"
              onClick={() => {
                void executeDelete(pendingDelete)
              }}
              className="rounded bg-error/20 px-2 py-0.5 font-semibold hover:bg-error/30"
              aria-label="Confirm delete"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={cancelDelete}
              className="rounded px-2 py-0.5 hover:bg-error/20"
              aria-label="Cancel delete"
            >
              Cancel
            </button>
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
