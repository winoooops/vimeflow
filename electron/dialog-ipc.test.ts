import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setupDialogIpc } from './dialog-ipc'
import { DIALOG_PICK_DIRECTORY } from './ipc-channels'

const dialog = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))

const browserWindow = vi.hoisted(() => ({
  fromWebContents: vi.fn(() => null),
  getFocusedWindow: vi.fn(() => null),
}))

vi.mock('electron', () => ({ dialog, BrowserWindow: browserWindow }))

describe('setupDialogIpc', () => {
  beforeEach(() => vi.clearAllMocks())

  const register = (): ((e: unknown) => Promise<string | null>) => {
    const handlers = new Map<string, (e: unknown) => Promise<string | null>>()

    const ipcMain = {
      handle: vi.fn(
        (channel: string, fn: (e: unknown) => Promise<string | null>) => {
          handlers.set(channel, fn)
        }
      ),
    }
    setupDialogIpc(ipcMain as never)
    const handler = handlers.get(DIALOG_PICK_DIRECTORY)
    if (!handler) {
      throw new Error('handler not registered')
    }

    return handler
  }

  test('returns the chosen directory path', async () => {
    dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/Users/x/proj'],
    })
    const handler = register()
    await expect(handler({ sender: {} })).resolves.toBe('/Users/x/proj')
    // No focused window in this test → the single-arg overload is used.
    expect(dialog.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose working directory',
    })
  })

  test('returns null when canceled', async () => {
    dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const handler = register()
    await expect(handler({ sender: {} })).resolves.toBeNull()
  })
})
