import { ESLint } from 'eslint'
import { test, expect } from 'vitest'

const RULE_ID = 'vimeflow/no-raw-icon-button'

// Shape A: glyph class on the <button> itself.
const SHAPE_A =
  'const x = <button className="material-symbols-outlined">add</button>\n'

const lint = async (filePath) => {
  // Lint through the real eslint.config.js so we exercise the actual
  // plugin registration + file scoping (not a synthetic config).
  const eslint = new ESLint()
  const [result] = await eslint.lintText(SHAPE_A, { filePath })

  return result.messages.filter((m) => m.ruleId === RULE_ID)
}

test('rule fires on a non-components source file', async () => {
  // projectService rejects non-existent files — use a real path.
  const messages = await lint('src/App.tsx')
  expect(messages.length).toBeGreaterThan(0)
})

test('rule is exempt inside src/components', async () => {
  const messages = await lint('src/components/Tooltip.tsx')
  expect(messages).toHaveLength(0)
})
