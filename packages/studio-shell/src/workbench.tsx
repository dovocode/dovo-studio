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
  readAppPreferences,
  updateAppPreferences,
  useAppPreferences,
  StudioHostProvider,
  WorkspaceProvider,
  useWorkspace,
  type StudioCommand,
  type StudioExtension,
  type StudioHostApi,
  type StudioNavigation,
} from '@dovo/studio-core'
import { Button, ErrorBoundary, TooltipProvider, useCompactLayout } from '@dovo/studio-ui'
import { RuntimeOverview } from './runtime-overview'
import { SettingsNav } from './settings-nav'
import { appSettingsExtension } from './app-extension'
import { useAppearance } from './appearance'
import { useTaskNotifications, type NotificationTarget } from './task-notifications'
import { createExtensionCatalog } from './extension-catalog'
import { ActivityBar } from './activity-bar'
import type { InputPreviewBridge, DesktopUpdateBridge, DesktopUpdateState } from '@dovo/protocol'
import { CommandPalette } from './command-palette'
import { TaskLauncher } from './task-launcher'
import { TitleBar, type DesktopPlatform } from './title-bar'
type WorkbenchProps = {
  appInfo?: StudioHostApi['appInfo']
  extensions: readonly StudioExtension[]
  pickDirectory?: StudioHostApi['pickDirectory']
  browser?: StudioHostApi['browser']
  chooseLink?: StudioHostApi['chooseLink']
  desktopPlatform?: DesktopPlatform
  inputPreview?: InputPreviewBridge
  taskLauncher?: StudioHostApi['taskLauncher']
  updates?: DesktopUpdateBridge
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
      <WorkspaceProvider>
        <TooltipProvider delayDuration={350}>
          <ErrorBoundary scope="app">
            <WorkbenchContent {...props} />
          </ErrorBoundary>
        </TooltipProvider>
      </WorkspaceProvider>
    </ApplicationStateProvider>
  )
}
function WorkbenchContent({
  extensions,
  pickDirectory,
  browser,
  chooseLink,
  appInfo,
  desktopPlatform,
  updates,
  inputPreview,
  taskLauncher,
}: WorkbenchProps) {
  const compact = useCompactLayout()
  const { showIssues, showJira } = useAppPreferences()
  useAppearance()
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
    storageError,
    connected,
    syncError,
    runtimeRegistry,
    runtimes,
    pendingSync,
    retrySync,
    switchRuntime,
  } = useWorkspace()
  const [switchError, setSwitchError] = useApplicationState('')
  const [switching, setSwitching] = useApplicationState(false)
  // Settings → General → Open on launch.
  const [target, navigate] = useApplicationState<StudioNavigation>(() => {
    const preferences = readAppPreferences()
    return preferences.lastThreadId
      ? { viewId: 'tasks', entityId: preferences.lastThreadId }
      : {
          viewId:
            preferences.launchView === 'overview'
              ? 'overview'
              : (extensions[0]?.views[0]?.id ?? ''),
        }
  })
  useEffect(() => {
    if (target.viewId === 'tasks' && target.entityId)
      updateAppPreferences({ lastThreadId: target.entityId })
  }, [target.viewId, target.entityId])
  const openNotification = useCallback(
    (destination: NotificationTarget) => {
      setSwitchError('')
      void (async () => {
        if (destination.runtimeId !== runtimeRegistry.activeId)
          await switchRuntime(destination.runtimeId)
        navigate({ viewId: destination.viewId, entityId: destination.entityId })
      })().catch((error: unknown) =>
        setSwitchError(error instanceof Error ? error.message : String(error)),
      )
    },
    [runtimeRegistry.activeId, switchRuntime, navigate, setSwitchError],
  )
  useTaskNotifications(openNotification, inputPreview)
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
      registerCommand,
      pickDirectory,
      browser,
      chooseLink,
      appInfo,
      updates,
      taskLauncher,
    }),
    [registerCommand, pickDirectory, browser, chooseLink, appInfo, updates, taskLauncher],
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
  }, [palette])
  const settingsViews = catalog.views.filter((view) => view.navigationGroup === 'settings')
  const inSettings = settingsViews.some((view) => view.id === target.viewId)
  const taskChrome = target.viewId === 'tasks' && !compact
  const View = views.get(target.viewId)
  const navigationCommands = catalog.views
    .filter((view) => view.navigationGroup !== 'hidden')
    .map((view) => ({
      id: `${view.extensionId}.open.${view.id}`,
      title: `Open ${view.title}`,
      run: () =>
        navigate({
          viewId: view.id,
        }),
    }))
  return (
    <StudioHostProvider api={api}>
      <div className="studio dark" data-platform={desktopPlatform}>
        {!taskChrome && (
          <TitleBar
            platform={desktopPlatform}
            section={
              inSettings
                ? 'Settings'
                : target.viewId === 'overview'
                  ? 'Overview'
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
        {connected && snapshot?.defaults?.configured === false && target.viewId !== 'agents' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2">
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
            className="flex items-center gap-3 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive"
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
                        setSwitchError(error instanceof Error ? error.message : String(error)),
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
        <div className="studio-body">
          <ActivityBar
            taskHeader={taskChrome}
            update={update}
            onUpdate={updates ? () => void updates.install() : undefined}
            onCheckUpdates={updates ? () => void updates.check() : undefined}
            views={catalog.views.filter((view) =>
              view.id === 'issues' ? showIssues : view.id === 'jira' ? showJira : true,
            )}
            activeId={target.viewId}
            onSelect={(viewId) =>
              navigate({
                viewId,
              })
            }
          />
          <main className="studio-main" tabIndex={-1}>
            {/* Settings get a grouped sidebar with search; other views use the full area. */}
            <div className="flex min-h-0 min-w-0 flex-1">
              {inSettings && (
                <SettingsNav
                  views={settingsViews}
                  activeId={target.viewId}
                  onSelect={(viewId) => navigate({ viewId })}
                />
              )}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ErrorBoundary key={target.viewId}>
                  <Suspense
                    fallback={
                      <p className="p-6 text-xs text-muted-foreground">Loading extension…</p>
                    }
                  >
                    {ready && target.viewId === 'overview' ? (
                      <RuntimeOverview />
                    ) : ready && View ? (
                      <View entityId={target.entityId} />
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
          </main>
        </div>
        {taskLauncher && <TaskLauncher bridge={taskLauncher} onDispatched={openNotification} />}
        <CommandPalette
          open={palette}
          onOpenChange={setPalette}
          commands={[
            ...new Map(
              [
                {
                  id: 'studio.overview',
                  title: 'Overview · all computers',
                  run: () =>
                    navigate({
                      viewId: 'overview',
                    }),
                },
                ...navigationCommands,
                ...commands.current.values(),
              ].map((command) => [command.id, command]),
            ).values(),
          ]}
        />
      </div>
    </StudioHostProvider>
  )
}
