import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import type { ToolJarEntry } from '../../types'
import { OdometerNumber } from './OdometerNumber'
import { ToolJarBreakdown } from './ToolJarBreakdown'

const TONE_EXP = 0.42

// A pill never wraps to a second line: the name is clipped to this width with an
// ellipsis, and the full name shows in a tooltip when (and only when) it clips.
const NAME_MAX_WIDTH = 150

// Cap pill width so a stranded pill grows only partway (filling in-row gaps with
// its neighbors) instead of stretching to the whole row — leftover slack sits
// at the row's end.
const PILL_MAX_WIDTH = 150

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
  const nameRef = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)
  const t = Math.pow(Math.min(1, data.count / Math.max(1, max)), TONE_EXP)

  // Only offer the tooltip when the name actually overflows its clamp.
  useLayoutEffect(() => {
    const el = nameRef.current
    if (!el) {
      return
    }
    const check = (): void => setClipped(el.scrollWidth > el.clientWidth + 1)
    check()
    const raf = requestAnimationFrame(check)

    return (): void => cancelAnimationFrame(raf)
  }, [data.name])

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
          flexGrow: 1,
          justifyContent: 'space-between',
          maxWidth: PILL_MAX_WIDTH,
          padding: '3px 5px 3px 9px',
          borderRadius: 999,
          cursor: 'default',
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
    <Tooltip content={data.name} placement="top" disabled={!clipped}>
      <span
        data-testid={`tool-tag-${data.name}`}
        className="tj-enter-pill inline-flex items-center"
        style={{
          gap: 6,
          flexGrow: 1,
          justifyContent: 'space-between',
          maxWidth: PILL_MAX_WIDTH,
          padding: '3px 5px 3px 9px',
          borderRadius: 999,
          background: `color-mix(in srgb, var(--color-primary-container) ${(7 + t * 16).toFixed(1)}%, transparent)`,
          border: `1px solid color-mix(in srgb, var(--color-primary-container) ${(12 + t * 20).toFixed(1)}%, transparent)`,
        }}
      >
        <span
          ref={nameRef}
          className="truncate font-mono"
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--color-on-surface-variant)',
            letterSpacing: '-0.01em',
            maxWidth: NAME_MAX_WIDTH,
            minWidth: 0,
          }}
        >
          {data.name}
        </span>
        <span
          className="inline-flex shrink-0 items-center justify-center"
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
    </Tooltip>
  )
}

interface ScrollHintProps {
  edge: 'top' | 'bottom'
  show: boolean
}

// A glassy fade + chevron pinned to the top/bottom edge of the scroll body,
// faded in only when there's more to scroll toward in that direction.
const ScrollHint = ({ edge, show }: ScrollHintProps): ReactElement => {
  const isTop = edge === 'top'
  // Frosted lens: a full-width glass band masked to a soft glow at the center
  // that fades away to both sides (and into the content) — no hard-edged chip.
  // The mask reads the alpha channel, so the token hue is irrelevant.
  const mask = `radial-gradient(72% 135% at 50% ${isTop ? '0%' : '100%'}, var(--color-on-surface) 16%, transparent 70%)`

  return (
    <div
      aria-hidden="true"
      data-testid={`tool-tags-scroll-hint-${edge}`}
      className="pointer-events-none absolute inset-x-0 grid place-items-center transition-opacity duration-200"
      style={{
        height: 30,
        top: isTop ? 0 : undefined,
        bottom: isTop ? undefined : 0,
        opacity: show ? 1 : 0,
        background:
          'color-mix(in srgb, var(--color-surface-container) 72%, transparent)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined leading-none"
        style={{ fontSize: 15, color: 'var(--color-on-surface-muted)' }}
      >
        {isTop ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
      </span>
    </div>
  )
}

export interface ToolTagsViewProps {
  /** Already-aggregated display entries (may include the synthetic "others"). */
  tools: ToolJarEntry[]
  max: number
  /** Fixed body height — content scrolls within it. */
  height: number
}

/**
 * The original representation: name + count pills that wrap and pack from the
 * top (`align-content: flex-start`), scrolling within a fixed-height body once
 * they exceed it. Glassy chevrons fade in at whichever edge has more to scroll.
 */
export const ToolTagsView = ({
  tools,
  max,
  height,
}: ToolTagsViewProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const [hovered, setHovered] = useState(false)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }

    const update = (): void =>
      setEdges({
        top: el.scrollTop > 1,
        bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      })
    update()
    const raf = requestAnimationFrame(update)
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)

    return (): void => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
    // Re-measure when the pill count changes (content reflows); counts ticking
    // within the same set keep the subscription so scroll stays live.
  }, [tools.length])

  // Tags read high → low by call count; the synthetic "others" stays last.
  const ordered = [...tools].sort((a, b) => {
    if (a.others) {
      return 1
    }
    if (b.others) {
      return -1
    }

    return b.count - a.count
  })

  return (
    <div
      className="relative"
      style={{ height }}
      onMouseEnter={(): void => setHovered(true)}
      onMouseLeave={(): void => setHovered(false)}
    >
      <div
        ref={scrollRef}
        data-testid="tool-tags-view"
        className="tj-no-scroll flex h-full flex-wrap overflow-x-hidden overflow-y-auto"
        style={{ gap: 6, alignContent: 'flex-start' }}
      >
        {ordered.map((tool) => (
          <ToolTag key={tool.name} data={tool} max={max} />
        ))}
      </div>
      <ScrollHint edge="top" show={hovered && edges.top} />
      <ScrollHint edge="bottom" show={hovered && edges.bottom} />
    </div>
  )
}
