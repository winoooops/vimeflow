// cspell:ignore ghostty
import {
  createPtyFdTransportBeforeSpawn,
  type PtyFdTransportBootstrap,
} from './ghostty-native-parent'
import { spawnSidecar, type Sidecar, type SidecarOptions } from './sidecar'

interface SpawnSidecarWithPtyTransportOptions {
  binary: string
  appDataDir: string
  ghosttyNativeParentEnabled: boolean
  isPackaged: boolean
  resourcesPath: string
  createTransport?: (
    packaged: boolean,
    resourcesPath: string
  ) => PtyFdTransportBootstrap | null
  spawn?: (options: SidecarOptions) => Sidecar
}

export const spawnSidecarWithPtyTransport = (
  options: SpawnSidecarWithPtyTransportOptions
): Sidecar => {
  const createTransport =
    options.createTransport ?? createPtyFdTransportBeforeSpawn
  const spawn = options.spawn ?? spawnSidecar

  const ptyFdTransport = options.ghosttyNativeParentEnabled
    ? createTransport(options.isPackaged, options.resourcesPath)
    : null

  const sidecarOptions: SidecarOptions = {
    binary: options.binary,
    appDataDir: options.appDataDir,
  }
  if (ptyFdTransport !== null) {
    sidecarOptions.transportFd = ptyFdTransport.transportFd
  }

  const spawnedSidecar = spawn(sidecarOptions)
  ptyFdTransport?.onSpawned()

  return spawnedSidecar
}
