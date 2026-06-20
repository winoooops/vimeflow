import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const roots = []
const script = join(import.meta.dirname, 'git-credential-helper.js')

const tempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-git-credential-helper-'))
  roots.push(root)

  return root
}

afterEach(() => {
  while (roots.length) {
    rmSync(roots.pop(), { recursive: true, force: true })
  }
})

const runHelper = (botEnvPath, input) =>
  execFileSync('node', [script, botEnvPath, 'GH_BOT', 'get'], {
    input,
    encoding: 'utf8',
  })

describe('git credential helper', () => {
  test('emits x-access-token credentials for github https', () => {
    const root = tempRoot()
    const botEnv = join(root, 'bot.env')
    writeFileSync(
      botEnv,
      [
        'GH_BOT_TOKEN=ghp_fixture_token',
        'GH_BOT_USER=fixture-bot',
        'GH_BOT_EMAIL=bot@example.com',
        '',
      ].join('\n')
    )

    expect(runHelper(botEnv, 'protocol=https\nhost=github.com\n\n')).toEqual(
      'username=x-access-token\npassword=ghp_fixture_token\n\n'
    )
  })

  test('ignores non-github hosts', () => {
    const root = tempRoot()
    const botEnv = join(root, 'bot.env')
    writeFileSync(
      botEnv,
      [
        'GH_BOT_TOKEN=ghp_fixture_token',
        'GH_BOT_USER=fixture-bot',
        'GH_BOT_EMAIL=bot@example.com',
        '',
      ].join('\n')
    )

    expect(runHelper(botEnv, 'protocol=https\nhost=example.com\n\n')).toBe('')
  })
})
