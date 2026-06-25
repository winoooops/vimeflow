import { type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import {
  gridAreaNameForSlotId,
  type LayoutShape,
} from '../../../terminal/layout-registry'
import type { CommandId } from '../../types'
import { COMMANDS, COMMAND_ORDER } from './commands'

interface CommandBoardProps {
  layout: LayoutShape
  assign: CommandId[]
  onAssign: (index: number, command: CommandId) => void
}

export const CommandBoard = ({
  layout,
  assign,
  onAssign,
}: CommandBoardProps): ReactElement => {
  const areas = layout.areas.map((row) => `"${row.join(' ')}"`).join(' ')
  // Cell grid-areas come from the same slot→name mapping that built `areas`,
  // so custom layouts (whose slots are sanitized `slot-*` names, not `pN`) map
  // correctly instead of pointing at non-existent `pN` areas.
  const slotAreaNames = layout.definition.addOrder.map(gridAreaNameForSlotId)

  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest/60 p-2 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-on-surface)_8%,transparent)]">
      <div
        className="grid h-[150px] gap-2"
        style={{
          gridTemplateColumns: layout.cols,
          gridTemplateRows: layout.rows,
          gridTemplateAreas: areas,
        }}
      >
        {slotAreaNames.map((areaName, i) => {
          const command = COMMANDS[assign[i] ?? 'shell']
          const Icon = command.Icon

          return (
            <div
              key={areaName}
              style={{ gridArea: areaName }}
              className="min-w-0"
            >
              <Menu
                aria-label={`Command for pane ${i + 1}`}
                trigger={
                  <button
                    type="button"
                    aria-label={`Choose command for pane ${i + 1}`}
                    className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-outline-variant/50 bg-surface-container/40 p-2 text-center transition-colors hover:bg-surface-container/70"
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
    </div>
  )
}
