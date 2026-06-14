import { type ButtonHTMLAttributes, type ReactElement, type Ref } from 'react'
import { buttonVariants, type ButtonVariantProps } from './buttonVariants'

export type { ButtonVariantProps }

export interface BaseButtonProps
  extends
    ButtonVariantProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  pressed?: boolean
  className?: string
  ref?: Ref<HTMLButtonElement>
}

// variant/size/shape default to undefined → tv() applies its defaultVariants.
export const BaseButton = ({
  variant = undefined,
  size = undefined,
  shape = undefined,
  pressed = undefined,
  className = undefined,
  type = 'button',
  ref = undefined,
  ...rest
}: BaseButtonProps): ReactElement => (
  <button
    {...rest}
    ref={ref}
    type={type}
    aria-pressed={pressed}
    className={buttonVariants({ variant, size, shape, class: className })}
  />
)
