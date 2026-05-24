import { useEffect, useRef, useState } from 'react'
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

const errorMessageForValue = (value: string): string | null => {
  const validation = validateTitle(value)

  if (validation.kind === 'empty') {
    return 'title cannot be empty'
  }

  if (validation.kind === 'invalid' && validation.reason === 'control-char') {
    return 'control characters are not allowed'
  }

  if (validation.kind === 'invalid' && validation.reason === 'too-long') {
    return 'title is too long (max 200 bytes)'
  }

  return null
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
  const inputRef = useRef<HTMLInputElement | null>(null)
  const validation = validateTitle(value)
  const anchor = getPaneHeaderRef(pane.ptyId)
  const rect = anchor?.getBoundingClientRect()

  useEffect(() => {
    inputRef.current?.select()
  }, [])

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

  const style: CSSProperties = rect
    ? {
        position: 'fixed',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        minHeight: rect.height,
      }
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        minWidth: 220,
        transform: 'translate(-50%, -50%)',
      }

  const errorMessage = errorMessageForValue(value)
  const displayedError = externalError ?? errorMessage

  return createPortal(
    <div
      style={style}
      className="z-50 rounded-md bg-surface-container/90 p-1 shadow-[0_12px_40px_rgba(0,0,0,0.42)] backdrop-blur-md"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={onCancel}
        onKeyDown={handleKeyDown}
        aria-label="Pane name"
        aria-invalid={validation.kind !== 'valid' || Boolean(externalError)}
        className="w-full bg-transparent px-1 py-0.5 font-mono text-[12.5px] text-on-surface outline-none"
      />
      {displayedError && (
        <div role="alert" className="mt-1 text-[10px] text-error">
          {displayedError}
        </div>
      )}
    </div>,
    document.body
  )
}
