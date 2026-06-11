import { useState, type ReactElement } from 'react'
import { PaneTitle, Row, Select, Toggle } from '../controls'

export const GeneralPane = (): ReactElement => {
  const [closeNoTabs, setCloseNoTabs] = useState('platform')
  const [lastWindow, setLastWindow] = useState('platform')
  const [systemPathPrompts, setSystemPathPrompts] = useState(true)
  const [systemPrompts, setSystemPrompts] = useState(true)
  const [redactPrivate, setRedactPrivate] = useState(false)
  const [cliOpenBehavior, setCliOpenBehavior] = useState('existing')

  return (
    <>
      <PaneTitle title="General" sub="General Settings" />

      <Row
        label="When Closing With No Tabs"
        hint="What to do when using the 'close active item' action with no tabs."
      >
        <Select
          value={closeNoTabs}
          onChange={setCloseNoTabs}
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
          value={lastWindow}
          onChange={setLastWindow}
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
          on={systemPathPrompts}
          onChange={setSystemPathPrompts}
          aria-label="Use System Path Prompts"
        />
      </Row>

      <Row
        label="Use System Prompts"
        hint="Use native OS dialogs for confirmations."
      >
        <Toggle
          on={systemPrompts}
          onChange={setSystemPrompts}
          aria-label="Use System Prompts"
        />
      </Row>

      <Row
        label="Redact Private Values"
        hint="Hide the values of variables in private files."
      >
        <Toggle
          on={redactPrivate}
          onChange={setRedactPrivate}
          aria-label="Redact Private Values"
        />
      </Row>

      <Row
        label="CLI Default Open Behavior"
        hint="How `vf <path>` opens directories when no flag is specified."
        last
      >
        <Select
          value={cliOpenBehavior}
          onChange={setCliOpenBehavior}
          aria-label="CLI default open behavior"
          options={[
            { id: 'existing', label: 'Add to Existing Window' },
            { id: 'new', label: 'Open in New Window' },
          ]}
        />
      </Row>
    </>
  )
}
