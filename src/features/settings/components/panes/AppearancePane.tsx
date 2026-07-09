import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import {
  resolveSwellVariant,
  type SwellVariant,
} from '@/features/agent-status/hooks/useReservoirFlow'
import { themeService } from '@/theme'
import { BUILTIN_SCHEMES, SETTINGS_TARGET_IDS } from '../../sections'
import { useSettings } from '../../hooks/useSettings'
import type { SettingsPaneTargetProps } from '../../types'
import { Icon } from '../Icon'
import { GhostButton, PaneTitle, Row, Select } from '../controls'

const RESERVOIR_SWELL_OPTIONS: { id: SwellVariant; label: string }[] = [
  { id: 'soft-mound', label: 'Soft Mound' },
  { id: 'trailing', label: 'Trailing' },
  { id: 'wide-lift', label: 'Wide Lift' },
]

export const AppearancePane = ({
  activeTargetId = null,
}: SettingsPaneTargetProps): ReactElement => {
  const { settings, update } = useSettings()
  const [accentHuePreview, setAccentHuePreview] = useState(settings.accentHue)
  const committedAccentHueRef = useRef(settings.accentHue)

  const colorSchemeActive =
    activeTargetId === SETTINGS_TARGET_IDS.appearanceColorScheme

  useEffect(() => {
    committedAccentHueRef.current = settings.accentHue
    setAccentHuePreview(settings.accentHue)
  }, [settings.accentHue])

  const commitAccentHue = useCallback(
    (value: number): void => {
      if (committedAccentHueRef.current === value) {
        return
      }

      committedAccentHueRef.current = value
      update({ accentHue: value })
    },
    [update]
  )

  const applyScheme = (scheme: (typeof BUILTIN_SCHEMES)[number]): void => {
    themeService.apply(scheme.themeId)
    update({ aesthetic: scheme.id })
  }

  return (
    <>
      <PaneTitle title="Appearance" sub="Theme · Color Scheme · Typography" />

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

        <div className="grid grid-cols-2 gap-2.5">
          {BUILTIN_SCHEMES.map((s) => {
            const isActive = settings.aesthetic === s.id

            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => applyScheme(s)}
                className={`flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                  isActive
                    ? 'border-primary-container/45 bg-primary-container/[0.08]'
                    : 'border-outline-variant/35 bg-surface-container/60'
                }`}
              >
                <div
                  className="relative h-7 w-9 shrink-0 overflow-hidden rounded border border-outline-variant/40"
                  style={{ background: s.surface }}
                >
                  <span
                    className="absolute left-1 top-1 h-1 w-3 rounded-sm"
                    style={{ background: s.accent }}
                  />
                  <span
                    className="absolute left-1 top-3 h-0.5 w-4.5 rounded-sm opacity-70"
                    style={{ background: s.text }}
                  />
                  <span
                    className="absolute left-1 top-[18px] h-0.5 w-5.5 rounded-sm opacity-40"
                    style={{ background: s.text }}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className={`font-display text-[13px] font-medium ${
                      isActive ? 'text-primary' : 'text-on-surface'
                    }`}
                  >
                    {s.label}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] tracking-wide text-on-surface-muted">
                    {s.id}
                  </div>
                </div>

                {isActive && (
                  <Icon
                    name="check"
                    size={14}
                    className="text-primary-container"
                  />
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-3.5 flex gap-2">
          <GhostButton>
            <Icon
              name="file_upload"
              size={12}
              className="mr-1.5 align-middle"
            />
            Import scheme...
          </GhostButton>
          <GhostButton>
            <Icon name="download" size={12} className="mr-1.5 align-middle" />
            Export current
          </GhostButton>
          <GhostButton>Browse community</GhostButton>
        </div>
      </div>

      <Row
        label="Accent Hue"
        hint={`Shift the primary accent around the wheel. Current: ${settings.accentHue}°`}
        settingsTargetId={SETTINGS_TARGET_IDS.appearanceAccentHue}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.appearanceAccentHue
        }
      >
        <input
          type="range"
          min={240}
          max={360}
          step={2}
          value={accentHuePreview}
          onChange={(e) => setAccentHuePreview(Number(e.target.value))}
          onPointerUp={() => commitAccentHue(accentHuePreview)}
          onKeyUp={() => commitAccentHue(accentHuePreview)}
          onBlur={() => commitAccentHue(accentHuePreview)}
          className="w-[180px]"
          aria-label="Accent hue"
        />
      </Row>

      <Row
        label="Density"
        hint="Compact for power users; comfortable for readability."
        settingsTargetId={SETTINGS_TARGET_IDS.appearanceDensity}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.appearanceDensity
        }
      >
        <Select
          value={settings.density}
          onChange={(value) => update({ density: value })}
          aria-label="Density"
          options={[
            { id: 'comfortable', label: 'Comfortable' },
            { id: 'compact', label: 'Compact' },
          ]}
        />
      </Row>

      <Row
        label="UI Font"
        hint="Sans-serif used for labels, sidebars, headings."
        settingsTargetId={SETTINGS_TARGET_IDS.appearanceUiFont}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.appearanceUiFont
        }
      >
        <Select
          value={settings.uiFont}
          onChange={(value) => update({ uiFont: value })}
          aria-label="UI font"
          options={[
            { id: 'instrument', label: 'Instrument Sans' },
            { id: 'inter', label: 'Inter' },
            { id: 'fraunces', label: 'Fraunces (display)' },
          ]}
        />
      </Row>

      <Row
        label="Mono Font"
        hint="Used in the terminal, editor, and all code blocks."
        settingsTargetId={SETTINGS_TARGET_IDS.appearanceMonoFont}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.appearanceMonoFont
        }
      >
        <Select
          value={settings.monoFont}
          onChange={(value) => update({ monoFont: value })}
          aria-label="Mono font"
          options={[
            { id: 'jetbrains', label: 'JetBrains Mono' },
            { id: 'iosevka', label: 'Iosevka' },
            { id: 'fira', label: 'Fira Code' },
          ]}
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
    </>
  )
}
