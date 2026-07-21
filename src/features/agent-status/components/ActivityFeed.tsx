import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { ActivityEvent } from './ActivityEvent'
import { CollapsibleSection } from './CollapsibleSection'
import type { ChangedFile } from '../../diff/types'
import type { ActivityEvent as ActivityEventType } from '../types/activityEvent'
import { matchChangedFile } from '../utils/matchChangedFile'

interface ActivityFeedProps {
  events: ActivityEventType[]
  changedFiles?: ChangedFile[]
  cwd?: string
  onOpenDiff?: (file: ChangedFile) => void
  showDiffShortcut?: string
  showDiffAriaShortcut?: string
  matchesShowDiffShortcut?: (event: globalThis.KeyboardEvent) => boolean
}

const TICK_MS = 1000
// Number of most-recent events rendered before the 'show more' control
// kicks in. Keeps the panel compact by default while letting users reach
// further back into the session without leaving the feed.
const VISIBLE_WHEN_COLLAPSED = 10

export const ActivityFeed = ({
  events,
  changedFiles = [],
  cwd = '',
  onOpenDiff = undefined,
  showDiffShortcut = undefined,
  showDiffAriaShortcut = undefined,
  matchesShowDiffShortcut = undefined,
}: ActivityFeedProps): ReactElement => {
  const [now, setNow] = useState<Date>(() => new Date())
  const [showAll, setShowAll] = useState<boolean>(false)
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const eventRefs = useRef<Map<string, HTMLElement>>(new Map())

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

  const visible = useMemo(
    () => (showAll ? events : events.slice(0, VISIBLE_WHEN_COLLAPSED)),
    [events, showAll]
  )

  const activeVisibleEventId =
    activeEventId !== null &&
    visible.some((event) => event.id === activeEventId)
      ? activeEventId
      : (visible[0]?.id ?? null)

  useEffect(() => {
    setActiveEventId((current) => {
      if (visible.length === 0) {
        return null
      }

      return current !== null && visible.some((event) => event.id === current)
        ? current
        : visible[0].id
    })
  }, [visible])

  const handleEventKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, index: number): void => {
      let nextIndex: number | null = null
      const lastIndex = visible.length - 1

      if (event.key === 'ArrowDown') {
        nextIndex = Math.min(index + 1, lastIndex)
      } else if (event.key === 'ArrowUp') {
        nextIndex = Math.max(index - 1, 0)
      } else if (event.key === 'Home') {
        nextIndex = 0
      } else if (event.key === 'End') {
        nextIndex = lastIndex
      }

      if (nextIndex === null) {
        return
      }

      event.preventDefault()

      if (nextIndex === index) {
        return
      }

      const nextEvent = visible[nextIndex]

      setActiveEventId(nextEvent.id)
      eventRefs.current.get(nextEvent.id)?.focus()
    },
    [visible]
  )

  return (
    <CollapsibleSection title="Traces" count={events.length} defaultExpanded>
      {events.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No traces yet</p>
      ) : (
        <>
          <div role="feed" aria-label="Agent traces" className="relative">
            <div
              data-testid="activity-feed-rail"
              className="absolute left-3 top-0 bottom-0 w-px bg-outline-variant/40"
              aria-hidden="true"
            />
            <div className="relative flex flex-col">
              {visible.map((event, index) => {
                const changedFile =
                  event.kind === 'edit' || event.kind === 'write'
                    ? matchChangedFile(changedFiles, event.body, cwd)
                    : null

                return (
                  <ActivityEvent
                    key={event.id}
                    event={event}
                    now={now}
                    rowRef={(element): void => {
                      if (element) {
                        eventRefs.current.set(event.id, element)

                        return
                      }

                      eventRefs.current.delete(event.id)
                    }}
                    ariaPosInSet={index + 1}
                    ariaSetSize={events.length}
                    tabIndex={event.id === activeVisibleEventId ? 0 : -1}
                    onFocus={(): void => setActiveEventId(event.id)}
                    onKeyDown={(keyboardEvent): void =>
                      handleEventKeyDown(keyboardEvent, index)
                    }
                    onShowDiff={
                      changedFile === null || onOpenDiff === undefined
                        ? undefined
                        : (): void => onOpenDiff(changedFile)
                    }
                    showDiffShortcut={showDiffShortcut}
                    showDiffAriaShortcut={showDiffAriaShortcut}
                    matchesShowDiffShortcut={matchesShowDiffShortcut}
                  />
                )
              })}
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
