#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { loadBotFile } from './bot-identity.js'

const [botEnvPath, prefix = 'GH_BOT', operation = 'get'] = process.argv.slice(2)

if (operation !== 'get' || !botEnvPath) {
  process.exit(0)
}

const fields = Object.fromEntries(
  readFileSync(0, 'utf8')
    .split('\n')
    .map((line) => line.split('='))
    .filter(([key, value]) => key && value)
)

if (fields.protocol !== 'https' || fields.host !== 'github.com') {
  process.exit(0)
}

const bot = loadBotFile(botEnvPath, prefix)
if (!bot) {
  process.exit(0)
}

process.stdout.write(`username=x-access-token\npassword=${bot.token}\n\n`)
