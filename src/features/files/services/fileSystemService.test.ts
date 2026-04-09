import { describe, test, expect } from 'vitest'
import { createFileSystemService } from './fileSystemService'

describe('fileSystemService', () => {
  // In test/browser env, createFileSystemService returns MockFileSystemService

  test('createFileSystemService returns a service with listDir', () => {
    const service = createFileSystemService()

    expect(service).toBeDefined()
    expect(typeof service.listDir).toBe('function')
  })

  test('mock service returns root tree for ~ path', async () => {
    const service = createFileSystemService()
    const nodes = await service.listDir('~')

    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes[0].name).toBe('src/')
  })

  test('mock service navigates into subfolders', async () => {
    const service = createFileSystemService()
    const nodes = await service.listDir('~/src')

    expect(nodes.length).toBeGreaterThan(0)
    // Should contain middleware/ and routes/ from mock data
    const names = nodes.map((n) => n.name)

    expect(names).toContain('middleware/')
  })

  test('mock service returns empty for nonexistent path', async () => {
    const service = createFileSystemService()
    const nodes = await service.listDir('~/nonexistent')

    expect(nodes).toEqual([])
  })

  test('mock service handles path with trailing slash', async () => {
    const service = createFileSystemService()
    const nodes = await service.listDir('~/src/')

    expect(nodes.length).toBeGreaterThan(0)
  })
})
