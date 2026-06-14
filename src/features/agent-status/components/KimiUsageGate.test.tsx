import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import { KimiUsageGate } from './KimiUsageGate'
import { useKimiUsageConsent } from '../hooks/useKimiUsageConsent'

vi.mock('../hooks/useKimiUsageConsent', () => ({
  useKimiUsageConsent: vi.fn(),
}))

const mockHook = useKimiUsageConsent as Mock

const useConsent = (
  consent: boolean | null,
  {
    setConsent = vi.fn().mockResolvedValue(undefined),
    refresh = vi.fn().mockResolvedValue(undefined),
    persistError = false,
  }: { setConsent?: Mock; refresh?: Mock; persistError?: boolean } = {}
): { setConsent: Mock; refresh: Mock } => {
  mockHook.mockReturnValue({ consent, setConsent, refresh, persistError })

  return { setConsent, refresh }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('KimiUsageGate', () => {
  test('OFF: enabling sets consent and forces a fetch', () => {
    const { setConsent, refresh } = useConsent(false)
    render(<KimiUsageGate fiveHourPct={0} weekPct={0} />)

    expect(screen.getByText('Show plan usage')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Show plan usage'))
    expect(setConsent).toHaveBeenCalledWith(true)
    expect(refresh).toHaveBeenCalled()
  })

  test('OFF: a non-durable save warns instead of showing the host helper', () => {
    useConsent(false, { persistError: true })
    render(<KimiUsageGate fiveHourPct={0} weekPct={0} />)

    expect(screen.getByText(/may not persist/u)).toBeInTheDocument()
    expect(screen.queryByText(/Fetches limits from/u)).not.toBeInTheDocument()
  })

  test('ON: consent on with data renders the two peach bars', () => {
    useConsent(true)
    render(<KimiUsageGate fiveHourPct={17} weekPct={40} hasUsageData />)

    expect(screen.getByText('17%')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    const fills = screen.getAllByTestId('rate-limit-bar-fill')
    expect(fills).toHaveLength(2)
    fills.forEach((fill) =>
      expect(fill).toHaveClass('bg-[var(--color-agent-kimi-accent)]')
    )
  })

  test('ON: a weekly-only fetch renders no fabricated 5-hour bar', () => {
    useConsent(true)
    render(<KimiUsageGate fiveHourPct={null} weekPct={40} hasUsageData />)

    expect(screen.queryByText('5-hour Session')).not.toBeInTheDocument()
    expect(screen.getByText('Weekly Usage')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  test('ON: a fetched zero-usage response renders 0% bars, not a blank state', () => {
    useConsent(true)
    render(<KimiUsageGate fiveHourPct={0} weekPct={0} hasUsageData />)

    expect(screen.getAllByText('0%')).toHaveLength(2)
    expect(screen.getByText('5-hour Session')).toBeInTheDocument()
    expect(screen.getByText('Weekly Usage')).toBeInTheDocument()
  })

  test('ON: the revoke control turns consent off', () => {
    const { setConsent } = useConsent(true)
    render(<KimiUsageGate fiveHourPct={17} weekPct={40} hasUsageData />)

    fireEvent.click(screen.getByText('Turn off plan-usage tracking'))
    expect(setConsent).toHaveBeenCalledWith(false)
  })

  test('LOADING: consent on without data yet shows the skeleton', () => {
    useConsent(true)
    render(<KimiUsageGate fiveHourPct={0} weekPct={0} />)

    expect(screen.getByTestId('kimi-usage-loading')).toBeInTheDocument()
  })

  test('ERROR: consent on, no data after the timeout, shows the error', () => {
    vi.useFakeTimers()
    useConsent(true)
    render(<KimiUsageGate fiveHourPct={0} weekPct={0} />)

    expect(screen.getByTestId('kimi-usage-loading')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(12000)
    })
    expect(screen.getByText(/reach Kimi/u)).toBeInTheDocument()
  })

  test('ERROR: Retry asks the backend to refresh and returns to loading', () => {
    vi.useFakeTimers()
    const { refresh } = useConsent(true)
    render(<KimiUsageGate fiveHourPct={0} weekPct={0} />)

    act(() => {
      vi.advanceTimersByTime(12000)
    })
    expect(screen.getByText(/reach Kimi/u)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Retry'))
    expect(refresh).toHaveBeenCalled()
    expect(screen.getByTestId('kimi-usage-loading')).toBeInTheDocument()

    // The timeout re-arms: a still-failing retry returns to ERROR rather than
    // hanging in LOADING forever.
    act(() => {
      vi.advanceTimersByTime(12000)
    })
    expect(screen.getByText(/reach Kimi/u)).toBeInTheDocument()
  })

  test('initial consent fetch (null) renders the skeleton, not the CTA', () => {
    useConsent(null)
    render(<KimiUsageGate fiveHourPct={0} weekPct={0} />)

    expect(screen.getByTestId('kimi-usage-loading')).toBeInTheDocument()
    expect(screen.queryByText('Show plan usage')).not.toBeInTheDocument()
  })
})
