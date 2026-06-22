import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useToolCallsView } from '../../hooks/useToolCallsView'
import { toolCallsToTools } from '../../utils/toolCallsToTools'
import { toolJarAggregate } from '../../utils/toolJarAggregate'
import { OdometerNumber } from './OdometerNumber'
import { ToolCallsViewSwitch } from './ToolCallsViewSwitch'
import { ToolJarVessel } from './ToolJarVessel'
import { ToolTagsView } from './ToolTagsView'

// Both views occupy this exact body height so toggling never shifts the panel.
const BODY_HEIGHT = 180

// Mask the packed jar's one-time first-paint cost behind a brief skeleton — only
// once the jar is busy enough to actually lag, and only the FIRST time it paints
// a busy jar. After that the jar stays mounted and warm, so later renders
// don't lag and never re-trigger it.
const SETTLE_MS = 320
const SKELETON_MIN_TILES = 6

// Ghost tiles over the recessed jar surface — fades out (outer) while the
// ghosts pulse (inner) so the two don't fight over `opacity`.
const ToolCallsBodySkeleton = ({ show }: { show: boolean }): ReactElement => (
  <div
    aria-hidden="true"
    data-testid="tool-calls-skeleton"
    className="pointer-events-none absolute inset-0 transition-opacity duration-300"
    style={{ opacity: show ? 1 : 0 }}
  >
    <div
      className="flex h-full w-full gap-1.5 overflow-hidden rounded-[11px] p-1.5 motion-safe:animate-pulse"
      style={{
        background:
          'color-mix(in srgb, var(--color-surface-container-lowest) 92%, transparent)',
      }}
    >
      {[3, 2, 1.4].map((grow, i) => (
        <div
          key={i}
          className="rounded-[8px]"
          style={{
            flex: grow,
            background:
              'color-mix(in srgb, var(--color-primary) 12%, transparent)',
          }}
        />
      ))}
    </div>
  </div>
)

export interface ToolCallsSectionProps {
  /** Authoritative total across all tools (summed count, not the display list). */
  total: number
  /** Live per-tool tallies, in stable insertion order. */
  byType: Record<string, number>
}

/**
 * The activity-panel Tool Calls card: a header (total · label · view switch)
 * over a fixed-height body that shows the Packed vessel or the Tags pills. A
 * non-editable status surface (default cursor, no text selection).
 */
export const ToolCallsSection = ({
  total,
  byType,
}: ToolCallsSectionProps): ReactElement => {
  const [view, setView] = useToolCallsView()
  const tools = toolCallsToTools(byType)
  const aggregated = toolJarAggregate(tools)
  // Max across the full (un-aggregated) list drives the tone ramp.
  const max = tools.reduce((peak, tool) => Math.max(peak, tool.count), 1)

  // Fire the skeleton exactly once — the first time the jar view has a busy
  // set of tiles to lay out. `settledRef` latches so re-fetches / view flips,
  // which reuse the already-laid-out jar, never bring it back.
  const [settling, setSettling] = useState(false)
  const settledRef = useRef(false)
  const heavy = view === 'jar' && aggregated.length >= SKELETON_MIN_TILES

  useEffect(() => {
    if (settledRef.current || !heavy) {
      return
    }
    setSettling(true)

    // Latch only once the settle actually completes — if this effect is torn
    // down first (StrictMode remount, or a view flip within SETTLE_MS), the
    // unlatched state lets it re-arm instead of stranding the overlay visible.
    const timer = window.setTimeout(() => {
      settledRef.current = true
      setSettling(false)
    }, SETTLE_MS)

    return (): void => window.clearTimeout(timer)
  }, [heavy])

  return (
    <section
      data-testid="tool-calls-section"
      className="cursor-default select-none overflow-hidden px-4 py-3.5"
      style={{
        borderRadius: 10,
        border:
          '1px solid color-mix(in srgb, var(--color-primary) 14%, transparent)',
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 6%, transparent), color-mix(in srgb, var(--color-surface-container-lowest) 50%, transparent))',
      }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <div className="flex items-baseline gap-1.5">
          <OdometerNumber
            value={total}
            fontSize={18}
            weight={700}
            color="var(--color-on-surface)"
          />
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface-muted">
            Tool calls
          </span>
        </div>
        <span className="flex-1" />
        <ToolCallsViewSwitch view={view} onChange={setView} />
      </div>

      <div className="relative" style={{ height: BODY_HEIGHT }}>
        {view === 'tags' ? (
          <ToolTagsView tools={aggregated} max={max} height={BODY_HEIGHT} />
        ) : (
          <>
            <ToolJarVessel tools={aggregated} max={max} height={BODY_HEIGHT} />
            <ToolCallsBodySkeleton show={settling} />
          </>
        )}
      </div>
    </section>
  )
}
