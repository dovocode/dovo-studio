import { nativeEffect, mobileWorkflow } from '../runtime/state/native-effect'
import {
  updateMobilePreferences,
  useCarMode,
  useMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/state/application-state'
import {
  aggregateRuntimeTasks,
  projectMachineGroups,
  compareTasks,
  taskGroupOptions,
  taskSortOptions,
  isSnoozed,
  resolveTaskAgent,
  type RuntimeTask,
} from '@dovo/protocol'
import { useNavigation } from '../shell/navigation'
import { useDeferredValue, useEffect, useMemo } from 'react'
import { Alert, FlatList, Pressable, ScrollView, View } from 'react-native'
import { Schema } from 'effect'
import { mutableStruct, responses } from '@dovo/protocol'
import { Text } from '../ui/content/text'
import { useRuntime } from '../runtime/connection/provider'
import { FleetOverview } from '../runtime/connection/fleet-overview'
import { ProjectThreadFilter } from '../tasks/list/project-thread-filter'
import { TaskListRow } from '../tasks/list/task-list-row'
import { taskRowStatus } from '../tasks/list/task-row-status'
import { useTaskListView } from '../tasks/list/task-list-view'
import { useListScroll } from '../ui/layout/use-list-scroll'
import { router } from 'expo-router'
import { LifecycleActions } from '../tasks/detail/lifecycle-actions'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { SearchField } from '../ui/controls/field'
import { Sheet } from '../ui/layout/sheet'
import { Icon } from '../ui/controls/icon'
import { IconButton } from '../ui/controls/icon-button'
import { ScreenHeader } from '../ui/layout/screen-header'
import { useAction } from '../ui/controls/use-action'
import { colors, styles } from '../ui/theme'
type TaskListItem =
  | { kind: 'group'; key: string; name: string; count: number }
  | { kind: 'task'; entry: RuntimeTask }
export default function TasksScreen() {
  const { navigate, focused } = useNavigation(),
    { refreshAll, overviews, profiles, activeId, selectRuntimeEffect, readRuntime, ready } =
      useRuntime(),
    { busy, error, act } = useAction()
  const { view, setView, scrollOffset } = useTaskListView()
  const car = useCarMode()
  // Settings → General → Default sort; only a different sort counts as customized.
  const preferences = useMobilePreferences()
  const defaultSort = preferences.taskSort
  const grouping = car ? 'none' : preferences.taskGrouping
  // Car mode shows what needs attention first; search, filters and project scope wait.
  const { search, filter, source, sort, project } = car
    ? { ...view, search: '', filter: 'active', sort: 'priority', project: '' }
    : view
  const [details, setDetails] = useApplicationState(''),
    [filtersOpen, setFiltersOpen] = useApplicationState(false),
    [now, setNow] = useApplicationState(Date.now())
  const [selecting, setSelecting] = useApplicationState(false)
  const [selected, setSelected] = useApplicationState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useApplicationState(false)
  const [collapsed, setCollapsed] = useApplicationState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!focused) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [focused])
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
            JSON.stringify([runtimeId, repository.id]),
          ) ?? [],
      ),
    [projectGroups, project],
  )
  const allTasks = useMemo(() => aggregateRuntimeTasks(entries, now, true), [entries, now])
  const detail = allTasks.find((item) => item.key === details)
  const detailRuntime = overviews.find((entry) => entry.profile.id === detail?.runtimeId)
  const detailAgent =
    detail && resolveTaskAgent(detail.task, detailRuntime?.snapshot?.workspace.agents ?? [])
  const tasks = useMemo(() => {
    const needsInput = new Set(allTasks.filter((row) => row.needsInput).map((row) => row.key))
    const projects = new Map(allTasks.map((row) => [row.key, row.projectName]))
    return allTasks
      .filter(
        ({ task, projectName, runtimeName, runtimeId, needsInput }) =>
          (!project || projectMembers.has(JSON.stringify([runtimeId, task.repositoryId]))) &&
          (filter === 'archive' ? !!task.archivedAt : !task.archivedAt) &&
          (filter === 'archive' || (filter === 'archived' ? task.archived : !task.archived)) &&
          (filter === 'snoozed'
            ? isSnoozed(task, now)
            : filter === 'active'
              ? !isSnoozed(task, now)
              : filter === 'input'
                ? needsInput
                : filter === 'archive' || filter === 'archived' || task.status === filter) &&
          (!query ||
            [
              task.title,
              projectName,
              runtimeName,
              ...task.messages.map((message) => message.text),
            ].some((text) => text.toLowerCase().includes(query))),
      )
      .sort((a, b) => {
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
  }, [allTasks, filter, now, query, sort, project, projectMembers])
  const listItems = useMemo(() => {
    if (grouping === 'none') return tasks.map((entry): TaskListItem => ({ kind: 'task', entry }))
    const groups: { key: string; name: string; tasks: RuntimeTask[] }[] = []
    if (grouping === 'status') {
      const active = tasks.filter(
        ({ task }) => !task.archived && !task.archivedAt && !isSnoozed(task, now),
      )
      groups.push(
        { key: 'pinned', name: 'Pinned', tasks: active.filter(({ task }) => task.pinned) },
        { key: 'active', name: 'Active', tasks: active.filter(({ task }) => !task.pinned) },
        {
          key: 'snoozed',
          name: 'Snoozed',
          tasks: tasks.filter(
            ({ task }) => !task.archived && !task.archivedAt && isSnoozed(task, now),
          ),
        },
        {
          key: 'settled',
          name: filter === 'archive' ? 'Archived' : 'Settled',
          tasks: tasks.filter(({ task }) => task.archived || !!task.archivedAt),
        },
      )
    } else {
      const identities = new Map(
        projectGroups.flatMap((group) =>
          group.entries.map(
            ({ runtimeId, repository }) =>
              [
                JSON.stringify([runtimeId, repository.id]),
                { key: group.key, name: group.name },
              ] as const,
          ),
        ),
      )
      const projects = new Map<string, (typeof groups)[number]>()
      for (const entry of tasks) {
        const identity = identities.get(JSON.stringify([entry.runtimeId, entry.task.repositoryId]))
        const key = identity?.key ?? JSON.stringify([entry.runtimeId, entry.task.repositoryId])
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
    return groups
      .filter((group) => group.tasks.length)
      .flatMap((group): TaskListItem[] => [
        { kind: 'group', key: group.key, name: group.name, count: group.tasks.length },
        ...(collapsed.has(`${grouping}:${group.key}`)
          ? []
          : group.tasks.map((entry): TaskListItem => ({ kind: 'task', entry }))),
      ])
  }, [tasks, grouping, now, filter, projectGroups, collapsed])
  const bulk = async (action: 'archive' | 'snooze' | 'pin' | 'delete') => {
    const chosen = allTasks.filter((item) => selected.has(item.key))
    if (!chosen.length || bulkBusy) return
    setBulkBusy(true)
    try {
      for (const item of chosen) {
        const profile = profiles.find((entry) => entry.id === item.runtimeId)
        if (!profile) throw new Error(`${item.runtimeName} is unavailable`)
        if (action === 'archive' || action === 'delete')
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
          const after = action === 'pin' ? true : new Date(Date.now() + 24 * 3600000).toISOString()
          await readRuntime(
            profile,
            '/api/workspace',
            {
              collection: 'tasks',
              id: item.task.id,
              changes: { [field]: { before, after } },
            },
            mutableStruct({ revision: Schema.Number.pipe(Schema.finite()) }),
            'PATCH',
          )
        }
      }
      setSelected(new Set())
      setSelecting(false)
    } catch (cause) {
      Alert.alert('Bulk action stopped', cause instanceof Error ? cause.message : String(cause))
    } finally {
      await refreshAll().catch(() => undefined)
      setBulkBusy(false)
    }
  }
  const chooseBulk = (action: 'archive' | 'snooze' | 'pin' | 'delete') => {
    if (action === 'delete')
      Alert.alert(
        'Delete selected threads?',
        `${selected.size} threads will be deleted. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => void bulk(action) },
        ],
      )
    else void bulk(action)
  }
  const { retainPosition, ...listScroll } = useListScroll<TaskListItem>(scrollOffset, focused)
  const openTask = (item: (typeof allTasks)[number]) => {
    retainPosition()
    setDetails('')
    if (item.runtimeId === activeId) navigate('tasks', item.task.id, item.runtimeId)
    else
      act(() =>
        mobileWorkflow(function* () {
          yield* selectRuntimeEffect(item.runtimeId)
          navigate('tasks', item.task.id, item.runtimeId)
        }),
      )
  }
  if (ready && !profiles.length) return <Welcome />
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Tasks"
        buttons={[
          ...(car
            ? []
            : [
                {
                  label: 'Projects',
                  icon: 'folder' as const,
                  onPress: () => {
                    retainPosition()
                    navigate('scm')
                  },
                },
              ]),
          ...(car
            ? [
                {
                  label: 'Exit car mode',
                  icon: 'car' as const,
                  selected: true,
                  onPress: () => updateMobilePreferences({ carMode: false }),
                },
              ]
            : []),
          {
            label: 'Quick task',
            icon: 'jobs',
            overflow: true,
            onPress: () => router.push('/launch'),
          },
          {
            label: 'New task',
            icon: 'add',
            disabled: !overviews.some((entry) => entry.connected) || busy,
            onPress: () => {
              retainPosition()
              router.push('/new', {
                withAnchor: true,
              })
            },
          },
        ]}
      />
      <FlatList
        {...listScroll}
        contentInsetAdjustmentBehavior="automatic"
        data={listItems}
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
                Effect.catchAll((error) =>
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
          item.kind === 'group' ? `group:${grouping}:${item.key}` : item.entry.key
        }
        contentContainerStyle={[
          styles.content,
          {
            gap: 0,
            paddingTop: 0,
            flexGrow: 1,
          },
        ]}
        ListHeaderComponent={
          car ? null : (
            <View
              style={{
                gap: 8,
                paddingBottom: 10,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <SearchField
                    label="Search tasks"
                    placeholder="Search tasks"
                    clearButtonMode="while-editing"
                    returnKeyType="search"
                    value={search}
                    onChangeText={(search) =>
                      setView((current) => ({
                        ...current,
                        search,
                      }))
                    }
                  />
                </View>
                <IconButton
                  label="Task filters and sorting"
                  icon="filters"
                  selected={
                    filter !== 'active' || sort !== defaultSort || grouping !== 'none' || !!project
                  }
                  onPress={() => setFiltersOpen(true)}
                />
              </View>
              <Action
                secondary
                label={selecting ? 'Cancel selection' : 'Select tasks'}
                onPress={() => {
                  setSelecting(!selecting)
                  setSelected(new Set())
                }}
              />
              {selecting && (
                <View style={styles.row}>
                  <Text style={styles.muted}>{selected.size} selected</Text>
                  {(['archive', 'snooze', 'pin', 'delete'] as const).map((action) => (
                    <Action
                      key={action}
                      secondary
                      label={action[0].toUpperCase() + action.slice(1)}
                      disabled={!selected.size || bulkBusy}
                      onPress={() => chooseBulk(action)}
                    />
                  ))}
                </View>
              )}
              {/* One computer's state is already in the connection banner. */}
              {overviews.length > 1 && (
                <FleetOverview
                  compact
                  source={source}
                  entries={overviews}
                  onSelectSource={(source) =>
                    setView((current) => ({
                      ...current,
                      source,
                    }))
                  }
                />
              )}
              {(filter !== 'active' || sort !== defaultSort) && (
                <Text style={styles.muted}>
                  {filter === 'archive'
                    ? 'Archived'
                    : filter === 'archived'
                      ? 'Settled'
                      : filter === 'input'
                        ? 'Needs input'
                        : filter[0]?.toUpperCase() + filter.slice(1)}{' '}
                  · {taskSortOptions.find((item) => item.id === sort)?.name}
                </Text>
              )}
              {!!(error || refreshError) && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error || refreshError}
                </Text>
              )}
            </View>
          )
        }
        renderItem={({ item }) =>
          item.kind === 'group' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.count} tasks`}
              accessibilityState={{ expanded: !collapsed.has(`${grouping}:${item.key}`) }}
              onPress={() =>
                setCollapsed((current) => {
                  const next = new Set(current)
                  const key = `${grouping}:${item.key}`
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }}
            >
              <Icon
                name={collapsed.has(`${grouping}:${item.key}`) ? 'next' : 'down'}
                size={12}
                color={colors.muted}
              />
              <Text numberOfLines={1} style={[styles.muted, { flex: 1, fontWeight: '600' }]}>
                {item.name}
              </Text>
              <Text style={styles.muted}>{item.count}</Text>
            </Pressable>
          ) : (
            <View
              style={
                selecting && selected.has(item.entry.key)
                  ? { backgroundColor: colors.elevated, borderRadius: 10 }
                  : undefined
              }
            >
              <TaskListRow
                row={item.entry}
                runtime={overviews.find((entry) => entry.profile.id === item.entry.runtimeId)}
                now={now}
                testID={
                  profiles.length === 1 ? `Task ${item.entry.task.id}` : `Task ${item.entry.key}`
                }
                disabled={busy}
                showDevice={profiles.length > 1}
                onOpen={() =>
                  selecting
                    ? setSelected((current) => {
                        const next = new Set(current)
                        if (next.has(item.entry.key)) next.delete(item.entry.key)
                        else next.add(item.entry.key)
                        return next
                      })
                    : openTask(item.entry)
                }
                onDetails={() =>
                  selecting
                    ? setSelected((current) => {
                        const next = new Set(current)
                        if (next.has(item.entry.key)) next.delete(item.entry.key)
                        else next.add(item.entry.key)
                        return next
                      })
                    : setDetails(item.entry.key)
                }
              />
            </View>
          )
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="tasks" size={32} color={colors.accent} />
            <Text style={styles.title}>
              {search
                ? 'No matches'
                : entries.some((entry) => !entry.snapshot)
                  ? 'Waiting for your computers'
                  : search || filter !== 'active' || source !== 'all'
                    ? 'Nothing in this view'
                    : 'Ready for your next idea'}
            </Text>
            <Text style={[styles.muted, { textAlign: 'center' }]}>
              {entries.some((entry) => !entry.snapshot)
                ? 'Tasks will appear when your computer connects.'
                : search || filter !== 'active' || source !== 'all'
                  ? 'Try a different search or clear your filters.'
                  : 'Start with a question, a fix, or something you want to build.'}
            </Text>
            {search || filter !== 'active' || source !== 'all' ? (
              <Action
                label="Clear filters"
                secondary
                onPress={() =>
                  setView((current) => ({
                    ...current,
                    search: '',
                    filter: 'active',
                    source: 'all',
                  }))
                }
              />
            ) : (
              <Action
                label="New task"
                disabled={busy || !overviews.some((entry) => entry.connected)}
                onPress={() => router.push('/new', { withAnchor: true })}
              />
            )}
          </View>
        }
      />
      {filtersOpen && (
        <Sheet title="Task filters & sorting" onClose={() => setFiltersOpen(false)}>
          <ProjectThreadFilter
            value={project}
            onChange={(project) => {
              scrollOffset.current = 0
              setView((current) => ({ ...current, project, source: 'all' }))
            }}
          />
          <Choice
            label="Task filter"
            value={filter}
            items={[
              {
                id: 'active',
                name: 'Active',
              },
              {
                id: 'input',
                name: 'Needs input',
              },
              {
                id: 'running',
                name: 'Working',
              },
              {
                id: 'review',
                name: 'Review',
              },
              {
                id: 'snoozed',
                name: 'Snoozed',
              },
              {
                id: 'archived',
                name: 'Settled',
              },
              {
                id: 'archive',
                name: 'Archived',
              },
            ]}
            onChange={(filter) =>
              setView((current) => ({
                ...current,
                filter,
              }))
            }
          />
          <Choice
            label="Thread sort"
            value={sort}
            items={[...taskSortOptions]}
            onChange={(sort) =>
              setView((current) => ({
                ...current,
                sort,
              }))
            }
          />
          <Choice
            label="Group by"
            value={preferences.taskGrouping}
            items={[...taskGroupOptions]}
            onChange={(taskGrouping) =>
              updateMobilePreferences({
                taskGrouping: taskGrouping as typeof preferences.taskGrouping,
              })
            }
          />
          <Text style={styles.muted}>
            Pinned tasks stay first. Priority brings requests for input and failed tasks to the top.
          </Text>
          <Action label="Done" onPress={() => setFiltersOpen(false)} />
        </Sheet>
      )}
      {detail && (
        <Sheet title="Task details" onClose={() => setDetails('')}>
          <Text style={styles.title}>{detail.task.title}</Text>
          <Text style={styles.muted}>
            {detail.projectName} · {detail.task.checkoutBranch ?? 'Project checkout'}
          </Text>
          <Text style={styles.muted}>
            {detail.runtimeName} ·{' '}
            {detail.online
              ? 'Online'
              : detail.reachability === 'offline'
                ? 'Offline'
                : 'Connecting…'}
          </Text>
          {!!detailAgent && (
            <Text style={styles.muted}>
              {detailAgent.provider}
              {detailAgent.model ? ` · ${detailAgent.model}` : ''}
            </Text>
          )}
          <Text style={styles.muted}>
            {taskRowStatus(detail.task, detail.needsInput, detail.online, now)} ·{' '}
            {detail.task.queue?.length ?? 0} queued messages
          </Text>
          {detail.runtimeId === activeId ? (
            <LifecycleActions task={detail.task} allowReadState />
          ) : (
            <Action label="Open task" disabled={busy} onPress={() => openTask(detail)} />
          )}
        </Sheet>
      )}
    </View>
  )
}

/** First run: one clear step instead of a settings list full of disabled rows. */
function Welcome() {
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Tasks" />
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
            Connect your computer
          </Text>
          <Text style={[styles.muted, { fontSize: 15, lineHeight: 21, textAlign: 'center' }]}>
            Dovo runs your agents on your own computer. Pair this phone once to follow tasks, answer
            questions and review changes from anywhere on your Wi-Fi or VPN.
          </Text>
        </View>
        <View style={{ gap: 10 }}>
          <Action
            wide
            label="Connect a computer"
            onPress={() => router.push({ pathname: '/settings/devices', params: { pair: '1' } })}
          />
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            You’ll need Dovo open on your computer to get a pairing code.
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}
