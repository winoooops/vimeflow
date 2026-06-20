import type { ReactElement } from 'react'
import { useToolCallsView } from '../../hooks/useToolCallsView'
import { toolCallsToTools } from '../../utils/toolCallsToTools'
import { toolJarAggregate } from '../../utils/toolJarAggregate'
import { OdometerNumber } from './OdometerNumber'
import { ToolCallsViewSwitch } from './ToolCallsViewSwitch'
import { ToolJarVessel } from './ToolJarVessel'
import { ToolTagsView } from './ToolTagsView'

// Both views occupy this exact body height so toggling never shifts the panel.
const BODY_HEIGHT = 180

export interface ToolCallsSectionProps {
  /** Authoritative total across all tools (summed count, not the display list). */
  total: number
  /** Live per-tool tallies, in stable insertion order. */
  byType: Record<string, number>
}

/**
 * The activity-panel Tool Calls section: a header (label · total · view switch)
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

  return (
    <section
      data-testid="tool-calls-section"
      className="cursor-default select-none px-4 py-3.5"
      style={{
        borderBottom:
          '1px solid color-mix(in srgb, var(--color-outline) 18%, transparent)',
      }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-muted">
          Tool calls
        </span>
        <OdometerNumber
          value={total}
          fontSize={13}
          weight={700}
          color="var(--color-on-surface)"
        />
        <span className="flex-1" />
        <ToolCallsViewSwitch view={view} onChange={setView} />
      </div>

      {view === 'tags' ? (
        <div
          className="tj-no-scroll overflow-y-auto overflow-x-hidden"
          style={{ height: BODY_HEIGHT }}
        >
          <ToolTagsView tools={aggregated} max={max} />
        </div>
      ) : (
        <ToolJarVessel tools={aggregated} max={max} height={BODY_HEIGHT} />
      )}
    </section>
  )
}
