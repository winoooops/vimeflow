import type { Session } from '../types'
import { mockAgentActivity } from './mockActivity'

export const mockSessions: Session[] = [
  {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'auth middleware',
    status: 'running',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    terminalPid: 12345,
    createdAt: '2026-04-07T03:45:00Z',
    lastActivityAt: '2026-04-07T03:47:34Z',
    activity: mockAgentActivity[0],
  },
  {
    id: 'sess-2',
    projectId: 'proj-1',
    name: 'fix: login bug',
    status: 'paused',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    terminalPid: 12346,
    createdAt: '2026-04-07T03:30:00Z',
    lastActivityAt: '2026-04-07T03:32:15Z',
    activity: mockAgentActivity[1],
  },
  {
    id: 'sess-3',
    projectId: 'proj-1',
    name: 'refactor: api layer',
    status: 'completed',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    createdAt: '2026-04-07T02:00:00Z',
    lastActivityAt: '2026-04-07T02:45:00Z',
    activity: mockAgentActivity[2],
  },
  {
    id: 'sess-4',
    projectId: 'proj-2',
    name: 'update portfolio design',
    status: 'running',
    workingDirectory: '/home/user/projects/portfolio',
    agentType: 'claude-code',
    terminalPid: 12347,
    createdAt: '2026-04-06T18:20:00Z',
    lastActivityAt: '2026-04-06T18:35:12Z',
    activity: mockAgentActivity[3],
  },
  {
    id: 'sess-5',
    projectId: 'proj-3',
    name: 'add rate limiting',
    status: 'completed',
    workingDirectory: '/home/user/projects/api-gateway',
    agentType: 'claude-code',
    createdAt: '2026-04-05T12:10:00Z',
    lastActivityAt: '2026-04-05T13:00:00Z',
    activity: mockAgentActivity[4],
  },
]

export const getSessionById = (id: string): Session | undefined =>
  mockSessions.find((s) => s.id === id)

export const getActiveSession = (): Session => mockSessions[0]

export const getSessionsByProject = (projectId: string): Session[] =>
  mockSessions.filter((s) => s.projectId === projectId)
