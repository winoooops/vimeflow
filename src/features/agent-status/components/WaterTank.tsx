import { useEffect, useId, useRef, type ReactElement } from 'react'
import {
  resolveContextTone,
  tankChrome,
  type ReservoirTheme,
} from '../utils/contextTone'
import {
  useReservoirFlow,
  type ReservoirFlowRefs,
} from '../hooks/useReservoirFlow'

export interface WaterTankProps {
  /** Context fill, 0-100. Drives the waterline height and the tone. */
  pct: number
  theme: ReservoirTheme
  /** Tank height in px (and SVG user units along Y). */
  height?: number
  /** When true (context unknown), render the empty tank with no water. */
  empty?: boolean
}

// SVG is drawn in a fixed 248-wide user space and stretched to the container
// (preserveAspectRatio="none"). Each wave path spans 3x the tank width: the CSS
// keyframe (vf-tank-drift-*) drifts the outer group by exactly one tank
// (translateX(-33.333%) of the 3x path under transform-box: fill-box) for a
// calm, always-on, seamless loop, and a nested boost group adds an extra
// hover-driven drift via useReservoirFlow. Three tiles (not two) give the
// base + boost translate enough runway to never sample past the path's right
// edge. Reduced-motion disables both layers.
const TANK_WIDTH = 248
const WAVE_SPAN = TANK_WIDTH * 3
// Wavelengths that divide the tank width evenly so each wave tiles without a
// seam on loop (the handoff's back-wave length of 150 did not tile the 248px
// translate). The back wave reads as a distinct, slower parallax layer: one
// broad swell across the tank behind the front's two faster ripples.
const WAVELENGTH_FRONT = TANK_WIDTH / 2 // 124 — two ripples across the tank
const WAVELENGTH_BACK = TANK_WIDTH // 248 — one broad swell behind
// Wave amplitudes (user units, of a 104 tank). Tall enough that the calm drift
// reads as moving water rather than a flat fill — the front carries the bright
// meniscus crest, the back is a broader, taller swell behind it.
const AMP_FRONT = 5
const AMP_BACK = 7

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
}: WaterTankProps): ReactElement => {
  const tone = resolveContextTone(pct, theme)
  const chrome = tankChrome(theme)
  const level = computeTankLevel(pct, height)
  const rid = useId().replace(/:/g, '')
  const fillId = `tank-fill-${rid}`
  const dryId = `tank-dry-${rid}`
  const clipId = `tank-clip-${rid}`

  const svgRef = useRef<SVGSVGElement>(null)
  const frontRef = useRef<SVGGElement>(null)
  const backRef = useRef<SVGGElement>(null)
  const flowRefsRef = useRef<ReservoirFlowRefs | null>(null)

  useEffect(() => {
    flowRefsRef.current =
      frontRef.current !== null && backRef.current !== null
        ? { front: frontRef.current, back: backRef.current }
        : null
  }, [empty])

  useReservoirFlow(svgRef, flowRefsRef)

  const wavePath = (
    amplitude: number,
    phase: number,
    wavelength: number,
    close = true
  ): string => {
    const yAt = (x: number): number =>
      level + Math.sin((x / wavelength) * Math.PI * 2 + phase) * amplitude
    const points: string[] = []
    for (let x = 0; x < WAVE_SPAN; x += 6) {
      points.push(`${x === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yAt(x).toFixed(2)}`)
    }
    // Land the final point exactly on the span edge — a step of 6 doesn't
    // divide 496, so without this the closed fill jumps from x=492 straight to
    // the bottom corner, a slanted seam that scrolls into view on loop wrap.
    points.push(`L ${WAVE_SPAN} ${yAt(WAVE_SPAN).toFixed(2)}`)
    const d = points.join(' ')

    return close ? `${d} L ${WAVE_SPAN} ${height} L 0 ${height} Z` : d
  }

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
            {/* back wave — slow CSS drift; inner group takes the hover boost */}
            <g data-testid="tank-wave-back" className="vf-tank-drift-b">
              <g ref={backRef}>
                <path
                  d={wavePath(AMP_BACK, 0.9, WAVELENGTH_BACK)}
                  fill={`url(#${fillId})`}
                  opacity="0.5"
                />
              </g>
            </g>
            {/* front wave — the primary body + bright meniscus crest */}
            <g data-testid="tank-wave-front" className="vf-tank-drift-a">
              <g ref={frontRef}>
                <path
                  data-testid="tank-water"
                  d={wavePath(AMP_FRONT, 2.4, WAVELENGTH_FRONT)}
                  fill={`url(#${fillId})`}
                />
                <path
                  data-testid="tank-meniscus"
                  d={wavePath(AMP_FRONT, 2.4, WAVELENGTH_FRONT, false)}
                  fill="none"
                  stroke={tone.meniscus}
                  strokeWidth="1.5"
                  strokeOpacity="0.9"
                  style={{ filter: `drop-shadow(0 0 5px ${tone.base})` }}
                />
              </g>
            </g>
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
