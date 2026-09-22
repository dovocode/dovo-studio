import { useState } from 'react'
import { pullTaskResponse, useStudioHost, useWorkspace, type PullDetail } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dovo/studio-ui'
export function StartPullTask({
  repositoryId,
  initialObjective,
  pull,
  onClose,
}: {
  initialObjective?: string
  repositoryId: string
  pull: PullDetail['pull']
  onClose: () => void
}) {
  const { request, connected } = useWorkspace(),
    host = useStudioHost()
  const objective =
    initialObjective ??
    'Review this PR for correctness, regressions, and missing tests. Report concrete findings without changing files.'
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const create = async () => {
    if (busy || !connected) return
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/scm/pulls/task',
        { repositoryId, number: pull.number, headSha: pull.headSha, objective, run: false },
        pullTaskResponse,
      )
      host.navigate({ viewId: 'tasks', entityId: result.id })
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Task from PR #{pull.number}</DialogTitle>
          <DialogDescription>
            Open a draft with the PR description and review feedback. Choose a model or custom agent
            and edit the message in chat before sending.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 rounded-lg border border-border/60 bg-muted/20 p-3">
          <p className="text-sm font-medium">{pull.title}</p>
          <p className="text-xs text-muted-foreground">
            {pull.head} → {pull.base} · Worktree at {pull.headSha.slice(0, 8)}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={busy || !connected} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Open draft'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
