import { useCallback, useEffect } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { responses, useWorkspace } from '@dovo/studio-core'
import { worktreeListSchema, type WorktreeList } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'
import { HostPage } from './host-page'
import { ArchivedWorktreeCleanup } from './runtime-preferences'

export default function WorktreesView() {
  return (
    <HostPage
      title="Worktrees"
      description="Separate checkouts Dovo created for tasks. Remove the ones you no longer need; branches are always kept."
    >
      <div className="space-y-5">
        <ArchivedWorktreeCleanup />
        <WorktreeList />
      </div>
    </HostPage>
  )
}

const stateLabels = {
  active: 'In use',
  archived: 'Task archived',
  missing: 'Task deleted',
} as const

function WorktreeList() {
  const { request, connected } = useWorkspace()
  const [list, setList] = useApplicationState<WorktreeList | null>(null)
  const [busy, setBusy] = useApplicationState('')
  const [error, setError] = useApplicationState('')
  const load = useCallback(async () => {
    setError('')
    try {
      setList(await request('/api/scm/worktrees/read', {}, worktreeListSchema))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [request])
  useEffect(() => {
    if (connected) void load()
  }, [connected, load])
  const removable = (list?.worktrees ?? []).filter((item) => item.state !== 'active' && !item.dirty)
  const remove = async (paths: string[]) => {
    setError('')
    for (const path of paths) {
      setBusy(path)
      try {
        await request('/api/scm/worktrees/remove', { path }, responses.ok)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        break
      }
    }
    setBusy('')
    await load()
  }
  if (!list) return <p className="text-xs text-muted-foreground">{error || 'Loading worktrees…'}</p>
  const groups = [
    ['Can be removed', list.worktrees.filter((item) => removable.includes(item))],
    ['In use or changed', list.worktrees.filter((item) => !removable.includes(item))],
  ] as const
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {list.worktrees.length} worktree{list.worktrees.length === 1 ? '' : 's'} in{' '}
          <code className="font-mono">{list.root}</code>
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={!removable.length || !!busy || !connected}
          onClick={() => {
            if (
              window.confirm(
                `Remove ${removable.length} unused worktree${removable.length === 1 ? '' : 's'}? Their branches are kept.`,
              )
            )
              void remove(removable.map((item) => item.path))
          }}
        >
          Remove all unused ({removable.length})
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!list.worktrees.length && (
        <p className="text-sm text-muted-foreground">No task worktrees on this computer.</p>
      )}
      {groups.map(([title, items]) =>
        items.length ? (
          <section key={title} className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
            <ul className="divide-y rounded-lg border">
              {items.map((item) => (
                <li key={item.path} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{item.taskTitle ?? item.branch}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.repositoryName} · {item.branch} · {stateLabels[item.state]}
                      {item.dirty ? ' · Uncommitted changes' : ''}
                    </p>
                    <p className="truncate font-mono text-[0.6875rem] text-muted-foreground/80">
                      {item.path}
                    </p>
                  </div>
                  {removable.includes(item) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!busy || !connected}
                      onClick={() => void remove([item.path])}
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
    </div>
  )
}
