import { ConnectionStatus } from '../runtime/connection-status'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { router, useGlobalSearchParams, useIsFocused, usePathname } from 'expo-router'
import { taskHref } from './task-route'
import { issueHref, jiraIssueHref, pipelineHref } from './source-route'
import { collectionPaths as routes, workbenchRoute, type WorkbenchTab as Tab } from './route-paths'
import { useShortcuts } from './shortcuts'
import { NewTask } from '../tasks/new-task'
import { CreationTarget } from '../runtime/creation-target'
import { TaskListViewProvider } from '../tasks/task-list-view'
import { responses } from '@dovo/protocol'
import { NavigationContext, type StudioNavigation, type WorkTarget } from './navigation'
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Keyboard, Platform } from 'react-native'
import { Text } from '../ui/text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SafeAreaView as NativeSafeAreaView } from 'react-native-screens/experimental'
import { useRuntime } from '../runtime/provider'
import { createMobileExtensions } from './extensions'
import { colors, styles } from '../ui/theme'
const SceneContext = createContext<{
  scenes: Record<string, ReactNode>
  navigations: Record<Tab, StudioNavigation>
  shortcutSaved: boolean
  error: string
} | null>(null)
function WorkbenchNotices() {
  const context = useContext(SceneContext)
  return (
    <>
      {context?.shortcutSaved && (
        <Text style={[styles.muted, { paddingHorizontal: 16, paddingVertical: 8 }]}>
          Shortcut saved on this phone. Pair or reconnect to review it.
        </Text>
      )}
      {!!context?.error && (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { paddingHorizontal: 16, paddingVertical: 8 }]}
        >
          {context.error}
        </Text>
      )}
    </>
  )
}
export function WorkbenchScene({ tab }: { tab: Tab | 'scm' }) {
  const context = useContext(SceneContext)
  const focused = useIsFocused()
  if (!context) return null
  const navigation = context.navigations[tab === 'scm' ? 'tasks' : tab]
  return (
    <NavigationContext.Provider value={{ ...navigation, focused: navigation.focused && focused }}>
      <WorkbenchNotices />
      {tab !== 'settings' && tab !== 'scm' && (
        <ConnectionStatus
          onSettings={() => router.navigate('/settings/devices', { withAnchor: true })}
        />
      )}
      {context.scenes[tab] ?? null}
    </NavigationContext.Provider>
  )
}
export function WorkbenchTaskRoute({ children }: { children: ReactNode }) {
  return <WorkbenchDetailRoute tab="tasks">{children}</WorkbenchDetailRoute>
}
export function WorkbenchDetailRoute({
  tab,
  children,
  bottomInset = false,
}: {
  tab: Tab
  children: ReactNode
  bottomInset?: boolean
}) {
  const context = useContext(SceneContext)
  const focused = useIsFocused()
  if (!context) return null
  const navigation = context.navigations[tab]
  return (
    <NavigationContext.Provider value={{ ...navigation, focused: navigation.focused && focused }}>
      <NativeSafeAreaView edges={{ bottom: bottomInset }}>
        <WorkbenchNotices />
        {children}
      </NativeSafeAreaView>
    </NavigationContext.Provider>
  )
}
export function Workbench() {
  const runtime = useRuntime(),
    [extensions] = useState(createMobileExtensions)
  const [work, setWork] = useState<{ target: WorkTarget; runtimeId: string | null } | null>(null)
  const pathname = usePathname()
  const routeParams = useGlobalSearchParams<{
    runtimeId?: string
    repositoryId?: string
    itemId?: string
    url?: string
  }>()
  // Cold source links must prepare the correct retained collection underneath the detail.
  useEffect(() => {
    const { runtimeId, repositoryId, itemId, url } = routeParams
    const kind = pathname.startsWith('/issues/item/')
      ? 'issue'
      : pathname.startsWith('/pulls/pipeline/')
        ? 'pipeline'
        : undefined
    if (!kind || !runtimeId || runtimeId !== runtime.activeId || !repositoryId || !itemId) return
    setWork((previous) =>
      previous?.runtimeId === runtimeId &&
      previous.target.kind === kind &&
      previous.target.repositoryId === repositoryId &&
      previous.target.id === itemId &&
      previous.target.url === url
        ? previous
        : { runtimeId, target: { kind, repositoryId, id: itemId, url } },
    )
  }, [
    pathname,
    routeParams.runtimeId,
    routeParams.repositoryId,
    routeParams.itemId,
    routeParams.url,
    runtime.activeId,
  ])
  const { tab: active, detail: routeDetail } = workbenchRoute(pathname)
  const [screens, setScreens] = useState<Record<string, ComponentType>>({}),
    [loadError, setLoadError] = useState('')
  useEffect(() => {
    if (runtime.ready && !runtime.profiles.length && active !== 'settings')
      router.replace('/settings')
  }, [runtime.ready, runtime.profiles.length, active])
  const shortcuts = useShortcuts()
  const routedShortcut = useRef('')
  const hasOnlineComputer = runtime.overviews.some((entry) => entry.connected)
  useEffect(() => {
    if (!hasOnlineComputer || !shortcuts.input || routedShortcut.current === shortcuts.input.id)
      return
    routedShortcut.current = shortcuts.input.id
    // A shortcut can arrive while a native thread or Projects screen covers the list.
    // Bring its draft creation scene into view before consuming the inbox item.
    router.navigate('/')
  }, [hasOnlineComputer, shortcuts.input])
  const [keyboard, setKeyboard] = useState(false)
  const [details, setDetails] = useState<Record<Tab, boolean>>({
    tasks: false,
    issues: false,
    pulls: false,
    jobs: false,
    settings: false,
  })
  const detail = active === 'settings' ? details.settings : routeDetail
  const detailSetters = useMemo(() => {
    const setter = (tab: Tab) => (value: boolean) =>
      setDetails((current) => (current[tab] === value ? current : { ...current, [tab]: value }))
    return {
      tasks: setter('tasks'),
      issues: setter('issues'),
      pulls: setter('pulls'),
      jobs: setter('jobs'),
      settings: setter('settings'),
    }
  }, [])
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true)),
      hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  const finishShortcut = async (runtimeId?: string, taskId?: string) => {
    const input = shortcuts.input
    if (!input) return
    try {
      if (runtimeId) {
        const owner = runtime.profiles.find((entry) => entry.id === runtimeId)
        if (!owner) throw new Error('This computer is no longer saved')
        await runtime.readRuntime(owner, '/api/shortcuts/received', input, responses.ok)
      }
      await shortcuts.consume(input.id)
      if (runtimeId && taskId) router.navigate(taskHref(runtimeId, taskId), { withAnchor: true })
    } catch (e) {
      setLoadError(String(e))
    }
  }
  const selected = !runtime.profiles.length
    ? 'settings'
    : active === 'tasks' && pathname === '/projects'
      ? 'scm'
      : active
  useEffect(() => {
    let stopped = false
    setLoadError('')
    void extensions
      .view(selected)
      .then((View) => {
        if (!stopped)
          setScreens((current) =>
            current[selected] === View ? current : { ...current, [selected]: View },
          )
      })
      .catch((error) => {
        if (!stopped) setLoadError(String(error))
      })
    return () => {
      stopped = true
    }
  }, [selected, extensions])
  useEffect(
    () => () => {
      void extensions.host
        .dispose()
        .catch((error) => console.error('Mobile extension shutdown failed', error))
    },
    [extensions],
  )
  const navigate = useCallback(
    (view: string, id?: string, runtimeId?: string) => {
      Keyboard.dismiss()
      if (view === 'tasks' && id) {
        const host = runtimeId ?? runtime.activeId
        if (host) router.navigate(taskHref(host, id), { withAnchor: true })
        return
      }
      if (view === 'scm') {
        router.push('/projects', { withAnchor: true })
        return
      }
      const tab =
        view === 'issues'
          ? 'issues'
          : view === 'pulls'
            ? 'pulls'
            : view === 'jobs'
              ? 'jobs'
              : view === 'settings'
                ? 'settings'
                : 'tasks'
      router.navigate(routes[tab])
    },
    [runtime.activeId],
  )
  const navigations = useMemo(() => {
    const value = (tab: Tab) => ({
      workTarget:
        work?.runtimeId === runtime.activeId &&
        ((tab === 'issues' && work.target.kind === 'issue') ||
          (tab === 'pulls' && work.target.kind === 'pipeline'))
          ? work.target
          : undefined,
      openWork: (target: WorkTarget) => {
        Keyboard.dismiss()
        setWork({ target, runtimeId: runtime.activeId })
        if (target.id && runtime.activeId) {
          const href = target.kind === 'issue' ? issueHref : pipelineHref
          router.navigate(
            target.kind === 'issue' && target.jiraSourceId
              ? jiraIssueHref(runtime.activeId, target.jiraSourceId, target.id, target.url)
              : href(runtime.activeId, target.repositoryId, target.id, target.url),
            {
              withAnchor: true,
            },
          )
        } else router.navigate(target.kind === 'issue' ? '/issues' : '/pulls')
      },
      focused: active === tab,
      setDetail: detailSetters[tab],
      navigate,
    })
    return {
      tasks: value('tasks'),
      issues: value('issues'),
      pulls: value('pulls'),
      jobs: value('jobs'),
      settings: value('settings'),
    }
  }, [active, detailSetters, navigate, work, runtime.activeId])
  // Native tabs keep their visited screens mounted, preserving filters and scroll position.
  // Unified collections retain their filters and position when opening work on another computer.
  const scenes = useMemo(() => {
    const content: Record<string, ReactNode> = {}
    for (const tab of ['tasks', 'issues', 'pulls', 'jobs', 'settings', 'scm'] as const) {
      const View = screens[tab]
      content[tab] =
        !runtime.ready || !View ? (
          <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />
        ) : (
          // Context and section controls can precede a list. Use the tab controller's
          // measured bottom safe area rather than depending on ScrollView discovery.
          // Detail screens own their composer/home inset when the tab bar is hidden.
          <NativeSafeAreaView
            edges={{
              bottom:
                Platform.OS === 'ios' && (tab !== 'settings' || !details.settings) && !keyboard,
            }}
          >
            <View key={tab} />
          </NativeSafeAreaView>
        )
    }
    return content
  }, [screens, runtime.ready, runtime.activeId, details, keyboard])
  const content =
    hasOnlineComputer && shortcuts.input
      ? {
          ...scenes,
          tasks: (
            <CreationTarget
              alwaysChoose
              key={shortcuts.input.id}
              title="New task from Shortcut"
              onClose={() => {
                void finishShortcut()
              }}
            >
              {(runtimeId) => (
                <NewTask
                  initial={shortcuts.input}
                  onCreated={(id) => {
                    void finishShortcut(runtimeId, id)
                  }}
                  onCancel={() => {
                    void finishShortcut()
                  }}
                />
              )}
            </CreationTarget>
          ),
        }
      : scenes
  const shortcutSaved = !!shortcuts.input && !hasOnlineComputer
  const error =
    loadError ||
    shortcuts.error ||
    (runtime.error !==
    runtime.overviews.find((entry) => entry.profile.id === runtime.activeId)?.error
      ? runtime.error
      : '')
  const sceneContext = useMemo(
    () => ({ scenes: content, navigations, shortcutSaved, error }),
    [content, navigations, shortcutSaved, error],
  )
  return (
    <SafeAreaView style={styles.screen} edges={Platform.OS === 'ios' ? [] : ['top']}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TaskListViewProvider>
          <SceneContext.Provider value={sceneContext}>
            <NativeTabs
              hidden={keyboard || detail}
              tintColor={colors.accent}
              backBehavior="history"
            >
              <NativeTabs.Trigger
                name="(tasks)"
                disableAutomaticContentInsets={Platform.OS === 'ios'}
                testID="Tab Tasks"
                disabled={!runtime.profiles.length}
                listeners={{
                  tabPress: () => {
                    if (active === 'tasks') router.dismissTo('/')
                  },
                }}
              >
                <NativeTabs.Trigger.Icon sf="checklist" md="checklist" />
                <NativeTabs.Trigger.Label>Tasks</NativeTabs.Trigger.Label>
              </NativeTabs.Trigger>
              <NativeTabs.Trigger
                name="issues"
                disableAutomaticContentInsets={Platform.OS === 'ios'}
                testID="Tab Issues"
                disabled={!runtime.profiles.length}
                listeners={{ tabPress: () => active === 'issues' && router.dismissTo('/issues') }}
              >
                <NativeTabs.Trigger.Icon sf="exclamationmark.bubble" md="assignment" />
                <NativeTabs.Trigger.Label>Issues</NativeTabs.Trigger.Label>
              </NativeTabs.Trigger>
              <NativeTabs.Trigger
                name="pulls"
                disableAutomaticContentInsets={Platform.OS === 'ios'}
                testID="Tab PRs"
                disabled={!runtime.profiles.length}
                listeners={{ tabPress: () => active === 'pulls' && router.dismissTo('/pulls') }}
              >
                <NativeTabs.Trigger.Icon sf="arrow.triangle.pull" md="merge" />
                <NativeTabs.Trigger.Label>PRs</NativeTabs.Trigger.Label>
              </NativeTabs.Trigger>
              <NativeTabs.Trigger
                name="jobs"
                disableAutomaticContentInsets={Platform.OS === 'ios'}
                testID="Tab Automations"
                disabled={!runtime.profiles.length}
                listeners={{ tabPress: () => active === 'jobs' && router.dismissTo('/jobs') }}
              >
                <NativeTabs.Trigger.Icon sf="square.3.layers.3d" md="layers" />
                <NativeTabs.Trigger.Label>Automations</NativeTabs.Trigger.Label>
              </NativeTabs.Trigger>
              <NativeTabs.Trigger
                name="settings"
                disableAutomaticContentInsets={Platform.OS === 'ios'}
                testID="Tab Settings"
                listeners={{
                  tabPress: () => active === 'settings' && router.dismissTo('/settings'),
                }}
              >
                <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
                <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
              </NativeTabs.Trigger>
            </NativeTabs>
          </SceneContext.Provider>
        </TaskListViewProvider>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
