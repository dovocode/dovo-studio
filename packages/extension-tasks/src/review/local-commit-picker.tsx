import { useEffect, useState } from 'react'
import { useWorkspace, responses } from '@dovo/studio-core'
import type { LocalCommit } from '@dovo/protocol'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@dovo/studio-ui'

export function LocalCommitPicker({
  taskId,
  checkoutId,
  disabled,
  onSelect,
}: {
  taskId: string
  checkoutId?: string
  disabled?: boolean
  onSelect: (commit: LocalCommit) => void
}) {
  const { request, connected, activeRuntimeId, connection } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState<string>()
  const [retry, setRetry] = useState(0)
  const owner = JSON.stringify([
    activeRuntimeId,
    connection?.address,
    connection?.token,
    taskId,
    checkoutId,
    cursor,
    retry,
  ])
  const [result, setResult] = useState<{
    key: string
    commits: LocalCommit[]
    hasMore: boolean
    error: string
  }>()
  const current = result?.key === owner ? result : undefined
  useEffect(() => {
    if (!open || !connected) return
    let active = true
    void request(
      '/api/tasks/commits/read',
      { id: taskId, checkoutId, sha: cursor },
      responses.localCommits,
    ).then(
      (page) => {
        if (active) setResult({ ...page, key: owner, error: '' })
      },
      (error: unknown) => {
        if (active)
          setResult({
            key: owner,
            commits: [],
            hasMore: false,
            error: error instanceof Error ? error.message : String(error),
          })
      },
    )
    return () => {
      active = false
    }
  }, [open, connected, request, owner, taskId, checkoutId, cursor])
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled || !connected}
        onClick={() => {
          setCursor(undefined)
          setRetry((value) => value + 1)
          setOpen(true)
        }}
      >
        Local commits
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[80dvh] flex-col">
          <DialogTitle>Review a local commit</DialogTitle>
          <DialogDescription>
            Changes against the first parent. Merge commits use their first parent.
          </DialogDescription>
          <div className="min-h-0 space-y-1 overflow-y-auto">
            {current?.error ? (
              <div>
                <p role="alert" className="text-xs text-destructive">
                  {current.error}
                </p>
                <Button size="sm" onClick={() => setRetry((value) => value + 1)}>
                  Retry commit list
                </Button>
              </div>
            ) : !current ? (
              <p role="status">Loading commits…</p>
            ) : !current.commits.length ? (
              <p>No commits in this checkout.</p>
            ) : (
              current.commits.map((commit) => (
                <button
                  key={commit.sha}
                  type="button"
                  className="flex w-full flex-col gap-1 rounded-md p-2 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    onSelect(commit)
                    setOpen(false)
                  }}
                >
                  <span className="break-words font-medium">
                    {commit.subject || '(no subject)'}
                  </span>
                  <span className="text-muted-foreground">
                    {commit.sha.slice(0, 8)} · {commit.author} ·{' '}
                    {new Date(commit.date).toLocaleDateString()}
                  </span>
                </button>
              ))
            )}
          </div>
          {current?.hasMore && current.commits.at(-1)?.parents[0] && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCursor(current.commits.at(-1)?.parents[0])}
            >
              Older commits
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
