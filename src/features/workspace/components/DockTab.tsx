import type { ReactElement, ReactNode } from 'react'

export type DockTabType = 'editor' | 'diff'

interface DockTabProps {
  tab: DockTabType
  onTabChange: (next: DockTabType) => void
  selectedFilePath: string | null
  collapseIconName:
    | 'expand_more'
    | 'expand_less'
    | 'chevron_left'
    | 'chevron_right'
  onClose: () => void
  /** Slot rendered between the tab strip spacer and the file-path/close cluster. */
  children?: ReactNode
}

const tabButtonClass = (active: boolean): string =>
  `flex items-center gap-1.5 font-mono text-[10.5px] h-[26px] px-[11px] rounded-md border transition-colors ${
    active
      ? 'bg-[rgba(226,199,255,0.08)] border-[rgba(203,166,247,0.3)] text-[#e2c7ff]'
      : 'bg-transparent border-transparent text-[#8a8299] hover:text-[#e2c7ff]'
  }`

const tabIconClass = (active: boolean): string =>
  `material-symbols-outlined text-[12px] ${
    active ? 'text-[#cba6f7]' : 'text-[#6c7086]'
  }`

export const DockTab = ({
  tab,
  onTabChange,
  selectedFilePath,
  collapseIconName,
  onClose,
  children = undefined,
}: DockTabProps): ReactElement => (
  <div className="flex h-[34px] items-center gap-1 border-b border-[rgba(74,68,79,0.25)] bg-[#0d0d1c] px-2">
    <div className="flex gap-1">
      <button
        type="button"
        aria-pressed={tab === 'editor'}
        onClick={() => onTabChange('editor')}
        className={tabButtonClass(tab === 'editor')}
        aria-label="Editor"
      >
        <span className={tabIconClass(tab === 'editor')} aria-hidden="true">
          code
        </span>
        <span>Editor</span>
      </button>

      <button
        type="button"
        aria-pressed={tab === 'diff'}
        onClick={() => onTabChange('diff')}
        className={tabButtonClass(tab === 'diff')}
        aria-label="Diff Viewer"
      >
        <span className={tabIconClass(tab === 'diff')} aria-hidden="true">
          difference
        </span>
        <span>Diff Viewer</span>
      </button>
    </div>

    <div className="flex-1" />

    {children}

    <div className="ml-2 flex items-center gap-3">
      <span
        className="font-mono text-[10px] text-outline"
        title={selectedFilePath ?? ''}
      >
        {selectedFilePath ? selectedFilePath.replace(/^~\//, '') : 'No file'}
      </span>
      <button
        type="button"
        aria-label="Collapse panel"
        onClick={onClose}
        className="grid h-6 w-6 cursor-pointer place-items-center rounded-[5px] bg-transparent text-[#8a8299] transition-colors hover:bg-white/5 hover:text-[#e2c7ff]"
      >
        <span
          className="material-symbols-outlined text-[14px]"
          aria-hidden="true"
        >
          {collapseIconName}
        </span>
      </button>
    </div>
  </div>
)
