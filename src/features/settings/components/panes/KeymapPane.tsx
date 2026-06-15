import type { ReactElement } from 'react'
import {
  formatShortcut,
  isMacPlatform,
  type ShortcutInput,
} from '../../../../lib/formatShortcut'
import { useSettings } from '../../hooks/useSettings'
import { KEYMAP_GROUPS, VIM_KEYMAP_GROUPS } from '../../sections'
import type { KeymapBinding, KeymapGroup, KeymapKeys } from '../../types'
import { Kbd } from '../Kbd'
import { PaneTitle, Row, Select } from '../controls'

const resolveKeys = (keys: KeymapKeys): ShortcutInput[] =>
  typeof keys === 'function' ? keys(isMacPlatform()) : keys

const renderKeys = (binding: KeymapBinding): ReactElement[] =>
  resolveKeys(binding.keys).map((k, index) => (
    <Kbd key={`${binding.id}-${index}`}>{formatShortcut(k)}</Kbd>
  ))

const formatZone = (zone: string): string =>
  zone.replace('Mod;', formatShortcut(['Mod', ';']))

const renderGroup = (group: KeymapGroup): ReactElement => (
  <div key={group.zone} className="mb-4">
    <div className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-on-surface-muted">
      {formatZone(group.zone)}
    </div>

    <div className="overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest/50">
      {group.bindings.map((b, i) => (
        <div
          key={b.id}
          className={`flex items-center gap-3.5 px-3.5 py-2.5 ${
            i === group.bindings.length - 1
              ? ''
              : 'border-b border-outline-variant/15'
          }`}
        >
          <span className="min-w-0 flex-1 font-body text-[13px] text-on-surface-variant">
            {b.label}
          </span>
          <span className="flex gap-1">{renderKeys(b)}</span>
        </div>
      ))}
    </div>
  </div>
)

export const KeymapPane = (): ReactElement => {
  const { settings, update } = useSettings()
  const showVim = settings.keymapPreset === 'vim'

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

      {KEYMAP_GROUPS.map(renderGroup)}
      {showVim && VIM_KEYMAP_GROUPS.map(renderGroup)}

      <p className="font-body text-xs text-on-surface-muted">
        More actions are available in the {formatShortcut(['Mod', ';'])} command
        palette.
      </p>
    </>
  )
}
