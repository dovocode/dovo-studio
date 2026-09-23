import { physicalDevice } from './physical-device.js'
import { randomUUID } from 'node:crypto'
import type { PreviewDevice, RemoteBrowserInput } from '@dovo/protocol'
import { previewDevices } from './devices.js'
import { iosSimulator, androidSimulator, type NativeSimulator } from './simulator-native.js'
import type { BrowserFrame, BrowserOutput } from './browser.js'
import { HttpError, errorMessage } from '../errors.js'
type Listener = (message: BrowserOutput) => void
type Session = {
  device: PreviewDevice
  driver: NativeSimulator
  listeners: Set<Listener>
  frame?: BrowserFrame
  stop?: () => void
  idle?: ReturnType<typeof setTimeout>
  closed: boolean
  queue: Promise<void>
  queued: number
  move?: { input: RemoteBrowserInput; authorize: () => void; promise?: Promise<void> }
}
type Entry = { taskId: string; deviceId: string; pending: Promise<Session> }
export class SimulatorPreviews {
  private sessions = new Map<string, Entry>()
  private disposed = false
  taskId(id: string) {
    return this.get(id).taskId
  }
  private get(id: string) {
    const entry = this.sessions.get(id)
    if (!entry) throw new HttpError(404, 'Simulator preview expired. Reconnect to continue.')
    return entry
  }
  async open(taskId: string, deviceId: string) {
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    const existing = [...this.sessions].find(
      ([, value]) => value.taskId === taskId && value.deviceId === deviceId,
    )
    if (existing) return { id: existing[0], device: (await existing[1].pending).device }
    const device = (await previewDevices()).devices.find((device) => device.id === deviceId)
    if (!device) throw new HttpError(404, 'Simulator is no longer available')
    if (device.kind !== 'physical' && device.state !== 'booted')
      throw new HttpError(409, 'Start this simulator before opening its live preview')
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    if (
      device.kind === 'physical' &&
      [...this.sessions.values()].some(
        (entry) => entry.deviceId === deviceId && entry.taskId !== taskId,
      )
    )
      throw new HttpError(
        409,
        'This phone is already being controlled by another task. Close that preview first.',
      )
    // Discovery is asynchronous; recheck before reserving the session.
    const concurrent = [...this.sessions].find(
      ([, value]) => value.taskId === taskId && value.deviceId === deviceId,
    )
    if (concurrent) return { id: concurrent[0], device: (await concurrent[1].pending).device }
    if (this.sessions.size >= 4)
      throw new HttpError(409, 'Close an unused simulator preview first (maximum 4)')
    const id = randomUUID()
    const pending = (async (): Promise<Session> => ({
      device,
      driver: await (device.kind === 'physical'
        ? physicalDevice(device)
        : device.platform === 'ios'
          ? iosSimulator(device)
          : androidSimulator(device)),
      listeners: new Set(),
      closed: false,
      queue: Promise.resolve(),
      queued: 0,
    }))()
    this.sessions.set(id, { taskId, deviceId, pending })
    try {
      const session = await pending
      this.expire(id, session)
      return { id, device }
    } catch (error) {
      this.sessions.delete(id)
      throw error
    }
  }
  private expire(id: string, session: Session) {
    clearTimeout(session.idle)
    session.idle = setTimeout(() => {
      void this.close(id).catch((error) =>
        console.error('Could not close simulator preview', error),
      )
    }, 30000)
    session.idle.unref()
  }
  async attach(id: string, listener: Listener) {
    const session = await this.get(id).pending
    if (session.closed) throw new HttpError(404, 'Simulator preview closed')
    clearTimeout(session.idle)
    session.listeners.add(listener)
    listener({
      type: 'state',
      url: `simulator://${session.device.id}`,
      title: session.device.name,
      back: session.device.platform === 'android',
      forward: false,
      loading: false,
      editable: true,
    })
    if (session.frame) listener(session.frame)
    if (!session.stop) {
      session.stop = session.driver.start(
        (frame) => {
          if (
            session.frame?.width === frame.width &&
            session.frame.height === frame.height &&
            Buffer.from(
              session.frame.data.buffer,
              session.frame.data.byteOffset,
              session.frame.data.byteLength,
            ).equals(frame.data)
          )
            return
          session.frame = frame
          for (const notify of session.listeners) notify(frame)
        },
        (error) => {
          for (const notify of session.listeners)
            notify({ type: 'error', message: errorMessage(error) })
          void this.close(id).catch((failure) =>
            console.error('Could not dispose failed simulator preview', failure),
          )
        },
      )
    }
    return () => {
      session.listeners.delete(listener)
      if (session.closed) return
      if (!session.listeners.size) {
        session.stop?.()
        session.stop = undefined
        session.queue = session.queue
          .then(() => session.driver.release())
          .catch((error) => console.warn('Could not release disconnected simulator input', error))
        this.expire(id, session)
      }
    }
  }
  async input(id: string, input: RemoteBrowserInput, authorize: () => void) {
    const session = await this.get(id).pending
    if (session.closed) throw new HttpError(404, 'Simulator preview closed')
    if (input.type === 'resize' || input.type === 'status') return
    if (!['pointer', 'key', 'text', 'scroll', 'back'].includes(input.type))
      throw new HttpError(400, 'Unsupported simulator action')
    if (
      input.type === 'pointer' &&
      input.phase === 'move' &&
      session.move?.authorize === authorize &&
      session.move.input.type === 'pointer' &&
      session.move.input.phase === 'move'
    ) {
      session.move.input = input
      return session.move.promise
    }
    if (
      input.type === 'text' &&
      session.move?.authorize === authorize &&
      session.move.input.type === 'text' &&
      session.move.input.text.length + input.text.length <= 16000
    ) {
      session.move.input = { type: 'text', text: session.move.input.text + input.text }
      return session.move.promise
    }
    // Trackpads produce updates faster than a native swipe can finish. Merge only
    // consecutive waiting scrolls from the same controller, preserving other input order.
    if (
      input.type === 'scroll' &&
      session.move?.authorize === authorize &&
      session.move.input.type === 'scroll'
    ) {
      const previous = session.move.input
      session.move.input = {
        ...input,
        deltaX: Math.max(-4000, Math.min(4000, previous.deltaX + input.deltaX)),
        deltaY: Math.max(-4000, Math.min(4000, previous.deltaY + input.deltaY)),
      }
      return session.move.promise
    }
    if (session.queued >= 100) throw new HttpError(429, 'Simulator input is arriving too quickly')
    const command: NonNullable<Session['move']> = { input, authorize }
    session.move = command
    session.queued++
    const operation = session.queue.then(async () => {
      if (session.move === command) session.move = undefined
      authorize()
      if (session.closed) throw new HttpError(404, 'Simulator preview closed')
      await session.driver.input(command.input)
    })
    command.promise = operation
    session.queue = operation
      .catch(() => {
        /* The caller reports this input failure. Keep later inputs usable. */
      })
      .finally(() => {
        session.queued--
      })
    return operation
  }
  async close(id: string) {
    const entry = this.sessions.get(id)
    if (!entry) return
    this.sessions.delete(id)
    const session = await entry.pending
    session.closed = true
    clearTimeout(session.idle)
    session.stop?.()
    for (const listener of session.listeners)
      listener({ type: 'closed', message: 'Simulator preview closed' })
    session.listeners.clear()
    await session.queue
    await session.driver.close()
  }
  async closeTask(taskId: string) {
    await Promise.all(
      [...this.sessions]
        .filter(([, entry]) => entry.taskId === taskId)
        .map(([id]) => this.close(id)),
    )
  }
  async closeDevice(taskId: string, deviceId: string) {
    await Promise.all(
      [...this.sessions]
        .filter(([, entry]) => entry.taskId === taskId && entry.deviceId === deviceId)
        .map(([id]) => this.close(id)),
    )
  }
  async dispose() {
    this.disposed = true
    const results = await Promise.allSettled([...this.sessions.keys()].map((id) => this.close(id)))
    for (const result of results)
      if (result.status === 'rejected')
        console.error('Could not dispose simulator preview', result.reason)
  }
}
