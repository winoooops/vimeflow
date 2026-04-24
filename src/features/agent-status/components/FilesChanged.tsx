import type { ReactElement } from 'react'
import type { ChangedFile } from '../../diff/types'
import { CollapsibleSection } from './CollapsibleSection'

interface FilesChangedProps {
  files: ChangedFile[]
  loading?: boolean
  error: Error | null
  onRetry: () => void
  onSelect: (file: ChangedFile) => void
}

const statusMap: Record<
  ChangedFile['status'],
  { symbol: string; color: string; badge: string }
> = {
  added: { symbol: '+', color: 'text-success', badge: 'NEW' },
  modified: { symbol: '~', color: 'text-secondary', badge: 'EDIT' },
  deleted: { symbol: '-', color: 'text-error', badge: 'DEL' },
  renamed: { symbol: '→', color: 'text-secondary', badge: 'REN' },
  untracked: { symbol: '?', color: 'text-outline', badge: 'NEW' },
}

export const FilesChanged = ({
  files,
  loading = false,
  error,
  onRetry,
  onSelect,
}: FilesChangedProps): ReactElement => {
  const renderContent = (): ReactElement => {
    // Empty list states
    if (files.length === 0) {
      if (loading) {
        return (
          <div className="px-3 py-2 text-[10px] text-on-surface-variant">
            Loading...
          </div>
        )
      }

      if (error) {
        return (
          <div className="flex flex-col gap-2 px-3 py-2">
            <div className="text-[10px] text-error">
              Failed to load git status
            </div>
            <button
              onClick={onRetry}
              className="self-start text-[10px] text-primary hover:underline"
              type="button"
            >
              Retry
            </button>
          </div>
        )
      }

      return (
        <div className="px-3 py-2 text-[10px] text-on-surface-variant">
          No uncommitted changes
        </div>
      )
    }

    // Populated list with optional error banner
    return (
      <div className="flex flex-col">
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between border-b border-outline-variant bg-error-container px-3 py-1.5"
          >
            <span className="text-[9px] text-on-error-container">
              Stale data — refresh failed
            </span>
            <button
              onClick={onRetry}
              className="text-[9px] text-on-error-container hover:underline"
              type="button"
            >
              Retry
            </button>
          </div>
        )}
        <div className="flex flex-col gap-1 px-3 py-2">
          {files.map((file) => {
            const { symbol, color, badge } = statusMap[file.status]
            const rowKey = `${file.path}:${file.staged}`

            return (
              <button
                key={rowKey}
                onClick={(): void => {
                  onSelect(file)
                }}
                className="flex items-center gap-2 text-left hover:bg-surface-container-high"
                type="button"
              >
                <span className={`font-mono text-[10px] ${color}`}>
                  {symbol}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-on-surface-variant">
                  {file.path}
                </span>
                {typeof file.insertions === 'number' &&
                  typeof file.deletions === 'number' && (
                    <span className="text-[9px] text-outline">
                      +{file.insertions} / -{file.deletions}
                    </span>
                  )}
                {file.staged && (
                  <span className="text-[9px] text-secondary">STAGED</span>
                )}
                <span className="text-[9px] text-outline">{badge}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <CollapsibleSection
      title="Files Changed"
      count={files.length}
      defaultExpanded
    >
      {renderContent()}
    </CollapsibleSection>
  )
}
