import { useRef, useState, type ReactNode } from 'react'
import type { Task } from '@dovo/protocol'
import { WorkspaceContext, useWorkspace, type WorkspaceContextValue } from './context'

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
  const commit = () => {
    if (committed.current) return
    committed.current = true
    root.setWorkspace((workspace) => ({
      ...workspace,
      tasks: [current.current, ...workspace.tasks],
    }))
    onCommit(current.current)
  }
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
    request: async (path, input, schema, method) => {
      // Attachments and sending require a real task; catalogue and SCM reads do not.
      if (
        (path.startsWith('/api/tasks/') && path !== '/api/tasks/title') ||
        path.startsWith('/api/attachments/')
      ) {
        commit()
        await root.flush()
      }
      return root.request(path, input, schema, method)
    },
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
