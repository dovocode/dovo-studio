import { useStudioHost } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  readAppPreferences,
  resolveTaskAgent,
  updateAppPreferences,
  useAppPreferences,
} from '@dovo/studio-core'
import { compareTasks, taskSortOptions, taskGroupOptions, isSnoozed } from '@dovo/studio-core'
import { ProjectsMenu } from '@dovo/extension-scm/projects'
import { ChoicePicker } from '@dovo/studio-ui'
import { Plus, Search, ChevronDown, SlidersHorizontal, ListChecks, Layers2 } from 'lucide-react'
import { useEffect, useCallback, useMemo, useRef } from 'react'
import { Button, Input } from '@dovo/studio-ui'
import { responses, useWorkspace } from '@dovo/studio-core'
import { TaskRow } from './task-row'
import { TaskContextMenu } from '../detail/task-context-menu'
import { collectTasks, type TaskEntry, type TaskSource } from './task-collection'
import { taskActionClient } from './task-row-actions'
export function TaskList({
  titleHeader = false,
  projectId,
  onProjectChange,
  selectedId,
  onSelect,
  onCreate,
  onDeselect,
  onOrderChange,
  onSplit,
  onTemplate,
  sources,
  activeRuntimeId,
  busy,
  error,
}: {
  titleHeader?: boolean
  projectId: string
  onProjectChange: (id: string) => void
  selectedId: string
  onSelect: (entry: TaskEntry) => void
  onCreate: (projectId?: string) => void
  onDeselect: () => void
  /** The tasks in the order they appear in open groups, for keyboard task switching. */
  onOrderChange?: (entries: TaskEntry[]) => void
  /** Opens a task next to the current one. */
  onSplit?: (entry: TaskEntry) => void
  /** Starts a new task in the entry's project from one of its templates. */
  onTemplate?: (entry: TaskEntry, templateId: string) => void
  sources: TaskSource[]
  activeRuntimeId: string | null
  busy: boolean
  error: string
}) {
  const { appInfo } = useStudioHost()
  const store = useWorkspace()
  const [selecting, setSelecting] = useApplicationState(false)
  const [selected, setSelected] = useApplicationState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useApplicationState(false)
  const entries = useMemo(() => collectTasks(sources), [sources])
  const [now, setNow] = useApplicationState(Date.now())
  const running = entries.some(({ task }) => task.status === 'running')
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), running ? 1000 : 60000)
    return () => clearInterval(timer)
  }, [running])
  const needsInput = useMemo(
    () => new Set(entries.filter((entry) => entry.needsInput).map((entry) => entry.key)),
    [entries],
  )
  const [query, setQuery] = useApplicationState(''),
    [filter, setFilter] = useApplicationState('active'),
    // Settings → General → Task list → Default sort.
    [sort, setSort] = useApplicationState<string>(() => readAppPreferences().taskSort),
    [actionError, setActionError] = useApplicationState('')
  // Only a sort other than the default counts as customized.
  const defaultSort = useAppPreferences().taskSort
  const grouping = useAppPreferences().taskGrouping
  const [expanded, setExpanded] = useApplicationState<Record<string, boolean>>({})
  const projects = useMemo(
    () => new Map(entries.map((entry) => [entry.projectKey, entry.projectName])),
    [entries],
  )
  const tasks = useMemo(() => {
    const needle = query.toLowerCase()
    return entries
      .filter(
        ({ task: t, source, key, projectKey, projectName }) =>
          (!projectId ||
            projectKey === projectId ||
            source.workspace.repositories.some(
              (repo) =>
                repo.id === t.repositoryId &&
                repo.gitIdentity &&
                `git:${repo.gitIdentity}` === projectId,
            )) &&
          (filter === 'archive' ? !!t.archivedAt : !t.archivedAt) &&
          (filter === 'archive' ||
            filter === 'active' ||
            (filter === 'archived' ? t.archived : !t.archived)) &&
          (['active', 'archived', 'archive'].includes(filter) ||
            (filter === 'snoozed' && isSnoozed(t, now)) ||
            (filter === 'input' ? needsInput.has(key) : t.status === filter)) &&
          [
            t.title,
            t.checkoutBranch ??
              source.workspace.repositories.find((r) => r.id === t.repositoryId)?.branch ??
              '',
            resolveTaskAgent(t, source.workspace.agents)?.name ?? '',
            source.name,
            projectName,
            ...t.messages.map((m) => m.text),
          ].some((text) => text.toLowerCase().includes(needle)),
      )
      .sort((a, b) =>
        compareTasks(
          {
            ...a.task,
            id: a.key,
            repositoryId: a.projectKey,
          },
          {
            ...b.task,
            id: b.key,
            repositoryId: b.projectKey,
          },
          sort,
          needsInput,
          projects,
        ),
      )
  }, [entries, projectId, filter, query, sort, needsInput, projects, now])
  const selectedEntries = entries.filter((entry) => selected.has(entry.key))
  const bulk = async (action: 'archive' | 'snooze' | 'pin' | 'delete') => {
    if (!selectedEntries.length || bulkBusy) return
    if (
      action === 'delete' &&
      !window.confirm(`Delete ${selectedEntries.length} selected threads? This cannot be undone.`)
    )
      return
    setBulkBusy(true)
    setActionError('')
    try {
      for (const entry of selectedEntries) {
        const client = taskActionClient(store, entry.source)
        if (action === 'archive' || action === 'delete')
          await client.request('/api/tasks/lifecycle', { id: entry.task.id, action }, responses.ok)
        else
          await client.patch(
            entry.task,
            action === 'pin'
              ? { pinned: true }
              : { snoozedUntil: new Date(Date.now() + 24 * 3600000).toISOString() },
          )
      }
      setSelected(new Set())
      setSelecting(false)
      await store.refreshRuntimes()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
      await store.refreshRuntimes().catch(() => undefined)
    } finally {
      setBulkBusy(false)
    }
  }
  const groups = useMemo(() => {
    const active = tasks.filter(
      ({ task }) => !task.archived && !task.archivedAt && !isSnoozed(task, now),
    )
    const statusGroups = [
      {
        id: 'pinned',
        name: 'Pinned',
        tasks: active.filter(({ task }) => task.pinned),
        open: true,
      },
      {
        id: 'active',
        name: 'Active',
        tasks: active.filter(({ task }) => !task.pinned),
        open: true,
      },
      {
        id: 'snoozed',
        name: 'Snoozed',
        tasks: tasks.filter(
          ({ task }) => !task.archived && !task.archivedAt && isSnoozed(task, now),
        ),
        open: filter === 'snoozed',
      },
      {
        id: 'settled',
        name: filter === 'archive' ? 'Archived' : 'Settled',
        tasks: tasks.filter(({ task }) => task.archived || !!task.archivedAt),
        open: filter === 'archived' || filter === 'archive',
      },
    ].filter((group) => group.tasks.length)
    if (grouping === 'none') return [{ id: 'all', name: '', tasks, open: true }]
    if (grouping === 'status')
      return statusGroups.map((group) => ({
        ...group,
        open: expanded[group.id] ?? group.open,
      }))
    const byProject = new Map<string, { id: string; name: string; tasks: TaskEntry[] }>()
    for (const entry of tasks) {
      const repository = entry.source.workspace.repositories.find(
        (repo) => repo.id === entry.task.repositoryId,
      )
      const key = repository?.gitIdentity ?? entry.projectKey
      const group = byProject.get(key) ?? {
        id: `project:${key}`,
        name: entry.projectName,
        tasks: [],
      }
      group.tasks.push(entry)
      byProject.set(key, group)
    }
    return [...byProject.values()]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((group) => ({ ...group, open: expanded[group.id] ?? true }))
  }, [tasks, filter, now, grouping, expanded])
  useEffect(() => {
    onOrderChange?.(groups.filter((group) => group.open).flatMap((group) => group.tasks))
  }, [groups, onOrderChange])
  // Stable per-entry handlers so memoized rows only re-render when their own data changes.
  const handlers = useRef(
    new Map<
      string,
      {
        open: () => void
        split: () => void
        template: (templateId: string) => void
        create: () => void
        filter: () => void
      }
    >(),
  )
  const latest = useRef({
    onSelect,
    onCreate,
    onDeselect,
    onProjectChange,
    setQuery,
    setFilter,
    onSplit,
    onTemplate,
  })
  latest.current = {
    onSelect,
    onCreate,
    onDeselect,
    onProjectChange,
    setQuery,
    setFilter,
    onSplit,
    onTemplate,
  }
  const entryHandlers = useCallback((entry: TaskEntry) => {
    const existing = handlers.current.get(entry.key)
    if (existing) return existing
    const created = {
      open: () => latest.current.onSelect(entry),
      split: () => latest.current.onSplit?.(entry),
      template: (templateId: string) => latest.current.onTemplate?.(entry, templateId),
      create: () => latest.current.onCreate(entry.projectKey),
      filter: () => {
        latest.current.onProjectChange(
          entry.source.workspace.repositories.find((repo) => repo.id === entry.task.repositoryId)
            ?.gitIdentity
            ? `git:${entry.source.workspace.repositories.find((repo) => repo.id === entry.task.repositoryId)?.gitIdentity}`
            : entry.projectKey,
        )
        latest.current.setQuery('')
        latest.current.setFilter('active')
      },
    }
    handlers.current.set(entry.key, created)
    return created
  }, [])
  return (
    <aside
      className="flex h-full w-full min-w-0 flex-col border-r bg-sidebar"
      aria-label="Task sidebar"
    >
      {titleHeader && (
        <header className="studio-task-sidebar-header">
          <Layers2 size={15} strokeWidth={1.6} aria-hidden="true" />
          <span>Dovo Studio</span>
          {appInfo && appInfo.channel !== 'stable' && (
            <span className="rounded border px-1.5 text-[10px] text-muted-foreground">
              {appInfo.channel === 'nightly' ? 'Nightly' : 'Dev'}
            </span>
          )}
        </header>
      )}
      <div className="shrink-0 space-y-1.5 px-2 pt-3 pb-1">
        {selecting && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="mr-1">{selected.size} selected</span>
            {(['archive', 'snooze', 'pin', 'delete'] as const).map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === 'delete' ? 'destructive' : 'outline'}
                className="h-7 px-2 text-xs"
                disabled={!selected.size || bulkBusy}
                onClick={() => void bulk(action)}
              >
                {action[0].toUpperCase() + action.slice(1)}
              </Button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1 text-sm">
            <Search
              aria-hidden="true"
              className="absolute left-2 top-2 size-3 text-muted-foreground"
            />
            <Input
              aria-label="Search tasks"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks"
              className="h-8 border-transparent bg-transparent pl-7 shadow-none focus:border-border"
            />
          </div>
          <ProjectsMenu
            compact
            allDevices
            value={projectId}
            onChange={onProjectChange}
            disabled={busy}
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            aria-label={selecting ? 'Cancel selection' : 'Select tasks'}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting(!selecting)
              setSelected(new Set())
            }}
          >
            <ListChecks size={16} aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            aria-label="New task"
            onClick={() => onCreate()}
            disabled={busy}
          >
            <Plus size={17} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <details className="group/filter mx-2 mb-1 rounded-md border border-transparent open:border-border/70 open:bg-muted/35">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1.5 py-1 text-[0.6875rem] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
          <SlidersHorizontal aria-hidden="true" className="size-3" />
          <span className="flex-1">Filters & sort</span>
          {filter !== 'active' || sort !== defaultSort || grouping !== 'status' || projectId ? (
            <span>Custom</span>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className="size-3 transition-transform group-open/filter:rotate-180"
          />
        </summary>
        <div className="flex min-w-0 items-center gap-1 px-1 pb-2">
          <ChoicePicker
            aria-label="Task status filter"
            className="h-7 min-w-0 flex-1 rounded-sm bg-transparent px-2 text-xs"
            value={filter}
            onValueChange={(selection) => setFilter(selection)}
          >
            <option value="active">All tasks</option>
            <option value="running">Running</option>
            <option value="input">Needs input</option>
            <option value="review">Ready for review</option>
            <option value="failed">Failed</option>
            <option value="snoozed">Snoozed</option>
            <option value="archived">Settled</option>
            <option value="archive">Archived</option>
          </ChoicePicker>
          <ChoicePicker
            aria-label="Thread sort"
            className="h-7 min-w-0 flex-1 rounded-sm bg-transparent px-2 text-xs text-muted-foreground"
            value={sort}
            onValueChange={setSort}
          >
            {taskSortOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </ChoicePicker>
        </div>
        <div className="px-1 pb-2">
          <ChoicePicker
            aria-label="Group tasks by"
            className="h-7 w-full rounded-sm bg-transparent px-2 text-xs text-muted-foreground"
            value={grouping}
            onValueChange={(taskGrouping) =>
              updateAppPreferences({ taskGrouping: taskGrouping as typeof grouping })
            }
          >
            {taskGroupOptions.map((option) => (
              <option key={option.id} value={option.id}>
                Group by {option.name.toLowerCase()}
              </option>
            ))}
          </ChoicePicker>
        </div>
      </details>
      {(error || actionError) && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error || actionError}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5" aria-busy={busy}>
        {groups.map((group) => {
          const rows = group.tasks.map((entry) => {
            const handlers = entryHandlers(entry)
            return (
              <div key={entry.key} className="flex items-center">
                {selecting && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${entry.task.title}`}
                    checked={selected.has(entry.key)}
                    disabled={bulkBusy}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(entry.key)
                        else next.delete(entry.key)
                        return next
                      })
                    }
                    className="ml-1 size-4"
                  />
                )}
                <TaskContextMenu
                  entry={entry}
                  selected={entry.key === selectedId}
                  busy={busy}
                  onOpen={handlers.open}
                  onCreate={handlers.create}
                  onFilter={handlers.filter}
                  onSplit={onSplit ? handlers.split : undefined}
                  onTemplate={onTemplate ? handlers.template : undefined}
                  onDeselect={onDeselect}
                  onError={setActionError}
                >
                  <TaskRow
                    task={entry.task}
                    now={now}
                    selected={entry.key === selectedId}
                    source={entry.source}
                    editable={entry.source.runtimeId === activeRuntimeId && !busy}
                    disabled={
                      busy || (!entry.source.online && entry.source.runtimeId !== activeRuntimeId)
                    }
                    onSelect={handlers.open}
                  />
                </TaskContextMenu>
              </div>
            )
          })
          return grouping === 'none' ? (
            <div key={group.id}>{rows}</div>
          ) : (
            <details
              key={`${group.id}-${filter}`}
              open={group.open}
              onToggle={(event) => {
                const open = event.currentTarget.open
                setExpanded((current) =>
                  current[group.id] === open ? current : { ...current, [group.id]: open },
                )
              }}
              className="group mb-1"
            >
              <summary className="flex cursor-pointer list-none items-center gap-1 px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                <ChevronDown size={11} />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span>{group.tasks.length}</span>
              </summary>
              {rows}
            </details>
          )
        })}
        {!tasks.length && (
          <div className="space-y-2 px-3 py-6 text-xs">
            <p className="font-medium">
              {query || filter !== 'active' || projectId
                ? 'No matching tasks'
                : 'Ready for your next idea'}
            </p>
            <p className="leading-5 text-muted-foreground">
              {query || filter !== 'active' || projectId
                ? 'Try a different search or clear your filters.'
                : 'Start with a question, a fix, or something you want to build.'}
            </p>
            {query || filter !== 'active' || projectId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery('')
                  setFilter('active')
                  onProjectChange('')
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => onCreate()}>
                Create a task
              </Button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
