import { liveActivityRefreshMs, liveActivityStaleMs, runtimeComputerName } from '@dovo/protocol'
import { nativeEffect, mobileWorkflow } from '../runtime/state/native-effect'
import { clientTaskScope } from '@dovo/client-runtime'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Schema, Effect } from 'effect'
import { liveTaskProps, liveActivityStatusSchema, type RuntimeOverview } from '@dovo/protocol'
import type { useRuntime } from '../runtime/connection/provider'
import TaskActivity from './task-activity'
const storageKey = 'dovo.live-activities.v1'
const recordSchema = mutableStruct({
  id: Schema.String,
  key: Schema.String,
  runtimeId: Schema.String,
  taskId: Schema.String,
  turnId: Schema.String,
})
const savedSchema = mutableStruct({
  records: mutableArray(recordSchema),
  seen: mutableArray(Schema.String),
})
type Record = Schema.Schema.Type<typeof recordSchema>
type Read = ReturnType<typeof useRuntime>['readRuntimeEffect']
export function createActivityController(onError: (message: string) => void) {
  return mobileWorkflow(function* () {
    // A record from an older build must not disable Live Activities until reinstall.
    const raw = yield* nativeEffect(() => AsyncStorage.getItem(storageKey))
    let parsed: unknown
    try {
      parsed = JSON.parse(raw ?? '{"records":[],"seen":[]}')
    } catch {
      parsed = undefined
    }
    const restored = decodeResult(savedSchema, parsed)
    if (!restored.success) yield* nativeEffect(() => AsyncStorage.removeItem(storageKey))
    const saved = restored.success ? restored.data : { records: [], seen: [] }
    let current: { overviews: RuntimeOverview[]; read: Read; enabled: boolean } | undefined
    let lastSaved = raw
    const seen = new Set(saved.seen)
    const records = new Map(saved.records.map((record) => [record.key, record]))
    const fingerprints = new Map<string, { value: string; at: number }>()
    const registered = new Map<string, string>()
    const registering = new Map<string, string>()
    const registrationLocks = new Map<string, Effect.Semaphore>()
    const tokens = new Map<string, string>()
    const retryAt = new Map<string, { key: string; at: number }>()
    const listeners = new Map<
      string,
      {
        remove(): void
      }
    >()
    let disposed = false
    const commands = clientTaskScope()
    const permit = yield* Effect.makeSemaphore(1)
    const persist = async () => {
      const value = JSON.stringify({ records: [...records.values()], seen: [...seen].slice(-200) })
      if (value === lastSaved) return
      await AsyncStorage.setItem(storageKey, value)
      lastSaved = value
    }
    function sync(overviews: RuntimeOverview[], read: Read, enabled: boolean) {
      return mobileWorkflow(function* () {
        if (disposed) return
        current = { overviews, read, enabled }
        const instances = new Map(
          TaskActivity.getInstances().map((instance) => [instance.getId(), instance]),
        )
        const remove = (record: Record) => {
          return Effect.sync(() => {
            const source = overviews.find((entry) => entry.profile.id === record.runtimeId)
            if (source?.connected) {
              const request = read(
                source.profile,
                '/api/live-activities/remove',
                { activityId: record.id },
                mutableStruct({ ok: Schema.Boolean }),
              ).pipe(
                Effect.catchAll(() =>
                  Effect.sync(() => {
                    if (!disposed)
                      onError(
                        'Could not remove the background registration. Local Live Activity updates remain available.',
                      )
                  }),
                ),
              )
              const lock = registrationLocks.get(record.id)
              void commands.run(lock ? lock.withPermits(1)(request) : request)
            }
            listeners.get(record.id)?.remove()
            listeners.delete(record.id)
            records.delete(record.key)
            registered.delete(record.id)
            registering.delete(record.id)
            registrationLocks.delete(record.id)
            tokens.delete(record.id)
            fingerprints.delete(record.id)
            retryAt.delete(record.id)
          })
        }
        for (const record of records.values()) {
          const instance = instances.get(record.id)
          const source = overviews.find((entry) => entry.profile.id === record.runtimeId)
          if (!instance) {
            yield* remove(record)
            continue
          }
          if (!enabled || !source) {
            if (!enabled) seen.delete(record.key)
            yield* nativeEffect(() => instance.end('immediate'))
            yield* remove(record)
            continue
          }
          if (!source.connected || !source.snapshot) continue // Keep last known state; staleDate de-emphasizes it.
          const task = source.snapshot.workspace.tasks.find((task) => task.id === record.taskId)
          if (
            !task ||
            task.status !== 'running' ||
            task.turns?.at(-1)?.id !== record.turnId ||
            task.archived
          ) {
            const props = task
              ? liveTaskProps(
                  task,
                  runtimeComputerName(source),
                  source.snapshot.workspace.repositories.find(
                    (repo) => repo.id === task.repositoryId,
                  )?.name ?? '',
                  false,
                  source.snapshot.workspace.tasks.filter(
                    (entry) => entry.status === 'running' && !entry.archived,
                  ).length,
                )
              : undefined
            if (props && (task?.status === 'running' || task?.archived)) {
              props.status = 'Stopped'
              props.activity = 'Thread stopped'
            }
            yield* nativeEffect(() => instance.end('default', props, new Date()))
            yield* remove(record)
          }
        }
        if (enabled)
          for (const source of overviews) {
            if (!source.connected || !source.snapshot) continue
            const snapshot = source.snapshot
            const needsInput = new Set(
              [...snapshot.questions, ...snapshot.approvals].map((item) => item.taskId),
            )
            const tasks = snapshot.workspace.tasks
              .filter((task) => task.status === 'running' && !task.archived && task.turns?.length)
              .sort((a, b) => Number(needsInput.has(b.id)) - Number(needsInput.has(a.id)))
            for (const task of tasks) {
              const turnId = task.turns!.at(-1)!.id
              const key = JSON.stringify([source.profile.id, task.id, turnId])
              const props = liveTaskProps(
                task,
                runtimeComputerName(source),
                snapshot.workspace.repositories.find((repo) => repo.id === task.repositoryId)
                  ?.name ?? '',
                needsInput.has(task.id),
                tasks.length,
              )
              let record = records.get(key)
              let instance = record ? instances.get(record.id) : undefined
              if (!record && !seen.has(key) && records.size < 3) {
                instance = TaskActivity.start(
                  props,
                  `dovo://thread/${encodeURIComponent(source.profile.id)}/${encodeURIComponent(task.id)}`,
                  new Date(Date.now() + liveActivityStaleMs),
                )
                record = {
                  id: instance.getId(),
                  key,
                  runtimeId: source.profile.id,
                  taskId: task.id,
                  turnId,
                }
                records.set(key, record)
                instances.set(record.id, instance)
                seen.add(key)
                yield* nativeEffect(() => persist())
              }
              if (!instance || !record) continue
              const fingerprint = JSON.stringify(props)
              const previous = fingerprints.get(record.id)
              if (
                previous?.value !== fingerprint ||
                Date.now() - previous.at >= liveActivityRefreshMs
              ) {
                yield* nativeEffect(() =>
                  instance.update(props, new Date(Date.now() + liveActivityStaleMs)),
                )
                fingerprints.set(record.id, { value: fingerprint, at: Date.now() })
              }
              const id = record.id
              let lock = registrationLocks.get(id)
              if (!lock) {
                lock = yield* Effect.makeSemaphore(1)
                registrationLocks.set(id, lock)
              }
              const registrationLock = lock
              const register = (token: string) => {
                return mobileWorkflow(function* () {
                  const source = current?.overviews.find(
                    (entry) => entry.profile.id === record?.runtimeId,
                  )
                  if (!current?.enabled || !source?.connected) return
                  const registrationKey = JSON.stringify([
                    source.profile.connection.address,
                    source.profile.connection.token,
                    token,
                  ])
                  const retry = retryAt.get(id)
                  if (
                    disposed ||
                    !records.has(key) ||
                    tokens.get(id) !== token ||
                    registered.get(id) === registrationKey ||
                    (retry?.key === registrationKey && retry.at > Date.now())
                  )
                    return
                  registering.set(id, registrationKey)
                  retryAt.set(id, { key: registrationKey, at: Date.now() + 60_000 })
                  const status = yield* current.read(
                    source.profile,
                    '/api/live-activities/register',
                    {
                      activityId: id,
                      taskId: task.id,
                      turnId,
                      pushToken: token,
                    },
                    liveActivityStatusSchema,
                  )
                  if (disposed || !records.has(key) || registering.get(id) !== registrationKey)
                    return
                  if (status.configured && !status.error) registered.set(id, registrationKey)
                  if (!status.configured)
                    onError(
                      'Background Live Activities need APNs setup on the task’s computer. See docs/releases-and-updates.md.',
                    )
                  else if (status.error) onError(status.error)
                })
              }
              const scheduleRegistration = (token: string) => {
                tokens.set(id, token)
                void commands.run(
                  registrationLock
                    .withPermits(1)(register(token))
                    .pipe(
                      Effect.catchAll(() =>
                        Effect.sync(() => {
                          if (!disposed)
                            onError(
                              'Could not register background updates. Reconnect to the task’s computer.',
                            )
                        }),
                      ),
                    ),
                )
              }
              if (!listeners.has(id))
                listeners.set(
                  id,
                  instance.addPushTokenListener((event) => {
                    registered.delete(id)
                    retryAt.delete(id)
                    scheduleRegistration(event.pushToken)
                  }),
                )
              const token = yield* nativeEffect(() => instance.getPushToken())
              if (token) scheduleRegistration(token)
            }
          }
        yield* nativeEffect(() => persist())
      })
    }
    return {
      sync: (overviews: RuntimeOverview[], read: Read, enabled: boolean) =>
        permit.withPermits(1)(sync(overviews, read, enabled)),
      dispose() {
        disposed = true
        for (const listener of listeners.values()) listener.remove()
        return commands.stop()
      },
    }
  })
}
