import { type ButtonHTMLAttributes, type ReactElement, type Ref } from 'react'
import {
  BaseButton,
  type ButtonVariantProps,
} from '@/components/base/button/BaseButton'

interface ToolbarButtonProps
  extends Pick<ButtonVariantProps, 'variant' | 'size'>,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  label: string
  icon?: string
  trailingIcon?: string
  pressed?: boolean
  className?: string
  ref?: Ref<HTMLButtonElement>
}

export const ToolbarButton = ({
  label,
  icon = undefined,
  trailingIcon = undefined,
  variant = 'toolbar',
  size = 'md',
  pressed = undefined,
  className = undefined,
  ref = undefined,
  ...rest
}: ToolbarButtonProps): ReactElement => (
  <BaseButton
    {...rest}
    ref={ref}
    variant={variant}
    size={size}
    pressed={pressed}
    shape="pill"
    className={className}
  >
    {icon !== undefined && (
      <span className="material-symbols-outlined text-[1.1em]" aria-hidden="true">
        {icon}
      </span>
    )}
    <span className="truncate">{label}</span>
    {trailingIcon !== undefined && (
      <span className="material-symbols-outlined text-[1.1em]" aria-hidden="true">
        {trailingIcon}
      </span>
    )}
  </BaseButton>
)
