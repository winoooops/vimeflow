import type { ReactElement } from 'react'
import {
  mockAgentStatus,
  mockRecentActions,
} from '../../features/chat/data/mockMessages'

/**
 * ContextPanel - Right sidebar (280px) showing agent status, model info,
 * recent actions timeline, AI strategy, and system health.
 *
 * Design reference: docs/design/chat_or_main/code.html lines 293-376
 */
const ContextPanel = (): ReactElement => {
  const getStatusDotColor = (
    status: 'success' | 'pending' | 'error'
  ): string => {
    switch (status) {
      case 'pending':
        return 'bg-primary-container shadow-[0_0_8px_rgba(203,166,247,0.5)]'
      case 'success':
        return 'bg-secondary'
      case 'error':
        return 'bg-error'
      default:
        return 'bg-outline-variant'
    }
  }

  return (
    <aside
      role="complementary"
      aria-label="Agent status panel"
      className="w-[280px] h-screen fixed right-0 top-0 bg-[#1a1a2a] border-l border-[#4a444f]/15 z-40 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="h-14 flex items-center px-6">
        <h2 className="font-headline text-xs font-bold tracking-widest text-on-surface-variant uppercase">
          Agent Status
        </h2>
      </div>

      {/* Scrollable content */}
      <div className="p-6 space-y-8 overflow-y-auto no-scrollbar">
        {/* Model Info Card */}
        <div className="bg-surface-container p-4 rounded-xl space-y-4 border border-outline-variant/5">
          {/* Model name with badge */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-on-surface-variant">
              Model
            </span>
            <span className="bg-secondary/10 text-secondary text-[10px] font-bold px-2 py-0.5 rounded">
              {mockAgentStatus.modelName}
            </span>
          </div>

          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-label text-on-surface-variant">
              <span>Context Usage</span>
              <span>{mockAgentStatus.progress}%</span>
            </div>
            <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-secondary to-secondary-container rounded-full"
                style={{ width: `${mockAgentStatus.progress}%` }}
              />
            </div>
          </div>

          {/* Stats grid: Latency and Tokens */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-surface-container-low p-2 rounded-lg text-center">
              <p className="text-[9px] text-on-surface-variant mb-1">Latency</p>
              <p className="text-[11px] font-label text-primary-container">
                {mockAgentStatus.latency}
              </p>
            </div>
            <div className="bg-surface-container-low p-2 rounded-lg text-center">
              <p className="text-[9px] text-on-surface-variant mb-1">Tokens</p>
              <p className="text-[11px] font-label text-primary-container">
                {mockAgentStatus.tokens}
              </p>
            </div>
          </div>
        </div>

        {/* Recent Actions */}
        <div className="space-y-4">
          <h3 className="text-[10px] font-bold tracking-widest text-on-surface-variant uppercase flex items-center gap-2">
            <span className="material-symbols-outlined text-xs">history</span>
            Recent Actions
          </h3>
          <div className="space-y-4">
            {mockRecentActions.map((action, index) => (
              <div
                key={action.id}
                className={`flex gap-3 items-start group ${
                  index === mockRecentActions.length - 1
                    ? 'opacity-60 hover:opacity-100 transition-opacity'
                    : ''
                }`}
              >
                <div
                  className={`mt-1 w-2 h-2 rounded-full shrink-0 ${getStatusDotColor(action.status)}`}
                />
                <div className="space-y-1">
                  <p
                    className={`text-xs font-medium ${
                      action.status === 'pending'
                        ? 'text-on-surface group-hover:text-primary'
                        : action.status === 'success'
                          ? 'text-on-surface group-hover:text-secondary'
                          : 'text-on-surface'
                    } transition-colors cursor-pointer`}
                  >
                    {action.action}
                  </p>
                  <p className="text-[10px] font-label text-on-surface-variant">
                    {new Date(action.timestamp).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI Strategy Card */}
        <div className="bg-primary-container/5 p-4 rounded-xl border border-primary-container/10">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-primary-container text-sm">
              psychology_alt
            </span>
            <span className="text-[10px] font-bold text-primary-container uppercase tracking-wide">
              AI Strategy
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-on-surface-variant">
            Current priority:{' '}
            <span className="text-[#e3e0f7] font-medium">Code Quality</span>.
            The agent is prioritizing test coverage and type safety in the
            implementation.
          </p>
        </div>
      </div>

      {/* System Health Footer */}
      <div className="mt-auto p-4 bg-surface-container-lowest/50 border-t border-outline-variant/10">
        <div className="flex items-center justify-between text-[10px] font-label">
          <div className="flex items-center gap-1.5 text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
            <span>System Online</span>
          </div>
          <span className="text-on-surface-variant/40">v0.1.0-alpha</span>
        </div>
      </div>
    </aside>
  )
}

export default ContextPanel
