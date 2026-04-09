import { useState, useCallback, useRef, useEffect } from 'react'

export interface UseResizableOptions {
  initial: number
  min: number
  max: number
  direction?: 'horizontal' | 'vertical'
}

export interface UseResizableResult {
  size: number
  isDragging: boolean
  handleMouseDown: (e: React.MouseEvent) => void
}

export const useResizable = ({
  initial,
  min,
  max,
  direction = 'horizontal',
}: UseResizableOptions): UseResizableResult => {
  const [size, setSize] = useState(initial)
  const [isDragging, setIsDragging] = useState(false)
  const startPos = useRef(0)
  const startSize = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault()
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
      startSize.current = size
      setIsDragging(true)
    },
    [size, direction]
  )

  useEffect(() => {
    if (!isDragging) {return}

    const handleMouseMove = (e: MouseEvent): void => {
      const currentPos =
        direction === 'horizontal' ? e.clientX : e.clientY
      const delta = currentPos - startPos.current

      const newSize = Math.round(
        Math.min(max, Math.max(min, startSize.current + delta))
      )
      setSize(newSize)
    }

    const handleMouseUp = (): void => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return (): void => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, min, max, direction])

  return { size, isDragging, handleMouseDown }
}
