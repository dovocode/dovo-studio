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
} from 'lucide-react'
import { useWorkspace, useStudioHost, startPolling } from '@dovo/studio-core'
import {
  previewUrl,
  previewPresets,
  previewDevicesSchema,
  previewResultSchema,
  type PreviewDevice,
} from '@dovo/studio-core'
import { Button, IconButton, Input } from '@dovo/studio-ui'
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
    back: false,
    forward: false,
  })
  const editing = useRef(false)
  const [mode, setMode] = useApplicationState<'remote' | 'web' | 'devices'>(initialMode)
  const [preset, setPreset] = useApplicationState('fill'),
    [landscape, setLandscape] = useApplicationState(false)
  const [error, setError] = useApplicationState(''),
    [reload, setReload] = useApplicationState(0)
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
          setHistory(state)
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
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
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
    <section className="flex h-full min-h-0 flex-col" aria-label="Browser preview">
      {mode === 'web' && (
        <form
          className="flex shrink-0 items-center gap-1 border-b p-2"
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
            className="min-w-0 flex-1"
          />
          <Button size="sm" type="submit">
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
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1 text-xs">
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          variant={mode === 'remote' ? 'secondary' : 'ghost'}
          onClick={() => setMode('remote')}
        >
          Host browser
        </Button>
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          variant={mode === 'web' ? 'secondary' : 'ghost'}
          onClick={() => setMode('web')}
        >
          Responsive
        </Button>
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          variant={mode === 'devices' ? 'secondary' : 'ghost'}
          disabled={!connected || busy}
          onClick={() => {
            setMode('devices')
            void act(loadDevices)
          }}
        >
          Devices
        </Button>
        <span className="flex-1" />
        {onClose && (
          <IconButton label="Hide preview sidebar" className="size-7 shrink-0" onClick={onClose}>
            <PanelRightClose size={15} />
          </IconButton>
        )}
        {mode === 'web' && (
          <>
            <select
              aria-label="Viewport"
              className="rounded border bg-background p-1.5"
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
          </>
        )}
        <span className="ml-auto text-muted-foreground">
          {snapshot?.runtimeHost ?? 'Selected runtime'}
        </span>
      </div>
      {error && (
        <p role="alert" className="p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {mode === 'remote' ? (
        <RemoteBrowser taskId={taskId} />
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
