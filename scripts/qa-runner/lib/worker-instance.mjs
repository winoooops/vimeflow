import { execFileSync } from 'node:child_process'

const envParameterName = () => process.env.QA_WORKER_INSTANCE_ID_PARAMETER
const envLegacyId = () => process.env.QA_WORKER_INSTANCE_ID
const envRegion = () => process.env.QA_WORKER_REGION

let cachedId
let cachedError
let hasCache = false

const resolveAndCache = () => {
  const parameterName = envParameterName()
  if (!parameterName) {
    cachedId = envLegacyId() || null
    hasCache = true
    return cachedId
  }
  const args = [
    'ssm',
    'get-parameter',
    '--name',
    parameterName,
    '--query',
    'Parameter.Value',
    '--output',
    'text',
  ]
  const region = envRegion()
  if (region) {
    args.push('--region', region)
  }
  try {
    cachedId = execFileSync('aws', args, {
      encoding: 'utf8',
      timeout: 10000,
    }).trim()
    hasCache = true
    cachedError = undefined
    return cachedId
  } catch (e) {
    cachedError = new Error(
      `Failed to resolve worker instance ID from ${parameterName}: ${e.message}`
    )
    hasCache = true
    throw cachedError
  }
}

export const resolveWorkerInstanceId = () => {
  if (hasCache) {
    if (cachedError) throw cachedError
    return cachedId
  }
  return resolveAndCache()
}
