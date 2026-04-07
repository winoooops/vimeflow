import type { Project } from '../types'
import { mockSessions } from './mockSessions'

export const mockProjects: Project[] = [
  {
    id: 'proj-1',
    name: 'Vimeflow',
    abbreviation: 'Vf',
    path: '/home/user/projects/Vimeflow',
    color: '#e2c7ff', // primary color
    sessions: mockSessions.filter((s) => s.projectId === 'proj-1'),
    createdAt: '2026-04-01T10:00:00Z',
    lastAccessedAt: '2026-04-07T03:45:00Z',
  },
  {
    id: 'proj-2',
    name: 'My Portfolio',
    abbreviation: 'My',
    path: '/home/user/projects/portfolio',
    color: '#7defa1', // success color
    sessions: mockSessions.filter((s) => s.projectId === 'proj-2'),
    createdAt: '2026-03-15T14:30:00Z',
    lastAccessedAt: '2026-04-06T18:20:00Z',
  },
  {
    id: 'proj-3',
    name: 'API Gateway',
    abbreviation: 'Ag',
    path: '/home/user/projects/api-gateway',
    sessions: mockSessions.filter((s) => s.projectId === 'proj-3'),
    createdAt: '2026-02-20T09:15:00Z',
    lastAccessedAt: '2026-04-05T12:10:00Z',
  },
]

export const getProjectById = (id: string): Project | undefined =>
  mockProjects.find((p) => p.id === id)

export const getActiveProject = (): Project => mockProjects[0]
