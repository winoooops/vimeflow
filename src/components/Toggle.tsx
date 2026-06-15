import { type ButtonHTMLAttributes, type ReactElement, type Ref } from 'react'
import { tv } from 'tailwind-variants'

const toggleVariants = tv({
  base: 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
  variants: {
    active: {
      true: 'bg-primary/20 text-primary hover:bg-primary/30',
      false:
        'bg-surface-container/40 text-on-surface-variant hover:bg-surface-container/60 hover:text-on-surface',
    },
  },
  defaultVariants: { active: false },
})

interface ToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'onClick' | 'onChange' | 'aria-pressed' | 'value'
> {
  label: string
  value?: boolean
  onChange: (next: boolean) => void
  className?: string
  ref?: Ref<HTMLButtonElement>
}

export const Toggle = ({
  label,
  value = false,
  onChange,
  className = undefined,
  ref = undefined,
  type = 'button',
  ...rest
}: ToggleProps): ReactElement => (
  <button
    {...rest}
    ref={ref}
    type={type}
    onClick={(): void => onChange(!value)}
    className={toggleVariants({ active: value, class: className })}
    aria-pressed={value ? 'true' : 'false'}
  >
    <span
      aria-hidden="true"
      className="material-symbols-outlined text-base leading-none"
    >
      {value ? 'check_box' : 'check_box_outline_blank'}
    </span>
    {label}
  </button>
)
