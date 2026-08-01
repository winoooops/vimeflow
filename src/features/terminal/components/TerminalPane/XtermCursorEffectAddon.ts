import type { IDisposable, ITerminalAddon, Terminal } from '@xterm/xterm'
import type { TerminalCursorEffect } from '../../cursorEffects'

interface CursorRect {
  height: number
  width: number
  x: number
  y: number
}

const EFFECT_DURATION: Record<Exclude<TerminalCursorEffect, 'off'>, number> = {
  warp: 300,
  sweep: 300,
  tail: 300,
  ripple: 400,
  'sonic-boom': 400,
}

const sameRect = (left: CursorRect, right: CursorRect): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height

const centerOf = (rect: CursorRect): { x: number; y: number } => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
})

const easeOutCubic = (progress: number): number => 1 - Math.pow(1 - progress, 3)

const easeOutCirc = (progress: number): number =>
  Math.sqrt(1 - Math.pow(progress - 1, 2))

export class XtermCursorEffectAddon implements ITerminalAddon {
  private animationFrame: number | null = null
  private canvas: HTMLCanvasElement | null = null
  private color: string
  private context: CanvasRenderingContext2D | null = null
  private current: CursorRect | null = null
  private disposables: IDisposable[] = []
  private effect: TerminalCursorEffect
  private height = 0
  private previous: CursorRect | null = null
  private screen: HTMLElement | null = null
  private startedAt = 0
  private terminal: Terminal | null = null
  private width = 0

  constructor(effect: TerminalCursorEffect, color: string) {
    this.effect = effect
    this.color = color
  }

  activate(terminal: Terminal): void {
    const screen = terminal.element?.querySelector<HTMLElement>('.xterm-screen')
    if (!screen) {
      return
    }

    const canvas = screen.ownerDocument.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    canvas.dataset.xtermCursorEffect = this.effect
    canvas.setAttribute('aria-hidden', 'true')
    Object.assign(canvas.style, {
      inset: '0',
      pointerEvents: 'none',
      position: 'absolute',
      zIndex: '4',
    })
    screen.append(canvas)

    this.canvas = canvas
    this.context = context
    this.screen = screen
    this.terminal = terminal
    this.resizeCanvas()
    this.current = this.readCursorRect()
    this.disposables = [
      terminal.onCursorMove(() => this.handleCursorMove()),
      terminal.onResize(() => this.syncWithoutAnimation()),
      terminal.onScroll(() => this.syncWithoutAnimation()),
    ]
  }

  setEffect(effect: TerminalCursorEffect, color: string): void {
    this.effect = effect
    this.color = color
    if (this.canvas) {
      this.canvas.dataset.xtermCursorEffect = effect
    }
    this.previous = null
    this.cancelAnimation()
    this.clear()
    this.current = this.readCursorRect()
  }

  dispose(): void {
    this.cancelAnimation()
    this.disposables.forEach((disposable) => disposable.dispose())
    this.disposables = []
    this.canvas?.remove()
    this.canvas = null
    this.context = null
    this.current = null
    this.previous = null
    this.screen = null
    this.terminal = null
  }

  private handleCursorMove(): void {
    const next = this.readCursorRect()
    if (!next) {
      return
    }

    const current = this.current
    this.current = next
    if (!current || sameRect(current, next)) {
      return
    }

    this.previous = current
    if (
      this.effect === 'off' ||
      this.screen?.ownerDocument.defaultView?.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches
    ) {
      this.clear()

      return
    }

    this.startedAt =
      this.screen?.ownerDocument.defaultView?.performance.now() ??
      performance.now()
    this.cancelAnimation()
    this.scheduleAnimation()
  }

  private syncWithoutAnimation(): void {
    this.cancelAnimation()
    this.resizeCanvas()
    this.previous = null
    this.current = this.readCursorRect()
    this.clear()
  }

  private resizeCanvas(): boolean {
    if (!this.canvas || !this.context || !this.screen) {
      return false
    }

    const width = this.screen.clientWidth
    const height = this.screen.clientHeight
    if (width <= 0 || height <= 0) {
      return false
    }

    const pixelRatio =
      this.screen.ownerDocument.defaultView?.devicePixelRatio ?? 1
    const pixelWidth = Math.round(width * pixelRatio)
    const pixelHeight = Math.round(height * pixelRatio)

    if (
      this.canvas.width !== pixelWidth ||
      this.canvas.height !== pixelHeight
    ) {
      this.canvas.width = pixelWidth
      this.canvas.height = pixelHeight
      this.canvas.style.width = `${width}px`
      this.canvas.style.height = `${height}px`
    }

    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    this.width = width
    this.height = height

    return true
  }

