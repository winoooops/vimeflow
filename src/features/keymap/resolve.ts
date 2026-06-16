import { CATALOG, type CommandDescriptor, type CommandId } from './catalog'
import { exactlyOneSuper, parseChord, type Chord } from './chord'
import { overrideCollides } from './conflicts'
import type { PlatformSuper } from './match'

export type CustomKeybindings = Partial<Record<CommandId, string>>

export const resolveDefault = (
  cmd: Pick<CommandDescriptor, 'defaultCombo'>,
  isMac: boolean
): Chord =>
  typeof cmd.defaultCombo === 'function'
    ? cmd.defaultCombo(isMac)
    : cmd.defaultCombo

// Resolve defaults ⊕ overrides by validating the FINAL candidate set (spec §5.3):
// 1. seed with defaults; 2. apply every structurally-valid override; 3. revert
// any overridden command still colliding (fixpoint, catalog order) — fixed and
// default bindings are never reverted, so a clean A↔B swap keeps both overrides
// while a hand-edited collision is neutralised.
export const resolveBindings = (
  overrides: CustomKeybindings,
  isMac: boolean,
  superKey: PlatformSuper
): Map<CommandId, Chord> => {
  const resolved = new Map<CommandId, Chord>(
    CATALOG.map((cmd): [CommandId, Chord] => [cmd.id, resolveDefault(cmd, isMac)])
  )

  for (const cmd of CATALOG) {
    if (!cmd.rebindable) {
      continue
    }
    const token = overrides[cmd.id]
    if (token === undefined) {
      continue
    }
    const chord = parseChord(token)
    if (chord !== null && exactlyOneSuper(chord)) {
      resolved.set(cmd.id, chord)
    }
  }

  const reverted = new Set<CommandId>()
  let changed = true
  while (changed) {
    changed = false
    for (const cmd of CATALOG) {
      if (
        !cmd.rebindable ||
        overrides[cmd.id] === undefined ||
        reverted.has(cmd.id)
      ) {
        continue
      }
      if (overrideCollides(cmd.id, resolved.get(cmd.id)!, resolved, superKey)) {
        resolved.set(cmd.id, resolveDefault(cmd, isMac))
        reverted.add(cmd.id)
        changed = true
      }
    }
  }

  return resolved
}

export const resolveBinding = (
  id: CommandId,
  overrides: CustomKeybindings,
  isMac: boolean,
  superKey: PlatformSuper
): Chord => resolveBindings(overrides, isMac, superKey).get(id)!
