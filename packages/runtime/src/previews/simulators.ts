import { physicalDevice } from './physical-device.js'
import { physicalAndroid } from './physical-android.js'
import { randomUUID } from 'node:crypto'
import type { PreviewDevice, RemoteBrowserInput } from '@dovo/protocol'
import { previewDevices } from './devices.js'
import { iosSimulator, androidSimulator, type NativeSimulator } from './simulator-native.js'
import type { BrowserFrame, BrowserOutput } from './browser.js'
import { HttpError, errorMessage } from '../errors.js'
type Listener = (message: BrowserOutput) => void
function notify(listeners: Set<Listener>, message: BrowserOutput) {
  for (const listener of listeners) {
    try {
      listener(message)
    } catch (error) {
      // One disconnected controller must not stop the device stream or its teardown.
      console.error('Simulator client failed', error)
    }
  }
}
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
type Entry = {
  foreignOwner?: string
  taskId: string
  deviceId: string
  pending: Promise<Session>
  closing?: Promise<void>
}
export type SimulatorProvider = {
  authorize?: () => void
  devices(
    taskId: string,
    deviceId: string,
    foreignOwner?: string,
  ): Promise<{ devices: PreviewDevice[] }>
  driver(taskId: string, device: PreviewDevice): Promise<NativeSimulator | undefined>
}
export class SimulatorPreviews {
  constructor(private provider?: SimulatorProvider) {}
  private sessions = new Map<string, Entry>()
  private disposed = false
  private epoch = 0
  private taskEpochs = new Map<string, number>()
  private hostEpochs = new Map<string, number>()
  private deviceEpochs = new Map<string, number>()
  taskId(id: string, foreignOwner?: string) {
    const entry = this.get(id)
    if (entry.foreignOwner !== foreignOwner)
      throw new HttpError(403, 'Simulator preview belongs to another paired device')
    return entry.taskId
  }
  async authorizeDevice(id: string, authorize: (deviceId: string) => void) {
    authorize(this.get(id).deviceId)
  }
  async screenPoints(id: string) {
    return (await this.get(id).pending).driver.screenPoints?.()
  }
  private get(id: string) {
    const entry = this.sessions.get(id)
    if (!entry) throw new HttpError(404, 'Simulator preview expired. Reconnect to continue.')
    return entry
  }
  async open(
    taskId: string,
    deviceId: string,
    foreignOwner?: string,
  ): Promise<{ id: string; device: PreviewDevice }> {
    this.provider?.authorize?.()
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    const epoch = this.epoch
    const taskKey = JSON.stringify([taskId, foreignOwner ?? null])
    const taskEpoch = this.taskEpochs.get(taskKey)
    const deviceKey = JSON.stringify([taskKey, deviceId])
    const deviceEpoch = this.deviceEpochs.get(deviceKey)
    const hostId = /^remote:([^:]+):/.exec(deviceId)?.[1]
    const hostEpoch = hostId ? this.hostEpochs.get(hostId) : undefined
    const assertCurrent = () => {
      this.provider?.authorize?.()
      if (
        this.disposed ||
        this.epoch !== epoch ||
        this.taskEpochs.get(taskKey) !== taskEpoch ||
        this.deviceEpochs.get(deviceKey) !== deviceEpoch ||
        (hostId && this.hostEpochs.get(hostId) !== hostEpoch)
      )
        throw new HttpError(409, 'Simulator preview opening was cancelled by cleanup')
    }
    const existing = [...this.sessions].find(
      ([, value]) =>
        value.taskId === taskId &&
        value.deviceId === deviceId &&
        value.foreignOwner === foreignOwner,
    )
    if (existing?.[1].closing) {
      await existing[1].closing
      assertCurrent()
      return this.open(taskId, deviceId, foreignOwner)
    }
    if (existing) {
      const session = await existing[1].pending
      assertCurrent()
      if (!session.listeners.size) this.expire(existing[0], session)
      return { id: existing[0], device: session.device }
    }
    const device = (
      await (this.provider
        ? this.provider.devices(taskId, deviceId, foreignOwner)
        : previewDevices())
    ).devices.find((device) => device.id === deviceId)
    assertCurrent()
    if (!device) throw new HttpError(404, 'Simulator is no longer available')
    if (device.kind === 'physical' && device.state !== 'booted')
      throw new HttpError(409, 'Connect and authorize this phone before opening its live preview')
    if (device.kind !== 'physical' && device.state !== 'booted')
      throw new HttpError(409, 'Start this simulator before opening its live preview')
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    if (
      device.kind === 'physical' &&
      [...this.sessions.values()].some(
        (entry) =>
          entry.deviceId === deviceId &&
          (entry.taskId !== taskId || entry.foreignOwner !== foreignOwner),
      )
    )
      throw new HttpError(
        409,
        'This phone is already being controlled by another task. Close that preview first.',
      )
    // Discovery is asynchronous; recheck before reserving the session.
    const concurrent = [...this.sessions].find(
      ([, value]) =>
        value.taskId === taskId &&
        value.deviceId === deviceId &&
        value.foreignOwner === foreignOwner,
    )
    if (concurrent?.[1].closing) {
      await concurrent[1].closing
      assertCurrent()
      return this.open(taskId, deviceId, foreignOwner)
    }
    if (concurrent) {
      const session = await concurrent[1].pending
      assertCurrent()
      if (!session.listeners.size) this.expire(concurrent[0], session)
      return { id: concurrent[0], device: session.device }
    }
    if (this.sessions.size >= 4)
      throw new HttpError(409, 'Close an unused simulator preview first (maximum 4)')
    const id = randomUUID()
    const pending = (async (): Promise<Session> => ({
      device,
      driver:
        (await this.provider?.driver(taskId, device)) ??
        (await (device.kind === 'physical'
          ? device.platform === 'ios'
            ? physicalDevice(device)
            : physicalAndroid(device)
          : device.platform === 'ios'
            ? iosSimulator(device)
            : androidSimulator(device))),
      listeners: new Set(),
      closed: false,
      queue: Promise.resolve(),
      queued: 0,
    }))()
    this.sessions.set(id, { taskId, deviceId, foreignOwner, pending })
    try {
      const session = await pending
      try {
        assertCurrent()
      } catch (error) {
        await this.close(id)
        throw error
      }
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
    this.provider?.authorize?.()
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
          notify(session.listeners, frame)
        },
        (error) => {
          notify(session.listeners, { type: 'error', message: errorMessage(error) })
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
    this.provider?.authorize?.()
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
      this.provider?.authorize?.()
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
    if (entry.closing) return entry.closing
    entry.closing = this.closeSession(entry).finally(() => {
      this.sessions.delete(id)
    })
    return entry.closing
  }
  private async closeSession(entry: Entry) {
    const session = await entry.pending.catch(() => undefined)
    if (!session) return
    session.closed = true
    clearTimeout(session.idle)
    session.stop?.()
    notify(session.listeners, { type: 'closed', message: 'Simulator preview closed' })
    session.listeners.clear()
    await session.queue
    await session.driver.close()
  }
  async release(id: string) {
    const session = await this.get(id).pending
    await session.queue
    await session.driver.release()
  }
  async closeForeignDevice(deviceId: string) {
    const results = await Promise.allSettled(
      [...this.sessions]
        .filter(([, entry]) => entry.foreignOwner === deviceId)
        .map(async ([id, entry]) => {
          const session = await entry.pending.catch(() => undefined)
          // Attached sockets retain their explicit authentication-revoked close code.
          // The WebSocket revocation watcher closes them; reap idle reservations here.
          if (!session?.listeners.size) await this.close(id)
        }),
    )
    for (const result of results)
      if (result.status === 'rejected')
        console.warn('Foreign preview cleanup failed', result.reason)
  }
  private async closeMany(ids: string[]) {
    const results = await Promise.allSettled(ids.map((id) => this.close(id)))
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length)
      throw new AggregateError(failures, 'Could not close every simulator preview')
  }
  async closeHost(hostId: string) {
    this.hostEpochs.set(hostId, (this.hostEpochs.get(hostId) ?? 0) + 1)
    await this.closeMany(
      [...this.sessions]
        .filter(([, entry]) => entry.deviceId.startsWith(`remote:${hostId}:`))
        .map(([id]) => id),
    )
  }
  async closeTask(taskId: string) {
    const key = JSON.stringify([taskId, null])
    this.taskEpochs.set(key, (this.taskEpochs.get(key) ?? 0) + 1)
    await this.closeMany(
      [...this.sessions]
        .filter(([, entry]) => entry.taskId === taskId && !entry.foreignOwner)
        .map(([id]) => id),
    )
  }
  async closeDevice(taskId: string, deviceId: string) {
    const key = JSON.stringify([JSON.stringify([taskId, null]), deviceId])
    this.deviceEpochs.set(key, (this.deviceEpochs.get(key) ?? 0) + 1)
    await this.closeMany(
      [...this.sessions]
        .filter(
          ([, entry]) =>
            entry.taskId === taskId && entry.deviceId === deviceId && !entry.foreignOwner,
        )
        .map(([id]) => id),
    )
  }
  async dispose() {
    this.disposed = true
    await this.closeAll()
  }
  async closeAll() {
    this.epoch++
    const results = await Promise.allSettled([...this.sessions.keys()].map((id) => this.close(id)))
    for (const result of results)
      if (result.status === 'rejected')
        console.error('Could not dispose simulator preview', result.reason)
  }
}
