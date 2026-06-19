import { useState, type ReactElement } from 'react'
import { GhostButton } from './controls'

export const SettingsHeader = (): ReactElement => {
  const [openError, setOpenError] = useState<string | null>(null)

  const handleOpenFile = (): void => {
    setOpenError(null)

    const open = async (): Promise<void> => {
      try {
        await window.vimeflow?.settings?.openFile()
      } catch {
        setOpenError('Could not open settings.json')
      }
    }

    void open()
  }

  return (
    <div className="flex shrink-0 items-center gap-3.5 border-b border-outline-variant/25 px-7 py-4">
      <h1 className="m-0 font-body text-[13px] font-semibold text-primary-container">
        Settings
      </h1>

      <span className="min-w-0 flex-1" />

      <div className="flex items-center gap-2">
        <GhostButton onClick={handleOpenFile}>
          Edit in settings.json
        </GhostButton>
        {openError && (
          <span role="alert" className="font-body text-xs text-error">
            {openError}
          </span>
        )}
      </div>
    </div>
  )
}
