import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { useTheme } from '@/theme/useTheme'
import type { ToolJarEntry } from '../../types'
import { packTiles } from '../../utils/squarify'
import { toolJarPalette } from '../../utils/toolJarTone'
import { ToolJarTile } from './ToolJarTile'

const PACK_EXP = 0.3
const PACK_MIN_AREA = 2600

export interface ToolJarVesselProps {
  /** Already-aggregated display entries (may include the synthetic "others"). */
  tools: ToolJarEntry[]
  max: number
  height: number
}

/**
 * The recessed tank. It measures its own pixel width (ResizeObserver) and packs
 * the entries edge-to-edge so the tiles fill it with no gaps. Renders nothing
 * until it has a width (e.g. in jsdom layout-less tests).
 */
export const ToolJarVessel = ({
  tools,
  max,
  height,
}: ToolJarVesselProps): ReactElement => {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const theme = useTheme()
  const palette = toolJarPalette(theme)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    const update = (): void => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)

    return (): void => ro.disconnect()
  }, [])

  // The recess shade must read dark in both themes; the always-dark token flips
  // (surface-container-lowest is light in light themes), so pick it by kind.
  const shadeToken =
    theme.kind === 'light'
      ? 'var(--color-on-surface)'
      : 'var(--color-surface-container-lowest)'
  const recessAlpha = theme.kind === 'light' ? 22 : 80
  const washAlpha = theme.kind === 'light' ? 12 : 45

  const cells =
    width > 0 ? packTiles(tools, width, height, PACK_EXP, PACK_MIN_AREA) : []

  return (
    <div
      ref={ref}
      data-testid="tool-jar-vessel"
      className="relative w-full overflow-hidden rounded-[11px]"
      style={{
        height,
        background:
          'color-mix(in srgb, var(--color-surface-container-lowest) 92%, transparent)',
        boxShadow: `inset 0 2px 10px color-mix(in srgb, ${shadeToken} ${recessAlpha}%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--color-outline) 22%, transparent)`,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{
          background: `linear-gradient(to bottom, color-mix(in srgb, ${shadeToken} ${washAlpha}%, transparent), transparent 60%)`,
        }}
      />
      {cells.map((cell) => (
        <ToolJarTile
          key={cell.data.name}
          data={cell.data}
          x={cell.x}
          y={cell.y}
          w={cell.w}
          h={cell.h}
          max={max}
          palette={palette}
        />
      ))}
    </div>
  )
}
