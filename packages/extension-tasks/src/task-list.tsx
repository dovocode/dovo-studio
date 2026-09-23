import { resolveTaskAgent } from '@dovo/studio-core'
import { compareTasks, taskSortOptions, isSnoozed } from '@dovo/studio-core'
import { ProjectsMenu } from '@dovo/extension-scm/projects'
import { ChoicePicker } from '@dovo/studio-ui'
import { Plus, Search, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IconButton, Input } from '@dovo/studio-ui'
import { TaskRow } from './task-row'
import { TaskContextMenu } from './task-context-menu'
import { collectTasks, type TaskEntry, type TaskSource } from './task-collection'
export function TaskList({
  projectId,
  onProjectChange,
  selectedId,
  onSelect,
  onCreate,
  onDeselect,
  sources,
  activeRuntimeId,
  busy,
  error,
}: {
  projectId: string
  onProjectChange: (id: string) => void
  selectedId: string
  onSelect: (entry: TaskEntry) => void
  onCreate: (projectId?: string) => void
  onDeselect: () => void
  sources: TaskSource[]
  activeRuntimeId: string | null
  busy: boolean
  error: string
}) {
  const entries = collectTasks(sources)
  const [now, setNow] = useState(Date.now())
  const running = entries.some(({ task }) => task.status === 'running')
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), running ? 1000 : 60000)
    return () => clearInterval(timer)
  }, [running])
  const needsInput = new Set(entries.filter((entry) => entry.needsInput).map((entry) => entry.key))
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('active'),
    [sort, setSort] = useState('priority'),
    [actionError, setActionError] = useState('')
  const projects = new Map(entries.map((entry) => [entry.projectKey, entry.projectName]))
  const tasks = entries
    .filter(
      ({ task: t, source, key, projectKey, projectName }) =>
        (!projectId || projectKey === projectId) &&
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
        ].some((text) => text.toLowerCase().includes(query.toLowerCase())),
    )
    .sort((a, b) =>
      compareTasks(
        { ...a.task, id: a.key, repositoryId: a.projectKey },
        { ...b.task, id: b.key, repositoryId: b.projectKey },
        sort,
        needsInput,
        projects,
      ),
    )
  const active = tasks.filter(({ task }) => !task.archived && !isSnoozed(task, now))
  const groups = [
    { id: 'pinned', name: 'Pinned', tasks: active.filter(({ task }) => task.pinned), open: true },
    { id: 'active', name: 'Active', tasks: active.filter(({ task }) => !task.pinned), open: true },
    {
      id: 'snoozed',
      name: 'Snoozed',
      tasks: tasks.filter(({ task }) => !task.archived && isSnoozed(task, now)),
      open: filter === 'snoozed',
    },
    {
      id: 'settled',
      name: filter === 'archive' ? 'Archived' : 'Settled',
      tasks: tasks.filter(({ task }) => task.archived),
      open: filter === 'archived' || filter === 'archive',
    },
  ].filter((g) => g.tasks.length)
  return (
    <aside
      className="flex h-full w-full min-w-0 flex-col border-r bg-sidebar"
      aria-label="Task sidebar"
    >
      <div className="flex h-12 items-center justify-between px-4">
        <span className="text-sm font-medium">
          Tasks <span className="ml-1 text-muted-foreground">{tasks.length}</span>
        </span>
        <IconButton label="New task" className="size-8" onClick={() => onCreate()} disabled={busy}>
          <Plus size={15} />
        </IconButton>
      </div>
      <div className="px-3 pb-2">
        <ProjectsMenu allDevices value={projectId} onChange={onProjectChange} disabled={busy} />
      </div>
      <div className="relative px-3 pb-2">
        <Search className="absolute left-5 top-2.5 size-3.5 text-muted-foreground" />
        <Input
          aria-label="Search tasks"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks, projects, computers"
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="flex min-w-0 items-center gap-1 px-3 pb-2">
        <ChoicePicker
          aria-label="Task status filter"
          className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[11px]"
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
          className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[11px] text-muted-foreground"
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
      {(error || actionError) && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error || actionError}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2" aria-busy={busy}>
        {groups.map((group) => (
          <details key={`${group.id}-${filter}`} open={group.open} className="group mb-1">
            <summary className="flex cursor-pointer list-none items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground">
              <ChevronDown size={11} />
              <span className="min-w-0 flex-1 truncate">{group.name}</span>
              <span>{group.tasks.length}</span>
            </summary>
            {group.tasks.map((entry) => (
              <TaskContextMenu
                key={entry.key}
                entry={entry}
                selected={entry.key === selectedId}
                busy={busy}
                onOpen={() => onSelect(entry)}
                onCreate={() => onCreate(entry.projectKey)}
                onFilter={() => {
                  onProjectChange(entry.projectKey)
                  setQuery('')
                  setFilter('active')
                }}
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
                  onSelect={() => onSelect(entry)}
                />
              </TaskContextMenu>
            ))}
          </details>
        ))}
        {!tasks.length && (
          <p className="p-3 text-xs text-muted-foreground">
            {query || filter !== 'active'
              ? 'No matching tasks.'
              : 'Create a task to start working.'}
          </p>
        )}
      </div>
    </aside>
  )
}
