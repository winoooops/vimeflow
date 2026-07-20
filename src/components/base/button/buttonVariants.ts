import { tv, type VariantProps } from 'tailwind-variants'

export const buttonVariants = tv({
  base: 'inline-flex shrink-0 cursor-pointer items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-40 disabled:pointer-events-none',
  variants: {
    variant: {
      ghost:
        'bg-transparent text-on-surface-muted hover:bg-surface-container-high hover:text-on-surface aria-pressed:bg-primary/10 aria-pressed:text-primary aria-expanded:bg-primary/10 aria-expanded:text-primary',
      default:
        'bg-surface-container-high text-on-surface hover:bg-surface-container-highest aria-pressed:bg-primary/12 aria-expanded:bg-primary/12',
      toolbar:
        'bg-surface-container-high/60 text-on-surface-variant hover:bg-surface-container-highest/80 hover:text-on-surface aria-pressed:bg-surface-container-highest/80 aria-expanded:bg-surface-container-highest/80 aria-expanded:text-on-surface',
      primary:
        'border border-primary/25 bg-[linear-gradient(180deg,var(--color-primary-dim)_0%,var(--color-primary-deep)_100%)] text-surface-container-lowest shadow-[0_8px_18px_color-mix(in_srgb,var(--color-primary-deep)_20%,transparent),inset_0_1px_0_var(--color-wash-soft)] hover:brightness-110 active:translate-y-px',
      'flat-primary':
        'border border-primary/25 bg-primary text-surface-container-lowest shadow-[0_8px_18px_color-mix(in_srgb,var(--color-primary-deep)_20%,transparent),inset_0_1px_0_var(--color-wash-soft)] hover:brightness-110 active:translate-y-px',
      danger:
        'bg-transparent text-error hover:bg-error/10 hover:text-error aria-pressed:bg-error/15 aria-expanded:bg-error/15',
    },
    size: { sm: '', md: '', lg: '' },
    shape: { icon: '', pill: '' },
  },
  compoundVariants: [
    {
      shape: 'icon',
      size: 'sm',
      class: 'h-[22px] w-[22px] text-[13px] rounded-chip',
    },
    { shape: 'icon', size: 'md', class: 'h-7 w-7 text-[17px] rounded-chip' },
    { shape: 'icon', size: 'lg', class: 'h-8 w-8 text-[19px] rounded-chip' },
    {
      shape: 'pill',
      size: 'sm',
      class: 'h-[26px] px-2 text-xs rounded-md gap-1.5',
    },
    {
      shape: 'pill',
      size: 'md',
      class: 'h-[30px] px-2.5 text-[13px] rounded-md gap-1.5',
    },
    {
      shape: 'pill',
      size: 'lg',
      class: 'h-9 px-3 text-[15px] rounded-lg gap-2',
    },
  ],
  defaultVariants: { variant: 'default', size: 'md', shape: 'pill' },
})

export type ButtonVariantProps = VariantProps<typeof buttonVariants>
