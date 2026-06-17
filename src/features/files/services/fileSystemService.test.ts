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

  test('service has readFile method', () => {
    const service = createFileSystemService()

    expect(service).toBeDefined()
    expect(typeof service.readFile).toBe('function')
  })

  test('mock service readFile returns mock content', async () => {
    const service = createFileSystemService()
    const content = await service.readFile('~/src/App.tsx')

    expect(typeof content).toBe('string')
    expect(content).toContain('Mock')
  })

  test('mock service fileExists returns true for existing files', async () => {
    const service = createFileSystemService()

    expect(await service.fileExists('~/src/middleware/auth.ts')).toBe(true)
    expect(await service.fileExists('~/package.json')).toBe(true)
  })

  test('mock service fileExists returns false for folders and missing files', async () => {
    const service = createFileSystemService()

    expect(await service.fileExists('~/src/middleware')).toBe(false)
    expect(await service.fileExists('~/src/missing.ts')).toBe(false)
  })

  test('service has writeFile method', () => {
    const service = createFileSystemService()

    expect(service).toBeDefined()
    expect(typeof service.writeFile).toBe('function')
    expect(typeof service.renamePath).toBe('function')
    expect(typeof service.deletePath).toBe('function')
  })

  test('mock service writeFile resolves without error', async () => {
    const service = createFileSystemService()

    await expect(
      service.writeFile('~/test.txt', 'content')
    ).resolves.toBeUndefined()
  })

  test('mock service renamePath resolves without error', async () => {
    const service = createFileSystemService()

    await expect(
      service.renamePath('~/test.txt', 'renamed.txt')
    ).resolves.toBeUndefined()
  })

  test('mock service deletePath resolves without error', async () => {
    const service = createFileSystemService()

    await expect(service.deletePath('~/test.txt')).resolves.toBeUndefined()
  })
})
