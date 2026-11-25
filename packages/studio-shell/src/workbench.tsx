import { DictationNotice } from './dictation-notice'
import {
  matchesApplicationShortcut,
  readAppPreferences,
  threadCommands,
  useStudioExtensions,
  extensionComponentVersion,
  studioExtensionPageTarget,
} from '@dovo/studio-core'
import { parseStudioLink, recordClientAction } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { AppInterfaceLanguage } from './interface-language'
import { PreferenceSaveNotice } from './preference-save-notice'
import { previewUrl, browserLinkProfile } from '@dovo/protocol'
import { RemoteDesktopSharing } from './remote-desktop-sharing'
import { ExternalBrowserLinkChooser } from './external-browser-link-chooser'
import { BrowserMediaControls } from './browser-media-controls'
import { taskParentReference, resolveThreadRuntime, prepareRuntimeTask } from '@dovo/protocol'
import { StudioToolsBridge } from './studio-tools-bridge'
import { StudioPairedComputersBridge } from './studio-paired-computers-bridge'
import {
  resolveLinkTargets,
  type LinkTarget,
  type LinkOrigin,
  type LinkOptions,
} from '@dovo/studio-core/links'
import { configuredTaskHarness, decodeWorkTarget, encodeWorkTarget } from '@dovo/protocol'
import { useLinkChooser } from './link-chooser'
import { PipelineLinkDialog } from './pipeline-link-dialog'
import { ApplicationStateProvider, useApplicationState } from '@dovo/studio-core/state'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import {
  type StudioViewProps,
  updateAppPreferences,
  useAppPreferences,
  StudioHostProvider,
  SettingsTargetProvider,
  WorkspaceProvider,
  useWorkspace,
  type StudioCommand,
  type StudioExtension,
  type StudioHostApi,
  type StudioNavigation,
  type StudioThreadReference,
} from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  ErrorBoundary,
  TooltipProvider,
  StudioConfirmationProvider,
  SidebarHeaderLayout,
  HeaderFallback,
  HeaderMainSlot,
  useCompactLayout,
} from '@dovo/studio-ui'
import { SettingsNav } from './settings-nav'
import { useConfirmSettingsNavigation, WorkspaceDraftScope } from '@dovo/studio-core'
import { appSettingsExtension } from './app-extension'
import { useAppearance, type WindowColors } from './appearance'
import { useTaskNotifications, type NotificationTarget } from './task-notifications'
import { TaskNotificationNotice } from './task-notice'
import { createExtensionCatalog } from './extension-catalog'
import { navigationViewVisible, paletteCommands } from './navigation-commands'
import { ActivityBar, visibleWorkspaceTarget, workspaceModeVisible } from './activity-bar'
import type { InputPreviewBridge, DesktopUpdateBridge, DesktopUpdateState } from '@dovo/protocol'
import { CommandPalette } from './command-palette'
import { TaskLauncher } from './task-launcher'
import { ReportProblem } from './report-problem/report-problem'
import { TitleBar, type DesktopPlatform } from './title-bar'
import { workbenchDiagnosticContext } from './workbench-diagnostics'
import { pullReviewDraftScope } from '@dovo/studio-core/pull-code-review'
export type WorkbenchLocation =
  | { kind: 'section'; viewId: string }
  | {
      kind: 'pull'
      pullTarget: NonNullable<StudioNavigation['pullTarget']>
      ownerScope: string
    }
  | ({
      kind: 'thread'
      threadId: string
    } & (
      | { runtimeIdentity: string; runtimeId?: never }
      | { runtimeId: string; runtimeIdentity?: never }
    ))

type WorkbenchHistory = {
  initial?: WorkbenchLocation
  write: (location: WorkbenchLocation, replace: boolean) => void
  listen: (travel: (location: WorkbenchLocation) => Promise<boolean>) => () => void
  back: () => boolean
}

type NavigationOptions = {
  replace?: boolean
  fromUrl?: boolean
  runtimeId?: string | null
}

type WorkbenchProps = {
  captureContent?: ReactNode
  threadWindow?: import('@dovo/protocol').ThreadWindowTarget
  popOutThread?: StudioHostApi['popOutThread']
  appInfo?: StudioHostApi['appInfo']
  extensions: readonly StudioExtension[]
  fileDrag?: StudioHostApi['fileDrag']
  repositoryOpener?: StudioHostApi['repositoryOpener']
  pickDirectory?: StudioHostApi['pickDirectory']
  browserWindowId?: string
  browserPageOnly?: boolean
  openBrowserWindow?: StudioHostApi['openBrowserWindow']
  onBrowserMediaChange?: StudioHostApi['onBrowserMediaChange']
  onBrowserWorkspaceFocus?: (listener: () => void) => () => void
  onBrowserPreviewInput?: StudioHostApi['onBrowserPreviewInput']
  defaultBrowser?: StudioHostApi['defaultBrowser']
  browser?: StudioHostApi['browser']
  browserFrames?: StudioHostApi['browserFrames']
  browserExtensions?: StudioHostApi['browserExtensions']
  onBrowserContextAction?: StudioHostApi['onBrowserContextAction']
  onOpenLink?: (listener: (url: string) => void) => () => void
  openBrowserLink?: StudioHostApi['openBrowserLink']
  accountStorage?: StudioHostApi['accountStorage']
  openExternalLink?: StudioHostApi['openExternalLink']
  desktopPlatform?: DesktopPlatform
  inputPreview?: InputPreviewBridge
  taskLauncher?: StudioHostApi['taskLauncher']
  updates?: DesktopUpdateBridge
  /** Desktop only: paints the native title bar and caption buttons in the theme's colours. */
  windowColors?: (colors: WindowColors) => Promise<void>
  webHistory?: WorkbenchHistory
}
type ViewModule = { default: ComponentType<StudioViewProps> }
/** React.lazy remembers a rejected import forever, so one failed chunk fetch or activation
 * would disable the view until reload. Resolve to a retry screen that loads again on demand. */
