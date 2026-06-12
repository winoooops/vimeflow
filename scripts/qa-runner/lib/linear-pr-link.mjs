#!/usr/bin/env node
// Ensure a PR has a Linear issue identifier in its body. If the PR body lacks a
// VIM-N reference, find/create a Linear issue and patch the PR body with `Refs`.

import { execFileSync } from 'node:child_process'
import {
  createIssueForPr,
  findIssueForPr,
  loadKey,
  teamByKey,
} from './linear-client.mjs'
import { bodyWithLinearReference, linkedVim } from './pr-utils.mjs'

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...opts,
  })

const ghJson = (args, opts) => JSON.parse(sh('gh', args, opts))

const patchPrBody = (repo, prNumber, body) => {
  sh(
    'gh',
    [
      'api',
      '--method',
      'PATCH',
      `repos/${repo}/pulls/${prNumber}`,
      '--input',
      '-',
    ],
    { input: JSON.stringify({ body }) }
  )
}

const main = async () => {
  const argv = process.argv.slice(2)
  const prNumber = Number(argv.find((a) => /^\d+$/.test(a)))
  if (!prNumber) {
    throw new Error('usage: linear-pr-link.mjs <PR#> [--team VIM]')
  }
  const teamArg = argv.indexOf('--team')
  const teamKey = teamArg >= 0 ? argv[teamArg + 1] : 'VIM'
  if (!teamKey) throw new Error('--team requires a Linear team key')

  const pr = ghJson([
    'pr',
    'view',
    String(prNumber),
    '--json',
    'number,title,body,url,headRefName',
  ])
  const existing = linkedVim(pr.body)
  if (existing) {
    process.stdout.write(
      JSON.stringify({
        identifier: existing,
        created: false,
        prPatched: false,
        alreadyLinked: true,
      }) + '\n'
    )
    return
  }

  const repo = ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner
  const key = loadKey()
  const team = await teamByKey(key, teamKey)
  let issue = await findIssueForPr(key, {
    teamKey,
    prNumber,
    prUrl: pr.url,
  })
  const created = !issue
  if (!issue) {
    issue = await createIssueForPr(key, {
      teamId: team.id,
      prNumber,
      title: pr.title,
      url: pr.url,
      headRefName: pr.headRefName,
      repo,
    })
  }

  const nextBody = bodyWithLinearReference(pr.body, issue.identifier)
  patchPrBody(repo, prNumber, nextBody)
  process.stdout.write(
    JSON.stringify({
      identifier: issue.identifier,
      created,
      prPatched: true,
      alreadyLinked: false,
      issueUrl: issue.url,
    }) + '\n'
  )
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`)
  process.exit(1)
})
