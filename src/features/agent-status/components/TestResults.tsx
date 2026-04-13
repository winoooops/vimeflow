import type { ReactElement } from 'react'
import { CollapsibleSection } from './CollapsibleSection'

interface TestResultsProps {
  passed: number
  failed: number
  total: number
}

export const TestResults = ({
  passed,
  failed,
  total,
}: TestResultsProps): ReactElement => {
  const allPassed = failed === 0 && total > 0

  const segments = Array.from({ length: total }, (_, i) =>
    i < passed ? 'pass' : 'fail'
  )

  return (
    <CollapsibleSection title="Tests" count={`${passed}/${total}`}>
      <div className="flex flex-col gap-2">
        <div className="flex gap-0.5">
          {segments.map((type, i) => (
            <div
              key={i}
              className={`h-[3px] flex-1 rounded-full ${
                type === 'pass' ? 'bg-success' : 'bg-error/40'
              }`}
              data-testid={`segment-${type}`}
            />
          ))}
        </div>
        <span
          className={`font-mono text-[10px] font-bold ${
            allPassed ? 'text-success' : 'text-warning'
          }`}
        >
          {passed} passed, {failed} failed
        </span>
      </div>
    </CollapsibleSection>
  )
}
