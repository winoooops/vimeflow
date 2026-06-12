import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { AppSettings } from '../../bindings/AppSettings'
import { DEFAULT_SETTINGS } from './store/settingsDefaults'

export interface SettingsContextValue {
  settings: AppSettings
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
      } catch {
        // Fall back to defaults if the backend load fails.
      }
    }

    void load()
  }, [])

  const update = useCallback((patch: Partial<AppSettings>): void => {
    setSettings((prev) => {
      const merged = { ...prev, ...patch }

      const bridge =
        typeof window !== 'undefined' ? window.vimeflow?.settings : undefined

      if (bridge) {
        void bridge.save(merged)
      }

      return merged
    })
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, update }}>
      {children}
    </SettingsContext.Provider>
  )
}
