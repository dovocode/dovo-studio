import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Effect, Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { decode, taskSchema, threadStartMessage, type Task } from '@dovo/protocol'
import { RuntimeContext, useRuntime } from '../../runtime/connection/provider'

const taskPatch = Schema.Struct({
  collection: Schema.Literal('tasks'),
  id: Schema.String,
  changes: Schema.Record(
    Schema.String,
    Schema.Struct({ before: Schema.Unknown, after: Schema.Unknown }),
  ),
})
const revision = Schema.Struct({ revision: Schema.Number })

/** Configure a blank composer locally; create its task before the first send or attachment.
 * Runtimes with `threadStartSupported` create it with the first message in one request. */
export function TemporaryTaskRuntime({
  task,
  onCommit,
  children,
}: {
  task: Task
  onCommit: (task: Task) => void | false
  children: (task: Task, temporary: boolean) => ReactNode
}) {
  const runtime = useRuntime()
  const committedCallback = useRef(onCommit)
  committedCallback.current = onCommit
  const [draft, setDraft] = useState(task)
  const current = useRef(draft)
  const creation = useRef<Promise<unknown> | null>(null)
  const [temporary, setTemporary] = useState(
    () => !runtime.snapshot?.workspace.tasks.some((item) => item.id === task.id),
  )
  const committed = useRef(!temporary)
  const notified = useRef(false)
  const threadStart = useRef(false)
  threadStart.current = runtime.snapshot?.threadStartSupported === true
  const hosted = useRef(false)
  hosted.current = !!runtime.snapshot?.workspace.tasks.some((item) => item.id === task.id)
  // A retry of the same message must carry the same draft, even after the composer cleared it.
  const starts = useRef(new Map<string, Task>())
  // Other thread actions wait for an in-flight start rather than creating the thread twice.
  const starting = useRef<Promise<unknown> | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const { readEffect: rootRead, callEffect: rootCall } = runtime
  const requestEffect = useCallback<typeof runtime.readEffect>(
    (path, input, schema, method, options) =>
      Effect.tryPromise({
        try: async () => {
          if (!committed.current && path === '/api/workspace' && method === 'PATCH') {
            const patch = decode(taskPatch, input)
            if (patch.id !== task.id) throw new Error('Cannot update another temporary thread.')
            const fields = Object.fromEntries(
              Object.entries(patch.changes).map(([field, value]) => [
                field,
                value.after === null ? undefined : value.after,
              ]),
            )
            const updated = decode(taskSchema, { ...current.current, ...fields })
            current.current = updated
            setDraft(updated)
            return decode(schema, { revision: 0 })
          }
          const needsTask =
            (path.startsWith('/api/tasks/') &&
              path !== '/api/tasks/title' &&
              path !== '/api/tasks/waiting' &&
              path !== '/api/tasks/dictation/cleanup') ||
            path.startsWith('/api/attachments/')
          if (needsTask && !committed.current && starting.current)
            await starting.current.catch(() => undefined)
          if (
            !committed.current &&
            !creation.current &&
            threadStart.current &&
            path === '/api/tasks/message'
          ) {
            const id =
              input !== null && typeof input === 'object' && 'messageId' in input
                ? String(input.messageId)
                : ''
            const previous = starts.current.get(id)
            // A thread already on the runtime only starts here when retrying this same message.
            const start =
              previous || !hosted.current
                ? threadStartMessage(input, previous ?? current.current)
                : undefined
            if (start) {
              starts.current.set(id, start.createTask)
              // A deferred send returns after durable local admission; the outbox then
              // projects the thread until a snapshot contains it.
              const sending = runClientEffect(rootCall(path, start, schema, method, options)).then(
                (result) => {
                  committed.current = true
                  current.current = start.createTask
                  if (mounted.current) {
                    setDraft(start.createTask)
                    setTemporary(false)
                    notified.current = committedCallback.current(current.current) !== false
                  }
                  return result
                },
              )
              starting.current = sending
              return await sending.finally(() => {
                if (starting.current === sending) starting.current = null
              })
            }
          }
          if (needsTask && !committed.current) {
            if (!creation.current)
              creation.current = runClientEffect(
                rootCall(
                  '/api/workspace',
                  { collection: 'tasks', id: task.id, create: current.current, changes: {} },
                  revision,
                  'PATCH',
                  options,
                ),
              ).catch((error: unknown) => {
                creation.current = null
                throw error
              })
            await creation.current
            committed.current = true
            if (mounted.current) setTemporary(false)
          }
          const result = await runClientEffect(
            (needsTask || committed.current ? rootCall : rootRead)(
              path,
              input,
              schema,
              method,
              options,
            ),
          )
          // Background watcher reads must not finalize a draft after a failed first action.
          if (
            path !== '/api/tasks/waiting' &&
            committed.current &&
            !notified.current &&
            mounted.current
          ) {
            notified.current = committedCallback.current(current.current) !== false
          }
          return result
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    [task.id, rootRead, rootCall],
  )
  const request = useCallback<typeof runtime.read>(
    (...args) => runClientEffect(requestEffect(...args)),
    [requestEffect],
  )
  const visibleTask = committed.current
    ? (runtime.snapshot?.workspace.tasks.find((item) => item.id === task.id) ?? draft)
    : draft
  return (
    <RuntimeContext.Provider
      value={{
        ...runtime,
        snapshot: runtime.snapshot
          ? {
              ...runtime.snapshot,
              workspace: {
                ...runtime.snapshot.workspace,
                tasks: [
                  visibleTask,
                  ...runtime.snapshot.workspace.tasks.filter((item) => item.id !== task.id),
                ],
              },
            }
          : null,
        readEffect: requestEffect,
        callEffect: requestEffect,
        read: request,
        call: request,
      }}
    >
      {children(visibleTask, temporary)}
    </RuntimeContext.Provider>
  )
}
