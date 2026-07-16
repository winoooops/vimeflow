import { beforeEach, describe, expect, test, vi } from 'vitest'
import { parseLinuxDirectoryReply, setupDialogIpc } from './dialog-ipc'
import { DIALOG_PICK_DIRECTORY } from './ipc-channels'

const dialog = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))

const browserWindow = vi.hoisted(() => ({
  fromWebContents: vi.fn(() => null),
  getFocusedWindow: vi.fn(() => null),
}))

vi.mock('electron', () => ({ dialog, BrowserWindow: browserWindow }))

describe('setupDialogIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dialog.showOpenDialog.mockReset()
  })

  const register = (
    platform: NodeJS.Platform = 'darwin',
    pickLinuxDirectory = vi.fn<() => Promise<string | null>>()
  ): ((e: unknown) => Promise<string | null>) => {
    const handlers = new Map<string, (e: unknown) => Promise<string | null>>()

    const ipcMain = {
      handle: vi.fn(
        (channel: string, fn: (e: unknown) => Promise<string | null>) => {
          handlers.set(channel, fn)
        }
      ),
    }
    setupDialogIpc(ipcMain as never, platform, pickLinuxDirectory)
    const handler = handlers.get(DIALOG_PICK_DIRECTORY)
    if (!handler) {
      throw new Error('handler not registered')
    }

    return handler
  }

  test('returns the chosen directory path from Electron', async () => {
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

  test('uses the GTK portal backend directly on non-KDE Linux', async () => {
    const pickLinuxDirectory = vi.fn().mockResolvedValue('/home/x/proj')
    const handler = register('linux', pickLinuxDirectory)
    await expect(handler({ sender: {} })).resolves.toBe('/home/x/proj')
    expect(pickLinuxDirectory).toHaveBeenCalledOnce()
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  test('falls back to Electron when the GTK portal backend is unavailable', async () => {
    const pickLinuxDirectory = vi
      .fn()
      .mockRejectedValue(new Error('GTK backend unavailable'))
    dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/home/x/proj'],
    })
    const handler = register('linux', pickLinuxDirectory)
    await expect(handler({ sender: {} })).resolves.toBe('/home/x/proj')
    expect(dialog.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      title: 'Choose working directory',
    })
  })

  test('returns null when canceled', async () => {
    dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const handler = register('darwin')
    await expect(handler({ sender: {} })).resolves.toBeNull()
  })

  test('uses Electron directly on KDE Linux', async () => {
    dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/home/x/proj'],
    })
    const pickLinuxDirectory = vi.fn().mockResolvedValue('/wrong/backend')
    const previousDesktop = process.env.XDG_CURRENT_DESKTOP
    process.env.XDG_CURRENT_DESKTOP = 'KDE'

    try {
      const handler = register('linux', pickLinuxDirectory)
      await expect(handler({ sender: {} })).resolves.toBe('/home/x/proj')
      expect(pickLinuxDirectory).not.toHaveBeenCalled()
    } finally {
      if (previousDesktop === undefined) {
        delete process.env.XDG_CURRENT_DESKTOP
      } else {
        process.env.XDG_CURRENT_DESKTOP = previousDesktop
      }
    }
  })
})

describe('parseLinuxDirectoryReply', () => {
  test('returns the selected file URI as an absolute path', () => {
    expect(
      parseLinuxDirectoryReply(
        JSON.stringify({
          type: 'ua{sv}',
          data: [
            0,
            {
              uris: {
                type: 'as',
                data: ['file:///home/will/My%20Project'],
              },
            },
          ],
        })
      )
    ).toBe('/home/will/My Project')
  })

  test('returns null when the picker is canceled', () => {
    expect(
      parseLinuxDirectoryReply(
        JSON.stringify({
          type: 'ua{sv}',
          data: [
            2,
            {
              uris: {
                type: 'as',
                data: [],
              },
            },
          ],
        })
      )
    ).toBeNull()
  })

  test('rejects malformed portal replies', () => {
    expect(() =>
      parseLinuxDirectoryReply(
        JSON.stringify({
          type: 'ua{sv}',
          data: [
            0,
            {
              uris: {
                type: 'as',
                data: ['https://example.com/not-a-directory'],
              },
            },
          ],
        })
      )
    ).toThrow('invalid GTK portal directory response')
  })
})
