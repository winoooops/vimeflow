import { expect, test } from 'vitest'
import { ayu } from './ayu'

test('uses the Ayu Mirage palette', () => {
  expect(ayu).toMatchObject({
    id: 'ayu',
    label: 'Ayu',
    kind: 'dark',
    ui: {
      surface: '#1f2430',
      primary: '#ffcd66',
    },
    terminal: {
      red: '#f28779',
      green: '#d5ff80',
      blue: '#73d0ff',
    },
  })
})
