// cspell:ignore busctl osssa
import {
  BrowserWindow,
  dialog,
  type IpcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DIALOG_PICK_DIRECTORY } from './ipc-channels'

type LinuxDirectoryPicker = () => Promise<string | null>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value)

export const parseLinuxDirectoryReply = (stdout: string): string | null => {
  const reply: unknown = JSON.parse(stdout)

  if (!isRecord(reply) || !isUnknownArray(reply.data)) {
    throw new Error('invalid GTK portal directory response')
  }

  const response: unknown = reply.data[0]
  const results: unknown = reply.data[1]

  if (response !== 0) {
    return null
  }

  if (!isRecord(results) || !isRecord(results.uris)) {
    throw new Error('invalid GTK portal directory response')
  }

  const uris = results.uris.data

  if (
    !isUnknownArray(uris) ||
    uris.length === 0 ||
    typeof uris[0] !== 'string' ||
    !uris[0].startsWith('file:')
  ) {
    throw new Error('invalid GTK portal directory response')
  }

  return fileURLToPath(uris[0])
}

const runGtkPortalDirectoryPicker = (): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const token = `vimeflow_${String(process.pid)}_${String(Date.now())}`
    const handle = `/org/freedesktop/portal/desktop/request/vimeflow/${token}`

    execFile(
      'busctl',
      [
        '--user',
        '--json=short',
        '--timeout=0',
        'call',
        'org.freedesktop.impl.portal.desktop.gtk',
        '/org/freedesktop/portal/desktop',
        'org.freedesktop.impl.portal.FileChooser',
        'OpenFile',
        'osssa{sv}',
        handle,
        'io.vimeflow.app',
        '',
        'Choose working directory',
        '2',
        'directory',
        'b',
        'true',
        'modal',
        'b',
        'true',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(error.message, { cause: error }))

          return
        }

        try {
          resolve(parseLinuxDirectoryReply(stdout))
        } catch (parseError) {
          reject(
            parseError instanceof Error
              ? parseError
              : new Error(String(parseError))
          )
        }
      }
    )
  })

const isKdeDesktop = (): boolean =>
  process.env.XDG_CURRENT_DESKTOP?.toLowerCase().includes('kde') === true

// Native OS directory picker. Returns the absolute path, or null on cancel.
export const setupDialogIpc = (
  ipcMain: IpcMain,
  platform: NodeJS.Platform = process.platform,
  pickLinuxDirectory: LinuxDirectoryPicker = runGtkPortalDirectoryPicker
): void => {
  ipcMain.handle(
    DIALOG_PICK_DIRECTORY,
    async (event: IpcMainInvokeEvent): Promise<string | null> => {
      if (platform === 'linux' && !isKdeDesktop()) {
        try {
          return await pickLinuxDirectory()
        } catch {
          // GTK portal backend or busctl unavailable; Electron can still use
          // the desktop's configured portal (notably KDE).
        }
      }

      const win =
        BrowserWindow.fromWebContents(event.sender) ??
        BrowserWindow.getFocusedWindow()

      const options: OpenDialogOptions = {
        properties:
          platform === 'darwin'
            ? ['openDirectory', 'createDirectory']
            : ['openDirectory'],
        title: 'Choose working directory',
      }

      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)

      return result.canceled || result.filePaths.length === 0
        ? null
        : result.filePaths[0]
    }
  )
}
