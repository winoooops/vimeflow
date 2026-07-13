// cspell:ignore togglefullscreen
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Menu, type MenuItemConstructorOptions } from 'electron'
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

const viewSubmenuRoles = (
  template: MenuItemConstructorOptions[]
): (string | undefined)[] => {
  const view = template.find((item) => item.label === 'View')
  expect(view).toBeDefined()

  return (view?.submenu as MenuItemConstructorOptions[]).map(
    (item) => item.role
  )
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
    expect(template).toContainEqual({ role: 'windowMenu' })
    expect(template).toContainEqual({ role: 'help' })
  })

  test('View menu drops Reload and page-zoom accelerators (VIM-306 / shortcut hygiene)', () => {
    const roles = viewSubmenuRoles(createApplicationMenuTemplate('darwin'))

    // Cmd+R / Cmd+Shift+R collide with in-app shortcuts; Cmd+± page zoom is the
    // VIM-306 re-entry path. None should be exposed as a menu accelerator.
    expect(roles).not.toContain('reload')
    expect(roles).not.toContain('forceReload')
    expect(roles).not.toContain('zoomIn')
    expect(roles).not.toContain('zoomOut')
    expect(roles).not.toContain('resetZoom')

    // The harmless, non-colliding actions stay available.
    expect(roles).toContain('togglefullscreen')
    expect(roles).toContain('toggleDevTools')
  })

  test('installs the trimmed application menu on macOS', () => {
    installApplicationEditMenu('darwin')

    const template = menuMock.buildFromTemplate.mock
      .calls[0][0] as MenuItemConstructorOptions[]
    expect(template.map((item) => item.role ?? item.label)).toEqual([
      'appMenu',
      'fileMenu',
      'editMenu',
      'View',
      'windowMenu',
      'help',
    ])
    expect(viewSubmenuRoles(template)).not.toContain('reload')

    expect(menuMock.setApplicationMenu).toHaveBeenCalledWith({ template })
  })

  test('leaves non-mac application menus unchanged', () => {
    expect(createApplicationMenuTemplate('linux')).toEqual([])

    installApplicationEditMenu('linux')

    expect(menuMock.buildFromTemplate).not.toHaveBeenCalled()
    expect(menuMock.setApplicationMenu).not.toHaveBeenCalled()
  })
})
