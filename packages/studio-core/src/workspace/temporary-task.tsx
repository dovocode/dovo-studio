import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { Task } from '@dovo/protocol'
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
  const { setWorkspace: rootSetWorkspace, flush: rootFlush, request: rootRequest } = root
  const commit = useCallback(() => {
    if (committed.current) return
    committed.current = true
    rootSetWorkspace((workspace) => ({
      ...workspace,
      tasks: [current.current, ...workspace.tasks],
    }))
    committedCallback.current(current.current)
  }, [rootSetWorkspace])
  // Sync publishes context updates after requests, including reads. Keep this identity
  // stable so newly mounted readers do not restart themselves after every publication.
  const request = useCallback<WorkspaceContextValue['request']>(
    async (path, input, schema, method) => {
      // Attachments and sending require a real task; catalogue and SCM reads do not.
      if (
        (path.startsWith('/api/tasks/') && path !== '/api/tasks/title') ||
        path.startsWith('/api/attachments/')
      ) {
        commit()
        await rootFlush()
      }
      return rootRequest(path, input, schema, method)
    },
    [commit, rootFlush, rootRequest],
  )
  const setWorkspace: WorkspaceContextValue['setWorkspace'] = (update) => {
    if (committed.current) return root.setWorkspace(update)
    const workspace = { ...root.workspace, tasks: [current.current, ...root.workspace.tasks] }
    const next = typeof update === 'function' ? update(workspace) : update
    const updated = next.tasks.find((item) => item.id === task.id)
    if (!updated) return
    current.current = updated
    setDraft(updated)
    if (updated.draft.trim()) commit()
  }
  const value: WorkspaceContextValue = {
    ...root,
    workspace: committed.current
      ? root.workspace
      : { ...root.workspace, tasks: [draft, ...root.workspace.tasks] },
    setWorkspace,
    flush: async () => {
      if (committed.current) await root.flush()
    },
    request,
  }
  return <WorkspaceValueProvider value={value}>{children}</WorkspaceValueProvider>
}
