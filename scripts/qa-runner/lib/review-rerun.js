import { runIdFromCheck } from './ci-policy.js'
import {
  readRerunStore,
  rerunKey,
  rerunStatus,
  rerunStorePath,
} from './rerun-state.js'

const defaultStatusForCheck = ({ pr, check, headSha, maxCiReruns }) => {
  const storeFile = rerunStorePath(pr)
  const store = readRerunStore(storeFile)
  const key = rerunKey({ pr, headSha, check })

  return rerunStatus({ store, key, max: maxCiReruns })
}

export const pickReviewRerunCheck = ({
  pr,
  checks,
  headSha,
  maxCiReruns,
  statusForCheck = defaultStatusForCheck,
}) => {
  let firstOpen = null
  for (const check of checks) {
    const status = statusForCheck({ pr, check, headSha, maxCiReruns })
    if (status.exhausted) {
      continue
    }
    if (runIdFromCheck(check)) {
      return check
    }

    firstOpen ||= check
  }

  return firstOpen || checks[0]
}
