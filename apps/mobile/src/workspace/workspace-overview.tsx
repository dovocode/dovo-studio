import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import {
  orderThreadSections,
  runtimeResourceKey,
  runtimeComputerName,
  threadDescendants,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { useForegroundInterval } from '../runtime/state/app-active'
import {
  useMobilePreferences,
  setMobileThreadSectionCollapsed,
} from '../runtime/preferences/app-preferences'
import { useNavigation } from '../shell/navigation'
import { useMoreActions } from '../shell/more-actions'
import { useBrowserWorkspace } from '../browser/browser-workspace'
import { visitTab } from '../browser/browser-state'
import { ScreenHeader } from '../ui/layout/screen-header'
import { SearchField } from '../ui/controls/field'
import { Icon } from '../ui/controls/icon'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { WorkspaceModes } from './workspace-modes'
import { WorkspaceStarter } from './workspace-starter'
import { ResourceActions } from './resource-actions'
import { StandaloneRow } from './standalone-row'
import { TaskListRow, type TaskListRowActions } from '../tasks/list/task-list-row'
import {
  taskListProjection,
  mobileThreadTree,
  mobileThreadListSources,
} from '../tasks/list/task-list-projection'
import { useListScroll } from '../ui/layout/use-list-scroll'
import { contentColumn } from '../ui/layout/content-column'
import { Sheet } from '../ui/layout/sheet'
import { Choice } from '../ui/controls/choice'
import { Action } from '../ui/controls/action'
import { useWorkspaceView } from './workspace-view'
import {
  terminalHref,
  workspaceItems,
  workspaceSections,
  type WorkspaceItem,
  type WorkspaceSection,
} from './workspace-items'

type Row =
  | { kind: 'section'; id: WorkspaceSection; title: string; count: number }
  | { kind: 'pages'; items: Extract<WorkspaceItem, { kind: 'browser' }>[] }
  | { kind: 'item'; item: WorkspaceItem }
export function WorkspaceOverview({ unified = false }: { unified?: boolean }) {
  const runtime = useRuntime()
  const browser = useBrowserWorkspace()
  const preferences = useMobilePreferences()
  const { navigate, focused } = useNavigation()
  const more = useMoreActions(navigate)
  const { styles, colors } = useTheme()
  const { view, setView, scroll: savedScroll } = useWorkspaceView(unified)
  const query = useDeferredValue(view.search.trim().toLowerCase())
  const [filtering, setFiltering] = useState(false)
  const listScroll = useListScroll<Row>(savedScroll, focused)
  const previousThreads = useRef<ReturnType<typeof taskListProjection>>(new Map())
  const [now, setNow] = useState(Date.now())
  const [actions, setActions] = useState<WorkspaceItem | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [starterActive, setStarterActive] = useState(false)
  const previousTree = useRef<ReturnType<typeof mobileThreadTree>['nodes']>(new Map())
  useForegroundInterval(() => setNow(Date.now()), focused ? 15000 : null)
  const threadSources = useMemo(
    () => mobileThreadListSources(runtime.overviews, preferences.computerRefresh !== 'manual'),
    [runtime.overviews, preferences.computerRefresh],
  )
  const threadRows = useMemo(
    () => taskListProjection(threadSources.entries, now, previousThreads.current),
    [threadSources.entries, now],
  )
  const tree = useMemo(
    () =>
      mobileThreadTree(
        threadRows,
        runtime.overviews,
        previousTree.current,
        (row) =>
          !row.task.archivedAt && (view.computer === 'all' || row.runtimeId === view.computer),
        (child) => view.computer === 'all' || child.runtimeId === view.computer,
      ),
    [threadRows, runtime.overviews, view.computer],
  )
  useLayoutEffect(() => {
    previousThreads.current = threadRows
    previousTree.current = tree.nodes
  }, [threadRows, tree])
  useEffect(() => {
    if (
      view.computer !== 'all' &&
      view.computer !== 'device' &&
      !runtime.profiles.some((profile) => profile.id === view.computer)
    ) {
      setView((current) => ({ ...current, computer: 'all' }))
    }
  }, [view.computer, runtime.profiles, setView])
  const allItems = useMemo(
    () =>
      workspaceItems(
        runtime.overviews,
        unified ? browser.state.tabs : [],
        now,
        tree.contextKeys,
      ).filter((item) => unified || item.kind === 'terminal'),
    [runtime.overviews, browser.state.tabs, unified, now, tree.contextKeys],
  )
  const threadRoots = useMemo(() => new Map(tree.roots.map((row) => [row.key, row])), [tree])
  const items = useMemo(
    () =>
      allItems
        .flatMap((item): WorkspaceItem[] => {
          if (item.kind !== 'thread') return [item]
          const root = threadRoots.get(runtimeResourceKey(item.runtimeId, item.task.id))
          if (!root) return []
          return [
            {
              ...item,
              needsInput: root.needsInput,
              section:
                !item.task.archived && !item.pinned && root.needsInput
                  ? 'needs-input'
                  : item.section,
            },
          ]
        })
        .filter(
          (item) =>
            (view.kind === 'all' || item.kind === view.kind) &&
            (view.computer === 'all' ||
              (item.kind === 'browser'
                ? item.tab.kind === 'local'
                  ? view.computer === 'device'
                  : item.tab.runtimeId === view.computer
                : item.runtimeId === view.computer ||
                  (item.kind === 'thread' &&
                    tree.contextKeys.has(runtimeResourceKey(item.runtimeId, item.task.id))))) &&
            (`${item.title} ${item.detail} ${item.status}`.toLowerCase().includes(query) ||
              (item.kind === 'thread' &&
                threadDescendants(
                  tree.nodes.get(runtimeResourceKey(item.runtimeId, item.task.id))?.children ?? [],
                ).some((child) =>
                  `${child.title} ${child.computerName}`.toLowerCase().includes(query),
                ))),
        ),
    [allItems, view.kind, view.computer, query, threadRoots, tree],
  )
  const commands: TaskListRowActions = {
    open: (key) => {
      const row = threadRows.get(key)?.row
      if (row) {
        listScroll.retainPosition()
        navigate('tasks', row.task.id, row.runtimeId)
      }
    },
    details: (key) => {
      const item = allItems.find(
        (item) =>
          item.kind === 'thread' && runtimeResourceKey(item.runtimeId, item.task.id) === key,
      )
      if (item) setActions(item)
    },
    select: (key) => {
      const item = allItems.find(
        (item) =>
          item.kind === 'thread' && runtimeResourceKey(item.runtimeId, item.task.id) === key,
      )
      if (item) setActions(item)
    },
  }
  const latestCommands = useRef(commands)
  useLayoutEffect(() => {
    latestCommands.current = commands
  })
  const threadCommands = useMemo<TaskListRowActions>(
    () => ({
      open: (key) => latestCommands.current.open(key),
      details: (key) => latestCommands.current.details(key),
      select: (key) => latestCommands.current.select(key),
    }),
    [],
  )
  const rows: Row[] = []
  for (const section of orderThreadSections(
    workspaceSections,
    (section) => section.id,
    preferences.threadSectionOrder,
  )) {
    const members = items.filter((item) => item.section === section.id)
    if (!members.length) continue
    rows.push({ kind: 'section', ...section, count: members.length })
    if (preferences.collapsedThreadSections.includes(section.id) && !query.trim()) continue
    const pages =
      section.id === 'pinned'
        ? members.filter(
            (item): item is Extract<WorkspaceItem, { kind: 'browser' }> => item.kind === 'browser',
          )
        : []
    if (pages.length) rows.push({ kind: 'pages', items: pages })
    for (const item of members)
      if (!(section.id === 'pinned' && item.kind === 'browser')) rows.push({ kind: 'item', item })
  }
  const open = (item: WorkspaceItem) => {
    listScroll.retainPosition()
    if (item.kind === 'thread') navigate('tasks', item.task.id, item.runtimeId)
    else if (item.kind === 'terminal') router.push(terminalHref(item.runtimeId, item.terminal.id))
    else {
      browser.change((state) => visitTab(state, item.tab.id))
      if (unified) router.push('/workspace/browser')
      else navigate('browser')
    }
  }
  const renderRow = (item: WorkspaceItem) => {
    if (item.kind !== 'thread')
      return (
        <StandaloneRow item={item} onOpen={() => open(item)} onActions={() => setActions(item)} />
      )
    const data = threadRows.get(runtimeResourceKey(item.runtimeId, item.task.id))
    return data ? (
      <TaskListRow
        row={data.row}
        needsInput={threadRoots.get(data.row.key)?.needsInput ?? data.row.needsInput}
        owner={data.owner}
        thread={tree.nodes.get(data.row.key)}
        searching={!!query}
        commands={threadCommands}
        now={now}
        testID={`Workspace thread ${item.title}`}
        disabled={false}
        density={preferences.threadDensity}
        showDevice={runtime.profiles.length > 1}
        showTypeIndicator
      />
    ) : null
  }
  const filtered = !!(query || view.kind !== 'all' || view.computer !== 'all')
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={unified ? 'Workspace' : 'Terminals'}
        buttons={[
          {
            label: unified ? 'Start something' : 'New terminal',
            icon: 'add',
            onPress: () => router.push(unified ? '/workspace/new' : '/terminal/new'),
          },
          {
            label: 'Workspace filters',
            icon: 'filters',
            selected: filtered,
            onPress: () => setFiltering(true),
          },
          ...more,
        ]}
      />
      <WorkspaceModes mode={unified ? 'workspace' : 'terminal'} />
      <View style={{ ...contentColumn.collection, paddingHorizontal: 16, paddingBottom: 8 }}>
        <SearchField
          label="Search workspace"
          placeholder={unified ? 'Search your workspace' : 'Search terminals'}
          style={{ fontSize: 15 }}
          value={view.search}
          onChangeText={(search) => {
            savedScroll.current = 0
            setView((current) => ({ ...current, search }))
          }}
        />
      </View>
      {!!(error || (unified && browser.storageError)) && (
        <Text accessibilityRole="alert" style={[styles.error, { paddingHorizontal: 16 }]}>
          {error || browser.storageError}
        </Text>
      )}
      {starterActive || (!allItems.length && !filtered && !threadSources.waiting) ? (
        <WorkspaceStarter
          initialMode={unified ? 'auto' : 'terminal'}
          embedded
          onActiveChange={setStarterActive}
        />
      ) : (
        <FlatList
          {...listScroll}
          scrollEventThrottle={16}
          keyboardDismissMode="on-drag"
          data={rows}
          keyExtractor={(row) =>
            row.kind === 'section'
              ? `section:${row.id}`
              : row.kind === 'pages'
                ? 'pinned-pages'
                : row.item.key
          }
          contentContainerStyle={{
            ...contentColumn.collection,
            paddingHorizontal: 16,
            paddingBottom: 24,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true)
            setError('')
            void runtime
              .refreshAll()
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
              .finally(() => setRefreshing(false))
          }}
          ListEmptyComponent={
            <View style={{ padding: 24, alignItems: 'center', gap: 12 }}>
              <Icon
                name={threadSources.waiting ? 'tasks' : 'search'}
                size={28}
                color={colors.muted}
              />
              <Text style={styles.title}>
                {threadSources.waiting ? 'Loading threads…' : 'No matching items'}
              </Text>
              <Text style={styles.muted}>
                {threadSources.waiting
                  ? 'Connecting to your computers.'
                  : 'Try another title, project or computer.'}
              </Text>
              {!threadSources.waiting && (
                <Action
                  secondary
                  label="Clear filters"
                  onPress={() => setView({ search: '', kind: 'all', computer: 'all' })}
                />
              )}
            </View>
          }
          renderItem={({ item: row }) =>
            row.kind === 'section' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${row.title}, ${row.count} items`}
                accessibilityState={{
                  expanded: !!query || !preferences.collapsedThreadSections.includes(row.id),
                }}
                onPress={() =>
                  setMobileThreadSectionCollapsed(
                    row.id,
                    !preferences.collapsedThreadSections.includes(row.id),
                  )
                }
                style={{
                  minHeight: 44,
                  flexDirection: 'row',
                  gap: 6,
                  alignItems: 'center',
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                }}
              >
                <Icon
                  name={preferences.collapsedThreadSections.includes(row.id) ? 'next' : 'down'}
                  size={12}
                  color={colors.muted}
                />
                <Text style={{ fontWeight: '500', color: colors.muted, fontSize: 12 }}>
                  {row.title}
                </Text>
                <Text style={[styles.muted, { fontSize: 11 }]}>{row.count}</Text>
              </Pressable>
            ) : row.kind === 'pages' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8 }}>
                {row.items.map((item) => (
                  <StandaloneRow
                    key={item.key}
                    item={item}
                    tile
                    onOpen={() => open(item)}
                    onActions={() => setActions(item)}
                  />
                ))}
              </View>
            ) : (
              renderRow(row.item)
            )
          }
        />
      )}
      {filtering && (
        <Sheet title="Workspace filters" onClose={() => setFiltering(false)}>
          {unified && (
            <Choice
              label="Show"
              value={view.kind}
              items={[
                { id: 'all', name: 'Everything' },
                { id: 'thread', name: 'Threads' },
                { id: 'browser', name: 'Pages' },
                { id: 'terminal', name: 'Terminals' },
              ]}
              onChange={(kind) => {
                savedScroll.current = 0
                setView((current) => ({ ...current, kind }))
              }}
            />
          )}
          <Choice
            label="Computer"
            value={view.computer}
            items={[
              { id: 'all', name: 'All computers' },
              ...(unified ? [{ id: 'device', name: 'This device' }] : []),
              ...runtime.overviews.map((owner) => ({
                id: owner.profile.id,
                name: runtimeComputerName(owner),
              })),
            ]}
            onChange={(computer) => {
              savedScroll.current = 0
              setView((current) => ({ ...current, computer }))
            }}
          />
          <Action
            secondary
            label="Reset filters"
            onPress={() => setView({ search: '', kind: 'all', computer: 'all' })}
          />
        </Sheet>
      )}
      {actions && <ResourceActions item={actions} onClose={() => setActions(null)} />}
    </View>
  )
}
