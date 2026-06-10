import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Menu } from 'electron'
import {
  createApplicationMenuTemplate,
  installApplicationEditMenu,
} from './edit-menu'

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: vi.fn((template: unknown) => ({ template })),
    setApplicationMenu: vi.fn(),
  },
}))

const menuMock = Menu as unknown as {
  buildFromTemplate: ReturnType<typeof vi.fn>
  setApplicationMenu: ReturnType<typeof vi.fn>
}

describe('application edit menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates a macOS app menu with standard native roles', () => {
    const template = createApplicationMenuTemplate('darwin')

    expect(template[0]).toEqual({ role: 'appMenu' })
    expect(template[1]).toEqual({ role: 'fileMenu' })
    expect(template[2]).toEqual({ role: 'editMenu' })
    expect(template).toContainEqual({ role: 'viewMenu' })
    expect(template).toContainEqual({ role: 'windowMenu' })
    expect(template).toContainEqual({ role: 'help' })
  })

  test('installs the native edit menu roles on macOS', () => {
    installApplicationEditMenu('darwin')

    expect(menuMock.buildFromTemplate).toHaveBeenCalledWith([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      { role: 'help' },
    ])

    expect(menuMock.setApplicationMenu).toHaveBeenCalledWith({
      template: [
        { role: 'appMenu' },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
        { role: 'help' },
      ],
    })
  })

  test('leaves non-mac application menus unchanged', () => {
    expect(createApplicationMenuTemplate('linux')).toEqual([])

    installApplicationEditMenu('linux')

    expect(menuMock.buildFromTemplate).not.toHaveBeenCalled()
    expect(menuMock.setApplicationMenu).not.toHaveBeenCalled()
  })
})
