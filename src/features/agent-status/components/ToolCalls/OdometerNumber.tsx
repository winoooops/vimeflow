import type { ReactElement } from 'react'

interface DigitProps {
  digit: number
  cell: number
}

// One place value: a 0–9 column clipped to a single cell, slid up to the
// current digit. The slide transition lives in `.tj-digit-roll` (reduced-motion
// gated in index.css).
const Digit = ({ digit, cell }: DigitProps): ReactElement => (
  <span
    style={{
      display: 'inline-block',
      height: cell,
      lineHeight: `${cell}px`,
      overflow: 'hidden',
      verticalAlign: 'top',
    }}
  >
    <span
      data-testid="odometer-roll"
      className="tj-digit-roll"
      style={{ display: 'block', transform: `translateY(${-digit * cell}px)` }}
    >
      {Array.from({ length: 10 }, (_, n) => (
        <span
          key={n}
          style={{ display: 'block', height: cell, textAlign: 'center' }}
        >
          {n}
        </span>
      ))}
    </span>
  </span>
)

export interface OdometerNumberProps {
  value: number
  fontSize: number
  /** Resolved color (token `var(--color-*)` or a computed tile tone). */
  color: string
  weight?: number
}

/**
 * A number whose digits roll like an odometer when the value changes. Each
 * place is a 0–9 column slid to its digit; digits are keyed from the right so
 * the units place stays put as the number gains a digit. `tabular-nums` keeps
 * widths uniform so nothing reflows mid-roll.
 */
export const OdometerNumber = ({
  value,
  fontSize,
  color,
  weight = 800,
}: OdometerNumberProps): ReactElement => {
  const cell = Math.round(fontSize * 1.02)
  const chars = String(value).split('')

  return (
    <span
      data-testid="odometer"
      className="font-display tabular-nums"
      style={{
        display: 'inline-flex',
        fontWeight: weight,
        color,
        fontSize,
        lineHeight: 1,
      }}
    >
      {chars.map((char, i) =>
        /\d/.test(char) ? (
          <Digit key={chars.length - 1 - i} digit={Number(char)} cell={cell} />
        ) : (
          <span
            key={`sep-${i}`}
            style={{
              display: 'inline-block',
              height: cell,
              lineHeight: `${cell}px`,
            }}
          >
            {char}
          </span>
        )
      )}
    </span>
  )
}
