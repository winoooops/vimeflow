import type { ReactElement } from 'react'
import {
  DIFF_INDICATOR_OPTIONS,
  DIFF_LINE_DIFF_OPTIONS,
  DIFF_OVERFLOW_OPTIONS,
  DIFF_STYLE_OPTIONS,
  DIFF_THEME_OPTIONS,
  resolveDiffIndicators,
  resolveDiffLineDiffType,
  resolveDiffOverflow,
  resolveDiffStyle,
  resolveDiffThemeSetting,
} from '@/features/diff/diffViewSettings'
import { useSettings } from '../../hooks/useSettings'
import { SETTINGS_TARGET_IDS } from '../../sections'
import type { SettingsPaneTargetProps, SettingsTargetId } from '../../types'
import { PaneTitle, Row, Select, Toggle } from '../controls'

interface TargetProps {
  settingsTargetId: SettingsTargetId
  settingsTargetActive: boolean
}

export const VersionControlPane = ({
  activeTargetId = null,
}: SettingsPaneTargetProps): ReactElement => {
  const { settings, update } = useSettings()

  const targetProps = (settingsTargetId: SettingsTargetId): TargetProps => ({
    settingsTargetId,
    settingsTargetActive: activeTargetId === settingsTargetId,
  })

  return (
    <>
      <PaneTitle title="Version Control" sub="Hunk Appearance" />

      <Row
        label="Diff Layout"
        hint="Show changes side by side or in one unified column."
        {...targetProps(SETTINGS_TARGET_IDS.versionDiffViewStyle)}
      >
        <Select
          value={resolveDiffStyle(settings.diffViewStyle)}
          onChange={(value): void =>
            update({ diffViewStyle: resolveDiffStyle(value) })
          }
          aria-label="Diff layout"
          options={DIFF_STYLE_OPTIONS}
        />
      </Row>

      <Row
        label="Diff Theme"
        hint="Use the app theme automatically or choose a fixed syntax theme."
        {...targetProps(SETTINGS_TARGET_IDS.versionDiffTheme)}
      >
        <Select
          value={resolveDiffThemeSetting(settings.diffTheme)}
          onChange={(value): void =>
            update({ diffTheme: resolveDiffThemeSetting(value) })
          }
          aria-label="Diff theme"
          options={DIFF_THEME_OPTIONS}
        />
      </Row>

      <Row
        label="Intra-line Highlight"
        hint="Choose how precisely changes within a line are highlighted."
        {...targetProps(SETTINGS_TARGET_IDS.versionDiffLineDiffType)}
      >
        <Select
          value={resolveDiffLineDiffType(settings.diffLineDiffType)}
          onChange={(value): void =>
            update({ diffLineDiffType: resolveDiffLineDiffType(value) })
          }
          aria-label="Intra-line highlight"
          options={DIFF_LINE_DIFF_OPTIONS}
        />
      </Row>

      <Row
        label="Change Indicators"
        hint="Choose markers for added and removed lines."
        {...targetProps(SETTINGS_TARGET_IDS.versionDiffIndicators)}
      >
        <Select
          value={resolveDiffIndicators(settings.diffIndicators)}
          onChange={(value): void =>
            update({ diffIndicators: resolveDiffIndicators(value) })
          }
          aria-label="Change indicators"
          options={DIFF_INDICATOR_OPTIONS}
        />
      </Row>

      <Row
        label="Long Lines"
        hint="Wrap long diff lines or keep horizontal scrolling."
        {...targetProps(SETTINGS_TARGET_IDS.versionDiffOverflow)}
      >
        <Select
          value={resolveDiffOverflow(settings.diffOverflow)}
          onChange={(value): void =>
            update({ diffOverflow: resolveDiffOverflow(value) })
          }
          aria-label="Long diff lines"
          options={DIFF_OVERFLOW_OPTIONS}
        />
      </Row>

      <Row
        label="Line Numbers"
        {...targetProps(SETTINGS_TARGET_IDS.versionDiffShowLineNumbers)}
      >
        <Toggle
          on={settings.diffShowLineNumbers}
          onChange={(value): void => update({ diffShowLineNumbers: value })}
          aria-label="Line numbers"
        />
      </Row>

      <Row
        label="Background Tint"
        {...targetProps(SETTINGS_TARGET_IDS.versionDiffBackgroundTint)}
      >
        <Toggle
          on={settings.diffBackgroundTint}
          onChange={(value): void => update({ diffBackgroundTint: value })}
          aria-label="Background tint"
        />
      </Row>

      <Row
        label="File Header"
        {...targetProps(SETTINGS_TARGET_IDS.versionDiffFileHeader)}
      >
        <Toggle
          on={settings.diffFileHeader}
          onChange={(value): void => update({ diffFileHeader: value })}
          aria-label="File header"
        />
      </Row>

      <Row
        label="Sticky Header"
        {...targetProps(SETTINGS_TARGET_IDS.versionDiffStickyHeader)}
        last
      >
        <Toggle
          on={settings.diffStickyHeader}
          onChange={(value): void => update({ diffStickyHeader: value })}
          aria-label="Sticky header"
        />
      </Row>
    </>
  )
}
