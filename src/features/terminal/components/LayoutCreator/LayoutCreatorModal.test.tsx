// cspell:ignore ghostty
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { PaneLayoutDefinition } from '../../layout-registry'
import { LayoutCreatorModal } from './LayoutCreatorModal'

type SaveSpy = (definition: PaneLayoutDefinition) => void

const fullFourByFourLayout = {
  tracks: {
    columns: Array.from({ length: 4 }, (_, col) => ({
      id: `col-${col}`,
      units: 6,
    })),
    rows: Array.from({ length: 4 }, (_, row) => ({
      id: `row-${row}`,
      units: 6,
    })),
  },
  slots: Array.from({ length: 16 }, (_, index) => ({
    id: `slot:p${index}`,
    rect: {
      col: index % 4,
      row: Math.floor(index / 4),
      colSpan: 1,
      rowSpan: 1,
    },
  })),
}

let restorePlatform: (() => void) | null = null
let nativeOverlayActionListener: ((event: unknown) => void) | null = null

const installNativeOverlayBridge = (): {
  open: ReturnType<typeof vi.fn>
  emitAction: (event: unknown) => void
} => {
  const open = vi.fn(() => Promise.resolve({ accepted: true }))

  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'MacIntel',
  })

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    ghosttyNative: {
      update: vi.fn(() => Promise.resolve()),
      data: vi.fn(() => Promise.resolve()),
      focus: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(() => Promise.resolve()),
    },
    nativeOverlay: {
      open,
      close: vi.fn(() => Promise.resolve()),
      actionResult: vi.fn(() => Promise.resolve()),
      resume: vi.fn(() => Promise.resolve()),
      onAction: vi.fn((callback: (event: unknown) => void) => {
        nativeOverlayActionListener = callback

        return vi.fn()
      }),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return {
    open,
    emitAction: (event): void => nativeOverlayActionListener?.(event),
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  restorePlatform?.()
  restorePlatform = null
  delete window.vimeflow
})

