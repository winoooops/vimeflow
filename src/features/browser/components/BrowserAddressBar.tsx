import {
  useEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { isMacPlatform } from '../../../lib/formatShortcut'
import { BROWSER_IDENTITY } from '../browserIdentity'

export interface BrowserAddressBarProps {
  committedUrl: string
  draft: string
  isEditing: boolean
  onBeginEdit: () => void
  onDraftChange: (value: string) => void
  onSubmit: (url: string) => void
  onCancel: () => void
}

interface UrlSegments {
  scheme: string
  host: string
  path: string
}

const splitUrl = (url: string): UrlSegments | null => {
  try {
    const parsed = new URL(url)

    return {
      scheme: `${parsed.protocol}//`,
      host: parsed.host,
      path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
    }
  } catch {
    return null
  }
}

const shortcutHint = (): string => (isMacPlatform() ? '⌘L' : 'Ctrl+L')

const PILL_CLASS =
  'mx-auto flex h-[29px] w-[min(520px,100%)] min-w-0 items-center gap-[9px] rounded-full bg-[rgba(13,13,28,0.6)] px-3'

export const BrowserAddressBar = ({
  committedUrl,
  draft,
  isEditing,
  onBeginEdit,
  onDraftChange,
  onSubmit,
  onCancel,
}: BrowserAddressBarProps): ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isEditing) {
      return
    }

    const node = inputRef.current
    node?.focus()
    node?.select()
  }, [isEditing])

  const pillStyle = {
    border: `1px solid ${BROWSER_IDENTITY.accentSoft}`,
    boxShadow: `0 0 0 3px ${BROWSER_IDENTITY.accentDim}`,
  }

  if (isEditing) {
    const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      onSubmit(draft)
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }

    return (
      <form onSubmit={handleSubmit} className={PILL_CLASS} style={pillStyle}>
        <input
          ref={inputRef}
          aria-label="browser address"
          value={draft}
          onChange={(event): void => onDraftChange(event.currentTarget.value)}
          onBlur={onCancel}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent text-center font-mono text-[11.5px] text-on-surface outline-none"
        />
      </form>
    )
  }

  const segments = splitUrl(committedUrl)
  const isHttps = committedUrl.startsWith('https://')

  return (
    <button
      type="button"
      onClick={onBeginEdit}
      aria-label={`address bar — ${committedUrl}; press Enter or ${shortcutHint()} to edit`}
      className={PILL_CLASS}
      style={pillStyle}
    >
      <span
        aria-hidden="true"
        className={`material-symbols-outlined shrink-0 text-[12px] ${
          isHttps ? 'text-success-muted' : 'text-syn-comment'
        }`}
      >
        {isHttps ? 'lock' : 'lock_open'}
      </span>
      <span className="min-w-0 flex-1 truncate text-center font-mono text-[11.5px]">
        {segments ? (
          <>
            <span className="text-syn-comment">{segments.scheme}</span>
            <span className="text-on-surface">{segments.host}</span>
            <span className="text-on-surface-muted">{segments.path}</span>
          </>
        ) : (
          <span className="text-on-surface">{committedUrl}</span>
        )}
      </span>
      <span className="shrink-0 rounded-[5px] border border-outline-variant/20 bg-white/[0.03] px-[5px] py-[2px] font-mono text-[9px] text-syn-comment">
        {shortcutHint()}
      </span>
    </button>
  )
}
