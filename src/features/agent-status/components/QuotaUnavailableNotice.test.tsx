import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { QuotaUnavailableNotice } from './QuotaUnavailableNotice'

describe('QuotaUnavailableNotice', () => {
  test('renders the message and a track-the-request link to the feature request', () => {
    render(
      <QuotaUnavailableNotice
        message="Usage limits not exposed by OpenCode yet"
        trackUrl="https://github.com/sst/opencode/issues/16017"
        tooltipLabel="OpenCode usage API — open the feature request (sst/opencode#16017)"
      />
    )

    expect(
      screen.getByText('Usage limits not exposed by OpenCode yet')
    ).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /track the request/i })
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/sst/opencode/issues/16017'
    )
  })

  test('opens the link safely in a new tab', () => {
    render(
      <QuotaUnavailableNotice
        message="m"
        trackUrl="https://example.test/fr"
        tooltipLabel="Open the feature request"
      />
    )

    const link = screen.getByRole('link', { name: /track the request/i })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
