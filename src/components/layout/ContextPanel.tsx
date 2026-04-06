import type { ReactElement } from 'react'
import {
  mockAgentStatus,
  mockRecentActions,
} from '../../features/chat/data/mockMessages'

interface ContextPanelProps {
  isOpen?: boolean
  onToggle?: () => void
}

/**
 * ContextPanel - Right sidebar (280px) showing agent status, model info,
 * navigation, live insights, and collapse controls.
 *
 * Design reference: Feature 23 - Redesigned layout per app_spec.md
 */
const ContextPanel = ({
  isOpen = true,
  onToggle = (): void => {
    // Default no-op handler
  },
}: ContextPanelProps): ReactElement => {
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
    <>
      {/* Floating reopen button - only visible when panel is collapsed */}
      <button
        onClick={onToggle}
        aria-label="Open context panel"
        className={`fixed right-4 top-1/2 -translate-y-1/2 z-30 p-2 bg-surface-container hover:bg-surface-container-high rounded-lg border border-outline-variant/10 transition-all duration-300 ${
          isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        type="button"
      >
        <span className="material-symbols-outlined text-on-surface-variant text-lg">
          dock_to_left
        </span>
      </button>

      <aside
        role="complementary"
        aria-label="Agent status panel"
        className={`w-[280px] h-screen fixed right-0 top-0 bg-[#1a1a2a] border-l border-[#4a444f]/15 z-40 flex flex-col overflow-hidden transition-all duration-300 ${
          isOpen ? '' : 'translate-x-full'
        }`}
        data-testid="context-panel"
      >
        {/* Header with psychology icon and toggle button */}
        <div className="h-14 flex items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span
              className="material-symbols-outlined text-primary-container text-sm"
              aria-hidden="true"
            >
              psychology
            </span>
            <h2 className="font-headline text-xs font-bold tracking-widest text-on-surface-variant uppercase">
              Agent Status
            </h2>
          </div>
          <button
            onClick={onToggle}
            aria-label="Dock to right"
            className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors cursor-pointer text-lg"
          >
            dock_to_right
          </button>
        </div>

        {/* Token Usage Section */}
        <div className="px-6 py-4 space-y-2">
          <div className="flex justify-between text-[10px] font-label text-on-surface-variant">
            <span>Token Usage</span>
            <span>{mockAgentStatus.progress}%</span>
          </div>
          <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-secondary to-secondary-container rounded-full"
              style={{ width: `${mockAgentStatus.progress}%` }}
            />
          </div>
        </div>

        {/* Navigation Items */}
        <div className="px-4 space-y-1">
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/10 text-on-surface text-xs font-medium hover:bg-primary/15 transition-colors">
            <span
              className="material-symbols-outlined text-sm"
              aria-hidden="true"
            >
              info
            </span>
            Model Info
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-on-surface-variant text-xs font-medium hover:bg-surface-variant/30 transition-colors">
            <span
              className="material-symbols-outlined text-sm"
              aria-hidden="true"
            >
              list
            </span>
            Context
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-on-surface-variant text-xs font-medium hover:bg-surface-variant/30 transition-colors">
            <span
              className="material-symbols-outlined text-sm"
              aria-hidden="true"
            >
              activity_zone
            </span>
            Activity
          </button>
        </div>

        {/* Scrollable content */}
        <div className="p-6 space-y-6 overflow-y-auto no-scrollbar flex-1">
          {/* Model Info Card (moved content from above) */}
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

            {/* Stats grid: Latency and Tokens */}
            <dl
              aria-label="Model statistics"
              className="m-0 grid grid-cols-2 gap-2"
            >
              <div className="bg-surface-container-low p-2 rounded-lg text-center">
                <dt className="text-[9px] text-on-surface-variant mb-1">
                  Latency
                </dt>
                <dd className="m-0 text-[11px] font-label text-primary-container">
                  {mockAgentStatus.latency}
                </dd>
              </div>
              <div className="bg-surface-container-low p-2 rounded-lg text-center">
                <dt className="text-[9px] text-on-surface-variant mb-1">
                  Tokens
                </dt>
                <dd className="m-0 text-[11px] font-label text-primary-container">
                  {mockAgentStatus.tokens}
                </dd>
              </div>
            </dl>
          </div>

          {/* Live Insights Card */}
          <div className="bg-primary-container/5 p-4 rounded-xl border border-primary-container/10 space-y-3">
            <h3 className="text-[10px] font-bold text-primary-container uppercase tracking-wide flex items-center gap-2">
              <span
                className="material-symbols-outlined text-sm"
                aria-hidden="true"
              >
                lightbulb
              </span>
              Live Insights
            </h3>
            <p className="text-[11px] leading-relaxed text-on-surface-variant">
              Type mismatch detected in user authentication module. Consider
              using stricter TypeScript types.
            </p>
            <button className="w-full bg-primary/10 hover:bg-primary/15 text-primary text-[10px] font-bold uppercase tracking-wide py-2 px-4 rounded-lg transition-colors">
              Apply Fix
            </button>
          </div>

          {/* Recent Actions */}
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold tracking-widest text-on-surface-variant uppercase flex items-center gap-2">
              <span
                className="material-symbols-outlined text-xs"
                aria-hidden="true"
              >
                history
              </span>
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
        </div>

        {/* Collapse Panel Footer */}
        <div className="mt-auto p-4 bg-surface-container-lowest/50 border-t border-outline-variant/10">
          <button
            onClick={onToggle}
            className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant hover:text-primary transition-colors"
          >
            <span
              className="material-symbols-outlined text-sm"
              aria-hidden="true"
            >
              chevron_right
            </span>
            Collapse Panel
          </button>
        </div>
      </aside>
    </>
  )
}

export default ContextPanel
