import { startMcpAppTools } from '@dovo/studio-core'
import { memo, useEffect, useRef, useState } from 'react'
import {
  randomUUID,
  responses,
  mcpAppDownloads,
  mcpAppResponseSchema,
  mcpAppRpcResponseSchema,
  type McpAppReference,
  type McpApp,
} from '@dovo/protocol'
import { useWorkspace, useResolvedTheme, useStudioHost } from '@dovo/studio-core'
import html from '../../../studio-ui/mcp-apps/host.json'
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {}
export const McpAppView = memo(function McpAppView({ reference }: { reference: McpAppReference }) {
  const { request, connected, activeRuntimeId, connection } = useWorkspace()
  const { chooseLink, openPullLink } = useStudioHost()
  const theme = useResolvedTheme()
  const frame = useRef<HTMLIFrameElement>(null)
  const [app, setApp] = useState<McpApp>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [height, setHeight] = useState(320)
  const [full, setFull] = useState(false)
  const nonce = useRef(randomUUID())
  const ready = useRef(false)
  const tools = useRef<ReturnType<typeof startMcpAppTools>>(undefined)
  const advertisedTools = useRef<unknown[]>([])
  useEffect(() => {
    setApp(undefined)
    setError('')
    ready.current = false
    advertisedTools.current = []
    nonce.current = randomUUID()
  }, [activeRuntimeId, reference.taskId, reference.id])
  useEffect(() => {
    if (!connected) return
    let disposed = false
    setError('')
    void request(
      '/api/mcp-apps/read',
      { taskId: reference.taskId, id: reference.id },
      mcpAppResponseSchema,
    )
      .then(({ app }) => {
        if (!disposed)
          setApp((previous) => (previous ? { ...previous, connected: app.connected } : app))
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(String(cause))
      })
    return () => {
      disposed = true
    }
  }, [request, activeRuntimeId, reference.taskId, reference.id, connected])
  useEffect(() => {
    if (!connected || !connection || !app?.connected || app.format !== 'apps') return
    const key = nonce.current
    const sendTool = (value: unknown) => frame.current?.contentWindow?.postMessage(value, '*')
    const current = startMcpAppTools({
      address: connection.address,
      ticket: async () =>
        (
          await request(
            '/api/mcp-apps/ticket',
            { taskId: reference.taskId, id: reference.id },
            responses.ticket,
          )
        ).ticket,
      call: (value) => sendTool({ ...value, type: 'app-tool-call', nonce: key }),
      cancel: (requestId) => sendTool({ type: 'app-tool-cancel', requestId, nonce: key }),
      onError: (cause) => setNotice(cause.message),
    })
    tools.current = current
    current.setTools(advertisedTools.current)
    return () => {
      tools.current = undefined
      void current.stop()
    }
  }, [
    connected,
    connection?.address,
    app?.id,
    app?.connected,
    request,
    reference.taskId,
    reference.id,
  ])
  const send = () => {
    if (app && ready.current)
      frame.current?.contentWindow?.postMessage(
        { type: 'load', app, nonce: nonce.current, theme },
        '*',
      )
  }
  useEffect(send, [app?.id, theme])
  useEffect(() => {
    if (reference.revision) frame.current?.contentWindow?.postMessage({ type: 'notify' }, '*')
  }, [reference.revision])
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow) return
      const value = object(event.data)
      if (value.type === 'ready') return
      if (value.nonce !== nonce.current) return
      if (value.type === 'app-tools' && Array.isArray(value.tools)) {
        advertisedTools.current = value.tools
        tools.current?.setTools(value.tools)
      }
      if (value.type === 'app-tool-result' && typeof value.requestId === 'string')
        tools.current?.reply({
          requestId: value.requestId,
          result: value.result,
          error: typeof value.error === 'string' ? value.error : undefined,
        })
      if (value.type === 'notice' && typeof value.message === 'string')
        setNotice(value.message.slice(0, 2000))
      if (
        value.type === 'height' &&
        typeof value.height === 'number' &&
        Number.isFinite(value.height)
      )
        setHeight(Math.max(120, Math.min(700, value.height)))
      if (value.type === 'display') setFull(value.mode === 'fullscreen')
      if (value.type === 'error' && typeof value.message === 'string') setError(value.message)
      if (
        value.type !== 'request' ||
        typeof value.requestId !== 'string' ||
        typeof value.method !== 'string'
      )
        return
      const requestId = value.requestId,
        key = nonce.current
      const perform = async () => {
        if (!connected || !app?.connected)
          throw new Error('Reconnect the runtime before interacting with this app')
        if (value.method === 'ui/download-file') {
          if (!window.confirm('Download files offered by this MCP App?'))
            throw new Error('Download declined')
          let resourceIndex = 0
          const files = await mcpAppDownloads(
            value.params,
            async (uri) =>
              (
                await request(
                  '/api/mcp-apps/rpc',
                  {
                    taskId: reference.taskId,
                    id: reference.id,
                    requestId: `${key}_${requestId}_read_${resourceIndex++}`,
                    method: 'resources/read',
                    params: { uri },
                  },
                  mcpAppRpcResponseSchema,
                )
              ).result,
          )
          for (const file of files) {
            const bytes =
              file.text !== undefined
                ? file.text
                : Uint8Array.from(atob(file.blob ?? ''), (char) => char.charCodeAt(0))
            const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }))
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = file.name
            anchor.click()
            setTimeout(() => URL.revokeObjectURL(url), 30_000)
          }
          return {}
        }
        if (value.method === 'ui/open-embedded') {
          const url = object(value.params).url
          if (typeof url !== 'string' || !['http:', 'https:'].includes(new URL(url).protocol))
            throw new Error('Unsupported app URL')
          if (!window.confirm(`Load an external MCP UI from ${new URL(url).origin}?`))
            throw new Error('External app declined')
          return {}
        }
        if (value.method === 'ui/open-link') {
          const url = object(value.params).url
          if (typeof url !== 'string' || !['http:', 'https:'].includes(new URL(url).protocol))
            throw new Error('Unsupported app link')
          if (openPullLink?.(url)) return {}
          if (chooseLink) await chooseLink(url)
          else if (window.confirm(`Open ${url}?`)) window.open(url, '_blank', 'noopener,noreferrer')
          return {}
        }
        if (
          (value.method === 'ui/message' || value.method === 'ui/intent') &&
          !window.confirm(
            `Send this MCP App message to the thread?\n\n${JSON.stringify(value.params).slice(0, 500)}`,
          )
        )
          throw new Error('Message declined')
        const result = await request(
          '/api/mcp-apps/rpc',
          {
            taskId: reference.taskId,
            id: reference.id,
            requestId: `${key}_${requestId}`,
            method: value.method,
            params:
              value.method === 'ui/cancel'
                ? { requestId: `${key}_${String(object(value.params).requestId)}` }
                : value.params,
          },
          mcpAppRpcResponseSchema,
        )
        return result.result
      }
      void perform()
        .then((result) => {
          if (key === nonce.current)
            frame.current?.contentWindow?.postMessage(
              { type: 'reply', nonce: key, requestId, result },
              '*',
            )
        })
        .catch((cause: unknown) => {
          if (key === nonce.current)
            frame.current?.contentWindow?.postMessage(
              { type: 'reply', nonce: key, requestId, error: String(cause) },
              '*',
            )
        })
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [app, theme, connected, request, chooseLink, openPullLink, reference.id, reference.taskId])
  return (
    <div
      className={
        full
          ? 'fixed inset-4 z-50 rounded-lg border bg-background p-3 shadow-xl'
          : 'min-w-0 rounded-lg border bg-background p-2'
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span>
          {reference.title}
          {!connected || app?.connected === false ? ' · disconnected' : ''}
        </span>
        <button type="button" onClick={() => setFull(!full)}>
          {full ? 'Close expanded view' : 'Expand'}
        </button>
      </div>
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {error && !app ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : app ? (
        <iframe
          ref={frame}
          srcDoc={html}
          sandbox="allow-scripts"
          title={reference.title}
          className="w-full border-0"
          style={{ height: full ? 'calc(100% - 32px)' : height }}
          onLoad={() => {
            ready.current = true
            send()
          }}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Loading app…</p>
      )}
    </div>
  )
})
