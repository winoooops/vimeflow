import { expect, test } from 'vitest'
import { nord } from './nord'

test('uses the Nord palette', () => {
  expect(nord).toMatchObject({
    id: 'nord',
    label: 'Nord',
    kind: 'dark',
    ui: {
      surface: '#2e3440',
      primary: '#88c0d0',
      'on-surface-variant': '#cdd3df',
    },
    terminal: {
      red: '#bf616a',
      green: '#a3be8c',
      blue: '#81a1c1',
    },
  })
})
