import { execFileSync } from 'node:child_process'

const envParameterName = () => process.env.QA_WORKER_INSTANCE_ID_PARAMETER
const envLegacyId = () => process.env.QA_WORKER_INSTANCE_ID
const envRegion = () => process.env.QA_WORKER_REGION

export const resolveWorkerInstanceId = () => {
  const parameterName = envParameterName()
  if (!parameterName) {
    return envLegacyId() || null
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
    return execFileSync('aws', args, {
      encoding: 'utf8',
      timeout: 10000,
    }).trim()
  } catch (e) {
    throw new Error(
      `Failed to resolve worker instance ID from ${parameterName}: ${e.message}`
    )
  }
}
