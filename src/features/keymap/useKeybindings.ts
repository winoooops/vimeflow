import { useCallback, useMemo } from 'react'
import { useSettings } from '../settings/hooks/useSettings'
import { isMacPlatform } from '../../lib/formatShortcut'
import { getCommand, type CommandId } from './catalog'
import { exactlyOneSuper, formatChord, type Chord } from './chord'
import {
  chordsOverlap,
  contextsOverlap,
  detectConflicts,
  intentionallyShadowed,
  type Conflict,
} from './conflicts'
import { eventMatchesChord, type PlatformSuper } from './match'
import { resolveBindings, type CustomKeybindings } from './resolve'

export type SetBindingResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-super' | 'reserved' | 'conflict' }

export interface Keybindings {
  bindingFor: (id: CommandId) => Chord
  matches: (event: KeyboardEvent, id: CommandId) => boolean
  setUserBinding: (id: CommandId, chord: Chord) => SetBindingResult
  resetBinding: (id: CommandId) => void
  conflicts: Conflict[]
}

export const useKeybindings = (): Keybindings => {
  const { settings, update } = useSettings()
  const overrides = settings.customKeybindings as CustomKeybindings
  const isMac = isMacPlatform()
  const superKey: PlatformSuper = isMac ? 'meta' : 'ctrl'

  const resolved = useMemo(
    () => resolveBindings(overrides, isMac, superKey),
    [overrides, isMac, superKey]
  )

  const bindingFor = useCallback(
    (id: CommandId): Chord => resolved.get(id)!,
    [resolved]
  )

  const matches = useCallback(
    (event: KeyboardEvent, id: CommandId): boolean =>
      eventMatchesChord(
        event,
        resolved.get(id)!,
        superKey,
        getCommand(id).matchPolicy
      ),
    [resolved, superKey]
  )

  const setUserBinding = useCallback(
    (id: CommandId, chord: Chord): SetBindingResult => {
      if (!exactlyOneSuper(chord)) {
        return { ok: false, reason: 'invalid-super' }
      }
      const me = getCommand(id)
      if (!me.rebindable) {
        return { ok: false, reason: 'reserved' }
      }
      for (const [otherId, otherChord] of resolved) {
        if (otherId === id) {
          continue
        }
        const other = getCommand(otherId)
        if (intentionallyShadowed(id, otherId)) {
          continue
        }
        if (
          contextsOverlap(me.context, other.context) &&
          chordsOverlap(
            chord,
            me.matchPolicy,
            otherChord,
            other.matchPolicy,
            superKey
          )
        ) {
          return {
            ok: false,
            reason: other.rebindable ? 'conflict' : 'reserved',
          }
        }
      }
      update({ customKeybindings: { ...overrides, [id]: formatChord(chord) } })

      return { ok: true }
    },
    [overrides, resolved, superKey, update]
  )

  const resetBinding = useCallback(
    (id: CommandId): void => {
      if (overrides[id] === undefined) {
        return
      }
      const next = { ...overrides }
      delete next[id]
      update({ customKeybindings: next })
    },
    [overrides, update]
  )

  const conflicts = useMemo(
    () => detectConflicts(resolved, superKey),
    [resolved, superKey]
  )

  return { bindingFor, matches, setUserBinding, resetBinding, conflicts }
}
