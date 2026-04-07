import type { ReactElement, ReactNode } from 'react'

interface CollapsibleSectionProps {
  title: string
  count: number
  isExpanded?: boolean
  onToggle: () => void
  children: ReactNode
}

const CollapsibleSection = ({
  title,
  count,
  isExpanded = false,
  onToggle,
  children,
}: CollapsibleSectionProps): ReactElement => (
  <div data-testid="collapsible-section" className="flex flex-col gap-2">
    <button
      onClick={onToggle}
      className="flex items-center gap-2 cursor-pointer hover:bg-surface-container/50 rounded-lg px-2 py-1.5 font-label"
    >
      <span className="text-on-surface/60">{isExpanded ? '▾' : '▸'}</span>
      <span className="text-on-surface">{title}</span>
      {count > 0 && <span className="text-on-surface/60">({count})</span>}
    </button>

    {isExpanded && (
      <div data-testid="section-content-wrapper" className="ml-4">
        {children}
      </div>
    )}
  </div>
)

export default CollapsibleSection
