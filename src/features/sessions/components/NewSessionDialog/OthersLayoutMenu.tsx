import { type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import { LayoutGlyph } from '../../../terminal/components/LayoutSwitcher/LayoutGlyph'
import type {
  LayoutShape,
  PaneLayoutId,
} from '../../../terminal/layout-registry'

interface OthersLayoutMenuProps {
  /** The overflow layouts (e.g. custom presets) kept out of the inline list. */
  layouts: readonly LayoutShape[]
  onPick: (id: PaneLayoutId) => void
}

// Overflow for the layout column: keeps the inline switcher to the builtins so
// many saved presets don't bloat the dialog. Picking one selects it (and it
// then shows inline as the active layout). Uses the compact context-menu look.
export const OthersLayoutMenu = ({
  layouts,
  onPick,
}: OthersLayoutMenuProps): ReactElement => (
  <Menu
    aria-label="More layouts"
    variant="compact"
    placement="right-start"
    trigger={
      <button
        type="button"
        aria-label="More layouts"
        className="flex w-full items-center gap-2 rounded-[9px] border border-dashed border-outline-variant/50 px-2.5 py-2 text-left text-xs text-on-surface-muted transition-colors hover:text-on-surface"
      >
        <span
          className="material-symbols-outlined text-base"
          aria-hidden="true"
        >
          more_horiz
        </span>
        <span className="flex-1">Others</span>
      </button>
    }
  >
    {layouts.map((entry) => (
      <Menu.Item
        key={entry.id}
        leadingIcon={
          <LayoutGlyph layoutId={entry.id} definition={entry.definition} />
        }
        onSelect={() => onPick(entry.id)}
      >
        {entry.name}
      </Menu.Item>
    ))}
  </Menu>
)
