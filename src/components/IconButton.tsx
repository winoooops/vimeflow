import { type ButtonHTMLAttributes, type ReactElement, type Ref } from 'react'
import { Tooltip } from '@/components/Tooltip'
import {
  BaseButton,
  type ButtonVariantProps,
} from '@/components/base/button/BaseButton'
import { type Placement } from '@/components/base/floating/glassSurface'
import { type ShortcutInput } from '@/lib/formatShortcut'

interface IconButtonProps
  extends Pick<ButtonVariantProps, 'variant' | 'size'>,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label'> {
  icon: string
  label: string
  pressed?: boolean
  shortcut?: ShortcutInput
  tooltipPlacement?: Placement
  showTooltip?: boolean
  className?: string
  ref?: Ref<HTMLButtonElement>
}

export const IconButton = ({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  pressed = undefined,
  shortcut = undefined,
  tooltipPlacement = 'bottom',
  showTooltip = true,
  className = undefined,
  ref = undefined,
  ...rest
}: IconButtonProps): ReactElement => {
  const button = (
    <BaseButton
      {...rest}
      ref={ref}
      aria-label={label}
      variant={variant}
      size={size}
      pressed={pressed}
      shape="icon"
      className={className}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
    </BaseButton>
  )

  return showTooltip ? (
    <Tooltip content={label} shortcut={shortcut} placement={tooltipPlacement}>
      {button}
    </Tooltip>
  ) : (
    button
  )
}
