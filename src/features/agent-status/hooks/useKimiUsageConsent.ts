import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../../../lib/backend'

export interface KimiUsageConsent {
  // `null` while the persisted value is still loading; then the live boolean.
  consent: boolean | null
  setConsent: (enabled: boolean) => Promise<void>
  // Force a one-shot re-fetch (the gate's Retry), without toggling consent.
  refresh: () => Promise<void>
  // True when the last setConsent applied in memory but did NOT durably
  // persist — the gate warns so the user knows the choice may not survive a
  // restart (rather than silently showing a state that won't stick).
  persistError: boolean
}

// Reads the global, persisted kimi plan-usage consent on mount and exposes a
// setter that flips it through the backend IPC. Consent is account-wide, so a
// single instance per active kimi pane is enough. The setter is optimistic and
// re-syncs to the backend's truth if the durable write fails.
export const useKimiUsageConsent = (): KimiUsageConsent => {
  const [consent, setConsentState] = useState<boolean | null>(null)
  const [persistError, setPersistError] = useState(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true

    const load = async (): Promise<void> => {
      let value = false
      try {
        value = await invoke<boolean>('get_kimi_usage_consent')
      } catch {
        value = false
      }

      if (mountedRef.current) {
        setConsentState(value)
      }
    }

    void load()

    return (): void => {
      mountedRef.current = false
    }
  }, [])

  const setConsent = useCallback(async (enabled: boolean): Promise<void> => {
    setConsentState(enabled)
    setPersistError(false)
    try {
      await invoke('set_kimi_usage_consent', { enabled })
    } catch {
      // The choice wasn't durably persisted. Re-sync to the backend's in-memory
      // truth (this reverts a failed enable, which the backend leaves OFF) and
      // flag the failure so the gate warns rather than silently showing a state
      // that may not survive a restart.
      let truth = false
      try {
        truth = await invoke<boolean>('get_kimi_usage_consent')
      } catch {
        truth = false
      }

      if (mountedRef.current) {
        setConsentState(truth)
        setPersistError(true)
      }
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      await invoke('refresh_kimi_usage')
    } catch {
      // Best-effort: a failed refresh request just leaves the gate as it was.
    }
  }, [])

  return { consent, setConsent, refresh, persistError }
}
