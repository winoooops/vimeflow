import type { Command } from '../types'

/**
 * Default command tree with stubbed execute handlers.
 * All leaf commands log their action to console.info.
 */
export const defaultCommands: Command[] = [
  {
    id: 'open',
    label: ':open',
    description: 'Open a file or recent item',
    icon: 'folder',
    children: [
      {
        id: 'open-filename',
        label: '<filename>',
        description: 'Open file by name (fuzzy search)',
        icon: 'description',
        execute: (args: string): void => {
          // eslint-disable-next-line no-console
          console.info('Opening file:', args || '(no filename provided)')
        },
      },
      {
        id: 'open-recent',
        label: 'recent',
        description: 'Show recently opened files',
        icon: 'history',
        execute: (): void => {
          // eslint-disable-next-line no-console
          console.info('Showing recently opened files')
        },
      },
    ],
  },
  {
    id: 'set',
    label: ':set',
    description: 'Change editor settings',
    icon: 'settings',
    children: [
      {
        id: 'set-theme',
        label: 'theme',
        description: 'Switch color theme',
        icon: 'palette',
        execute: (): void => {
          // eslint-disable-next-line no-console
          console.info('Switching color theme')
        },
      },
      {
        id: 'set-font',
        label: 'font',
        description: 'Change editor font',
        icon: 'text_fields',
        execute: (): void => {
          // eslint-disable-next-line no-console
          console.info('Changing editor font')
        },
      },
    ],
  },
  {
    id: 'help',
    label: ':help',
    description: 'Show command reference',
    icon: 'help',
    execute: (): void => {
      // eslint-disable-next-line no-console
      console.info('Showing command reference')
    },
  },
  {
    id: 'new',
    label: ':new',
    description: 'Create new conversation',
    icon: 'add',
    execute: (): void => {
      // eslint-disable-next-line no-console
      console.info('Creating new conversation')
    },
  },
]
