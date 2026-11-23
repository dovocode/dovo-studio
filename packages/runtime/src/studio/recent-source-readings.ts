type Reading = { data: unknown; updatedAt: number }

export class RecentSourceReadings {
  private readonly readings = new Map<string, { target: string; result: Reading }>()

  clear(id: string, source: string) {
    this.readings.delete(JSON.stringify([id, source]))
  }

  read(id: string, source: string, target: string, interval: number) {
    const previous = this.readings.get(JSON.stringify([id, source]))
    if (previous?.target !== target) return
    const refreshAfterMs = previous.result.updatedAt + interval - Date.now()
    if (refreshAfterMs <= 0) return
    return { ...previous.result, refreshAfterMs }
  }

  remember(id: string, source: string, target: string, interval: number, result: Reading) {
    const key = JSON.stringify([id, source])
    this.readings.delete(key)
    this.readings.set(key, { target, result })
    if (this.readings.size > 48) {
      const oldest = this.readings.keys().next().value
      if (oldest !== undefined) this.readings.delete(oldest)
    }
    return { ...result, refreshAfterMs: Math.max(0, result.updatedAt + interval - Date.now()) }
  }
}
