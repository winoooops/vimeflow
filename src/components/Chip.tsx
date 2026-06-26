import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react'

type ChipVariant = 'subtle' | 'tinted' | 'solid'
type ChipTone =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'error'
  | 'warning'
  | 'tertiary'
  | 'custom'
type ChipRadius = 'chip' | 'pill' | 'md'
type ChipSize = 'xs' | 'sm' | 'md' | 'custom'

export interface ChipVariantProps {
  variant?: ChipVariant
  tone?: ChipTone
  radius?: ChipRadius
  size?: ChipSize
}

const BASE_CLASS = 'inline-flex shrink-0 items-center whitespace-nowrap'

const VARIANT_CLASS: Record<ChipVariant, string> = {
  subtle: '',
  tinted: 'ring-1 ring-inset',
  solid: '',
}

const RADIUS_CLASS: Record<ChipRadius, string> = {
  chip: 'rounded-chip',
  pill: 'rounded-full',
  md: 'rounded-md',
}

const SIZE_CLASS: Record<ChipSize, string> = {
  xs: 'gap-1 px-1.5 py-px text-[9px] leading-none',
  sm: 'gap-1.5 px-2 py-0.5 text-[10px] leading-none',
  md: 'gap-1.5 px-2.5 py-1 text-xs leading-none',
  custom: '',
}

const TONE_CLASS: Record<ChipVariant, Record<ChipTone, string>> = {
  subtle: {
    neutral: 'bg-surface-container-high text-on-surface-variant',
    primary: 'bg-primary/10 text-primary',
    secondary: 'bg-secondary/[0.12] text-secondary',
    success: 'bg-success/[0.12] text-success',
    error: 'bg-error/[0.12] text-error',
    warning: 'bg-warning/[0.12] text-warning',
    tertiary: 'bg-tertiary/[0.12] text-tertiary',
    custom: '',
  },
  tinted: {
    neutral:
      'bg-surface-container-lowest/50 text-on-surface-variant ring-outline-variant/30',
    primary: 'bg-primary/10 text-primary ring-primary/20',
    secondary: 'bg-secondary/[0.08] text-secondary ring-secondary/[0.16]',
    success: 'bg-success/[0.08] text-success ring-success/20',
    error: 'bg-error/[0.08] text-error ring-error/20',
    warning: 'bg-warning/[0.08] text-warning ring-warning/20',
    tertiary: 'bg-tertiary/[0.08] text-tertiary ring-tertiary/20',
    custom: '',
  },
  solid: {
    neutral: 'bg-surface-container-highest text-on-surface',
    primary: 'bg-primary text-on-primary',
    secondary: 'bg-secondary text-surface',
    success: 'bg-success text-surface',
    error: 'bg-error text-surface',
    warning: 'bg-warning text-surface',
    tertiary: 'bg-tertiary text-surface',
    custom: '',
  },
}

const classes = (...parts: (string | undefined)[]): string =>
  parts
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ')

const chipClassName = ({
  variant,
  tone,
  radius,
  size,
  className,
}: Required<ChipVariantProps> & { className?: string }): string =>
  classes(
    BASE_CLASS,
    VARIANT_CLASS[variant],
    TONE_CLASS[variant][tone],
    RADIUS_CLASS[radius],
    SIZE_CLASS[size],
    className
  )

interface ChipProps
  extends ChipVariantProps, Omit<HTMLAttributes<HTMLSpanElement>, 'className'> {
  label?: ReactNode
  leading?: ReactNode
  leadingIcon?: string
  trailingCount?: ReactNode
  className?: string
  iconClassName?: string
  labelClassName?: string
  countClassName?: string
  ref?: Ref<HTMLSpanElement>
}

export const Chip = ({
  variant = 'subtle',
  tone = 'neutral',
  radius = 'chip',
  size = 'sm',
  label = undefined,
  leading = undefined,
  leadingIcon = undefined,
  trailingCount = undefined,
  className = undefined,
  iconClassName = undefined,
  labelClassName = undefined,
  countClassName = undefined,
  children = undefined,
  ref = undefined,
  ...rest
}: ChipProps): ReactElement => {
  const leadingNode =
    leading ??
    (leadingIcon !== undefined ? (
      <span
        aria-hidden="true"
        className={
          iconClassName ?? 'material-symbols-outlined text-[1.1em] leading-none'
        }
      >
        {leadingIcon}
      </span>
    ) : null)

  return (
    <span
      {...rest}
      ref={ref}
      className={chipClassName({ variant, tone, radius, size, className })}
    >
      {children ?? (
        <>
          {leadingNode}
          {label !== undefined && (
            <span className={labelClassName}>{label}</span>
          )}
          {trailingCount !== undefined && (
            <span
              className={
                countClassName ??
                'shrink-0 font-mono font-semibold leading-none'
              }
            >
              {trailingCount}
            </span>
          )}
        </>
      )}
    </span>
  )
}
