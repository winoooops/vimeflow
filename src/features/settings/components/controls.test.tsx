import { useState, type ReactElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  GhostButton,
  PaneTitle,
  Row,
  Select,
  TextInput,
  Toggle,
} from './controls'

const StatefulTextInput = (): ReactElement => {
  const [value, setValue] = useState('hello')

  return <TextInput value={value} onChange={setValue} aria-label="Input" />
}

describe('Row', () => {
  test('renders label and hint', () => {
    render(<Row label="Density" hint="Compact or comfortable" />)

    expect(screen.getByText('Density')).toBeInTheDocument()
    expect(screen.getByText('Compact or comfortable')).toBeInTheDocument()
  })

  test('renders children on the right', () => {
    render(
      <Row label="Toggle">
        <span data-testid="row-child">on</span>
      </Row>
    )

    expect(screen.getByTestId('row-child')).toBeInTheDocument()
  })

  test('omits bottom border when last is true', () => {
    render(<Row label="Last row" last />)

    expect(screen.getByTestId('row')).not.toHaveClass('border-b')
  })
})

describe('PaneTitle', () => {
  test('renders title and optional sub eyebrow', () => {
    render(<PaneTitle title="General" sub="General Settings" />)

    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('General Settings')).toBeInTheDocument()
  })
})

describe('Toggle', () => {
  test('calls onChange with true when currently off', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Toggle onChange={onChange} aria-label="Enable" />)

    await user.click(screen.getByRole('switch', { name: 'Enable' }))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  test('calls onChange with false when currently on', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Toggle on onChange={onChange} aria-label="Enable" />)

    await user.click(screen.getByRole('switch', { name: 'Enable' }))

    expect(onChange).toHaveBeenCalledWith(false)
  })

  test('exposes toggle state as aria-checked', () => {
    const { rerender } = render(
      <Toggle onChange={() => undefined} aria-label="Enable" />
    )

    expect(screen.getByRole('switch', { name: 'Enable' })).toHaveAttribute(
      'aria-checked',
      'false'
    )

    rerender(<Toggle on onChange={() => undefined} aria-label="Enable" />)

    expect(screen.getByRole('switch', { name: 'Enable' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })
})

describe('Select', () => {
  test('renders the current value and options', () => {
    render(
      <Select
        value="b"
        onChange={() => undefined}
        aria-label="Pick"
        options={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
      />
    )

    expect(screen.getByLabelText('Pick')).toHaveValue('b')
  })

  test('forwards changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Select
        value="a"
        onChange={onChange}
        aria-label="Pick"
        options={['a', 'b']}
      />
    )

    await user.selectOptions(screen.getByLabelText('Pick'), 'b')

    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('GhostButton', () => {
  test('renders children and fires onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<GhostButton onClick={onClick}>Export</GhostButton>)

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('TextInput', () => {
  test('renders the value and forwards changes', async () => {
    const user = userEvent.setup()
    render(<StatefulTextInput />)

    const input = screen.getByLabelText('Input')
    expect(input).toHaveValue('hello')

    await user.clear(input)
    await user.type(input, 'world')

    expect(input).toHaveValue('world')
  })
})
