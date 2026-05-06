import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Session } from '../types'

export interface UseRenameStateReturn {
  /** Whether the row is currently in rename mode. */
  isEditing: boolean
  /** Current input value. */
  editValue: string
  /** Setter for the input value (wire to <input onChange>). */
  setEditValue: (value: string) => void
  /** Ref to attach to the rename <input> for focus + select on enter-edit. */
  inputRef: RefObject<HTMLInputElement | null>
  /** Enter rename mode. No-op if onRename is undefined. */
  beginEdit: () => void
  /** Exit rename mode and either fire onRename or revert. */
  commitRename: () => void
  /** Exit rename mode and discard the edit. */
  cancelRename: () => void
}

/**
 * Shared rename state machine used by both the Active SessionRow and
 * the Recent RecentSessionRow. Pulled out so a fix to commit-on-blur,
 * trim semantics, or focus selection lands in one place — earlier
 * cycles already had bugs from divergent copies of this logic.
 *
 * The two row components keep their own JSX (Reorder.Item vs <li>,
 * different size tokens, different aria-hidden treatment) — only the
 * editing contract is shared.
 */
export const useRenameState = (
  session: Session,
  onRename: ((id: string, name: string) => void) | undefined
): UseRenameStateReturn => {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.name)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Prevents double-firing onRename when Enter is pressed: the keydown
  // handler calls commitRename, which queues setIsEditing(false). React
  // batches that, but on flush the input unmounts → browser fires
  // focusout synchronously → React's onBlur listener re-enters
  // commitRename. Without this ref both paths see the same stale
  // closure (trimmed !== session.name) and onRename fires twice with
  // identical args. Reset on every begin/cancel so the next rename
  // session starts clean.
  const committedRef = useRef(false)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const beginEdit = (): void => {
    if (!onRename) {
      return
    }
    committedRef.current = false
    setEditValue(session.name)
    setIsEditing(true)
  }

  const commitRename = (): void => {
    if (committedRef.current) {
      return
    }
    committedRef.current = true
    setIsEditing(false)
    const trimmed = editValue.trim()
    if (trimmed.length > 0 && trimmed !== session.name) {
      onRename?.(session.id, trimmed)
    } else {
      setEditValue(session.name)
    }
  }

  const cancelRename = (): void => {
    committedRef.current = false
    setEditValue(session.name)
    setIsEditing(false)
  }

  return {
    isEditing,
    editValue,
    setEditValue,
    inputRef,
    beginEdit,
    commitRename,
    cancelRename,
  }
}
