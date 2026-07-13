import type { ReactElement } from 'react'
import { Icon } from '@/features/settings/components/Icon'
import type { ThemeDefinition, ThemeId } from '@/theme'

interface ColorSchemeGridProps {
  activeThemeId: ThemeId
  themes: readonly ThemeDefinition[]
  onSelect: (themeId: ThemeId) => void
}

export const ColorSchemeGrid = ({
  activeThemeId,
  themes,
  onSelect,
}: ColorSchemeGridProps): ReactElement => (
  <div className="grid grid-cols-2 gap-2.5">
    {themes.map((theme) => {
      const isActive = activeThemeId === theme.id

      return (
        <button
          key={theme.id}
          type="button"
          aria-label={theme.label}
          aria-pressed={isActive}
          onClick={(): void => onSelect(theme.id)}
          className={`flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
            isActive
              ? 'border-primary-container/45 bg-primary-container/[0.08]'
              : 'border-outline-variant/35 bg-surface-container/60'
          }`}
        >
          <div
            className="relative h-7 w-9 shrink-0 overflow-hidden rounded border border-outline-variant/40"
            style={{ background: theme.ui.surface }}
          >
            <span
              className="absolute left-1 top-1 h-1 w-3 rounded-sm"
              style={{ background: theme.ui.primary }}
            />
            <span
              className="absolute left-1 top-3 h-0.5 w-4.5 rounded-sm opacity-70"
              style={{ background: theme.ui['on-surface'] }}
            />
            <span
              className="absolute left-1 top-[18px] h-0.5 w-5.5 rounded-sm opacity-40"
              style={{ background: theme.ui['on-surface'] }}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div
              className={`font-display text-[13px] font-medium ${
                isActive ? 'text-primary' : 'text-on-surface'
              }`}
            >
              {theme.label}
            </div>
            <div className="mt-0.5 font-mono text-[10px] tracking-wide text-on-surface-muted">
              {theme.id}
            </div>
          </div>

          {isActive && (
            <Icon name="check" size={14} className="text-primary-container" />
          )}
        </button>
      )
    })}
  </div>
)
