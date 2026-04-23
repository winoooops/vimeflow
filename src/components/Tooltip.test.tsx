import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  test('returns children unchanged when disabled', () => {
    render(
      <Tooltip content="hello" disabled>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('returns children unchanged when content is null', () => {
    render(
      <Tooltip content={null}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('opens on hover after delayMs and renders content', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="full body text" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'full body text'
    )
  })

  test('closes on mouse leave', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    const btn = screen.getByRole('button', { name: 'trigger' })
    await user.hover(btn)
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
    await user.unhover(btn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('opens on focus', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.tab()
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
  })

  test('closes on Escape', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    await user.hover(screen.getByRole('button', { name: 'trigger' }))
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('exposes content as accessible description on the trigger', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="hello" delayMs={0}>
        <button type="button">trigger</button>
      </Tooltip>
    )

    const btn = screen.getByRole('button', { name: 'trigger' })
    await user.hover(btn)
    // Wait for tooltip to open so the accessible description becomes available
    await screen.findByRole('tooltip')
    expect(btn).toHaveAccessibleDescription('hello')
  })
})
