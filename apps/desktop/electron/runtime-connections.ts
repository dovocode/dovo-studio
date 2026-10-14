import {
  startRuntimeSync,
  watchRuntimeTask,
  watchRuntimeActivity,
  runtimeSnapshotPath,
  runtimeRequest,
  snapshotSchema,
  getRuntimeSnapshotTag,
  snapshotDelta,
  type DesktopSyncSubscription,
  type DesktopSyncEvent,
  type RuntimeConnection,
  type RuntimeSnapshot,
  type RuntimeSyncStatus,
} from '@dovo/protocol'

type Subscriber = {
  input: DesktopSyncSubscription
  publish: (event: DesktopSyncEvent) => void
  sequence?: number
}
type Pool = {
  connection: RuntimeConnection
  subscribers: Map<string, Subscriber>
  tasks: Map<string, () => void>
  scopes: Map<string, { detailed: boolean; stop: () => void }>
  live?: ReturnType<typeof startRuntimeSync>
  status: RuntimeSyncStatus
  snapshot?: RuntimeSnapshot
  epoch: string
  sequence: number
  activities: Map<string, Extract<DesktopSyncEvent, { type: 'activity' }>>
  timer?: ReturnType<typeof setTimeout>
  request?: AbortController
  reachable: boolean
  stopped: boolean
}
const key = (connection: RuntimeConnection) =>
  JSON.stringify([connection.address, connection.token])
