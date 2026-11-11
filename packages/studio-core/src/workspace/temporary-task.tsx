import { useCallback, useRef, useState, type ReactNode } from 'react'
import { threadStartMessage, type Task } from '@dovo/protocol'
import { useWorkspace, type WorkspaceContextValue } from './context'
import { WorkspaceValueProvider } from './selector'

/** Keep an untouched startup composer out of workspace persistence. */
export function TemporaryTaskWorkspace({
  task,
  onCommit,
  children,
}: {
  task: Task
  onCommit: (task: Task) => void
  children: ReactNode
}) {
  const root = useWorkspace()
  const [draft, setDraft] = useState(task)
  const current = useRef(draft)
  const committed = useRef(false)
  const committedCallback = useRef(onCommit)
  committedCallback.current = onCommit
  // A command from an untouched startup view can create the thread with its message.
  const threadStart = useRef(false)
  threadStart.current = root.snapshot?.threadStartSupported === true
  const hosted = useRef(false)
  hosted.current = root.workspace.tasks.some((item) => item.id === task.id)
  // A retry of the same message must carry the same draft, even after the composer cleared it.
  const starts = useRef(new Map<string, Task>())
  // Other thread actions wait for an in-flight start rather than creating the thread twice.
  const starting = useRef<Promise<unknown> | null>(null)
  const { setWorkspace: rootSetWorkspace, flush: rootFlush, request: rootRequest } = root
  const commit = useCallback(() => {
    if (committed.current) return
    committed.current = true
    try {
      rootSetWorkspace((workspace) =>
        workspace.tasks.some((item) => item.id === current.current.id)
          ? workspace
          : { ...workspace, tasks: [current.current, ...workspace.tasks] },
      )
    } catch (error) {
      committed.current = false
      throw error
    }
    committedCallback.current(current.current)
  }, [rootSetWorkspace])
  // Sync publishes context updates after requests, including reads. Keep this identity
  // stable so newly mounted readers do not restart themselves after every publication.
  const request = useCallback<WorkspaceContextValue['request']>(
    async (path, input, schema, method) => {
      // Attachments and sending require a real task; catalogue and SCM reads do not.
      const needsTask =
        (path.startsWith('/api/tasks/') &&
          path !== '/api/tasks/title' &&
          path !== '/api/tasks/waiting' &&
          path !== '/api/tasks/dictation/cleanup') ||
        path.startsWith('/api/attachments/')
      if (needsTask && !committed.current && starting.current)
        await starting.current.catch(() => undefined)
      if (!committed.current && threadStart.current && path === '/api/tasks/message') {
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
          // The outbox journals this one command before sending it and projects the thread
          // until a snapshot contains it. No separate creation edit is queued.
          const sending = rootRequest(path, start, schema, method).then((result) => {
            if (!committed.current) {
              committed.current = true
              committedCallback.current(current.current)
            }
            return result
          })
          starting.current = sending
          return await sending.finally(() => {
            if (starting.current === sending) starting.current = null
          })
        }
      }
      if (needsTask) {
        commit()
        await rootFlush(current.current.id)
      }
      return rootRequest(path, input, schema, method)
    },
    [commit, rootFlush, rootRequest],
  )
  const setWorkspace: WorkspaceContextValue['setWorkspace'] = (update) => {
    if (committed.current) return root.setWorkspace(update)
    const workspace = {
      ...root.workspace,
      tasks: [current.current, ...root.workspace.tasks.filter((item) => item.id !== task.id)],
    }
    const next = typeof update === 'function' ? update(workspace) : update
    const updated = next.tasks.find((item) => item.id === task.id)
    if (!updated) return
    current.current = updated
    setDraft(updated)
    // Keep the established draft save. An unresolved combined start already owns its
    // durable creation, so typing or retrying must not enqueue another creation edit.
    if (updated.draft.trim() && !starting.current && !starts.current.size) commit()
  }
  const value: WorkspaceContextValue = {
    ...root,
    workspace: committed.current
      ? root.workspace
      : {
          ...root.workspace,
          // The outbox may already project this thread while its first message is in flight.
          tasks: [draft, ...root.workspace.tasks.filter((item) => item.id !== task.id)],
        },
    setWorkspace,
    flush: async (taskId) => {
      if (committed.current) await root.flush(taskId)
    },
    request,
  }
  return <WorkspaceValueProvider value={value}>{children}</WorkspaceValueProvider>
}
