import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { CONFIG_CHIP_CLASSES, ConfigChipContent } from './ConfigChip'

describe('ConfigChipContent', () => {
  test('renders lead glyph, small-caps key, value and a caret', () => {
    render(
      <button type="button" className={CONFIG_CHIP_CLASSES}>
        <ConfigChipContent
          icon="palette"
          label="Theme"
          value="catppuccin-mocha"
        />
      </button>
    )

    // Accessible name is the visible key + value — the glyph + caret are
    // aria-hidden ligatures so the label lives INSIDE the control.
    const button = screen.getByRole('button', {
      name: /theme.*catppuccin-mocha/i,
    })
    expect(button).toBeInTheDocument()
    // The material-symbol ligatures render even though they're hidden from AT.
    expect(button.textContent).toContain('palette')
    expect(button.textContent).toContain('expand_more')
  })

  test('omits the small-caps key for a value-only chip (e.g. View)', () => {
    render(
      <button type="button" className={CONFIG_CHIP_CLASSES}>
        <ConfigChipContent icon="tune" value="View" />
      </button>
    )

    // No key prefix — the value itself names the control.
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument()
  })
})
