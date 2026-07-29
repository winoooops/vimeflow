import type { ReactElement } from 'react'
import type {
  NativeOverlayHostDialogRenderer,
  NativeOverlayHostDialogRendererContext,
} from '@/components/NativeOverlayHost'
import type { NativeOverlayLayoutCreatorDialogPayload } from '@/components/Dialog'
import type { PaneLayoutDefinition } from '../../layout-registry'
import { LayoutCreatorModal } from './LayoutCreatorModal'

const asPaneLayoutDefinitions = (
  definitions: readonly NativeOverlayLayoutCreatorDialogPayload['existingLayouts'][number][]
): readonly PaneLayoutDefinition[] =>
  definitions as readonly PaneLayoutDefinition[]

const asPaneLayoutDefinition = (
  definition: NativeOverlayLayoutCreatorDialogPayload['seedLayout']
): PaneLayoutDefinition | undefined =>
  definition as PaneLayoutDefinition | undefined

export const renderNativeLayoutCreatorOverlay: NativeOverlayHostDialogRenderer =
  ({
    request,
    dispatchAction,
  }: NativeOverlayHostDialogRendererContext): ReactElement | null => {
    if (request.payload.dialog !== 'layout-creator') {
      return null
    }

    const payload = request.payload as NativeOverlayLayoutCreatorDialogPayload

    return (
      <LayoutCreatorModal
        isOpen
        existingLayouts={asPaneLayoutDefinitions(payload.existingLayouts)}
        seedLayout={asPaneLayoutDefinition(payload.seedLayout)}
        editLayout={asPaneLayoutDefinition(payload.editLayout)}
        onSave={(definition): void => {
          dispatchAction({
            actionId: payload.actions.save,
            closeOnSelect: false,
            query: JSON.stringify(definition),
          })
        }}
        onCancel={(): void => {
          dispatchAction({ actionId: payload.actions.cancel })
        }}
      />
    )
  }
