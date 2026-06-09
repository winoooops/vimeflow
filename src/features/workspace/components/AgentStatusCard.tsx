// cspell:ignore cheatsheet incard powershell pwsh tcsh xonsh zsh
import type { ReactElement } from 'react'
import { RateLimitBar } from '../../agent-status/components/RateLimitBar'

// Fused agent-status card (VIM-66 — AGENT-STATUS-CARD-HANDOFF + SHELL-CARD-KIT).
// ONE fixed card height in every state: switching the active pane between an
// agent and a pure shell never reflows the session list below it. Agent panes
// keep only the turn count in the header and fill the body with usage bars; a
// shell pane omits the header entirely and uses the same card height for its
// two-zone empty state.

export type AgentCardState =
  | 'running'
  | 'awaiting'
  | 'completed'
  | 'errored'
  | 'idle'

export interface AgentStatusCardProps {
  /** Agent model name shown as the title; ignored when `isShell`. */
  title: string
  /** Retained for API stability; visual wash was removed from the compact card. */
  state: AgentCardState
  /** True when the active pane is a pure shell (no agent / model / usage). */
  isShell?: boolean
  /** Retained for API stability; compact card shows turn count only. */
  elapsed?: string | null
  /** Turn count rendered in the compact header pill; absent values render as 0. */
  turns?: number | null
  /** Context-window usage percent; omitted when null. */
  contextPct?: number | null
  /** 5-hour (session) rate-limit usage percent; omitted when null. */
  fiveHourPct?: number | null
  /** 7-day (weekly) rate-limit usage percent; omitted when null. */
  weekPct?: number | null
  /** Resolved shell path/name for pure shell panes, e.g. `/bin/zsh`. */
  shellName?: string | null
}

// 125 = 12 (top pad) + 24 (header: h-6 pill / leading-6 title) + 9 (gap)
// + 66 (CARD_BODY_H) + 14 (bottom pad). Still ONE fixed height across agent
// and shell states, so switching panes never reflows the session list.
const CARD_H = 125
const CARD_BODY_H = 66

const KNOWN_SHELLS = new Set([
  'bash',
  'zsh',
  'fish',
  'sh',
  'dash',
  'ksh',
  'csh',
  'tcsh',
  'nu',
  'xonsh',
  'powershell',
  'pwsh',
  'cmd',
])

const normalizeShellName = (shellName: string | null | undefined): string => {
  if (!shellName) {
    return 'shell'
  }

  const parts = shellName.replace(/\\/gu, '/').split('/')
  const basename = parts[parts.length - 1]?.trim().toLowerCase() ?? ''
  const stripped = basename.replace(/^-+/, '').replace(/\.exe$/, '')

  if (!stripped) {
    return 'shell'
  }

  if (stripped === 'powershell') {
    return 'powershell'
  }

  if (KNOWN_SHELLS.has(stripped)) {
    return stripped
  }

  return stripped
}

const shellCheatsheetUrl = (shellName: string): string =>
  `https://www.google.com/search?q=${encodeURIComponent(
    `${shellName} commands cheatsheet`
  )}`

const TurnPill = ({ turns }: { turns: number | null }): ReactElement => (
  <span
    className="inline-flex h-6 max-w-[86px] shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-outline-variant/40 bg-surface-container-lowest/35 px-[7px] font-mono text-[10px] font-bold leading-none text-on-surface-variant"
    title={`${turns ?? 0} turns`}
  >
    {/* Both the Material icon and the descender-less mono label ride ~1px high
        in their own line-boxes. Wrap them in one flex row so items-center keeps
        them aligned to each other, then nudge the whole row down ~1px to center
        the pair in the pill. Relative offset → no layout/height change. */}
    <span className="relative top-px inline-flex items-center gap-[5px]">
      <span
        className="material-symbols-outlined text-syn-comment"
        aria-hidden="true"
        style={{ fontSize: 12, lineHeight: 1 }}
      >
        forum
      </span>
      <span>{turns ?? 0} turns</span>
    </span>
  </span>
)

const ShellBody = ({ shellName }: { shellName: string }): ReactElement => (
  <div
    data-testid="agent-status-card-shell-body"
    className="flex h-full flex-col justify-between rounded-[9px] border border-dashed border-outline-variant/50 bg-surface-container-lowest/30 py-2 pr-2 pl-[11px]"
  >
    <div className="flex min-w-0 items-center gap-2.5">
      <div
        className="grid shrink-0 place-items-center rounded-lg bg-syn-comment/14"
        style={{ width: 30, height: 30 }}
      >
        <span
          className="material-symbols-outlined text-[17px] text-[#9b93ab]"
          aria-hidden="true"
        >
          terminal
        </span>
      </div>
      <div className="min-w-0">
        <div className="truncate font-display text-[12.5px] font-semibold text-on-surface-variant">
          No active agent
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full border-[1.5px] border-solid border-outline-variant" />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-on-surface-muted">
            Idle · {shellName} shell
          </span>
        </div>
      </div>
    </div>

    <a
      href={shellCheatsheetUrl(shellName)}
      target="_blank"
      rel="noopener noreferrer"
      title={`${shellName} command cheatsheet`}
      className="flex w-full items-center gap-[7px] rounded-[7px] bg-surface-container-lowest/45 py-[5px] pr-[7px] pl-[9px] font-mono text-[10.5px] leading-none text-[#9b93ab] no-underline transition-colors hover:bg-primary/10 hover:text-primary"
    >
      <span
        className="material-symbols-outlined text-[15px]"
        aria-hidden="true"
      >
        menu_book
      </span>
      <span>{shellName} cheatsheet</span>
      <span className="flex-1" />
      <span
        className="material-symbols-outlined text-[13px] opacity-[0.55]"
        aria-hidden="true"
      >
        open_in_new
      </span>
    </a>
  </div>
)

export const AgentStatusCard = ({
  title,
  state,
  isShell = false,
  elapsed = null,
  turns = null,
  contextPct = null,
  fiveHourPct = null,
  weekPct = null,
  shellName = null,
}: AgentStatusCardProps): ReactElement => {
  const hasUsage = fiveHourPct !== null || weekPct !== null
  const resolvedShellName = normalizeShellName(shellName)
  void state
  void elapsed
  void contextPct

  return (
    <div
      data-testid="sidebar-agent-status-card"
      style={{
        position: 'relative',
        borderRadius: 13,
        height: CARD_H,
        padding: '12px 14px 14px',
        background: 'rgba(33,33,51,0.55)',
        boxShadow:
          '0 5px 20px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.045)',
        overflow: 'hidden',
        // The card is chrome, not editable text — show the default arrow rather
        // than the text I-beam over the title/labels. `cursor` inherits, so this
        // covers all the card's text; the toggle re-asserts `cursor-pointer`.
        cursor: 'default',
      }}
    >
      {isShell ? (
        <ShellBody shellName={resolvedShellName} />
      ) : (
        <>
          <div className="flex min-h-6 items-center gap-2.5">
            <div className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold leading-6 text-on-surface">
              {title}
            </div>
            <TurnPill turns={turns} />
          </div>
          <div
            className="mt-[9px] flex flex-col justify-center"
            style={{ height: CARD_BODY_H }}
          >
            {hasUsage && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 9,
                }}
              >
                {fiveHourPct !== null && (
                  <RateLimitBar
                    label="5-hour Session"
                    percentage={fiveHourPct}
                  />
                )}
                {weekPct !== null && (
                  <RateLimitBar label="Weekly Usage" percentage={weekPct} />
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
