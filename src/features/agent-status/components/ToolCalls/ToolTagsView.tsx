import { useRef, useState, type ReactElement } from 'react'
import type { ToolJarEntry } from '../../types'
import { OdometerNumber } from './OdometerNumber'
import { ToolJarBreakdown } from './ToolJarBreakdown'

const TONE_EXP = 0.42

interface TagProps {
  data: ToolJarEntry
  max: number
}

// One pill. Usage drives the accent tint so the heaviest hitter reads brightest;
// the count keeps the odometer roll. The "others" pill is neutral with a hover
// breakdown.
const ToolTag = ({ data, max }: TagProps): ReactElement => {
  const [hover, setHover] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const t = Math.pow(Math.min(1, data.count / Math.max(1, max)), TONE_EXP)

  if (data.others) {
    return (
      <span
        ref={ref}
        data-testid="tool-tag-others"
        onMouseEnter={(): void => setHover(true)}
        onMouseLeave={(): void => setHover(false)}
        className="tj-enter-pill inline-flex items-center"
        style={{
          gap: 6,
          padding: '3px 5px 3px 9px',
          borderRadius: 999,
          cursor: 'help',
          background:
            'color-mix(in srgb, var(--color-outline) 28%, transparent)',
          border:
            '1px solid color-mix(in srgb, var(--color-outline) 45%, transparent)',
        }}
      >
        <span
          className="font-mono"
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--color-on-surface-muted)',
            letterSpacing: '-0.01em',
          }}
        >
          others +{data.others.length}
        </span>
        <span
          className="inline-flex items-center justify-center"
          style={{
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 999,
            background:
              'color-mix(in srgb, var(--color-outline) 40%, transparent)',
          }}
        >
          <OdometerNumber
            value={data.count}
            fontSize={10.5}
            weight={700}
            color="var(--color-on-surface-variant)"
          />
        </span>
        {hover ? (
          <ToolJarBreakdown anchorRef={ref} items={data.others} />
        ) : null}
      </span>
    )
  }

  return (
    <span
      data-testid={`tool-tag-${data.name}`}
      className="tj-enter-pill inline-flex items-center"
      style={{
        gap: 6,
        padding: '3px 5px 3px 9px',
        borderRadius: 999,
        background: `color-mix(in srgb, var(--color-primary-container) ${(7 + t * 16).toFixed(1)}%, transparent)`,
        border: `1px solid color-mix(in srgb, var(--color-primary-container) ${(12 + t * 20).toFixed(1)}%, transparent)`,
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--color-on-surface-variant)',
          letterSpacing: '-0.01em',
        }}
      >
        {data.name}
      </span>
      <span
        className="inline-flex items-center justify-center"
        style={{
          minWidth: 16,
          height: 16,
          padding: '0 4px',
          borderRadius: 999,
          background: `color-mix(in srgb, var(--color-primary-container) ${(18 + t * 30).toFixed(1)}%, transparent)`,
        }}
      >
        <OdometerNumber
          value={data.count}
          fontSize={10.5}
          weight={700}
          color="var(--color-primary)"
        />
      </span>
    </span>
  )
}

export interface ToolTagsViewProps {
  /** Already-aggregated display entries (may include the synthetic "others"). */
  tools: ToolJarEntry[]
  max: number
}

/**
 * The original representation: name + count pills that wrap. Rows pack from the
 * top (`align-content: flex-start`) with a minimal gap, growing into the
 * fixed-height body box and scrolling only once they exceed it — so the content
 * is the max and the inter-row gap is the min, never stretched apart.
 */
export const ToolTagsView = ({
  tools,
  max,
}: ToolTagsViewProps): ReactElement => (
  <div
    data-testid="tool-tags-view"
    className="flex flex-wrap"
    style={{ gap: 6, alignContent: 'flex-start', minHeight: '100%' }}
  >
    {tools.map((tool) => (
      <ToolTag key={tool.name} data={tool} max={max} />
    ))}
  </div>
)
