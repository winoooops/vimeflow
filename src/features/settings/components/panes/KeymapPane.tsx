import type { ReactElement } from 'react'
import {
  formatShortcut,
  isMacPlatform,
  type ShortcutInput,
} from '../../../../lib/formatShortcut'
import { useSettings } from '../../hooks/useSettings'
import { KEYMAP_GROUPS, VIM_KEYMAP_GROUPS } from '../../sections'
import { CATALOG } from '../../../keymap/catalog'
import { chordToShortcutInput } from '../../../keymap/displayKey'
import { useKeybindings } from '../../../keymap/useKeybindings'
import type { KeymapBinding, KeymapGroup, KeymapKeys } from '../../types'
import { Kbd } from '../Kbd'
import { PaneTitle, Row, Select } from '../controls'

// The catalog owns the modifier-based rows (Global / Panes & Layout / Terminal).
// The bare-key Diff zone keeps rendering from KEYMAP_GROUPS (no platform-modifier
// drift; vim-style lowercase display), as do the Vim ex-command rows. (§6.4)
const GROUP_ORDER = ['Global', 'Panes & Layout', 'Terminal'] as const

const rowClass = (last: boolean): string =>
  `flex items-center gap-3.5 px-3.5 py-2.5 ${
    last ? '' : 'border-b border-outline-variant/15'
  }`

const groupShell = (zone: string, rows: ReactElement[]): ReactElement => (
  <div key={zone} className="mb-4">
    <div className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-on-surface-muted">
      {zone}
    </div>
    <div className="overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest/50">
      {rows}
    </div>
  </div>
)

const labelCell = (text: string): ReactElement => (
  <span className="min-w-0 flex-1 font-body text-[13px] text-on-surface-variant">
    {text}
  </span>
)

// Vim ex-command rows keep their existing string-token rendering.
const resolveKeys = (keys: KeymapKeys): ShortcutInput[] =>
  typeof keys === 'function' ? keys(isMacPlatform()) : keys

export const KeymapPane = (): ReactElement => {
  const { settings, update } = useSettings()
  const { bindingFor } = useKeybindings()
  const showVim = settings.keymapPreset === 'vim'

  const commandRow = (
    cmd: (typeof CATALOG)[number],
    last: boolean
  ): ReactElement => (
    <div key={cmd.id} className={rowClass(last)}>
      {labelCell(cmd.label)}
      <span className="flex gap-1">
        <Kbd>{formatShortcut(chordToShortcutInput(bindingFor(cmd.id)))}</Kbd>
      </span>
    </div>
  )

  const staticGroup = (group: KeymapGroup): ReactElement =>
    groupShell(
      group.zone,
      group.bindings.map((b: KeymapBinding, i) => (
        <div key={b.id} className={rowClass(i === group.bindings.length - 1)}>
          {labelCell(b.label)}
          <span className="flex gap-1">
            {resolveKeys(b.keys).map((k, j) => (
              <Kbd key={`${b.id}-${j}`}>{formatShortcut(k)}</Kbd>
            ))}
          </span>
        </div>
      ))
    )

  return (
    <>
      <PaneTitle title="Keymap" sub="Keyboard shortcuts" />

      <Row
        label="Preset"
        hint="Switch between the default Vimeflow binding set and Vim-style bindings."
      >
        <Select
          value={settings.keymapPreset}
          onChange={(value) => update({ keymapPreset: value })}
          aria-label="Keymap preset"
          options={[
            { id: 'vimeflow', label: 'Vimeflow (default)' },
            { id: 'vim', label: 'Vim' },
          ]}
        />
      </Row>

      {GROUP_ORDER.map((group) => {
        const cmds = CATALOG.filter((cmd) => cmd.group === group)

        return groupShell(
          group,
          cmds.map((cmd, i) => commandRow(cmd, i === cmds.length - 1))
        )
      })}

      {KEYMAP_GROUPS.filter(
        (group) => group.zone === 'Diff (when focused)'
      ).map(staticGroup)}

      {showVim && VIM_KEYMAP_GROUPS.map(staticGroup)}

      <p className="font-body text-xs text-on-surface-muted">
        More actions are available in the {formatShortcut(['Mod', ';'])} command
        palette.
      </p>
    </>
  )
}
