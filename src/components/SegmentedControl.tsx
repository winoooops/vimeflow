import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { tv, type VariantProps } from 'tailwind-variants'
import { Tooltip } from '@/components/Tooltip'
import { type ShortcutInput } from '@/lib/formatShortcut'

export interface SegmentedControlOption<T extends string | number> {
  value: T
  label: string
  ariaLabel?: string
  icon?: string
  tooltip?: ReactNode
  shortcut?: ShortcutInput
  /**
   * Dim the option and ignore clicks/keyboard selection without removing it.
   * The Tooltip still appears on hover (we deliberately avoid
   * `pointer-events-none` and the native `disabled` attribute, which would
   * both suppress hover) so the caller can explain why it's unavailable.
   */
  disabled?: boolean
}

const segmentedTrackVariants = tv({
  base: 'inline-flex shrink-0 items-center',
  variants: {
    variant: {
      pill: 'gap-0.5 rounded-full bg-surface-container/40 p-0.5',
      dock: 'gap-1',
      framed:
        'gap-0.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest/60 p-[3px]',
      toolbar: 'gap-0.5 rounded-md bg-surface-container/60 p-0.5',
      toolbarInline: 'contents',
      sidebar:
        'relative flex min-w-0 rounded-[10px] border border-outline-variant/30 bg-surface-container-lowest/70 p-[3px] shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--color-scrim)_40%,transparent)]',
    },
  },
  defaultVariants: { variant: 'pill' },
})

const segmentedItemVariants = tv({
  base: 'relative z-[1] inline-flex shrink-0 cursor-pointer items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
  variants: {
    variant: {
      pill: 'rounded-full px-3 py-1 text-[0.65rem] font-bold uppercase tracking-wider',
      dock: 'h-[26px] rounded-md border px-[11px] font-mono text-[10.5px]',
      framed: 'h-[22px] w-[26px] rounded-[5px] border',
      toolbar: 'h-5 w-6 rounded text-[0px]',
      toolbarInline: 'h-5 w-6 rounded text-[0px]',
      sidebar:
        'h-[30px] min-w-0 flex-1 gap-1.5 rounded-[7px] font-mono text-[12px] font-semibold uppercase tracking-[0.08em]',
    },
    active: { true: '', false: '' },
  },
  compoundVariants: [
    {
      variant: 'pill',
      active: true,
      class: 'bg-primary text-on-primary',
    },
    {
      variant: 'pill',
      active: false,
      class: 'text-on-surface-variant hover:text-on-surface',
    },
    {
      variant: 'dock',
      active: true,
      class: 'border-primary-container/30 bg-primary/[0.08] text-primary',
    },
    {
      variant: 'dock',
      active: false,
      class:
        'border-transparent bg-transparent text-on-surface-muted hover:text-primary',
    },
    {
      variant: 'framed',
      active: true,
      class:
        'border-primary-container/45 bg-primary-container/15 text-primary-container',
    },
    {
      variant: 'framed',
      active: false,
      class:
        'border-transparent bg-transparent text-on-surface-muted hover:text-primary',
    },
    {
      variant: 'toolbar',
      active: true,
      class: 'bg-primary/15 text-primary ring-1 ring-primary/45',
    },
    {
      variant: 'toolbar',
      active: false,
      class: 'text-on-surface-muted hover:text-on-surface',
    },
    {
      variant: 'toolbarInline',
      active: true,
      class: 'bg-primary/15 text-primary ring-1 ring-primary/45',
    },
    {
      variant: 'toolbarInline',
      active: false,
      class: 'text-on-surface-muted hover:text-on-surface',
    },
    {
      variant: 'sidebar',
      active: true,
      class: 'text-primary',
    },
    {
      variant: 'sidebar',
      active: false,
      class: 'text-on-surface-muted hover:text-on-surface-variant',
    },
  ],
  defaultVariants: { variant: 'pill', active: false },
})

export type SegmentedControlVariantProps = VariantProps<
  typeof segmentedTrackVariants
>

interface SegmentedControlProps<
  T extends string | number,
> extends SegmentedControlVariantProps {
  value: T
  options: readonly SegmentedControlOption<T>[]
  onChange: (next: T) => void
  'aria-label': string
  role?: 'group' | 'presentation'
  'data-testid'?: string
  className?: string
  buttonClassName?: string | ((option: SegmentedControlOption<T>) => string)
  iconClassName?: string | ((active: boolean) => string)
  renderOption?: (
    option: SegmentedControlOption<T>,
    active: boolean
  ) => ReactNode
  skipActiveReselect?: boolean
  fillActiveIcon?: boolean
  showActiveThumb?: boolean
  thumbTestId?: string
  style?: CSSProperties
}

const keyToOffset = (key: string): number | 'first' | 'last' | null => {
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return 1
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return -1
  }
  if (key === 'Home') {
    return 'first'
  }
  if (key === 'End') {
    return 'last'
  }

  return null
}

