import {
  BrowserWindow,
  dialog,
  type IpcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron'
import { DIALOG_PICK_DIRECTORY } from './ipc-channels'

// Native OS directory picker. Returns the absolute path, or null on cancel.
export const setupDialogIpc = (ipcMain: IpcMain): void => {
  ipcMain.handle(
    DIALOG_PICK_DIRECTORY,
    async (event: IpcMainInvokeEvent): Promise<string | null> => {
      const win =
        BrowserWindow.fromWebContents(event.sender) ??
        BrowserWindow.getFocusedWindow()

      const options: OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
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
