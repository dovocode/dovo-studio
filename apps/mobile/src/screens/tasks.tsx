import { useForegroundInterval } from '../runtime/state/app-active'
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
  isSnoozed,
  resolveTaskAgent,
  indexTaskSubagents,
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
import { chooseSnoozeDuration } from '../tasks/detail/use-task-lifecycle'
import { LifecycleActions } from '../tasks/detail/lifecycle-actions'
import { Action } from '../ui/controls/action'
import { SearchField } from '../ui/controls/field'
import { Sheet } from '../ui/layout/sheet'
import { Icon } from '../ui/controls/icon'
import { IconButton } from '../ui/controls/icon-button'
import { ScreenHeader } from '../ui/layout/screen-header'
import { useAction } from '../ui/controls/use-action'
import { useTheme } from '../ui/theme'
type TaskListItem =
  | { kind: 'group'; key: string; name: string; count: number }
  | { kind: 'task'; entry: RuntimeTask }
export default function TasksScreen({ archived = false }: { archived?: boolean }) {
  const { colors, styles } = useTheme()

  const { navigate, focused } = useNavigation(),
    { refreshAll, overviews, profiles, activeId, selectRuntimeEffect, readRuntime, ready } =
      useRuntime(),
    { busy, error, act } = useAction()
  const { view, setView, scrollOffset } = useTaskListView()
  const car = useCarMode() && !archived
  // List ordering and grouping follow Settings → General.
  const preferences = useMobilePreferences()
  const grouping = archived || car ? 'none' : preferences.taskGrouping
  // Car mode shows what needs attention first; search, filters and project scope wait.
  const { search, source, sort, project } = archived
    ? { ...view, source: 'all', sort: 'newest', project: '' }
    : car
      ? { ...view, search: '', sort: 'priority', project: '' }
      : { ...view, sort: preferences.taskSort }
  const [details, setDetails] = useApplicationState(''),
    [now, setNow] = useApplicationState(Date.now())
  const [selected, setSelected] = useApplicationState<Set<string>>(() => new Set())
  const selecting = !car && selected.size > 0
  const toggleSelected = (key: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const [bulkBusy, setBulkBusy] = useApplicationState(false)
  const [collapsed, setCollapsed] = useApplicationState<Set<string>>(
    () => new Set(['snoozed', 'settled']),
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
  const subagentsByRuntime = useMemo(
    () =>
      new Map(
        overviews.map((entry) => [
          entry.profile.id,
          indexTaskSubagents(entry.snapshot?.workspace.tasks ?? []),
        ]),
      ),
    [overviews],
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
        ({ task, projectName, runtimeName, runtimeId }) =>
          !task.delegation &&
          (!project || projectMembers.has(JSON.stringify([runtimeId, task.repositoryId]))) &&
          (archived ? !!task.archivedAt : !task.archivedAt) &&
          (!car || (!task.archived && !isSnoozed(task, now))) &&
          (!query ||
            [
              task.title,
              projectName,
              runtimeName,
              ...task.messages.map((message) => message.text),
            ].some((text) => text.toLowerCase().includes(query))),
      )
      .sort((a, b) => {
        if (archived)
          return (
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
  }, [allTasks, car, now, query, sort, project, projectMembers, archived])
  const listItems = useMemo(() => {
    if (archived || car) return tasks.map((entry): TaskListItem => ({ kind: 'task', entry }))
    const unsettled = tasks.filter(({ task }) => !task.archived && !isSnoozed(task, now))
    const snoozed = tasks.filter(({ task }) => !task.archived && isSnoozed(task, now))
    const settled = tasks.filter(({ task }) => task.archived)
    const snoozedItems: TaskListItem[] = snoozed.length
      ? [
          { kind: 'group', key: 'snoozed', name: 'Snoozed', count: snoozed.length },
          ...(collapsed.has('snoozed')
            ? []
            : snoozed.map((entry): TaskListItem => ({ kind: 'task', entry }))),
        ]
      : []
    const settledItems: TaskListItem[] = settled.length
      ? [
          { kind: 'group', key: 'settled', name: 'Settled', count: settled.length },
          ...(collapsed.has('settled')
            ? []
            : settled.map((entry): TaskListItem => ({ kind: 'task', entry }))),
        ]
      : []
    if (grouping === 'none')
      return [
        ...unsettled.map((entry): TaskListItem => ({ kind: 'task', entry })),
        ...snoozedItems,
        ...settledItems,
      ]
    const groups: { key: string; name: string; tasks: RuntimeTask[] }[] = []
    if (grouping === 'status') {
      const active = tasks.filter(
        ({ task }) => !task.archived && !task.archivedAt && !isSnoozed(task, now),
      )
      groups.push(
        { key: 'pinned', name: 'Pinned', tasks: active.filter(({ task }) => task.pinned) },
        { key: 'active', name: 'Active', tasks: active.filter(({ task }) => !task.pinned) },
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
      for (const entry of unsettled) {
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
    return [
      ...groups
        .filter((group) => group.tasks.length)
        .flatMap((group): TaskListItem[] => [
          { kind: 'group', key: group.key, name: group.name, count: group.tasks.length },
          ...(collapsed.has(`${grouping}:${group.key}`)
            ? []
            : group.tasks.map((entry): TaskListItem => ({ kind: 'task', entry }))),
        ]),
      ...snoozedItems,
      ...settledItems,
    ]
  }, [tasks, grouping, now, projectGroups, collapsed, archived, car])
  const bulk = async (
    action: 'archive' | 'restore' | 'snooze' | 'pin' | 'delete',
    hours?: number,
  ) => {
    const chosen = allTasks.filter((item) => selected.has(item.key))
    if (!chosen.length || bulkBusy) return
    if (action === 'snooze' && hours === undefined) throw new Error('Choose a snooze duration.')
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
          const after =
            action === 'pin' ? true : new Date(Date.now() + (hours ?? 0) * 3600000).toISOString()
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
    } catch (cause) {
      Alert.alert('Bulk action stopped', cause instanceof Error ? cause.message : String(cause))
    } finally {
      await refreshAll().catch(() => undefined)
      setBulkBusy(false)
    }
  }
  const chooseBulk = (action: 'archive' | 'restore' | 'snooze' | 'pin' | 'delete') => {
    if (action === 'snooze')
      return chooseSnoozeDuration('Snooze selected threads', (hours) => void bulk(action, hours))
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
  if (ready && !profiles.length && !archived) return <Welcome />
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={archived ? 'Archived tasks' : 'Tasks'}
        buttons={
          archived
            ? []
            : [
                ...(car
                  ? []
                  : [
                      {
                        label: 'Projects',
                        icon: 'projects' as const,
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
                  label: 'New thread',
                  icon: 'add',
                  disabled: !overviews.some((entry) => entry.connected) || busy,
                  onPress: () => {
                    retainPosition()
                    router.push('/new', {
                      withAnchor: true,
                    })
                  },
                },
              ]
        }
      />
      {selecting && (
        <View
          testID="Task selection toolbar"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 4,
            backgroundColor: colors.background,
          }}
        >
          <Text style={[styles.muted, { flex: 1, fontSize: 12 }]}>{selected.size} selected</Text>
          {(archived
            ? (['restore', 'delete'] as const)
            : (['archive', 'snooze', 'pin', 'delete'] as const)
          ).map((action) => (
            <Action
              key={action}
              secondary
              label={action[0].toUpperCase() + action.slice(1) + ' selected tasks'}
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
            label="Clear task selection"
            icon="close"
            disabled={bulkBusy}
            onPress={() => setSelected(new Set())}
          />
        </View>
      )}
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
                    label={archived ? 'Search archived tasks' : 'Search tasks'}
                    placeholder={archived ? 'Search archived tasks' : 'Search tasks'}
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
              </View>
              {!archived && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <ProjectThreadFilter
                      compact
                      value={project}
                      onChange={(project) => {
                        scrollOffset.current = 0
                        setView((current) => ({ ...current, project }))
                      }}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <FleetOverview
                      compact
                      source={source}
                      entries={overviews}
                      onSelectSource={(source) => {
                        scrollOffset.current = 0
                        setView((current) => ({ ...current, source }))
                      }}
                    />
                  </View>
                </View>
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
              accessibilityState={{
                expanded: !collapsed.has(
                  item.key === 'settled' || item.key === 'snoozed'
                    ? item.key
                    : `${grouping}:${item.key}`,
                ),
              }}
              onPress={() =>
                setCollapsed((current) => {
                  const next = new Set(current)
                  const key =
                    item.key === 'settled' || item.key === 'snoozed'
                      ? item.key
                      : `${grouping}:${item.key}`
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }}
            >
              <Icon
                name={
                  collapsed.has(
                    item.key === 'settled' || item.key === 'snoozed'
                      ? item.key
                      : `${grouping}:${item.key}`,
                  )
                    ? 'next'
                    : 'down'
                }
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
                subagents={
                  subagentsByRuntime.get(item.entry.runtimeId)?.(item.entry.task, true) ?? []
                }
                runtime={overviews.find((entry) => entry.profile.id === item.entry.runtimeId)}
                now={now}
                testID={
                  profiles.length === 1 ? `Task ${item.entry.task.id}` : `Task ${item.entry.key}`
                }
                disabled={busy || bulkBusy}
                showDevice={profiles.length > 1}
                selectionActive={selecting}
                selected={selected.has(item.entry.key)}
                onSelect={() => toggleSelected(item.entry.key)}
                onOpen={() => (selecting ? toggleSelected(item.entry.key) : openTask(item.entry))}
                onOpenSubagent={(id) => {
                  if (selecting) return toggleSelected(item.entry.key)
                  const child = allTasks.find(
                    (entry) => entry.runtimeId === item.entry.runtimeId && entry.task.id === id,
                  )
                  if (child) openTask(child)
                }}
                onDetails={() => setDetails(item.entry.key)}
              />
            </View>
          )
        }
        ListEmptyComponent={
          archived ? (
            <View style={styles.empty}>
              <Icon name="archive" size={32} color={colors.muted} />
              <Text style={styles.title}>
                {search ? 'No matching archived tasks' : 'No archived tasks'}
              </Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                {search
                  ? 'Try a different search.'
                  : 'Archived threads appear here. Restore them from the three-dot menu.'}
              </Text>
              {!!search && (
                <Action
                  secondary
                  label="Clear search"
                  icon="close"
                  onPress={() => setView((current) => ({ ...current, search: '' }))}
                />
              )}
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="tasks" size={32} color={colors.accent} />
              <Text style={styles.title}>
                {search
                  ? 'No matches'
                  : entries.some((entry) => !entry.snapshot)
                    ? 'Waiting for your computers'
                    : search || project || source !== 'all'
                      ? 'Nothing in this view'
                      : 'Ready for your next idea'}
              </Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                {entries.some((entry) => !entry.snapshot)
                  ? 'Tasks will appear when your computer connects.'
                  : search || project || source !== 'all'
                    ? 'Try a different search or clear your filters.'
                    : 'Start with a question, a fix, or something you want to build.'}
              </Text>
              {search || project || source !== 'all' ? (
                <Action
                  label="Clear filters"
                  secondary
                  onPress={() =>
                    setView((current) => ({
                      ...current,
                      search: '',
                      project: '',
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
          )
        }
      />
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
          <LifecycleActions task={detail.task} runtimeId={detail.runtimeId} allowReadState />
          {detail.runtimeId !== activeId && (
            <Action label="Open task" disabled={busy} onPress={() => openTask(detail)} />
          )}
        </Sheet>
      )}
    </View>
  )
}

/** First run: one clear step instead of a settings list full of disabled rows. */
function Welcome() {
  const { colors, styles } = useTheme()

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
