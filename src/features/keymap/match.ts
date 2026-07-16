import type { Chord } from './chord'

// The resolved 'Mod' — WorkspaceView already derives this as `preferModifier`.
export type PlatformSuper = 'meta' | 'ctrl'

export interface KeyChordInput {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

// Pure matcher (spec §6.1). Super modifiers are EXACT (required down, all others
// up); Shift/Alt follow `policy`: a listed one must be down; an unlisted one is
// forbidden-if-down under 'exact' and ignored under 'tolerant'.
export const eventMatchesChord = (
  event: KeyChordInput,
  chord: Chord,
  superKey: PlatformSuper,
  policy: 'exact' | 'tolerant' = 'exact'
): boolean => {
  if (event.code !== chord.code) {
    return false
  }

  const wantMod = chord.mods.has('Mod')
  const wantCtrl = chord.mods.has('Ctrl')
  const needMeta = wantMod && superKey === 'meta'
  const needCtrl = wantCtrl || (wantMod && superKey === 'ctrl')
  if (event.metaKey !== needMeta || event.ctrlKey !== needCtrl) {
    return false
  }

  const secondaryOk = (down: boolean, listed: boolean): boolean => {
    if (listed) {
      return down // required
    }

    return policy === 'tolerant' || !down // exact ⇒ must be up
  }
  if (!secondaryOk(event.shiftKey, chord.mods.has('Shift'))) {
    return false
  }
  if (!secondaryOk(event.altKey, chord.mods.has('Alt'))) {
    return false
  }

  return true
}
