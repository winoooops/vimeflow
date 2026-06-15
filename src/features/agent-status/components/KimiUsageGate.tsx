// cspell:ignore Couldn
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import { useKimiUsageConsent } from '../hooks/useKimiUsageConsent'
import { RateLimitBar } from './RateLimitBar'

// kimi's plan-usage (5h + weekly) isn't on disk — reading it sends credentials
// off-device to the configured Kimi provider, so it is opt-in. This gate
// (kimi-only) replaces the usage bars with a consent CTA while OFF, and renders
// the peach bars once consent is
// ON and a fetch has landed. Five states share the card's fixed body height so
// the session list below never reflows.

// A consenting session with no usage after this long reads as an error — the
// backend has no failure event, so it's inferred from a timeout > the backend's
// own 10s request budget.
const USAGE_TIMEOUT_MS = 12000

export interface KimiUsageGateProps {
  // 5-hour / weekly usage percentages (0 until a real fetch lands).
  fiveHourPct: number | null
  weekPct: number | null
  // True once a real `/usages` fetch has landed; distinguishes ON from
  // LOADING. Defaults false (no fetch yet).
  hasUsageData?: boolean
}

type Phase = 'loading' | 'off' | 'on' | 'error'

export const KimiUsageGate = ({
  fiveHourPct,
  weekPct,
  hasUsageData = false,
}: KimiUsageGateProps): ReactElement => {
  const { consent, setConsent, refresh, persistError } = useKimiUsageConsent()
  const [timedOut, setTimedOut] = useState(false)
  // Bumped on each Retry so the error-timeout effect re-arms — its other deps
  // (consent, hasUsageData) don't change on a retry.
  const [retryAttempt, setRetryAttempt] = useState(0)

  // While consent is ON but no data has arrived, arm the error timeout. Any
  // exit from that condition (data arrives, consent off) clears it; a retry
  // re-runs this via `retryAttempt` so a repeatedly-failing fetch returns to
  // ERROR instead of hanging in LOADING.
  useEffect(() => {
    if (consent !== true || hasUsageData) {
      setTimedOut(false)

      return
    }

    const id = setTimeout(() => setTimedOut(true), USAGE_TIMEOUT_MS)

    return (): void => clearTimeout(id)
  }, [consent, hasUsageData, retryAttempt])

  const enable = useCallback((): void => {
    setTimedOut(false)
    void setConsent(true)
    // Force a fetch in case the backend turn-debounce is still armed from a
    // prior failed attempt (a rapid Error → Turn off → Show plan usage).
    void refresh()
  }, [setConsent, refresh])

  const disable = useCallback((): void => {
    setTimedOut(false)
    void setConsent(false)
  }, [setConsent])

  // Retry asks the backend to re-attempt the fetch (an explicit refresh, not a
  // consent toggle), drops back to LOADING, and re-arms the error timeout.
  const retry = useCallback((): void => {
    setTimedOut(false)
    setRetryAttempt((attempt) => attempt + 1)
    void refresh()
  }, [refresh])

  const phase: Phase =
    consent === null
      ? 'loading'
      : consent === false
        ? 'off'
        : hasUsageData
          ? 'on'
          : timedOut
            ? 'error'
            : 'loading'

  if (phase === 'off') {
    return <SlotOff onEnable={enable} persistError={persistError} />
  }
  if (phase === 'on') {
    return (
      <SlotOn fiveHourPct={fiveHourPct} weekPct={weekPct} onDisable={disable} />
    )
  }
  if (phase === 'error') {
    return <SlotError onRetry={retry} onDisable={disable} />
  }

  return <SlotLoading />
}

