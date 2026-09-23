import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { clientTaskScope } from '@dovo/client-runtime'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Schema, Effect } from 'effect'
import { liveTaskProps, liveActivityStatusSchema, type RuntimeOverview } from '@dovo/protocol'
import type { useRuntime } from '../runtime/provider'
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
    const saved = decode(
      savedSchema,
      JSON.parse(
        (yield* nativeEffect(() => AsyncStorage.getItem(storageKey))) ?? '{"records":[],"seen":[]}',
      ),
    )
    const seen = new Set(saved.seen)
    const records = new Map(saved.records.map((record) => [record.key, record]))
    const fingerprints = new Map<string, string>()
    const registered = new Map<string, string>()
    const retryAt = new Map<string, number>()
    const listeners = new Map<
      string,
      {
        remove(): void
      }
    >()
    let disposed = false
    const commands = clientTaskScope()
    const permit = yield* Effect.makeSemaphore(1)
    const persist = () =>
      AsyncStorage.setItem(
        storageKey,
        JSON.stringify({
          records: [...records.values()],
          seen: [...seen].slice(-200),
        }),
      )
    function sync(overviews: RuntimeOverview[], read: Read, enabled: boolean) {
      return mobileWorkflow(function* () {
        if (disposed) return
        const instances = new Map(
          TaskActivity.getInstances().map((instance) => [instance.getId(), instance]),
        )
        const remove = (record: Record) => {
          return mobileWorkflow(function* () {
            const source = overviews.find((entry) => entry.profile.id === record.runtimeId)
            if (source?.connected)
              yield* read(
                source.profile,
                '/api/live-activities/remove',
                {
                  activityId: record.id,
                },
                mutableStruct({
                  ok: Schema.Boolean,
                }),
              )
            listeners.get(record.id)?.remove()
            listeners.delete(record.id)
            records.delete(record.key)
            registered.delete(record.id)
            fingerprints.delete(record.id)
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
                  source.snapshot.runtimeHost ?? source.profile.name,
                  source.snapshot.workspace.repositories.find(
                    (repo) => repo.id === task.repositoryId,
                  )?.name ?? '',
                  false,
                )
              : undefined
            if (props && (task?.status === 'running' || task?.archived)) props.status = 'Stopped'
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
                snapshot.runtimeHost ?? source.profile.name,
                snapshot.workspace.repositories.find((repo) => repo.id === task.repositoryId)
                  ?.name ?? '',
                needsInput.has(task.id),
              )
              let record = records.get(key)
              let instance = record ? instances.get(record.id) : undefined
              if (!record && !seen.has(key) && records.size < 3) {
                instance = TaskActivity.start(
                  props,
                  `dovo://thread/${encodeURIComponent(source.profile.id)}/${encodeURIComponent(task.id)}`,
                  new Date(Date.now() + 120_000),
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
              const fingerprint = `${JSON.stringify(props)}:${Math.floor(Date.now() / 60_000)}`
              if (fingerprints.get(record.id) !== fingerprint) {
                yield* nativeEffect(() => instance.update(props, new Date(Date.now() + 120_000)))
                fingerprints.set(record.id, fingerprint)
              }
              const id = record.id
              const register = (token: string) => {
                return mobileWorkflow(function* () {
                  if (
                    disposed ||
                    !records.has(key) ||
                    registered.get(id) === token ||
                    (retryAt.get(id) ?? 0) > Date.now()
                  )
                    return
                  retryAt.set(id, Date.now() + 60_000)
                  const status = yield* read(
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
                  registered.set(id, token)
                  if (!status.configured)
                    onError(
                      'Background Live Activities need APNs setup on the task’s computer. See docs/releases-and-updates.md.',
                    )
                  else if (status.error) onError(status.error)
                })
              }
              if (!listeners.has(id))
                listeners.set(
                  id,
                  instance.addPushTokenListener((event) => {
                    registered.delete(id)
                    retryAt.delete(id)
                    void commands.run(
                      permit
                        .withPermits(1)(register(event.pushToken))
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
                  }),
                )
              const token = yield* nativeEffect(() => instance.getPushToken())
              if (token) yield* register(token)
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