/** The Electron process owns one stream and fallback poller per paired runtime. */
export class RuntimeConnections {
  private pools = new Map<string, Pool>()
  private subscriptions = new Map<string, Pool>()
  constructor(
    private start = startRuntimeSync,
    private request: (
      connection: RuntimeConnection,
      path: string,
      signal: AbortSignal,
    ) => Promise<RuntimeSnapshot> = (connection, path, signal) =>
      runtimeRequest(
        connection,
        connection.address,
        path,
        undefined,
        snapshotSchema,
        'GET',
        30000,
        signal,
      ),
    private recover?: (connection: RuntimeConnection) => Promise<RuntimeConnection | null>,
  ) {}
  subscribe(id: string, input: DesktopSyncSubscription, publish: Subscriber['publish']) {
    const poolKey = key(input.connection)
    let pool = this.pools.get(poolKey)
    const others = [...(pool?.subscribers.entries() ?? [])]
      .filter(([other]) => other !== id)
      .map(([, item]) => item.input)
    if (
      new Set([...others.flatMap((item) => item.tasks), ...input.tasks]).size > 8 ||
      new Set([...others.flatMap((item) => item.scopes), ...input.scopes]).size > 8
    )
      throw new Error('Open at most eight threads or activity scopes per computer.')
    const previous = this.subscriptions.get(id)
    if (previous && previous !== pool) this.unsubscribe(id)
    if (!pool) {
      pool = {
        connection: input.connection,
        subscribers: new Map(),
        tasks: new Map(),
        scopes: new Map(),
        status: 'connecting',
        activities: new Map(),
        stopped: false,
        reachable: false,
        epoch: crypto.randomUUID(),
        sequence: 0,
      }
      this.pools.set(poolKey, pool)
    }
    const old = pool.subscribers.get(id)
    const subscriber: Subscriber = { input, publish, sequence: old?.sequence }
    pool.subscribers.set(id, subscriber)
    this.subscriptions.set(id, pool)
    this.watch(pool)
    if (!pool.live) {
      const owner = pool
      pool.live = this.start(pool.connection, {
        onSnapshot: (snapshot) => {
          owner.reachable = true
          this.publishSnapshot(owner, snapshot)
        },
        onStatus: (status) => {
          owner.status = status
          if (status !== 'live') owner.reachable = false
          this.broadcast(owner, { type: 'status', status, online: status === 'live' })
          if (status !== 'live') this.poll(owner)
        },
        onWake: () => this.poll(owner),
      })
      this.poll(pool)
    }
    publish({ type: 'status', status: pool.status, online: pool.live.online() })
    if (
      pool.reachable &&
      pool.snapshot &&
      this.covers(pool.snapshot, input.tasks) &&
      (subscriber.sequence !== pool.sequence ||
        (old && JSON.stringify(old.input.tasks) !== JSON.stringify(input.tasks)))
    )
      this.baseline(pool, subscriber)
    for (const scope of input.scopes) {
      const cached = pool.activities.get(scope)
      if (cached) publish(cached)
    }
    if (old && JSON.stringify(old.input.tasks) !== JSON.stringify(input.tasks)) this.poll(pool)
  }
  private covers(snapshot: RuntimeSnapshot, tasks: string[]) {
    return !snapshot.detailTaskIds || tasks.every((id) => snapshot.detailTaskIds?.includes(id))
  }
  private baseline(pool: Pool, subscriber: Subscriber) {
    if (!pool.snapshot || !this.covers(pool.snapshot, subscriber.input.tasks)) return
    subscriber.publish({
      type: 'snapshot',
      snapshot: pool.snapshot,
      epoch: pool.epoch,
      sequence: pool.sequence,
      tag: getRuntimeSnapshotTag(pool.snapshot),
    })
    subscriber.sequence = pool.sequence
  }
  private publishSnapshot(pool: Pool, snapshot: RuntimeSnapshot) {
    const previous = pool.snapshot
    if (previous === snapshot) return
    const restarted = previous && previous.runtimeInstanceId !== snapshot.runtimeInstanceId
    if (restarted) {
      pool.epoch = crypto.randomUUID()
      for (const subscriber of pool.subscribers.values()) subscriber.sequence = undefined
    }
    const base = pool.sequence++
    pool.snapshot = snapshot
    const delta = previous && !restarted ? snapshotDelta(previous, snapshot, true, true) : undefined
    for (const subscriber of pool.subscribers.values()) {
      if (!this.covers(snapshot, subscriber.input.tasks)) continue
      if (delta && subscriber.sequence === base) {
        subscriber.publish({
          type: 'delta',
          delta,
          epoch: pool.epoch,
          base,
          sequence: pool.sequence,
          tag: getRuntimeSnapshotTag(snapshot),
        })
        subscriber.sequence = pool.sequence
      } else this.baseline(pool, subscriber)
    }
  }
  private broadcast(pool: Pool, event: DesktopSyncEvent) {
    if (pool.stopped) return
    for (const { input, publish } of pool.subscribers.values()) {
      if (event.type === 'activity' && !input.scopes.includes(event.scope)) continue
      if (event.type === 'snapshot' && !this.covers(event.snapshot, input.tasks)) continue
      publish(event)
    }
  }
  private watch(pool: Pool) {
    const inputs = [...pool.subscribers.values()].map((item) => item.input)
    const tasks = new Set(inputs.flatMap((input) => input.tasks))
    const scopes = new Set(inputs.flatMap((input) => input.scopes))
    for (const [task, stop] of pool.tasks)
      if (!tasks.has(task)) {
        stop()
        pool.tasks.delete(task)
      }
    for (const task of tasks)
      if (!pool.tasks.has(task)) pool.tasks.set(task, watchRuntimeTask(pool.connection, task))
    for (const scope of scopes) {
      const detailed = inputs.some((input) => input.detailScopes.includes(scope))
      const existing = pool.scopes.get(scope)
      if (existing && existing.detailed === detailed) continue
      existing?.stop()
      pool.scopes.set(scope, {
        detailed,
        stop: watchRuntimeActivity(
          pool.connection,
          scope,
          (events) => {
            const event: DesktopSyncEvent = { type: 'activity', scope, events }
            pool.activities.set(scope, event)
            this.broadcast(pool, event)
          },
          detailed,
        ),
      })
    }
    for (const [scope, item] of pool.scopes)
      if (!scopes.has(scope)) {
        item.stop()
        pool.scopes.delete(scope)
        pool.activities.delete(scope)
      }
  }
  private poll(pool: Pool) {
    if (pool.stopped || pool.request) return
    clearTimeout(pool.timer)
    if (pool.live?.online()) {
      pool.timer = setTimeout(() => this.poll(pool), 1000)
      return
    }
    const controller = new AbortController()
    pool.request = controller
    const tasks = JSON.stringify([...pool.tasks.keys()].sort())
    let failed = false
    void this.request(pool.connection, runtimeSnapshotPath(pool.connection), controller.signal)
      .then((snapshot) => {
        if (
          pool.stopped ||
          tasks !== JSON.stringify([...pool.tasks.keys()].sort()) ||
          pool.live?.online()
        )
          return
        pool.reachable = true
        this.publishSnapshot(pool, snapshot)
      })
      .catch(async (error: unknown) => {
        failed = true
        if (pool.stopped || controller.signal.aborted || pool.live?.online()) return
        pool.reachable = false
        if (this.recover) {
          try {
            const latest = await this.recover(pool.connection)
            if (latest && !pool.stopped) {
              this.broadcast(pool, { type: 'connection', connection: latest })
              return
            }
          } catch (recoveryError) {
            this.broadcast(pool, {
              type: 'error',
              message:
                recoveryError instanceof Error
                  ? recoveryError.message
                  : 'Could not recover the local runtime.',
            })
            return
          }
        }
        if (!pool.stopped)
          this.broadcast(pool, {
            type: 'error',
            message: error instanceof Error ? error.message : 'Cannot reach this runtime.',
          })
      })
      .finally(() => {
        pool.request = undefined
        if (!pool.stopped)
          pool.timer = setTimeout(
            () => this.poll(pool),
            tasks !== JSON.stringify([...pool.tasks.keys()].sort()) ? 0 : failed ? 10000 : 1000,
          )
      })
  }
  refresh(id: string, retry: boolean) {
    const pool = this.subscriptions.get(id)
    if (!pool) return
    const subscriber = pool.subscribers.get(id)
    if (subscriber && pool.reachable) this.baseline(pool, subscriber)
    if (retry) pool.live?.retry()
    else pool.live?.refresh()
    this.poll(pool)
  }
  unsubscribe(id: string) {
    const pool = this.subscriptions.get(id)
    if (!pool) return
    this.subscriptions.delete(id)
    pool.subscribers.delete(id)
    if (pool.subscribers.size) {
      this.watch(pool)
      return
    }
    pool.stopped = true
    clearTimeout(pool.timer)
    pool.request?.abort()
    pool.live?.stop()
    for (const stop of pool.tasks.values()) stop()
    for (const item of pool.scopes.values()) item.stop()
    this.pools.delete(key(pool.connection))
  }
  dispose() {
    for (const id of this.subscriptions.keys()) this.unsubscribe(id)
  }
}
