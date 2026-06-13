import { type HTMLProps, type ReactElement } from 'react'

// The single source for an option row's shape. Re-exported by the public
// Dropdown so features import it from @/components/Dropdown, never from base/.
export interface DropdownOption<T extends string | number> {
  value: T
  label: string
  description?: string
}

interface OptionListProps<T extends string | number> {
  options: readonly DropdownOption<T>[]
  value: T
  onSelect: (next: T) => void
  // Floating-ui item-prop getter from the parent's useFloatingSurface.
  getItemProps: (props?: HTMLProps<HTMLElement>) => Record<string, unknown>
  // Lets the parent collect each row node for keyboard navigation focus.
  registerItem: (index: number, node: HTMLButtonElement | null) => void
}

// The shared option-row renderer behind Dropdown and Menu.Submenu: maps options
// to role="menuitem" buttons with the selected highlight, and wires each row to
// the parent's floating list navigation via getItemProps + registerItem.
export const OptionList = <T extends string | number>({
  options,
  value,
  onSelect,
  getItemProps,
  registerItem,
}: OptionListProps<T>): ReactElement => (
  <>
    {options.map((option, index) => (
      <button
        key={String(option.value)}
        ref={(node): void => registerItem(index, node)}
        type="button"
        role="menuitem"
        className={`w-full text-left px-3 py-1.5 hover:bg-surface-container-highest transition-colors ${
          option.value === value ? 'text-primary' : 'text-on-surface'
        }`}
        {...getItemProps({
          onClick: (): void => onSelect(option.value),
        })}
      >
        <div className="text-xs font-medium">{option.label}</div>
        {option.description ? (
          <div className="text-on-surface-variant text-[0.65rem] mt-0.5 leading-tight">
            {option.description}
          </div>
        ) : null}
      </button>
    ))}
  </>
)
