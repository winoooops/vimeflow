import {
  type FocusEvent as ReactFocusEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react'
import { IconButton } from '@/components/IconButton'
import {
  formatShortcut,
  isMacPlatform,
  type ShortcutInput,
} from '../../../../lib/formatShortcut'
import { useSettings } from '../../hooks/useSettings'
import {
  SETTINGS_TARGET_IDS,
  VIM_KEYMAP_GROUPS,
  keymapCommandTargetId,
  keymapStaticTargetId,
} from '../../sections'
import { CATALOG, getCommand, type CommandId } from '../../../keymap/catalog'
import {
  eventToChord,
  KEYMAP_CAPTURE_TARGET_ATTRIBUTE,
} from '../../../keymap/capture'
import type { Chord } from '../../../keymap/chord'
import { chordToVisibleShortcutInput } from '../../../keymap/displayKey'
import {
  useKeybindings,
  type SetBindingResult,
} from '../../../keymap/useKeybindings'
import type {
  KeymapBinding,
  KeymapGroup,
  KeymapKeys,
  SettingsPaneTargetProps,
} from '../../types'
import { Kbd } from '../Kbd'
import { PaneTitle, Row, Select } from '../controls'

// Vim ex-commands are palette text commands, not keybindings, so they retain
// their own static rows. Every keyboard binding renders from the catalog.
const GROUP_ORDER = [
  'Global',
  'Sessions',
  'Panes & Layout',
  'Terminal',
  'Browser',
  'Diff (when focused)',
] as const
type CatalogCommand = (typeof CATALOG)[number]
type FeedbackTone = 'info' | 'danger'
type TabDirection = 'forward' | 'backward'

interface Feedback {
  id: CommandId
  tone: FeedbackTone
  text: string
}

interface PendingTabFocus {
  id: CommandId
  direction: TabDirection
}

const KEYMAP_EDIT_BUTTON_ATTRIBUTE = 'data-keymap-edit-command'
const FEEDBACK_TIMEOUT_MS = 1800

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const focusableElements = (container: ParentNode): HTMLElement[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(
    (el) =>
      !el.matches(':disabled') && el.getAttribute('aria-hidden') !== 'true'
  )

const focusEditButton = (id: CommandId): void => {
  document
    .querySelector<HTMLButtonElement>(
      `[${KEYMAP_EDIT_BUTTON_ATTRIBUTE}="${id}"]`
    )
    ?.focus()
}

const focusAfterTabCancel = (id: CommandId, direction: TabDirection): void => {
  const editButton = document.querySelector<HTMLButtonElement>(
    `[${KEYMAP_EDIT_BUTTON_ATTRIBUTE}="${id}"]`
  )
  if (editButton === null) {
    return
  }

  const scope = editButton.closest('[role="dialog"]') ?? document
  const focusable = focusableElements(scope)
  const currentIndex = focusable.indexOf(editButton)
  if (currentIndex === -1) {
    editButton.focus()

    return
  }

  const delta = direction === 'backward' ? -1 : 1
  const nextIndex = (currentIndex + delta + focusable.length) % focusable.length
  focusable[nextIndex]?.focus()
}

const rowClass = (last: boolean, active = false): string =>
  `flex scroll-mt-4 items-center gap-3.5 rounded-lg px-3.5 py-2.5 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/65 ${
    active ? 'bg-primary-container/[0.08]' : ''
  } ${last ? '' : 'border-b border-outline-variant/15'}`

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

const shortcutLabel = (chord: Chord): string =>
  formatShortcut(chordToVisibleShortcutInput(chord))

const iconButtonClass = (disabled = false): string =>
  `inline-flex h-7 w-7 items-center justify-center rounded-md border border-outline-variant/35 bg-surface-container-low/70 text-on-surface-muted transition-colors ${
    disabled
      ? 'cursor-not-allowed opacity-40'
      : 'hover:bg-surface-container-high hover:text-on-surface'
  }`

const resultMessage = (
  reason: Exclude<SetBindingResult, { ok: true }>['reason'],
  id: CommandId
): string => {
  if (reason === 'invalid-super') {
    return getCommand(id).context === 'diff'
      ? 'Use at most one primary modifier.'
      : 'Use exactly one primary modifier.'
  }
  if (reason === 'reserved') {
    return 'Shortcut is reserved.'
  }

  return 'Shortcut conflicts with another command.'
}

// Vim ex-command rows keep their existing string-token rendering.
const resolveKeys = (keys: KeymapKeys): ShortcutInput[] =>
  typeof keys === 'function' ? keys(isMacPlatform()) : keys

export const KeymapPane = ({
  activeTargetId = null,
}: SettingsPaneTargetProps): ReactElement => {
  const { settings, update } = useSettings()
  const { bindingFor, resetBinding, setUserBinding } = useKeybindings()
  const [editingId, setEditingId] = useState<CommandId | null>(null)
  const [draftChord, setDraftChord] = useState<Chord | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const pendingTabFocusRef = useRef<PendingTabFocus | null>(null)
  const pendingCancelFocusRef = useRef<CommandId | null>(null)
  const showVim = settings.keymapPreset === 'vim'
  const isMac = isMacPlatform()

  useEffect(() => {
    window.vimeflow?.setKeymapCaptureActive?.(editingId !== null)

    return (): void => {
      window.vimeflow?.setKeymapCaptureActive?.(false)
    }
  }, [editingId])

  useLayoutEffect(() => {
    if (editingId !== null) {
      return
    }

    if (pendingCancelFocusRef.current !== null) {
      const id = pendingCancelFocusRef.current
      pendingCancelFocusRef.current = null
      focusEditButton(id)

      return
    }

    if (pendingTabFocusRef.current === null) {
      return
    }

    const pending = pendingTabFocusRef.current
    pendingTabFocusRef.current = null
    focusAfterTabCancel(pending.id, pending.direction)
  }, [editingId])

  useEffect(() => {
    if (feedback === null || feedback.tone === 'danger') {
      return
    }

    const timeout = window.setTimeout(() => {
      setFeedback((current) =>
        current?.id === feedback.id &&
        current.tone === feedback.tone &&
        current.text === feedback.text
          ? null
          : current
      )
    }, FEEDBACK_TIMEOUT_MS)

    return (): void => {
      window.clearTimeout(timeout)
    }
  }, [feedback])

  const stopEditing = (): void => {
    setEditingId(null)
    setDraftChord(null)
  }

  const cancelEditing = (restoreId?: CommandId): void => {
    if (restoreId !== undefined) {
      pendingCancelFocusRef.current = restoreId
    }
    stopEditing()
    setFeedback(null)
  }

  const startEditing = (id: CommandId): void => {
    setEditingId(id)
    setDraftChord(null)
    setFeedback(null)
  }

  const captureChord = (
    id: CommandId,
    event: ReactKeyboardEvent<HTMLButtonElement>
  ): void => {
    if (
      event.key === 'Escape' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault()
      event.stopPropagation()
      cancelEditing(id)

      return
    }

    if (
      event.key === 'Tab' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault()
      event.stopPropagation()
      pendingTabFocusRef.current = {
        id,
        direction: event.shiftKey ? 'backward' : 'forward',
      }
      cancelEditing()

      return
    }

    event.preventDefault()
    event.stopPropagation()

    const chord = eventToChord(event.nativeEvent, isMac)
    if (chord !== null) {
      setDraftChord(chord)
      setFeedback(null)
    }
  }

  const cancelEditingOnFocusLeave = (
    event: ReactFocusEvent<HTMLDivElement>
  ): void => {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return
    }

    cancelEditing()
  }

  const saveDraft = (id: CommandId): void => {
    if (draftChord === null) {
      return
    }

    const result = setUserBinding(id, draftChord)
    if (result.ok) {
      setFeedback({ id, tone: 'info', text: 'Saved.' })
      pendingCancelFocusRef.current = id
      stopEditing()

      return
    }

    setFeedback({
      id,
      tone: 'danger',
      text: resultMessage(result.reason, id),
    })
  }

  const resetCommand = (id: CommandId): void => {
    resetBinding(id)
    if (editingId === id) {
      stopEditing()
    }
    setFeedback({ id, tone: 'info', text: 'Reset.' })
  }

  const iconButton = ({
    label,
    icon,
    onClick,
    disabled = false,
    editCommandId = undefined,
  }: {
    label: string
    icon: string
    onClick: () => void
    disabled?: boolean
    editCommandId?: CommandId
  }): ReactElement => (
    <IconButton
      type="button"
      label={label}
      icon={icon}
      size="sm"
      variant="ghost"
      showTooltip
      {...(editCommandId === undefined
        ? {}
        : { [KEYMAP_EDIT_BUTTON_ATTRIBUTE]: editCommandId })}
      onClick={onClick}
      disabled={disabled}
      className={iconButtonClass(disabled)}
    />
  )

  const commandRow = (cmd: CatalogCommand, last: boolean): ReactElement => {
    const isEditing = editingId === cmd.id
    const isOverridden = settings.customKeybindings[cmd.id] !== undefined
    const rowFeedback = feedback?.id === cmd.id ? feedback : null
    const targetId = keymapCommandTargetId(cmd.id)
    const targetActive = activeTargetId === targetId

    return (
      <div
        key={cmd.id}
        data-testid={`settings-target-${targetId}`}
        data-settings-target={targetId}
        data-settings-target-active={targetActive ? 'true' : undefined}
        tabIndex={-1}
        className={rowClass(last, targetActive)}
      >
        {labelCell(cmd.label)}
        <div className="flex shrink-0 items-center gap-2">
          {rowFeedback && (
            <span
              role={rowFeedback.tone === 'danger' ? 'alert' : 'status'}
              className={`min-w-[148px] text-right font-body text-xs ${
                rowFeedback.tone === 'danger'
                  ? 'text-error'
                  : 'text-on-surface-muted'
              }`}
            >
              {rowFeedback.text}
            </span>
          )}

          <span className="flex min-w-[72px] justify-end gap-1">
            <Kbd>{shortcutLabel(bindingFor(cmd.id))}</Kbd>
          </span>

          {cmd.rebindable && (
            <>
              {isEditing ? (
                <div
                  className="flex items-center gap-1.5"
                  onBlur={cancelEditingOnFocusLeave}
                >
                  <button
                    type="button"
                    autoFocus
                    aria-label={`Capture ${cmd.label} binding`}
                    {...{ [KEYMAP_CAPTURE_TARGET_ATTRIBUTE]: 'true' }}
                    onKeyDown={(event) => captureChord(cmd.id, event)}
                    className="inline-flex h-7 min-w-[92px] items-center justify-center rounded-md border border-primary/45 bg-primary-container/20 px-2 font-mono text-[10px] font-semibold text-on-surface outline-none focus:ring-1 focus:ring-primary"
                  >
                    {draftChord === null ? (
                      'Recording'
                    ) : (
                      <Kbd>{shortcutLabel(draftChord)}</Kbd>
                    )}
                  </button>
                  {iconButton({
                    label: `Save ${cmd.label} binding`,
                    icon: 'check',
                    onClick: () => saveDraft(cmd.id),
                    disabled: draftChord === null,
                  })}
                  {iconButton({
                    label: `Cancel ${cmd.label} binding edit`,
                    icon: 'close',
                    onClick: () => cancelEditing(cmd.id),
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  {iconButton({
                    label: `Edit ${cmd.label} binding`,
                    icon: 'edit',
                    onClick: () => startEditing(cmd.id),
                    editCommandId: cmd.id,
                  })}
                  {iconButton({
                    label: `Reset ${cmd.label} binding`,
                    icon: 'restart_alt',
                    onClick: () => resetCommand(cmd.id),
                    disabled: !isOverridden,
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  const staticGroup = (group: KeymapGroup): ReactElement =>
    groupShell(
      group.zone,
      group.bindings.map((b: KeymapBinding, i) => {
        const targetId = keymapStaticTargetId(b.id)
        const targetActive = activeTargetId === targetId

        return (
          <div
            key={b.id}
            data-testid={`settings-target-${targetId}`}
            data-settings-target={targetId}
            data-settings-target-active={targetActive ? 'true' : undefined}
            tabIndex={-1}
            className={rowClass(i === group.bindings.length - 1, targetActive)}
          >
            {labelCell(b.label)}
            <span className="flex gap-1">
              {resolveKeys(b.keys).map((k, j) => (
                <Kbd key={`${b.id}-${j}`}>{formatShortcut(k)}</Kbd>
              ))}
            </span>
          </div>
        )
      })
    )

  return (
    <>
      <PaneTitle title="Keymap" sub="Keyboard shortcuts" />

      <Row
        label="Preset"
        hint="Switch between the default Vimeflow binding set and Vim-style bindings."
        settingsTargetId={SETTINGS_TARGET_IDS.keymapPreset}
        settingsTargetActive={
          activeTargetId === SETTINGS_TARGET_IDS.keymapPreset
        }
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

      {showVim && VIM_KEYMAP_GROUPS.map(staticGroup)}

      <p className="font-body text-xs text-on-surface-muted">
        More actions are available in the {shortcutLabel(bindingFor('palette'))}{' '}
        command palette.
      </p>
    </>
  )
}
