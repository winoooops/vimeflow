import type { CSSProperties, HTMLAttributes, ReactElement } from 'react'

type ProgressBarHeight = 'thin' | 'sm' | 'md'
type ProgressBarRadius = 'chip' | 'pill'

export type ProgressBarTone =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'error'
  | 'warning'
  | 'tertiary'
  | 'kimi'
  | 'custom'

export interface ProgressBarVariantProps {
  height?: ProgressBarHeight
  radius?: ProgressBarRadius
}

const TRACK_BASE_CLASS = 'flex w-full overflow-hidden'

const HEIGHT_CLASS: Record<ProgressBarHeight, string> = {
  thin: 'h-[3px]',
  sm: 'h-1.5',
  md: 'h-2',
}

const RADIUS_CLASS: Record<ProgressBarRadius, string> = {
  chip: 'rounded-chip',
  pill: 'rounded-full',
}

const SOLID_FILL_CLASS: Record<ProgressBarTone, string> = {
  neutral: 'bg-surface-container-highest',
  primary: 'bg-primary-container',
  secondary: 'bg-secondary',
  success: 'bg-success',
  error: 'bg-error',
  warning: 'bg-warning',
  tertiary: 'bg-tertiary',
  kimi: 'bg-[var(--color-agent-kimi-accent)]',
  custom: '',
}

const GRADIENT_FILL_CLASS: Record<ProgressBarTone, string> = {
  neutral:
    'bg-gradient-to-r from-surface-container-high to-surface-container-highest',
  primary: 'bg-gradient-to-r from-primary to-primary-container',
  secondary: 'bg-gradient-to-r from-secondary to-secondary-container',
  success: 'bg-gradient-to-r from-success to-success-muted',
  error: 'bg-gradient-to-r from-error to-tertiary',
  warning: 'bg-gradient-to-r from-warning to-tertiary',
  tertiary: 'bg-gradient-to-r from-tertiary to-error',
  kimi: 'bg-gradient-to-r from-[var(--color-agent-kimi-accent)] to-[color-mix(in_srgb,var(--color-agent-kimi-accent)_70%,var(--color-surface-container))]',
  custom: '',
}

const classes = (...parts: (string | undefined)[]): string =>
  parts
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ')

const trackClassName = ({
  height,
  radius,
  className,
}: Required<ProgressBarVariantProps> & { className?: string }): string =>
  classes(
    TRACK_BASE_CLASS,
    HEIGHT_CLASS[height],
    RADIUS_CLASS[radius],
    className
  )

const fillClassNameFor = ({
  radius,
  tone,
  gradient,
  className,
}: {
  radius: ProgressBarRadius
  tone: ProgressBarTone
  gradient: boolean
  className?: string
}): string =>
  classes(
    'h-full',
    RADIUS_CLASS[radius],
    gradient ? GRADIENT_FILL_CLASS[tone] : SOLID_FILL_CLASS[tone],
    className
  )

export interface ProgressBarSegment {
  value: number
  className?: string
  style?: CSSProperties
  testId?: string
}

interface ProgressBarProps
  extends
    ProgressBarVariantProps,
    Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'style'> {
  label: string
  value?: number
  max?: number
  tone?: ProgressBarTone
  gradient?: boolean
  decorative?: boolean
  segments?: readonly ProgressBarSegment[]
  className?: string
  style?: CSSProperties
  fillClassName?: string
  fillStyle?: CSSProperties
  fillTestId?: string
  trackTestId?: string
}

const boundedValue = (value: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(Math.max(value, 0), max)
}

const formatPercent = (value: number): string => `${Number(value.toFixed(4))}%`

const percentForValue = (value: number, max: number): number =>
  max > 0 ? (boundedValue(value, max) / max) * 100 : 0

const segmentTotal = (segments: readonly ProgressBarSegment[]): number =>
  segments.reduce((sum, segment) => sum + Math.max(segment.value, 0), 0)

export const ProgressBar = ({
  label,
  value = undefined,
  max = 100,
  tone = 'primary',
  gradient = false,
  decorative = false,
  segments = undefined,
  height = 'thin',
  radius = 'pill',
  className = undefined,
  style = undefined,
  fillClassName = undefined,
  fillStyle = undefined,
  fillTestId = undefined,
  trackTestId = undefined,
  ...rest
}: ProgressBarProps): ReactElement => {
  const safeMax = max > 0 ? max : 100

  const clampedValue =
    value === undefined ? undefined : boundedValue(value, safeMax)

  const isDecorative = decorative || segments !== undefined

  const ariaProps = isDecorative
    ? { 'aria-hidden': true }
    : {
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': safeMax,
        'aria-valuenow':
          clampedValue === undefined ? undefined : Math.round(clampedValue),
      }

  const total = segments === undefined ? 0 : segmentTotal(segments)

  return (
    <div
      data-testid={trackTestId}
      {...rest}
      {...ariaProps}
      style={style}
      className={trackClassName({
        height,
        radius,
        className: className ?? 'bg-surface',
      })}
    >
      {segments !== undefined ? (
        segments.map((segment, index) => {
          const width =
            total > 0 ? (Math.max(segment.value, 0) / total) * 100 : 0

          return (
            <div
              key={segment.testId ?? index}
              data-testid={segment.testId}
              className={`h-full ${segment.className ?? ''}`}
              style={{
                width: formatPercent(width),
                ...segment.style,
              }}
            />
          )
        })
      ) : (
        <div
          data-testid={fillTestId}
          className={fillClassNameFor({
            radius,
            tone,
            gradient,
            className: fillClassName,
          })}
          style={{
            width: formatPercent(percentForValue(value ?? 0, safeMax)),
            ...fillStyle,
          }}
        />
      )}
    </div>
  )
}