function loadView(load: () => Promise<ViewModule>) {
  // Once a retry succeeds, later visits render the view instead of the failure screen.
  let loaded: ViewModule | undefined
  const retry = () =>
    load().then((module) => {
      loaded = module
      return module
    })
  return lazy(async (): Promise<ViewModule> => {
    try {
      return (loaded = await load())
    } catch (error) {
      return {
        default: (props) =>
          loaded ? (
            <loaded.default {...props} />
          ) : (
            <ViewLoadFailure load={retry} error={error} props={props} />
          ),
      }
    }
  })
}
function ViewLoadFailure({
  load,
  error,
  props,
}: {
  load: () => Promise<ViewModule>
  error: unknown
  props: StudioViewProps
}) {
  const [state, setState] = useState<{
    Loaded?: ComponentType<StudioViewProps>
    error: unknown
    busy: boolean
  }>({ error, busy: false })
  if (state.Loaded) return <state.Loaded {...props} />
  return (
    <div role="alert" className="m-6 space-y-3 rounded-lg border border-destructive/30 p-5">
      <h2>This view could not load</h2>
      <p className="text-xs text-muted-foreground">
        {state.error instanceof Error ? state.error.message : String(state.error)}
      </p>
      <Button
        size="sm"
        disabled={state.busy}
        onClick={() => {
          setState((current) => ({ ...current, busy: true }))
          void load().then(
            (module) => setState({ Loaded: module.default, error: null, busy: false }),
            (cause: unknown) => setState({ error: cause, busy: false }),
          )
        }}
      >
        Retry view
      </Button>
    </div>
  )
}
export function Workbench(props: WorkbenchProps) {
  return (
    <ApplicationStateProvider>
      <WorkspaceProvider runtimeId={props.threadWindow?.runtimeId}>
        <StudioConfirmationProvider>
          <SettingsTargetProvider>
            <TooltipProvider delayDuration={350}>
              <WorkbenchErrorBoundary appInfo={props.appInfo}>
                <AppInterfaceLanguage>
                  <WorkbenchContent {...props} />
                </AppInterfaceLanguage>
              </WorkbenchErrorBoundary>
            </TooltipProvider>
          </SettingsTargetProvider>
        </StudioConfirmationProvider>
      </WorkspaceProvider>
    </ApplicationStateProvider>
  )
}
function WorkbenchErrorBoundary({
  children,
  appInfo,
}: {
  children: ReactNode
  appInfo: StudioHostApi['appInfo']
}) {
  const { runtimes, activeRuntimeId } = useWorkspace()
  const entry = runtimes.find((runtime) => runtime.profile.id === activeRuntimeId)
  return (
    <ErrorBoundary
      scope="app"
      diagnosticContext={{
        ...workbenchDiagnosticContext(
          appInfo,
          typeof navigator === 'undefined' ? undefined : navigator.platform,
        ),
        computerName: entry?.profile.name,
        runtimeVersion: entry?.snapshot?.releaseVersion,
      }}
    >
      {children}
    </ErrorBoundary>
  )
}
function WorkbenchContent({
  captureContent,
  extensions,
  threadWindow,
  popOutThread,
  fileDrag,
  repositoryOpener,
  pickDirectory,
  browser,
  defaultBrowser,
  browserExtensions,
  onBrowserContextAction,
  browserFrames,
  browserWindowId,
  browserPageOnly,
  openBrowserWindow,
  onBrowserWorkspaceFocus,
  onBrowserPreviewInput,
  onBrowserMediaChange,
  openBrowserLink,
  accountStorage,
  openExternalLink,
  onOpenLink,
  appInfo,
  desktopPlatform,
  updates,
  inputPreview,
  taskLauncher,
  windowColors,
  webHistory,
}: WorkbenchProps) {
  const uiText = useInterfaceText()

  const {
    botsOverviewEnabled,
    showIssues,
    showJira,
    browserWorkspaceEnabled,
    unifiedWorkspaceEnabled,
    unifiedWorkspaceHideNormalModes,
    browserProfiles,
  } = useAppPreferences()
  const workspaceModes = { unifiedWorkspaceEnabled, unifiedWorkspaceHideNormalModes }
  useAppearance(windowColors)
  const [update, setUpdate] = useState<DesktopUpdateState>({ status: 'idle' })
  useEffect(() => {
    if (!updates) return
    let active = true
    void updates
      .state()
      .then((state) => {
        if (active) setUpdate(state)
      })
      .catch(() => undefined)
    const unsubscribe = updates.subscribe((state) => {
      if (active) setUpdate(state)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [updates])
  const {
    ready,
    restoringConnection,
    snapshot,
    workspace,
    storageError,
    connected,
    syncError,
    runtimeRegistry,
    connection,
    runtimes,
    pendingSync,
    retrySync,
    request,
    switchRuntime,
  } = useWorkspace()
  const artifactsEnabled =
    snapshot?.artifactsEnabled === true ||
    runtimes.some((runtime) => runtime.snapshot?.artifactsEnabled === true)
  const [switchError, setSwitchError] = useApplicationState('')
  const [switching, setSwitching] = useApplicationState(false)
  // Start with a fresh composer; explicit navigation still opens existing threads.
  const [target, updateTarget] = useApplicationState<StudioNavigation>(() => {
    if (browserWindowId || threadWindow)
      return { viewId: browserWindowId ? 'browser' : 'tasks', entityId: threadWindow?.taskId }
    const views = extensions.flatMap((extension) => extension.views)
    const initialView =
      views.find((view) => !view.navigationGroup) ??
      views.find((view) => view.navigationGroup === 'settings')
    return visibleWorkspaceTarget({ viewId: initialView?.id ?? '' }, workspaceModes)
  })
  const [settingsTarget, setSettingsTarget] = useApplicationState<StudioNavigation | null>(null)
  const settingsTrigger = useRef<HTMLElement | null>(null)
  const main = useRef<HTMLElement | null>(null)
  const confirmSettingsNavigation = useConfirmSettingsNavigation()
  // Confirmation changes with computer scope; host navigation always uses the current guard.
  const settingsConfirmation = useRef(confirmSettingsNavigation)
  settingsConfirmation.current = confirmSettingsNavigation
  const threadSelections = useRef(new Map<string | null, string>())
  const botSelections = useRef(new Map<string | null, string>())
  const settingsNavigation = useRef({ target, settingsTarget, extensions })
  settingsNavigation.current = { target, settingsTarget, extensions }
  const history = useRef<Array<{ target: StudioNavigation; runtimeId: string | null }>>([])
  const navigationAttempt = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      navigationAttempt.current++
    }
  }, [])
  const taskNavigationGuard = useCallback(() => {
    const attempt = navigationAttempt.current
    return () => mounted.current && attempt === navigationAttempt.current
  }, [])
  const currentRuntime = useRef(runtimeRegistry.activeId)
  currentRuntime.current = runtimeRegistry.activeId
  const currentProfiles = useRef(runtimeRegistry.profiles)
  currentProfiles.current = runtimeRegistry.profiles
  const currentConnection = useRef(connection)
  currentConnection.current = connection
  const threadRuntimes = useRef({ runtimes, activeIdentity: snapshot?.runtimeId })
  threadRuntimes.current = { runtimes, activeIdentity: snapshot?.runtimeId }
  const browserHistory = useRef(webHistory)
  browserHistory.current = webHistory
  const pullOwnerScope = useCallback((runtimeId: string) => {
    const profile = currentProfiles.current.find((candidate) => candidate.id === runtimeId)
    return pullReviewDraftScope(
      profile?.connection ??
        (runtimeId === currentRuntime.current ? currentConnection.current : null),
    )
  }, [])
  const [navigationKey, setNavigationKey] = useState(0)
  const [settingsNavigationKey, setSettingsNavigationKey] = useState(0)
  const canLeave = useCallback(
    (scope: 'settings' | 'all' = 'all') => settingsConfirmation.current(scope),
    [],
  )
  const isSettingsView = useCallback(
    (viewId: string) =>
      [appSettingsExtension, ...settingsNavigation.current.extensions].some((extension) =>
        extension.views.some((view) => view.navigationGroup === 'settings' && view.id === viewId),
      ),
    [],
  )
  const closeSettings = useCallback(async () => {
    const attempt = ++navigationAttempt.current
    if (!(await canLeave('settings')) || !mounted.current || attempt !== navigationAttempt.current)
      return false
    settingsNavigation.current.settingsTarget = null
    setSettingsTarget(null)
    return true
  }, [canLeave, setSettingsTarget])
  const commitNavigation = useCallback(
    (next: StudioNavigation, options?: NavigationOptions) => {
      if (browserWindowId && next.viewId !== 'browser') return false
      recordClientAction('navigation', 'app')
      // Keep existing links to the former device-only PR page working.
      if (next.viewId === 'pull-request-settings')
        next = { ...next, viewId: 'pull-request-monitoring-settings' }
      const navigation = settingsNavigation.current
      const { target } = navigation
      if (isSettingsView(next.viewId)) {
        if (!navigation.settingsTarget)
          settingsTrigger.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
        navigation.settingsTarget = next
        setSettingsTarget(next)
        setSettingsNavigationKey((key) => key + 1)
        return true
      }
      if (navigation.settingsTarget) {
        navigation.settingsTarget = null
        setSettingsTarget(null)
      }
      const runtimeId =
        options?.runtimeId === undefined ? currentRuntime.current : options.runtimeId
      const profile = currentProfiles.current.find((profile) => profile.id === runtimeId)
      if (next.viewId === 'tasks' && next.entityId) {
        if (profile) prepareRuntimeTask(profile.connection, next.entityId)
      }
      if (
        !browserHistory.current &&
        !options?.replace &&
        (target.viewId !== next.viewId ||
          target.entityId !== next.entityId ||
          JSON.stringify(target.pullTarget) !== JSON.stringify(next.pullTarget) ||
          JSON.stringify(target.automationTarget) !== JSON.stringify(next.automationTarget))
      ) {
        history.current.push({ target, runtimeId: currentRuntime.current })
        if (history.current.length > 50) history.current.shift()
      }
      settingsNavigation.current.target = next
      updateTarget(next)
      setNavigationKey((key) => key + 1)
      if (!options?.fromUrl && browserHistory.current) {
        const runtimeIdentity =
          profile?.connection.runtimeId ??
          threadRuntimes.current.runtimes.find((source) => source.profile.id === runtimeId)
            ?.snapshot?.runtimeId
        const owner = runtimeIdentity ? { runtimeIdentity } : runtimeId ? { runtimeId } : undefined
        const pullTarget = next.viewId === 'pulls' ? next.pullTarget : undefined
        const ownerScope = pullTarget && pullOwnerScope(pullTarget.runtimeId)
        const location: WorkbenchLocation =
          next.viewId === 'tasks' && next.entityId && owner
            ? { kind: 'thread', threadId: next.entityId, ...owner }
            : pullTarget && ownerScope
              ? { kind: 'pull', pullTarget, ownerScope }
              : { kind: 'section', viewId: next.viewId }
        browserHistory.current.write(location, options?.replace ?? false)
      }
      return true
    },
    [updateTarget, setSettingsTarget, browserWindowId, isSettingsView, pullOwnerScope],
  )
  const navigate = useCallback(
    async (next: StudioNavigation, options?: NavigationOptions) => {
      const attempt = ++navigationAttempt.current
      const runtimeId = currentRuntime.current
      if (
        !(await canLeave(isSettingsView(next.viewId) ? 'settings' : 'all')) ||
        !mounted.current ||
        attempt !== navigationAttempt.current ||
        runtimeId !== currentRuntime.current
      )
        return false
      return commitNavigation(next, options)
    },
    [canLeave, commitNavigation, isSettingsView],
  )
  const goBack = useCallback(async () => {
    if (settingsNavigation.current.settingsTarget) {
      await closeSettings()
      return true
    }
    if (browserHistory.current) return browserHistory.current.back()
    const previous = history.current.at(-1)
    const attempt = ++navigationAttempt.current
    const runtimeId = currentRuntime.current
    if (!previous) return false
    if (
      !(await canLeave()) ||
      !mounted.current ||
      attempt !== navigationAttempt.current ||
      runtimeId !== currentRuntime.current
    )
      return true
    try {
      if (
        previous.target.viewId === 'tasks' &&
        previous.runtimeId &&
        previous.runtimeId !== currentRuntime.current
      )
        await switchRuntime(previous.runtimeId)
      if (!mounted.current || attempt !== navigationAttempt.current) return true
      history.current.pop()
      settingsNavigation.current.target = previous.target
      updateTarget(previous.target)
      setNavigationKey((key) => key + 1)
      return true
    } catch (cause) {
      if (attempt === navigationAttempt.current)
        setSwitchError(cause instanceof Error ? cause.message : String(cause))
      return true
    }
  }, [canLeave, closeSettings, updateTarget, switchRuntime, setSwitchError])
  // Hiding normal modes moves a section landing there to the unified workspace. Pop-out windows
  // keep their dedicated view, and explicit item links still open.
  const fallbackTarget =
    browserWindowId || threadWindow ? target : visibleWorkspaceTarget(target, workspaceModes)
  const settingsOpen = !!settingsTarget
  useEffect(() => {
    if (!settingsOpen && fallbackTarget !== target) void navigate(fallbackTarget, { replace: true })
  }, [fallbackTarget.viewId, target.viewId, settingsOpen])
  const compact = useCompactLayout()
  const [collapsedSections, setCollapsedSections] = useApplicationState<Record<string, boolean>>({})
  const sidebarCollapsed =
    collapsedSections[target.viewId] ?? ((compact && target.viewId === 'tasks') || !!threadWindow)
  const setSidebarCollapsed = useCallback(
    (next: boolean | ((previous: boolean) => boolean)) => {
      setCollapsedSections((previous) => ({
        ...previous,
        [target.viewId]:
          typeof next === 'function'
            ? next(
                previous[target.viewId] ??
                  ((compact && target.viewId === 'tasks') || !!threadWindow),
              )
            : next,
      }))
    },
    [setCollapsedSections, target.viewId, compact, threadWindow],
  )
  const navigateSection = (viewId: string) => {
    const open = () =>
      navigate({
        viewId,
        entityId:
          viewId === 'tasks'
            ? threadSelections.current.get(runtimeRegistry.activeId)
            : viewId === 'bots'
              ? botSelections.current.get(runtimeRegistry.activeId)
              : undefined,
      })
    if (viewId === 'browser' && browser && !browserWindowId) {
      const attempt = ++navigationAttempt.current
      void browser({ action: 'focus-detached-browser', key: 'studio:browser:main' })
        .then((result) => {
          if (mounted.current && attempt === navigationAttempt.current && !result?.focusedWindowId)
            void open()
        })
        .catch((cause) => {
          if (mounted.current && attempt === navigationAttempt.current)
            setSwitchError(cause instanceof Error ? cause.message : String(cause))
        })
      return
    }
    void open()
  }
  // Section history is local to this session and computer; explicit navigation
  // to a fresh composer still clears it. Ignore an old computer's pending target.
  useEffect(() => {
    if (target.viewId !== 'tasks' && target.viewId !== 'bots') return
    const selections = target.viewId === 'bots' ? botSelections.current : threadSelections.current
    if (!target.entityId) selections.delete(runtimeRegistry.activeId)
    else if (
      workspace.tasks.some(
        (task) => task.id === target.entityId && (target.viewId !== 'bots' || task.bot),
      )
    )
      selections.set(runtimeRegistry.activeId, target.entityId)
    if (target.entityId && workspace.tasks.some((task) => task.id === target.entityId && task.bot))
      botSelections.current.set(runtimeRegistry.activeId, target.entityId)
  }, [target, runtimeRegistry.activeId, workspace.tasks])
  const openNotification = useCallback(
    (destination: NotificationTarget | (StudioNavigation & { runtimeId: string })) => {
      const attempt = ++navigationAttempt.current
      setSwitchError('')
      const runtimeId = currentRuntime.current
      void (async () => {
        if (
          !(await canLeave()) ||
          !mounted.current ||
          attempt !== navigationAttempt.current ||
          runtimeId !== currentRuntime.current
        )
          return
        if (destination.runtimeId !== currentRuntime.current)
          await switchRuntime(destination.runtimeId)
        if (!mounted.current || attempt !== navigationAttempt.current) return
        commitNavigation(
          {
            viewId: destination.viewId,
            entityId: destination.entityId,
            threadRequest: destination.threadRequest,
          },
          { runtimeId: destination.runtimeId },
        )
      })().catch((error: unknown) => {
        if (attempt === navigationAttempt.current)
          setSwitchError(error instanceof Error ? error.message : String(error))
      })
    },
    [canLeave, switchRuntime, commitNavigation, setSwitchError],
  )
  const openThread = useCallback(
    async (
      destination: StudioThreadReference & { parent?: StudioThreadReference },
      fromUrl = false,
    ) => {
      if (browserWindowId) {
        if (!popOutThread || !destination.runtimeId) {
          setSwitchError('Open this draft in the main Studio window.')
          return false
        }
        void popOutThread({
          runtimeId: destination.runtimeId,
          taskId: destination.threadId,
          title: destination.title,
        }).catch((cause: unknown) => setSwitchError(String(cause)))
        return true
      }
      const attempt = ++navigationAttempt.current
      const capturedRuntime = currentRuntime.current
      if (
        !(await canLeave()) ||
        !mounted.current ||
        attempt !== navigationAttempt.current ||
        capturedRuntime !== currentRuntime.current
      )
        return false
      const previous = {
        target: settingsNavigation.current.target,
        runtimeId: currentRuntime.current,
      }
      const { runtimes, activeIdentity } = threadRuntimes.current
      setSwitchError('')
      const profile = resolveThreadRuntime(destination, currentProfiles.current, runtimes)
      // A direct local connection may have no saved profile, but still has a stable identity.
      const local =
        destination.runtimeId === null &&
        currentRuntime.current === null &&
        (!destination.runtimeIdentity || destination.runtimeIdentity === activeIdentity)
      if (!profile && !local) {
        commitNavigation({ viewId: 'runtime', threadConnection: destination })
        return true
      }
      const runtimeId = profile?.id ?? null
      try {
        if (runtimeId !== currentRuntime.current) {
          if (!runtimeId) throw new Error('The parent computer is no longer available')
          await switchRuntime(runtimeId)
        }
        if (!mounted.current || attempt !== navigationAttempt.current) return false
        if (!browserHistory.current) {
          history.current.push(previous)
          if (history.current.length > 50) history.current.shift()
        }
        return commitNavigation(
          {
            viewId: 'tasks',
            entityId: destination.threadId,
            threadParent: destination.parent,
            nativeAgentKey: destination.nativeAgentKey,
            threadRequest: destination.threadRequest,
          },
          { replace: !browserHistory.current || fromUrl, fromUrl, runtimeId },
        )
      } catch (error) {
        if (attempt === navigationAttempt.current)
          setSwitchError(error instanceof Error ? error.message : String(error))
        return false
      }
    },
    [canLeave, switchRuntime, commitNavigation, setSwitchError, browserWindowId, popOutThread],
  )
  const travel = useCallback(
    (location: WorkbenchLocation) => {
      const options = { replace: true, fromUrl: true }
      if (location.kind === 'section') return navigate({ viewId: location.viewId }, options)
      if (location.kind === 'pull') {
        const { pullTarget } = location
        return navigate(
          pullOwnerScope(pullTarget.runtimeId) === location.ownerScope
            ? { viewId: 'pulls', entityId: pullTarget.url, pullTarget }
            : { viewId: 'pulls' },
          options,
        )
      }
      return openThread(
        {
          threadId: location.threadId,
          runtimeId: location.runtimeId ?? null,
          runtimeIdentity: location.runtimeIdentity,
          title: 'this thread',
        },
        true,
      )
    },
    [navigate, openThread, pullOwnerScope],
  )
  useEffect(() => {
    if (!ready || restoringConnection || !webHistory) return
    return webHistory.listen(travel)
  }, [ready, restoringConnection, webHistory, travel])
  const didOpenInitialLocation = useRef(false)
  useEffect(() => {
    if (!ready || restoringConnection || !webHistory?.initial || didOpenInitialLocation.current)
      return
    didOpenInitialLocation.current = true
    void travel(webHistory.initial)
  }, [ready, restoringConnection, webHistory, travel])
  const [pipelinePreview, setPipelinePreview] = useState<LinkTarget | null>(null)
  const navigateLinkTarget = (destination: LinkTarget) => {
    if (destination.kind === 'pull') {
      void navigate({
        viewId: 'pulls',
        entityId: destination.navigationUrl,
        pullTarget: {
          runtimeId: destination.runtimeId,
          repositoryId: destination.repositoryId,
          number: destination.number,
          url: destination.navigationUrl,
          tab: destination.tab,
          fragment: destination.fragment,
        },
      })
    } else
      void navigate({
        viewId:
          destination.kind === 'pipeline'
            ? 'pipelines'
            : destination.kind === 'jira'
              ? 'jira'
              : 'issues',
        entityId: encodeWorkTarget({
          runtimeId: destination.runtimeId,
          repositoryId: destination.repositoryId,
          jiraSourceId: destination.jiraSourceId,
          id: destination.itemId,
          url: destination.url,
        }),
      })
  }
  const openLinkTarget = (destination: LinkTarget) => {
    if (destination.kind === 'pipeline') setPipelinePreview(destination)
    else navigateLinkTarget(destination)
  }
  const linkOrigin = (): LinkOrigin => {
    const integration = target.pullTarget ?? decodeWorkTarget(target.entityId)
    return {
      runtimeId: integration?.runtimeId ?? runtimeRegistry.activeId ?? undefined,
      repositoryId:
        integration?.repositoryId ??
        (target.viewId === 'tasks'
          ? workspace.tasks.find((task) => task.id === target.entityId)?.repositoryId
          : undefined),
      jiraSourceId:
        integration && 'jiraSourceId' in integration ? integration.jiraSourceId : undefined,
    }
  }
  const linkTargets = (url: string, origin: LinkOrigin) =>
    resolveLinkTargets(
      url,
      runtimes.map((entry) =>
        entry.profile.id === runtimeRegistry.activeId && snapshot
          ? { ...entry, snapshot: { ...snapshot, workspace } }
          : entry,
      ),
      origin,
    )
  const openSharedBrowserLink = useCallback(
    async (url: string) => {
      await navigate({ viewId: 'browser', entityId: previewUrl(url) })
    },
    [navigate],
  )
  const browserLinkTarget = useRef(openBrowserLink)
  browserLinkTarget.current =
    browserWorkspaceEnabled &&
    extensions.some((extension) => extension.views.some((view) => view.id === 'browser'))
      ? openSharedBrowserLink
      : openBrowserLink
  const browserLink = useCallback(async (url: string) => {
    const handler = browserLinkTarget.current
    if (handler) await handler(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  }, [])
  const {
    openLink: chooseLink,
    getLinkActions,
    cancel: cancelLink,
    dialog: linkDialog,
  } = useLinkChooser({
    origin: linkOrigin,
    targets: linkTargets,
    details: openLinkTarget,
    browser: browserLink,
    external: (url) =>
      openExternalLink ? openExternalLink(url) : window.open(url, '_blank', 'noopener,noreferrer'),
    onError: (cause) => setSwitchError(cause instanceof Error ? cause.message : String(cause)),
  })
  const linkRouting = useRef({
    browser,
    browserWorkspaceEnabled,
    browserProfiles,
    chooseLink,
    linkOrigin,
    linkTargets,
  })
  linkRouting.current = {
    browser,
    browserWorkspaceEnabled,
    browserProfiles,
    chooseLink,
    linkOrigin,
    linkTargets,
  }
  const openLink = useCallback(
    (url: string, options?: LinkOptions) => {
      const {
        browser,
        browserWorkspaceEnabled,
        browserProfiles,
        chooseLink,
        linkOrigin,
        linkTargets,
      } = linkRouting.current
      const origin = { ...linkOrigin(), ...options?.origin }
      const pipelines = linkTargets(url, origin).filter((target) => target.kind === 'pipeline')
      if (!options?.actions?.length && !options?.signal?.aborted && pipelines.length === 1) {
        setPipelinePreview(pipelines[0])
        return
      }
      if (
        browser &&
        browserWorkspaceEnabled &&
        !options?.browser &&
        browserLinkProfile(url, browserProfiles)
      ) {
        void openSharedBrowserLink(url).catch((cause) => setSwitchError(String(cause)))
        return
      }
      chooseLink(url, options)
    },
    [openSharedBrowserLink],
  )
  useEffect(() => {
    cancelLink()
    setPipelinePreview(null)
  }, [navigationKey, runtimeRegistry.activeId, cancelLink])
  useEffect(() => (!browser ? onOpenLink?.(openLink) : undefined), [onOpenLink, openLink, browser])
  useEffect(
    () =>
      onBrowserWorkspaceFocus?.(() => {
        // The native browser is shared by Browser and Unified. Redirects, popups and
        // page focus must stay with the workspace currently hosting that surface.
        const { settingsTarget, target } = settingsNavigation.current
        if (settingsTarget || target.viewId === 'workspace') return
        if (!browserWorkspaceEnabled) updateAppPreferences({ browserWorkspaceEnabled: true })
        void navigate({ viewId: 'browser' })
      }),
    [onBrowserWorkspaceFocus, navigate, browserWorkspaceEnabled],
  )
  const linkContext = useRef({ origin: linkOrigin, targets: linkTargets, details: openLinkTarget })
  linkContext.current = { origin: linkOrigin, targets: linkTargets, details: openLinkTarget }
  const openResolvedLink = useCallback(
    (kind: 'pull' | 'pipeline', url: string, origin?: LinkOrigin) => {
      const context = linkContext.current
      const owner = { ...context.origin(), ...origin }
      const targets = context.targets(url, owner).filter((target) => target.kind === kind)
      if (!targets.length) return false
      if (targets.length === 1) context.details(targets[0])
      else openLink(url, { origin: owner })
      return true
    },
    [openLink],
  )
  const openPullLink = useCallback(
    (url: string, origin?: LinkOrigin) => openResolvedLink('pull', url, origin),
    [openResolvedLink],
  )
  const openPipelineLink = useCallback(
    (url: string, origin?: LinkOrigin) => openResolvedLink('pipeline', url, origin),
    [openResolvedLink],
  )
  const taskNotice = useTaskNotifications(
    openNotification,
    inputPreview,
    target.entityId && (target.viewId === 'tasks' || target.viewId === 'jobs')
      ? {
          runtimeId: runtimeRegistry.activeId ?? '',
          viewId: target.viewId,
          entityId: target.entityId,
        }
      : undefined,
    !threadWindow && !browserWindowId,
    target.viewId === 'browser',
  )
  const [browserIndicator, setBrowserIndicator] = useState<'unread' | 'attention'>()
  const sectionIndicators: Record<string, 'unread' | 'attention' | undefined> = {
    ...taskNotice.sectionIndicators,
    browser: browserIndicator,
  }
  if (browserIndicator && sectionIndicators.workspace !== 'attention')
    sectionIndicators.workspace = browserIndicator
  const [palette, setPalette] = useApplicationState(false)
  const extensionPalette = useStudioExtensions(
    request,
    palette && connected && snapshot?.studioExtensionsSupported === true,
    runtimeRegistry.activeId,
    snapshot?.studioExtensionsRevision,
    extensionComponentVersion(snapshot),
  )
  const commands = useRef(new Map<string, StudioCommand>())
  const [commandVersion, refreshCommands] = useApplicationState(0)
  /** A command to run once its view mounts and registers it. */
  const [pendingCommand, setPendingCommand] = useState<{ viewId: string; id: string }>()
  const registerCommand = useCallback((command: StudioCommand) => {
    if (commands.current.has(command.id)) throw new Error(`Duplicate command: ${command.id}`)
    commands.current.set(command.id, command)
    refreshCommands((n) => n + 1)
    return () => {
      commands.current.delete(command.id)
      refreshCommands((n) => n + 1)
    }
  }, [])
  /** Runs a view's command, opening the view first when the command is not registered yet. */
  const runViewCommand = async (destination: StudioNavigation, id: string) => {
    const command = commands.current.get(id)
    if (command) return command.run()
    if (await navigate(destination)) setPendingCommand({ viewId: destination.viewId, id })
  }
  const detachBrowser = () => runViewCommand({ viewId: 'browser' }, 'browser.detach')
  useEffect(() => {
    if (!pendingCommand) return
    if (target.viewId !== pendingCommand.viewId) {
      setPendingCommand(undefined)
      return
    }
    const command = commands.current.get(pendingCommand.id)
    if (command) {
      setPendingCommand(undefined)
      command.run()
    }
  }, [pendingCommand, target.viewId, commandVersion])
  const api = useMemo<StudioHostApi>(
    () => ({
      navigate,
      goBack,
      taskNavigationGuard,
      openThread,
      popOutThread,
      threadWindow: !!threadWindow,
      registerCommand,
      fileDrag,
      repositoryOpener,
      pickDirectory,
      browser,
      browserFrames,
      defaultBrowser,
      browserExtensions,
      onBrowserContextAction,
      onBrowserWorkspaceFocus,
      onBrowserPreviewInput,
      onBrowserMediaChange,
      browserWindowId,
      browserPageOnly,
      openBrowserWindow,
      openLink,
      getLinkActions,
      openBrowserLink: browserLink,
      accountStorage,
      openExternalLink,
      openPullLink,
      openPipelineLink,
      appInfo,
      updates,
      taskLauncher,
    }),
    [
      navigate,
      goBack,
      taskNavigationGuard,
      openThread,
      popOutThread,
      threadWindow,
      registerCommand,
      fileDrag,
      repositoryOpener,
      pickDirectory,
      browser,
      browserFrames,
      defaultBrowser,
      browserExtensions,
      onBrowserContextAction,
      onBrowserWorkspaceFocus,
      onBrowserPreviewInput,
      onBrowserMediaChange,
      browserWindowId,
      browserPageOnly,
      openBrowserWindow,
      openLink,
      getLinkActions,
      browserLink,
      accountStorage,
      openExternalLink,
      openPullLink,
      openPipelineLink,
      appInfo,
      updates,
      taskLauncher,
    ],
  )
  const catalog = useMemo(
    () => createExtensionCatalog([appSettingsExtension, ...extensions], api),
    [extensions, api],
  )
  const views = useMemo(
    () => new Map(catalog.views.map((view) => [view.id, loadView(view.load)])),
    [catalog],
  )
  // Delay disposal one microtask so StrictMode's setup/cleanup rehearsal does not kill a live host.
  const lifecycle = useRef(0)
  const currentCatalog = useRef(catalog)
  useEffect(() => {
    currentCatalog.current = catalog
    const generation = ++lifecycle.current
    return () => {
      queueMicrotask(() => {
        if (currentCatalog.current !== catalog || lifecycle.current === generation)
          void catalog.host.dispose().catch(console.error)
      })
    }
  }, [catalog])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const overrides = readAppPreferences().shortcutOverrides
      if (
        event.target instanceof Element &&
        event.target.closest('.xterm, [data-terminal], .cm-editor, .monaco-editor')
      )
        return
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key === 'ArrowLeft' &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !(
          event.target instanceof Element &&
          event.target.closest(
            'input, textarea, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"]',
          )
        )
      ) {
        if (!browserHistory.current && history.current.length) {
          event.preventDefault()
          void goBack()
        }
        return
      }
      if (
        matchesApplicationShortcut(event, 'palette', overrides) &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !event.repeat &&
        (palette ||
          !(
            event.target instanceof Element &&
            event.target.closest(
              '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
            )
          ))
      ) {
        event.preventDefault()
        setPalette((v) => !v)
        return
      }
      if (
        matchesApplicationShortcut(event, 'shortcuts', overrides) &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !event.repeat &&
        !(
          event.target instanceof Element &&
          event.target.closest('[role="dialog"], [role="alertdialog"]')
        )
      ) {
        event.preventDefault()
        setPalette(false)
        void navigate({ viewId: 'shortcuts' })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [palette, navigate, goBack, setPalette])
  const studioExtensionsEnabled =
    snapshot?.studioExtensionsSupported === true ||
    runtimes.some((runtime) => runtime.snapshot?.studioExtensionsSupported === true)
  const settingsViews = catalog.views.filter(
    (view) =>
      view.navigationGroup === 'settings' &&
      (view.id !== 'studio-extensions' || studioExtensionsEnabled),
  )
  const currentTask =
    target.viewId === 'tasks'
      ? workspace.tasks.find((task) => task.id === target.entityId)
      : undefined
  const parentThread =
    target.threadParent ??
    (currentTask
      ? taskParentReference(
          currentTask,
          runtimeRegistry.activeId,
          workspace.tasks,
          snapshot?.runtimeId,
          runtimes.map((source) => ({
            runtimeId: source.profile.id,
            runtimeIdentity: source.snapshot?.runtimeId,
            tasks: source.snapshot?.workspace.tasks ?? [],
          })),
        )
      : undefined)
  const SettingsView = settingsTarget && views.get(settingsTarget.viewId)
  const View = views.get(target.viewId)
  const navigationAvailability = {
    ...workspaceModes,
    botsOverviewEnabled,
    browserWorkspaceEnabled,
    artifactsEnabled,
    studioExtensionsEnabled,
    dashboardsEnabled:
      snapshot?.dashboardsSupported === true ||
      runtimes.some((runtime) => runtime.snapshot?.dashboardsSupported === true),
    showIssues,
    showJira,
  }
  const pageRuntimeId = runtimeRegistry.activeId
  const pinnedExtensionPages = pageRuntimeId
    ? (snapshot?.studioExtensionPinnedPages ?? []).map((page) => ({
        ...studioExtensionPageTarget(pageRuntimeId, page.extensionId, page.pageId),
        title: page.title,
      }))
    : []
  if (captureContent) return <StudioHostProvider api={api}>{captureContent}</StudioHostProvider>
  return (
    <StudioHostProvider api={api}>
      <RemoteDesktopSharing />
      <DictationNotice />
      <StudioToolsBridge />
      <StudioPairedComputersBridge />
      <SidebarHeaderLayout
        collapsible={[
          'tasks',
          'browser',
          'terminals',
          'workspace',
          'pulls',
          'jobs',
          'issues',
          'jira',
          'pipelines',
          'artifacts',
          'dashboards',
        ].includes(target.viewId)}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        brand={
          !browserWindowId && (
            <TitleBar
              sidebar
              platform={desktopPlatform}
              online={0}
              devices={0}
              onDevices={() => navigate({ viewId: 'runtime' })}
              onSearch={() => setPalette(true)}
            />
          )
        }
      >
        <div className="studio" data-platform={desktopPlatform} data-thread-window={!!threadWindow}>
          <div className="studio-header-corner" aria-hidden="true" />
          <TaskNotificationNotice
            notice={taskNotice.notice}
            pendingCount={taskNotice.pendingCount}
            onOpen={openNotification}
            onDismiss={taskNotice.dismiss}
          />
          <HeaderFallback>
            {browserWindowId ? (
              <header className="studio-titlebar" data-platform={desktopPlatform}>
                <span className="studio-titlebar-brand">{uiText('Browser')}</span>
                <HeaderMainSlot />
              </header>
            ) : (
              <TitleBar
                platform={desktopPlatform}
                section={catalog.views.find((view) => view.id === target.viewId)?.title}
                online={runtimes.filter((runtime) => runtime.connected).length}
                devices={runtimeRegistry.profiles.length}
                onDevices={() =>
                  void navigate({
                    viewId: 'runtime',
                  })
                }
                onSearch={() => setPalette(true)}
              />
            )}
          </HeaderFallback>
          <PreferenceSaveNotice />
          <div className="studio-body">
            {!browserWindowId && (
              <ActivityBar
                indicators={sectionIndicators}
                onDetachBrowser={browser && openBrowserWindow ? detachBrowser : undefined}
                update={update}
                onUpdate={updates ? () => void updates.install() : undefined}
                onCheckUpdates={updates ? () => void updates.check() : undefined}
                views={catalog.views.filter((view) =>
                  navigationViewVisible(view, navigationAvailability),
                )}
                activeId={settingsTarget?.viewId ?? target.viewId}
                extensionPages={pinnedExtensionPages}
                activeExtensionPage={
                  settingsTarget
                    ? undefined
                    : target.viewId === 'studio-extension-page'
                      ? target.entityId
                      : undefined
                }
                onOpenExtensionPage={(page) => void navigate(page)}
                onSelect={(viewId) => {
                  navigateSection(viewId)
                }}
              />
            )}
            <main
              ref={main}
              className="studio-main"
              tabIndex={-1}
              onClickCapture={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return
                const anchor =
                  event.target instanceof Element ? event.target.closest('a[href]') : null
                if (
                  !(anchor instanceof HTMLAnchorElement) ||
                  anchor.hasAttribute('data-dovo-external') ||
                  !/^https?:\/\//i.test(anchor.href) ||
                  !linkTargets(anchor.href, linkOrigin()).some(
                    (target) => target.kind === 'pipeline',
                  )
                )
                  return
                event.preventDefault()
                event.stopPropagation()
                openLink(anchor.href)
              }}
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return
                const anchor =
                  event.target instanceof Element ? event.target.closest('a[href]') : null
                if (
                  !(anchor instanceof HTMLAnchorElement) ||
                  anchor.hasAttribute('data-dovo-external')
                )
                  return
                const internal = parseStudioLink(anchor.href)
                if (internal) {
                  event.preventDefault()
                  if (internal.kind === 'settings')
                    void navigate({
                      viewId: internal.viewId,
                      entityId: internal.field ? `setting:${internal.field}` : undefined,
                    })
                  else {
                    const profile = runtimeRegistry.profiles.find(
                      (profile) =>
                        profile.id === internal.runtimeId ||
                        profile.connection.runtimeId === internal.runtimeId,
                    )
                    if (profile)
                      void navigate({
                        viewId: 'tasks',
                        entityId: internal.threadId,
                        threadConnection: {
                          runtimeId: profile.id,
                          threadId: internal.threadId,
                          title: anchor.textContent ?? 'Thread',
                        },
                      })
                    else setSwitchError('This thread’s computer is no longer paired.')
                  }
                  return
                }
                if (!/^https?:\/\//i.test(anchor.href)) return
                event.preventDefault()
                const url = anchor.href
                openLink(url)
              }}
            >
              {linkDialog}
              {pipelinePreview?.kind === 'pipeline' && (
                <PipelineLinkDialog
                  key={JSON.stringify([
                    pipelinePreview.runtimeId,
                    pipelinePreview.repositoryId,
                    pipelinePreview.itemId,
                  ])}
                  target={pipelinePreview}
                  View={views.get('pipelines')}
                  onClose={() => setPipelinePreview(null)}
                  onDetails={() => {
                    setPipelinePreview(null)
                    navigateLinkTarget(pipelinePreview)
                  }}
                  onExternal={openExternalLink}
                />
              )}
              {browser && onOpenLink && (
                <ExternalBrowserLinkChooser
                  subscribe={onOpenLink}
                  onOpen={(tabId) =>
                    navigate(
                      !browserWindowId &&
                        !threadWindow &&
                        !workspaceModeVisible('browser', workspaceModes)
                        ? { viewId: 'workspace', entityId: tabId }
                        : { viewId: 'browser' },
                    )
                  }
                />
              )}
              {(browserWorkspaceEnabled || unifiedWorkspaceEnabled) && browser && (
                <BrowserMediaControls onIndicatorChange={setBrowserIndicator} />
              )}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <WorkspaceDraftScope>
                  <ErrorBoundary key={target.viewId} diagnosticContext={{ viewId: target.viewId }}>
                    <Suspense
                      fallback={
                        <p className="p-6 text-xs text-muted-foreground">Loading extension…</p>
                      }
                    >
                      {ready && View ? (
                        <View
                          entityId={target.entityId}
                          nativeAgentKey={target.nativeAgentKey}
                          threadRequest={target.threadRequest}
                          threadParent={parentThread}
                          pullTarget={target.pullTarget}
                          automationTarget={target.automationTarget}
                          messageId={target.messageId}
                          threadConnection={target.threadConnection}
                          navigationKey={navigationKey}
                        />
                      ) : !ready ? (
                        <p className="p-6 text-xs text-muted-foreground">Opening workspace…</p>
                      ) : (
                        <div className="p-6 text-xs text-muted-foreground">
                          This view is unavailable. Select another view from the sidebar.
                        </div>
                      )}
                    </Suspense>
                  </ErrorBoundary>
                </WorkspaceDraftScope>
              </div>
              <Dialog
                open={settingsOpen}
                onOpenChange={(open) => {
                  if (!open) void closeSettings()
                }}
              >
                {settingsTarget && (
                  <DialogContent
                    aria-describedby={undefined}
                    className="studio-settings-dialog flex h-[min(82dvh,840px)] w-[calc(100%-1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0"
                    onCloseAutoFocus={(event) => {
                      const trigger = settingsTrigger.current
                      settingsTrigger.current = null
                      event.preventDefault()
                      const restore = trigger?.isConnected ? trigger : main.current
                      restore?.focus({ preventScroll: true })
                    }}
                  >
                    <DialogTitle className="flex h-14 shrink-0 items-center border-b px-5">
                      {uiText('Settings')}
                    </DialogTitle>
                    <SidebarHeaderLayout brand={null} collapsible={false}>
                      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
                        <SettingsNav
                          showHeading={false}
                          views={settingsViews}
                          activeId={settingsTarget.viewId}
                          initialField={
                            settingsTarget.entityId?.startsWith('setting:')
                              ? settingsTarget.entityId.slice(8)
                              : undefined
                          }
                          onSelect={(viewId) => navigate({ viewId })}
                        />
                        <div data-settings-content className="flex min-h-0 min-w-0 flex-1 flex-col">
                          <ErrorBoundary
                            key={settingsTarget.viewId}
                            diagnosticContext={{ viewId: settingsTarget.viewId }}
                          >
                            <Suspense
                              fallback={
                                <p className="p-6 text-xs text-muted-foreground">
                                  Loading settings…
                                </p>
                              }
                            >
                              {SettingsView && (
                                <SettingsView
                                  entityId={settingsTarget.entityId}
                                  threadConnection={settingsTarget.threadConnection}
                                  navigationKey={settingsNavigationKey}
                                />
                              )}
                            </Suspense>
                          </ErrorBoundary>
                        </div>
                      </div>
                    </SidebarHeaderLayout>
                  </DialogContent>
                )}
              </Dialog>
              {!browserWindowId &&
                connected &&
                snapshot?.defaults &&
                !configuredTaskHarness(snapshot.defaults) &&
                target.viewId !== 'agents' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 border-t bg-card px-4 py-2">
                    <p className="text-xs text-muted-foreground">
                      Make this workspace yours: choose default models for threads and titles.
                    </p>
                    <Button size="sm" onClick={() => navigate({ viewId: 'agents' })}>
                      Set up defaults
                    </Button>
                  </div>
                )}
              {(storageError || syncError || switchError) && (
                <p
                  role="alert"
                  className="flex items-center gap-3 shrink-0 border-t bg-destructive/10 px-4 py-2 text-xs text-destructive"
                >
                  <span className="min-w-0 flex-1">{storageError || switchError || syncError}</span>
                  {pendingSync && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={switching}
                        onClick={() => {
                          setSwitching(true)
                          setSwitchError('')
                          void retrySync()
                            .catch((error) =>
                              setSwitchError(
                                error instanceof Error ? error.message : String(error),
                              ),
                            )
                            .finally(() => setSwitching(false))
                        }}
                      >
                        Retry sync
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void navigate({
                            viewId: 'runtime',
                          })
                        }
                      >
                        Resolve edits
                      </Button>
                    </>
                  )}
                </p>
              )}
            </main>
          </div>
          {taskLauncher && <TaskLauncher bridge={taskLauncher} />}
          <ReportProblem />
          <CommandPalette
            open={palette}
            onOpenChange={setPalette}
            commands={paletteCommands({
              views: catalog.views,
              availability: navigationAvailability,
              openSection: navigateSection,
              threadCommands: Object.values(threadCommands).map((command) => ({
                ...command,
                title: uiText(command.title),
              })),
              openThreadCommand: (id) =>
                void runViewCommand(
                  {
                    viewId: 'tasks',
                    entityId:
                      id === threadCommands.newThread.id
                        ? undefined
                        : threadSelections.current.get(runtimeRegistry.activeId),
                  },
                  id,
                ),
              extra: [
                ...readAppPreferences().savedFilterViews.map((view) => ({
                  id: `saved-view.${view.id}`,
                  title: `Open saved ${view.kind} view: ${view.name}`,
                  run: () => navigate({ viewId: view.kind, entityId: `saved-view:${view.id}` }),
                })),
                ...(snapshot?.harnessPluginsSupported
                  ? [
                      {
                        id: 'agent-plugin-marketplaces',
                        title: 'Browse agent plugin marketplaces',
                        run: () =>
                          navigate({ viewId: 'studio-extensions', entityId: 'agent-plugins' }),
                      },
                    ]
                  : []),
                ...(snapshot?.studioExtensionMarketplaceSupported
                  ? [
                      {
                        id: 'studio-extension-marketplace',
                        title: 'Browse extension marketplace',
                        run: () =>
                          navigate({ viewId: 'studio-extensions', entityId: 'marketplace' }),
                      },
                    ]
                  : []),
                ...(palette && connected && snapshot?.studioExtensionsSupported === true
                  ? extensionPalette.entries.flatMap((entry) =>
                      entry.enabled
                        ? (entry.installed?.contributions ?? []).map((contribution) => ({
                            id: `studio-extension.${entry.id}/${contribution.id}`,
                            title: `${entry.installed?.name}: ${contribution.title}`,
                            run: () =>
                              navigate(
                                pageRuntimeId &&
                                  contribution.kind === 'view' &&
                                  contribution.placement === 'page'
                                  ? studioExtensionPageTarget(
                                      pageRuntimeId,
                                      entry.id,
                                      contribution.id,
                                    )
                                  : {
                                      viewId: 'studio-extensions',
                                      entityId: `${entry.id}/${contribution.id}`,
                                    },
                              ),
                          }))
                        : [],
                    )
                  : []),
              ],
              registered: commands.current.values(),
            })}
          />
        </div>
      </SidebarHeaderLayout>
    </StudioHostProvider>
  )
}
