import type {
  BrowserTerminalOptions,
  TerminalPoint,
  TerminalViewport,
  TerminalWorkerEvent,
  TerminalWorkerRequest,
} from './types'

/** Main-thread DOM/input adapter. Terminal parsing and rendering live in the worker. */
export class BrowserTerminal {
  private worker: Worker
  private canvas = document.createElement('canvas')
  private textarea = document.createElement('textarea')
  private accessible = document.createElement('pre')
  private scrollbar = document.createElement('input')
  private element = document.createElement('div')
  private observer: ResizeObserver | undefined
  private viewport: TerminalViewport | undefined
  private selection = ''
  private disposed = false
  private composing = false
  private dragging = false
  private connection = 0
  private listeners = new Set<() => void>()
  private connectionListener:
    | ((event: Extract<TerminalWorkerEvent, { type: 'connection' }>) => void)
    | undefined
  private readyResolve!: () => void
  private readyReject!: (error: Error) => void
  readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve
    this.readyReject = reject
  })
  onError: (error: Error) => void = () => {}
  onViewport: (viewport: TerminalViewport) => void = () => {}
  onActivate: (point: TerminalPoint, viewport: TerminalViewport) => void = () => {}
  renderer: string | undefined

  constructor(private options: BrowserTerminalOptions) {
    this.worker = new Worker(new URL('./terminal.worker.ts', import.meta.url), {
      type: 'module',
      name: 'dovo-terminal',
    })
    this.worker.onmessage = (event: MessageEvent<TerminalWorkerEvent>) => this.receive(event.data)
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Terminal worker stopped.')
      this.readyReject(error)
      this.onError(error)
      this.connectionListener?.({
        type: 'connection',
        id: this.connection,
        state: 'error',
        message: error.message,
      })
    }
    this.element.className = 'dovo-terminal'
    this.canvas.className = 'dovo-terminal-canvas'
    this.textarea.className = 'dovo-terminal-input'
    this.textarea.setAttribute('aria-label', 'Terminal input')
    this.textarea.setAttribute('autocapitalize', 'off')
    this.textarea.autocomplete = 'off'
    this.textarea.spellcheck = false
    this.accessible.className = 'dovo-terminal-accessible'
    this.accessible.setAttribute('aria-label', 'Terminal output')
    this.accessible.setAttribute('role', 'log')
    this.accessible.setAttribute('aria-live', 'off')
    this.scrollbar.type = 'range'
    this.scrollbar.className = 'dovo-terminal-scrollbar'
    this.scrollbar.setAttribute('aria-label', 'Terminal scrollback')
    this.scrollbar.min = '0'
    this.scrollbar.max = '0'
    this.scrollbar.step = '1'
    this.element.append(this.canvas, this.textarea, this.accessible, this.scrollbar)
    this.attachInput()
    const transferable = typeof this.canvas.transferControlToOffscreen === 'function'
    const offscreen = transferable ? this.canvas.transferControlToOffscreen() : undefined
    this.post(
      { type: 'init', canvas: offscreen, options, devicePixelRatio: window.devicePixelRatio || 1 },
      offscreen ? [offscreen] : [],
    )
    // Consumers can install error handlers immediately after construction.
    void this.ready.catch(() => {})
  }
  private post(message: TerminalWorkerRequest, transfer: Transferable[] = []) {
    if (!this.disposed) this.worker.postMessage(message, transfer)
  }
  private receive(event: TerminalWorkerEvent) {
    if (this.disposed) return
    if (event.type === 'ready') this.readyResolve()
    else if (event.type === 'error') {
      const error = new Error(event.message)
      this.readyReject(error)
      this.onError(error)
    } else if (event.type === 'selection') {
      this.selection = event.text
      for (const listener of this.listeners) listener()
    } else if (event.type === 'connection') this.connectionListener?.(event)
    else if (event.type === 'renderer') {
      this.renderer = event.renderer
      this.element.dataset.renderer = event.renderer
    } else if (event.type === 'replaceCanvas') {
      const replacement = document.createElement('canvas')
      replacement.className = this.canvas.className
      this.canvas.replaceWith(replacement)
      this.canvas = replacement
      const canvas =
        event.renderer !== 'canvas2d' &&
        typeof replacement.transferControlToOffscreen === 'function'
          ? replacement.transferControlToOffscreen()
          : undefined
      this.post({ type: 'canvas', canvas, renderer: event.renderer }, canvas ? [canvas] : [])
      this.fit()
    } else if (event.type === 'bitmap') {
      // Software presentation survives a failed GPU compositor/context path. Parsing and
      // drawing text still happen in the worker; the main thread only presents a bitmap.
      if (this.canvas.width !== event.bitmap.width) this.canvas.width = event.bitmap.width
      if (this.canvas.height !== event.bitmap.height) this.canvas.height = event.bitmap.height
      const context = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true })
      if (context) context.drawImage(event.bitmap, 0, 0)
      event.bitmap.close()
    } else if (event.type === 'viewport') {
      this.viewport = event.viewport
      this.scrollbar.max = String(event.viewport.history)
      this.scrollbar.value = String(event.viewport.top)
      this.scrollbar.hidden = !event.viewport.history
      const text = event.viewport.lines.map((line) => line.text.trimEnd()).join('\n')
      if (this.accessible.textContent !== text) this.accessible.textContent = text
      const x = event.viewport.cursor.x * event.viewport.metrics.cellWidth,
        y = Math.max(0, event.viewport.cursor.y) * event.viewport.metrics.cellHeight
      this.textarea.style.left = `${Math.min(x, this.element.clientWidth - 10)}px`
      this.textarea.style.top = `${Math.min(y, this.element.clientHeight - 10)}px`
      this.onViewport(event.viewport)
    }
  }
  open(container: HTMLElement) {
    container.append(this.element)
    this.observer = new ResizeObserver(() => this.fit())
    this.observer.observe(this.element)
    this.fit()
  }
  fit() {
    const width = this.element.clientWidth - 12,
      height = this.element.clientHeight
    if (width > 0 && height > 0) {
      if (typeof this.canvas.transferControlToOffscreen !== 'function') {
        this.canvas.width = Math.ceil(width * (window.devicePixelRatio || 1))
        this.canvas.height = Math.ceil(height * (window.devicePixelRatio || 1))
      }
      this.post({ type: 'resize', width, height })
    }
  }
  configure(options: BrowserTerminalOptions) {
    this.options = options
    this.post({ type: 'configure', options, devicePixelRatio: window.devicePixelRatio || 1 })
  }
  setInputEnabled(enabled: boolean) {
    this.post({ type: 'inputEnabled', enabled })
  }
  setVisible(visible: boolean) {
    this.post({ type: 'visible', visible })
    if (visible) this.fit()
  }
  async connect(url: string, signal: AbortSignal, opened: () => void, port?: MessagePort) {
    await this.ready
    if (signal.aborted) {
      port?.close()
      return
    }
    const id = ++this.connection
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        if (this.connection === id) this.connectionListener = undefined
        signal.removeEventListener('abort', abort)
        clearTimeout(timeout)
      }
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        cleanup()
        this.post({ type: 'disconnect', id })
        if (error) reject(error)
        else resolve()
      }
      const abort = () => finish()
      const timeout = setTimeout(() => finish(new Error('Terminal connection timed out.')), 10000)
      this.connectionListener = (event) => {
        if (event.id !== id) return
        if (event.state === 'open') {
          clearTimeout(timeout)
          opened()
        } else finish(new Error(event.message || 'Terminal disconnected.'))
      }
      signal.addEventListener('abort', abort, { once: true })
      this.post({ type: 'connect', id, url, port }, port ? [port] : [])
    })
  }
  private point(event: MouseEvent): TerminalPoint {
    const rect = this.canvas.getBoundingClientRect(),
      metrics = this.viewport?.metrics
    return {
      x: Math.floor((event.clientX - rect.left) / (metrics?.cellWidth ?? 8)),
      y: Math.floor((event.clientY - rect.top) / (metrics?.cellHeight ?? 16)),
    }
  }
  private attachInput() {
    this.textarea.addEventListener('compositionstart', () => {
      this.composing = true
    })
    this.textarea.addEventListener('compositionend', (event) => {
      this.composing = false
      if (event.data) this.post({ type: 'input', text: event.data })
      this.textarea.value = ''
    })
    this.textarea.addEventListener('input', (event) => {
      if (this.composing || event.isComposing) return
      if (event.inputType === 'insertFromComposition') {
        this.textarea.value = ''
        return
      }
      if (this.textarea.value) this.post({ type: 'input', text: this.textarea.value })
      this.textarea.value = ''
    })
    this.textarea.addEventListener('keydown', (event) => {
      if (this.composing || event.isComposing || event.keyCode === 229) return
      if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && event.key.toLowerCase() === 'v')
        return
      if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && event.key.toLowerCase() === 'c')
        return
      if (event.metaKey) return
      if (event.shiftKey && (event.key === 'PageUp' || event.key === 'PageDown')) {
        event.preventDefault()
        this.post({
          type: 'scroll',
          lines: (event.key === 'PageUp' ? -1 : 1) * (this.viewport?.rows ?? 20),
        })
        return
      }
      if (
        event.key.length === 1 &&
        ((!event.ctrlKey && !event.altKey) || (event.ctrlKey && event.altKey))
      )
        return
      if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock'].includes(event.key)) return
      event.preventDefault()
      this.post({
        type: 'key',
        code: event.code,
        key: event.key,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
        repeat: event.repeat,
      })
    })
    this.element.addEventListener('paste', (event) => {
      event.preventDefault()
      this.paste(event.clipboardData?.getData('text/plain') ?? '')
    })
    this.element.addEventListener('copy', (event) => {
      if (this.selection) {
        event.preventDefault()
        event.clipboardData?.setData('text/plain', this.selection)
      }
    })
    this.textarea.addEventListener('focus', () => this.post({ type: 'focus', focused: true }))
    this.textarea.addEventListener('blur', () => this.post({ type: 'focus', focused: false }))
    this.element.addEventListener('pointerdown', (event) => {
      if (event.target === this.scrollbar || (event.button !== 0 && !this.viewport?.mouseTracking))
        return
      event.preventDefault()
      this.focus()
      if ((event.ctrlKey || event.metaKey) && this.viewport) {
        this.onActivate(this.point(event), this.viewport)
        return
      }
      this.dragging = true
      this.element.setPointerCapture(event.pointerId)
      this.post({
        type: 'pointer',
        phase: 'down',
        point: this.point(event),
        button: event.button,
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
      })
    })
    this.element.addEventListener('pointermove', (event) => {
      if (this.dragging || this.viewport?.mouseTracking)
        this.post({
          type: 'pointer',
          phase: 'move',
          point: this.point(event),
          button: event.button,
          shift: event.shiftKey,
          alt: event.altKey,
          ctrl: event.ctrlKey,
        })
    })
    const release = (event: PointerEvent) => {
      if (!this.dragging) return
      this.dragging = false
      this.post({
        type: 'pointer',
        phase: 'up',
        point: this.point(event),
        button: event.button,
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
      })
      if (this.element.hasPointerCapture(event.pointerId))
        this.element.releasePointerCapture(event.pointerId)
    }
    this.element.addEventListener('dblclick', (event) => {
      if (!this.viewport?.mouseTracking || event.shiftKey)
        this.post({ type: 'selectWord', point: this.point(event) })
    })
    this.element.addEventListener('contextmenu', (event) => {
      if (this.viewport?.mouseTracking && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
      }
    })
    this.element.addEventListener('pointerup', release)
    this.element.addEventListener('pointercancel', release)
    this.element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        const cellHeight = this.viewport?.metrics.cellHeight ?? 16
        const delta =
          event.deltaMode === 1
            ? event.deltaY
            : event.deltaMode === 2
              ? event.deltaY * (this.viewport?.rows ?? 20)
              : event.deltaY / cellHeight
        this.post({
          type: 'scroll',
          lines: Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta))),
          point: this.point(event),
          shift: event.shiftKey,
          alt: event.altKey,
          ctrl: event.ctrlKey,
        })
      },
      { passive: false },
    )
    this.scrollbar.addEventListener('input', () =>
      this.post({
        type: 'scroll',
        lines: Number(this.scrollbar.value) - (this.viewport?.top ?? 0),
      }),
    )
  }
  focus() {
    this.textarea.focus({ preventScroll: true })
  }
  paste(text: string) {
    this.post({ type: 'input', text, paste: true })
  }
  getSelection() {
    return this.selection
  }
  hasSelection() {
    return this.selection.length > 0
  }
  onSelectionChange(listener: () => void) {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }
  selectAll() {
    this.post({ type: 'selectAll' })
  }
  clearSelection() {
    this.post({ type: 'clearSelection' })
  }
  scrollToTop() {
    this.post({ type: 'scroll', lines: -Infinity })
  }
  scrollToBottom() {
    this.post({ type: 'scroll', lines: Infinity })
  }
  dispose() {
    if (this.disposed) return
    this.post({ type: 'dispose' })
    this.disposed = true
    this.observer?.disconnect()
    this.worker.terminate()
    this.element.remove()
    this.listeners.clear()
    this.connectionListener?.({
      type: 'connection',
      id: this.connection,
      state: 'close',
      message: 'Terminal closed.',
    })
  }
}
