import { describe, test, expect } from 'vitest'
import { mockProjects, getProjectById, getActiveProject } from './mockProjects'

describe('mockProjects', () => {
  test('contains at least one project', () => {
    expect(mockProjects.length).toBeGreaterThan(0)
  })

  test('all projects have required fields', () => {
    mockProjects.forEach((project) => {
      expect(project.id).toBeTruthy()
      expect(project.name).toBeTruthy()
      expect(project.abbreviation).toHaveLength(2)
      expect(project.path).toBeTruthy()
      expect(project.sessions).toBeDefined()
      expect(project.createdAt).toBeTruthy()
      expect(project.lastAccessedAt).toBeTruthy()
    })
  })

  test('getProjectById returns correct project', () => {
    const project = getProjectById('proj-1')

    expect(project).toBeDefined()
    expect(project?.id).toBe('proj-1')
    expect(project?.name).toBe('Vimeflow')
  })

  test('getProjectById returns undefined for non-existent id', () => {
    const project = getProjectById('non-existent')

    expect(project).toBeUndefined()
  })

  test('getActiveProject returns first project', () => {
    const active = getActiveProject()

    expect(active).toBeDefined()
    expect(active.id).toBe(mockProjects[0].id)
  })

  test('project sessions match their projectId', () => {
    mockProjects.forEach((project) => {
      project.sessions.forEach((session) => {
        expect(session.projectId).toBe(project.id)
      })
    })
  })
})
