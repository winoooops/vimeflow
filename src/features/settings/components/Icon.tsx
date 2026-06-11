import type { CSSProperties, ReactElement } from 'react'
import type { IconProps } from '../types'

export const Icon = ({
  name,
  size = 16,
  fill = false,
  className = '',
}: IconProps): ReactElement => {
  const style: CSSProperties = { fontSize: size }

  if (fill) {
    style.fontVariationSettings = "'FILL' 1"
  }

  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className}`}
      style={style}
    >
      {name}
    </span>
  )
}
