import { iconAssets } from '../ui/controls/icon-assets'
import { nativeEffect, mobileWorkflow } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/state/application-state'
import { ConnectionPill, FloatingPills } from '../runtime/connection/connection-status'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { Stack, router, useGlobalSearchParams, useIsFocused, usePathname } from 'expo-router'
import { taskHref } from './task-route'
import { issueHref, jiraIssueHref, pipelineHref } from './source-route'
import { collectionPaths as routes, workbenchRoute, type WorkbenchTab as Tab } from './route-paths'
import { useShortcuts } from './shortcuts'
import {
  preferencesReady,
  readMobilePreferences,
  useMobilePreferences,
  useCarMode,
} from '../runtime/preferences/app-preferences'
import { NewTask } from '../tasks/creation/new-task'
import { CreationTarget } from '../runtime/connection/creation-target'
import { TaskListViewProvider } from '../tasks/list/task-list-view'
import { responses, prepareRuntimeTask } from '@dovo/protocol'
import { NavigationContext, type StudioNavigation, type WorkTarget } from './navigation'
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  View as NativeView,
} from 'react-native'
import { IconButton } from '../ui/controls/icon-button'
import { Text } from '../ui/content/text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SafeAreaView as NativeSafeAreaView } from 'react-native-screens/experimental'
import { useRuntime } from '../runtime/connection/provider'
import { createMobileExtensions } from './extensions'
import { useTheme } from '../ui/theme'
const SceneContext = createContext<{
  scenes: Record<string, ReactNode>
  navigations: Record<Tab, StudioNavigation>
  shortcutSaved: boolean
  error: string
  tabBar: {
    hidden: boolean
    active: Tab
    car: boolean
    hasProfiles: boolean
    hasOnlineComputer: boolean
    newThread: () => void
  }
} | null>(null)
/** Only actual bottom tabs live in this navigator; menu destinations use the parent stack. */
export function WorkbenchTabs() {
  const context = useContext(SceneContext)
  const { colors } = useTheme()
  if (!context) return null
  const { hidden, active, car, hasProfiles, hasOnlineComputer, newThread } = context.tabBar
  return (
    <NativeTabs
      hidden={hidden}
      tintColor={colors.accent}
      backBehavior="history"
      unstable_nativeProps={{ ios: { prominentScreenKey: 'compose' } }}
    >
      <NativeTabs.Trigger
        name="(tasks)"
        disableAutomaticContentInsets={Platform.OS === 'ios'}
        testID="Tab Tasks"
        listeners={{
          tabPress: () => {
            if (active === 'tasks') router.dismissTo('/')
          },
        }}
      >
        <NativeTabs.Trigger.Icon src={iconAssets.tasks} renderingMode="template" />
        <NativeTabs.Trigger.Label>Tasks</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="pulls"
        hidden={car}
        disableAutomaticContentInsets={Platform.OS === 'ios'}
        testID="Tab PRs"
        disabled={!hasProfiles}
        listeners={{
          tabPress: () => active === 'pulls' && router.dismissTo('/pulls'),
        }}
      >
        <NativeTabs.Trigger.Icon src={iconAssets.pulls} renderingMode="template" />
        <NativeTabs.Trigger.Label>PRs</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="compose"
        role="search"
        hidden={Platform.OS !== 'ios'}
        accessibilityLabel="New thread"
        testID="New thread"
        disabled={!hasOnlineComputer}
        // This is an action: preserve the current tab and its navigation history.
        unstable_nativeProps={{
          preventNativeSelection: true,
          // Expo's role sets systemItem; newer iOS versions need the native search role
          // as well to keep this action detached from the collection tabs.
          ios: { role: 'search', automaticallyActivatesSearch: true },
        }}
        listeners={{
          tabPress: newThread,
        }}
      >
        <NativeTabs.Trigger.Icon src={iconAssets.add} renderingMode="template" />
        <NativeTabs.Trigger.Label hidden>New thread</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
function WorkbenchNotices() {
  const { styles } = useTheme()

  const context = useContext(SceneContext)
  return (
    <>
      {context?.shortcutSaved && (
        <Text
          style={[
            styles.muted,
            {
              paddingHorizontal: 16,
              paddingVertical: 8,
            },
          ]}
        >
          Shared input saved on this phone. Pair or reconnect to review it.
        </Text>
      )}
      {!!context?.error && (
        <Text
          accessibilityRole="alert"
          style={[
            styles.error,
            {
              paddingHorizontal: 16,
              paddingVertical: 8,
            },
          ]}
        >
          {context.error}
        </Text>
      )}
    </>
  )
}
export function WorkbenchScene({ tab, sidebar = false }: { tab: Tab | 'scm'; sidebar?: boolean }) {
  const context = useContext(SceneContext)
  const focused = useIsFocused()
  const pathname = usePathname()
  if (!context) return null
  const navigation = context.navigations[tab === 'scm' ? 'tasks' : tab]
  return (
    <NavigationContext.Provider
      value={{
        ...navigation,
        focused: navigation.focused && focused,
        navigate: (view, id, runtimeId) => {
          if (sidebar && pathname !== '/' && view === 'tasks' && id && runtimeId) {
            Keyboard.dismiss()
            router.replace(taskHref(runtimeId, id))
          } else navigation.navigate(view, id, runtimeId)
        },
      }}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
        <WorkbenchNotices />
        {context.scenes[tab] ?? null}
      </SafeAreaView>
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
    <NavigationContext.Provider
      value={{
        ...navigation,
        focused: navigation.focused && focused,
      }}
    >
      <NativeSafeAreaView
        edges={{
          left: true,
          right: true,
          bottom: bottomInset,
        }}
      >
        <WorkbenchNotices />
        {children}
      </NativeSafeAreaView>
    </NavigationContext.Provider>
  )
}
export function Workbench() {
  const { colors, styles } = useTheme()

  const runtime = useRuntime(),
    [extensions] = useApplicationState(createMobileExtensions)
  const [work, setWork] = useApplicationState<{
    target: WorkTarget
    runtimeId: string | null
  } | null>(null)
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
        : {
            runtimeId,
            target: {
              kind,
              repositoryId,
              id: itemId,
              url,
            },
          },
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
  const car = useCarMode()
  const { browserWorkspaceEnabled } = useMobilePreferences()
  const artifactsEnabled = runtime.overviews.some((entry) => entry.snapshot?.artifactsEnabled)
  useEffect(() => {
    if (runtime.ready && active === 'artifacts' && (!artifactsEnabled || car)) router.replace('/')
  }, [runtime.ready, active, artifactsEnabled, car])
  useEffect(() => {
    if (active === 'browser' && (!browserWorkspaceEnabled || car)) router.replace('/')
  }, [active, browserWorkspaceEnabled, car])
  const [screens, setScreens] = useApplicationState<Record<string, ComponentType>>({}),
    [loadError, setLoadError] = useApplicationState('')
  useEffect(() => {
    // Tasks greets a first-run user with pairing; other collections have nothing to show yet.
    if (
      runtime.ready &&
      !runtime.profiles.length &&
      active !== 'settings' &&
      active !== 'tasks' &&
      active !== 'browser'
    )
      router.replace('/')
  }, [runtime.ready, runtime.profiles.length, active])
  // Settings → General → Open on launch: once per cold start, and only from the default Tasks
  // tab, so deep links and notification taps still open where they point.
  const launched = useRef(false)
  useEffect(() => {
    if (launched.current || !runtime.ready || !runtime.profiles.length) return
    launched.current = true
    void preferencesReady.then(() => {
      const { launchTab, carMode } = readMobilePreferences()
      // Car mode only has Tasks and Settings, so it always opens on Tasks.
      const tab = carMode ? 'tasks' : launchTab
      if (pathname === '/') {
        if (tab === 'tasks') router.push('/new', { withAnchor: true })
        else router.replace(tab === 'jobs' ? '/settings/automations' : `/${tab}`)
      }
    })
  }, [runtime.ready, runtime.profiles.length, pathname])
  // Car mode: Tasks and Settings only.
  const shortcuts = useShortcuts()
  const routedShortcut = useRef('')
  const hasOnlineComputer = runtime.overviews.some((entry) => entry.connected)
  const newThread = useCallback(() => {
    if (hasOnlineComputer) router.push('/new', { withAnchor: true })
  }, [hasOnlineComputer])
  useEffect(() => {
    if (!hasOnlineComputer || !shortcuts.input || routedShortcut.current === shortcuts.input.id)
      return
    routedShortcut.current = shortcuts.input.id
    // A shortcut can arrive while a native thread or Projects screen covers the list.
    // Bring its draft creation scene into view before consuming the inbox item.
    router.navigate('/')
  }, [hasOnlineComputer, shortcuts.input])
  const [keyboard, setKeyboard] = useApplicationState(false)
  const detail = active === 'settings' ? pathname.startsWith('/settings/automations/') : routeDetail
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true)),
      hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  const finishShortcut = (runtimeId?: string, taskId?: string) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        const input = shortcuts.input
        if (!input) return
        return yield* mobileWorkflow(function* () {
          if (runtimeId && input.source !== 'share') {
            const owner = runtime.profiles.find((entry) => entry.id === runtimeId)
            if (!owner) return yield* Effect.fail(new Error('This computer is no longer saved'))
            yield* nativeEffect(() =>
              runtime.readRuntime(owner, '/api/shortcuts/received', input, responses.ok),
            )
          }
          yield* nativeEffect(() => shortcuts.consume(input.id))
          if (runtimeId && taskId)
            router.navigate(taskHref(runtimeId, taskId), {
              withAnchor: true,
            })
        }).pipe(
          Effect.catch((e) =>
            nativeEffect(() => {
              setLoadError(String(e))
            }),
          ),
        )
      }),
    )
  }
  // Without a computer only Tasks (first-run welcome) and Settings have anything to show.
  const selected =
    active === 'browser'
      ? 'browser'
      : !runtime.profiles.length
        ? active === 'tasks' && pathname !== '/projects'
          ? 'tasks'
          : 'settings'
        : active === 'tasks' && pathname === '/projects'
          ? 'scm'
          : active
  useEffect(() => {
    let stopped = false
    setLoadError('')
    void runClientEffect(
      nativeEffect(() => extensions.view(selected))
        .pipe(
          Effect.flatMap((View) =>
            nativeEffect(() => {
              if (!stopped)
                setScreens((current) =>
                  current[selected] === View
                    ? current
                    : {
                        ...current,
                        [selected]: View,
                      },
                )
            }),
          ),
        )
        .pipe(
          Effect.catch((error) =>
            nativeEffect(() => {
              if (!stopped) setLoadError(String(error))
            }),
          ),
        ),
    )
    return () => {
      stopped = true
    }
  }, [selected, extensions])
  useEffect(
    () => () => {
      void runClientEffect(
        nativeEffect(() => extensions.host.dispose()).pipe(
          Effect.catch((error) =>
            nativeEffect(() => console.error('Mobile extension shutdown failed', error)),
          ),
        ),
      )
    },
    [extensions],
  )
  const navigate = useCallback(
    (view: string, id?: string, runtimeId?: string) => {
      Keyboard.dismiss()
      if (view === 'tasks' && id) {
        const host = runtimeId
        const profile = runtime.profiles.find((profile) => profile.id === host)
        if (profile) prepareRuntimeTask(profile.connection, id)
        if (host)
          router.navigate(taskHref(host, id), {
            withAnchor: true,
          })
        return
      }
      if (view === 'scm') {
        router.push('/projects', {
          withAnchor: true,
        })
        return
      }
      if (view === 'jobs') {
        router.navigate('/settings/automations')
        return
      }
      const tab =
        view === 'issues'
          ? 'issues'
          : view === 'pulls'
            ? 'pulls'
            : view === 'browser'
              ? 'browser'
              : view === 'artifacts'
                ? 'artifacts'
                : view === 'settings'
                  ? 'settings'
                  : 'tasks'
      router.navigate(routes[tab])
    },
    [runtime.profiles],
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
        setWork({
          target,
          runtimeId: runtime.activeId,
        })
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
      navigate,
    })
    return {
      tasks: value('tasks'),
      issues: value('issues'),
      pulls: value('pulls'),
      artifacts: value('artifacts'),
      browser: value('browser'),
      settings: value('settings'),
    }
  }, [active, navigate, work, runtime.activeId])
  // Native tabs keep their visited screens mounted, preserving filters and scroll position.
  // Unified collections retain their filters and position when opening work on another computer.
  const scenes = useMemo(() => {
    const content: Record<string, ReactNode> = {}
    for (const tab of [
      'tasks',
      'issues',
      'pulls',
      'artifacts',
      'browser',
      'settings',
      'scm',
    ] as const) {
      const View = screens[tab]
      content[tab] =
        !runtime.ready || !View ? (
          <ActivityIndicator
            style={{
              flex: 1,
            }}
            color={colors.accent}
          />
        ) : (
          // Context and section controls can precede a list. Use the tab controller's
          // measured bottom safe area rather than depending on ScrollView discovery.
          // Detail screens own their composer/home inset when the tab bar is hidden.
          <NativeSafeAreaView
            edges={{
              bottom: Platform.OS === 'ios' && !keyboard,
            }}
          >
            <View key={tab} />
            {tab !== 'settings' && tab !== 'browser' && (
              <FloatingPills>
                <ConnectionPill />
              </FloatingPills>
            )}
            {Platform.OS !== 'ios' && (
              <FloatingPills>
                <NativeView style={{ alignSelf: 'flex-end', paddingRight: 16 }}>
                  <IconButton
                    label="New thread"
                    icon="add"
                    variant="filled"
                    size={48}
                    disabled={!hasOnlineComputer}
                    onPress={newThread}
                  />
                </NativeView>
              </FloatingPills>
            )}
          </NativeSafeAreaView>
        )
    }
    return content
  }, [screens, runtime.ready, runtime.activeId, keyboard, hasOnlineComputer, newThread])
  const content =
    hasOnlineComputer && shortcuts.input
      ? {
          ...scenes,
          tasks: (
            <CreationTarget
              alwaysChoose
              key={shortcuts.input.id}
              title={
                shortcuts.input.source === 'share'
                  ? 'New thread from share'
                  : 'New task from Shortcut'
              }
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
    () => ({
      scenes: content,
      navigations,
      shortcutSaved,
      error,
      tabBar: {
        hidden: keyboard || detail,
        active,
        car,
        hasProfiles: !!runtime.profiles.length,
        hasOnlineComputer,
        newThread,
      },
    }),
    [
      content,
      navigations,
      shortcutSaved,
      error,
      keyboard,
      detail,
      active,
      car,
      runtime.profiles.length,
      hasOnlineComputer,
      newThread,
    ],
  )
  return (
    <SafeAreaView style={styles.screen} edges={Platform.OS === 'ios' ? [] : ['top']}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TaskListViewProvider>
          <SceneContext.Provider value={sceneContext}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(more)" />
              <Stack.Screen name="jobs" />
            </Stack>
          </SceneContext.Provider>
        </TaskListViewProvider>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
