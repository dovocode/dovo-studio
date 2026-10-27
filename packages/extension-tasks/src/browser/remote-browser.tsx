import { useScreenshotAttachment } from './screenshot-attachment'
import {
  createRuntimeClient,
  decodeResult,
  remoteBrowserMessageSchema,
  type RemoteBrowserMessage,
  type RemoteBrowserInput,
} from '@dovo/protocol'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useLayoutEffect,
  useImperativeHandle,
  type Ref,
} from 'react'
import {
  useWorkspace,
  useResolvedTheme,
  remoteBrowserHtml,
  remoteBrowserTicketSchema,
  responses,
  readAppPreferences,
} from '@dovo/studio-core'
export type RemoteBrowserControls = {
  input: (input: RemoteBrowserInput) => void
  keyboard: () => void
  screenshot: () => void
  capture: () => Promise<string | undefined>
  viewport: (preset: string, landscape: boolean) => void
  reconnect: () => void
  performance: () => void
}
export function RemoteBrowser({
  taskId,
  active = true,
  profileId = 'default',
  initialUrl,
  deviceId,
  tabId,
  onState,
  onClosed,
  reloadToken,
  ref,
  externalNavigation = false,
  onConnection,
  onFocusAddress,
  onPerformance,
  onShortcut,
}: {
  taskId: string
  active?: boolean
  profileId?: string
  initialUrl?: string
  deviceId?: string
  tabId?: string
  onState?: (state: Extract<RemoteBrowserMessage, { type: 'state' }>) => void
  onClosed?: () => void
  reloadToken?: number
  ref?: Ref<RemoteBrowserControls>
  externalNavigation?: boolean
  onConnection?: (online: boolean) => void
  onFocusAddress?: () => void
  onPerformance?: (details: string) => void
  onShortcut?: (key: 't' | 'w' | 'd', shift: boolean) => void
}) {
  const { connection, request } = useWorkspace()
  const theme = useResolvedTheme()
  const hasWorkspaceShortcuts = !!onShortcut
  const appearance = useRef(theme)
  const screenshots = useScreenshotAttachment(taskId)
  const attachScreenshot = useEffectEvent((image: string) => screenshots.attach(image))
  const reportState = useEffectEvent((state: Extract<RemoteBrowserMessage, { type: 'state' }>) =>
    onState?.(state),
  )
  const reportClosed = useEffectEvent(() => onClosed?.())
  const reportConnection = useEffectEvent((online: boolean) => onConnection?.(online))
  const reportPerformance = useEffectEvent((details: string) => onPerformance?.(details))
  const focusAddress = useEffectEvent(() => onFocusAddress?.())
  const shortcut = useEffectEvent((key: 't' | 'w' | 'd', shift: boolean) =>
    onShortcut?.(key, shift),
  )
  const address = useRef(initialUrl === 'about:blank' ? '' : initialUrl)
  useEffect(() => {
    address.current = initialUrl === 'about:blank' ? '' : initialUrl
  }, [initialUrl])
  const visibility = useRef(active)
  const online = useRef(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const captures = useRef(new Map<number, (image?: string) => void>())
  const captureId = useRef(0)
  const version = useRef(0)
  const pending = useRef(false)
  const post = useCallback((message: object) => {
    frame.current?.contentWindow?.postMessage({ channel: 'dovo-browser', ...message }, '*')
  }, [])
  useImperativeHandle(
    ref,
    () => ({
      input: (input) => post({ type: 'input', input }),
      keyboard: () => post({ type: 'keyboard' }),
      screenshot: () => post({ type: 'screenshot' }),
      capture: () =>
        new Promise((resolve) => {
          const id = ++captureId.current
          const finish = (image?: string) => {
            clearTimeout(timer)
            captures.current.delete(id)
            resolve(image)
          }
          const timer = setTimeout(() => finish(), 500)
          captures.current.set(id, finish)
          post({ type: 'snapshot', id })
        }),
      reconnect: () => post({ type: 'reconnect' }),
      performance: () => post({ type: 'performance' }),
      viewport: (preset, landscape) => post({ type: 'viewport', preset, landscape }),
    }),
    [post],
  )
  useLayoutEffect(() => {
    appearance.current = theme
    post({ type: 'appearance', theme })
  }, [theme, post])
  useEffect(() => {
    visibility.current = active
    if (active) reportConnection(online.current)
    if (tabId) post({ type: 'visibility', visible: active })
    if (active && externalNavigation) post({ type: 'input', input: { type: 'status' } })
  }, [active, tabId, post, externalNavigation])
  useEffect(() => {
    if (reloadToken) post({ type: 'reload' })
  }, [reloadToken, post])
  const connect = useCallback(async () => {
    if (!connection || pending.current) return
    const generation = version.current
    pending.current = true
    post({ type: 'appearance', theme: appearance.current })
    if (externalNavigation)
      post({
        type: 'presentation',
        expanded: true,
        externalNavigation: true,
        workspaceShortcuts: hasWorkspaceShortcuts,
      })
    if (!deviceId) post({ type: 'configure', viewport: readAppPreferences().browserViewport })
    if (deviceId)
      post({
        type: 'configure',
        device: {
          platform: /(?:^|:)(?:ios|physical-ios):/.test(deviceId) ? 'ios' : 'android',
        },
      })
    try {
      const result = await request(
        deviceId ? '/api/previews/simulator/open' : '/api/previews/browser/open',
        { taskId, id: deviceId, tabId, profileId, url: address.current },
        remoteBrowserTicketSchema,
      )
      if (generation !== version.current) return
      if (tabId && (result.tabId !== tabId || result.profileId !== profileId))
        throw new Error('Update the connected runtime to use remote browser tabs.')
      const target = createRuntimeClient(connection).socketUrl(
        deviceId ? '/ws/simulator' : '/ws/browser',
        result,
      )
      if (tabId) post({ type: 'visibility', visible: visibility.current })
      post({ type: 'connect', url: target, device: result.device })
    } catch (error) {
      if (generation === version.current)
        post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      if (generation === version.current) pending.current = false
    }
  }, [
    connection,
    request,
    taskId,
    deviceId,
    tabId,
    profileId,
    post,
    externalNavigation,
    hasWorkspaceShortcuts,
  ])
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow) return
      const data = event.data
      if (
        !data ||
        typeof data !== 'object' ||
        !('channel' in data) ||
        data.channel !== 'dovo-browser' ||
        !('type' in data)
      )
        return
      if (
        data.type === 'screenshot' &&
        'image' in data &&
        typeof data.image === 'string' &&
        visibility.current &&
        !screenshots.busy
      )
        void attachScreenshot(data.image).catch((error) =>
          post({ type: 'error', message: String(error) }),
        )
      if (data.type === 'snapshot' && 'id' in data && typeof data.id === 'number') {
        const image =
          'image' in data &&
          typeof data.image === 'string' &&
          data.image.startsWith('data:image/png;base64,') &&
          data.image.length <= 20_000_000
            ? data.image
            : undefined
        captures.current.get(data.id)?.(image)
      }
      if (data.type === 'closed') {
        const result = decodeResult(remoteBrowserMessageSchema, data)
        if (result.success && result.data.type === 'closed' && result.data.byPage) reportClosed()
      }
      if (data.type === 'state') {
        const state = decodeResult(remoteBrowserMessageSchema, data)
        if (state.success && state.data.type === 'state') {
          address.current = state.data.url === 'about:blank' ? '' : state.data.url
          reportState(state.data)
        }
      }
      if (data.type === 'connection' && 'online' in data && typeof data.online === 'boolean') {
        online.current = data.online
        reportConnection(data.online)
      }
      if (data.type === 'performance' && 'details' in data && typeof data.details === 'string')
        reportPerformance(data.details.slice(0, 2000))
      if (data.type === 'focusAddress') focusAddress()
      if (
        data.type === 'shortcut' &&
        'key' in data &&
        (data.key === 't' || data.key === 'w' || data.key === 'd') &&
        'shift' in data &&
        typeof data.shift === 'boolean'
      )
        shortcut(data.key, data.shift)
      if (data.type === 'reconnect') void connect()
      if (data.type === 'close')
        void request(
          deviceId ? '/api/previews/simulator/close' : '/api/previews/browser/close',
          { taskId, id: deviceId, tabId, profileId, url: address.current },
          responses.ok,
        ).catch((error) => post({ type: 'error', message: String(error) }))
    }
    window.addEventListener('message', receive)
    return () => {
      window.removeEventListener('message', receive)
    }
  }, [connect, request, taskId, deviceId, tabId, profileId, post, screenshots.busy])
  useEffect(
    () => () => {
      version.current++
      for (const finish of captures.current.values()) finish()
    },
    [],
  )
  return (
    <>
      {screenshots.editor}
      {screenshots.error && (
        <p role="alert" className="p-2 text-xs text-destructive">
          {screenshots.error}
        </p>
      )}
      <iframe
        ref={frame}
        title="Host browser"
        srcDoc={remoteBrowserHtml}
        className="h-0 min-h-0 w-full flex-1 border-0"
        sandbox="allow-scripts allow-forms"
        onLoad={() => void connect()}
      />
    </>
  )
}
