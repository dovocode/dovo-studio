import { useCallback, useEffect, useState } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { responses, useWorkspace } from '@dovo/studio-core'
import { worktreeListSchema, type WorktreeList } from '@dovo/protocol'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@dovo/studio-ui'
import { HostPage } from './host-page'
import { WorktreePreferences } from './runtime-preferences'

export default function WorktreesView({ entityId }: { entityId?: string }) {
  const [revision, setRevision] = useState(0)
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Worktrees"
      description="Manage task checkouts, branch names and cleanup on this computer."
    >
      <div className="space-y-5">
        <WorktreePreferences onSaved={() => setRevision((value) => value + 1)} />
        <WorktreeList revision={revision} />
      </div>
    </HostPage>
  )
}

const stateLabels = {
  active: 'In use',
  archived: 'Task archived',
  missing: 'Orphaned',
} as const

function WorktreeList({ revision }: { revision: number }) {
  const { request, connected } = useWorkspace()
  const [list, setList] = useApplicationState<WorktreeList | null>(null)
  const [orphanedOnly, setOrphanedOnly] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState('')
  const [removal, setRemoval] = useApplicationState<string[]>([])
  const [error, setError] = useApplicationState('')
  const load = useCallback(
    async (clearError = true) => {
      if (clearError) setError('')
      try {
        setList(await request('/api/scm/worktrees/read', {}, worktreeListSchema))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [request],
  )
  useEffect(() => {
    if (connected) void load()
  }, [connected, load, revision])
  const visible = (list?.worktrees ?? []).filter(
    (item) => !orphanedOnly || item.state === 'missing',
  )
  const removable = visible.filter((item) => item.state !== 'active' && !item.dirty)
  const remove = async (paths: string[]) => {
    setError('')
    for (const path of paths) {
      setBusy(path)
      try {
        await request('/api/scm/worktrees/remove', { path, orphanOnly: orphanedOnly }, responses.ok)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        break
      }
    }
    setBusy('')
    await load(false)
  }
  if (!list)
    return (
      <p
        role={error ? 'alert' : 'status'}
        className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
      >
        {error || (connected ? 'Loading worktrees…' : 'Reconnect this computer to list worktrees.')}
      </p>
    )
  const groups = [
    ['Can be removed', visible.filter((item) => removable.includes(item))],
    ['In use or changed', visible.filter((item) => !removable.includes(item))],
  ] as const
  return (
    <section className="space-y-5" aria-label="Task worktrees">
      <div>
        <h2 className="text-sm font-semibold">Task worktrees</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Only unused, clean Dovo checkouts can be removed. Branches are kept; ignored local files
          are deleted.
        </p>
      </div>
      {!connected && (
        <p role="status" className="text-xs text-muted-foreground">
          Offline · Showing saved worktrees. Reconnect this computer to remove them.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {visible.length} worktree{visible.length === 1 ? '' : 's'}. New worktrees use{' '}
          <code className="font-mono">{list.root}</code>
          {list.rootSource ? ` (${list.rootSource})` : ''}
        </p>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={orphanedOnly}
            onCheckedChange={(checked) => setOrphanedOnly(checked === true)}
          />
          Show orphaned only
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!removable.length || !!busy || !connected}
          onClick={() => setRemoval(removable.map((item) => item.path))}
        >
          {orphanedOnly ? 'Remove clean orphans' : 'Remove unused clean worktrees'} (
          {removable.length})
        </Button>
      </div>
      <Dialog
        open={removal.length > 0}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoval([])
        }}
      >
        <DialogContent>
          <DialogTitle>
            Remove {removal.length} worktree{removal.length === 1 ? '' : 's'}?
          </DialogTitle>
          <DialogDescription>
            Only unused, clean Dovo checkouts are removed. Branches are kept. Ignored local files in
            these checkouts are deleted.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" disabled={!!busy} onClick={() => setRemoval([])}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!!busy || !connected}
              onClick={() => {
                void remove(removal).then(() => setRemoval([]))
              }}
            >
              {busy ? 'Removing…' : 'Remove worktrees'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!visible.length && (
        <p className="text-sm text-muted-foreground">
          {orphanedOnly
            ? 'No orphaned worktrees on this computer.'
            : 'No task worktrees on this computer.'}
        </p>
      )}
      {groups.map(([title, items]) =>
        items.length ? (
          <section key={title} className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
            <ul className="divide-y rounded-lg border">
              {items.map((item) => (
                <li key={item.path} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">
                      {item.taskTitle ?? item.branch}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.repositoryName} · {item.branch} · {stateLabels[item.state]}
                      {item.dirty ? ' · Uncommitted changes' : ''}
                      {item.prunable ? ' · Checkout directory missing' : ''}
                      {item.retainedLocation ? ' · Retained previous location' : ''}
                    </p>
                    <p
                      title={item.path}
                      className="truncate font-mono text-[0.6875rem] text-muted-foreground"
                    >
                      {item.path}
                    </p>
                  </div>
                  {removable.includes(item) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!busy || !connected}
                      aria-label={`Remove ${item.taskTitle ?? item.branch}`}
                      onClick={() => setRemoval([item.path])}
                    >
                      {busy === item.path ? 'Removing…' : 'Remove'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </section>
  )
}
