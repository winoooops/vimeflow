import { CATALOG, type BindingContext, type CommandId } from './catalog'
import { formatChord } from './chord'
import { resolveBindings, type CustomKeybindings } from './resolve'

export type WorkspaceKeybindingOverrides = CustomKeybindings

export interface WorkspaceKeybindingSnapshotEntry {
  id: CommandId
  context: BindingContext
  matchPolicy: 'exact' | 'tolerant'
  code: string
  token: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

export interface WorkspaceKeybindingSnapshot {
  version: 1
  bindings: readonly WorkspaceKeybindingSnapshotEntry[]
}

export interface WorkspaceKeybindingInput {
  code: string
  control: boolean
  meta: boolean
  alt: boolean
  shift?: boolean
}

export const createWorkspaceKeybindingSnapshot = (
  overrides: WorkspaceKeybindingOverrides,
  platform: string
): WorkspaceKeybindingSnapshot => {
  const isMac = platform === 'darwin'
  const superKey = isMac ? 'meta' : 'ctrl'
  const resolved = resolveBindings(overrides, isMac, superKey)

  return {
    version: 1,
    bindings: CATALOG.map((command): WorkspaceKeybindingSnapshotEntry => {
      const chord = resolved.get(command.id)!
      const hasMod = chord.mods.has('Mod')

      return {
        id: command.id,
        context: command.context,
        matchPolicy: command.matchPolicy,
        code: chord.code,
        token: formatChord(chord),
        control: chord.mods.has('Ctrl') || (hasMod && !isMac),
        meta: hasMod && isMac,
        alt: chord.mods.has('Alt'),
        shift: chord.mods.has('Shift'),
      }
    }),
  }
}

const secondaryMatches = (
  down: boolean,
  required: boolean,
  policy: WorkspaceKeybindingSnapshotEntry['matchPolicy']
): boolean => (required ? down : policy === 'tolerant' || !down)

export const matchingWorkspaceKeybindings = (
  snapshot: WorkspaceKeybindingSnapshot,
  input: WorkspaceKeybindingInput,
  contexts?: readonly BindingContext[]
): WorkspaceKeybindingSnapshotEntry[] =>
  snapshot.bindings.filter(
    (entry) =>
      (contexts === undefined || contexts.includes(entry.context)) &&
      entry.code === input.code &&
      entry.control === input.control &&
      entry.meta === input.meta &&
      secondaryMatches(input.alt, entry.alt, entry.matchPolicy) &&
      secondaryMatches(input.shift === true, entry.shift, entry.matchPolicy)
  )
