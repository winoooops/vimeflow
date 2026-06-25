import { type ReactElement } from 'react'
import { Button } from '@/components/Button'
import { PathCrumb } from './PathCrumb'
import { pickDirectory } from './pickDirectory'

interface WorkingDirectoryFieldProps {
  path: string
  onChange: (path: string) => void
}

export const WorkingDirectoryField = ({
  path,
  onChange,
}: WorkingDirectoryFieldProps): ReactElement => {
  const handleBrowse = async (): Promise<void> => {
    const picked = await pickDirectory()

    if (picked !== null) {
      onChange(picked)
    }
  }

  return (
    <div className="flex gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[9px] bg-surface-container-lowest px-3 py-2.5">
        <span
          className="material-symbols-outlined text-base text-primary-container"
          aria-hidden="true"
        >
          folder_open
        </span>
        <PathCrumb path={path} />
      </div>
      <Button
        variant="default"
        leadingIcon="drive_folder_upload"
        onClick={() => {
          void handleBrowse()
        }}
      >
        Browse…
      </Button>
    </div>
  )
}
