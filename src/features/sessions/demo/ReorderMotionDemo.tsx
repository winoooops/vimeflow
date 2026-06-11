import {
  useCallback,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { Session, SessionStatus } from '../types'
import { Card } from '../components/Card'
import { Group } from '../components/Group'
import { List } from '../components/List'

const DEMO_CWD = '/demo/vimeflow'

const DEMO_NAMES = [
  'session 1',
  'session 2',
  'session 3',
  'session 4',
  'session 5',
  'session 6',
]

const DEMO_STATUSES: SessionStatus[] = [
  'running',
  'awaiting',
  'running',
  'idle',
  'running',
  'awaiting',
]

const emptyActivity = (): Session['activity'] => ({
  fileChanges: [],
  toolCalls: [],
  testResults: [],
  contextWindow: {
    used: 12000,
    total: 200000,
    percentage: 6,
    emoji: '😊',
  },
  usage: {
    sessionDuration: 420,
    turnCount: 4,
    messages: { sent: 4, limit: 200 },
    tokens: { input: 6000, output: 6000, total: 12000 },
  },
})

const buildDemoSessions = (): Session[] =>
  DEMO_NAMES.map((name, index) => {
    const id = `demo-session-${index + 1}`
    const status = DEMO_STATUSES[index]

    return {
      id,
      projectId: 'demo-project',
      name,
      status,
      workingDirectory: DEMO_CWD,
      agentType: index % 2 === 0 ? 'claude-code' : 'codex',
      layout: index === 2 ? 'vsplit' : 'single',
      activityPanelCollapsed: false,
      panes: [
        {
          id: 'p0',
          ptyId: id,
          cwd: DEMO_CWD,
          agentType: index % 2 === 0 ? 'claude-code' : 'codex',
          status,
          active: true,
          pid: 20000 + index,
        },
      ],
      createdAt: '2026-06-10T06:00:00Z',
      lastActivityAt: `2026-06-10T06:0${index}:00Z`,
      activity: emptyActivity(),
    }
  })

const sessionIds = (sessions: Session[]): string =>
  sessions.map((session) => session.name.replace('session ', '')).join(' ')

interface DemoPanelProps {
  title: string
  children: ReactNode
  order: string
}

const DemoPanel = ({
  title,
  children,
  order,
}: DemoPanelProps): ReactElement => {
  const [activeTab, setActiveTab] = useState<'sessions' | 'other'>('sessions')

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-[10px] bg-surface-container-lowest/80 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <h2 className="font-label text-sm font-semibold text-on-surface">
          {title}
        </h2>
        <span className="font-mono text-[10px] text-on-surface-muted">
          {order}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('sessions')}
          className={`h-7 rounded-[7px] px-2.5 font-label text-[11px] font-semibold transition-colors ${
            activeTab === 'sessions'
              ? 'bg-primary-container/15 text-primary'
              : 'text-on-surface-muted hover:bg-wash-subtle'
          }`}
        >
          Sessions
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('other')}
          className={`h-7 rounded-[7px] px-2.5 font-label text-[11px] font-semibold transition-colors ${
            activeTab === 'other'
              ? 'bg-primary-container/15 text-primary'
              : 'text-on-surface-muted hover:bg-wash-subtle'
          }`}
        >
          Other
        </button>
      </div>
      <div
        className={`min-h-0 flex-1 px-2 pb-3 ${
          activeTab === 'sessions' ? 'block' : 'hidden'
        }`}
      >
        {children}
      </div>
      <div
        className={`min-h-0 flex-1 place-items-center px-2 pb-3 ${
          activeTab === 'other' ? 'grid' : 'hidden'
        }`}
      >
        <div className="rounded-[9px] bg-wash-faint px-4 py-3 text-center font-label text-xs text-on-surface-muted">
          Sessions stay mounted while this panel is visible.
        </div>
      </div>
    </section>
  )
}

interface NativeReorderListProps {
  sessions: Session[]
  activeSessionId: string
  onActiveSessionChange: (id: string) => void
  onReorder: (sessions: Session[]) => void
}

