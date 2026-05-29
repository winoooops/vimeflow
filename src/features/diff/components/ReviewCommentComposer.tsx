import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'

interface ReviewCommentComposerProps {
  anchor: HTMLElement
  initialText?: string
  onConfirm: (text: string) => void
  onCancel: () => void
}

export const ReviewCommentComposer = ({
  anchor,
  initialText = '',
  onConfirm,
  onCancel,
}: ReviewCommentComposerProps): ReactElement => {
  const [text, setText] = useState(initialText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open): void => {
      if (!open) {
        onCancel()
      }
    },
    placement: 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    elements: { reference: anchor },
  })

  const dismiss = useDismiss(context, { ancestorScroll: true })
  const role = useRole(context, { role: 'dialog' })
  const { getFloatingProps } = useInteractions([dismiss, role])

  useEffect((): void => {
    textareaRef.current?.focus()
  }, [])

  const submit = (): void => {
    const trimmed = text.trim()

    if (trimmed.length > 0) {
      onConfirm(trimmed)
    }
  }

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="z-50 flex w-[320px] flex-col gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-high/95 p-3 shadow-xl backdrop-blur-md"
        {...getFloatingProps()}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e): void => setText(e.target.value)}
          onKeyDown={(e): void => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          rows={3}
          className="resize-none rounded bg-surface-container/50 p-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Add a comment…"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={(): void => onCancel()}
            className="rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(): void => submit()}
            disabled={text.trim().length === 0}
            className="rounded-md bg-primary px-3 py-1 text-xs text-on-primary hover:bg-primary/80 disabled:opacity-50"
          >
            Add comment
          </button>
        </div>
      </div>
    </FloatingPortal>
  )
}
