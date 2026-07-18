import { expect, test } from 'vitest'
import { kanagawa } from './kanagawa'

test('uses the Kanagawa Wave palette', () => {
  expect(kanagawa).toMatchObject({
    id: 'kanagawa',
    label: 'Kanagawa',
    kind: 'dark',
    ui: {
      surface: '#1f1f28',
      primary: '#957fb8',
    },
    terminal: {
      red: '#e46876',
      green: '#98bb6c',
      blue: '#7e9cd8',
    },
  })
})
