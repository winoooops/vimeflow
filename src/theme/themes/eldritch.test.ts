import { expect, test } from 'vitest'
import { eldritch } from './eldritch'

test('uses the Eldritch Cthulhu palette', () => {
  expect(eldritch).toMatchObject({
    id: 'eldritch',
    label: 'Eldritch',
    kind: 'dark',
    ui: {
      surface: '#212337',
      primary: '#37f499',
    },
    terminal: {
      red: '#f16c75',
      cyan: '#04d1f9',
      magenta: '#a48cf2',
    },
  })
})
