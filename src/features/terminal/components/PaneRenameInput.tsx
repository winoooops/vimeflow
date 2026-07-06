import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactPortal,
} from 'react'
import { validateTitle } from '../../sessions/utils/sanitizeTitle'
import type { Pane } from '../../sessions/types'
import { get as getPaneHeaderRef } from '../paneHeaderRefs'

interface PaneRenameInputProps {
  pane: Pane
  initialValue: string
  onSubmit: (sanitized: string) => void | Promise<void>
  onCancel: () => void
  externalError?: string | null
  onExternalErrorDismiss?: () => void
}

interface AnchorRect {
  top: number
  left: number
  width: number
}

const rectFromAnchor = (anchor: HTMLElement): AnchorRect => {
  const rect = anchor.getBoundingClientRect()
  const verticalRect = anchor.parentElement?.getBoundingClientRect() ?? rect

  return {
    top: verticalRect.top + verticalRect.height / 2,
    left: rect.left,
    width: rect.width,
  }
}

export const PaneRenameInput = ({
  pane,
  initialValue,
  onSubmit,
  onCancel,
  externalError = null,
  onExternalErrorDismiss,
}: PaneRenameInputProps): ReactPortal => {
  const [value, setValue] = useState(initialValue)
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const validation = validateTitle(value)

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.select()
  }, [])

  useLayoutEffect(() => {
    const anchor = getPaneHeaderRef(pane.ptyId)

    if (!anchor) {
      setAnchorRect(null)

      return
    }

    const updateRect = (): void => {
      const latestAnchor = getPaneHeaderRef(pane.ptyId)
      setAnchorRect(latestAnchor ? rectFromAnchor(latestAnchor) : null)
    }

    updateRect()

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateRect)
    resizeObserver?.observe(anchor)
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)

    return (): void => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [pane.ptyId])

  useEffect(() => {
    if (!externalError) {
      return
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && frameRef.current?.contains(target)) {
        return
      }

      onCancel()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)

    return (): void => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [externalError, onCancel])

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setValue(event.target.value)
    if (externalError) {
      onExternalErrorDismiss?.()
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && validation.kind === 'valid') {
      event.preventDefault()
      void onSubmit(validation.sanitized)

      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  const style: CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.top,
        left: anchorRect.left,
        width: anchorRect.width,
        transform: 'translateY(-50%)',
      }
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        minWidth: 220,
        transform: 'translate(-50%, -50%)',
      }

  const hasError = validation.kind !== 'valid' || Boolean(externalError)

  const errorText =
    externalError ??
    (validation.kind === 'empty'
      ? 'title cannot be empty'
      : validation.kind === 'invalid'
        ? 'title is too long (max 200 bytes)'
        : null)

  const errorId = 'pane-rename-error'

  return createPortal(
    <div
      ref={frameRef}
      data-testid="pane-rename-frame"
      data-workspace-overlay-id="pane-rename"
      style={style}
      className={`z-50 rounded-sm border bg-surface-container/90 shadow-[0_12px_40px_color-mix(in_srgb,var(--color-scrim)_42%,transparent)] backdrop-blur-md ${
        hasError ? 'border-error' : 'border-transparent'
      }`}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={externalError ? undefined : onCancel}
        onKeyDown={handleKeyDown}
        aria-label="Pane name"
        aria-describedby={errorText ? errorId : undefined}
        aria-invalid={hasError}
        className="block w-full bg-transparent px-1.5 py-1.5 font-mono text-[10.5px] leading-none text-on-surface outline-none"
      />
      {errorText && (
        <div
          id={errorId}
          role="alert"
          className="max-w-full px-1.5 pb-1.5 font-mono text-[10px] leading-tight text-error"
        >
          {errorText}
        </div>
      )}
    </div>,
    document.body
  )
}
