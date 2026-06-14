import { type ButtonHTMLAttributes, type ReactElement, type ReactNode, type Ref } from 'react'
import {
  BaseButton,
  type ButtonVariantProps,
} from '@/components/base/button/BaseButton'

export type { ButtonVariantProps }

interface ButtonProps
  extends Pick<ButtonVariantProps, 'variant' | 'size'>,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  leadingIcon?: string
  className?: string
  children: ReactNode
  ref?: Ref<HTMLButtonElement>
}

export const Button = ({
  variant = 'default',
  size = 'md',
  leadingIcon = undefined,
  className = undefined,
  children,
  ref = undefined,
  ...rest
}: ButtonProps): ReactElement => (
  <BaseButton
    {...rest}
    ref={ref}
    variant={variant}
    size={size}
    shape="pill"
    className={className}
  >
    {leadingIcon !== undefined && (
      <span className="material-symbols-outlined text-[1.1em]" aria-hidden="true">
        {leadingIcon}
      </span>
    )}
    {children}
  </BaseButton>
)
