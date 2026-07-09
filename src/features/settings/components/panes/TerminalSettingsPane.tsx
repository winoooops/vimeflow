import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { SystemFont } from '../../../../bindings/SystemFont'
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_PICKER_FAMILIES,
  normalizeTerminalFontFamily,
} from '../../../terminal/components/TerminalPane/terminalFont'
import { SETTINGS_TARGET_IDS } from '../../sections'
import { useSettings } from '../../hooks/useSettings'
import type { SelectOption, SettingsPaneTargetProps } from '../../types'
import { PaneTitle, Row, Select } from '../controls'

const uniqueFamilies = (families: readonly string[]): string[] => {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const family of families) {
    const normalized = normalizeTerminalFontFamily(family)
    const key = normalized.toLowerCase()

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(normalized)
  }

  return unique
}

const fontOptions = (
  current: string,
  systemFonts: readonly SystemFont[]
): SelectOption[] => {
  const fallbackFamilies =
    systemFonts.length === 0
      ? TERMINAL_FONT_PICKER_FAMILIES
      : [DEFAULT_TERMINAL_FONT_FAMILY]

  return uniqueFamilies([
    current,
    ...systemFonts.map((font) => font.family),
    ...fallbackFamilies,
  ]).map((family) => ({ id: family, label: family }))
}

export const TerminalSettingsPane = ({
  activeTargetId = null,
}: SettingsPaneTargetProps): ReactElement => {
  const { settings, update } = useSettings()
  const [systemFonts, setSystemFonts] = useState<SystemFont[]>([])

  useEffect(() => {
    const listSystemFonts =
      typeof window === 'undefined'
        ? undefined
        : window.vimeflow?.settings?.listSystemFonts

    if (!listSystemFonts) {
      return
    }

    let cancelled = false

    const load = async (): Promise<void> => {
      try {
        const fonts = await listSystemFonts()
        if (!cancelled) {
          setSystemFonts(fonts)
        }
      } catch {
        if (!cancelled) {
          setSystemFonts([])
        }
      }
    }

    void load()

    return (): void => {
      cancelled = true
    }
  }, [])

  const terminalFontFamily = normalizeTerminalFontFamily(
    settings.terminalFontFamily
  )

  const options = useMemo(
    () => fontOptions(terminalFontFamily, systemFonts),
    [systemFonts, terminalFontFamily]
  )

  return (
    <>
      <PaneTitle title="Terminal" sub="Shell · Typography" />

      <Row
        label="Font Family"
        hint="Used by terminal panes. Falls back through bundled and platform monospace fonts."
        settingsTargetId={SETTINGS_TARGET_IDS.terminalFontFamily}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.terminalFontFamily
        }
        last
      >
        <Select
          value={terminalFontFamily}
          onChange={(value): void =>
            update({ terminalFontFamily: normalizeTerminalFontFamily(value) })
          }
          aria-label="Terminal font family"
          width={220}
          options={options}
        />
      </Row>
    </>
  )
}
