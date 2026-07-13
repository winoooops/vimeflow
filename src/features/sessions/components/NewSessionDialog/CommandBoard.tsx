import { type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import {
  gridAreaNameForSlotId,
  type LayoutShape,
} from '../../../terminal/layout-registry'
import { commandForId, type CommandDef } from './commands'

interface CommandGlyphProps {
  command: CommandDef
  className: string
  iconSize: number
}

// The accent-tinted icon chip for a command — the brand SVG when present, else
// a material symbol, else the mono glyph. Shared by the pane preview and the
// command-menu rows so they read as the same thing.
const CommandGlyph = ({
  command,
  className,
  iconSize,
}: CommandGlyphProps): ReactElement => {
  const Icon = command.Icon

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg font-mono ${className}`}
      style={{
        color: `var(${command.accentVar})`,
        background: `color-mix(in srgb, var(${command.accentVar}) 16%, transparent)`,
        fontSize: iconSize,
      }}
    >
      {Icon ? (
        <Icon width={iconSize} height={iconSize} aria-hidden />
      ) : command.materialIcon ? (
        <span
          className="material-symbols-outlined leading-none"
          style={{ fontSize: iconSize }}
          aria-hidden="true"
        >
          {command.materialIcon}
        </span>
      ) : (
        command.glyph
      )}
    </span>
  )
}

interface CommandBoardProps {
  layout: LayoutShape
  assign: string[]
  commands: readonly CommandDef[]
  onAssign: (index: number, command: string) => void
  /** Reports each pane menu's open/close so the dialog can defer dismiss to it. */
  onMenuOpenChange?: (open: boolean) => void
}

export const CommandBoard = ({
  layout,
  assign,
  commands,
  onAssign,
  onMenuOpenChange = undefined,
}: CommandBoardProps): ReactElement => {
  const areas = layout.areas.map((row) => `"${row.join(' ')}"`).join(' ')
  // Cell grid-areas come from the same slot→name mapping that built `areas`,
  // so custom layouts (whose slots are sanitized `slot-*` names, not `pN`) map
  // correctly instead of pointing at non-existent `pN` areas.
  const slotAreaNames = layout.definition.addOrder.map(gridAreaNameForSlotId)

  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest/60 p-2 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-on-surface)_8%,transparent)]">
      <div
        className="grid h-[210px] gap-2"
        style={{
          gridTemplateColumns: layout.cols,
          gridTemplateRows: layout.rows,
          gridTemplateAreas: areas,
        }}
      >
        {slotAreaNames.map((areaName, i) => {
          const command = commandForId(commands, assign[i] ?? 'shell')

          return (
            <div
              key={areaName}
              style={{ gridArea: areaName }}
              className="min-w-0"
            >
              <Menu
                aria-label={`Command for pane ${i + 1}`}
                variant="compact"
                onOpenChange={onMenuOpenChange}
                trigger={
                  <button
                    type="button"
                    aria-label={`Choose command for pane ${i + 1}`}
                    className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-outline-variant/50 bg-surface-container/40 p-2 text-center transition-colors hover:bg-surface-container/70"
                  >
                    <CommandGlyph
                      command={command}
                      className="h-[30px] w-[30px]"
                      iconSize={16}
                    />
                    <span className="truncate text-xs font-semibold text-on-surface-variant">
                      {command.label}
                    </span>
                  </button>
                }
              >
                {commands.map((commandOption) => (
                  <Menu.Item
                    key={commandOption.id}
                    leadingIcon={
                      <CommandGlyph
                        command={commandOption}
                        className="h-[22px] w-[22px]"
                        iconSize={13}
                      />
                    }
                    onSelect={() => onAssign(i, commandOption.id)}
                  >
                    {commandOption.label}
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
