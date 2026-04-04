import type { ReactElement } from 'react'

interface DropZoneProps {
  targetPath: string
}

/**
 * DropZone component for file upload (visual only, no actual upload functionality).
 */
export const DropZone = ({ targetPath }: DropZoneProps): ReactElement => (
    <div
      className="border-2 border-dashed border-outline-variant/30 rounded-xl p-8 flex flex-col items-center justify-center gap-2 max-w-4xl mx-auto mt-4"
      role="region"
      aria-label="File drop zone"
    >
      <span
        className="material-symbols-outlined text-on-surface-variant text-3xl"
        aria-hidden="true"
      >
        upload_file
      </span>
      <p className="text-on-surface-variant text-sm">
        Drop files here to upload to {targetPath}
      </p>
    </div>
  )
