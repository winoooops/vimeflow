import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { Tooltip } from '@/components/Tooltip'
import type { ToolJarEntry } from '../../types'
import { toolJarTone, type ToolJarPalette } from '../../utils/toolJarTone'
import { OdometerNumber } from './OdometerNumber'
import { ToolJarBreakdown } from './ToolJarBreakdown'

// Break snake_case names at underscores so they can wrap between segments
// instead of overflowing as one long token.
const splitName = (name: string): ReactElement => (
  <>
    {name.split('_').map((part, i) => (
      <Fragment key={i}>
        {i > 0 ? '_' : ''}
        {i > 0 ? <wbr /> : null}
        {part}
      </Fragment>
    ))}
  </>
)

// Auto-fit re-measure schedule (ms). Fonts and layout settle asynchronously, so
// we remeasure at these delays plus on fonts.ready and on resize.
const FIT_DELAYS = [60, 200, 500, 1000, 1800] as const

// jsdom and older runtimes don't implement document.fonts; read it through a
// boundary so the "possibly undefined" type survives flow analysis.
const documentFonts = (): FontFaceSet | undefined => document.fonts

export interface ToolJarTileProps {
  data: ToolJarEntry
  x: number
  y: number
  w: number
  h: number
  max: number
  palette: ToolJarPalette
}

/**
 * One packed tile. Always shows the tool name + count; a uniform auto-fit scale
 * on the content guarantees the label never clips as the tile resizes. Content
 * is anchored top-left so a resize only extends empty space — the label never
 * shifts position. The "others" tile is neutral and reveals a hover breakdown.
 */
export const ToolJarTile = ({
  data,
  x,
  y,
  w,
  h,
  max,
  palette,
}: ToolJarTileProps): ReactElement => {
  const isOthers = Boolean(data.others)
  const [hover, setHover] = useState(false)
  const [scale, setScale] = useState(1)
  const tileRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const countDigits = String(data.count).length

  const m = Math.min(w, h)
  const nameFs = Math.max(8.5, Math.min(13, 8.5 + (m - 56) * 0.08))
  const countFs = Math.max(13, Math.min(30, 9 + m * 0.18))
  // Uniform tile color: tile size already encodes weight, so every tile renders
  // at the same (heaviest-hitter) tone instead of ramping its color by count.
  const tone = toolJarTone(max, max, palette)

  useLayoutEffect(() => {
    const tile = tileRef.current
    const inner = innerRef.current
    if (!tile || !inner) {
      return
    }
    let alive = true

    const measure = (): void => {
      if (!alive) {
        return
      }
      const cs = getComputedStyle(tile)

      const availW =
        tile.clientWidth -
        parseFloat(cs.paddingLeft) -
        parseFloat(cs.paddingRight)

      const availH =
        tile.clientHeight -
        parseFloat(cs.paddingTop) -
        parseFloat(cs.paddingBottom)

      const next = Math.min(
        1,
        availW / inner.scrollWidth,
        availH / inner.scrollHeight
      )
      const resolved = next > 0 && next < 0.999 ? next : 1
      setScale((prev) => (Math.abs(prev - resolved) < 0.004 ? prev : resolved))
    }
    measure()
    const ro = new ResizeObserver(() => requestAnimationFrame(measure))
    ro.observe(tile)
    ro.observe(inner)

    const timers = FIT_DELAYS.map((ms) =>
      window.setTimeout(() => requestAnimationFrame(measure), ms)
    )
    const fonts = documentFonts()
    if (fonts) {
      const remeasure = async (): Promise<void> => {
        await fonts.ready
        requestAnimationFrame(measure)
      }
      void remeasure()
    }

    return (): void => {
      alive = false
      ro.disconnect()
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [w, h, countDigits])

  const radius = Math.min(10, m * 0.16)

  const fill = isOthers
    ? 'linear-gradient(152deg, var(--color-surface-container-high), var(--color-surface-container-lowest))'
    : tone.fill
  const nameColor = isOthers ? 'var(--color-on-surface-variant)' : tone.text
  const countColor = isOthers ? 'var(--color-on-surface)' : tone.text

  const boxShadow = isOthers
    ? 'inset 0 1px 0 color-mix(in srgb, var(--color-on-surface) 10%, transparent), inset 0 -2px 7px color-mix(in srgb, var(--color-surface-container-lowest) 55%, transparent), 0 1px 4px color-mix(in srgb, var(--color-surface-container-lowest) 60%, transparent)'
    : 'inset 0 1px 0 color-mix(in srgb, var(--color-primary) 25%, transparent), inset 0 -2px 7px color-mix(in srgb, var(--color-surface-container-lowest) 55%, transparent), 0 1px 4px color-mix(in srgb, var(--color-surface-container-lowest) 60%, transparent)'

  return (
    <Tooltip
      content={data.name}
      placement="top"
      disabled={isOthers || data.name.length <= 7}
    >
      <div
        ref={tileRef}
        data-testid={`tool-jar-tile-${data.name}`}
        onMouseEnter={isOthers ? (): void => setHover(true) : undefined}
        onMouseLeave={isOthers ? (): void => setHover(false) : undefined}
        className="tj-enter tj-tile-move absolute flex items-start justify-start overflow-hidden"
        style={{
          left: x + 1.5,
          top: y + 1.5,
          width: Math.max(0, w - 3),
          height: Math.max(0, h - 3),
          borderRadius: radius,
          background: fill,
          boxShadow,
          cursor: 'default',
          zIndex: hover ? 3 : 1,
          padding: '5px 8px',
          outline:
            isOthers && hover
              ? '1px solid color-mix(in srgb, var(--color-primary) 50%, transparent)'
              : undefined,
        }}
      >
        <div
          ref={innerRef}
          className="flex flex-col items-start text-left"
          style={{
            width: '100%',
            gap: 3,
            transform: `scale(${scale})`,
            transformOrigin: 'left top',
          }}
        >
          <span
            className="font-mono"
            style={{
              fontWeight: 600,
              color: nameColor,
              fontSize: nameFs,
              lineHeight: 1,
              letterSpacing: '-0.02em',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
              maxWidth: '100%',
            }}
          >
            {isOthers ? 'others' : splitName(data.name)}
          </span>
          <div className="flex items-baseline" style={{ gap: 5 }}>
            <OdometerNumber
              value={data.count}
              fontSize={countFs}
              color={countColor}
            />
            {isOthers && data.others ? (
              <span
                className="font-mono"
                style={{
                  fontSize: Math.max(7.5, nameFs - 1.5),
                  color: 'var(--color-on-surface-muted)',
                }}
              >
                {data.others.length} tools
              </span>
            ) : null}
          </div>
        </div>
        {isOthers && hover && data.others ? (
          <ToolJarBreakdown anchorRef={tileRef} items={data.others} />
        ) : null}
      </div>
    </Tooltip>
  )
}
