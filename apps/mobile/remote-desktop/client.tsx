import { createRoot } from 'react-dom/client'
import { useState, useEffect } from 'react'
import { decode, mutableStruct, remoteDesktopRequestSchema } from '@dovo/protocol'
import { Schema } from 'effect'
import {
  DesktopViewer,
  type DesktopViewerProps,
} from '../../../packages/extension-runtime/src/desktop-viewer'

const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>()
let sequence = 0
const post = (value: object) => {
  const host = window as Window & { ReactNativeWebView?: { postMessage: (data: string) => void } }
  host.ReactNativeWebView?.postMessage(JSON.stringify({ channel: 'dovo-desktop', ...value }))
}
const call = (input: object): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const id = ++sequence
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Computer did not respond. Reconnect before continuing.'))
    }, 30_000)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    })
    post({ type: 'request', id, ...input })
  })
const responseSchema = mutableStruct({
  channel: Schema.Literal('dovo-desktop'),
  type: Schema.Literal('result'),
  id: Schema.Number,
  value: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
})
window.addEventListener('message', (event) => {
  const result = Schema.decodeUnknownOption(responseSchema)(event.data)
  if (result._tag !== 'Some') return
  const { id, value, error } = result.value
  const request = pending.get(id)
  if (!request) return
  pending.delete(id)
  if (error) request.reject(new Error(error))
  else request.resolve(value)
})
const request: DesktopViewerProps['request'] = async (path, input, schema) => {
  if (path !== '/api/remote-desktop') throw new Error('Unsupported remote desktop operation')
  return decode(
    schema,
    await call({ action: 'desktop', input: decode(remoteDesktopRequestSchema, input) }),
  )
}
const unlockUrl = async (id: string) =>
  decode(Schema.String, await call({ action: 'unlock', sessionId: id }))
function App() {
  const [configuration, configure] = useState({ connected: false, enabled: false })
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const configuration = mutableStruct({
        channel: Schema.Literal('dovo-desktop'),
        type: Schema.Literal('configure'),
        connected: Schema.Boolean,
        enabled: Schema.Boolean,
      })
      const result = Schema.decodeUnknownOption(configuration)(event.data)
      if (result._tag === 'Some') configure(result.value)
    }
    window.addEventListener('message', receive)
    post({ type: 'ready' })
    return () => window.removeEventListener('message', receive)
  }, [])
  return <DesktopViewer request={request} {...configuration} unlockUrl={unlockUrl} />
}
const root = createRoot(document.getElementById('app')!)
root.render(<App />)
window.addEventListener('pagehide', () => {
  root.unmount()
  for (const item of pending.values()) item.reject(new Error('Viewer closed'))
  pending.clear()
})
