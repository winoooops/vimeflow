import { expect, test } from 'vitest'
import { rosePine } from './rose-pine'

test('uses the Rosé Pine palette', () => {
  expect(rosePine).toMatchObject({
    id: 'rose-pine',
    label: 'Rosé Pine',
    kind: 'dark',
    ui: {
      surface: '#1f1d2e',
      primary: '#c4a7e7',
    },
    terminal: {
      red: '#eb6f92',
      yellow: '#f6c177',
      blue: '#31748f',
    },
  })
})
