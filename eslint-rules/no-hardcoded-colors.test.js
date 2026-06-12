// eslint-rules/no-hardcoded-colors.test.js
import { RuleTester } from 'eslint'
import rule from './no-hardcoded-colors.js'

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

tester.run('no-hardcoded-colors', rule, {
  valid: [
    { code: "const c = 'var(--color-primary)'" },
    {
      code: "const c = 'color-mix(in srgb, var(--color-primary) 25%, transparent)'",
    },
    { code: "const cls = 'bg-surface text-on-surface hover:bg-wash-subtle'" },
    { code: "const cls = 'text-vcs-modified shadow-pane-focus'" },
  ],
  invalid: [
    { code: "const c = '#cba6f7'", errors: [{ messageId: 'hardcoded' }] },
    {
      code: "const c = 'rgba(0,0,0,0.4)'",
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: 'const c = `0 0 0 6px rgb(203 166 247 / 0.16)`',
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: "const cls = 'text-amber-400'",
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: "const cls = 'hover:bg-white/5'",
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: "const cls = 'border-white/[0.08]'",
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: "const cls = 'from-white/5'",
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: "const cls = 'via-black'",
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: "const cls = 'to-white/20'",
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: "const cls = 'shadow-[0_10px_28px_rgba(0,0,0,0.4)]'",
      errors: [{ messageId: 'hardcoded' }],
    },
  ],
})
