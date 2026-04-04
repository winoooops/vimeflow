import type { ReactElement } from 'react'

interface FileStatusBarProps {
  fileCount: number
  totalSize: string
  encoding: string
  gitBranch: string
  liveSyncActive: boolean
}

/**
 * FileStatusBar component displaying file information at the bottom of the Files Explorer.
 */
export const FileStatusBar = ({
  fileCount,
  totalSize,
  encoding,
  gitBranch,
  liveSyncActive,
}: FileStatusBarProps): ReactElement => {
  const fileText = fileCount === 1 ? '1 file' : `${fileCount} files`

  return (
    <div
      className="h-8 bg-surface-container-lowest flex items-center px-4 gap-6 text-[11px] font-label text-on-surface-variant fixed bottom-0 left-[308px] right-[280px]"
      role="status"
      aria-label="File status bar"
    >
      <span aria-label={fileText}>{fileText}</span>
      <span aria-label={`Total size ${totalSize}`}>{totalSize}</span>
      <span aria-label={`Encoding ${encoding}`}>{encoding}</span>
      <span aria-label={`Git branch ${gitBranch}`}>{gitBranch}</span>
      <div className="flex items-center gap-2" aria-label="Live sync status">
        <span>Live Sync</span>
        {liveSyncActive && (
          <div
            className="w-2 h-2 bg-secondary rounded-full animate-pulse"
            aria-label="Active"
          />
        )}
      </div>
    </div>
  )
}
