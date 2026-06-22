import type { ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import type { QuotaNotice } from '@/agents/registry'

/**
 * Fills the agent status card's quota slot for an agent that exposes no
 * readable usage/quota API (currently opencode — see sst/opencode#16017).
 *
 * Mirrors the shape of kimi's consent-gated `SlotOff` — a caption plus a single
 * full-width affordance inside the fixed `CARD_BODY_H` slot — but the affordance
 * is an external "track the request" link to the upstream feature request
 * instead of a poll button, because there is nothing to poll yet. When opencode
 * ships a usage API, this is replaced by real 5-hour / weekly bars.
 *
 * Styling matches the shell quick-reference link in `AgentStatusCard` (semantic
 * tokens only, per `vimeflow/no-hardcoded-colors`; `Tooltip` rather than a
 * native `title`).
 */
export const QuotaUnavailableNotice = ({
  message,
  trackUrl,
}: QuotaNotice): ReactElement => (
  <div className="flex flex-col gap-[7px]">
    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-on-surface-muted">
      {message}
    </span>
    <Tooltip content="OpenCode usage API — open the feature request (sst/opencode#16017)">
      <a
        href={trackUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center gap-[7px] rounded-[7px] bg-surface-container-lowest/45 py-[5px] pr-[7px] pl-[9px] font-mono text-[10.5px] leading-none text-on-surface-muted no-underline transition-colors hover:bg-primary/10 hover:text-primary"
      >
        <span
          className="material-symbols-outlined text-[15px]"
          aria-hidden="true"
        >
          monitoring
        </span>
        <span>Track the request</span>
        <span className="flex-1" />
        <span
          className="material-symbols-outlined text-[13px] opacity-[0.55]"
          aria-hidden="true"
        >
          open_in_new
        </span>
      </a>
    </Tooltip>
  </div>
)
