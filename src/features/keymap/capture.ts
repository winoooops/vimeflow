import type { Chord, Mod } from './chord'

export const KEYMAP_CAPTURE_TARGET_ATTRIBUTE = 'data-keymap-capture-target'

const KEYMAP_CAPTURE_TARGET_SELECTOR = `[${KEYMAP_CAPTURE_TARGET_ATTRIBUTE}="true"]`

const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'NumLock',
  'ScrollLock',
])

export const isKeymapCaptureTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(KEYMAP_CAPTURE_TARGET_SELECTOR) !== null

export const eventToChord = (
  event: KeyboardEvent,
  isMac: boolean
): Chord | null => {
  if (event.code === '' || MODIFIER_CODES.has(event.code)) {
    return null
  }

  const mods = new Set<Mod>()
  if (isMac) {
    if (event.metaKey) {
      mods.add('Mod')
    }
    if (event.ctrlKey) {
      mods.add('Ctrl')
    }
  } else if (event.ctrlKey) {
    mods.add('Mod')
  }

  if (event.altKey) {
    mods.add('Alt')
  }
  if (event.shiftKey) {
    mods.add('Shift')
  }

  return { code: event.code, mods }
}
