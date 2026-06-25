import { type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import { LAYOUTS } from '../../../terminal/layout-registry'
import type { PaneLayoutId } from '../../types'
import { LayoutGlyph } from './LayoutGlyph'

const QUICK_LAYOUTS: PaneLayoutId[] = ['single', 'vsplit', 'hsplit']
const ALL_LAYOUTS: PaneLayoutId[] = ['single', 'vsplit', 'hsplit', 'threeRight', 'quad']

interface LayoutPickerProps {
  layoutId: PaneLayoutId
  pinnedLayout: PaneLayoutId | null
  onSelect: (id: PaneLayoutId) => void
  onPin: (id: PaneLayoutId) => void
}

export const LayoutPicker = ({
  layoutId,
  pinnedLayout,
  onSelect,
  onPin,
}: LayoutPickerProps): ReactElement => {
  const visible =
    pinnedLayout !== null && !QUICK_LAYOUTS.includes(pinnedLayout)
      ? [...QUICK_LAYOUTS, pinnedLayout]
      : QUICK_LAYOUTS

  return (
    <div className="flex w-[158px] shrink-0 flex-col gap-1.5">
      {visible.map((id) => {
        const selected = id === layoutId
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={selected}
            className={`flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left ${
              selected
                ? 'bg-primary-container/[0.12] text-primary'
                : 'bg-surface-container-lowest text-on-surface-variant'
            }`}
          >
            <LayoutGlyph id={id} active={selected} />
            <span className="flex-1 text-xs font-medium">{LAYOUTS[id].name}</span>
            <span className="font-mono text-[10px] text-on-surface-muted">{LAYOUTS[id].capacity}</span>
          </button>
        )
      })}
      <Menu
        aria-label="More layouts"
        trigger={
          <button
            type="button"
            aria-label="More layouts"
            className="flex w-full items-center gap-2 rounded-[9px] border border-dashed border-outline-variant/50 px-2.5 py-2 text-left text-xs text-on-surface-muted"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">more_horiz</span>
            <span className="flex-1">More layouts</span>
          </button>
        }
      >
        {ALL_LAYOUTS.map((id) => (
          <Menu.Item
            key={id}
            onSelect={() => {
              onPin(id)
              onSelect(id)
            }}
          >
            {LAYOUTS[id].name}
          </Menu.Item>
        ))}
      </Menu>
    </div>
  )
}
