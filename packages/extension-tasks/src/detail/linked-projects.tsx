import { useState } from 'react'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import { LinkedCheckoutEditor, Button } from '@dovo/studio-ui'
import type { LinkedCheckout } from '@dovo/protocol'

export function LinkedProjects({ task }: { task: Task }) {
  const { request, connected } = useWorkspace()
  const [links, setLinks] = useState<LinkedCheckout[]>(task.linkedCheckouts ?? [])
  const [before, setBefore] = useState(task.linkedCheckouts ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const disabled =
    !connected ||
    busy ||
    task.status === 'running' ||
    !!task.queue?.length ||
    !!task.delegation ||
    !!task.archivedAt
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await request('/api/tasks/checkouts/save', { id: task.id, before, links }, responses.ok)
      setBefore(links)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <LinkedCheckoutEditor value={links} onChange={setLinks} disabled={disabled} />
      <p className="text-xs text-muted-foreground">
        Removing a link keeps its worktree and saved history. Read-only links are reference context;
        the harness’s access mode still applies.
      </p>
      <Button
        size="sm"
        disabled={disabled || JSON.stringify(links) === JSON.stringify(before)}
        onClick={() => {
          void save()
        }}
      >
        Save linked projects
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
