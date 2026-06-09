import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  beginWorkspaceHydration,
  endWorkspaceHydration,
  loadWorkspaceForRestore,
  onWorkspaceRequestFinalShape,
  pushWorkspaceShape,
  type WorkspaceLayoutBridge,
  type WorkspaceShapeDto,
} from './workspaceLayoutBridge'

const shape: WorkspaceShapeDto = { sessions: [] }

interface TestWindow {
  vimeflow?: { workspaceLayout?: WorkspaceLayoutBridge }
}

const asTestWindow = (): TestWindow => window as unknown as TestWindow

const setBridge = (value: WorkspaceLayoutBridge | undefined): void => {
  asTestWindow().vimeflow = value ? { workspaceLayout: value } : undefined
}

describe('workspaceLayoutBridge', () => {
  afterEach(() => {
    delete asTestWindow().vimeflow
  })

  test('delegates to the preload bridge when present', async () => {
    const preload: WorkspaceLayoutBridge = {
      pushShape: vi.fn().mockResolvedValue(undefined),
      loadForRestore: vi.fn().mockResolvedValue(shape),
      beginHydration: vi.fn().mockResolvedValue(undefined),
      endHydration: vi.fn().mockResolvedValue(undefined),
      onRequestFinalShape: vi.fn().mockReturnValue(() => undefined),
    }
    setBridge(preload)

    await pushWorkspaceShape(shape)
    expect(preload.pushShape).toHaveBeenCalledWith(shape)

    await expect(
      loadWorkspaceForRestore({ projectId: 'p', workingDirectory: '/r' })
    ).resolves.toEqual(shape)

    expect(preload.loadForRestore).toHaveBeenCalledWith({
      projectId: 'p',
      workingDirectory: '/r',
    })

    await beginWorkspaceHydration()
    expect(preload.beginHydration).toHaveBeenCalled()

    await endWorkspaceHydration()
    expect(preload.endHydration).toHaveBeenCalled()

    const callback = vi.fn()
    onWorkspaceRequestFinalShape(callback)
    expect(preload.onRequestFinalShape).toHaveBeenCalledWith(callback)
  })

  test('degrades to no-ops when the preload bridge is absent', async () => {
    setBridge(undefined)

    await expect(pushWorkspaceShape(shape)).resolves.toBeUndefined()
    await expect(
      loadWorkspaceForRestore({ projectId: 'p', workingDirectory: '/r' })
    ).resolves.toBeNull()
    await expect(beginWorkspaceHydration()).resolves.toBeUndefined()
    await expect(endWorkspaceHydration()).resolves.toBeUndefined()
    expect(onWorkspaceRequestFinalShape(() => undefined)).toBeTypeOf('function')
  })
})
