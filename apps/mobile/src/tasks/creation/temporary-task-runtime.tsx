import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Effect, Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { decode, taskSchema, type Task } from '@dovo/protocol'
import { RuntimeContext, useRuntime } from '../../runtime/connection/provider'

const taskPatch = Schema.Struct({
  collection: Schema.Literal('tasks'),
  id: Schema.String,
  changes: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({ before: Schema.Unknown, after: Schema.Unknown }),
  }),
})
const revision = Schema.Struct({ revision: Schema.Number })

/** Configure a blank composer locally; create its task before the first send or attachment. */
export function TemporaryTaskRuntime({
  task,
  onCommit,
  children,
}: {
  task: Task
  onCommit: (task: Task) => void
  children: (task: Task) => ReactNode
}) {
  const runtime = useRuntime()
  const committedCallback = useRef(onCommit)
  committedCallback.current = onCommit
  const [draft, setDraft] = useState(task)
  const current = useRef(draft)
  const creation = useRef<Promise<unknown> | null>(null)
  const committed = useRef(false)
  const notified = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const { readEffect: rootRead, callEffect: rootCall } = runtime
  const requestEffect = useCallback<typeof runtime.readEffect>(
    (path, input, schema, method) =>
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
              path !== '/api/tasks/dictation/cleanup') ||
            path.startsWith('/api/attachments/')
          if (needsTask && !committed.current) {
            if (!creation.current)
              creation.current = runClientEffect(
                rootCall(
                  '/api/workspace',
                  { collection: 'tasks', id: task.id, create: current.current, changes: {} },
                  revision,
                  'PATCH',
                ),
              ).catch((error: unknown) => {
                creation.current = null
                throw error
              })
            await creation.current
            committed.current = true
          }
          const result = await runClientEffect(
            (needsTask || committed.current ? rootCall : rootRead)(path, input, schema, method),
          )
          if (committed.current && !notified.current && mounted.current) {
            notified.current = true
            committedCallback.current(current.current)
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
      {children(visibleTask)}
    </RuntimeContext.Provider>
  )
}
