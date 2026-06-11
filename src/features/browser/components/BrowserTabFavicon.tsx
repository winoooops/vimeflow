import { useEffect, useState, type ReactElement } from 'react'
import { faviconPlaceholder, type FaviconTone } from '../faviconPlaceholder'

const TONE_CLASS: Record<FaviconTone, string> = {
  cyan: 'text-[var(--color-agent-browser-accent)] bg-[color-mix(in_srgb,var(--color-agent-browser-accent)_12%,transparent)]',
  mauve:
    'text-primary-container bg-[color-mix(in_srgb,var(--color-primary-container)_12%,transparent)]',
  coral:
    'text-tertiary bg-[color-mix(in_srgb,var(--color-tertiary)_12%,transparent)]',
}

export interface BrowserTabFaviconProps {
  favicon: string | null
  url: string
}

export const BrowserTabFavicon = ({
  favicon,
  url,
}: BrowserTabFaviconProps): ReactElement => {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [favicon])

  if (favicon && !failed) {
    return (
      <img
        src={favicon}
        alt=""
        data-testid="browser-tab-favicon"
        decoding="async"
        onError={(): void => setFailed(true)}
        className="h-4 w-4 shrink-0 rounded-[5px] object-contain"
      />
    )
  }

  const { glyph, tone } = faviconPlaceholder(url)

  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] ${TONE_CLASS[tone]}`}
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[10px]"
      >
        {glyph}
      </span>
    </span>
  )
}
