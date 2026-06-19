import type { ReactElement } from 'react'
import { useId, useRef } from 'react'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'

export interface UnsavedChangesDialogProps {
  isOpen: boolean
  fileName: string
  /** Optional error surfaced from a failed save/discard attempt. */
  errorMessage?: string | null
  actionDescription?: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
  isSaving?: boolean
}

export const UnsavedChangesDialog = ({
  isOpen,
  fileName,
  errorMessage = null,
  actionDescription = 'switching files',
  onSave,
  onDiscard,
  onCancel,
  isSaving = false,
}: UnsavedChangesDialogProps): ReactElement | null => {
  const labelId = useId()
  const descriptionId = useId()
  const saveButtonRef = useRef<HTMLButtonElement | null>(null)

  const handleCancelRequest = (): void => {
    if (isSaving) {
      return
    }

    onCancel()
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open): void => {
        if (!open) {
          onCancel()
        }
      }}
      initialFocusRef={saveButtonRef}
      dismissDisabled={isSaving}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
    >
      <Dialog.Header>
        <h2
          id={labelId}
          className="text-lg font-manrope font-semibold text-on-surface"
        >
          Unsaved Changes
        </h2>
      </Dialog.Header>

      <Dialog.Body>
        <p
          id={descriptionId}
          className="text-sm text-on-surface/80 font-inter leading-relaxed"
        >
          <span className="font-medium text-on-surface">{fileName}</span> has
          unsaved changes. Do you want to save them before {actionDescription}?
        </p>
        {errorMessage && (
          <div
            role="alert"
            className="mt-4 px-3 py-2 rounded-md bg-error/10 border border-error/30 text-sm text-error font-inter"
          >
            {errorMessage}
          </div>
        )}
      </Dialog.Body>

      <Dialog.Footer>
        <Button
          ref={saveButtonRef}
          variant="primary"
          onClick={onSave}
          disabled={isSaving}
          aria-busy={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
        <Button variant="danger" onClick={onDiscard} disabled={isSaving}>
          Discard
        </Button>
        <Button onClick={handleCancelRequest} disabled={isSaving}>
          Cancel
        </Button>
      </Dialog.Footer>
    </Dialog>
  )
}
