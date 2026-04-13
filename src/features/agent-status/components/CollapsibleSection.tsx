import { useState, type ReactElement, type ReactNode } from 'react'

interface CollapsibleSectionProps {
  title: string
  count?: number | string | undefined
  defaultExpanded?: boolean | undefined
  children: ReactNode
}

export const CollapsibleSection = ({
  title,
  count = undefined,
  defaultExpanded = false,
  children,
}: CollapsibleSectionProps): ReactElement => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className="border-t border-outline-variant/[0.08]">
      <button
        onClick={(): void => setIsExpanded((prev) => !prev)}
        className="flex w-full cursor-pointer items-center gap-2 px-5 py-3"
        aria-expanded={isExpanded}
      >
        <span className="text-[10px] text-outline">
          {isExpanded ? '▾' : '▸'}
        </span>
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-outline">
          {title}
        </span>
        {count != null && (
          <span className="font-mono text-[10px] text-outline">{count}</span>
        )}
      </button>

      {isExpanded && <div className="px-5 pb-3">{children}</div>}
    </div>
  )
}