  private readCursorRect(): CursorRect | null {
    const terminal = this.terminal
    if (
      !terminal ||
      (!this.resizeCanvas() && (this.width <= 0 || this.height <= 0))
    ) {
      return null
    }

    const { active } = terminal.buffer
    const row = active.baseY + active.cursorY - active.viewportY
    if (row < 0 || row >= terminal.rows || terminal.cols <= 0) {
      return null
    }

    const cellWidth = this.width / terminal.cols
    const cellHeight = this.height / terminal.rows

    return {
      x: Math.min(active.cursorX, terminal.cols - 1) * cellWidth,
      y: row * cellHeight,
      width: cellWidth,
      height: cellHeight,
    }
  }

  private scheduleAnimation(): void {
    const view = this.screen?.ownerDocument.defaultView
    if (!view || this.animationFrame !== null) {
      return
    }

    this.animationFrame = view.requestAnimationFrame((timestamp) => {
      this.animationFrame = null
      this.draw(timestamp)
    })
  }

  private cancelAnimation(): void {
    const view = this.screen?.ownerDocument.defaultView
    if (view && this.animationFrame !== null) {
      view.cancelAnimationFrame(this.animationFrame)
    }
    this.animationFrame = null
  }

  private clear(): void {
    this.context?.clearRect(0, 0, this.width, this.height)
  }

  private draw(timestamp: number): void {
    if (
      this.effect === 'off' ||
      !this.context ||
      !this.current ||
      !this.previous
    ) {
      return
    }

    const duration = EFFECT_DURATION[this.effect]

    const progress = Math.min(
      Math.max((timestamp - this.startedAt) / duration, 0),
      1
    )
    this.clear()

    if (this.effect === 'ripple' || this.effect === 'sonic-boom') {
      this.drawRadialEffect(this.effect, progress)
    } else {
      this.drawTrailEffect(this.effect, progress)
    }

    if (progress < 1) {
      this.scheduleAnimation()
    } else {
      this.previous = null
    }
  }

  private drawTrailEffect(
    effect: 'sweep' | 'tail' | 'warp',
    progress: number
  ): void {
    if (!this.context || !this.current || !this.previous) {
      return
    }

    const current = centerOf(this.current)
    const previous = centerOf(this.previous)
    const eased = easeOutCubic(progress)

    const trailing = {
      x: previous.x + (current.x - previous.x) * eased,
      y: previous.y + (current.y - previous.y) * eased,
    }

    const thickness =
      effect === 'tail'
        ? this.current.height * 0.45
        : this.current.height * (effect === 'warp' ? 1 : 0.8)

    this.context.save()
    this.context.strokeStyle = this.color
    this.context.globalAlpha = (1 - progress) * (effect === 'tail' ? 0.8 : 1)
    this.context.lineWidth = thickness
    this.context.lineCap = effect === 'sweep' ? 'butt' : 'round'
    this.context.shadowBlur = effect === 'warp' ? this.current.height * 0.4 : 0
    this.context.shadowColor = this.color
    this.context.beginPath()
    this.context.moveTo(trailing.x, trailing.y)
    this.context.lineTo(current.x, current.y)
    this.context.stroke()
    this.context.restore()
  }

  private drawRadialEffect(
    effect: 'ripple' | 'sonic-boom',
    progress: number
  ): void {
    if (!this.context || !this.current) {
      return
    }

    const current = centerOf(this.current)

    const radius =
      Math.max(this.current.height, this.height * 0.04) * easeOutCirc(progress)

    this.context.save()
    this.context.strokeStyle = this.color
    this.context.fillStyle = this.color
    this.context.globalAlpha = Math.pow(1 - progress, 2)
    this.context.lineWidth = Math.max(2, this.current.height * 0.12)
    this.context.beginPath()
    this.context.arc(current.x, current.y, radius, 0, Math.PI * 2)
    if (effect === 'ripple') {
      this.context.stroke()
    } else {
      this.context.fill()
    }
    this.context.restore()
  }
}