describe('LayoutCreatorModal', () => {
  test('uses the native dialog BrowserWindow when requested', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(
      window.navigator,
      'platform'
    )
    restorePlatform = (): void => {
      if (originalPlatform === undefined) {
        delete (window.navigator as unknown as { platform?: string }).platform

        return
      }

      Object.defineProperty(window.navigator, 'platform', originalPlatform)
    }
    const bridge = installNativeOverlayBridge()
    const onSave = vi.fn<SaveSpy>()

    render(
      <LayoutCreatorModal
        isOpen
        nativeOverlay
        existingLayouts={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => expect(bridge.open).toHaveBeenCalledOnce())
    expect(bridge.open).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'dialog',
        payload: expect.objectContaining({
          dialog: 'layout-creator',
          ariaLabel: 'Layout Creator',
        }),
      })
    )

    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute(
      'aria-hidden',
      'true'
    )

    const request = bridge.open.mock.calls[0]?.[0] as
      | { surfaceId?: string }
      | undefined
    bridge.emitAction({
      surfaceId: request?.surfaceId,
      actionId: 'layout-creator:save',
      closeOnSelect: false,
      query: JSON.stringify({
        schemaVersion: 1,
        id: 'custom:untrusted',
        title: 'Native layout',
        source: 'workspace',
        tracks: {
          columns: [{ id: 'col-0', units: 24 }],
          rows: [{ id: 'row-0', units: 24 }],
        },
        slots: [
          {
            id: 'slot:p0',
            rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
          },
        ],
        addOrder: ['slot:p0'],
      }),
    })

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      title: 'Native layout',
      source: 'workspace',
    })
    expect(onSave.mock.calls[0]?.[0].id).not.toBe('custom:untrusted')
    await waitFor(() =>
      expect(window.vimeflow?.nativeOverlay?.actionResult).toHaveBeenCalledWith(
        {
          surfaceId: request?.surfaceId,
          actionId: 'layout-creator:save',
          ok: true,
        }
      )
    )
  })

  test('reports invalid native saves instead of silently no-oping', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(
      window.navigator,
      'platform'
    )
    restorePlatform = (): void => {
      if (originalPlatform === undefined) {
        delete (window.navigator as unknown as { platform?: string }).platform

        return
      }

      Object.defineProperty(window.navigator, 'platform', originalPlatform)
    }
    const bridge = installNativeOverlayBridge()
    const onSave = vi.fn<SaveSpy>()

    render(
      <LayoutCreatorModal
        isOpen
        nativeOverlay
        existingLayouts={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => expect(bridge.open).toHaveBeenCalledOnce())

    const request = bridge.open.mock.calls[0]?.[0] as
      | { surfaceId?: string }
      | undefined
    bridge.emitAction({
      surfaceId: request?.surfaceId,
      actionId: 'layout-creator:save',
      closeOnSelect: false,
      query: JSON.stringify({
        title: 'Overlapping layout',
        tracks: {
          columns: [{ id: 'col-0', units: 24 }],
          rows: [{ id: 'row-0', units: 24 }],
        },
        slots: [
          {
            id: 'slot:p0',
            rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
          },
          {
            id: 'slot:p1',
            rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
          },
        ],
      }),
    })

    await waitFor(() =>
      expect(window.vimeflow?.nativeOverlay?.actionResult).toHaveBeenCalledWith(
        {
          surfaceId: request?.surfaceId,
          actionId: 'layout-creator:save',
          ok: false,
          error: 'Imported layout has overlapping panes',
        }
      )
    )
    expect(onSave).not.toHaveBeenCalled()
  })

  test('surfaces native save errors in the overlay form', () => {
    render(
      <LayoutCreatorModal
        isOpen
        nativeSaveError="Invalid layout"
        existingLayouts={[]}
        onSave={vi.fn<SaveSpy>()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Invalid layout')).toBeInTheDocument()
  })

  test('saves the current draft as a canonical custom pane layout', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SaveSpy>()

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    await user.clear(screen.getByRole('textbox', { name: 'Layout name' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Layout name' }),
      'Solo'
    )
    await user.click(screen.getByRole('button', { name: 'Save & apply' }))

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0]).toMatchObject({
      title: 'Solo',
      source: 'workspace',
      tracks: {
        columns: [{ id: 'col-0', units: 24 }],
        rows: [{ id: 'row-0', units: 24 }],
      },
      slots: [
        { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
      ],
      addOrder: ['slot:p0'],
    })
  })

  test('imports code panel edits before saving', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SaveSpy>()

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    await user.type(
      screen.getByRole('textbox', { name: 'Layout name' }),
      'Imported'
    )
    await user.click(screen.getByRole('button', { name: 'Code · JSON/YAML' }))
    const codeTextArea = screen.getAllByRole('textbox')[1]
    fireEvent.change(codeTextArea, {
      target: {
        value: JSON.stringify({
          tracks: {
            columns: [
              { id: 'col-0', units: 12 },
              { id: 'col-1', units: 12 },
            ],
            rows: [{ id: 'row-0', units: 24 }],
          },
          slots: [
            {
              id: 'slot:p0',
              rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
            },
            {
              id: 'slot:p1',
              rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
            },
          ],
        }),
      },
    })
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await user.click(screen.getByRole('button', { name: 'Save & apply' }))

    expect(onSave.mock.calls[0][0].tracks.columns).toEqual([
      { id: 'col-0', units: 12 },
      { id: 'col-1', units: 12 },
    ])
    expect(onSave.mock.calls[0][0].slots).toHaveLength(2)
  })

  test('surfaces an import error for layouts above the pane limit', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SaveSpy>()

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Code · JSON/YAML' }))
    const codeTextArea = screen.getAllByRole('textbox')[1]

    fireEvent.change(codeTextArea, {
      target: {
        value: JSON.stringify({
          tracks: {
            columns: [{ id: 'col-0', units: 24 }],
            rows: Array.from({ length: 17 }, (_, row) => ({
              id: `row-${row}`,
              units: row < 7 ? 2 : 1,
            })),
          },
          slots: Array.from({ length: 17 }, (_, row) => ({
            id: `slot:p${row}`,
            rect: { col: 0, row, colSpan: 1, rowSpan: 1 },
          })),
        }),
      },
    })

    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(
      await screen.findByText('Imported layout supports up to 16 panes')
    ).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  test('surfaces save errors when the code panel is closed', async () => {
    const user = userEvent.setup()

    const onSave = vi.fn<SaveSpy>(() => {
      throw new Error('Layout schema drifted')
    })

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    await user.type(screen.getByRole('textbox', { name: 'Layout name' }), 'Bad')
    await user.click(screen.getByRole('button', { name: 'Save & apply' }))

    expect(screen.getByText('Layout schema drifted')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Apply' })
    ).not.toBeInTheDocument()
  })

  test('successful code apply clears a stale save error', async () => {
    const user = userEvent.setup()

    const onSave = vi.fn<SaveSpy>(() => {
      throw new Error('Layout schema drifted')
    })

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    await user.type(screen.getByRole('textbox', { name: 'Layout name' }), 'Bad')
    await user.click(screen.getByRole('button', { name: 'Save & apply' }))
    expect(screen.getByText('Layout schema drifted')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Code · JSON/YAML' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.queryByText('Layout schema drifted')).not.toBeInTheDocument()
  })

  test('disables paint cells when pane count is already at the limit', async () => {
    const user = userEvent.setup()

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        onSave={vi.fn<SaveSpy>()}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Code · JSON/YAML' }))
    fireEvent.change(screen.getAllByRole('textbox')[1], {
      target: { value: JSON.stringify(fullFourByFourLayout) },
    })
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await user.click(screen.getByRole('button', { name: 'Add Cols' }))

    expect(
      screen.getByRole('button', { name: 'Add pane at column 5, row 1' })
    ).toBeDisabled()
  })

  test('seeds the grid from a starter template without touching the name', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SaveSpy>()

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    const nameInput = screen.getByRole('textbox', { name: 'Layout name' })
    expect(nameInput).toHaveValue('')

    await user.click(
      screen.getByRole('button', { name: 'Start from 2 × 3 grid' })
    )

    expect(nameInput).toHaveValue('')
    expect(
      screen.getAllByRole('button', { name: /^Remove pane p/ })
    ).toHaveLength(6)

    await user.type(nameInput, 'From template')
    await user.click(screen.getByRole('button', { name: 'Save & apply' }))

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0].title).toBe('From template')
    expect(onSave.mock.calls[0][0].slots).toHaveLength(6)
    // The template seed id is discarded; save mints a fresh custom id.
    expect(onSave.mock.calls[0][0].id).toMatch(/^custom:/)
    expect(onSave.mock.calls[0][0].id).not.toBe('custom:template-2x3')
  })

  test('seeds a spanning-slot template through the gallery', async () => {
    const user = userEvent.setup()

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        onSave={vi.fn<SaveSpy>()}
        onCancel={vi.fn()}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Start from Main + right stack' })
    )

    // Main + right stack is a 4-slot layout with one row-spanning main pane.
    expect(
      screen.getAllByRole('button', { name: /^Remove pane / })
    ).toHaveLength(4)
  })

  test('hides the template gallery when editing an existing layout', () => {
    const editLayout: PaneLayoutDefinition = {
      schemaVersion: 1,
      id: 'custom:existing',
      title: 'Existing',
      source: 'workspace',
      tracks: {
        columns: [{ id: 'col-0', units: 24 }],
        rows: [{ id: 'row-0', units: 24 }],
      },
      slots: [
        { id: 'slot:p0', rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
      ],
      addOrder: ['slot:p0'],
    }

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        editLayout={editLayout}
        onSave={vi.fn<SaveSpy>()}
        onCancel={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Start from 2 × 3 grid' })
    ).not.toBeInTheDocument()

    expect(screen.getByRole('textbox', { name: 'Layout name' })).toHaveValue(
      'Existing'
    )
  })

  test('adds an empty grid cell through keyboard activation', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<SaveSpy>()

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    await user.type(
      screen.getByRole('textbox', { name: 'Layout name' }),
      'Keyboard layout'
    )
    await user.click(screen.getByRole('button', { name: 'Add Cols' }))

    const emptyCell = screen.getByRole('button', {
      name: 'Add pane at column 2, row 1',
    })
    emptyCell.focus()
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save & apply' }))

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0].slots).toHaveLength(2)
    expect(onSave.mock.calls[0][0].slots[1]).toMatchObject({
      rect: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    })
  })

  test('exposes stable track count hooks for native overlay smoke', async () => {
    const user = userEvent.setup()

    render(
      <LayoutCreatorModal
        isOpen
        existingLayouts={[]}
        onSave={vi.fn<SaveSpy>()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByTestId('layout-creator-track-cols')).toHaveAttribute(
      'data-layout-creator-track-axis',
      'cols'
    )

    expect(
      screen.getByTestId('layout-creator-track-count-cols')
    ).toHaveTextContent('1')

    expect(
      screen.getByTestId('layout-creator-track-count-cols')
    ).toHaveAttribute('data-layout-creator-track-count', 'cols')

    expect(screen.getByTestId('layout-creator-track-rows')).toHaveAttribute(
      'data-layout-creator-track-axis',
      'rows'
    )

    expect(
      screen.getByTestId('layout-creator-track-count-rows')
    ).toHaveTextContent('1')

    expect(
      screen.getByTestId('layout-creator-track-count-rows')
    ).toHaveAttribute('data-layout-creator-track-count', 'rows')

    await user.click(screen.getByRole('button', { name: 'Add Cols' }))
    await user.click(screen.getByRole('button', { name: 'Add Rows' }))

    expect(
      screen.getByTestId('layout-creator-track-count-cols')
    ).toHaveTextContent('2')

    expect(
      screen.getByTestId('layout-creator-track-count-rows')
    ).toHaveTextContent('2')
  })
})
