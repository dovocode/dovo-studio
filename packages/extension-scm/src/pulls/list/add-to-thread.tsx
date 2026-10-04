import { runtimeComputerName } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace } from '@dovo/studio-core'
import { responses, type PullSummary } from '@dovo/protocol'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Input,
} from '@dovo/studio-ui'

export function AddPullsToThread({
  pulls,
  onClose,
}: {
  pulls: PullSummary[]
  onClose: () => void
}) {
  const { runtimes, activeRuntimeId, workspace, readRuntime, refreshRuntime } = useWorkspace()
  const [search, setSearch] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const threads = runtimes
    .flatMap((runtime) => {
      const data = runtime.profile.id === activeRuntimeId ? workspace : runtime.snapshot?.workspace
      return (data?.tasks ?? [])
        .filter((task) => !task.example && !task.archivedAt)
        .map((task) => ({
          task,
          runtime,
          project:
            data?.repositories.find((repo) => repo.id === task.repositoryId)?.name ?? 'No project',
        }))
    })
    .filter(({ task, runtime, project }) =>
      `${task.title} ${project} ${runtimeComputerName(runtime)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
  const add = async (thread: (typeof threads)[number]) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await readRuntime(
        thread.runtime.profile,
        '/api/scm/pulls/link-thread',
        {
          id: thread.task.id,
          pulls: pulls.map((pull) => ({
            number: pull.number,
            url: pull.url,
            title: pull.title,
            provider: pull.provider ?? 'github',
            repositoryUrl: pull.url.replace(
              /\/(?:-\/)?(?:pull|pulls|pull-requests|pullrequest|merge_requests)\/\d+\/?(?:[?#].*)?$/i,
              '',
            ),
          })),
        },
        responses.ok,
      )
      await refreshRuntime(thread.runtime.profile)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
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
      <DialogContent className="max-w-lg">
        <DialogTitle>Add {pulls.length === 1 ? 'PR' : `${pulls.length} PRs`} to thread</DialogTitle>
        <DialogDescription>
          Choose a thread on any computer. Its checkout stays the same.
        </DialogDescription>
        <Input
          aria-label="Search threads to link"
          placeholder="Search threads, projects or computers…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="max-h-[50dvh] space-y-1 overflow-y-auto">
          {threads.map((thread) => (
            <Button
              key={JSON.stringify([thread.runtime.profile.id, thread.task.id])}
              variant="ghost"
              className="h-auto w-full justify-start py-3 text-left"
              disabled={busy || !thread.runtime.connected}
              onClick={() => void add(thread)}
            >
              <span className="min-w-0">
                <span className="block truncate">{thread.task.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {thread.project} · {runtimeComputerName(thread.runtime)}
                  {thread.runtime.connected ? '' : ' · Offline'}
                </span>
              </span>
            </Button>
          ))}
          {!threads.length && <p className="text-xs text-muted-foreground">No matching threads.</p>}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
