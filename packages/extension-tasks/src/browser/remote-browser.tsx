import { useCallback, useEffect, useRef } from 'react'
import {
  useWorkspace,
  remoteBrowserHtml,
  remoteBrowserTicketSchema,
  responses,
} from '@dovo/studio-core'
export function RemoteBrowser({ taskId, deviceId }: { taskId: string; deviceId?: string }) {
  const { connection, request } = useWorkspace()
  const frame = useRef<HTMLIFrameElement>(null)
  const version = useRef(0)
  const pending = useRef(false)
  const post = useCallback((message: object) => {
    frame.current?.contentWindow?.postMessage({ channel: 'dovo-browser', ...message }, '*')
  }, [])
  const connect = useCallback(async () => {
    if (!connection || pending.current) return
    const generation = version.current
    pending.current = true
    if (deviceId)
      post({
        type: 'configure',
        device: {
          platform:
            deviceId.startsWith('ios:') || deviceId.startsWith('physical-ios:') ? 'ios' : 'android',
        },
      })
    try {
      const result = await request(
        deviceId ? '/api/previews/simulator/open' : '/api/previews/browser/open',
        { taskId, id: deviceId },
        remoteBrowserTicketSchema,
      )
      if (generation !== version.current) return
      const target = new URL(deviceId ? '/ws/simulator' : '/ws/browser', connection.address)
      target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
      target.searchParams.set('ticket', result.ticket)
      post({ type: 'connect', url: target.href, device: result.device })
    } catch (error) {
      if (generation === version.current)
        post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      if (generation === version.current) pending.current = false
    }
  }, [connection, request, taskId, deviceId, post])
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
      if (data.type === 'reconnect') void connect()
      if (data.type === 'close')
        void request(
          deviceId ? '/api/previews/simulator/close' : '/api/previews/browser/close',
          { taskId, id: deviceId },
          responses.ok,
        ).catch((error) => post({ type: 'error', message: String(error) }))
    }
    window.addEventListener('message', receive)
    return () => {
      window.removeEventListener('message', receive)
    }
  }, [connect, request, taskId, deviceId, post])
  useEffect(
    () => () => {
      version.current++
    },
    [],
  )
  return (
    <iframe
      ref={frame}
      title="Host browser"
      srcDoc={remoteBrowserHtml}
      className="h-0 min-h-0 w-full flex-1 border-0"
      sandbox="allow-scripts allow-forms"
      onLoad={() => void connect()}
    />
  )
}
