import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
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

// Locate the tauri-driver binary. Priority:
//   1. $TAURI_DRIVER_PATH (explicit escape hatch)
//   2. ~/.cargo/bin/tauri-driver (cargo install default, used by CI)
//   3. ~/.local/bin/tauri-driver (alt install root, used locally when
//      the cargo shim isn't configured with a toolchain)
//   4. bare "tauri-driver" (resolved via PATH)
const resolveTauriDriver = (): string => {
  const envPath = process.env.TAURI_DRIVER_PATH
  if (envPath && existsSync(envPath)) return envPath

  const candidates = [
    path.resolve(os.homedir(), '.cargo/bin/tauri-driver'),
    path.resolve(os.homedir(), '.local/bin/tauri-driver'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return 'tauri-driver'
}

const waitForPort = async (
  port: number,
  host = '127.0.0.1',
  timeoutMs = 15_000
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
  const binary = resolveTauriDriver()
  tauriDriver = spawn(binary, ['--port', String(TAURI_DRIVER_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  tauriDriver.once('error', (err) => {
    process.stderr.write(
      `[tauri-driver] spawn failed for "${binary}": ${err.message}\n` +
        'Install with: cargo install tauri-driver\n'
    )
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
