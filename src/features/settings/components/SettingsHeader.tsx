import type { ReactElement } from 'react'
import type { SettingsHeaderProps, SettingsScope } from '../types'
import { GhostButton } from './controls'

const SCOPES: SettingsScope[] = ['User', 'vimeflow']

export const SettingsHeader = ({
  scope,
  onScope,
}: SettingsHeaderProps): ReactElement => (
  <div className="flex shrink-0 items-center gap-3.5 border-b border-outline-variant/25 px-7 py-4">
    <div
      className="flex items-center gap-4"
      role="radiogroup"
      aria-label="Settings scope"
    >
      {SCOPES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={scope === s}
          onClick={() => onScope(s)}
          className={`border-b-[1.5px] border-solid bg-transparent p-0 pb-0.5 font-body text-[13px] cursor-pointer transition-colors ${
            scope === s
              ? 'border-primary-container font-semibold text-primary-container'
              : 'border-transparent text-on-surface-muted hover:text-on-surface'
          }`}
        >
          {s}
        </button>
      ))}
    </div>

    <span className="min-w-0 flex-1" />

    <GhostButton
      onClick={() => {
        const bridge = window.vimeflow?.settings

        if (bridge) {
          void bridge.openFile()
        }
      }}
    >
      Edit in settings.json
    </GhostButton>
  </div>
)
