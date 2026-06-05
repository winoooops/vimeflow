import { useEffect, useState, type ReactElement } from 'react'
import { faviconPlaceholder, type FaviconTone } from '../faviconPlaceholder'

const TONE_CLASS: Record<FaviconTone, string> = {
  cyan: 'text-[#4fc8d6] bg-[rgba(79,200,214,0.12)]',
  mauve: 'text-[#cba6f7] bg-[rgba(203,166,247,0.12)]',
  coral: 'text-[#ff94a5] bg-[rgba(255,148,165,0.12)]',
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
