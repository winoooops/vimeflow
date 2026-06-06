#!/usr/bin/env node
// Control-host dispatcher for split-plane QA runner deployments. watch.js runs
// this through QA_FIX_COMMAND only after it classifies a PR as NEEDS_FIX; this
// script forwards the non-secret fixer contract to a local, SSH, or SSM worker
// and exits with the worker's result.
import { pathToFileURL } from 'node:url'
import { runDispatch } from './lib/cloud-dispatch.js'

export const main = async () => {
  const result = await runDispatch()
  process.exitCode = result.code
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main()
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exit(2)
  }
}
