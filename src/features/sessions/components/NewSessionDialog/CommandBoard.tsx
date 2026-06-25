import { type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import { LAYOUTS } from '../../../terminal/layout-registry'
import type { CommandId, PaneLayoutId } from '../../types'
import { COMMANDS, COMMAND_ORDER } from './commands'

interface CommandBoardProps {
  layoutId: PaneLayoutId
  assign: CommandId[]
  onAssign: (index: number, command: CommandId) => void
}

export const CommandBoard = ({
  layoutId,
  assign,
  onAssign,
}: CommandBoardProps): ReactElement => {
  const layout = LAYOUTS[layoutId]
  const areas = layout.areas.map((row) => `"${row.join(' ')}"`).join(' ')

  return (
    <div
      className="grid h-[150px] gap-2"
      style={{
        gridTemplateColumns: layout.cols,
        gridTemplateRows: layout.rows,
        gridTemplateAreas: areas,
      }}
    >
      {Array.from({ length: layout.capacity }).map((_, i) => {
        const command = COMMANDS[assign[i] ?? 'shell']
        const Icon = command.Icon

        return (
          <div key={i} style={{ gridArea: `p${i}` }} className="min-w-0">
            <Menu
              aria-label={`Command for pane ${i + 1}`}
              trigger={
                <button
                  type="button"
                  aria-label={`Choose command for pane ${i + 1}`}
                  className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-outline-variant/50 bg-surface-container-lowest p-2 text-center"
                >
                  <span
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg font-mono text-base"
                    style={{
                      color: `var(${command.accentVar})`,
                      background: `color-mix(in srgb, var(${command.accentVar}) 16%, transparent)`,
                    }}
                  >
                    {Icon ? (
                      <Icon width={16} height={16} aria-hidden />
                    ) : command.materialIcon ? (
                      <span
                        className="material-symbols-outlined text-base"
                        aria-hidden="true"
                      >
                        {command.materialIcon}
                      </span>
                    ) : (
                      command.glyph
                    )}
                  </span>
                  <span className="truncate text-xs font-semibold text-on-surface-variant">
                    {command.label}
                  </span>
                </button>
              }
            >
              {COMMAND_ORDER.map((id) => (
                <Menu.Item key={id} onSelect={() => onAssign(i, id)}>
                  {COMMANDS[id].label}
                </Menu.Item>
              ))}
            </Menu>
          </div>
        )
      })}
    </div>
  )
}
