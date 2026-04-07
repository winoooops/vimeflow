import { render, screen, within } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import Tests from './Tests'
import type { TestResult } from '../../types'

const mockTestResults: TestResult[] = [
  {
    id: 'tr-1',
    file: 'src/auth/middleware.test.ts',
    passed: 4,
    failed: 1,
    total: 5,
    failures: [
      {
        id: 'tf-1',
        name: 'should reject invalid tokens',
        file: 'src/auth/middleware.test.ts',
        line: 45,
        message: 'Expected 401 but received 500',
      },
    ],
    timestamp: '2026-04-07T03:48:00Z',
  },
  {
    id: 'tr-2',
    file: 'src/routes/auth.test.ts',
    passed: 8,
    failed: 0,
    total: 8,
    failures: [],
    timestamp: '2026-04-07T03:48:15Z',
  },
]

describe('Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    test('renders CollapsibleSection with "Tests" title', () => {
      render(<Tests testResults={mockTestResults} />)

      expect(screen.getByText('Tests')).toBeInTheDocument()
    })

    test('shows pass/fail ratio in section header', () => {
      render(<Tests testResults={mockTestResults} />)

      expect(screen.getByText('(12/13)')).toBeInTheDocument()
    })

    test('is collapsed by default', () => {
      render(<Tests testResults={mockTestResults} />)

      expect(screen.getByText('▸')).toBeInTheDocument()
      expect(screen.queryByText('▾')).not.toBeInTheDocument()
    })

    test('does not render test results when collapsed', () => {
      render(<Tests testResults={mockTestResults} />)

      expect(
        screen.queryByText('src/auth/middleware.test.ts')
      ).not.toBeInTheDocument()

      expect(
        screen.queryByText('src/routes/auth.test.ts')
      ).not.toBeInTheDocument()
    })

    test('renders empty state with no count badge', () => {
      render(<Tests testResults={[]} />)

      expect(screen.getByText('Tests')).toBeInTheDocument()
      expect(screen.queryByText(/\(\d+\/\d+\)/)).not.toBeInTheDocument()
    })
  })

  describe('Test Summary', () => {
    test('displays file names for each test result', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      expect(
        screen.getByText('src/auth/middleware.test.ts')
      ).toBeInTheDocument()
      expect(screen.getByText('src/routes/auth.test.ts')).toBeInTheDocument()
    })

    test('displays passed/failed/total counts for each test file', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      expect(
        screen.getByText('4 passed, 1 failed (5 total)')
      ).toBeInTheDocument()

      expect(
        screen.getByText('8 passed, 0 failed (8 total)')
      ).toBeInTheDocument()
    })

    test('applies success color for all-passing test files', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      const testEntries = screen.getAllByTestId('test-entry')
      const passingEntry = testEntries[1]

      const summary = within(passingEntry).getByText(
        '8 passed, 0 failed (8 total)'
      )

      expect(summary).toHaveClass('text-success')
    })

    test('applies error color for failing test files', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      const testEntries = screen.getAllByTestId('test-entry')
      const failingEntry = testEntries[0]

      const summary = within(failingEntry).getByText(
        '4 passed, 1 failed (5 total)'
      )

      expect(summary).toHaveClass('text-error')
    })
  })

  describe('Test Failures', () => {
    test('displays failure details for failed tests', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      expect(
        screen.getByText('should reject invalid tokens')
      ).toBeInTheDocument()

      expect(
        screen.getByText('src/auth/middleware.test.ts:45')
      ).toBeInTheDocument()

      expect(
        screen.getByText('Expected 401 but received 500')
      ).toBeInTheDocument()
    })

    test('does not display failure details for passing tests', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      const testEntries = screen.getAllByTestId('test-entry')

      expect(testEntries).toHaveLength(2)
      expect(testEntries[1].textContent).not.toContain('failure')
    })

    test('applies muted color to failure messages', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      const failureMessage = screen.getByText('Expected 401 but received 500')

      expect(failureMessage).toHaveClass('text-on-surface/60')
    })
  })

  describe('Interaction', () => {
    test('expands when header clicked', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      expect(screen.getByText('▸')).toBeInTheDocument()
      expect(
        screen.queryByText('src/auth/middleware.test.ts')
      ).not.toBeInTheDocument()

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      expect(screen.getByText('▾')).toBeInTheDocument()
      expect(
        screen.getByText('src/auth/middleware.test.ts')
      ).toBeInTheDocument()
    })

    test('collapses when clicking expanded section', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)
      expect(screen.getByText('▾')).toBeInTheDocument()
      expect(
        screen.getByText('src/auth/middleware.test.ts')
      ).toBeInTheDocument()

      await user.click(sectionHeader)
      expect(screen.getByText('▸')).toBeInTheDocument()
      expect(
        screen.queryByText('src/auth/middleware.test.ts')
      ).not.toBeInTheDocument()
    })
  })

  describe('Layout and Styling', () => {
    test('applies proper spacing between test entries', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      const testsList = screen.getByTestId('tests-list')

      expect(testsList).toHaveClass('gap-2')
    })

    test('applies flex layout to test entries', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      const testsList = screen.getByTestId('tests-list')

      expect(testsList).toHaveClass('flex')
      expect(testsList).toHaveClass('flex-col')
    })

    test('uses font-label for text', async () => {
      const user = userEvent.setup()

      render(<Tests testResults={mockTestResults} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      const testEntry = screen.getAllByTestId('test-entry')[0]

      expect(testEntry).toHaveClass('font-label')
    })
  })

  describe('Edge Cases', () => {
    test('handles single test result', () => {
      const singleResult: TestResult[] = [mockTestResults[0]]

      render(<Tests testResults={singleResult} />)

      expect(screen.getByText('(4/5)')).toBeInTheDocument()
    })

    test('handles all tests passing', async () => {
      const user = userEvent.setup()

      const allPassing: TestResult[] = [
        {
          id: 'tr-all-pass',
          file: 'src/app.test.ts',
          passed: 10,
          failed: 0,
          total: 10,
          failures: [],
          timestamp: '2026-04-07T03:50:00Z',
        },
      ]

      render(<Tests testResults={allPassing} />)

      expect(screen.getByText('(10/10)')).toBeInTheDocument()

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      const summary = screen.getByText('10 passed, 0 failed (10 total)')

      expect(summary).toHaveClass('text-success')
    })

    test('handles multiple failures in single test file', async () => {
      const user = userEvent.setup()

      const multipleFailures: TestResult[] = [
        {
          id: 'tr-multi-fail',
          file: 'src/complex.test.ts',
          passed: 2,
          failed: 3,
          total: 5,
          failures: [
            {
              id: 'tf-1',
              name: 'test one',
              file: 'src/complex.test.ts',
              line: 10,
              message: 'Error 1',
            },
            {
              id: 'tf-2',
              name: 'test two',
              file: 'src/complex.test.ts',
              line: 20,
              message: 'Error 2',
            },
            {
              id: 'tf-3',
              name: 'test three',
              file: 'src/complex.test.ts',
              line: 30,
              message: 'Error 3',
            },
          ],
          timestamp: '2026-04-07T03:51:00Z',
        },
      ]

      render(<Tests testResults={multipleFailures} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Tests/i,
      })

      await user.click(sectionHeader)

      expect(screen.getByText('test one')).toBeInTheDocument()
      expect(screen.getByText('test two')).toBeInTheDocument()
      expect(screen.getByText('test three')).toBeInTheDocument()
      expect(screen.getByText('Error 1')).toBeInTheDocument()
      expect(screen.getByText('Error 2')).toBeInTheDocument()
      expect(screen.getByText('Error 3')).toBeInTheDocument()
    })
  })
})
