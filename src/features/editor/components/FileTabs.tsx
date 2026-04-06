import type { ReactElement } from 'react'
import type { EditorFile } from '../types'

interface FileTabsProps {
  files: EditorFile[]
  activeFileIndex: number
  onTabClick: (index: number) => void
  onTabClose: (index: number) => void
  onNewFile: () => void
}

export const FileTabs = ({
  files,
  activeFileIndex,
  onTabClick,
  onTabClose,
  onNewFile,
}: FileTabsProps): ReactElement => {
  const handleTabClick = (index: number): void => {
    onTabClick(index)
  }

  const handleCloseClick = (event: React.MouseEvent, index: number): void => {
    event.stopPropagation()
    onTabClose(index)
  }

  return (
    <div className="h-10 bg-surface-container-low flex items-center">
      <div className="flex h-full">
        {files.map((file, index) => {
          const isActive = index === activeFileIndex

          return (
            <div
              key={file.id}
              data-testid={`file-tab-${file.id}`}
              role="button"
              tabIndex={0}
              onClick={() => handleTabClick(index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleTabClick(index)
                }
              }}
              className={`
                flex items-center px-4 h-full transition-colors group cursor-pointer
                ${
                  isActive
                    ? 'bg-surface border-t-2 border-primary-container'
                    : 'border-r border-outline/10 hover:bg-surface-variant/20'
                }
              `}
            >
              <span className="material-symbols-outlined text-[16px] mr-2 text-primary">
                description
              </span>
              <span
                className={`text-xs font-medium ${
                  isActive
                    ? 'text-on-surface'
                    : 'text-on-surface-variant group-hover:text-on-surface'
                }`}
              >
                {file.name}
                {file.modified && <span className="ml-1 text-primary">●</span>}
              </span>
              <button
                onClick={(e) => handleCloseClick(e, index)}
                aria-label={`Close ${file.name}`}
                className={`
                  material-symbols-outlined text-[14px] ml-3 transition-colors cursor-pointer
                  ${
                    isActive
                      ? 'text-on-surface-variant hover:text-error'
                      : 'opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-error'
                  }
                `}
              >
                close
              </button>
            </div>
          )
        })}
        <button
          onClick={onNewFile}
          aria-label="New file"
          className="flex items-center justify-center px-3 h-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/20 transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
        </button>
      </div>
    </div>
  )
}
