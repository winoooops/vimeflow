import { getCommand, type BindingContext, type CommandId } from './catalog'
import type { Chord } from './chord'
import type { PlatformSuper } from './match'

export interface Conflict {
  key: string // "<super>+<code>" of the shared key
  commandIds: CommandId[]
  contexts: BindingContext[]
}

type Super = 'meta' | 'ctrl' | 'none'

const superOf = (chord: Chord, superKey: PlatformSuper): Super => {
  if (chord.mods.has('Mod')) {
    return superKey
  }
  if (chord.mods.has('Ctrl')) {
    return 'ctrl'
  }

  return 'none'
}

// Allowed values for a secondary modifier (Shift/Alt) under a policy: a listed
// modifier is fixed down; an unlisted one is fixed up under 'exact' and free
// under 'tolerant'.
const secondarySet = (
  listed: boolean,
  policy: 'exact' | 'tolerant'
): ReadonlySet<boolean> =>
  listed
    ? new Set([true])
    : policy === 'exact'
      ? new Set([false])
      : new Set([true, false])

const intersects = (
  a: ReadonlySet<boolean>,
  b: ReadonlySet<boolean>
): boolean => [...a].some((value) => b.has(value))

export const intentionallyShadowed = (a: CommandId, b: CommandId): boolean => {
  const cmdA = getCommand(a)
  const cmdB = getCommand(b)

  return (
    cmdA.intentionalShadowWith?.includes(b) === true ||
    cmdB.intentionalShadowWith?.includes(a) === true
  )
}

// Two resolved bindings overlap iff same (super, code) AND a Shift/Alt
// assignment matches both under their policies (spec §5.4).
export const chordsOverlap = (
  a: Chord,
  policyA: 'exact' | 'tolerant',
  b: Chord,
  policyB: 'exact' | 'tolerant',
  superKey: PlatformSuper
): boolean =>
  a.code === b.code &&
  superOf(a, superKey) === superOf(b, superKey) &&
  intersects(
    secondarySet(a.mods.has('Shift'), policyA),
    secondarySet(b.mods.has('Shift'), policyB)
  ) &&
  intersects(
    secondarySet(a.mods.has('Alt'), policyA),
    secondarySet(b.mods.has('Alt'), policyB)
  )

// global overlaps every surface; surfaces are mutually exclusive (D6 / §5.4).
export const contextsOverlap = (
  a: BindingContext,
  b: BindingContext
): boolean => a === 'global' || b === 'global' || a === b

// Does applying `chord` to `id` collide with any OTHER resolved binding?
export const overrideCollides = (
  id: CommandId,
  chord: Chord,
  resolved: ReadonlyMap<CommandId, Chord>,
  superKey: PlatformSuper
): boolean => {
  const me = getCommand(id)
  for (const [otherId, otherChord] of resolved) {
    if (otherId === id) {
      continue
    }
    const other = getCommand(otherId)
    if (other.preserveStoredOverrides) {
      continue
    }
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
      return true
    }
  }

  return false
}

export const detectConflicts = (
  resolved: ReadonlyMap<CommandId, Chord>,
  superKey: PlatformSuper
): Conflict[] => {
  const ids = [...resolved.keys()]
  const byKey = new Map<string, Conflict>()
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = getCommand(ids[i])
      const b = getCommand(ids[j])
      const ca = resolved.get(ids[i])!
      const cb = resolved.get(ids[j])!
      if (
        !a.rebindable &&
        !b.rebindable &&
        (a.intentionalShadow || b.intentionalShadow)
      ) {
        continue
      }
      if (intentionallyShadowed(ids[i], ids[j])) {
        continue
      }
      if (
        !contextsOverlap(a.context, b.context) ||
        !chordsOverlap(ca, a.matchPolicy, cb, b.matchPolicy, superKey)
      ) {
        continue
      }
      const key = `${superOf(ca, superKey)}+${ca.code}`
      const conflict = byKey.get(key) ?? { key, commandIds: [], contexts: [] }
      for (const [id, ctx] of [
        [ids[i], a.context],
        [ids[j], b.context],
      ] as const) {
        if (!conflict.commandIds.includes(id)) {
          conflict.commandIds.push(id)
        }
        if (!conflict.contexts.includes(ctx)) {
          conflict.contexts.push(ctx)
        }
      }
      byKey.set(key, conflict)
    }
  }

  return [...byKey.values()]
}
