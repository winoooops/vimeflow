import { useEffect, useId, useRef, type ReactElement } from 'react'
import {
  resolveContextTone,
  tankChrome,
  type ReservoirTheme,
} from '../utils/contextTone'
import {
  useReservoirFlow,
  buildReservoirSurface,
  SWELL_PRESETS,
  type ReservoirSurfaceRefs,
  type ReservoirGeom,
  type SwellVariant,
} from '../hooks/useReservoirFlow'

export interface WaterTankProps {
  /** Context fill, 0-100. Drives the waterline height and the tone. */
  pct: number
  theme: ReservoirTheme
  /** Tank height in px (and SVG user units along Y). */
  height?: number
  /** When true (context unknown), render the empty tank with no water. */
  empty?: boolean
  /**
   * Hover-swell flavor — how the water rises toward the cursor. Three are
   * available (see SWELL_PRESETS); defaults to `soft-mound`. A future user
   * setting will choose this per preference — tracked in Linear VIM-128.
   */
  swell?: SwellVariant
}

// SVG is drawn in a fixed 248-wide user space and stretched to the container
// (preserveAspectRatio="none"). The water surface is redrawn each frame by
// useReservoirFlow: a calm drift plus a swell that rises toward the cursor on
// hover. The fill always closes flat to the floor, so it reads as real water.
const TANK_WIDTH = 248

/**
 * Y coordinate (in SVG user units) of the waterline for a given fill. A 2%
 * floor keeps the waterline visible even at very low fill. Exported for
 * geometry assertions.
 */
export const computeTankLevel = (pct: number, height: number): number =>
  (1 - Math.min(100, Math.max(2, pct)) / 100) * height

export const WaterTank = ({
  pct,
  theme,
  height = 104,
  empty = false,
  swell = 'soft-mound',
}: WaterTankProps): ReactElement => {
  const tone = resolveContextTone(pct, theme)
  const chrome = tankChrome(theme)
  const level = computeTankLevel(pct, height)
  const rid = useId().replace(/:/g, '')
  const fillId = `tank-fill-${rid}`
  const dryId = `tank-dry-${rid}`
  const clipId = `tank-clip-${rid}`

  // Resting surface for the first paint / reduced-motion; the hook takes over
  // the `d` attributes each frame once it starts. No swell at rest (amp 0).
  const resting = buildReservoirSurface(
    level,
    height,
    0,
    0,
    TANK_WIDTH / 2,
    SWELL_PRESETS[swell].width
  )

  const svgRef = useRef<SVGSVGElement>(null)
  const fillRef = useRef<SVGPathElement>(null)
  const meniscusRef = useRef<SVGPathElement>(null)
  const flowRefsRef = useRef<ReservoirSurfaceRefs | null>(null)
  const geomRef = useRef<ReservoirGeom | null>({ level, height })

  // The hook reads the live waterline each frame (eased) without restarting on
  // every pct change.
  geomRef.current = { level, height }

  useEffect(() => {
    flowRefsRef.current =
      fillRef.current !== null && meniscusRef.current !== null
        ? { fill: fillRef.current, meniscus: meniscusRef.current }
        : null
  }, [empty])

  useReservoirFlow(svgRef, flowRefsRef, geomRef, !empty, swell)

  return (
    <svg
      ref={svgRef}
      data-testid="water-tank"
      viewBox={`0 0 ${TANK_WIDTH} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', borderRadius: 11 }}
    >
      <defs>
        {/* depth gradient — luminous at the meniscus, settling translucent at the floor */}
        <linearGradient
          id={fillId}
          x1="0"
          y1={level}
          x2="0"
          y2={height}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={tone.fillTop} stopOpacity="0.95" />
          <stop offset="0.18" stopColor={tone.base} stopOpacity="0.85" />
          <stop offset="1" stopColor={tone.base} stopOpacity="0.42" />
        </linearGradient>
        {/* empty headroom — faint top-down shade so the dry tank reads as recessed */}
        <linearGradient
          id={dryId}
          x1="0"
          y1="0"
          x2="0"
          y2={height}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={chrome.dry} stopOpacity="0.55" />
          <stop offset="1" stopColor={chrome.dry} stopOpacity="0" />
        </linearGradient>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={TANK_WIDTH} height={height} rx="11" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        {/* tank floor */}
        <rect
          x="0"
          y="0"
          width={TANK_WIDTH}
          height={height}
          fill="color-mix(in srgb, var(--color-surface-container-lowest) 85%, transparent)"
        />
        <rect
          x="0"
          y="0"
          width={TANK_WIDTH}
          height={height}
          fill={`url(#${dryId})`}
        />

        {!empty && (
          <>
            <path
              ref={fillRef}
              data-testid="tank-water"
              d={resting.fill}
              fill={`url(#${fillId})`}
            />
            <path
              ref={meniscusRef}
              data-testid="tank-meniscus"
              d={resting.crest}
              fill="none"
              stroke={tone.meniscus}
              strokeWidth="1.5"
              strokeOpacity="0.9"
              style={{ filter: `drop-shadow(0 0 5px ${tone.base})` }}
            />
          </>
        )}

        {/* inner rim */}
        <rect
          x="0.5"
          y="0.5"
          width={TANK_WIDTH - 1}
          height={height - 1}
          rx="10.5"
          fill="none"
          stroke={chrome.rim}
          strokeWidth="1"
        />
      </g>
    </svg>
  )
}
