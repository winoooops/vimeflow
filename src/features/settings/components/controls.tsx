import type { ReactElement } from 'react'
import type {
  GhostButtonProps,
  PaneTitleProps,
  RowProps,
  SelectOption,
  SelectProps,
  TextInputProps,
  ToggleProps,
} from '../types'

export const Row = ({
  label,
  hint,
  children,
  last = false,
  settingsTargetId = undefined,
  settingsTargetActive = false,
}: RowProps): ReactElement => {
  const targetAttrs =
    settingsTargetId === undefined
      ? { 'data-testid': 'row' }
      : {
          'data-testid': `settings-target-${settingsTargetId}`,
          'data-settings-target': settingsTargetId,
          'data-settings-target-active': settingsTargetActive
            ? 'true'
            : undefined,
          tabIndex: -1,
        }

  return (
    <div
      {...targetAttrs}
      className={`flex scroll-mt-4 items-center gap-6 rounded-lg py-3.5 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/65 ${
        settingsTargetActive ? 'bg-primary-container/[0.08]' : ''
      } ${last ? '' : 'border-b border-outline-variant/18'}`}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 font-display text-sm font-medium text-on-surface">
          {label}
        </div>
        {hint && (
          <div className="font-body text-xs leading-relaxed text-on-surface-muted">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export const PaneTitle = ({ title, sub }: PaneTitleProps): ReactElement => (
  <div className="mb-4">
    <div className="mb-1 font-display text-[22px] font-semibold tracking-tight text-on-surface">
      {title}
    </div>
    {sub && (
      <div className="font-mono text-[11px] uppercase tracking-widest text-on-surface-muted">
        {sub}
      </div>
    )}
  </div>
)

export const Toggle = ({
  on = false,
  onChange,
  'aria-label': ariaLabel,
}: ToggleProps): ReactElement => (
  <button
    type="button"
    role="switch"
    aria-label={ariaLabel}
    aria-checked={on}
    onClick={() => onChange(!on)}
    className={`relative h-5 w-9 cursor-pointer rounded-full border-none p-0 transition-colors duration-150 ${
      on ? 'bg-primary-container' : 'bg-outline-variant/50'
    }`}
  >
    <span
      className={`absolute top-0.5 h-4 w-4 rounded-full transition-all duration-180 ${
        on ? 'bg-on-surface' : 'bg-on-surface-variant'
      }`}
      style={{
        left: on ? 18 : 2,
        transitionTimingFunction: 'cubic-bezier(.2,.8,.2,1)',
      }}
    />
  </button>
)

const normalizeOptions = (options: SelectOption[] | string[]): SelectOption[] =>
  options.map((o) => (typeof o === 'string' ? { id: o, label: o } : o))

export const Select = ({
  value,
  options,
  onChange,
  width = 180,
  'aria-label': ariaLabel,
}: SelectProps): ReactElement => {
  const normalized = normalizeOptions(options)

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="h-[30px] cursor-pointer appearance-none rounded-md border border-outline-variant/50 bg-surface-container px-2.5 font-body text-xs text-on-surface outline-none"
      style={{ width }}
    >
      {normalized.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export const GhostButton = ({
  children,
  onClick = (): void => undefined,
  disabled = false,
}: GhostButtonProps): ReactElement => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="rounded-md border border-outline-variant/50 bg-transparent px-3 py-1.5 font-body text-xs text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-45"
  >
    {children}
  </button>
)

export const TextInput = ({
  value,
  onChange,
  placeholder,
  width = 200,
  mono = false,
  'aria-label': ariaLabel,
}: TextInputProps): ReactElement => (
  <input
    type="text"
    aria-label={ariaLabel}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className={`h-[30px] rounded-md border border-outline-variant/50 bg-surface-container px-2.5 text-xs text-on-surface outline-none placeholder:text-on-surface-muted ${
      mono ? 'font-mono' : 'font-body'
    }`}
    style={{ width }}
  />
)
