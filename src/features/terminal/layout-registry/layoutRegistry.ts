import type { LayoutId, PaneLayoutId } from '../../sessions/types'
import { LAYOUT_IDS } from './layoutIds'
import {
  assemblePaneLayoutRegistry,
  isBuiltinPaneLayoutId,
  isCustomPaneLayoutId,
  type PaneLayoutDefinition,
  type RejectedPaneLayoutDefinition,
} from './layoutDefinition'
import {
  createLayoutShape,
  LAYOUTS,
  LAYOUT_SPECS,
  type LayoutShape,
} from './layoutSpecs'
import { PREBUILT_PANE_LAYOUTS } from './prebuiltLayouts'

export { LAYOUTS }

export const LAYOUT_CYCLE: readonly LayoutId[] = LAYOUT_IDS

export interface RuntimePaneLayoutRegistrySnapshot {
  readonly layouts: readonly LayoutShape[]
  readonly rejected: readonly RejectedPaneLayoutDefinition[]
}

export class PaneLayoutRegistry {
  readonly layouts: readonly LayoutShape[]
  readonly customLayouts: readonly PaneLayoutDefinition[]
  readonly rejected: readonly RejectedPaneLayoutDefinition[]
  private readonly layoutById: ReadonlyMap<PaneLayoutId, LayoutShape>

  constructor(customLayouts: readonly PaneLayoutDefinition[] = []) {
    const snapshot = assemblePaneLayoutRegistry({
      prebuilt: PREBUILT_PANE_LAYOUTS,
      custom: customLayouts,
    })
    const layouts = snapshot.layouts.map(createLayoutShape)

    this.layouts = layouts
    this.customLayouts = snapshot.layouts.filter(
      (definition) => definition.source === 'workspace'
    )
    this.rejected = snapshot.rejected
    this.layoutById = new Map(layouts.map((layout) => [layout.id, layout]))
  }

  getLayout(layoutId: PaneLayoutId): LayoutShape | null {
    return this.layoutById.get(layoutId) ?? null
  }

  getFallbackLayout(layoutId: PaneLayoutId): LayoutShape {
    return this.getLayout(layoutId) ?? LAYOUTS.single
  }

  hasLayoutId(value: string): value is PaneLayoutId {
    return (
      (isBuiltinPaneLayoutId(value) || isCustomPaneLayoutId(value)) &&
      this.layoutById.has(value)
    )
  }

  resolveLayoutId(value: string): PaneLayoutId {
    return this.hasLayoutId(value) ? value : 'single'
  }

  capacityFor(layoutId: PaneLayoutId): number {
    return this.getFallbackLayout(layoutId).capacity
  }

  autoShrinkLayoutFor(
    nextPaneCount: number,
    currentLayoutId: PaneLayoutId
  ): PaneLayoutId {
    const current = this.getLayout(currentLayoutId)

    if (
      current?.definition.source === 'workspace' &&
      nextPaneCount <= current.capacity
    ) {
      return currentLayoutId
    }

    if (nextPaneCount <= 1) {
      return 'single'
    }

    if (nextPaneCount === 2) {
      return currentLayoutId === 'hsplit' ? 'hsplit' : 'vsplit'
    }

    if (nextPaneCount === 3) {
      return 'threeRight'
    }

    if (nextPaneCount === 4) {
      return 'quad'
    }

    if (nextPaneCount === 5 || nextPaneCount === 6) {
      return 'grid3x2'
    }

    return current && nextPaneCount <= current.capacity
      ? currentLayoutId
      : 'grid3x2'
  }
}

export const BUILTIN_PANE_LAYOUT_REGISTRY = new PaneLayoutRegistry()

export const VISIBLE_LAYOUTS: readonly LayoutShape[] = LAYOUT_SPECS

export const isKnownLayoutId = (value: string): value is LayoutId =>
  BUILTIN_PANE_LAYOUT_REGISTRY.hasLayoutId(value) &&
  isBuiltinPaneLayoutId(value)

export const autoShrinkLayoutFor = (
  nextPaneCount: number,
  currentLayoutId: PaneLayoutId,
  registry: PaneLayoutRegistry = BUILTIN_PANE_LAYOUT_REGISTRY
): PaneLayoutId => registry.autoShrinkLayoutFor(nextPaneCount, currentLayoutId)
