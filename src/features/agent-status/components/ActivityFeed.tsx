import { useEffect, useState, type ReactElement } from 'react'
import { ActivityEvent } from './ActivityEvent'
import { CollapsibleSection } from './CollapsibleSection'
import type { ActivityEvent as ActivityEventType } from '../types/activityEvent'

interface ActivityFeedProps {
  events: ActivityEventType[]
}

const TICK_MS = 1000
// Number of most-recent events rendered before the 'show more' control
// kicks in. Keeps the panel compact by default while letting users reach
// further back into the session without leaving the feed.
const VISIBLE_WHEN_COLLAPSED = 10

export const ActivityFeed = ({ events }: ActivityFeedProps): ReactElement => {
  const [now, setNow] = useState<Date>(() => new Date())
  const [showAll, setShowAll] = useState<boolean>(false)

  // Two separate effects — combining them into one `[hasRunning, events]`
  // dep list resets the interval on every event arrival, which stalls the
  // live 'running Xs' counter when tools complete in quick succession
  // (parallel Read/Grep finishes under 1s each, new events keep killing
  // the prior setInterval before it ticks).
  //
  // Effect 1: refresh `now` whenever the events array changes so a
  // newly arrived completed event renders against the current clock
  // instead of whatever `now` was captured before the panel sat idle.
  // Also resets `showAll` when the feed drops to empty — the component
  // isn't remounted between agent sessions, so without this the next
  // session's 10+ events would surface `Show less` on first render.
  const hasRunning = events.some((e) => e.status === 'running')
  useEffect(() => {
    if (events.length === 0) {
      setShowAll(false)

      return
    }

    setNow(new Date())
  }, [events])

  // Effect 2: own the 1s tick's lifecycle — start it only while a
  // running event is in view, tear it down when none remain. Completed-
  // only and empty feeds don't re-render every second (minute-granularity
  // means the relative timestamps don't move for 60s anyway).
  useEffect(() => {
    if (!hasRunning) {
      return
    }
    const id = setInterval(() => setNow(new Date()), TICK_MS)

    return (): void => clearInterval(id)
  }, [hasRunning])

  const overflow = events.length - VISIBLE_WHEN_COLLAPSED
  const visible = showAll ? events : events.slice(0, VISIBLE_WHEN_COLLAPSED)

  return (
    <CollapsibleSection title="Activity" count={events.length} defaultExpanded>
      {events.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No activity yet</p>
      ) : (
        <>
          <div className="relative">
            <div
              data-testid="activity-feed-rail"
              className="absolute left-3 top-0 bottom-0 w-px bg-outline-variant/40"
              aria-hidden="true"
            />
            <div className="relative flex flex-col">
              {visible.map((event) => (
                <ActivityEvent key={event.id} event={event} now={now} />
              ))}
            </div>
          </div>

          {overflow > 0 && (
            <button
              type="button"
              onClick={(): void => setShowAll((prev) => !prev)}
              className="mt-1 w-full rounded-md py-1 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              {showAll
                ? 'Show less'
                : `+ ${overflow} earlier event${overflow === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      )}
    </CollapsibleSection>
  )
}
