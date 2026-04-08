import type { ReactElement, ReactNode } from 'react'

interface CollapsibleSectionProps {
  title: string
  count: number
  customCountDisplay?: string
  isExpanded?: boolean
  onToggle: () => void
  children: ReactNode
}

const defaultProps = {
  customCountDisplay: undefined,
  isExpanded: false,
}

const CollapsibleSection = ({
  title,
  count,
  customCountDisplay = defaultProps.customCountDisplay,
  isExpanded = defaultProps.isExpanded,
  onToggle,
  children,
}: CollapsibleSectionProps): ReactElement => {
  const countText = customCountDisplay ?? (count > 0 ? `${count}` : null)

  return (
    <div data-testid="collapsible-section" className="flex flex-col gap-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 cursor-pointer hover:bg-surface-container/50 rounded-lg px-2 py-1.5 font-label"
      >
        <span className="text-on-surface/60">{isExpanded ? '▾' : '▸'}</span>
        <span className="text-on-surface">{title}</span>
        {countText && <span className="text-on-surface/60">({countText})</span>}
      </button>

      {isExpanded && (
        <div data-testid="section-content-wrapper" className="ml-4">
          {children}
        </div>
      )}
    </div>
  )
}

export default CollapsibleSection
