import type { ReactElement } from 'react'
import { useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import type { TestResult } from '../../types'

interface TestsProps {
  testResults: TestResult[]
}

const Tests = ({ testResults }: TestsProps): ReactElement => {
  const [isExpanded, setIsExpanded] = useState(false)

  const getTotalCounts = (): { passed: number; total: number } =>
    testResults.reduce(
      (acc, result) => ({
        passed: acc.passed + result.passed,
        total: acc.total + result.total,
      }),
      { passed: 0, total: 0 }
    )

  const getCountBadge = (): string => {
    const { passed, total } = getTotalCounts()

    return `${passed}/${total}`
  }

  const countDisplay = testResults.length > 0 ? getCountBadge() : undefined

  return (
    <CollapsibleSection
      title="Tests"
      count={testResults.length}
      customCountDisplay={countDisplay}
      isExpanded={isExpanded}
      onToggle={(): void => setIsExpanded(!isExpanded)}
    >
      <div data-testid="tests-list" className="flex flex-col gap-2">
        {testResults.map((result) => {
          const hasFailed = result.failed > 0
          const summaryColor = hasFailed ? 'text-error' : 'text-success'

          return (
            <div
              key={result.id}
              data-testid="test-entry"
              className="flex flex-col gap-1 font-label"
            >
              <div className="flex items-center justify-between">
                <span className="text-on-surface">{result.file}</span>
                <span className={summaryColor}>
                  {result.passed} passed, {result.failed} failed ({result.total}{' '}
                  total)
                </span>
              </div>

              {hasFailed && result.failures.length > 0 && (
                <div className="ml-4 flex flex-col gap-1">
                  {result.failures.map((failure) => (
                    <div
                      key={failure.id}
                      className="flex flex-col gap-0.5 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-on-surface">{failure.name}</span>
                        <span className="text-on-surface/60">
                          {failure.file}:{failure.line}
                        </span>
                      </div>
                      <span className="text-on-surface/60">
                        {failure.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </CollapsibleSection>
  )
}

export default Tests
