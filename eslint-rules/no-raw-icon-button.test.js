import { RuleTester } from 'eslint'
import { test } from 'vitest'
import rule from './no-raw-icon-button.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: { jsx: true },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

test('no-raw-icon-button', () => {
  ruleTester.run('no-raw-icon-button', rule, {
    valid: [
      // icon + text label (toolbar pill / row / menu item) — not icon-only
      '<button><span className="material-symbols-outlined" />Label</button>',
      // bare icon, no button ancestor
      '<span className="material-symbols-outlined">add</span>',
      // the primitives render the raw pattern; exemption is via config `ignores`, not the rule
    ],
    invalid: [
      {
        code: '<button className="material-symbols-outlined">add</button>',
        errors: [{ messageId: 'rawIconButton' }],
      }, // Shape A
      {
        code: '<button><span className="material-symbols-outlined" aria-hidden="true">close</span></button>',
        errors: [{ messageId: 'rawIconButton' }],
      }, // Shape B
    ],
  })
})
