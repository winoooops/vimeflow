import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { QuotaUnavailableNotice } from './QuotaUnavailableNotice'

describe('QuotaUnavailableNotice', () => {
  test('renders the message and a track-the-request link to the feature request', () => {
    render(
      <QuotaUnavailableNotice
        message="Usage limits not exposed by opencode yet"
        trackUrl="https://github.com/sst/opencode/issues/16017"
      />
    )

    expect(
      screen.getByText('Usage limits not exposed by opencode yet')
    ).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /track the request/i })
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/sst/opencode/issues/16017'
    )
  })

  test('opens the link safely in a new tab', () => {
    render(
      <QuotaUnavailableNotice message="m" trackUrl="https://example.test/fr" />
    )

    const link = screen.getByRole('link', { name: /track the request/i })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
