import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { AppSettings } from '../../bindings/AppSettings'
import { DEFAULT_SETTINGS } from './store/settingsDefaults'

export interface SettingsContextValue {
  settings: AppSettings
  saveError: Error | null
  update: (patch: Partial<AppSettings>) => void
}

export const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined
)

interface SettingsProviderProps {
  children: ReactNode
}

export const SettingsProvider = ({
  children,
}: SettingsProviderProps): ReactElement => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saveError, setSaveError] = useState<Error | null>(null)
  const settingsRef = useRef<AppSettings>(settings)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())

  settingsRef.current = settings

  useEffect(() => {
    const load = async (): Promise<void> => {
      const bridge =
        typeof window !== 'undefined' ? window.vimeflow?.settings : undefined

      if (!bridge) {
        return
      }

      try {
        const loaded = await bridge.load()
        setSettings(loaded)
        settingsRef.current = loaded
      } catch {
        // Fall back to defaults if the backend load fails.
      }
    }

    void load()
  }, [])

  const saveNext = useCallback(
    async (previous: Promise<void>, next: AppSettings): Promise<void> => {
      try {
        await previous
      } catch {
        // Swallow prior save errors so the queue keeps moving.
      }

      const bridge =
        typeof window !== 'undefined' ? window.vimeflow?.settings : undefined

      if (!bridge) {
        return
      }

      try {
        await bridge.save(next)
      } catch (error: unknown) {
        setSaveError(error instanceof Error ? error : new Error(String(error)))
      }
    },
    []
  )

  const update = useCallback(
    (patch: Partial<AppSettings>): void => {
      const next = { ...settingsRef.current, ...patch }
      settingsRef.current = next
      setSettings(next)
      setSaveError(null)

      saveQueueRef.current = saveNext(saveQueueRef.current, next)
    },
    [saveNext]
  )

  return (
    <SettingsContext.Provider value={{ settings, saveError, update }}>
      {children}
    </SettingsContext.Provider>
  )
}
