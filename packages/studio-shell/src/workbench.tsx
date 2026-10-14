import { forgePullTarget, pullRepositoryIdentity, decodeWorkTarget } from '@dovo/protocol'
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
} from 'react'
import {
  type StudioViewProps,
  updateAppPreferences,
  useAppPreferences,
  StudioHostProvider,
  SettingsTargetProvider,
  WorkspaceProvider,
  useWorkspace,
  useRepositorySources,
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
  threadWindow?: import('@dovo/protocol').ThreadWindowTarget
  popOutThread?: StudioHostApi['popOutThread']
  appInfo?: StudioHostApi['appInfo']
  extensions: readonly StudioExtension[]
  pickDirectory?: StudioHostApi['pickDirectory']
  browser?: StudioHostApi['browser']
  chooseLink?: StudioHostApi['chooseLink']
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
            <ErrorBoundary scope="app">
              <WorkbenchContent {...props} />
            </ErrorBoundary>
          </TooltipProvider>
        </SettingsTargetProvider>
      </WorkspaceProvider>
    </ApplicationStateProvider>
  )
}
function WorkbenchContent({
  extensions,
  threadWindow,
  popOutThread,
  pickDirectory,
  browser,
  chooseLink,
  openExternalLink,
  appInfo,
  desktopPlatform,
  updates,
  inputPreview,
  taskLauncher,
  windowColors,
}: WorkbenchProps) {
  const { showIssues, showJira } = useAppPreferences()
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
    viewId: threadWindow ? 'tasks' : (extensions[0]?.views[0]?.id ?? ''),
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
      const { target } = settingsNavigation.current
      if (!canLeave()) return
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
    [updateTarget, canLeave],
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
  const repositorySources = useRepositorySources()
  const linkContext = useRef({ repositorySources, tasks: workspace.tasks })
  linkContext.current = { repositorySources, tasks: workspace.tasks }
  const openPullLink = useCallback(
    (url: string, origin?: { runtimeId?: string; repositoryId?: string }) => {
      const { repositorySources, tasks } = linkContext.current
      const pull = forgePullTarget(
        url,
        repositorySources.map((source) => ({
          identity: pullRepositoryIdentity(source.repository),
        })),
      )
      if (!pull) return false
      const { target } = settingsNavigation.current
      const integrationOrigin = target.pullTarget ?? decodeWorkTarget(target.entityId)
      const runtimeId =
        origin?.runtimeId ??
        integrationOrigin?.runtimeId ??
        (target.viewId === 'tasks' ? currentRuntime.current : undefined)
      const repositoryId =
        origin?.repositoryId ??
        integrationOrigin?.repositoryId ??
        (target.viewId === 'tasks'
          ? tasks.find((task) => task.id === target.entityId)?.repositoryId
          : undefined)
      const matches = repositorySources.filter(
        (source) => pullRepositoryIdentity(source.repository) === pull.identity,
      )
      const contextual = matches.find(
        (source) => source.runtimeId === runtimeId && source.repository.id === repositoryId,
      )
      const sameRuntime = matches.filter((source) => source.runtimeId === runtimeId)
      const source =
        contextual ??
        (sameRuntime.length === 1 ? sameRuntime[0] : matches.length === 1 ? matches[0] : undefined)
      navigate({
        viewId: 'pulls',
        entityId: pull.navigationUrl,
        ...(source || runtimeId
          ? {
              pullTarget: {
                runtimeId: source?.runtimeId ?? runtimeId ?? '',
                repositoryId: source?.repository.id,
                number: pull.number,
                url: pull.navigationUrl,
                tab: pull.tab,
                fragment: pull.fragment,
              },
            }
          : {}),
      })
      return true
    },
    [navigate],
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
    !threadWindow,
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
      popOutThread,
      threadWindow: !!threadWindow,
      registerCommand,
      pickDirectory,
      browser,
      chooseLink,
      openExternalLink,
      openPullLink,
      appInfo,
      updates,
      taskLauncher,
    }),
    [
      navigate,
      goBack,
      taskNavigationGuard,
      popOutThread,
      threadWindow,
      registerCommand,
      pickDirectory,
      browser,
      chooseLink,
      openExternalLink,
      openPullLink,
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
  const inSettings = settingsViews.some((view) => view.id === target.viewId)
  const View = views.get(target.viewId)
  const navigationCommands = catalog.views
    .filter(
      (view) =>
        view.navigationGroup !== 'hidden' &&
        (view.id !== 'artifacts' || artifactsEnabled) &&
        (view.id !== 'issues' || showIssues) &&
        (view.id !== 'jira' || showJira),
    )
    .map((view) => ({
      id: `${view.extensionId}.open.${view.id}`,
      title: `Open ${view.title}`,
      run: () => navigateSection(view.id),
    }))
  return (
    <StudioHostProvider api={api}>
      <SidebarHeaderLayout
        collapsible={
          inSettings ||
          ['tasks', 'pulls', 'jobs', 'issues', 'jira', 'pipelines', 'artifacts'].includes(
            target.viewId,
          )
        }
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        brand={
          <TitleBar
            sidebar
            platform={desktopPlatform}
            online={0}
            devices={0}
            onDevices={() => navigate({ viewId: 'runtime' })}
            onSearch={() => setPalette(true)}
          />
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
          </HeaderFallback>
          <div className="studio-body">
            <ActivityBar
              update={update}
              onUpdate={updates ? () => void updates.install() : undefined}
              onCheckUpdates={updates ? () => void updates.check() : undefined}
              views={catalog.views.filter((view) =>
                view.id === 'artifacts'
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
                if (openPullLink(anchor.href)) event.preventDefault()
              }}
            >
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
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <ErrorBoundary key={target.viewId}>
                    <Suspense
                      fallback={
                        <p className="p-6 text-xs text-muted-foreground">Loading extension…</p>
                      }
                    >
                      {ready && View ? (
                        <View
                          entityId={target.entityId}
                          pullTarget={target.pullTarget}
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
              {connected &&
                snapshot?.defaults?.configured === false &&
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
