import { useState } from 'react'
import {
  ArrowUpRight,
  Circle,
  GitBranch,
  GitPullRequest,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Pin,
} from 'lucide-react'
import {
  aggregateRuntimeTasks,
  compareTasks,
  taskSortOptions,
  useStudioHost,
  useWorkspace,
} from '@dovo/studio-core'
import { Button, ChoicePicker, IconButton, Input, cn } from '@dovo/studio-ui'
export function RuntimeOverview() {
  const { runtimes, refreshRuntimes, switchRuntime } = useWorkspace()
  const host = useStudioHost()
  const [device, setDevice] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('active'),
    [sort, setSort] = useState('priority'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const visible = runtimes.filter((entry) => !device || entry.profile.id === device)
  const allTasks = aggregateRuntimeTasks(visible)
  const needsInput = new Set(allTasks.filter((entry) => entry.needsInput).map((entry) => entry.key))
  const projects = new Map(
    allTasks.map((entry) => [`${entry.runtimeId}:${entry.task.repositoryId}`, entry.projectName]),
  )
  const partialPulls = visible.some(
    (entry) => !entry.pulls || entry.pulls.partial || entry.pullError || !entry.connected,
  )
  const pullCount = visible.some((entry) => entry.pulls)
    ? `${visible.reduce((sum, entry) => sum + (entry.pulls?.needsAttention ?? 0), 0)}${partialPulls ? '+' : ''}`
    : '—'
  const tasks = allTasks
    .filter(
      (entry) =>
        (filter !== 'input' || entry.needsInput) &&
        (filter !== 'running' || entry.task.status === 'running') &&
        [entry.task.title, entry.projectName, entry.runtimeName, entry.task.checkoutBranch ?? '']
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      compareTasks(
        { ...a.task, id: a.key, repositoryId: `${a.runtimeId}:${a.task.repositoryId}` },
        { ...b.task, id: b.key, repositoryId: `${b.runtimeId}:${b.task.repositoryId}` },
        sort,
        needsInput,
        projects,
      ),
    )
  const open = async (runtimeId: string, viewId: string, entityId?: string) => {
    setBusy(true)
    setError('')
    try {
      await switchRuntime(runtimeId)
      host.navigate({ viewId, entityId })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="All devices overview">
      <header className="flex min-h-14 flex-wrap items-center gap-3 border-b px-5 py-3">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Needs attention, current work and recent outcomes.
          </p>
        </div>
        {runtimes.length > 1 && (
          <div role="group" aria-label="Filter devices" className="flex max-w-full flex-wrap gap-1">
            <Button
              size="sm"
              variant={!device ? 'secondary' : 'ghost'}
              aria-pressed={!device}
              onClick={() => setDevice('')}
            >
              All devices
            </Button>
            {runtimes.map((entry) => (
              <Button
                key={entry.profile.id}
                size="sm"
                variant={device === entry.profile.id ? 'secondary' : 'ghost'}
                aria-pressed={device === entry.profile.id}
                onClick={() => setDevice(entry.profile.id)}
              >
                {entry.snapshot?.runtimeHost || entry.profile.name}
              </Button>
            ))}
          </div>
        )}
        <IconButton
          label="Refresh devices"
          disabled={busy}
          className="size-8"
          onClick={() => {
            setBusy(true)
            void refreshRuntimes()
              .catch((error) => setError(String(error)))
              .finally(() => setBusy(false))
          }}
        >
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
        </IconButton>
        <Button variant="outline" size="sm" onClick={() => host.navigate({ viewId: 'runtime' })}>
          <Plus size={14} className="mr-1" />
          Connect computer
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-6xl space-y-6">
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </p>
          )}
          {!runtimes.length && (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <Monitor className="mx-auto mb-3 size-7 text-muted-foreground" />
              <h2 className="text-sm font-medium">Connect your first computer</h2>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                Pair a desktop or remote runtime to bring its projects, conversations, and pull
                requests into one place.
              </p>
              <Button
                className="mt-4"
                size="sm"
                onClick={() => host.navigate({ viewId: 'runtime' })}
              >
                Connect computer
              </Button>
            </div>
          )}
          {!!visible.length && (
            <>
              <section aria-label="Tasks across devices" className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="mr-auto text-sm font-medium">
                    Tasks <span className="ml-1 text-muted-foreground">{tasks.length}</span>
                  </h2>
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      aria-label="Search all devices"
                      className="h-8 w-full max-w-64 pl-8 text-xs"
                      placeholder="Search threads, projects, devices…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                  <ChoicePicker
                    aria-label="Overview thread sort"
                    value={sort}
                    onValueChange={setSort}
                    className="h-8 w-auto min-w-36 shrink-0 rounded-md border px-2 text-xs"
                  >
                    {taskSortOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </ChoicePicker>
                  <ChoicePicker
                    aria-label="Overview task filter"
                    value={filter}
                    onValueChange={setFilter}
                    className="h-8 w-auto min-w-36 shrink-0 rounded-md border px-2 text-xs"
                  >
                    <option value="active">Active threads</option>
                    <option value="input">Needs input</option>
                    <option value="running">Working</option>
                  </ChoicePicker>
                </div>
                <div className="overflow-hidden divide-y border-y">
                  {tasks.map((entry) => (
                    <Button
                      key={entry.key}
                      variant="ghost"
                      disabled={busy || !entry.online}
                      aria-label={`Open ${entry.task.title} on ${entry.runtimeName}`}
                      className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-left font-normal"
                      onClick={() => void open(entry.runtimeId, 'tasks', entry.task.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="truncate">{entry.projectName || 'No project'}</span>
                          {entry.task.pinned && <Pin size={11} />}
                          <span
                            className={
                              entry.needsInput
                                ? 'text-amber-400'
                                : entry.task.status === 'running'
                                  ? 'text-emerald-400'
                                  : ''
                            }
                          >
                            {!entry.online
                              ? 'Offline'
                              : entry.needsInput
                                ? 'Needs input'
                                : entry.task.status === 'running'
                                  ? 'Working'
                                  : entry.task.status === 'review'
                                    ? 'Ready for review'
                                    : entry.task.status === 'failed'
                                      ? 'Failed'
                                      : entry.task.status === 'done'
                                        ? 'Completed'
                                        : entry.task.status === 'cancelled'
                                          ? 'Stopped'
                                          : 'Not started'}
                          </span>
                        </div>
                        <p className="truncate text-sm font-medium text-foreground">
                          {entry.task.title}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <GitBranch size={11} />
                          <span className="min-w-0 flex-1 truncate">
                            {entry.task.checkoutBranch ||
                              (entry.task.execution === 'worktree'
                                ? 'Worktree'
                                : 'Project checkout')}
                          </span>
                          <span className="ml-auto flex min-w-0 max-w-48 items-center gap-1">
                            <Monitor size={12} />
                            <span className="truncate">{entry.runtimeName}</span>
                          </span>
                        </div>
                      </div>
                      <ArrowUpRight size={15} className="shrink-0 text-muted-foreground" />
                    </Button>
                  ))}
                  {!tasks.length && (
                    <p className="p-6 text-center text-xs text-muted-foreground">
                      {query || filter !== 'active'
                        ? 'No threads match these filters.'
                        : 'No active tasks on these computers.'}
                    </p>
                  )}
                </div>
              </section>
              <section aria-label="Connected computers" className="space-y-3 border-t pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Computers</h2>
                  <p className="text-xs text-muted-foreground">
                    {visible.filter((entry) => entry.connected).length} of {visible.length} online
                    {' · '}
                    {pullCount} PRs need attention
                  </p>
                </div>
                {partialPulls && (
                  <p className="text-xs text-muted-foreground">
                    PR totals cover loaded results. Some devices or repositories are still loading,
                    unavailable, or have more results.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {visible.map((entry) => (
                    <article
                      key={entry.profile.id}
                      aria-label={`Computer ${entry.profile.name}`}
                      className="min-w-0 rounded-lg border p-4"
                    >
                      <div className="flex items-center gap-2">
                        <Monitor size={16} className="text-muted-foreground" />
                        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
                          {entry.profile.name}
                        </h2>
                        <span
                          className={cn(
                            'flex items-center gap-1.5 text-[11px]',
                            entry.connected ? 'text-emerald-400' : 'text-muted-foreground',
                          )}
                        >
                          <Circle size={7} fill="currentColor" />
                          {entry.connected ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {entry.profile.connection.address}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">
                          {aggregateRuntimeTasks([entry]).length} active threads
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-xs"
                          aria-label="Browse all pull requests"
                          onClick={() => host.navigate({ viewId: 'pulls' })}
                        >
                          <GitPullRequest size={13} />
                          {entry.pulls
                            ? `${entry.pulls.total}${entry.pulls.partial ? '+' : ''} PRs · ${entry.pulls.needsAttention} need attention`
                            : entry.pullError
                              ? 'PRs unavailable'
                              : 'View PRs'}
                          <ArrowUpRight size={12} />
                        </Button>
                      </div>
                      {(!entry.connected || entry.pullError || entry.pulls?.partial) && (
                        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                          {!entry.connected
                            ? entry.lastSeen
                              ? `Last seen ${new Date(entry.lastSeen).toLocaleString()}. Cached tasks shown.`
                              : 'Waiting for this runtime. Reconnect from Settings.'
                            : entry.pullError
                              ? 'Some PRs could not be loaded. Open PRs for details.'
                              : 'PR counts cover loaded results.'}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
