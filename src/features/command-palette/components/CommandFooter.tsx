import type { ReactElement } from 'react'
import { KeyCap } from './KeyCap'

export const CommandFooter = (): ReactElement => (
  <div className="flex items-center gap-[14px] px-[14px] py-[8px] bg-surface-container-lowest/50 font-mono text-[10px] text-on-surface-muted">
    {/* Run hint */}
    <span className="flex items-center gap-[6px]">
      <KeyCap size="md">↵</KeyCap> run
    </span>

    {/* Navigate hint */}
    <span className="flex items-center gap-[6px]">
      <span className="flex gap-[3px]">
        <KeyCap size="md">↑</KeyCap>
        <KeyCap size="md">↓</KeyCap>
      </span>
      navigate
    </span>
  </div>
)
