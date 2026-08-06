import type { PtyProgress } from '../types'

const PROGRESS_TIMEOUT_MS = 15_000

export type ProgressCallback = (
  sessionId: string,
  progress: PtyProgress | undefined
) => void

export class ProgressTracker {
  private readonly progressBySession = new Map<string, PtyProgress>()
  private readonly progressTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  private readonly expiredSessions = new Set<string>()

  constructor(private readonly callbacks: readonly ProgressCallback[]) {}

  get(sessionId: string): PtyProgress | undefined {
    return this.progressBySession.get(sessionId)
  }

  hasExpired(sessionId: string): boolean {
    return this.expiredSessions.has(sessionId)
  }

  clear(sessionId: string): void {
    this.expiredSessions.delete(sessionId)
    const timer = this.progressTimers.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.progressTimers.delete(sessionId)
    }
    if (this.progressBySession.delete(sessionId)) {
      this.callbacks.forEach((cb) => cb(sessionId, undefined))
    }
  }

  set(sessionId: string, progress: PtyProgress): void {
    const previous = this.progressBySession.get(sessionId)
    const timer = this.progressTimers.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
    }

    this.progressBySession.set(sessionId, progress)
    this.expiredSessions.delete(sessionId)

    const nextTimer = setTimeout(() => {
      if (this.progressTimers.get(sessionId) === nextTimer) {
        this.progressTimers.delete(sessionId)
        if (this.progressBySession.delete(sessionId)) {
          this.expiredSessions.add(sessionId)
          this.callbacks.forEach((cb) => cb(sessionId, undefined))
        }
      }
    }, PROGRESS_TIMEOUT_MS)
    this.progressTimers.set(sessionId, nextTimer)

    if (
      previous?.state !== progress.state ||
      previous.value !== progress.value
    ) {
      this.callbacks.forEach((cb) => cb(sessionId, progress))
    }
  }

  dispose(): void {
    this.progressTimers.forEach((timer) => clearTimeout(timer))
    this.progressTimers.clear()
    this.progressBySession.clear()
    this.expiredSessions.clear()
  }
}