const SlotOff = ({
  onEnable,
  persistError,
}: {
  onEnable: () => void
  persistError: boolean
}): ReactElement => (
  <div className="flex flex-col gap-1.5">
    <Tooltip
      maxWidth={220}
      content={
        <span className="flex flex-col gap-1 leading-snug">
          <span>
            Sends your Kimi credentials to your provider to read usage.
          </span>
          <span className="text-on-surface-muted">
            Vimeflow never stores or logs them.
          </span>
        </span>
      }
    >
      <button
        type="button"
        onClick={onEnable}
        className="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-surface-container-lowest/50 text-[11px] font-semibold text-on-surface-variant outline-none ring-1 ring-inset ring-outline-variant/30 transition-colors hover:bg-[var(--color-agent-kimi-accent-dim)] hover:text-[var(--color-agent-kimi-accent)] focus-visible:ring-[var(--color-agent-kimi-accent)]"
      >
        <span
          className="material-symbols-outlined text-[14px]"
          aria-hidden="true"
        >
          cloud
        </span>
        Show plan usage
        <span aria-hidden="true">☾</span>
      </button>
    </Tooltip>
    {persistError ? (
      <div className="text-center text-[9px] font-medium text-warning">
        Couldn&rsquo;t save your choice — it may not persist.
      </div>
    ) : (
      <div className="text-center font-mono text-[9px] text-on-surface-muted">
        <span aria-hidden="true">🔒 </span>Fetches limits from your{' '}
        <span className="text-on-surface-variant">Kimi provider</span>
      </div>
    )}
  </div>
)

const SkeletonBar = ({ label }: { label: string }): ReactElement => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-on-surface-muted">
      {label}
    </span>
    <div className="h-[3px] w-full animate-pulse rounded-full bg-surface-container-highest" />
  </div>
)

const SlotLoading = (): ReactElement => (
  <div
    data-testid="kimi-usage-loading"
    className="flex flex-col gap-[9px]"
    aria-busy="true"
  >
    <SkeletonBar label="5-hour Session" />
    <SkeletonBar label="Weekly Usage" />
  </div>
)

const SlotOn = ({
  fiveHourPct,
  weekPct,
  onDisable,
}: {
  fiveHourPct: number | null
  weekPct: number | null
  onDisable: () => void
}): ReactElement => (
  <div className="group flex flex-col gap-[7px]">
    {fiveHourPct !== null ? (
      <RateLimitBar
        label="5-hour Session"
        percentage={fiveHourPct}
        accent="kimi"
      />
    ) : null}
    {weekPct !== null ? (
      <RateLimitBar label="Weekly Usage" percentage={weekPct} accent="kimi" />
    ) : null}
    <div className="flex justify-end">
      <Tooltip content="Won’t affect how Kimi Code runs on your device.">
        <button
          type="button"
          onClick={onDisable}
          className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-1 py-0.5 text-[9px] font-medium text-on-surface-muted opacity-0 outline-none transition-opacity hover:text-[var(--color-agent-kimi-accent)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <span
            className="material-symbols-outlined text-[12px]"
            aria-hidden="true"
          >
            power_settings_new
          </span>
          Turn off plan-usage tracking
        </button>
      </Tooltip>
    </div>
  </div>
)

const SlotError = ({
  onRetry,
  onDisable,
}: {
  onRetry: () => void
  onDisable: () => void
}): ReactElement => (
  <div className="flex flex-col items-center gap-2">
    <div className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
      <span
        className="material-symbols-outlined text-[14px]"
        aria-hidden="true"
      >
        cloud_off
      </span>
      Couldn&rsquo;t reach Kimi
    </div>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onRetry}
        className="cursor-pointer rounded-md bg-surface-container-lowest/60 px-2 py-1 text-[10px] font-semibold text-on-surface-variant outline-none ring-1 ring-inset ring-outline-variant/30 transition-colors hover:bg-[var(--color-agent-kimi-accent-dim)] hover:text-[var(--color-agent-kimi-accent)] focus-visible:ring-[var(--color-agent-kimi-accent)]"
      >
        Retry
      </button>
      <button
        type="button"
        onClick={onDisable}
        className="cursor-pointer px-1 text-[10px] font-medium text-on-surface-muted outline-none transition-colors hover:text-on-surface-variant"
      >
        Turn off
      </button>
    </div>
  </div>
)
