import { taskSnoozeOptions } from '@dovo/protocol'
import { orderThreadSections, settledThreadPreviewLimit } from '@dovo/protocol'
import { SectionOrderDialog } from './section-order-dialog'
import { useTaskSearch } from './use-task-search'
import { readTaskListViewState, saveTaskListViewState } from './task-list-view-state'
import { flushSync } from 'react-dom'
import { selectTaskKeys } from './task-selection'
import { useStudioHost } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  readAppPreferences,
  updateAppPreferences,
  latestCompletedTaskTurn,
  resolveTaskAgent,
  useAppPreferences,
} from '@dovo/studio-core'
import { compareTasks, isSnoozed } from '@dovo/studio-core'
import { SidebarHeader, ChoicePicker } from '@dovo/studio-ui'
import { ProjectsMenu } from '@dovo/extension-scm/projects'
import { Plus, Search, ChevronDown, Monitor } from 'lucide-react'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { Button, Input, ContextMenu } from '@dovo/studio-ui'
import { responses } from '@dovo/studio-core'
import { TaskListRow, type TaskListRowActions, type TaskListWindow } from './task-list-row'
import {
  collectTasks,
  retainTaskOwner,
  type TaskEntry,
  type TaskOwner,
  type TaskSource,
} from './task-collection'
import { taskActionClient, useTaskActionStore } from './task-row-actions'
import { buildThreadTree, threadDescendants } from './thread-tree'
import { useCommittedCallback } from '../detail/use-committed-callback'
import { indexTaskSubagents, projectSubagentList, type SubagentListItem } from '@dovo/protocol'
const noSubagents: readonly SubagentListItem[] = []
// Below this, every open row renders; above it, rows mount near the viewport.
const windowedRowCount = 80
const selectionActions = [
  { id: 'archive', label: 'Archive' },
  { id: 'reopen', label: 'Reopen' },
  { id: 'snooze', label: 'Snooze' },
  { id: 'read', label: 'Mark as read' },
  { id: 'unread', label: 'Mark as unread' },
  { id: 'delete', label: 'Delete' },
] as const
export function TaskList({
  hidePillsForKey,
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
  hidePillsForKey?: string
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
  const store = useTaskActionStore()
  const [selected, setSelected] = useApplicationState<Set<string>>(() => new Set())
  const [showAllSettled, setShowAllSettled] = useApplicationState(false)
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
  const [environment, setEnvironment, environmentRef] = useApplicationState(
    () => readTaskListViewState(host).environment ?? '',
  )
  const retainThreadTree = useMemo(() => {
    let previous: ReturnType<typeof buildThreadTree<TaskEntry>> | undefined
    return (
      entries: readonly TaskEntry[],
      include: (entry: TaskEntry) => boolean,
      options: Parameters<typeof buildThreadTree<TaskEntry>>[3],
    ) => {
      previous = buildThreadTree(entries, previous?.nodes, include, options)
      return previous
    }
  }, [])
  const scopeMatches = useMemo(
    () => (entry: TaskEntry) =>
      !entry.task.archivedAt &&
      (!environment || JSON.stringify(entry.source.runtimeId) === environment) &&
      (!projectId ||
        entry.projectKey === projectId ||
        entry.source.workspace.repositories.some(
          (repo) =>
            repo.id === entry.task.repositoryId &&
            ((projectId === 'scratch' && repo.kind === 'scratch') ||
              (!!repo.gitIdentity && `git:${repo.gitIdentity}` === projectId)),
        )),
    [environment, projectId],
  )
  const threadTree = useMemo(
    () =>
      retainThreadTree(allEntries, scopeMatches, {
        runtimeIds: new Map(
          sources.flatMap((source) =>
            source.snapshot?.runtimeId
              ? [[source.snapshot.runtimeId, source.runtimeId] as const]
              : [],
          ),
        ),
        includeSnapshot: (child) =>
          (!environment || JSON.stringify(child.runtimeId) === environment) &&
          (!projectId ||
            JSON.stringify([child.runtimeId, child.repositoryId]) === projectId ||
            (projectId === 'scratch' && child.projectKind === 'scratch') ||
            (!!child.projectIdentity && `git:${child.projectIdentity}` === projectId)),
      }),
    [allEntries, retainThreadTree, scopeMatches, sources, environment, projectId],
  )
  const entries = threadTree.roots
  const subagentsByRuntime = useMemo(
    () =>
      new Map(
        sources.map((source) => [source.runtimeId, indexTaskSubagents(source.workspace.tasks)]),
      ),
    [sources],
  )
  // Snapshots rebuild every list; rows keep the previous value while their content is equal.
  const retainSubagents = useMemo(() => {
    let previous = new Map<string, readonly SubagentListItem[]>()
    return (next: Map<string, readonly SubagentListItem[]>) => {
      for (const [key, agents] of next) {
        const old = previous.get(key)
        next.set(key, !agents.length ? noSubagents : projectSubagentList(agents, old))
      }
      previous = next
      return next
    }
  }, [])
  const subagentsByKey = useMemo(
    () =>
      retainSubagents(
        new Map(
          entries.map((entry) => [
            entry.key,
            (
              subagentsByRuntime.get(entry.source.runtimeId)?.(entry.task, true) ?? noSubagents
            ).filter((agent) => agent.source !== 'dovo'),
          ]),
        ),
      ),
    [entries, subagentsByRuntime, retainSubagents],
  )
  const retainOwners = useMemo(() => {
    let previous = new Map<string | null, TaskOwner>()
    return (next: readonly TaskSource[]) => {
      previous = new Map(
        next.map((source) => [
          source.runtimeId,
          retainTaskOwner(previous.get(source.runtimeId), source),
        ]),
      )
      return previous
    }
  }, [])
  const owners = useMemo(() => retainOwners(sources), [sources, retainOwners])
  const rowFacts = useMemo(
    () =>
      new Map(
        sources.map((source) => {
          const terminals = new Map<string, number>()
          for (const terminal of source.snapshot?.terminals ?? [])
            if (!terminal.exited)
              terminals.set(terminal.taskId, (terminals.get(terminal.taskId) ?? 0) + 1)
          return [
            source.runtimeId,
            {
              input: new Set(
                [...(source.snapshot?.questions ?? []), ...(source.snapshot?.approvals ?? [])].map(
                  (request) => request.taskId,
                ),
              ),
              terminals,
            },
          ]
        }),
      ),
    [sources],
  )
  const selectedEntry = allEntries.find((entry) => entry.key === selectedId)
  const selectedMainKey = useMemo(() => {
    if (!selectedEntry || selectedEntry.key === temporaryEntry?.key) return ''
    return threadTree.rootKeys.get(selectedEntry.key) ?? selectedEntry.key
  }, [threadTree, selectedEntry, temporaryEntry])
  // Rows keep their own labels current; the list only regroups when a snooze ends.
  const [now, setNow] = useApplicationState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  const needsInput = useMemo(
    () => new Set(entries.filter((entry) => entry.needsInput).map((entry) => entry.key)),
    [entries],
  )
  const [query, setQuery, queryRef] = useApplicationState(
      () => readTaskListViewState(host).query ?? '',
    ),
    [actionError, setActionError] = useApplicationState('')
  const preferences = useAppPreferences()
  const sort = preferences.taskSort
  const grouping = preferences.taskGrouping
  const [expanded, setExpanded, expandedRef] = useApplicationState<Record<string, boolean>>(
    () => readTaskListViewState(host).expanded ?? {},
  )
  const scroll = useRef<HTMLDivElement>(null)
  // Rows measure against the container after it commits; a ref is attached after their effects.
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
  const attachScroll = useCallback((element: HTMLDivElement | null) => {
    scroll.current = element
    setScrollRoot(element)
  }, [])
  const scrollTop = useRef(readTaskListViewState(host).scrollTop ?? 0)
  const rowHeights = useRef(new Map<string, number>(readTaskListViewState(host).rowHeights))
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
        rowHeights: [...rowHeights.current],
      }),
    [host, queryRef, expandedRef, environmentRef],
  )
  const projects = useMemo(
    () => new Map(entries.map((entry) => [entry.projectKey, entry.projectName])),
    [entries],
  )
  const deferredQuery = useDeferredValue(query)
  const search = useTaskSearch(allEntries, deferredQuery)
  const searchIdentity = JSON.stringify([...search.keys].sort())
  const tasks = useMemo(() => {
    const needle = deferredQuery.toLowerCase()
    return (
      entries
        .filter(
          ({ task: t, source, key, projectKey, projectName }) =>
            key === temporaryEntry?.key ||
            (key === selectedId && t.status === 'draft' && !t.archivedAt) ||
            ((threadTree.contextKeys.has(key) ||
              ((!projectId ||
                projectKey === projectId ||
                source.workspace.repositories.some(
                  (repo) =>
                    repo.id === t.repositoryId &&
                    ((projectId === 'scratch' && repo.kind === 'scratch') ||
                      (!!repo.gitIdentity && `git:${repo.gitIdentity}` === projectId)),
                )) &&
                (!environment || JSON.stringify(source.runtimeId) === environment))) &&
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
                threadDescendants(threadTree.nodes.get(key)?.children ?? []).some(
                  (child) =>
                    `${child.title} ${child.computerName}`.toLowerCase().includes(needle) ||
                    search.keys.has(child.key),
                ) ||
                t.messages.some((message) => message.text.toLowerCase().includes(needle)))),
        )
        // Build each sort key once, rather than twice per comparison.
        .map((entry) => ({
          entry,
          task: { ...entry.task, id: entry.key, repositoryId: entry.projectKey },
        }))
        .sort((a, b) => compareTasks(a.task, b.task, sort, needsInput, projects))
        .map(({ entry }) => entry)
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
    searchIdentity,
    threadTree,
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
      !window.confirm(
        `Delete ${selectedEntries.length} selected threads? This cannot be undone. Clean Dovo-created worktrees follow each computer’s cleanup setting.`,
      )
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
  const revealedEntryKey =
    temporaryEntry?.key ?? (selectedEntry?.task.status === 'draft' ? selectedMainKey : undefined)
  const groups = useMemo(() => {
    const sectionOpen = (id: string) =>
      ['working', 'waiting', 'snoozed', 'settled'].includes(id)
        ? !preferences.collapsedThreadSections.includes(id)
        : expanded[id]

    const ordered = (
      sections: { id: string; name: string; tasks: TaskEntry[]; open: boolean; total?: number }[],
    ) =>
      orderThreadSections(sections, (group) => group.id, preferences.threadSectionOrder).map(
        (group, index) => (index === 0 && group.id === 'active' ? { ...group, open: true } : group),
      )

    const attention = tasks.filter(
      ({ task, needsInput }) => needsInput && !task.archived && !task.archivedAt,
    )
    const attentionGroups = attention.length
      ? [
          {
            id: 'needs-input',
            name: 'Needs input',
            tasks: attention,
            open: expanded['needs-input'] ?? true,
          },
        ]
      : []
    const active = tasks.filter(
      ({ task, needsInput }) =>
        !needsInput &&
        !task.archived &&
        !task.archivedAt &&
        !isSnoozed(task, now) &&
        !task.waitingForFeedback,
    )
    const settledTasks = tasks.filter(({ task }) => task.archived || !!task.archivedAt)
    const statusGroups = [
      ...attentionGroups,
      {
        id: 'pinned',
        name: 'Pinned',
        tasks: active.filter(({ task }) => task.pinned),
        open: true,
      },
      {
        id: 'active',
        name: 'Open',
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
        id: 'waiting',
        name: 'Waiting',
        tasks: tasks.filter(
          ({ task, needsInput }) =>
            task.waitingForFeedback &&
            !needsInput &&
            !task.archived &&
            !task.archivedAt &&
            !isSnoozed(task, now),
        ),
        open: false,
      },
      {
        id: 'snoozed',
        name: 'Snoozed',
        tasks: tasks.filter(
          ({ task, needsInput }) =>
            !needsInput && !task.archived && !task.archivedAt && isSnoozed(task, now),
        ),
        open: false,
      },
      {
        id: 'settled',
        name: 'Settled',
        tasks: settledTasks.slice(
          0,
          showAllSettled || query.trim() || selecting ? undefined : settledThreadPreviewLimit,
        ),
        total: settledTasks.length,
        open: false,
      },
    ].filter((group) => group.tasks.length)
    const collapsedGroups = statusGroups
      .filter(
        (group) =>
          group.id === 'waiting' ||
          group.id === 'snoozed' ||
          group.id === 'settled' ||
          group.id === 'working',
      )
      .map((group) => ({
        ...group,
        open: sectionOpen(group.id) ?? false,
      }))
    const visibleActive = active.filter(
      ({ task, needsInput }) =>
        !preferences.workingSection || task.pinned || task.status !== 'running' || needsInput,
    )
    if (grouping === 'none')
      return ordered([
        ...attentionGroups,
        ...(visibleActive.length
          ? [
              {
                id: 'active',
                name: 'Open',
                tasks: visibleActive,
                open:
                  visibleActive.some((entry) => entry.key === revealedEntryKey) ||
                  (expanded.active ?? true),
              },
            ]
          : []),
        ...collapsedGroups,
      ])
    if (grouping === 'status')
      return ordered(
        statusGroups.map((group) => ({
          ...group,
          open:
            group.tasks.some((entry) => entry.key === revealedEntryKey) ||
            (sectionOpen(group.id) ?? group.open),
        })),
      )
    const byProject = new Map<string, { id: string; name: string; tasks: TaskEntry[] }>()
    for (const entry of visibleActive) {
      const repository = entry.source.workspace.repositories.find(
        (repo) => repo.id === entry.task.repositoryId,
      )
      const key = preferences.projectGrouping
        ? repository?.kind === 'scratch'
          ? 'scratch'
          : (repository?.gitIdentity ?? entry.projectKey)
        : entry.projectKey
      const group = byProject.get(key) ?? {
        id: `project:${key}`,
        name: entry.projectName,
        tasks: [],
      }
      group.tasks.push(entry)
      byProject.set(key, group)
    }
    return ordered([
      ...attentionGroups,
      ...[...byProject.values()]
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((group) => ({
          ...group,
          open:
            group.tasks.some((entry) => entry.key === revealedEntryKey) ||
            (expanded[group.id] ?? true),
        })),
      ...collapsedGroups,
    ])
  }, [
    tasks,
    now,
    grouping,
    expanded,
    preferences.projectGrouping,
    preferences.workingSection,
    preferences.threadSectionOrder,
    preferences.collapsedThreadSections,
    revealedEntryKey,
    showAllSettled,
    query,
    selecting,
  ])
  useEffect(() => {
    onOrderChange?.(
      groups
        .filter((group) => group.open)
        .flatMap((group) => group.tasks.filter((entry) => entry.key !== temporaryEntry?.key)),
    )
  }, [groups, onOrderChange, temporaryEntry])
  // Rows address commands by key. Each command resolves the latest committed entry, so a row
  // never dispatches an older task or keeps a removed entry alive.
  const entryByKey = useMemo(
    () => new Map(allEntries.map((entry) => [entry.key, entry])),
    [allEntries],
  )
  const withEntry =
    <Args extends unknown[]>(action: (entry: TaskEntry, ...args: Args) => void) =>
    (key: string, ...args: Args) => {
      const entry = entryByKey.get(key)
      if (entry) action(entry, ...args)
    }
  const visibleOrder = () =>
    groups
      .filter((group) => group.open)
      .flatMap((group) =>
        group.tasks.filter((item) => item.key !== temporaryEntry?.key).map((item) => item.key),
      )
  const openRow = useCommittedCallback(withEntry(onSelect))
  const splitRow = useCommittedCallback(withEntry((entry) => onSplit?.(entry)))
  const templateRow = useCommittedCallback(
    withEntry((entry, templateId: string) => onTemplate?.(entry, templateId)),
  )
  const createRow = useCommittedCallback(withEntry((entry) => onCreate(entry.projectKey)))
  const filterRow = useCommittedCallback(
    withEntry((entry) => {
      const repository = entry.source.workspace.repositories.find(
        (repo) => repo.id === entry.task.repositoryId,
      )
      onProjectChange(
        repository?.kind === 'scratch' && preferences.projectGrouping
          ? 'scratch'
          : repository?.gitIdentity
            ? `git:${repository.gitIdentity}`
            : entry.projectKey,
      )
      setQuery('')
    }),
  )
  const openSubagent = useCommittedCallback(
    withEntry((entry, id: string) => {
      const child = allEntries.find(
        (item) => item.source.runtimeId === entry.source.runtimeId && item.task.id === id,
      )
      if (child) onSelect(child)
    }),
  )
  const deselectRow = useCommittedCallback(() => onDeselect())
  const rowClickCapture = useCommittedCallback((key: string, event: MouseEvent<HTMLDivElement>) => {
    if (bulkBusy || busy || key === temporaryEntry?.key) return
    if (
      !(event.target instanceof Element) ||
      event.target.closest('button') !== event.currentTarget.querySelector('button')
    )
      return
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
      setSelected((current) => (current.size ? new Set() : current))
      selectionAnchor.current = key
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const order = visibleOrder()
    setSelected((current) =>
      selectTaskKeys(
        current.size || !selectedMainKey ? current : new Set([selectedMainKey]),
        key,
        order,
        selectionAnchor.current,
        event.shiftKey,
        !event.shiftKey || event.metaKey || event.ctrlKey,
      ),
    )
    if (!event.shiftKey) selectionAnchor.current = key
  })
  const rowContextMenuCapture = useCommittedCallback((key: string) => {
    if (key !== temporaryEntry?.key && selecting && !selected.has(key) && !bulkBusy)
      setSelected(new Set([key]))
  })
  const rowActions = useMemo<TaskListRowActions>(
    () => ({
      open: openRow,
      split: splitRow,
      template: templateRow,
      create: createRow,
      filter: filterRow,
      subagent: openSubagent,
      deselect: deselectRow,
      error: setActionError,
      clickCapture: rowClickCapture,
      contextMenuCapture: rowContextMenuCapture,
    }),
    [
      openRow,
      splitRow,
      templateRow,
      createRow,
      filterRow,
      openSubagent,
      deselectRow,
      setActionError,
      rowClickCapture,
      rowContextMenuCapture,
    ],
  )
  const rowCount = groups.reduce((count, group) => count + (group.open ? group.tasks.length : 0), 0)
  const rowWindow = useMemo<TaskListWindow>(
    () => ({
      root: scrollRoot,
      scrollTop,
      height: (key, estimate) => rowHeights.current.get(key) ?? estimate,
      measure: (key, height) => {
        if (height) rowHeights.current.set(key, height)
      },
    }),
    [scrollRoot],
  )
  useEffect(() => {
    for (const key of rowHeights.current.keys())
      if (!entryByKey.has(key)) rowHeights.current.delete(key)
  }, [entryByKey])
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
  const runBulk = useCommittedCallback(bulk)
  // Rows share one menu element; rebuild it only when its count or disabled actions change.
  const blockedKey = selectionActions.map(({ id }) => (blockedAction(id) ? 1 : 0)).join('')
  const selectedCount = selectedEntries.length
  const selectionMenu = useMemo(() => {
    const blocked = (index: number) => blockedKey[index] === '1'
    return (
      <>
        <ContextMenu.Label className="px-2.5 py-1.5 text-xs text-muted-foreground">
          {selectedCount} threads selected
        </ContextMenu.Label>
        {selectionActions.map(({ id, label }, index) =>
          id === 'snooze' ? (
            <ContextMenu.Sub key={id}>
              <ContextMenu.SubTrigger
                disabled={blocked(index)}
                className="rounded-lg px-2.5 py-2 text-xs"
              >
                Snooze
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className="z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                  {taskSnoozeOptions.map((option) => (
                    <ContextMenu.Item
                      key={option.hours}
                      className="rounded-sm px-2 py-1.5 text-xs data-[highlighted]:bg-accent/55"
                      onSelect={() => void runBulk(id, option.hours)}
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
              disabled={blocked(index)}
              onSelect={() => void runBulk(id)}
            >
              {label}
            </ContextMenu.Item>
          ),
        )}
      </>
    )
  }, [selectedCount, blockedKey, runBulk])
  return (
    <aside
      className="studio-task-sidebar flex h-full w-full min-w-0 flex-col border-r bg-sidebar"
      aria-label="Task sidebar"
    >
      <SidebarHeader />
      <div className="shrink-0 space-y-1.5 border-b border-border/40 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
            />
            <Input
              aria-label="Search threads"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search threads…"
              className="h-8 rounded-lg border-border/50 bg-background/40 pl-8 text-xs shadow-none transition-colors placeholder:text-muted-foreground/70 hover:border-border focus-visible:border-ring md:text-xs"
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 rounded-lg bg-accent/50 text-foreground/80 hover:bg-accent hover:text-foreground"
            aria-label="New thread"
            title="New thread"
            onClick={onNewThread}
            disabled={busy}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div
          className="flex min-w-0 items-center gap-1"
          role="group"
          aria-label="Thread filters and organization"
        >
          {sources.length > 1 || environment ? (
            <div className="relative min-w-0 flex-1">
              <Monitor
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <ChoicePicker
                aria-label="Filter threads by computer"
                className="h-7 w-full rounded-md border-transparent bg-transparent pl-7 pr-2 text-xs text-muted-foreground shadow-none hover:bg-accent/40 hover:text-foreground"
                value={environment}
                onValueChange={(value) => {
                  setEnvironment(value)
                  scrollTop.current = 0
                  if (scroll.current) scroll.current.scrollTop = 0
                }}
              >
                <option value="">All computers</option>
                {environment &&
                  !sources.some((source) => JSON.stringify(source.runtimeId) === environment) && (
                    <option value={environment}>Unavailable computer</option>
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
          ) : (
            <span className="min-w-0 flex-1 px-1 text-xs font-medium text-muted-foreground">
              Threads
            </span>
          )}
          <div className="flex shrink-0 items-center gap-0.5 [&_button]:size-7 [&_button]:text-muted-foreground [&_button:hover]:text-foreground">
            <SectionOrderDialog />
            <ProjectsMenu
              compact
              allDevices
              value={projectId}
              onChange={onProjectChange}
              disabled={busy}
            />
          </div>
        </div>
      </div>
      {(error || actionError || searchError) && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error || actionError || searchError}
        </p>
      )}
      <div
        ref={attachScroll}
        onScroll={(event) => {
          scrollTop.current = event.currentTarget.scrollTop
        }}
        className="min-h-0 flex-1 overflow-y-auto px-1.5"
        aria-busy={busy}
      >
        {groups.map((group, index) => {
          // Collapsed sections do not build rows; opening one renders its rows on demand.
          const rows =
            group.open &&
            group.tasks.map((entry) => {
              const facts = rowFacts.get(entry.source.runtimeId)
              const temporary = entry.key === temporaryEntry?.key
              return (
                <TaskListRow
                  key={entry.key}
                  entryKey={entry.key}
                  task={entry.task}
                  owner={
                    owners.get(entry.source.runtimeId) ?? retainTaskOwner(undefined, entry.source)
                  }
                  subagents={
                    entry.key === hidePillsForKey
                      ? noSubagents
                      : (subagentsByKey.get(entry.key) ?? noSubagents)
                  }
                  needsInput={!!facts?.input.has(entry.task.id)}
                  terminals={facts?.terminals.get(entry.task.id) ?? 0}
                  selected={entry.key === selectedId}
                  selectedMain={entry.key === selectedMainKey}
                  selectedChildId={
                    entry.key === selectedMainKey &&
                    selectedEntry &&
                    selectedEntry.task.id !== entry.task.id
                      ? selectedEntry.task.id
                      : undefined
                  }
                  multiSelected={selected.has(entry.key)}
                  editable={!temporary && entry.source.online && !busy}
                  disabled={
                    busy ||
                    bulkBusy ||
                    (!entry.source.online && entry.source.runtimeId !== activeRuntimeId)
                  }
                  menuBusy={busy || temporary}
                  selectionMenu={selecting && !temporary ? selectionMenu : undefined}
                  canSplit={!!onSplit}
                  canTemplate={!!onTemplate}
                  actions={rowActions}
                  rowWindow={rowCount > windowedRowCount ? rowWindow : null}
                  nestedThreads={threadTree.nodes.get(entry.key)?.children ?? []}
                  selectedThreadKey={entry.key === selectedMainKey ? selectedId : undefined}
                  searching={!!deferredQuery.trim()}
                />
              )
            })
          if (index === 0 && group.id === 'active') return <div key={group.id}>{rows}</div>
          return (
            <details key={group.id} open={group.open} className="group mb-1">
              <summary
                onClick={(event) => {
                  // Native toggle events also fire for programmatic reveals. Only save user clicks
                  // (including keyboard activation), leaving temporary expansion out of preferences.
                  event.preventDefault()
                  const open = !group.open
                  if (['working', 'waiting', 'snoozed', 'settled'].includes(group.id)) {
                    const collapsed = new Set(readAppPreferences().collapsedThreadSections)
                    if (open) collapsed.delete(group.id)
                    else collapsed.add(group.id)
                    updateAppPreferences({ collapsedThreadSections: [...collapsed] })
                  } else {
                    setExpanded((current) => ({ ...current, [group.id]: open }))
                  }
                }}
                className="flex cursor-pointer list-none items-center gap-1 px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground"
              >
                <ChevronDown size={11} />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span>{group.total ?? group.tasks.length}</span>
              </summary>
              {rows}
              {group.open &&
                group.id === 'settled' &&
                (group.total ?? 0) > settledThreadPreviewLimit &&
                !query.trim() &&
                !selecting && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mx-2 text-xs text-muted-foreground"
                    onClick={() => setShowAllSettled((value) => !value)}
                  >
                    {showAllSettled
                      ? 'Show fewer settled threads'
                      : `Show all ${group.total} settled threads`}
                  </Button>
                )}
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