const NativeReorderList = ({
  sessions,
  activeSessionId,
  onActiveSessionChange,
  onReorder,
}: NativeReorderListProps): ReactElement => (
  <div className="flex h-full min-h-0 flex-col">
    <Group.Header label="Active" count={sessions.length} />
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-clip">
      <Group variant="active" sessions={sessions} onReorder={onReorder}>
        {sessions.map((session) => (
          <Card
            key={session.id}
            session={session}
            variant="active"
            isActive={session.id === activeSessionId}
            onClick={onActiveSessionChange}
          />
        ))}
      </Group>
    </div>
  </div>
)

interface GuardedNativeReorderListProps {
  sessions: Session[]
  activeSessionId: string
  onActiveSessionChange: (id: string) => void
  onReorder: (sessions: Session[]) => void
}

const GuardedNativeReorderList = ({
  sessions,
  activeSessionId,
  onActiveSessionChange,
  onReorder,
}: GuardedNativeReorderListProps): ReactElement => {
  const draggingRef = useRef(false)

  const handleDragStart = useCallback((): void => {
    draggingRef.current = true
  }, [])

  const handleDragEnd = useCallback((): void => {
    draggingRef.current = false
  }, [])

  const handleReorder = useCallback(
    (reordered: Session[]): void => {
      if (!draggingRef.current) {
        return
      }

      onReorder(reordered)
    },
    [onReorder]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Group.Header label="Active" count={sessions.length} />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-clip">
        <Group variant="active" sessions={sessions} onReorder={handleReorder}>
          {sessions.map((session) => (
            <Card
              key={session.id}
              session={session}
              variant="active"
              isActive={session.id === activeSessionId}
              onClick={onActiveSessionChange}
              onReorderDragStart={handleDragStart}
              onReorderDragEnd={handleDragEnd}
            />
          ))}
        </Group>
      </div>
    </div>
  )
}

/**
 * Dev-only side-by-side harness for comparing Framer's native reorder loop
 * against Vimeflow reorder variants.
 */
export const ReorderMotionDemo = (): ReactElement => {
  const [nativeSessions, setNativeSessions] = useState(buildDemoSessions)
  const [approvedSessions, setApprovedSessions] = useState(buildDemoSessions)
  const [guardedSessions, setGuardedSessions] = useState(buildDemoSessions)
  const [nativeActiveId, setNativeActiveId] = useState('demo-session-1')
  const [approvedActiveId, setApprovedActiveId] = useState('demo-session-1')
  const [guardedActiveId, setGuardedActiveId] = useState('demo-session-1')

  const reset = (): void => {
    setNativeSessions(buildDemoSessions())
    setApprovedSessions(buildDemoSessions())
    setGuardedSessions(buildDemoSessions())
    setNativeActiveId('demo-session-1')
    setApprovedActiveId('demo-session-1')
    setGuardedActiveId('demo-session-1')
  }

  return (
    <main className="flex h-screen flex-col bg-surface-container-lowest px-6 py-5 text-on-surface">
      <div className="flex shrink-0 items-center justify-between pb-4">
        <div>
          <h1 className="font-headline text-xl font-semibold text-on-surface">
            Session Reorder
          </h1>
          <p className="mt-1 font-label text-xs text-on-surface-muted">
            Drag session 3 between session 1 and 2.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-primary-container/15 px-3 font-label text-xs font-semibold text-primary transition-colors hover:bg-primary-container/25"
        >
          <span
            className="material-symbols-outlined text-[16px]"
            aria-hidden="true"
          >
            restart_alt
          </span>
          Reset
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
        <DemoPanel title="Native Framer" order={sessionIds(nativeSessions)}>
          <NativeReorderList
            sessions={nativeSessions}
            activeSessionId={nativeActiveId}
            onActiveSessionChange={setNativeActiveId}
            onReorder={setNativeSessions}
          />
        </DemoPanel>
        <DemoPanel title="Current List" order={sessionIds(approvedSessions)}>
          <List
            sessions={approvedSessions}
            activeSessionId={approvedActiveId}
            onSessionClick={setApprovedActiveId}
            onReorderSessions={setApprovedSessions}
          />
        </DemoPanel>
        <DemoPanel title="Native Guarded" order={sessionIds(guardedSessions)}>
          <GuardedNativeReorderList
            sessions={guardedSessions}
            activeSessionId={guardedActiveId}
            onActiveSessionChange={setGuardedActiveId}
            onReorder={setGuardedSessions}
          />
        </DemoPanel>
      </div>
    </main>
  )
}
