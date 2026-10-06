import { useTaskSearch } from './use-task-search'
import { readTaskListViewState, saveTaskListViewState } from './task-list-view-state'
import { flushSync } from 'react-dom'
import { selectTaskKeys } from './task-selection'
import { useStudioHost } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  readAppPreferences,
  latestCompletedTaskTurn,
  resolveTaskAgent,
  useAppPreferences,
} from '@dovo/studio-core'
import { compareTasks, isSnoozed } from '@dovo/studio-core'
import { ChoicePicker } from '@dovo/studio-ui'
import { ProjectsMenu } from '@dovo/extension-scm/projects'
import { Plus, Search, ChevronDown, Layers2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useCallback, useDeferredValue, useMemo, useRef } from 'react'
import { Button, Input, ContextMenu } from '@dovo/studio-ui'
import { responses, useWorkspace } from '@dovo/studio-core'
import { TaskRow } from './task-row'
import { TaskContextMenu } from '../detail/task-context-menu'
import { collectTasks, mainTaskEntries, type TaskEntry, type TaskSource } from './task-collection'
import { taskActionClient } from './task-row-actions'
import { indexTaskSubagents } from '@dovo/protocol'
export function TaskList({
  titleHeader = false,
  projectId,
  onProjectChange,
  selectedId,
  onSelect,
  onCreate,
  onNewThread,
  onDeselect,
  onOrderChange,
  onSplit,
  onTemplate,
  sources,
  temporaryEntry,
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
  onNewThread: () => void
  onDeselect: () => void
  /** The tasks in the order they appear in open groups, for keyboard task switching. */
  onOrderChange?: (entries: TaskEntry[]) => void
  /** Opens a task next to the current one. */
  onSplit?: (entry: TaskEntry) => void
  /** Starts a new task in the entry's project from one of its templates. */
  onTemplate?: (entry: TaskEntry, templateId: string) => void
  sources: TaskSource[]
  /** An untouched composer draft, visible without workspace persistence or bulk actions. */
  temporaryEntry?: TaskEntry
  activeRuntimeId: string | null
  busy: boolean
  error: string
}) {
  const host = useStudioHost()
  const { appInfo } = host
  const store = useWorkspace()
  const [selected, setSelected] = useApplicationState<Set<string>>(() => new Set())
  const selecting = selected.size > 0
  const selectionAnchor = useRef<string | null>(null)
  const bulkLock = useRef(false)
  const [bulkBusy, setBulkBusy] = useApplicationState(false)
  const allEntries = useMemo(() => {
    const entries = collectTasks(sources)
    return temporaryEntry && !entries.some((entry) => entry.key === temporaryEntry.key)
      ? [temporaryEntry, ...entries]
      : entries
  }, [sources, temporaryEntry])
  const entries = useMemo(() => mainTaskEntries(allEntries), [allEntries])
  const subagentsByRuntime = useMemo(
    () =>
      new Map(
        sources.map((source) => [source.runtimeId, indexTaskSubagents(source.workspace.tasks)]),
      ),
    [sources],
  )
  const subagentsByKey = useMemo(
    () =>
      new Map(
        entries.map((entry) => [
          entry.key,
          subagentsByRuntime.get(entry.source.runtimeId)?.(entry.task, true) ?? [],
        ]),
      ),
    [entries, subagentsByRuntime],
  )
  const selectedEntry = allEntries.find((entry) => entry.key === selectedId)
  const selectedMainKey = useMemo(() => {
    if (!selectedEntry || selectedEntry.key === temporaryEntry?.key) return ''
    if (!selectedEntry.task.delegation) return selectedEntry.key
    const tasks = new Map(selectedEntry.source.workspace.tasks.map((task) => [task.id, task]))
    const seen = new Set<string>()
    let task = selectedEntry.task
    while (task.delegation && !seen.has(task.id)) {
      seen.add(task.id)
      const parent = tasks.get(task.delegation.parentTaskId)
      if (!parent) return ''
      task = parent
    }
    return (
      entries.find(
        (entry) =>
          entry.source.runtimeId === selectedEntry.source.runtimeId && entry.task.id === task.id,
      )?.key ?? ''
    )
  }, [entries, selectedEntry, temporaryEntry])
  const [now, setNow] = useApplicationState(Date.now())
  const showSeconds = entries.some(({ task }) => {
    const started = Date.parse(task.turns?.at(-1)?.startedAt ?? '')
    return (
      task.status === 'running' &&
      task.runPhase !== 'finalizing' &&
      Number.isFinite(started) &&
      now - started < 60000
    )
  })
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), showSeconds ? 1000 : 60000)
    return () => clearInterval(timer)
  }, [showSeconds])
  const needsInput = useMemo(
    () => new Set(entries.filter((entry) => entry.needsInput).map((entry) => entry.key)),
    [entries],
  )
  const [query, setQuery, queryRef] = useApplicationState(
      () => readTaskListViewState(host).query ?? '',
    ),
    [actionError, setActionError] = useApplicationState('')
  const [environment, setEnvironment, environmentRef] = useApplicationState(
    () => readTaskListViewState(host).environment ?? '',
  )
  const preferences = useAppPreferences()
  const sort = preferences.taskSort
  const grouping = preferences.taskGrouping
  const [expanded, setExpanded, expandedRef] = useApplicationState<Record<string, boolean>>(
    () => readTaskListViewState(host).expanded ?? {},
  )
  const scroll = useRef<HTMLDivElement>(null)
  const scrollTop = useRef(readTaskListViewState(host).scrollTop ?? 0)
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scrollTop.current
  }, [])
  useEffect(
    () => () =>
      saveTaskListViewState(host, {
        query: queryRef.current,
        environment: environmentRef.current,
        expanded: expandedRef.current,
        scrollTop: scrollTop.current,
      }),
    [host, queryRef, expandedRef, environmentRef],
  )
  const projects = useMemo(
    () => new Map(entries.map((entry) => [entry.projectKey, entry.projectName])),
    [entries],
  )
  const deferredQuery = useDeferredValue(query)
  const search = useTaskSearch(entries, deferredQuery)
  const searchIdentity = JSON.stringify([...search.keys].sort())
  const tasks = useMemo(() => {
    const needle = deferredQuery.toLowerCase()
    return entries
      .filter(
        ({ task: t, source, key, projectKey, projectName }) =>
          key === temporaryEntry?.key ||
          (key === selectedId && t.status === 'draft' && !t.archivedAt) ||
          ((!projectId ||
            projectKey === projectId ||
            source.workspace.repositories.some(
              (repo) =>
                repo.id === t.repositoryId &&
                repo.gitIdentity &&
                `git:${repo.gitIdentity}` === projectId,
            )) &&
            (!environment || JSON.stringify(source.runtimeId) === environment) &&
            !t.archivedAt &&
            (!needle ||
              [
                t.title,
                t.checkoutBranch ??
                  source.workspace.repositories.find((r) => r.id === t.repositoryId)?.branch ??
                  '',
                resolveTaskAgent(t, source.workspace.agents)?.name ?? '',
                source.name,
                projectName,
              ].some((text) => text.toLowerCase().includes(needle)) ||
              search.keys.has(key) ||
              t.messages.some((message) => message.text.toLowerCase().includes(needle)))),
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
  }, [
    entries,
    temporaryEntry,
    selectedId,
    projectId,
    environment,
    deferredQuery,
    sort,
    needsInput,
    projects,
    now,
    searchIdentity,
  ])
  const searchError = search.error
  const selectedEntries = entries.filter((entry) => selected.has(entry.key))
  const bulk = async (
    action: 'archive' | 'reopen' | 'snooze' | 'delete' | 'read' | 'unread',
    hours?: number,
  ) => {
    if (!selectedEntries.length || bulkLock.current) return
    if (action === 'snooze' && hours === undefined) throw new Error('Choose a snooze duration.')
    if (
      action === 'delete' &&
      !window.confirm(`Delete ${selectedEntries.length} selected threads? This cannot be undone.`)
    )
      return
    if (
      action === 'archive' &&
      readAppPreferences().confirmArchive &&
      !window.confirm(
        `Archive ${selectedEntries.length} selected threads? You can restore them later.`,
      )
    )
      return
    bulkLock.current = true
    setBulkBusy(true)
    setActionError('')
    try {
      for (const entry of selectedEntries) {
        const client = taskActionClient(store, entry.source)
        if (action === 'archive' || action === 'delete')
          await client.request('/api/tasks/lifecycle', { id: entry.task.id, action }, responses.ok)
        else if (action === 'read' || action === 'unread') {
          const turn = latestCompletedTaskTurn(entry.task)
          if (!turn) throw new Error('This thread has no completed turn to mark.')
          if (action === 'unread' && entry.key === selectedId) flushSync(onDeselect)
          await client.request(
            '/api/tasks/viewed',
            {
              id: entry.task.id,
              turnId: turn.id,
              viewed: action === 'read',
              expectedRevision: entry.task.viewedRevision ?? 0,
            },
            responses.ok,
          )
        } else if (action === 'reopen') {
          if (entry.task.archivedAt)
            await client.request(
              '/api/tasks/lifecycle',
              { id: entry.task.id, action: 'restore' },
              responses.ok,
            )
          else await client.patch(entry.task, { archived: false, snoozedUntil: null })
        } else
          await client.patch(entry.task, {
            snoozedUntil: new Date(Date.now() + (hours ?? 0) * 3600000).toISOString(),
          })
        if ((action === 'archive' || action === 'delete') && entry.key === selectedMainKey)
          onDeselect()
        setSelected((current) => {
          const remaining = new Set(current)
          remaining.delete(entry.key)
          return remaining
        })
      }
      setSelected(new Set())
      await store.refreshRuntimes()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
      await store.refreshRuntimes().catch(() => undefined)
    } finally {
      bulkLock.current = false
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
        tasks: active.filter(
          ({ task, needsInput }) =>
            !task.pinned &&
            !(preferences.workingSection && task.status === 'running' && !needsInput),
        ),
        open: true,
      },
      ...(preferences.workingSection
        ? [
            {
              id: 'working',
              name: 'Working',
              tasks: active.filter(
                ({ task, needsInput }) => !task.pinned && task.status === 'running' && !needsInput,
              ),
              open: false,
            },
          ]
        : []),
      {
        id: 'snoozed',
        name: 'Snoozed',
        tasks: tasks.filter(
          ({ task }) => !task.archived && !task.archivedAt && isSnoozed(task, now),
        ),
        open: false,
      },
      {
        id: 'settled',
        name: 'Settled',
        tasks: tasks.filter(({ task }) => task.archived || !!task.archivedAt),
        open: false,
      },
    ].filter((group) => group.tasks.length)
    const collapsedGroups = statusGroups
      .filter((group) => group.id === 'snoozed' || group.id === 'settled' || group.id === 'working')
      .map((group) => ({
        ...group,
        open: expanded[group.id] ?? false,
      }))
    const visibleActive = active.filter(
      ({ task, needsInput }) =>
        !preferences.workingSection || task.pinned || task.status !== 'running' || needsInput,
    )
    if (grouping === 'none')
      return [{ id: 'all', name: '', tasks: visibleActive, open: true }, ...collapsedGroups]
    if (grouping === 'status')
      return statusGroups.map((group) => ({
        ...group,
        open:
          group.tasks.some((entry) => entry.key === temporaryEntry?.key) ||
          (expanded[group.id] ?? group.open),
      }))
    const byProject = new Map<string, { id: string; name: string; tasks: TaskEntry[] }>()
    for (const entry of visibleActive) {
      const repository = entry.source.workspace.repositories.find(
        (repo) => repo.id === entry.task.repositoryId,
      )
      const key = preferences.projectGrouping
        ? (repository?.gitIdentity ?? entry.projectKey)
        : entry.projectKey
      const group = byProject.get(key) ?? {
        id: `project:${key}`,
        name: entry.projectName,
        tasks: [],
      }
      group.tasks.push(entry)
      byProject.set(key, group)
    }
    return [
      ...[...byProject.values()]
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((group) => ({
          ...group,
          open:
            group.tasks.some((entry) => entry.key === temporaryEntry?.key) ||
            (expanded[group.id] ?? true),
        })),
      ...collapsedGroups,
    ]
  }, [
    tasks,
    now,
    grouping,
    expanded,
    preferences.projectGrouping,
    preferences.workingSection,
    temporaryEntry,
  ])
  useEffect(() => {
    onOrderChange?.(
      groups
        .filter((group) => group.open)
        .flatMap((group) => group.tasks.filter((entry) => entry.key !== temporaryEntry?.key)),
    )
  }, [groups, onOrderChange, temporaryEntry])
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
        subagent: (id: string) => void
      }
    >(),
  )
  const latest = useRef({
    onSelect,
    onCreate,
    onDeselect,
    onProjectChange,
    setQuery,
    onSplit,
    onTemplate,
    allEntries,
  })
  latest.current = {
    onSelect,
    onCreate,
    onDeselect,
    onProjectChange,
    setQuery,
    onSplit,
    onTemplate,
    allEntries,
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
      },
      subagent: (id: string) => {
        const child = latest.current.allEntries.find(
          (item) => item.source.runtimeId === entry.source.runtimeId && item.task.id === id,
        )
        if (child) latest.current.onSelect(child)
      },
    }
    handlers.current.set(entry.key, created)
    return created
  }, [])
  const selectionActions = [
    { id: 'archive', label: 'Archive' },
    { id: 'reopen', label: 'Reopen' },
    { id: 'snooze', label: 'Snooze' },
    { id: 'read', label: 'Mark as read' },
    { id: 'unread', label: 'Mark as unread' },
    { id: 'delete', label: 'Delete' },
  ] as const
  const blockedAction = (action: (typeof selectionActions)[number]['id']) =>
    busy ||
    bulkBusy ||
    !selectedEntries.length ||
    selectedEntries.some(
      ({ task, source }) =>
        !source.online ||
        ((action === 'archive' || action === 'delete' || action === 'reopen') &&
          task.status === 'running') ||
        ((action === 'read' || action === 'unread') &&
          (!latestCompletedTaskTurn(task) || task.archived || !!task.archivedAt)) ||
        (action === 'snooze' && (task.archived || !!task.archivedAt)),
    )
  const selectionMenu = (
    <>
      <ContextMenu.Label className="px-2.5 py-1.5 text-xs text-muted-foreground">
        {selectedEntries.length} threads selected
      </ContextMenu.Label>
      {selectionActions.map(({ id, label }) =>
        id === 'snooze' ? (
          <ContextMenu.Sub key={id}>
            <ContextMenu.SubTrigger
              disabled={blockedAction(id)}
              className="rounded-lg px-2.5 py-2 text-xs"
            >
              Snooze
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                {[
                  { hours: 1, label: 'For 1 hour' },
                  { hours: 4, label: 'For 4 hours' },
                  { hours: 24, label: 'For 24 hours' },
                ].map((option) => (
                  <ContextMenu.Item
                    key={option.hours}
                    className="rounded-sm px-2 py-1.5 text-xs data-[highlighted]:bg-accent/55"
                    onSelect={() => void bulk(id, option.hours)}
                  >
                    {option.label}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
        ) : (
          <ContextMenu.Item
            key={id}
            className={`flex cursor-default rounded-lg px-2.5 py-2 text-xs outline-none data-[highlighted]:bg-accent/65 data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${id === 'delete' ? 'text-destructive' : ''}`}
            disabled={blockedAction(id)}
            onSelect={() => void bulk(id)}
          >
            {label}
          </ContextMenu.Item>
        ),
      )}
    </>
  )
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
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1 text-sm">
            <Search
              aria-hidden="true"
              className="absolute left-2 top-2 size-3 text-muted-foreground"
            />
            <Input
              aria-label="Search threads"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search threads"
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
            aria-label="New thread"
            title="New thread"
            onClick={onNewThread}
            disabled={busy}
          >
            <Plus size={17} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {(sources.length > 1 || environment) && (
        <div className="px-2 pb-1">
          <ChoicePicker
            aria-label="Filter threads by environment"
            className="h-7 w-full rounded-sm bg-transparent px-2 text-xs text-muted-foreground"
            value={environment}
            onValueChange={(value) => {
              setEnvironment(value)
              scrollTop.current = 0
              if (scroll.current) scroll.current.scrollTop = 0
            }}
          >
            <option value="">All environments</option>
            {environment &&
              !sources.some((source) => JSON.stringify(source.runtimeId) === environment) && (
                <option value={environment}>Unavailable environment</option>
              )}
            {sources.map((source) => (
              <option
                key={JSON.stringify(source.runtimeId)}
                value={JSON.stringify(source.runtimeId)}
              >
                {source.name}
                {source.online ? '' : ' · Offline'}
              </option>
            ))}
          </ChoicePicker>
        </div>
      )}
      {(error || actionError || searchError) && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error || actionError || searchError}
        </p>
      )}
      <div
        ref={scroll}
        onScroll={(event) => {
          scrollTop.current = event.currentTarget.scrollTop
        }}
        className="min-h-0 flex-1 overflow-y-auto px-1.5"
        aria-busy={busy}
      >
        {groups.map((group) => {
          const rows = group.tasks.map((entry) => {
            const handlers = entryHandlers(entry)
            return (
              <div
                key={entry.key}
                className="flex items-center"
                onClickCapture={(event) => {
                  if (bulkBusy || busy || entry.key === temporaryEntry?.key) return
                  if (
                    !(event.target instanceof Element) ||
                    event.target.closest('button') !== event.currentTarget.querySelector('button')
                  )
                    return
                  if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
                    setSelected(new Set())
                    selectionAnchor.current = entry.key
                    return
                  }
                  event.preventDefault()
                  event.stopPropagation()
                  const order = groups
                    .filter((group) => group.open)
                    .flatMap((group) =>
                      group.tasks
                        .filter((item) => item.key !== temporaryEntry?.key)
                        .map((item) => item.key),
                    )
                  setSelected((current) =>
                    selectTaskKeys(
                      current.size || !selectedMainKey ? current : new Set([selectedMainKey]),
                      entry.key,
                      order,
                      selectionAnchor.current,
                      event.shiftKey,
                      !event.shiftKey || event.metaKey || event.ctrlKey,
                    ),
                  )
                  if (!event.shiftKey) selectionAnchor.current = entry.key
                }}
                onContextMenuCapture={() => {
                  if (
                    entry.key !== temporaryEntry?.key &&
                    selecting &&
                    !selected.has(entry.key) &&
                    !bulkBusy
                  )
                    setSelected(new Set([entry.key]))
                }}
              >
                <TaskContextMenu
                  entry={entry}
                  selectionMenu={
                    selecting && entry.key !== temporaryEntry?.key ? selectionMenu : undefined
                  }
                  selected={entry.key === selectedMainKey}
                  busy={busy || entry.key === temporaryEntry?.key}
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
                    subagents={subagentsByKey.get(entry.key) ?? []}
                    now={now}
                    selected={entry.key === selectedId}
                    selectedChildId={
                      entry.key === selectedMainKey &&
                      selectedEntry &&
                      selectedEntry.task.id !== entry.task.id
                        ? selectedEntry.task.id
                        : undefined
                    }
                    multiSelected={selected.has(entry.key)}
                    source={entry.source}
                    editable={
                      entry.key !== temporaryEntry?.key &&
                      entry.source.runtimeId === activeRuntimeId &&
                      !busy
                    }
                    disabled={
                      busy ||
                      bulkBusy ||
                      (!entry.source.online && entry.source.runtimeId !== activeRuntimeId)
                    }
                    onSelect={handlers.open}
                    onOpenSubagent={handlers.subagent}
                  />
                </TaskContextMenu>
              </div>
            )
          })
          return grouping === 'none' &&
            group.id !== 'settled' &&
            group.id !== 'snoozed' &&
            group.id !== 'working' ? (
            <div key={group.id}>{rows}</div>
          ) : (
            <details
              key={group.id}
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
              {query || projectId || environment ? 'No matching tasks' : 'Ready for your next idea'}
            </p>
            <p className="leading-5 text-muted-foreground">
              {query || projectId || environment
                ? 'Try a different search or clear your filters.'
                : 'Start with a question, a fix, or something you want to build.'}
            </p>
            {query || projectId || environment ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery('')
                  setEnvironment('')
                  onProjectChange('')
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={onNewThread}>
                New thread
              </Button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
