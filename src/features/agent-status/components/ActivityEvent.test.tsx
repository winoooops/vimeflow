import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  test('renders relative timestamp for done events (minute granularity)', () => {
    // toolEvent default timestamp is 18s before `now` → shows 'now'.
    render(<ActivityEvent event={toolEvent({ status: 'done' })} now={now} />)

    expect(screen.getByText('now')).toBeInTheDocument()
  })

  test('renders relative timestamp for failed events (minute granularity)', () => {
    render(<ActivityEvent event={toolEvent({ status: 'failed' })} now={now} />)

    expect(screen.getByText('now')).toBeInTheDocument()
  })

  test('renders Nm ago once the event is at least a minute old', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          status: 'done',
          // 90s before `now` → 1m ago
          timestamp: '2026-04-22T11:58:30Z',
        })}
        now={now}
      />
    )

    expect(screen.getByText('1m ago')).toBeInTheDocument()
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

describe('ActivityEvent — diff chips (EDIT/WRITE)', () => {
  test('renders +N and −M chips when diff is present', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'edit',
          diff: { added: 12, removed: 2 },
        })}
        now={now}
      />
    )

    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText('−2')).toBeInTheDocument()
  })

  test('does not render diff chips when diff is absent', () => {
    render(<ActivityEvent event={toolEvent({ kind: 'edit' })} now={now} />)

    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^−/)).not.toBeInTheDocument()
  })

  test('does not render diff chips for non-edit/write kinds even if diff is passed', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'read',
          tool: 'Read',
          diff: { added: 1, removed: 1 },
        })}
        now={now}
      />
    )

    expect(screen.queryByText('+1')).not.toBeInTheDocument()
  })
})

describe('ActivityEvent — bash status pill', () => {
  test('status=done + bashResult → "OK {passed}/{total}" in success palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          status: 'done',
          bashResult: { passed: 4, total: 4 },
        })}
        now={now}
      />
    )
    const pill = screen.getByText('OK 4/4')

    expect(pill).toHaveClass('text-success')
  })

  test('status=failed + bashResult → "FAILED {passed}/{total}" in error palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({
          kind: 'bash',
          tool: 'Bash',
          status: 'failed',
          bashResult: { passed: 1, total: 4 },
        })}
        now={now}
      />
    )
    const pill = screen.getByText('FAILED 1/4')

    expect(pill).toHaveClass('text-error')
  })

  test('status=done, no bashResult → "OK" in success palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'bash', tool: 'Bash', status: 'done' })}
        now={now}
      />
    )
    const pill = screen.getByText('OK')

    expect(pill).toHaveClass('text-success')
  })

  test('status=failed, no bashResult → "FAILED" in error palette', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'bash', tool: 'Bash', status: 'failed' })}
        now={now}
      />
    )
    const pill = screen.getByText('FAILED')

    expect(pill).toHaveClass('text-error')
  })

  test('non-bash kinds render no status pill', () => {
    render(
      <ActivityEvent
        event={toolEvent({ kind: 'read', tool: 'Read', status: 'done' })}
        now={now}
      />
    )

    expect(screen.queryByText('OK')).not.toBeInTheDocument()
    expect(screen.queryByText('FAILED')).not.toBeInTheDocument()
  })
})

describe('ActivityEvent — running state', () => {
  test('renders animated dot with role="status" for running events', () => {
    render(
      <ActivityEvent
        event={{
          id: 'active-Edit',
          kind: 'edit',
          tool: 'Edit',
          body: 'src/foo.ts',
          timestamp: '2026-04-22T11:59:52Z', // 8s before now
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )
    const dot = screen.getByRole('status', { name: 'running' })

    expect(dot).toHaveClass('animate-pulse')
    expect(dot).toHaveClass('bg-success')
  })

  test('running timestamp reads "running Xs" computed from startedAt', () => {
    render(
      <ActivityEvent
        event={{
          id: 'active-Bash',
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          timestamp: '2026-04-22T11:59:52Z', // 8s before now
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )

    expect(screen.getByText('running 8s')).toBeInTheDocument()
  })

  test('running events render no status pill', () => {
    render(
      <ActivityEvent
        event={{
          id: 'active-Bash',
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          timestamp: '2026-04-22T11:59:52Z',
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )

    expect(screen.queryByText('OK')).not.toBeInTheDocument()
    expect(screen.queryByText('FAILED')).not.toBeInTheDocument()
  })

  test('non-running events do not render the animated dot', () => {
    render(<ActivityEvent event={toolEvent({ status: 'done' })} now={now} />)

    expect(
      screen.queryByRole('status', { name: 'running' })
    ).not.toBeInTheDocument()
  })

  test('running timestamp clamps a negative delta to 0s (clock-skew guard)', () => {
    // Event timestamp is 500ms AFTER `now` — simulates the sub-ms clock
    // skew case where the Rust event stamp beats the JS Date.now() snapshot.
    render(
      <ActivityEvent
        event={{
          id: 'active-Bash',
          kind: 'bash',
          tool: 'Bash',
          body: 'pnpm test',
          timestamp: '2026-04-22T12:00:00.500Z',
          status: 'running',
          durationMs: null,
        }}
        now={now}
      />
    )

    expect(screen.getByText('running 0s')).toBeInTheDocument()
  })
})

describe('ActivityEvent — tooltip integration', () => {
  // Unique-to-this-consumer concern: the body span only becomes a keyboard
  // focus stop and a tooltip trigger when the text actually overflows. The
  // hover-reveals-tooltip behavior is covered by Tooltip.test.tsx.
  // jsdom reports scrollWidth and clientWidth as 0 without real layout, so
  // mock the getters for the truncated path and leave defaults for the
  // fits-in-container path.

  test('marks body span as focusable with tabIndex 0 when truncated', async () => {
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockReturnValue(500)

    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(100)

    render(
      <ActivityEvent
        event={{
          id: 'e1',
          kind: 'edit',
          tool: 'Edit',
          body: 'src/components/Tooltip.tsx with a long trailing description',
          timestamp: '2026-04-23T03:00:00Z',
          status: 'done',
          durationMs: 8,
          diff: { added: 12, removed: 0 },
        }}
        now={new Date('2026-04-23T03:01:00Z')}
      />
    )

    await waitFor(() =>
      expect(
        screen.getByText(/Tooltip\.tsx/, { selector: 'span' })
      ).toHaveAttribute('tabindex', '0')
    )

    scrollWidthSpy.mockRestore()
    clientWidthSpy.mockRestore()
  })

  test('omits tabIndex and keeps tooltip disabled when body fits container', async () => {
    // Default jsdom layout: scrollWidth = clientWidth = 0, so !isTruncated.
    const user = userEvent.setup()

    render(
      <ActivityEvent
        event={{
          id: 'e2',
          kind: 'read',
          tool: 'Read',
          body: 'short.tsx',
          timestamp: '2026-04-23T03:00:00Z',
          status: 'done',
          durationMs: 2,
        }}
        now={new Date('2026-04-23T03:01:00Z')}
      />
    )

    const body = screen.getByText('short.tsx', { selector: 'span' })
    expect(body).not.toHaveAttribute('tabindex')

    await user.hover(body)
    // With Tooltip disabled, no floating element ever mounts.
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
