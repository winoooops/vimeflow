import { useState, type ReactElement } from 'react'
import { KEYMAPS } from '../../sections'
import { Icon } from '../Icon'
import { Kbd } from '../Kbd'
import { GhostButton, PaneTitle, Row, Select } from '../controls'

export const KeymapPane = (): ReactElement => {
  const [preset, setPreset] = useState('vimeflow')

  return (
    <>
      <PaneTitle title="Keymap" sub="Keyboard shortcuts" />

      <Row
        label="Preset"
        hint="Switch between vim-style, default, or a custom binding set."
      >
        <Select
          value={preset}
          onChange={setPreset}
          aria-label="Keymap preset"
          options={[
            { id: 'vimeflow', label: 'Vimeflow (default)' },
            { id: 'vim', label: 'Vim' },
            { id: 'vscode', label: 'VS Code' },
            { id: 'jetbrains', label: 'JetBrains' },
            { id: 'custom', label: 'Custom' },
          ]}
        />
      </Row>

      <div className="mb-2 mt-4">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-on-surface-muted">
          Bindings
        </div>

        <div className="overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest/50">
          {KEYMAPS.map((b, i) => (
            <div
              key={b.id}
              className={`flex items-center gap-3.5 px-3.5 py-2.5 ${
                i === KEYMAPS.length - 1
                  ? ''
                  : 'border-b border-outline-variant/15'
              }`}
            >
              <span className="min-w-0 flex-1 font-body text-[13px] text-on-surface-variant">
                {b.label}
              </span>
              <span className="flex gap-1">
                {b.keys.map((k, j) => (
                  <Kbd key={j}>{k}</Kbd>
                ))}
              </span>
              <button
                type="button"
                title="Edit binding"
                onClick={() => undefined}
                className="grid h-[22px] w-[22px] place-items-center rounded border-none bg-transparent text-on-surface-muted transition-colors hover:bg-white/[0.04] hover:text-primary"
              >
                <Icon name="edit" size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3.5 flex gap-2">
        <GhostButton>Reset to preset</GhostButton>
        <GhostButton>Import bindings...</GhostButton>
        <GhostButton>Export bindings</GhostButton>
      </div>
    </>
  )
}
