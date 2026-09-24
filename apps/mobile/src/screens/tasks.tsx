import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import {
  aggregateRuntimeTasks,
  compareTasks,
  taskSortOptions,
  isSnoozed,
  resolveTaskAgent,
} from '@dovo/protocol'
import { useNavigation } from '../shell/navigation'
import { useDeferredValue, useEffect, useMemo } from 'react'
import { FlatList, Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { useRuntime } from '../runtime/provider'
import { FleetOverview } from '../runtime/fleet-overview'
import { TaskListRow } from '../tasks/task-list-row'
import { taskRowStatus } from '../tasks/task-row-status'
import { useTaskListView } from '../tasks/task-list-view'
import { useListScroll } from '../ui/use-list-scroll'
import { router } from 'expo-router'
import { LifecycleActions } from '../tasks/lifecycle-actions'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { SearchField } from '../ui/field'
import { Sheet } from '../ui/sheet'
import { Icon } from '../ui/icon'
import { IconButton } from '../ui/icon-button'
import { ScreenHeader } from '../ui/screen-header'
import { useAction } from '../ui/use-action'
import { colors, styles } from '../ui/theme'
export default function TasksScreen() {
  const { navigate, focused } = useNavigation(),
    { refreshAll, overviews, profiles, activeId, selectRuntimeEffect } = useRuntime(),
    { busy, error, act } = useAction()
  const { view, setView, scrollOffset } = useTaskListView()
  const { search, filter, source, sort } = view
  const [details, setDetails] = useApplicationState(''),
    [filtersOpen, setFiltersOpen] = useApplicationState(false),
    [now, setNow] = useApplicationState(Date.now())
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
        ({ task, projectName, runtimeName, needsInput }) =>
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
  }, [allTasks, filter, now, query, sort])
  const { retainPosition, ...listScroll } = useListScroll<(typeof tasks)[number]>(
    scrollOffset,
    focused,
  )
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
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Tasks"
        buttons={[
          {
            label: 'Projects',
            icon: 'folder',
            onPress: () => {
              retainPosition()
              navigate('scm')
            },
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
        data={tasks}
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
        keyExtractor={(item) => item.key}
        contentContainerStyle={[
          styles.content,
          {
            gap: 0,
            paddingTop: 0,
            flexGrow: 1,
          },
        ]}
        ListHeaderComponent={
          <View
            style={{
              gap: 8,
              paddingBottom: 10,
            }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
            >
              {[
                { id: 'active', label: 'All tasks' },
                { id: 'input', label: 'Needs input' },
                { id: 'running', label: 'Working' },
              ].map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected: filter === item.id }}
                  onPress={() => {
                    scrollOffset.current = 0
                    setView((current) => ({ ...current, filter: item.id }))
                  }}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    justifyContent: 'center',
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: filter === item.id ? colors.accent : colors.border,
                    backgroundColor: filter === item.id ? colors.elevated : colors.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text
                    style={[
                      styles.muted,
                      {
                        color: filter === item.id ? colors.accent : colors.muted,
                        fontWeight: '600',
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {overviews.some(
              (entry) => entry.connected && entry.snapshot?.defaults?.configured === false,
            ) && (
              <View style={styles.card}>
                <Text style={styles.text}>Make this workspace yours</Text>
                <Text style={styles.muted}>
                  Choose default models for tasks and titles, shared with your computer.
                </Text>
                <Action
                  label="Set up defaults"
                  secondary
                  onPress={() => router.push('/settings/agents')}
                />
              </View>
            )}
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
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                }}
              >
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
              </View>
              <IconButton
                label="Task filters and sorting"
                icon="filters"
                selected={filter !== 'active' || sort !== 'priority'}
                onPress={() => setFiltersOpen(true)}
              />
            </View>
            {(filter !== 'active' || sort !== 'priority') && (
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
        }
        renderItem={({ item }) => (
          <TaskListRow
            row={item}
            runtime={overviews.find((entry) => entry.profile.id === item.runtimeId)}
            now={now}
            testID={profiles.length === 1 ? `Task ${item.task.id}` : `Task ${item.key}`}
            disabled={busy}
            onOpen={() => openTask(item)}
            onDetails={() => setDetails(item.key)}
          />
        )}
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
            {detail.runtimeName} · {detail.online ? 'Online' : 'Offline'}
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
