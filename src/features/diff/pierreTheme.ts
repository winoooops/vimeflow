import type { DiffsThemeNames } from '@pierre/diffs'
import type { ThemeKind } from '../../theme'

/** Pierre ships fixed built-in themes; map the workspace kind to the
 * nearest one. The toolbar dropdown stays as a session-level override —
 * a workspace theme switch resets it to this mapping. */
export const pierreThemeForKind = (kind: ThemeKind): DiffsThemeNames =>
  kind === 'dark' ? 'pierre-dark' : 'pierre-light'
