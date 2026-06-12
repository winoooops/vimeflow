import type { ReactElement } from 'react'
import { useSettings } from '../../hooks/useSettings'
import { PaneTitle, Row, Select, Toggle } from '../controls'

export const GeneralPane = (): ReactElement => {
  const { settings, update } = useSettings()

  return (
    <>
      <PaneTitle title="General" sub="General Settings" />

      <Row
        label="When Closing With No Tabs"
        hint="What to do when using the 'close active item' action with no tabs."
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
