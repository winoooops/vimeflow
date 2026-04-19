import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const repoRoot = path.resolve(__dirname, '../../..')
export const appBinary = path.resolve(
  repoRoot,
  'src-tauri/target/debug/vimeflow'
)

export const TAURI_DRIVER_PORT = 4444

const TAURI_DRIVER_BIN = path.resolve(os.homedir(), '.local/bin/tauri-driver')

const waitForPort = async (
  port: number,
  host = '127.0.0.1',
  timeoutMs = 5_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ready = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (ready) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(
    `tauri-driver did not start listening on ${host}:${port} within ${timeoutMs}ms`
  )
}

let tauriDriver: ChildProcess | undefined

export const startTauriDriver = async (): Promise<void> => {
  if (tauriDriver) return
  tauriDriver = spawn(TAURI_DRIVER_BIN, ['--port', String(TAURI_DRIVER_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  tauriDriver.stderr?.on('data', (chunk) => {
    process.stderr.write(`[tauri-driver] ${chunk}`)
  })
  await waitForPort(TAURI_DRIVER_PORT)
}

export const stopTauriDriver = (): void => {
  tauriDriver?.kill()
  tauriDriver = undefined
}
