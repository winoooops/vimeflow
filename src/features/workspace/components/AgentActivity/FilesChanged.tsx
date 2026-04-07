import type { ReactElement } from 'react'
import { useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import type { FileChange } from '../../types'

interface FilesChangedProps {
  fileChanges: FileChange[]
}

const FilesChanged = ({ fileChanges }: FilesChangedProps): ReactElement => {
  const [isExpanded, setIsExpanded] = useState(true)

  const getChangeTypePrefix = (
    type: FileChange['type']
  ): { symbol: string; className: string } => {
    switch (type) {
      case 'new':
        return { symbol: '+', className: 'text-success' }
      case 'modified':
        return { symbol: '~', className: 'text-primary' }
      case 'deleted':
        return { symbol: '-', className: 'text-error' }
    }
  }

  const getLineDiffSummary = (change: FileChange): string => {
    const { linesAdded, linesRemoved } = change

    if (linesAdded === 0 && linesRemoved === 0) {
      return ''
    }

    if (linesAdded > 0 && linesRemoved > 0) {
      return `+${linesAdded} -${linesRemoved}`
    }

    if (linesAdded > 0) {
      return `+${linesAdded}`
    }

    return `-${linesRemoved}`
  }

  return (
    <CollapsibleSection
      title="Files Changed"
      count={fileChanges.length}
      isExpanded={isExpanded}
      onToggle={(): void => setIsExpanded(!isExpanded)}
    >
      <div data-testid="files-list" className="flex flex-col gap-2">
        {fileChanges.map((change) => {
          const { symbol, className } = getChangeTypePrefix(change.type)
          const diffSummary = getLineDiffSummary(change)

          return (
            <div
              key={change.id}
              data-testid="file-entry"
              className="flex items-center gap-2 font-label"
            >
              <span data-testid="change-prefix" className={className}>
                {symbol}
              </span>
              <span className="text-on-surface flex-1">{change.path}</span>
              {diffSummary && (
                <span className="text-on-surface/60">{diffSummary}</span>
              )}
            </div>
          )
        })}
      </div>
    </CollapsibleSection>
  )
}

export default FilesChanged
