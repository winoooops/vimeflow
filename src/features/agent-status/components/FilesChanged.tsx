import type { ReactElement } from 'react'
import { CollapsibleSection } from './CollapsibleSection'

export interface FileChangeItem {
  path: string
  type: 'new' | 'modified' | 'deleted'
}

interface FilesChangedProps {
  files: FileChangeItem[]
}

const prefixMap: Record<
  FileChangeItem['type'],
  { symbol: string; color: string; badge: string }
> = {
  new: { symbol: '+', color: 'text-success', badge: 'NEW' },
  modified: { symbol: '~', color: 'text-secondary', badge: 'EDIT' },
  deleted: { symbol: '-', color: 'text-error', badge: 'DEL' },
}

export const FilesChanged = ({ files }: FilesChangedProps): ReactElement => (
  <CollapsibleSection title="Files Changed" count={files.length}>
    <div className="flex flex-col gap-1">
      {files.map((file) => {
        const { symbol, color, badge } = prefixMap[file.type]

        return (
          <div key={file.path} className="flex items-center gap-2">
            <span className={`font-mono text-[10px] ${color}`}>{symbol}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-on-surface-variant">
              {file.path}
            </span>
            <span className="text-[9px] text-outline">{badge}</span>
          </div>
        )
      })}
    </div>
  </CollapsibleSection>
)
