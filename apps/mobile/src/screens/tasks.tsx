import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { CreateBot } from '../bots/bot-create'
import { BotStrip } from '../bots/bot-strip'
import { requestMessageReveal } from '../tasks/conversation/message-reveal'
import {
  taskIsWorking,
  watchRuntimeSettled,
  omittedSettledCount,
  settledSummaryPageSize,
  supportsSettledSummaryPaging,
} from '@dovo/protocol'
import { useTaskSearch } from '../tasks/list/use-task-search'
import { EmptyState } from '../ui/content/empty-state'
import { useTaskPanes } from '../shell/task-panes'
import { contentColumn } from '../ui/layout/content-column'
import {
  orderThreadSections,
  threadDescendants,
  type NestedThread,
  settledThreadPreviewLimit,
  taskGroupOptions,
  taskSortOptions,
} from '@dovo/protocol'
import { SectionOrderSheet } from '../tasks/list/section-order-sheet'
import { useForegroundInterval } from '../runtime/state/app-active'
import { nativeEffect } from '../runtime/state/native-effect'
import {
  updateMobilePreferences,
  setMobileThreadSectionCollapsed,
  useCarMode,
  useMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/state/application-state'
import {
  projectMachineGroups,
  compareTasks,
  isSnoozed,
  resolveTaskAgent,
  runtimeResourceKey,
  type RuntimeTask,
} from '@dovo/protocol'
import { useNavigation } from '../shell/navigation'
import { useKeyboardSearch } from '../shell/keyboard-search'
import { useMoreActions } from '../shell/more-actions'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentRef,
} from 'react'
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { Schema } from 'effect'
import { mutableStruct, responses } from '@dovo/protocol'
import { Text } from '../ui/content/text'
import { useRuntime } from '../runtime/connection/provider'
import { FleetOverview } from '../runtime/connection/fleet-overview'
import { ProjectThreadFilter } from '../tasks/list/project-thread-filter'
import { TaskListRow, type TaskListRowActions } from '../tasks/list/task-list-row'
import {
  taskListProjection,
  mobileThreadTree,
  type TaskListRowData,
} from '../tasks/list/task-list-projection'
import { taskRowStatus } from '../tasks/list/task-row-status'
import { useTaskListView } from '../tasks/list/task-list-view'
import { useListScroll } from '../ui/layout/use-list-scroll'
import { router } from 'expo-router'
import { chooseSnoozeDuration } from '../tasks/detail/use-task-lifecycle'
import { LifecycleActions } from '../tasks/detail/lifecycle-actions'
import { SettingsAction as Action } from './settings-controls'
import { SettingsSearchField as SearchField } from './settings-controls'
import { SettingsChoice as Choice } from './settings-controls'
import { Sheet, type SheetHandle } from '../ui/layout/sheet'
import { Icon } from '../ui/controls/icon'
import { IconButton } from '../ui/controls/icon-button'
import { ScreenHeader } from '../ui/layout/screen-header'
import { useTheme } from '../ui/theme'
type TaskListItem =
  | { kind: 'history'; count: number }
  | { kind: 'group'; key: string; name: string; count: number }
  | { kind: 'task'; entry: RuntimeTask; section?: string }
