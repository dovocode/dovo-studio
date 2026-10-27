import { previewUrl, browserLinkProfile } from '@dovo/protocol'
import { RemoteDesktopSharing } from './remote-desktop-sharing'
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
} from '@dovo/studio-core'
import {
  Button,
  ErrorBoundary,
  TooltipProvider,
  SidebarHeaderLayout,
  HeaderFallback,
  useCompactLayout,
} from '@dovo/studio-ui'
import { SettingsNav } from './settings-nav'
import { useConfirmSettingsNavigation } from '@dovo/studio-core'
import { appSettingsExtension } from './app-extension'
import { useAppearance, type WindowColors } from './appearance'
import { useTaskNotifications, type NotificationTarget } from './task-notifications'
import { createExtensionCatalog } from './extension-catalog'
import { ActivityBar } from './activity-bar'
import type { InputPreviewBridge, DesktopUpdateBridge, DesktopUpdateState } from '@dovo/protocol'
import { CommandPalette } from './command-palette'
import { TaskLauncher } from './task-launcher'
import { TitleBar, type DesktopPlatform } from './title-bar'
type WorkbenchProps = {
  captureContent?: ReactNode
  threadWindow?: import('@dovo/protocol').ThreadWindowTarget
  popOutThread?: StudioHostApi['popOutThread']
  appInfo?: StudioHostApi['appInfo']
  extensions: readonly StudioExtension[]
  repositoryOpener?: StudioHostApi['repositoryOpener']
  pickDirectory?: StudioHostApi['pickDirectory']
  browserWindowId?: string
  openBrowserWindow?: StudioHostApi['openBrowserWindow']
  onBrowserWorkspaceFocus?: (listener: () => void) => () => void
  browser?: StudioHostApi['browser']
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
        <SettingsTargetProvider>
          <TooltipProvider delayDuration={350}>
            <WorkbenchErrorBoundary appInfo={props.appInfo}>
              <WorkbenchContent {...props} />
            </WorkbenchErrorBoundary>
          </TooltipProvider>
        </SettingsTargetProvider>
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
        appVersion: appInfo?.version,
        channel: appInfo?.channel,
        platform: navigator.platform,
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
  repositoryOpener,
  pickDirectory,
  browser,
  browserExtensions,
  onBrowserContextAction,
  browserWindowId,
  openBrowserWindow,
  onBrowserWorkspaceFocus,
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
}: WorkbenchProps) {
  const { showIssues, showJira, browserWorkspaceEnabled, browserProfiles } = useAppPreferences()
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
    snapshot,
    workspace,
    storageError,
    connected,
    syncError,
    runtimeRegistry,
    runtimes,
    pendingSync,
    retrySync,
    switchRuntime,
  } = useWorkspace()
  const artifactsEnabled =
    snapshot?.artifactsEnabled === true ||
    runtimes.some((runtime) => runtime.snapshot?.artifactsEnabled === true)
  const [switchError, setSwitchError] = useApplicationState('')
  const [switching, setSwitching] = useApplicationState(false)
  // Start with a fresh composer; explicit navigation still opens existing threads.
  const [target, updateTarget] = useApplicationState<StudioNavigation>(() => ({
    viewId: browserWindowId
      ? 'browser'
      : threadWindow
        ? 'tasks'
        : (extensions[0]?.views[0]?.id ?? ''),
    entityId: threadWindow?.taskId,
  }))
  const confirmSettingsNavigation = useConfirmSettingsNavigation()
  const threadSelections = useRef(new Map<string | null, string>())
  const settingsNavigation = useRef({ target, extensions })
  settingsNavigation.current = { target, extensions }
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
  const [navigationKey, setNavigationKey] = useState(0)
  const canLeave = useCallback(() => {
    const { target, extensions } = settingsNavigation.current
    return (
      !extensions.some((extension) =>
        extension.views.some(
          (view) => view.navigationGroup === 'settings' && view.id === target.viewId,
        ),
      ) || confirmSettingsNavigation()
    )
  }, [confirmSettingsNavigation])
  const navigate = useCallback(
    (next: StudioNavigation, options?: { replace?: boolean }) => {
      if (browserWindowId && next.viewId !== 'browser') return
      // Keep existing links to the former device-only PR page working.
      if (next.viewId === 'pull-request-settings')
        next = { ...next, viewId: 'pull-request-monitoring-settings' }
      const { target } = settingsNavigation.current
      if (!canLeave()) return
      if (next.viewId === 'tasks' && next.entityId) {
        const profile = currentProfiles.current.find(
          (profile) => profile.id === currentRuntime.current,
        )
        if (profile) prepareRuntimeTask(profile.connection, next.entityId)
      }
      navigationAttempt.current++
      if (
        !options?.replace &&
        (target.viewId !== next.viewId ||
          target.entityId !== next.entityId ||
          JSON.stringify(target.pullTarget) !== JSON.stringify(next.pullTarget))
      ) {
        history.current.push({ target, runtimeId: currentRuntime.current })
        if (history.current.length > 50) history.current.shift()
      }
      settingsNavigation.current.target = next
      updateTarget(next)
      setNavigationKey((key) => key + 1)
    },
    [updateTarget, canLeave, browserWindowId],
  )
  const goBack = useCallback(() => {
    const previous = history.current.at(-1)
    if (!previous || !canLeave()) return false
    const attempt = ++navigationAttempt.current
    history.current.pop()
    const restore = () => {
      if (attempt !== navigationAttempt.current) return
      settingsNavigation.current.target = previous.target
      updateTarget(previous.target)
      setNavigationKey((key) => key + 1)
    }
    if (
      previous.target.viewId === 'tasks' &&
      previous.runtimeId &&
      previous.runtimeId !== currentRuntime.current
    ) {
      void switchRuntime(previous.runtimeId)
        .then(restore)
        .catch((cause: unknown) => {
          if (attempt !== navigationAttempt.current) return
          history.current.push(previous)
          setSwitchError(cause instanceof Error ? cause.message : String(cause))
        })
    } else restore()
    return true
  }, [canLeave, updateTarget, switchRuntime, setSwitchError])
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
  const navigateSection = (viewId: string) =>
    navigate({
      viewId,
      entityId:
        viewId === 'tasks' ? threadSelections.current.get(runtimeRegistry.activeId) : undefined,
    })
  // Section history is local to this session and computer; explicit navigation
  // to a fresh composer still clears it. Ignore an old computer's pending target.
  useEffect(() => {
    if (target.viewId !== 'tasks') return
    if (!target.entityId) threadSelections.current.delete(runtimeRegistry.activeId)
    else if (workspace.tasks.some((task) => task.id === target.entityId))
      threadSelections.current.set(runtimeRegistry.activeId, target.entityId)
  }, [target, runtimeRegistry.activeId, workspace.tasks])
  useEffect(() => {
    if (target.viewId === 'tasks' && target.entityId)
      updateAppPreferences({ lastThreadId: target.entityId })
  }, [target.viewId, target.entityId])
  const openNotification = useCallback(
    (destination: NotificationTarget | (StudioNavigation & { runtimeId: string })) => {
      const attempt = ++navigationAttempt.current
      setSwitchError('')
      void (async () => {
        if (destination.runtimeId !== runtimeRegistry.activeId)
          await switchRuntime(destination.runtimeId)
        if (attempt !== navigationAttempt.current) return
        navigate({ viewId: destination.viewId, entityId: destination.entityId })
      })().catch((error: unknown) => {
        if (attempt === navigationAttempt.current)
          setSwitchError(error instanceof Error ? error.message : String(error))
      })
    },
    [runtimeRegistry.activeId, switchRuntime, navigate, setSwitchError],
  )
  // Runtime snapshots change frequently. Keep the host API (and extension catalog) stable
  // while resolving navigation against the latest paired computers.
  const threadRuntimes = useRef({
    profiles: runtimeRegistry.profiles,
    runtimes,
    activeIdentity: snapshot?.runtimeId,
  })
  threadRuntimes.current = {
    profiles: runtimeRegistry.profiles,
    runtimes,
    activeIdentity: snapshot?.runtimeId,
  }
  const openThread = useCallback<NonNullable<StudioHostApi['openThread']>>(
    (destination) => {
      if (browserWindowId) {
        if (!popOutThread || !destination.runtimeId) {
          setSwitchError('Open this draft in the main Studio window.')
          return
        }
        void popOutThread({
          runtimeId: destination.runtimeId,
          taskId: destination.threadId,
          title: destination.title,
        }).catch((cause: unknown) => setSwitchError(String(cause)))
        return
      }
      if (!canLeave()) return
      const previous = {
        target: settingsNavigation.current.target,
        runtimeId: currentRuntime.current,
      }
      const { profiles, runtimes, activeIdentity } = threadRuntimes.current
      const attempt = ++navigationAttempt.current
      setSwitchError('')
      const profile = resolveThreadRuntime(destination, profiles, runtimes)
      // A direct local connection may have no saved profile, but still has a stable identity.
      const local =
        destination.runtimeId === null &&
        currentRuntime.current === null &&
        (!destination.runtimeIdentity || destination.runtimeIdentity === activeIdentity)
      if (!profile && !local) {
        navigate({ viewId: 'runtime', threadConnection: destination })
        return
      }
      const runtimeId = profile?.id ?? null
      void (async () => {
        if (runtimeId !== currentRuntime.current) {
          if (!runtimeId) throw new Error('The parent computer is no longer available')
          await switchRuntime(runtimeId)
        }
        if (!mounted.current || attempt !== navigationAttempt.current) return
        history.current.push(previous)
        if (history.current.length > 50) history.current.shift()
        navigate(
          {
            viewId: 'tasks',
            entityId: destination.threadId,
            threadParent: destination.parent,
            nativeAgentKey: destination.nativeAgentKey,
          },
          { replace: true },
        )
      })().catch((error: unknown) => {
        if (attempt === navigationAttempt.current)
          setSwitchError(error instanceof Error ? error.message : String(error))
      })
    },
    [canLeave, switchRuntime, navigate, setSwitchError, browserWindowId, popOutThread],
  )
  const openLinkTarget = (destination: LinkTarget) => {
    if (destination.kind === 'pull') {
      navigate({
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
      navigate({
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
      navigate({ viewId: 'browser', entityId: previewUrl(url) })
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
  const openLink = useCallback(
    (url: string, options?: LinkOptions) => {
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
    [browser, browserWorkspaceEnabled, browserProfiles, openSharedBrowserLink, chooseLink],
  )
  useEffect(() => {
    cancelLink()
  }, [navigationKey, runtimeRegistry.activeId, cancelLink])
  useEffect(() => onOpenLink?.(openLink), [onOpenLink, openLink])
  useEffect(
    () => onBrowserWorkspaceFocus?.(() => navigate({ viewId: 'browser' })),
    [onBrowserWorkspaceFocus, navigate],
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
  )
  const [palette, setPalette] = useApplicationState(false)
  const commands = useRef(new Map<string, StudioCommand>())
  const [, refreshCommands] = useApplicationState(0)
  const registerCommand = useCallback((command: StudioCommand) => {
    if (commands.current.has(command.id)) throw new Error(`Duplicate command: ${command.id}`)
    commands.current.set(command.id, command)
    refreshCommands((n) => n + 1)
    return () => {
      commands.current.delete(command.id)
      refreshCommands((n) => n + 1)
    }
  }, [])
  const api = useMemo<StudioHostApi>(
    () => ({
      navigate,
      goBack,
      taskNavigationGuard,
      openThread,
      popOutThread,
      threadWindow: !!threadWindow,
      registerCommand,
      repositoryOpener,
      pickDirectory,
      browser,
      browserExtensions,
      onBrowserContextAction,
      browserWindowId,
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
      repositoryOpener,
      pickDirectory,
      browser,
      browserExtensions,
      onBrowserContextAction,
      browserWindowId,
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
            'input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]',
          )
        )
      ) {
        if (goBack()) event.preventDefault()
        return
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 'k' &&
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
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key === '/' &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !event.repeat
      ) {
        event.preventDefault()
        setPalette(false)
        navigate({ viewId: 'shortcuts' })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [palette, navigate, goBack, setPalette])
  const settingsViews = catalog.views.filter((view) => view.navigationGroup === 'settings')
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
  const inSettings = settingsViews.some((view) => view.id === target.viewId)
  const View = views.get(target.viewId)
  const navigationCommands = catalog.views
    .filter(
      (view) =>
        view.navigationGroup !== 'hidden' &&
        (view.id !== 'browser' || browserWorkspaceEnabled) &&
        (view.id !== 'artifacts' || artifactsEnabled) &&
        (view.id !== 'issues' || showIssues) &&
        (view.id !== 'jira' || showJira),
    )
    .map((view) => ({
      id: `${view.extensionId}.open.${view.id}`,
      title: `Open ${view.title}`,
      run: () => navigateSection(view.id),
    }))
  if (captureContent) return <StudioHostProvider api={api}>{captureContent}</StudioHostProvider>
  return (
    <StudioHostProvider api={api}>
      <RemoteDesktopSharing />
      <StudioToolsBridge />
      <StudioPairedComputersBridge />
      <SidebarHeaderLayout
        collapsible={
          inSettings ||
          [
            'tasks',
            'browser',
            'pulls',
            'jobs',
            'issues',
            'jira',
            'pipelines',
            'artifacts',
          ].includes(target.viewId)
        }
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
          {taskNotice.notice && (
            <div
              role="status"
              className="fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-3 rounded-lg border bg-card p-3 text-sm shadow-lg"
            >
              <button
                className="text-left"
                onClick={() => {
                  if (taskNotice.notice) openNotification(taskNotice.notice.target)
                  taskNotice.dismiss()
                }}
              >
                {taskNotice.notice.title}
              </button>
              <button aria-label="Dismiss notification" onClick={taskNotice.dismiss}>
                ×
              </button>
            </div>
          )}
          <HeaderFallback>
            {browserWindowId ? (
              <header className="studio-titlebar" data-platform={desktopPlatform}>
                <span className="studio-titlebar-brand">Browser</span>
              </header>
            ) : (
              <TitleBar
                platform={desktopPlatform}
                section={
                  inSettings
                    ? 'Settings'
                    : catalog.views.find((view) => view.id === target.viewId)?.title
                }
                online={runtimes.filter((runtime) => runtime.connected).length}
                devices={runtimeRegistry.profiles.length}
                onDevices={() =>
                  navigate({
                    viewId: 'runtime',
                  })
                }
                onSearch={() => setPalette(true)}
              />
            )}
          </HeaderFallback>
          <div className="studio-body">
            {!browserWindowId && (
              <ActivityBar
                update={update}
                onUpdate={updates ? () => void updates.install() : undefined}
                onCheckUpdates={updates ? () => void updates.check() : undefined}
                views={catalog.views.filter((view) =>
                  view.id === 'browser'
                    ? browserWorkspaceEnabled
                    : view.id === 'artifacts'
                      ? artifactsEnabled
                      : view.id === 'issues'
                        ? showIssues
                        : view.id === 'jira'
                          ? showJira
                          : true,
                )}
                activeId={target.viewId}
                onSelect={(viewId) => {
                  navigateSection(viewId)
                }}
              />
            )}
            <main
              className="studio-main"
              tabIndex={-1}
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
                if (!(anchor instanceof HTMLAnchorElement) || anchor.dataset.dovoExternal) return
                if (!/^https?:\/\//i.test(anchor.href)) return
                event.preventDefault()
                const url = anchor.href
                openLink(url)
              }}
            >
              {linkDialog}
              {browserWorkspaceEnabled && browser && <BrowserMediaControls />}
              {/* Settings get a grouped sidebar with search; other views use the full area. */}
              <div
                className={`flex min-h-0 min-w-0 flex-1 ${inSettings ? 'flex-col md:flex-row' : ''}`}
              >
                {inSettings && (
                  <SettingsNav
                    views={settingsViews}
                    activeId={target.viewId}
                    onSelect={navigateSection}
                  />
                )}
                <div
                  data-settings-content={inSettings ? '' : undefined}
                  className="flex min-h-0 min-w-0 flex-1 flex-col"
                >
                  <ErrorBoundary key={target.viewId}>
                    <Suspense
                      fallback={
                        <p className="p-6 text-xs text-muted-foreground">Loading extension…</p>
                      }
                    >
                      {ready && View ? (
                        <View
                          entityId={target.entityId}
                          nativeAgentKey={target.nativeAgentKey}
                          threadParent={parentThread}
                          pullTarget={target.pullTarget}
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
                </div>
              </div>
              {!browserWindowId &&
                connected &&
                snapshot?.defaults &&
                !configuredTaskHarness(snapshot.defaults) &&
                target.viewId !== 'agents' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 border-t bg-card px-4 py-2">
                    <p className="text-xs text-muted-foreground">
                      Make this workspace yours: choose default models for tasks and titles.
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
                          navigate({
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
          <CommandPalette
            open={palette}
            onOpenChange={setPalette}
            commands={[
              ...new Map(
                [...navigationCommands, ...commands.current.values()].map((command) => [
                  command.id,
                  command,
                ]),
              ).values(),
            ]}
          />
        </div>
      </SidebarHeaderLayout>
    </StudioHostProvider>
  )
}
