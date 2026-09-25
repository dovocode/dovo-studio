import { ApplicationStateProvider, useApplicationState } from '@dovo/studio-core/state'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  StudioHostProvider,
  WorkspaceProvider,
  useWorkspace,
  type StudioCommand,
  type StudioExtension,
  type StudioHostApi,
  type StudioNavigation,
} from '@dovo/studio-core'
import { Button, ErrorBoundary, TooltipProvider } from '@dovo/studio-ui'
import { RuntimeOverview } from './runtime-overview'
import { createExtensionCatalog } from './extension-catalog'
import { ActivityBar } from './activity-bar'
import { CommandPalette } from './command-palette'
import { Walkthrough, walkthroughSteps } from './walkthrough'
import { TitleBar, type DesktopPlatform } from './title-bar'
type WorkbenchProps = {
  extensions: readonly StudioExtension[]
  pickDirectory?: StudioHostApi['pickDirectory']
  browser?: StudioHostApi['browser']
  desktopPlatform?: DesktopPlatform
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
function WorkbenchContent({ extensions, pickDirectory, browser, desktopPlatform }: WorkbenchProps) {
  const {
    ready,
    snapshot,
    storageError,
    connected,
    syncError,
    runtimeRegistry,
    activeRuntimeId,
    runtimes,
    pendingSync,
    retrySync,
  } = useWorkspace()
  const [switchError, setSwitchError] = useApplicationState('')
  const [switching, setSwitching] = useApplicationState(false)
  const [target, navigate] = useApplicationState<StudioNavigation>({
    viewId: extensions[0]?.views[0]?.id ?? '',
  })
  const [palette, setPalette] = useApplicationState(false)
  const [tour, setTour] = useApplicationState<number | null>(null)
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
    }),
    [registerCommand, pickDirectory, browser],
  )
  const catalog = useMemo(() => createExtensionCatalog(extensions, api), [extensions, api])
  const views = useMemo(
    () => new Map(catalog.views.map((view) => [view.id, lazy(view.load)])),
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
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [palette])
  const activeDevice = runtimes.find((entry) => entry.profile.id === activeRuntimeId)
  const activeDeviceName = activeDevice
    ? activeDevice.profile.name === new URL(activeDevice.profile.connection.address).hostname
      ? (activeDevice.snapshot?.runtimeHost ?? activeDevice.profile.name)
      : activeDevice.profile.name
    : 'Local'
  const settingsViews = catalog.views.filter((view) => view.navigationGroup === 'settings')
  const inSettings = settingsViews.some((view) => view.id === target.viewId)
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
  const setStep = (step: number) => {
    setTour(step)
    navigate({
      viewId: walkthroughSteps[step].view,
    })
  }
  return (
    <StudioHostProvider api={api}>
      <div className="studio dark">
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
        {tour !== null && (
          <Walkthrough step={tour} onStep={setStep} onClose={() => setTour(null)} />
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
            views={catalog.views}
            activeId={target.viewId}
            onSelect={(viewId) =>
              navigate({
                viewId,
              })
            }
            onHelp={() => setStep(0)}
          />
          <main className="studio-main" tabIndex={-1}>
            {inSettings && (
              <nav
                aria-label="Settings sections"
                className="flex shrink-0 flex-wrap items-center gap-1 border-b px-5 py-2"
              >
                <span className="mr-3 text-sm font-medium">
                  Settings{' '}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    All computers
                  </span>
                </span>
                {settingsViews.map((view) => (
                  <Button
                    key={view.id}
                    size="sm"
                    variant={target.viewId === view.id ? 'secondary' : 'ghost'}
                    aria-current={target.viewId === view.id ? 'page' : undefined}
                    onClick={() =>
                      navigate({
                        viewId: view.id,
                      })
                    }
                  >
                    {view.title}
                  </Button>
                ))}
              </nav>
            )}
            <ErrorBoundary key={target.viewId}>
              <Suspense
                fallback={<p className="p-6 text-xs text-muted-foreground">Loading extension…</p>}
              >
                {ready && target.viewId === 'overview' ? (
                  <RuntimeOverview />
                ) : ready && View ? (
                  <View entityId={target.entityId} />
                ) : (
                  <p className="p-6 text-xs text-muted-foreground">Opening workspace…</p>
                )}
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
        <footer className="studio-footer">
          <span>
            {connected
              ? pendingSync
                ? syncError
                  ? 'Unsent workspace changes · retry required'
                  : 'Saving workspace changes…'
                : 'Workspace synced'
              : activeRuntimeId
                ? `${activeDeviceName} offline · cached workspace`
                : 'Local drafts'}
          </span>
          <span>
            {runtimeRegistry.profiles.length}{' '}
            {runtimeRegistry.profiles.length === 1 ? 'device' : 'devices'}
          </span>
        </footer>
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