const sortOptions = taskSortOptions.filter((option) => option.id !== 'status')
export default function TasksScreen({ archived = false }: { archived?: boolean }) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const panes = useTaskPanes()
  const { width } = useWindowDimensions()

  const { navigate, focused } = useNavigation(),
    { refreshAll, overviews, profiles, activeId, readRuntime, ready } = useRuntime()
  const { view, setView, scrollOffset } = useTaskListView()
  const car = useCarMode() && !archived
  const searchInput = useRef<ComponentRef<typeof TextInput>>(null)
  const [searchFocusRequested, setSearchFocusRequested] = useApplicationState(false)
  const focusSearch = useCallback(() => {
    setSearchFocusRequested(true)
  }, [setSearchFocusRequested])
  useEffect(() => {
    if (!searchFocusRequested) return
    searchInput.current?.focus()
    setSearchFocusRequested(false)
  }, [searchFocusRequested, setSearchFocusRequested])
  useKeyboardSearch(focusSearch, focused && !archived && !car && ready && profiles.length > 0)
  const moreActions = useMoreActions(navigate)
  // List ordering and grouping follow Settings → General.
  const preferences = useMobilePreferences()
  const grouping = archived || car ? 'none' : preferences.taskGrouping
  // Car mode shows what needs attention first; search, filters and project scope wait.
  const { search, source, sort, project } = archived
    ? { ...view, source: 'all', sort: 'newest', project: '' }
    : car
      ? { ...view, search: '', sort: 'priority', project: '' }
      : { ...view, sort: preferences.taskSort }
  const [creatingBot, setCreatingBot] = useApplicationState(false)
  const [organizing, setOrganizing] = useApplicationState(false)
  const [filtering, setFiltering] = useApplicationState(false)
  const filterSheet = useRef<SheetHandle>(null)
  const filtersActive = !!(search.trim() || project || (!archived && source !== 'all'))
  const [showAllSettled, setShowAllSettled] = useApplicationState(false)
  const [settledLimit, setSettledLimit] = useApplicationState(settledSummaryPageSize)
  const [details, setDetails] = useApplicationState(''),
    [now, setNow] = useApplicationState(Date.now())
  const [selected, setSelected] = useApplicationState<Set<string>>(() => new Set())
  const selecting = !car && selected.size > 0
  const toggleSelected = (key: string) =>
    setSelected((current) => {
      if (allTasks.find((item) => item.key === key)?.task.replica) return current
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else {
        next.add(key)
        if (key === 'settled') {
          setShowAllSettled(false)
          setSettledLimit(settledSummaryPageSize)
        }
      }
      return next
    })
  const [bulkBusy, setBulkBusy] = useApplicationState(false)
  const collapsed = useMemo(
    () => new Set(preferences.collapsedThreadSections),
    [preferences.collapsedThreadSections],
  )
  useForegroundInterval(() => setNow(Date.now()), focused ? 15000 : null)
  useEffect(() => {
    if (source !== 'all' && !profiles.some((profile) => profile.id === source)) {
      scrollOffset.current = 0
      setView((current) => ({
        ...current,
        source: 'all',
      }))
    }
  }, [profiles, source, setView, scrollOffset])
  const query = useDeferredValue(search.trim().toLowerCase())
  const [refreshing, setRefreshing] = useApplicationState(false)
  const [refreshError, setRefreshError] = useApplicationState('')
  const entries = useMemo(
    () => (source === 'all' ? overviews : overviews.filter((entry) => entry.profile.id === source)),
    [overviews, source],
  )
  const listLimit =
    archived ||
    project ||
    query ||
    selecting ||
    source !== 'all' ||
    !supportsSettledSummaryPaging(sort)
      ? undefined
      : settledLimit
  const pagingConnections = JSON.stringify(overviews.map((entry) => entry.profile.connection))
  const listConnections = useEffectEvent(() => overviews.map((entry) => entry.profile.connection))
  useEffect(() => {
    const stops = listConnections().map((connection) => watchRuntimeSettled(connection, listLimit))
    return () => stops.forEach((stop) => stop())
  }, [pagingConnections, listLimit])
  const omittedSettled = useMemo(
    () =>
      listLimit === undefined
        ? 0
        : omittedSettledCount(
            overviews.map((entry) => ({
              runtimeId:
                entry.snapshot?.runtimeId ?? entry.profile.connection.runtimeId ?? entry.profile.id,
              tasks: entry.snapshot?.workspace.tasks ?? [],
              page: entry.snapshot?.olderSettled,
            })),
          ),
    [listLimit, overviews],
  )
  const historySearch = useTaskSearch(entries, query, focused)
  const searchKeys = JSON.stringify([...historySearch.keys].sort())
  const searchFilter = useMemo(
    () => (query ? { query, keys: historySearch.keys } : undefined),
    [query, searchKeys],
  )
  const projectGroups = useMemo(
    () =>
      projectMachineGroups(
        entries.flatMap((entry) =>
          (entry.snapshot?.workspace.repositories ?? []).map((repository) => ({
            repository,
            runtimeId: entry.profile.id,
          })),
        ),
      ),
    [entries],
  )
  const projectMembers = useMemo(
    () =>
      new Set(
        projectGroups
          .find((group) => group.key === project)
          ?.entries.map(({ runtimeId, repository }) =>
            runtimeResourceKey(runtimeId, repository.id),
          ) ?? [],
      ),
    [projectGroups, project],
  )
  const previousRows = useRef<ReadonlyMap<string, TaskListRowData>>(new Map())
  const rowData = useMemo(
    () => taskListProjection(overviews, now, previousRows.current),
    [overviews, now],
  )
  useLayoutEffect(() => {
    previousRows.current = rowData
  }, [rowData])
  const allTasks = useMemo(
    () => [...rowData.values()].filter((entry) => !entry.row.task.bot).map((entry) => entry.row),
    [rowData],
  )
  const previousTree = useRef<ReadonlyMap<string, NestedThread>>(new Map())
  const tree = useMemo(
    () =>
      mobileThreadTree(
        rowData,
        overviews,
        previousTree.current,
        (row) =>
          !row.task.bot &&
          (source === 'all' || row.runtimeId === source) &&
          (!project ||
            projectMembers.has(runtimeResourceKey(row.runtimeId, row.task.repositoryId))) &&
          (archived ? !!row.task.archivedAt : !row.task.archivedAt),
        (child) =>
          !archived &&
          (source === 'all' || child.runtimeId === source) &&
          (!project ||
            (!!child.runtimeId &&
              !!child.repositoryId &&
              projectMembers.has(runtimeResourceKey(child.runtimeId, child.repositoryId))) ||
            (!!child.projectIdentity && project === child.projectIdentity) ||
            (project === 'scratch' && child.projectKind === 'scratch')),
      ),
    [rowData, overviews, source, project, projectMembers, archived],
  )
  useLayoutEffect(() => {
    previousTree.current = tree.nodes
  }, [tree])
  const detail = allTasks.find((item) => item.key === details)
  const detailRuntime = overviews.find((entry) => entry.profile.id === detail?.runtimeId)
  const detailAgent =
    detail && resolveTaskAgent(detail.task, detailRuntime?.snapshot?.workspace.agents ?? [])
  const tasks = useMemo(() => {
    const needsInput = new Set(tree.roots.filter((row) => row.needsInput).map((row) => row.key))
    const projects = new Map(allTasks.map((row) => [row.key, row.projectName]))
    return tree.roots
      .filter(
        ({ key, task, needsInput, projectName, runtimeName, runtimeId }) =>
          !task.bot &&
          (tree.contextKeys.has(key) ||
            ((source === 'all' || runtimeId === source) &&
              (!project ||
                projectMembers.has(runtimeResourceKey(runtimeId, task.repositoryId))))) &&
          (tree.contextKeys.has(key) || (archived ? !!task.archivedAt : !task.archivedAt)) &&
          (!car ||
            task.pinned ||
            (!task.archived &&
              !isSnoozed(task, now) &&
              (!task.waitingForFeedback || taskIsWorking(task) || needsInput))) &&
          (!query ||
            historySearch.keys.has(key) ||
            threadDescendants(tree.nodes.get(key)?.children ?? []).some((child) =>
              historySearch.keys.has(child.key),
            ) ||
            [
              task.title,
              projectName,
              runtimeName,
              ...task.messages.map((message) => message.text),
              ...threadDescendants(tree.nodes.get(key)?.children ?? []).flatMap((child) => [
                child.title,
                child.computerName,
                child.projectName ?? '',
              ]),
            ].some((text) => text.toLowerCase().includes(query))),
      )
      .sort((a, b) => {
        if (archived)
          return (
            Number(!!b.task.pinned) - Number(!!a.task.pinned) ||
            (b.task.archivedAt ?? '').localeCompare(a.task.archivedAt ?? '') ||
            a.key.localeCompare(b.key)
          )
        // The protocol comparator sees scoped task/project IDs, even if hosts have identical data IDs.
        const first = {
            ...a.task,
            id: a.key,
            repositoryId: a.key,
          },
          second = {
            ...b.task,
            id: b.key,
            repositoryId: b.key,
          }
        return compareTasks(first, second, sort, needsInput, projects)
      })
  }, [allTasks, tree, source, car, now, query, sort, project, projectMembers, archived, searchKeys])
  const listItems = useMemo(() => {
    if (archived || car) return tasks.map((entry): TaskListItem => ({ kind: 'task', entry }))
    const orderedItems = (sections: { key: string; items: TaskListItem[] }[]) =>
      orderThreadSections(
        sections.filter((section) => section.items.length),
        (group) => group.key,
        preferences.threadSectionOrder,
      ).flatMap((section, index) => {
        const items = section.items.map((item): TaskListItem =>
          item.kind === 'task' ? { ...item, section: section.key } : item,
        )
        if (section.key !== 'active' || grouping === 'project') return items
        if (index === 0 && !collapsed.has('active'))
          return items.filter((item) => item.kind === 'task')
        return collapsed.has('active') ? items.filter((item) => item.kind === 'group') : items
      })
    const pinned = tasks.filter(({ task }) => task.pinned)
    const pinnedItems: TaskListItem[] = pinned.length
      ? [
          { kind: 'group', key: 'pinned', name: uiText('Pinned'), count: pinned.length },
          ...(collapsed.has('pinned')
            ? []
            : pinned.map((entry): TaskListItem => ({ kind: 'task', entry }))),
        ]
      : []
    const attention = tasks.filter(
      ({ task, needsInput }) => !task.pinned && needsInput && !task.archived,
    )
    const attentionItems: TaskListItem[] = attention.length
      ? [
          {
            kind: 'group',
            key: 'needs-input',
            name: uiText('Needs input'),
            count: attention.length,
          },
          ...(collapsed.has('needs-input')
            ? []
            : attention.map((entry): TaskListItem => ({ kind: 'task', entry }))),
        ]
      : []
    const active = tasks.filter(
      ({ task, needsInput }) =>
        !task.pinned &&
        !needsInput &&
        !task.archived &&
        !isSnoozed(task, now) &&
        (!task.waitingForFeedback || taskIsWorking(task)),
    )
    const working = preferences.workingSection
      ? active.filter(({ task, needsInput }) => !task.pinned && taskIsWorking(task) && !needsInput)
      : []
    const workingKeys = new Set(working.map((entry) => entry.key))
    const unsettled = active.filter((entry) => !workingKeys.has(entry.key))
    const workingItems: TaskListItem[] = working.length
      ? [
          { kind: 'group', key: 'working', name: uiText('Working'), count: working.length },
          ...(collapsed.has('working')
            ? []
            : working.map((entry): TaskListItem => ({ kind: 'task', entry }))),
        ]
      : []
    const waiting = tasks.filter(
      ({ task, needsInput }) =>
        !task.pinned &&
        task.waitingForFeedback &&
        !taskIsWorking(task) &&
        !needsInput &&
        !task.archived &&
        !isSnoozed(task, now),
    )
    const waitingItems: TaskListItem[] = waiting.length
      ? [
          { kind: 'group', key: 'waiting', name: uiText('Waiting'), count: waiting.length },
          ...(collapsed.has('waiting')
            ? []
            : waiting.map((entry): TaskListItem => ({ kind: 'task', entry }))),
        ]
      : []
    const snoozed = tasks.filter(
      ({ task, needsInput }) =>
        !task.pinned && !needsInput && !task.archived && isSnoozed(task, now),
    )
    const settled = tasks.filter(({ task }) => !task.pinned && task.archived)
    const snoozedItems: TaskListItem[] = snoozed.length
      ? [
          { kind: 'group', key: 'snoozed', name: uiText('Snoozed'), count: snoozed.length },
          ...(collapsed.has('snoozed')
            ? []
            : snoozed.map((entry): TaskListItem => ({ kind: 'task', entry }))),
        ]
      : []
    const settledItems: TaskListItem[] =
      settled.length + omittedSettled
        ? [
            {
              kind: 'group',
              key: 'settled',
              name: uiText('Settled'),
              count: settled.length + omittedSettled,
            },
            ...(collapsed.has('settled')
              ? []
              : [
                  ...settled
                    .slice(
                      0,
                      showAllSettled || query.trim() || selecting
                        ? undefined
                        : settledThreadPreviewLimit,
                    )
                    .map((entry): TaskListItem => ({ kind: 'task', entry })),
                  ...(settled.length + omittedSettled > settledThreadPreviewLimit &&
                  !query.trim() &&
                  !selecting
                    ? [
                        {
                          kind: 'history',
                          count: settled.length + omittedSettled,
                        } satisfies TaskListItem,
                      ]
                    : []),
                ]),
          ]
        : []
    const otherSections = [
      { key: 'pinned', items: pinnedItems },
      { key: 'needs-input', items: attentionItems },
      { key: 'working', items: workingItems },
      { key: 'waiting', items: waitingItems },
      { key: 'snoozed', items: snoozedItems },
      { key: 'settled', items: settledItems },
    ]
    if (grouping === 'none')
      return orderedItems([
        {
          key: 'active',
          items: unsettled.length
            ? ([
                { kind: 'group', key: 'active', name: uiText('Open'), count: unsettled.length },
                ...unsettled.map((entry): TaskListItem => ({ kind: 'task', entry })),
              ] satisfies TaskListItem[])
            : [],
        },
        ...otherSections,
      ])
    const groups: { key: string; name: string; tasks: RuntimeTask[] }[] = []
    if (grouping === 'status') {
      groups.push({
        key: 'active',
        name: uiText('Open'),
        tasks: unsettled.filter(({ task }) => !task.pinned),
      })
    } else {
      const identities = new Map(
        projectGroups.flatMap((group) =>
          group.entries.map(
            ({ runtimeId, repository }) =>
              [
                runtimeResourceKey(runtimeId, repository.id),
                {
                  key: group.key,
                  name: repository.kind === 'scratch' ? uiText('No Project') : group.name,
                },
              ] as const,
          ),
        ),
      )
      const projects = new Map<string, (typeof groups)[number]>()
      for (const entry of unsettled) {
        const identity = identities.get(
          runtimeResourceKey(entry.runtimeId, entry.task.repositoryId),
        )
        const key = identity?.key ?? runtimeResourceKey(entry.runtimeId, entry.task.repositoryId)
        const group = projects.get(key) ?? {
          key,
          name: identity?.name ?? entry.projectName,
          tasks: [],
        }
        group.tasks.push(entry)
        projects.set(key, group)
      }
      groups.push(
        ...[...projects.values()].sort(
          (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
        ),
      )
    }
    return orderedItems([
      ...groups
        .filter((group) => group.tasks.length)
        .map((group) => ({
          key: grouping === 'status' ? group.key : 'active',
          items: [
            { kind: 'group', key: group.key, name: group.name, count: group.tasks.length },
            ...(group.key !== 'active' && collapsed.has(`${grouping}:${group.key}`)
              ? []
              : group.tasks.map((entry): TaskListItem => ({ kind: 'task', entry }))),
          ] satisfies TaskListItem[],
        })),
      ...otherSections,
    ])
  }, [
    tasks,
    grouping,
    now,
    projectGroups,
    collapsed,
    archived,
    car,
    showAllSettled,
    omittedSettled,
    query,
    selecting,
    preferences.workingSection,
    preferences.threadSectionOrder,
    uiText,
  ])
  const sectionKey = (key: string) =>
    ['settled', 'snoozed', 'working', 'waiting', 'needs-input', 'active'].includes(key)
      ? key
      : `${grouping}:${key}`
  // Only trailing collapsed sections can move to the bottom without changing their order.
  let footerStart = listItems.length
  while (footerStart > 0) {
    const item = listItems[footerStart - 1]
    if (item.kind !== 'group' || !collapsed.has(sectionKey(item.key))) break
    footerStart--
  }
  const expandedItems = listItems.slice(0, footerStart)
  const collapsedHeaders = listItems
    .slice(footerStart)
    .filter((item): item is Extract<TaskListItem, { kind: 'group' }> => item.kind === 'group')
  const renderSectionHeader = (item: Extract<TaskListItem, { kind: 'group' }>) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={uiText('{value0}, {value1} tasks', {
        value0: item.name,
        value1: item.count,
      })}
      accessibilityState={{
        expanded: !collapsed.has(sectionKey(item.key)),
      }}
      onPress={() => {
        const key = sectionKey(item.key)
        const closing = !collapsed.has(key)
        setMobileThreadSectionCollapsed(key, closing)
        if (closing && key === 'settled') {
          setShowAllSettled(false)
          setSettledLimit(settledSummaryPageSize)
        }
      }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        paddingVertical: 8,
        paddingHorizontal: 12,
      }}
    >
      <Icon
        name={collapsed.has(sectionKey(item.key)) ? 'next' : 'down'}
        size={12}
        color={colors.muted}
      />
      <Text
        numberOfLines={1}
        style={[styles.muted, { flexShrink: 1, fontSize: 12, fontWeight: '500' }]}
      >
        {item.name}
      </Text>
      <Text style={[styles.muted, { fontSize: 11 }]}>{item.count}</Text>
    </Pressable>
  )
  const bulk = async (
    action: 'archive' | 'restore' | 'snooze' | 'pin' | 'delete',
    until?: string,
  ) => {
    const chosen = allTasks.filter((item) => !item.task.replica && selected.has(item.key))
    if (!chosen.length || bulkBusy) return
    if (action === 'snooze' && until === undefined) throw new Error('Choose a snooze duration.')
    setBulkBusy(true)
    try {
      for (const item of chosen) {
        const profile = profiles.find((entry) => entry.id === item.runtimeId)
        if (!profile) throw new Error(`${item.runtimeName} is unavailable`)
        if (action === 'archive' || action === 'restore' || action === 'delete')
          await readRuntime(
            profile,
            '/api/tasks/lifecycle',
            { id: item.task.id, action },
            responses.ok,
          )
        else {
          const field = action === 'pin' ? 'pinned' : 'snoozedUntil'
          const before =
            action === 'pin' ? (item.task.pinned ?? null) : (item.task.snoozedUntil ?? null)
          const after = action === 'pin' ? true : until!
          await readRuntime(
            profile,
            '/api/workspace',
            {
              collection: 'tasks',
              id: item.task.id,
              changes: { [field]: { before, after } },
            },
            mutableStruct({ revision: Schema.Number.pipe(Schema.check(Schema.isFinite())) }),
            'PATCH',
          )
        }
      }
      setSelected(new Set())
    } catch (cause) {
      Alert.alert(
        uiText('Bulk action stopped'),
        cause instanceof Error ? cause.message : String(cause),
      )
    } finally {
      await refreshAll().catch(() => undefined)
      setBulkBusy(false)
    }
  }
  const chooseBulk = (action: 'archive' | 'restore' | 'snooze' | 'pin' | 'delete') => {
    if (action === 'snooze')
      return chooseSnoozeDuration('Snooze selected threads', (until) => void bulk(action, until))
    if (action === 'delete')
      Alert.alert(
        uiText('Delete selected threads?'),
        uiText(
          '{value0} threads will be deleted. This cannot be undone. Clean Dovo-created worktrees follow each computer’s cleanup setting.',
          { value0: selected.size },
        ),
        [
          { text: uiText('Cancel'), style: 'cancel' },
          { text: uiText('Delete'), style: 'destructive', onPress: () => void bulk(action) },
        ],
      )
    else void bulk(action)
  }
  const { retainPosition, ...listScroll } = useListScroll<TaskListItem>(scrollOffset, focused)
  const openTask = (item: (typeof allTasks)[number]) => {
    retainPosition()
    setDetails('')
    // The route owns its computer scope. Saving a global selection must not delay a tap.
    navigate('tasks', item.task.id, item.runtimeId)
  }
  const openMessage = (hit: (typeof historySearch.hits)[number]) => {
    const owner = entries.find((entry) => entry.profile.id === hit.runtimeId)
    if (!owner?.connected) return
    retainPosition()
    requestMessageReveal(owner.profile.connection, hit.taskId, hit.messageId)
    navigate('tasks', hit.taskId, hit.runtimeId)
  }
  const messageHits = historySearch.hits.flatMap((hit) => {
    const owner = entries.find((entry) => entry.profile.id === hit.runtimeId)
    const task = owner?.snapshot?.workspace.tasks.find((task) => task.id === hit.taskId)
    if (!owner || (task && !!task.archivedAt !== archived)) return []
    if (
      project &&
      (!task ||
        !(project === 'scratch'
          ? !task.repositoryId
          : projectMembers.has(runtimeResourceKey(hit.runtimeId, task.repositoryId))))
    )
      return []
    return [{ ...hit, owner, task }]
  })
  const commands: TaskListRowActions = {
    open: (key) => {
      if (selecting) return toggleSelected(key)
      const item = rowData.get(key)?.row
      if (item) openTask(item)
    },
    details: (key) => setDetails(key),
    select: toggleSelected,
  }
  const latestCommands = useRef(commands)
  useLayoutEffect(() => {
    latestCommands.current = commands
  })
  const rowCommands = useMemo<TaskListRowActions>(
    () => ({
      open: (key) => latestCommands.current.open(key),
      details: (key) => latestCommands.current.details(key),
      select: (key) => latestCommands.current.select(key),
    }),
    [],
  )
  if (ready && !profiles.length && !archived) return <Welcome />
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={archived ? uiText('Archived threads') : uiText('Threads')}
        titleContent={
          !car ? (
            <View
              style={{ width: panes.expanded ? '100%' : Math.min(600, width - 144), minWidth: 0 }}
            >
              <SearchField
                inputRef={searchInput}
                label={archived ? uiText('Search archived threads') : uiText('Search threads')}
                placeholder={uiText('Search threads')}
                style={{ fontSize: 15 }}
                clearButtonMode="while-editing"
                returnKeyType="search"
                value={search}
                onChangeText={(search) => {
                  scrollOffset.current = 0
                  setView((current) => ({ ...current, search }))
                }}
              />
            </View>
          ) : undefined
        }
        buttons={
          archived
            ? [
                {
                  label: uiText('Filters'),
                  icon: 'filters',
                  selected: filtersActive,
                  onPress: () => setFiltering(true),
                },
              ]
            : [
                ...(car
                  ? []
                  : [
                      {
                        label: uiText('Filters'),
                        icon: 'filters' as const,
                        selected: filtersActive,
                        onPress: () => setFiltering(true),
                      },
                      {
                        label: uiText('Projects'),
                        icon: 'projects' as const,
                        overflow: true,
                        onPress: () => {
                          retainPosition()
                          navigate('scm')
                        },
                      },
                    ]),
                ...(car
                  ? [
                      {
                        label: uiText('Exit car mode'),
                        icon: 'car' as const,
                        selected: true,
                        onPress: () => updateMobilePreferences({ carMode: false }),
                      },
                    ]
                  : []),
                ...(panes.expanded
                  ? [
                      {
                        label: uiText('New thread'),
                        icon: 'add' as const,
                        disabled: !overviews.some((entry) => entry.connected),
                        onPress: () => router.push('/new', { withAnchor: true }),
                      },
                    ]
                  : []),
                {
                  label: uiText('Quick task'),
                  icon: 'jobs',
                  overflow: true,
                  onPress: () => router.push('/launch'),
                },
                ...moreActions,
              ]
        }
      />
      {selecting && (
        <View
          testID="Task selection toolbar"
          style={{
            ...contentColumn.collection,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 4,
            backgroundColor: colors.background,
          }}
        >
          <Text style={[styles.muted, { flex: 1, fontSize: 12 }]}>
            <InterfaceText values={{ value0: selected.size }}>{'{value0} selected'}</InterfaceText>
          </Text>
          {(archived
            ? (['restore', 'delete'] as const)
            : (['archive', 'snooze', 'pin', 'delete'] as const)
          ).map((action) => (
            <Action
              key={action}
              secondary
              label={
                {
                  archive: uiText('Archive selected tasks'),
                  restore: uiText('Restore selected tasks'),
                  snooze: uiText('Snooze selected tasks'),
                  pin: uiText('Pin selected tasks'),
                  delete: uiText('Delete selected tasks'),
                }[action]
              }
              destructive={action === 'delete'}
              icon={
                (
                  {
                    archive: 'archive',
                    restore: 'reopen',
                    snooze: 'snooze',
                    pin: 'pin',
                    delete: 'trash',
                  } as const
                )[action]
              }
              disabled={!selected.size || bulkBusy}
              onPress={() => chooseBulk(action)}
            />
          ))}
          <IconButton
            label={uiText('Clear task selection')}
            icon="close"
            disabled={bulkBusy}
            onPress={() => setSelected(new Set())}
          />
        </View>
      )}
      {filtering && !car && (
        <Sheet
          ref={filterSheet}
          title={uiText('Filter threads')}
          onClose={() => setFiltering(false)}
        >
          {!archived && (
            <>
              <ProjectThreadFilter
                value={project}
                onChange={(project) => {
                  scrollOffset.current = 0
                  setView((current) => ({ ...current, project }))
                }}
              />
              <FleetOverview
                compact
                source={source}
                entries={overviews}
                onSelectSource={(source) => {
                  scrollOffset.current = 0
                  setView((current) => ({ ...current, source }))
                }}
              />
            </>
          )}
          {filtersActive && (
            <Action
              secondary
              label={uiText('Clear filters')}
              onPress={() => {
                scrollOffset.current = 0
                setView((current) => ({ ...current, search: '', project: '', source: 'all' }))
              }}
            />
          )}
          {!archived && (
            <>
              <Choice
                label={uiText('Sort by')}
                value={preferences.taskSort}
                items={sortOptions.map((option) => ({ ...option, name: uiText(option.name) }))}
                onChange={(value) => {
                  const option = sortOptions.find((option) => option.id === value)
                  if (!option) return
                  scrollOffset.current = 0
                  updateMobilePreferences({ taskSort: option.id })
                  setView((current) => ({ ...current, sort: option.id }))
                }}
              />
              <Choice
                label={uiText('Group by')}
                value={preferences.taskGrouping}
                items={taskGroupOptions.map((option) => ({ ...option, name: uiText(option.name) }))}
                onChange={(value) => {
                  const option = taskGroupOptions.find((option) => option.id === value)
                  if (!option) return
                  scrollOffset.current = 0
                  updateMobilePreferences({ taskGrouping: option.id })
                }}
              />
              <Action
                secondary
                label={uiText('Organize sections')}
                onPress={() => filterSheet.current?.dismiss(() => setOrganizing(true))}
              />
            </>
          )}
        </Sheet>
      )}
      {creatingBot && (
        <CreateBot
          onClose={() => setCreatingBot(false)}
          onCreated={(id, runtimeId) => {
            setCreatingBot(false)
            navigate('tasks', id, runtimeId)
          }}
        />
      )}
      {organizing && <SectionOrderSheet onClose={() => setOrganizing(false)} />}
      <FlatList
        {...listScroll}
        contentInsetAdjustmentBehavior="automatic"
        data={expandedItems}
        testID="Task list"
        scrollEventThrottle={32}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true)
          setRefreshError('')
          void runClientEffect(
            nativeEffect(() => refreshAll())
              .pipe(
                Effect.catch((error) =>
                  nativeEffect(() =>
                    setRefreshError(error instanceof Error ? error.message : String(error)),
                  ),
                ),
              )
              .pipe(Effect.ensuring(nativeEffect(() => setRefreshing(false)).pipe(Effect.orDie))),
          )
        }}
        initialNumToRender={12}
        windowSize={7}
        keyExtractor={(item) =>
          item.kind === 'history'
            ? 'settled-history'
            : item.kind === 'group'
              ? `group:${grouping}:${item.key}`
              : item.entry.key
        }
        contentContainerStyle={[
          styles.content,
          contentColumn.collection,
          {
            gap: 0,
            paddingTop: 0,
            flexGrow: 1,
          },
        ]}
        ListHeaderComponent={
          <View style={{ gap: 4 }}>
            {!archived && !car && (
              <BotStrip
                onCreate={() => setCreatingBot(true)}
                createDisabled={
                  !overviews.some((owner) => owner.connected && owner.snapshot?.botsSupported)
                }
                entries={[...rowData.values()].filter(
                  ({ row }) =>
                    row.task.bot &&
                    !row.task.archivedAt &&
                    !row.task.delegation &&
                    !row.task.replica &&
                    (source === 'all' || row.runtimeId === source) &&
                    `${row.task.title} ${row.task.bot.role} ${row.runtimeName}`
                      .toLowerCase()
                      .includes(query.trim().toLowerCase()),
                )}
                onOpen={(id, runtimeId) => navigate('tasks', id, runtimeId)}
              />
            )}
            {!!(refreshError || historySearch.error) && (
              <Text accessibilityRole="alert" style={[styles.error, { paddingBottom: 10 }]}>
                {refreshError || historySearch.error}
              </Text>
            )}
            {historySearch.loading && (
              <Text accessibilityRole="status" style={styles.muted}>
                <InterfaceText>{'Searching conversation history…'}</InterfaceText>
              </Text>
            )}
            {historySearch.offline && (
              <Text style={styles.muted}>
                <InterfaceText>
                  {'Offline computers: searching saved thread details only.'}
                </InterfaceText>
              </Text>
            )}
            {!!query && !!messageHits.length && (
              <View
                accessibilityLabel={uiText('Message results')}
                style={{ gap: 6, paddingVertical: 10 }}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>
                  <InterfaceText>{'Messages'}</InterfaceText>
                </Text>
                {messageHits.map((hit) => (
                  <Pressable
                    key={JSON.stringify([hit.runtimeId, hit.taskId, hit.messageId])}
                    accessibilityRole="button"
                    accessibilityLabel={uiText('Open {value0} message in {value1} on {value2}', {
                      value0: hit.role,
                      value1: hit.task?.title ?? 'thread',
                      value2: hit.owner.profile.name,
                    })}
                    disabled={!hit.owner.connected}
                    onPress={() => openMessage(hit)}
                    style={{
                      padding: 12,
                      gap: 4,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 10,
                      opacity: hit.owner.connected ? 1 : 0.6,
                    }}
                  >
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600' }}>
                      {hit.task?.title ?? uiText('Thread')}
                    </Text>
                    <Text style={styles.muted}>
                      {hit.owner.profile.name} · {hit.role}
                      {hit.task?.delegation || hit.task?.spawnParent
                        ? uiText(' · Child thread')
                        : ''}
                    </Text>
                    <Text numberOfLines={3} style={{ color: colors.text }}>
                      {hit.snippet}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        }
        renderItem={({ item, index }) =>
          item.kind === 'history' ? (
            <Action
              label={
                showAllSettled
                  ? omittedSettled
                    ? uiText('Load more settled threads')
                    : uiText('Show fewer settled threads')
                  : omittedSettled
                    ? uiText('Show more settled threads')
                    : uiText('Show all {value0} settled threads', { value0: item.count })
              }
              onPress={() => {
                if (!showAllSettled) setShowAllSettled(true)
                else if (omittedSettled)
                  setSettledLimit((value) => Math.min(100000, value + settledSummaryPageSize))
                else {
                  setShowAllSettled(false)
                  setSettledLimit(settledSummaryPageSize)
                }
              }}
              secondary
            />
          ) : item.kind === 'group' ? (
            renderSectionHeader(item)
          ) : (
            <View
              style={[
                !archived &&
                  (index === 0 || expandedItems[index - 1]?.kind === 'group') && { paddingTop: 4 },
                archived
                  ? {
                      backgroundColor:
                        selecting && selected.has(item.entry.key)
                          ? colors.elevated
                          : colors.background,
                      borderRadius: 12,
                      overflow: 'hidden',
                      marginBottom: 12,
                      padding: 4,
                    }
                  : selecting && selected.has(item.entry.key)
                    ? { backgroundColor: colors.elevated, borderRadius: 10 }
                    : undefined,
              ]}
            >
              <TaskListRow
                density={preferences.threadDensity ?? 'compact'}
                row={rowData.get(item.entry.key)!.row}
                needsInput={item.entry.needsInput}
                thread={tree.nodes.get(item.entry.key)}
                searching={!!query}
                search={searchFilter}
                owner={rowData.get(item.entry.key)!.owner}
                commands={rowCommands}
                now={now}
                testID={
                  profiles.length === 1 ? `Task ${item.entry.task.id}` : `Task ${item.entry.key}`
                }
                disabled={bulkBusy}
                showDevice={profiles.length > 1}
                selectionActive={selecting}
                selected={selected.has(item.entry.key)}
                current={
                  !selecting &&
                  panes.expanded &&
                  panes.selected?.runtimeId === item.entry.runtimeId &&
                  panes.selected.taskId === item.entry.task.id
                }
              />
            </View>
          )
        }
        ListFooterComponentStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
        ListFooterComponent={
          collapsedHeaders.length ? (
            <View accessibilityLabel={uiText('Collapsed thread categories')}>
              {collapsedHeaders.map((item) => (
                <View key={item.key}>{renderSectionHeader(item)}</View>
              ))}
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          listItems.length || historySearch.loading ? undefined : archived ? (
            <EmptyState
              icon="archive"
              title={
                search ? uiText('No matching archived threads') : uiText('No archived threads')
              }
              description={
                search
                  ? uiText('Try a different search.')
                  : uiText('Archived threads appear here. Restore them from the three-dot menu.')
              }
              action={
                !!search && (
                  <Action
                    secondary
                    label={uiText('Clear search')}
                    onPress={() => setView((current) => ({ ...current, search: '' }))}
                  />
                )
              }
            />
          ) : (
            <EmptyState
              icon="tasks"
              title={
                filtersActive
                  ? uiText('No matching threads')
                  : entries.some((entry) => !entry.snapshot)
                    ? uiText('Waiting for your computers')
                    : uiText('Ready for your next idea')
              }
              description={
                filtersActive
                  ? uiText('Try a different search or clear your filters.')
                  : entries.some((entry) => !entry.snapshot)
                    ? uiText('Threads will appear when your computer connects.')
                    : uiText('Start with a question, a fix, or something you want to build.')
              }
              action={
                filtersActive ? (
                  <Action
                    label={uiText('Clear filters')}
                    secondary
                    onPress={() => {
                      scrollOffset.current = 0
                      setView((current) => ({ ...current, search: '', project: '', source: 'all' }))
                    }}
                  />
                ) : (
                  <Action
                    label={uiText('New thread')}
                    disabled={!overviews.some((entry) => entry.connected)}
                    onPress={() => router.push('/new', { withAnchor: true })}
                  />
                )
              }
            />
          )
        }
      />
      {detail && (
        <Sheet title={uiText('Task details')} onClose={() => setDetails('')}>
          <Text style={styles.title}>{detail.task.title}</Text>
          <Text style={styles.muted}>
            {detail.projectName}
            {rowData.get(detail.key)?.owner.repository?.kind !== 'scratch' &&
              ` · ${detail.task.checkoutBranch ?? uiText('Project checkout')}`}
          </Text>
          <Text style={styles.muted}>
            {detail.runtimeName} ·{' '}
            {detail.online
              ? uiText('Online')
              : detail.reachability === 'offline'
                ? uiText('Offline')
                : uiText('Connecting…')}
          </Text>
          {!!detailAgent && (
            <Text style={styles.muted}>
              {detailAgent.provider}
              {detailAgent.model ? ` · ${detailAgent.model}` : ''}
            </Text>
          )}
          <Text style={styles.muted}>
            <InterfaceText
              values={{
                value0: taskRowStatus(detail.task, detail.needsInput, detail.online, now),
                value1: detail.task.queue?.length ?? 0,
              }}
            >
              {'{value0} · {value1} queued messages'}
            </InterfaceText>
          </Text>
          <LifecycleActions task={detail.task} runtimeId={detail.runtimeId} allowReadState />
          {detail.runtimeId !== activeId && (
            <Action label={uiText('Open task')} onPress={() => openTask(detail)} />
          )}
        </Sheet>
      )}
    </View>
  )
}

/** First run: one clear step instead of a settings list full of disabled rows. */
function Welcome() {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const { navigate } = useNavigation()
  const moreActions = useMoreActions(navigate)

  return (
    <View style={styles.screen}>
      <ScreenHeader title={uiText('Threads')} buttons={moreActions} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 24 }}
      >
        <View style={{ alignItems: 'center', gap: 12 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(165, 180, 252, 0.14)',
            }}
          >
            <Icon name="device" size={30} color={colors.accent} />
          </View>
          <Text style={[styles.largeTitle, { fontSize: 26, textAlign: 'center' }]}>
            <InterfaceText>{'Connect your computer'}</InterfaceText>
          </Text>
          <Text style={[styles.muted, { fontSize: 15, lineHeight: 21, textAlign: 'center' }]}>
            <InterfaceText>
              {
                'Dovo runs your agents on your own computer. Pair this phone once to follow tasks, answer questions and review changes from anywhere on your Wi-Fi or VPN.'
              }
            </InterfaceText>
          </Text>
        </View>
        <View style={{ gap: 10 }}>
          <Action
            wide
            label={uiText('Connect a computer')}
            onPress={() => router.push({ pathname: '/settings/devices', params: { pair: '1' } })}
          />
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            <InterfaceText>
              {'You’ll need Dovo open on your computer to get a pairing code.'}
            </InterfaceText>
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}