const nextIndexForKey = <T extends string | number>(
  key: string,
  index: number,
  options: readonly SegmentedControlOption<T>[]
): number | null => {
  const offset = keyToOffset(key)
  const total = options.length

  if (offset === null || total === 0) {
    return null
  }

  const isEnabled = (candidate: number): boolean =>
    options[candidate].disabled !== true

  // Home/End scan inward from the respective edge to the first enabled option.
  if (offset === 'first' || offset === 'last') {
    const step = offset === 'first' ? 1 : -1
    const start = offset === 'first' ? 0 : total - 1

    for (let candidate = start; candidate >= 0 && candidate < total; ) {
      if (isEnabled(candidate)) {
        return candidate
      }

      candidate += step
    }

    return null
  }

  // Arrows walk in the step direction, wrapping, until an enabled option is
  // found. Bail after a full loop so an all-disabled control does nothing.
  for (let step = 1; step <= total; step += 1) {
    const candidate = (index + offset * step + total * step) % total

    if (isEnabled(candidate)) {
      return candidate
    }
  }

  return null
}

export const SegmentedControl = <T extends string | number>({
  value,
  options,
  onChange,
  variant = 'pill',
  'aria-label': ariaLabel,
  role = 'group',
  'data-testid': testId = undefined,
  className = undefined,
  buttonClassName = undefined,
  iconClassName = undefined,
  renderOption = undefined,
  skipActiveReselect = false,
  fillActiveIcon = false,
  showActiveThumb = variant === 'sidebar',
  thumbTestId = undefined,
  style = undefined,
}: SegmentedControlProps<T>): ReactElement => {
  const activeIndex = options.findIndex((option) => option.value === value)
  const focusIndex = Math.max(0, activeIndex)
  const optionCount = Math.max(1, options.length)

  const thumbStyle: CSSProperties = {
    width: `calc((100% - 6px) / ${optionCount})`,
    transform: `translateX(${activeIndex * 100}%)`,
  }

  const renderDefaultOption = (
    option: SegmentedControlOption<T>,
    active: boolean
  ): ReactNode => (
    <>
      {option.icon !== undefined && (
        <span
          aria-hidden="true"
          className={
            typeof iconClassName === 'function'
              ? iconClassName(active)
              : (iconClassName ?? 'material-symbols-outlined text-[16px]')
          }
          style={
            fillActiveIcon
              ? { fontVariationSettings: `'FILL' ${active ? 1 : 0}` }
              : undefined
          }
        >
          {option.icon}
        </span>
      )}
      <span>{option.label}</span>
    </>
  )

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ): void => {
    const nextIndex = nextIndexForKey(event.key, index, options)

    if (nextIndex === null) {
      return
    }

    event.preventDefault()

    if (!(skipActiveReselect && nextIndex === index)) {
      onChange(options[nextIndex].value)
    }

    const parent = event.currentTarget.parentElement

    if (parent === null) {
      return
    }

    parent.querySelectorAll<HTMLButtonElement>('button').item(nextIndex).focus()
  }

  return (
    <div
      role={role}
      aria-label={role === 'group' ? ariaLabel : undefined}
      data-testid={testId}
      style={style}
      className={segmentedTrackVariants({ variant, class: className })}
    >
      {showActiveThumb && options.length > 0 && activeIndex >= 0 && (
        <div
          aria-hidden="true"
          data-testid={thumbTestId}
          style={thumbStyle}
          className="pointer-events-none absolute bottom-[3px] left-[3px] top-[3px] z-0 rounded-[7px] border border-primary-container/40 bg-primary-container/16 shadow-[0_1px_2px_color-mix(in_srgb,var(--color-scrim)_25%,transparent)] transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)]"
        />
      )}
      {options.map((option, index) => {
        const active = option.value === value
        const disabled = option.disabled === true

        const extraButtonClass =
          typeof buttonClassName === 'function'
            ? buttonClassName(option)
            : buttonClassName

        const button = (
          <button
            key={String(option.value)}
            type="button"
            aria-label={option.ariaLabel ?? option.label}
            aria-pressed={active}
            aria-disabled={disabled ? 'true' : undefined}
            data-active={active ? 'true' : undefined}
            data-disabled={disabled ? 'true' : undefined}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={
              disabled || (active && skipActiveReselect)
                ? undefined
                : (): void => onChange(option.value)
            }
            onKeyDown={(event): void => handleKeyDown(event, index)}
            // Deliberately NOT `disabled`/`pointer-events-none` — both kill the
            // hover that the Tooltip needs. `cursor-not-allowed` + dimming +
            // `aria-disabled` convey unavailability while keeping hover alive.
            className={segmentedItemVariants({
              variant,
              active,
              class: disabled
                ? `${extraButtonClass ?? ''} cursor-not-allowed opacity-40`
                : extraButtonClass,
            })}
          >
            {renderOption !== undefined
              ? renderOption(option, active)
              : renderDefaultOption(option, active)}
          </button>
        )

        return option.tooltip !== undefined ? (
          <Tooltip
            key={String(option.value)}
            content={option.tooltip}
            shortcut={option.shortcut}
            placement="bottom"
          >
            {button}
          </Tooltip>
        ) : (
          button
        )
      })}
    </div>
  )
}
