import { Effect } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  RotateCw,
  Maximize2,
  Minimize2,
  Smartphone,
  PanelRightClose,
  SlidersHorizontal,
} from 'lucide-react'
import { useWorkspace, useStudioHost, startPolling } from '@dovo/studio-core'
import {
  previewUrl,
  previewPresets,
  previewDevicesSchema,
  previewResultSchema,
  type PreviewDevice,
} from '@dovo/studio-core'
import { Button, IconButton, Input, ProjectIcon } from '@dovo/studio-ui'
import { RemoteBrowser } from './remote-browser'
import { DeviceList } from './device-list'
import { PhysicalControls } from './physical-controls'
const addresses = new Map<string, string>()
export function BrowserPane({
  taskId,
  onClose,
  initialMode = 'remote',
}: {
  taskId: string
  onClose?: () => void
  initialMode?: 'remote' | 'devices'
}) {
  const { connection } = useWorkspace()
  const scope = `${connection?.address ?? ''}:${taskId}`
  return (
    <BrowserContent
      key={scope}
      scope={scope}
      taskId={taskId}
      onClose={onClose}
      initialMode={initialMode}
    />
  )
}
function BrowserContent({
  scope,
  initialMode,
  taskId,
  onClose,
}: {
  scope: string
  initialMode: 'remote' | 'devices'
  taskId: string
  onClose?: () => void
}) {
  const { connection, request, connected, snapshot } = useWorkspace(),
    { browser } = useStudioHost()
  const [input, setInput] = useApplicationState(addresses.get(scope) ?? 'http://localhost:3000')
  const [url, setUrl] = useApplicationState(addresses.get(scope) ?? '')
  const [history, setHistory] = useApplicationState({
    url: '',
    title: '',
    back: false,
    forward: false,
  })
  const editing = useRef(false)
  const [mode, setMode] = useApplicationState<'remote' | 'web' | 'devices'>(
    initialMode === 'devices' ? 'devices' : browser ? 'web' : 'remote',
  )
  const [preset, setPreset] = useApplicationState('fill'),
    [landscape, setLandscape] = useApplicationState(false)
  const [error, setError] = useApplicationState(''),
    [reload, setReload] = useApplicationState(0)
  const [turnReload, setTurnReload] = useApplicationState(0)
  const latestTurn = snapshot?.workspace.tasks.find((task) => task.id === taskId)?.turns?.at(-1)
  const task = snapshot?.workspace.tasks.find((task) => task.id === taskId)
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === task?.repositoryId)
  const seenTurn = useRef(latestTurn?.status === 'completed' ? latestTurn.id : '')
  useEffect(() => {
    if (!latestTurn || latestTurn.status !== 'completed' || seenTurn.current === latestTurn.id)
      return
    seenTurn.current = latestTurn.id
    if (
      !latestTurn.checkpoint ||
      (!latestTurn.checkpoint.files.length && !latestTurn.checkpoint.omitted.length)
    )
      return
    if (mode === 'remote') setTurnReload((value) => value + 1)
    if (mode === 'web' && url) {
      if (browser)
        void browser({ action: 'reload', key: scope }).catch((cause) => setError(String(cause)))
      else setReload((value) => value + 1)
    }
  }, [latestTurn?.id, latestTurn?.status, latestTurn?.checkpoint, mode, url, browser, scope])
  const [devices, setDevices] = useApplicationState<PreviewDevice[]>([]),
    [diagnostics, setDiagnostics] = useApplicationState<string[]>([])
  const [liveDevice, setLiveDevice] = useApplicationState<PreviewDevice | undefined>(undefined)
  const [expanded, setExpanded] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState(false),
    [image, setImage] = useApplicationState('')
  const pending = useRef(false),
    mount = useRef(true),
    slot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    mount.current = true
    return () => {
      mount.current = false
    }
  }, [])
  const act = async (operation: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (e) {
      if (mount.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      pending.current = false
      if (mount.current) setBusy(false)
    }
  }
  const loadDevices = async () => {
    const result = await request(
      '/api/previews/devices',
      {
        taskId,
      },
      previewDevicesSchema,
    )
    if (mount.current) {
      setDevices(result.devices)
      setDiagnostics(result.diagnostics)
    }
  }
  useEffect(() => {
    if (initialMode === 'devices' && connected) void act(loadDevices)
  }, [initialMode, connected])
  const navigate = () => {
    try {
      const target = previewUrl(input, connection?.address)
      if (target === url) {
        if (browser)
          void act(() =>
            browser({
              action: 'reload',
              key: scope,
            }),
          )
        else setReload((n) => n + 1)
      }
      setUrl(target)
      setInput(target)
      addresses.set(scope, target)
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }
  useEffect(() => {
    if (!browser || !url || mode !== 'web') return
    let alive = true
    const poll = Effect.tryPromise({
      try: () => browser({ action: 'status', key: scope }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(
      Effect.tap((state) =>
        Effect.sync(() => {
          if (!alive || !state || !state.url.startsWith('http')) return
          setHistory({ ...state, title: state.title ?? '' })
          if (!editing.current) setInput(state.url)
          addresses.set(scope, state.url)
        }),
      ),
      Effect.asVoid,
    )
    const polling = startPolling(poll, {
      interval: 1000,
      onError: (error) => {
        if (alive) setError(error.message)
      },
    })
    return () => {
      alive = false
      void polling.stop()
    }
  }, [browser, url, mode, scope])
  const size = previewPresets.find((p) => p.id === preset) ?? previewPresets[0]
  useEffect(() => {
    if (!browser || !url || mode !== 'web') return
    let alive = true
    const update = () => {
      const rect = slot.current?.getBoundingClientRect()
      const obscured = document.querySelector(
        'details[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      )
      const command =
        rect && rect.width > 0 && rect.height > 0 && !obscured
          ? {
              action: 'show' as const,
              key: scope,
              url,
              viewport:
                preset === 'fill'
                  ? undefined
                  : {
                      width: landscape ? size.height : size.width,
                      height: landscape ? size.width : size.height,
                    },
              bounds: {
                x: Math.max(0, Math.round(rect.x)),
                y: Math.max(0, Math.round(rect.y)),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            }
          : {
              action: 'hide' as const,
              key: scope,
            }
      void browser(command).catch((e) => {
        if (alive) setError(String(e))
      })
    }
    const resize = new ResizeObserver(update),
      mutations = new MutationObserver(update)
    if (slot.current) resize.observe(slot.current)
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    })
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    update()
    return () => {
      alive = false
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      void browser({
        action: 'hide',
        key: scope,
      }).catch(() => {})
    }
  }, [browser, url, mode, scope, preset, landscape, size])
  const deviceAction = (
    device: PreviewDevice,
    action: 'boot' | 'shutdown' | 'open' | 'screenshot' | 'devicehub',
  ) =>
    void act(async () => {
      const result = await request(
        '/api/previews/action',
        {
          taskId,
          id: device.id,
          action,
          url: input,
        },
        previewResultSchema,
      )
      if (mount.current && result.image) setImage(result.image)
      await loadDevices()
    })
  if (mode === 'devices' && liveDevice)
    return (
      <section
        className={
          expanded
            ? 'fixed inset-0 z-50 flex flex-col bg-background'
            : 'flex h-full min-h-0 flex-col'
        }
      >
        <header className="relative z-10 flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
          <IconButton
            label="Back to devices"
            className="size-7"
            onClick={() => {
              setLiveDevice(undefined)
              setExpanded(false)
            }}
          >
            <ArrowLeft size={15} />
          </IconButton>
          <Smartphone size={14} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{liveDevice.name}</span>
          {liveDevice.kind === 'physical' && liveDevice.platform === 'ios' && (
            <PhysicalControls taskId={taskId} device={liveDevice} />
          )}
          <IconButton
            label={expanded ? 'Exit expanded view' : 'Expand preview'}
            className="size-7"
            aria-pressed={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </IconButton>
          {onClose && (
            <IconButton label="Hide preview sidebar" className="size-7 shrink-0" onClick={onClose}>
              <PanelRightClose size={15} />
            </IconButton>
          )}
        </header>
        <RemoteBrowser key={`${scope}:${liveDevice.id}`} taskId={taskId} deviceId={liveDevice.id} />
      </section>
    )
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={initialMode === 'devices' ? 'Device previews' : 'Browser previews'}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2 text-xs">
        <Button
          size="sm"
          className="h-7 max-w-[155px] rounded-lg px-2.5 text-xs"
          variant={mode === 'web' ? 'secondary' : 'ghost'}
          onClick={() => setMode('web')}
        >
          <ProjectIcon repository={repository} className="mr-1 size-3.5" />
          <span className="min-w-0 truncate">
            {mode === 'web' && history.title ? history.title : (repository?.name ?? 'Browser')}
          </span>
        </Button>
        <Button
          size="sm"
          className="h-7 rounded-lg px-2.5 text-xs"
          variant={mode === 'remote' ? 'secondary' : 'ghost'}
          onClick={() => setMode('remote')}
        >
          Remote canvas
        </Button>
        <IconButton
          label="Devices"
          className="size-7"
          aria-pressed={mode === 'devices'}
          onClick={() => {
            setMode('devices')
            void act(loadDevices)
          }}
        >
          <Smartphone size={15} />
        </IconButton>
        <span className="flex-1" />
        {onClose && (
          <IconButton label="Hide preview sidebar" className="size-7 shrink-0" onClick={onClose}>
            <PanelRightClose size={15} />
          </IconButton>
        )}
        {mode === 'web' && (
          <details className="group/viewport relative">
            <summary
              className="flex size-7 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              aria-label="Viewport options"
              title="Viewport options"
            >
              <SlidersHorizontal size={15} />
            </summary>
            <div className="absolute right-0 top-8 z-20 flex w-52 flex-col gap-1 rounded-lg border bg-popover p-2 shadow-lg">
              {browser && url && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start text-xs"
                    onClick={() => void act(() => browser({ action: 'hard-reload', key: scope }))}
                  >
                    Hard reload
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start text-xs"
                    onClick={() => void act(() => browser({ action: 'devtools', key: scope }))}
                  >
                    Open DevTools
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start text-xs"
                    onClick={() =>
                      void act(() =>
                        browser({ action: 'external', key: scope, url: history.url || url }),
                      )
                    }
                  >
                    Open in default browser
                  </Button>
                  <div className="h-px bg-border" />
                </>
              )}
              <label className="text-xs text-muted-foreground" htmlFor="responsive-viewport">
                Viewport
              </label>
              <select
                id="responsive-viewport"
                aria-label="Viewport"
                className="rounded border bg-background p-1.5 text-xs"
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
              >
                {previewPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="ghost"
                disabled={preset === 'fill'}
                onClick={() => setLandscape((v) => !v)}
              >
                Rotate
              </Button>
            </div>
          </details>
        )}
      </div>
      {mode === 'web' && (
        <form
          className="flex h-10 shrink-0 items-center gap-1 border-b px-2"
          onSubmit={(e) => {
            e.preventDefault()
            navigate()
          }}
        >
          {browser &&
            (['back', 'forward'] as const).map((action) => (
              <IconButton
                key={action}
                label={action === 'back' ? 'Back' : 'Forward'}
                type="button"
                disabled={!url || mode !== 'web' || !history[action]}
                onClick={() =>
                  void act(() =>
                    browser({
                      action,
                      key: scope,
                    }),
                  )
                }
              >
                {action === 'back' ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
              </IconButton>
            ))}
          <Input
            onFocus={() => {
              editing.current = true
            }}
            onBlur={() => {
              editing.current = false
            }}
            aria-label="Preview URL"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="http://localhost:3000"
            className="h-8 min-w-0 flex-1 border-transparent bg-transparent text-xs shadow-none focus:border-border"
          />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" type="submit">
            Go
          </Button>
          <IconButton
            label="Reload preview"
            type="button"
            disabled={!url}
            onClick={() =>
              browser
                ? void act(() =>
                    browser({
                      action: 'reload',
                      key: scope,
                    }),
                  )
                : setReload((n) => n + 1)
            }
          >
            <RotateCw size={16} />
          </IconButton>
          {url && browser && (
            <IconButton
              type="button"
              label="Open preview externally"
              onClick={() =>
                void act(() =>
                  browser({
                    action: 'external',
                    key: scope,
                    url: history.url || url,
                  }),
                )
              }
            >
              <ExternalLink size={16} />
            </IconButton>
          )}
          {url && !browser && (
            <a
              aria-label="Open preview externally"
              href={history.url || url}
              target="_blank"
              rel="noreferrer"
              className="p-2"
            >
              <ExternalLink size={16} />
            </a>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {mode === 'remote' ? (
        <RemoteBrowser taskId={taskId} reloadToken={turnReload} />
      ) : mode === 'web' ? (
        <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3">
          {!url ? (
            <div className="p-6 text-sm text-muted-foreground">
              Start your project’s development server, then enter its address. Local addresses use
              the selected runtime’s hostname. Remote servers must listen on a reachable interface.
            </div>
          ) : (
            <>
              {!browser && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Some sites block embedded previews. Use Open externally if the page is blank.
                </p>
              )}
              <div
                ref={slot}
                className="mx-auto overflow-hidden rounded-lg border bg-white"
                style={
                  !browser && size.width
                    ? {
                        width: landscape ? size.height : size.width,
                        height: landscape ? size.width : size.height,
                      }
                    : {
                        width: '100%',
                        height: '100%',
                        minHeight: 200,
                      }
                }
              >
                {!browser && (
                  <iframe
                    key={reload}
                    title="Task browser"
                    src={url}
                    className="h-full w-full border-0"
                    sandbox="allow-scripts allow-forms allow-same-origin"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Choose a device</p>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !connected}
              onClick={() => void act(loadDevices)}
            >
              Refresh
            </Button>
          </div>
          {diagnostics.map((d) => (
            <p className="mb-3 text-xs text-muted-foreground" key={d}>
              {d}
            </p>
          ))}
          {!devices.length && !busy && (
            <p className="text-sm text-muted-foreground">
              No devices found. Connect a phone to the host or create a simulator.
            </p>
          )}
          <DeviceList
            devices={devices}
            host={snapshot?.runtimeHost ?? 'This computer'}
            busy={busy}
            connected={connected}
            onOpen={setLiveDevice}
            onAction={deviceAction}
          />
          {busy && (
            <p role="status" className="py-2 text-xs">
              Working…
            </p>
          )}
          {image && (
            <figure className="mt-4">
              <figcaption className="mb-2 text-xs text-muted-foreground">
                Captured screenshot · use Screenshot to refresh
              </figcaption>
              <img
                src={image}
                alt="Simulator screenshot"
                className="max-h-[650px] max-w-full rounded-lg border"
              />
            </figure>
          )}
        </div>
      )}
    </section>
  )
}
