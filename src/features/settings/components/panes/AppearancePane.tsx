import { useState, type ReactElement } from 'react'
import {
  resolveSwellVariant,
  type SwellVariant,
} from '@/features/agent-status/hooks/useReservoirFlow'
import { ColorSchemeActions } from '@/features/settings/components/ColorSchemeActions'
import { ColorSchemeGrid } from '@/features/settings/components/ColorSchemeGrid'
import { PaneTitle, Row, Select } from '@/features/settings/components/controls'
import {
  ThemeJsonEditor,
  type ThemeJsonEditorMode,
} from '@/features/settings/components/ThemeJsonEditor'
import { useSettings } from '@/features/settings/hooks/useSettings'
import {
  INTERFACE_FONT_OPTIONS,
  resolveInterfaceFont,
} from '@/features/settings/interfaceFont'
import { SETTINGS_TARGET_IDS } from '@/features/settings/sections'
import { resolveSessionIslandDisplay } from '@/features/sessions/utils/sessionIslandDisplay'
import type { SettingsPaneTargetProps } from '@/features/settings/types'
import { themeService, useActiveTheme, type ThemeId } from '@/theme'

const RESERVOIR_SWELL_OPTIONS: { id: SwellVariant; label: string }[] = [
  { id: 'soft-mound', label: 'Soft Mound' },
  { id: 'trailing', label: 'Trailing' },
  { id: 'wide-lift', label: 'Wide Lift' },
]

const SESSION_ISLAND_DISPLAY_OPTIONS = [
  { id: 'dots', label: 'Dots' },
  { id: 'numbers', label: 'Numbers' },
  { id: 'labels', label: 'Active label' },
]

export const AppearancePane = ({
  activeTargetId = null,
}: SettingsPaneTargetProps): ReactElement => {
  const { settings, update } = useSettings()
  const activeTheme = useActiveTheme()
  const themes = themeService.list()

  const [themeEditorMode, setThemeEditorMode] =
    useState<ThemeJsonEditorMode | null>(null)

  const colorSchemeActive =
    activeTargetId === SETTINGS_TARGET_IDS.appearanceColorScheme

  const applyTheme = (themeId: ThemeId): void => {
    themeService.apply(themeId)
  }

  return (
    <>
      <PaneTitle title="Appearance" sub="Theme · Interface · Typography" />

      <div
        data-testid={`settings-target-${SETTINGS_TARGET_IDS.appearanceColorScheme}`}
        data-settings-target={SETTINGS_TARGET_IDS.appearanceColorScheme}
        data-settings-target-active={colorSchemeActive ? 'true' : undefined}
        tabIndex={-1}
        className={`mb-4 scroll-mt-4 rounded-lg outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/65 ${
          colorSchemeActive ? 'bg-primary-container/[0.08]' : ''
        }`}
      >
        <div className="mb-1 font-display text-sm font-medium text-on-surface">
          Color Scheme
        </div>
        <div className="mb-3 font-body text-xs text-on-surface-muted">
          The base palette for all surfaces, text, and accents. Affects every
          panel including this dialog.
        </div>

        <ColorSchemeGrid
          activeThemeId={activeTheme.id}
          themes={themes}
          onSelect={applyTheme}
        />

        <ColorSchemeActions onSelectMode={setThemeEditorMode} />
      </div>

      <Row
        label="Interface Font"
        hint="Applied immediately to labels, sidebars, headings, and controls."
        settingsTargetId={SETTINGS_TARGET_IDS.appearanceUiFont}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.appearanceUiFont
        }
      >
        <Select
          value={resolveInterfaceFont(settings.uiFont).id}
          onChange={(value) => update({ uiFont: value })}
          aria-label="Interface font"
          options={[...INTERFACE_FONT_OPTIONS]}
        />
      </Row>

      <Row
        label="Session Island"
        hint="Choose how open sessions appear in the centered top bar switcher."
        settingsTargetId={SETTINGS_TARGET_IDS.appearanceSessionIsland}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.appearanceSessionIsland
        }
      >
        <Select
          value={resolveSessionIslandDisplay(settings.sessionIslandDisplay)}
          onChange={(value): void =>
            update({
              sessionIslandDisplay: resolveSessionIslandDisplay(value),
            })
          }
          aria-label="Session island display"
          options={SESSION_ISLAND_DISPLAY_OPTIONS}
        />
      </Row>

      <Row
        label="Reservoir Swell"
        hint="Hover motion for the context reservoir waterline."
        settingsTargetId={SETTINGS_TARGET_IDS.appearanceReservoirSwell}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.appearanceReservoirSwell
        }
        last
      >
        <Select
          value={resolveSwellVariant(settings.reservoirSwell)}
          onChange={(value): void =>
            update({ reservoirSwell: resolveSwellVariant(value) })
          }
          aria-label="Reservoir swell"
          options={RESERVOIR_SWELL_OPTIONS}
        />
      </Row>

      {themeEditorMode !== null && (
        <ThemeJsonEditor
          mode={themeEditorMode}
          theme={themeEditorMode === 'import' ? undefined : activeTheme}
          onClose={(): void => setThemeEditorMode(null)}
        />
      )}
    </>
  )
}
