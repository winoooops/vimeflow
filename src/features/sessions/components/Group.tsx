import { type ReactElement, type ReactNode } from 'react'
import { Reorder } from 'framer-motion'
import type { Session } from '../types'

export interface GroupHeaderProps {
  label: string
  headerAction?: ReactNode
}

const GroupHeader = ({
  label,
  headerAction = undefined,
}: GroupHeaderProps): ReactElement => (
  <div className="flex items-center justify-between pr-3">
    <h3
      data-testid={`session-group-${label.toLowerCase()}`}
      className="px-3 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-on-surface-variant/70"
    >
      {label}
    </h3>
    {headerAction}
  </div>
)

interface GroupBodyCommonProps {
  sessions: Session[]
  emptyState?: ReactNode
  children: ReactNode
}

export type GroupProps = GroupBodyCommonProps &
  (
    | { variant: 'active'; onReorder: (sessions: Session[]) => void }
    | { variant: 'recent'; onReorder?: never }
  )

const GroupBody = ({
  sessions,
  variant,
  emptyState = undefined,
  children,
  ...rest
}: GroupProps): ReactElement => {
  const showEmpty = sessions.length === 0
  const items = showEmpty ? emptyState : children

  const containerClass =
    variant === 'active' ? 'flex flex-col px-2' : 'flex flex-col px-2 pb-1'
  const containerTestId = variant === 'active' ? 'session-list' : 'recent-list'

  if (variant === 'active') {
    // TS doesn't narrow ...rest through the discriminant check, so we
    // must cast. Tying the cast to Extract<GroupProps, { variant: 'active' }>
    // keeps it tethered to the real union shape — if a third variant ever
    // adds an onReorder-like prop with a different signature, the cast
    // fails at this site rather than silently misapplying downstream.
    const { onReorder } = rest as Extract<GroupProps, { variant: 'active' }>

    return (
      <Reorder.Group
        axis="y"
        values={sessions}
        onReorder={onReorder}
        className={containerClass}
        data-testid={containerTestId}
      >
        {items}
      </Reorder.Group>
    )
  }

  return (
    <ul className={containerClass} data-testid={containerTestId}>
      {items}
    </ul>
  )
}

// Compound: `Group` is the body; `Group.Header` is the header row.
export const Group = Object.assign(GroupBody, { Header: GroupHeader })
