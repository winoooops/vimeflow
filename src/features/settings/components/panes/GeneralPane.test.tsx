import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeneralPane } from './GeneralPane'

describe('GeneralPane', () => {
  test('renders the pane title', () => {
    render(<GeneralPane />)

    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('General Settings')).toBeInTheDocument()
  })

  test('renders all setting rows', () => {
    render(<GeneralPane />)

    expect(screen.getByText('When Closing With No Tabs')).toBeInTheDocument()
    expect(screen.getByText('On Last Window Closed')).toBeInTheDocument()
    expect(screen.getByText('Use System Path Prompts')).toBeInTheDocument()
    expect(screen.getByText('Use System Prompts')).toBeInTheDocument()
    expect(screen.getByText('Redact Private Values')).toBeInTheDocument()
    expect(screen.getByText('CLI Default Open Behavior')).toBeInTheDocument()
  })

  test('toggles Redact Private Values when its toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<GeneralPane />)

    const toggle = screen.getByRole('button', {
      name: 'Redact Private Values',
    })
    expect(toggle).toHaveClass('bg-outline-variant/50')

    await user.click(toggle)

    expect(toggle).toHaveClass('bg-primary-container')
  })

  test('changes the close-no-tabs select value', async () => {
    const user = userEvent.setup()
    render(<GeneralPane />)

    const select = screen.getByLabelText('When closing with no tabs')
    await user.selectOptions(select, 'nothing')

    expect(select).toHaveValue('nothing')
  })
})
