import { Menu, type MenuItemConstructorOptions } from 'electron'

export const createApplicationMenuTemplate = (
  platform = process.platform
): MenuItemConstructorOptions[] => {
  if (platform !== 'darwin') {
    return []
  }

  return [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help' },
  ]
}

export const installApplicationEditMenu = (
  platform = process.platform
): void => {
  const template = createApplicationMenuTemplate(platform)
  if (template.length === 0) {
    return
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
