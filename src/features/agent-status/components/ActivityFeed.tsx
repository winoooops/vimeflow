import { useEffect, useState, type ReactElement } from 'react'
import { ActivityEvent } from './ActivityEvent'
import type { ActivityEvent as ActivityEventType } from '../types/activityEvent'

interface ActivityFeedProps {
  events: ActivityEventType[]
}

const TICK_MS = 1000

export const ActivityFeed = ({ events }: ActivityFeedProps): ReactElement => {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)

    return (): void => clearInterval(id)
  }, [])

  return (
    <div className="border-t border-outline-variant/[0.08] px-5 py-3">
      <div className="mb-2">
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-outline">
          ACTIVITY
        </span>
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No activity yet</p>
      ) : (
        <div className="relative">
          <div
            data-testid="activity-feed-rail"
            className="absolute left-3 top-0 bottom-0 w-px bg-outline-variant/40"
            aria-hidden="true"
          />
          <div className="relative flex flex-col">
            {events.map((event) => (
              <ActivityEvent key={event.id} event={event} now={now} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
