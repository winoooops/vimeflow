import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
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

describe('LayoutCreatorModal', () => {
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
})
