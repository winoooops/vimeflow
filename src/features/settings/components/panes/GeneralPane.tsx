import type { ReactElement } from 'react'
import { SETTINGS_TARGET_IDS } from '../../sections'
import { useSettings } from '../../hooks/useSettings'
import type { SettingsPaneTargetProps } from '../../types'
import { PaneTitle, Row, Select, Toggle } from '../controls'

export const GeneralPane = ({
  activeTargetId = null,
}: SettingsPaneTargetProps): ReactElement => {
  const { settings, update } = useSettings()

  return (
    <>
      <PaneTitle title="General" sub="General Settings" />

      <Row
        label="When Closing With No Tabs"
        hint="What to do when using the 'close active item' action with no tabs."
        settingsTargetId={SETTINGS_TARGET_IDS.generalCloseWithNoTabs}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.generalCloseWithNoTabs
        }
      >
        <Select
          value={settings.closeWithNoTabs}
          onChange={(value): void => update({ closeWithNoTabs: value })}
          aria-label="When closing with no tabs"
          options={[
            { id: 'platform', label: 'Platform Default' },
            { id: 'close', label: 'Close Window' },
            { id: 'nothing', label: 'Do Nothing' },
          ]}
        />
      </Row>

      <Row
        label="On Last Window Closed"
        hint="What to do when the last window is closed."
        settingsTargetId={SETTINGS_TARGET_IDS.generalOnLastWindowClosed}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.generalOnLastWindowClosed
        }
      >
        <Select
          value={settings.onLastWindowClosed}
          onChange={(value): void => update({ onLastWindowClosed: value })}
          aria-label="On last window closed"
          options={[
            { id: 'platform', label: 'Platform Default' },
            { id: 'quit', label: 'Quit Application' },
          ]}
        />
      </Row>

      <Row
        label="Use System Path Prompts"
        hint="Use native OS dialogs for 'Open' and 'Save As'."
        settingsTargetId={SETTINGS_TARGET_IDS.generalUseSystemPathPrompts}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.generalUseSystemPathPrompts
        }
      >
        <Toggle
          on={settings.useSystemPathPrompts}
          onChange={(value): void => update({ useSystemPathPrompts: value })}
          aria-label="Use System Path Prompts"
        />
      </Row>

      <Row
        label="Use System Prompts"
        hint="Use native OS dialogs for confirmations."
        settingsTargetId={SETTINGS_TARGET_IDS.generalUseSystemPrompts}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.generalUseSystemPrompts
        }
      >
        <Toggle
          on={settings.useSystemPrompts}
          onChange={(value): void => update({ useSystemPrompts: value })}
          aria-label="Use System Prompts"
        />
      </Row>

      <Row
        label="Redact Private Values"
        hint="Hide the values of variables in private files."
        settingsTargetId={SETTINGS_TARGET_IDS.generalRedactPrivateValues}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.generalRedactPrivateValues
        }
      >
        <Toggle
          on={settings.redactPrivateValues}
          onChange={(value): void => update({ redactPrivateValues: value })}
          aria-label="Redact Private Values"
        />
      </Row>

      <Row
        label="CLI Default Open Behavior"
        hint="How `vf <path>` opens directories when no flag is specified."
        settingsTargetId={SETTINGS_TARGET_IDS.generalCliOpenBehavior}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.generalCliOpenBehavior
        }
        last
      >
        <Select
          value={settings.cliOpenBehavior}
          onChange={(value): void => update({ cliOpenBehavior: value })}
          aria-label="CLI default open behavior"
          options={[
            { id: 'existing', label: 'Add to Existing Window' },
            { id: 'new', label: 'Open in New Window' },
          ]}
        />
      </Row>

      {/*
        Persistence-only settings note:
        closeWithNoTabs, useSystemPathPrompts, useSystemPrompts,
        redactPrivateValues, and cliOpenBehavior are persisted through the
        settings store above, but the app does not yet have runtime surfaces
        that honor them (no native OS dialogs, no private-value redaction,
        and no `vf` CLI). They will light up as those respective features land.
      */}
    </>
  )
}
