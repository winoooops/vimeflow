import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityEvent } from './ActivityEvent'
import type { ToolActivityEvent } from '../types/activityEvent'

const now = new Date('2026-04-22T12:00:00Z')

const toolEvent = (
  overrides: Partial<ToolActivityEvent> = {}
): ToolActivityEvent => ({
  id: 't-1',
  kind: 'edit',
  tool: 'Edit',
  body: 'src/foo.ts',
  timestamp: '2026-04-22T11:59:42Z', // 18s before now
  status: 'done',
  durationMs: 120,
  ...overrides,
})

describe('ActivityEvent — basic row', () => {
  test('renders type label in uppercase', () => {
    render(<ActivityEvent event={toolEvent({ kind: 'edit' })} now={now} />)

    expect(screen.getByText('EDIT')).toBeInTheDocument()
  })

  test('renders body text', () => {
    render(
      <ActivityEvent
        event={toolEvent({ body: 'src/utils/jwt.ts' })}
        now={now}
      />
    )

    expect(screen.getByText('src/utils/jwt.ts')).toBeInTheDocument()
  })

  test.each([
    { kind: 'edit' as const, tool: 'Edit', symbol: 'edit', label: 'EDIT' },
    {
      kind: 'write' as const,
      tool: 'Write',
      symbol: 'edit_note',
      label: 'WRITE',
    },
    {
      kind: 'read' as const,
      tool: 'Read',
      symbol: 'visibility',
      label: 'READ',
    },
    { kind: 'bash' as const, tool: 'Bash', symbol: 'terminal', label: 'BASH' },
    { kind: 'grep' as const, tool: 'Grep', symbol: 'search', label: 'GREP' },
    {
      kind: 'glob' as const,
      tool: 'Glob',
      symbol: 'find_in_page',
      label: 'GLOB',
    },
    {
      kind: 'meta' as const,
      tool: 'WebFetch',
      symbol: 'tune',
      label: 'WEBFETCH',
    },
  ])(
    'renders $label icon as material symbol $symbol',
    ({ kind, tool, symbol, label }) => {
      render(<ActivityEvent event={toolEvent({ kind, tool })} now={now} />)
      const article = screen.getByRole('article', { name: label })
      // eslint-disable-next-line testing-library/no-node-access -- Material Symbols icon verification per rules/typescript/testing/CLAUDE.md
      const icon = article.querySelector('.material-symbols-outlined')

      expect(icon).toHaveTextContent(symbol)
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  )

  test('renders relative timestamp for done events', () => {
    render(<ActivityEvent event={toolEvent({ status: 'done' })} now={now} />)

    expect(screen.getByText('18s ago')).toBeInTheDocument()
  })

  test('renders relative timestamp for failed events', () => {
    render(<ActivityEvent event={toolEvent({ status: 'failed' })} now={now} />)

    expect(screen.getByText('18s ago')).toBeInTheDocument()
  })

  test('meta kind uses raw tool name as label', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'meta', tool: 'WebFetch' })}
        now={now}
      />
    )

    expect(screen.getByText('WEBFETCH')).toBeInTheDocument()
  })

  test('think kind renders body as italic', () => {
    render(
      <ActivityEvent
        event={{
          id: 'th-1',
          kind: 'think',
          body: 'reconsidering the approach',
          timestamp: '2026-04-22T11:59:42Z',
          status: 'done',
        }}
        now={now}
      />
    )
    const body = screen.getByText('reconsidering the approach')

    expect(body).toHaveClass('italic')
  })

  test('user kind renders body without mono font', () => {
    render(
      <ActivityEvent
        event={{
          id: 'u-1',
          kind: 'user',
          body: 'refactor this',
          timestamp: '2026-04-22T11:59:42Z',
          status: 'done',
        }}
        now={now}
      />
    )
    const body = screen.getByText('refactor this')

    expect(body).not.toHaveClass('font-mono')
  })
})
