/** Coalesce replaceable progress only. Boundary and terminal events flush in arrival order. */
export class ProgressBuffer {
  private pending = new Map<string, { write: () => void; bytes: number }>()
  private bytes = 0
  private timer?: ReturnType<typeof setTimeout>
  constructor(private readonly failed: (cause: unknown) => void) {}
  put(key: string, bytes: number, write: () => void) {
    const previous = this.pending.get(key)
    this.bytes -= previous?.bytes ?? 0
    this.pending.set(key, { bytes, write })
    this.bytes += bytes
    if (this.pending.size >= 256 || this.bytes >= 1024 * 1024) this.flush()
    else
      this.timer ??= setTimeout(() => {
        try {
          this.flush()
        } catch (cause) {
          this.failed(cause)
        }
      }, 50)
  }
  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const pending = [...this.pending.values()]
    this.pending.clear()
    this.bytes = 0
    for (const { write } of pending) write()
  }
}
