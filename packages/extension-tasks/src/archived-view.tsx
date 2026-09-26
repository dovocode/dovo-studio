import { useMemo } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { responses, useRuntimeSources, useWorkspace } from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'
import { Archive, Search } from 'lucide-react'

/** Archived tasks across every computer, restorable in place (Codex and T3 Code keep this in
 * settings rather than as a task-list filter). */
export default function ArchivedTasksView() {
  const sources = useRuntimeSources()
  const { readRuntime, refreshRuntime } = useWorkspace()
  const [query, setQuery] = useApplicationState('')
  const [busy, setBusy] = useApplicationState('')
  const [error, setError] = useApplicationState('')
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sources
      .flatMap((source) => {
        const projects = new Map(
          (source.snapshot?.workspace.repositories ?? []).map((repo) => [repo.id, repo.name]),
        )
        return (source.snapshot?.workspace.tasks ?? [])
          .filter((task) => task.archivedAt && !task.example)
          .map((task) => ({
            key: JSON.stringify([source.profile.id, task.id]),
            source,
            task,
            project: projects.get(task.repositoryId) ?? 'No project',
          }))
      })
      .filter(
        (row) =>
          !needle ||
          `${row.task.title} ${row.project} ${row.source.name}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => (b.task.archivedAt ?? '').localeCompare(a.task.archivedAt ?? ''))
  }, [sources, query])
  const restore = async (row: (typeof rows)[number]) => {
    setBusy(row.key)
    setError('')
    try {
      await readRuntime(
        row.source.profile,
        '/api/tasks/lifecycle',
        { id: row.task.id, action: 'restore' },
        responses.ok,
      )
      await refreshRuntime(row.source.profile)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="studio-page-header shrink-0 border-b">
        <h1 className="text-lg font-semibold tracking-tight">Archived tasks</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Restore a task to bring it back to your task list with its conversation and checkout.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
            />
            <Input
              aria-label="Search archived tasks"
              placeholder="Search archived tasks"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-8 text-sm"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {rows.length ? (
            <ul className="divide-y rounded-md border">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{row.task.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.project}
                      {sources.length > 1 ? ` · ${row.source.name}` : ''}
                      {row.task.archivedAt
                        ? ` · Archived ${new Date(row.task.archivedAt).toLocaleDateString()}`
                        : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy || !row.source.connected}
                    title={row.source.connected ? undefined : `${row.source.name} is offline`}
                    onClick={() => void restore(row)}
                  >
                    {busy === row.key ? 'Restoring…' : 'Restore'}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Archive aria-hidden="true" className="size-6 text-muted-foreground" />
              <p className="text-sm">{query ? 'No archived tasks match' : 'No archived tasks'}</p>
              <p className="text-xs text-muted-foreground">
                Archive a task from its menu to keep your list focused.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
