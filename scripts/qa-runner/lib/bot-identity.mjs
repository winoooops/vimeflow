// Shared bot-identity loader for the QA runner's two roles:
//   inner / fixer        → bot.env          (GH_BOT_*)   — used by run.mjs (kimi)
//   outer / orchestrator → orchestrator.env  (GH_ORCH_*)  — used by watch.mjs (merge)
//
// Each file holds a separate GitHub account so the bot that WRITES the fix is a
// distinct identity from the bot that MERGES it — author ≠ approver, which also
// satisfies "require approval from a non-author" branch protection. Absent or
// placeholder ⇒ null, so callers transparently fall back to the ambient `gh`.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Read `<scriptDir>/<file>` and pull the `<prefix>_TOKEN|USER|EMAIL` keys.
export const loadBot = (scriptDir, file, prefix) => {
  const f = join(scriptDir, file)
  if (!existsSync(f)) return null
  const want = new Set([`${prefix}_TOKEN`, `${prefix}_USER`, `${prefix}_EMAIL`])
  const env = {}
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.+?)\s*$/)
    if (m && want.has(m[1])) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  const token = env[`${prefix}_TOKEN`]
  const user = env[`${prefix}_USER`]
  const email = env[`${prefix}_EMAIL`]
  if (!token || !user || !email || token.includes('xxxx')) return null
  return { token, user, email }
}

// Env overlay so a child's gh/git act as the bot (gh honors GH_TOKEN; git honors
// the author/committer vars). Empty object when no bot ⇒ spread is a no-op.
export const botEnv = (bot) =>
  bot
    ? {
        GH_TOKEN: bot.token,
        GIT_AUTHOR_NAME: bot.user,
        GIT_AUTHOR_EMAIL: bot.email,
        GIT_COMMITTER_NAME: bot.user,
        GIT_COMMITTER_EMAIL: bot.email,
      }
    : {}

// A full process-env for a child running as the bot, or undefined to inherit.
export const botProcessEnv = (bot) =>
  bot ? { ...process.env, ...botEnv(bot) } : undefined

export const botLabel = (bot, fallback = 'you') => (bot ? bot.user : fallback)
