import { legacyLibrary, AppErrorBoundary } from './legacy-components'
import { z } from 'zod'
z.config({ jitless: true })
import { createRoot, type Root } from 'react-dom/client'
import {
  UIResourceRenderer,
  remoteCardDefinition,
  remoteTextDefinition,
  remoteButtonDefinition,
  remoteStackDefinition,
  remoteImageDefinition,
  type UIActionResult,
} from '@mcp-ui/legacy'
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import {
  CallToolResultSchema,
  ReadResourceResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListToolsResultSchema,
  ListPromptsResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { resourceCsp, csp, protectHtml, sources } from './security'
import sandbox from './sandbox.json'
import type { McpApp } from '@dovo/protocol'
const rootElement = document.getElementById('root')!
const appCalls = new Map<string, AbortController>()
let bridge: AppBridge | undefined
let legacy: Root | undefined
let frame: HTMLIFrameElement | undefined
let proxyURL: string | undefined
let nonce = ''
let loading = 0
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    cancel: () => void
    timer: ReturnType<typeof setTimeout>
  }
>()
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
function post(value: Record<string, unknown>) {
  const envelope = { ...value, nonce }
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(envelope))
  else parent.postMessage(envelope, '*')
}
function rpc(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
  if (pending.size >= 16) return Promise.reject(new Error('Too many pending app requests'))
  const requestId = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        cancel()
      },
      10 * 60 * 1000,
    )
    const cancel = () => {
      if (!pending.has(requestId)) return
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      pending.delete(requestId)
      post({
        type: 'request',
        requestId: `cancel_${requestId}`,
        method: 'ui/cancel',
        params: { requestId },
      })
      reject(new Error('App request cancelled'))
    }
    signal?.addEventListener('abort', cancel, { once: true })
    pending.set(requestId, {
      resolve: (value) => {
        signal?.removeEventListener('abort', cancel)
        resolve(value)
      },
      reject: (error) => {
        signal?.removeEventListener('abort', cancel)
        reject(error)
      },
      cancel,
      timer,
    })
    if (signal?.aborted) {
      cancel()
      return
    }
    post({ type: 'request', requestId, method, params })
  })
}
function reply(value: unknown) {
  const data = record(value)
  if (data.nonce !== nonce || typeof data.requestId !== 'string') return
  const entry = pending.get(data.requestId)
  if (!entry) return
  pending.delete(data.requestId)
  clearTimeout(entry.timer)
  if (typeof data.error === 'string') entry.reject(new Error(data.error))
  else entry.resolve(data.result)
}
async function cleanup() {
  post({ type: 'app-tools', tools: [] })
  for (const controller of appCalls.values()) controller.abort()
  appCalls.clear()
  for (const entry of pending.values()) entry.cancel()
  pending.clear()
  if (bridge) {
    await bridge.teardownResource({}, { timeout: 500 }).catch(() => {})
    await bridge.close()
    bridge = undefined
  }
  legacy?.unmount()
  legacy = undefined
  frame?.remove()
  frame = undefined
  if (proxyURL) URL.revokeObjectURL(proxyURL)
  proxyURL = undefined
  rootElement.replaceChildren()
}
async function load(app: McpApp, nextNonce: string, theme: 'dark' | 'light', mobile: boolean) {
  const ticket = ++loading
  await cleanup()
  if (ticket !== loading) return
  nonce = nextNonce
  document.documentElement.style.colorScheme = theme
  const resource = record(app.resource)
  const meta = record(resource._meta)
  const ui = record(meta.ui)
  const policy = resourceCsp(ui.csp)
  let html =
    typeof resource.text === 'string'
      ? resource.text
      : typeof resource.blob === 'string'
        ? new TextDecoder().decode(
            Uint8Array.from(atob(resource.blob), (char) => char.charCodeAt(0)),
          )
        : ''
  const hostPolicy = document.createElement('meta')
  hostPolicy.httpEquiv = 'Content-Security-Policy'
  hostPolicy.content = csp(policy)
    .replace("script-src 'unsafe-inline'", "script-src 'unsafe-inline' 'unsafe-eval'")
    .replace(/frame-src [^;]*;/, `frame-src about: data: blob: ${policy.frameDomains.join(' ')};`)
  // Runtime content lives in child frames. This also confines legacy Remote DOM's sandbox.
  if (resource.mimeType !== 'text/uri-list') document.head.append(hostPolicy)
  if (app.format === 'legacy') {
    let prepared = { ...resource }
    if (
      typeof resource.mimeType === 'string' &&
      resource.mimeType.split(';')[0].trim() === 'text/html'
    )
      prepared = {
        ...resource,
        mimeType: 'text/html',
        text: protectHtml(html, csp(policy)),
        blob: undefined,
      }
    if (resource.mimeType === 'text/uri-list') {
      const url = html
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#'))
      if (
        !url ||
        !sources([new URL(url).origin]).length ||
        new URL(url).username ||
        new URL(url).password
      )
        throw new Error('Unsafe legacy UI URL')
      const origin = new URL(url).origin
      await rpc('ui/open-embedded', { url })
      hostPolicy.content = hostPolicy.content.replace(
        /frame-src [^;]*;/,
        `frame-src about: data: blob: ${origin};`,
      )
      document.head.append(hostPolicy)
      prepared = { ...resource, text: url }
    }
    if (
      typeof resource.mimeType === 'string' &&
      resource.mimeType.startsWith('application/vnd.mcp-ui.remote-dom')
    )
      prepared = { ...prepared, mimeType: 'application/vnd.mcp-ui.remote-dom;framework=react' }
    legacy = createRoot(rootElement)
    const action = (value: UIActionResult) => {
      if (value.type === 'tool')
        return rpc('tools/call', { name: value.payload.toolName, arguments: value.payload.params })
      if (value.type === 'prompt')
        return rpc('ui/message', {
          role: 'user',
          content: [{ type: 'text', text: value.payload.prompt }],
        })
      if (value.type === 'link') return rpc('ui/open-link', value.payload)
      if (value.type === 'notify') {
        post({ type: 'notice', message: value.payload.message })
        return Promise.resolve({})
      }
      return rpc('ui/intent', value.payload)
    }
    legacy.render(
      <AppErrorBoundary>
        <UIResourceRenderer
          resource={prepared}
          onUIAction={action}
          remoteDomProps={{
            library: legacyLibrary,
            remoteElements: [
              remoteCardDefinition,
              remoteTextDefinition,
              remoteButtonDefinition,
              remoteStackDefinition,
              remoteImageDefinition,
            ],
          }}
          htmlProps={{
            sandboxPermissions: 'allow-scripts allow-forms',
            autoResizeIframe: { height: true },
            iframeRenderData: record(meta['mcpui.dev/ui-initial-render-data']),
            style: { width: '100%', height: 420 },
          }}
        />
      </AppErrorBoundary>,
    )
    return
  }
  bridge = new AppBridge(
    null,
    { name: 'Dovo Studio', version: '1.0.0' },
    {
      openLinks: {},
      downloadFile: {},
      serverTools: { listChanged: true },
      serverResources: { listChanged: true },
      logging: {},
      message: { text: {} },
      updateModelContext: { text: {}, structuredContent: {} },
      sandbox: { csp: policy, permissions: {} },
    },
    {
      hostContext: {
        theme,
        platform: mobile ? 'mobile' : 'desktop',
        displayMode: 'inline',
        availableDisplayModes: ['inline', 'fullscreen'],
        locale: navigator.language,
      },
    },
  )
  const current = bridge
  current.oncalltool = async (params, extra) =>
    CallToolResultSchema.parse(await rpc('tools/call', params, extra.mcpReq.signal))
  current.onreadresource = async (params) =>
    ReadResourceResultSchema.parse(await rpc('resources/read', params))
  current.onlistresources = async (params) =>
    ListResourcesResultSchema.parse(await rpc('resources/list', params))
  current.onlistresourcetemplates = async (params) =>
    ListResourceTemplatesResultSchema.parse(await rpc('resources/templates/list', params))
  current.setRequestHandler(
    'tools/list',
    {
      params: z
        .object({
          cursor: z.string().optional(),
          _meta: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
    },
    async (params, extra) =>
      ListToolsResultSchema.parse(await rpc('tools/list', params, extra.mcpReq.signal)),
  )
  current.onlistprompts = async (params) =>
    ListPromptsResultSchema.parse(await rpc('prompts/list', params))
  current.onmessage = async (params) => {
    await rpc('ui/message', params)
    return {}
  }
  current.onupdatemodelcontext = async (params) => {
    await rpc('ui/update-model-context', params)
    return {}
  }
  current.ondownloadfile = async (params) => {
    await rpc('ui/download-file', params)
    return {}
  }
  current.onopenlink = async (params) => {
    await rpc('ui/open-link', params)
    return {}
  }
  current.onloggingmessage = ({ level, data }) => {
    if (level === 'error' || level === 'warning')
      post({ type: 'notice', message: JSON.stringify(data).slice(0, 2000) })
  }
  current.onrequestdisplaymode = async ({ mode }) => {
    const displayMode = mode === 'fullscreen' ? 'fullscreen' : 'inline'
    post({ type: 'display', mode: displayMode })
    current.setHostContext({ theme, displayMode })
    return { mode: displayMode }
  }
  current.onsizechange = ({ height }) => {
    if (typeof height === 'number' && Number.isFinite(height)) post({ type: 'height', height })
  }
  const publishTools = async () => {
    if (bridge !== current || !current.getAppCapabilities()?.tools) return
    const result = await current.listTools({})
    if (bridge === current) post({ type: 'app-tools', tools: result.tools })
  }
  current.setNotificationHandler('notifications/tools/list_changed', () => {
    void publishTools().catch((error) => post({ type: 'notice', message: String(error) }))
  })
  current.oninitialized = async () => {
    await current.sendToolInput({ arguments: record(app.input) })
    await current.sendToolResult(CallToolResultSchema.parse(app.result))
    await publishTools()
  }
  current.onsandboxready = async () => {
    await current.sendSandboxResourceReady({
      html,
      csp: policy,
      permissions: {},
      sandbox: 'allow-scripts allow-forms',
    })
  }
  proxyURL = URL.createObjectURL(new Blob([sandbox], { type: 'text/html' }))
  frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.style.cssText = 'border:0;width:100%;height:100%;min-height:160px;display:block'
  rootElement.append(frame)
  await current.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!))
  frame.src = proxyURL
}
function notify() {
  if (!bridge) return
  void Promise.all([
    bridge.sendToolListChanged(),
    bridge.sendResourceListChanged(),
    bridge.sendPromptListChanged(),
  ]).catch((error) => post({ type: 'error', message: String(error) }))
}
function appToolMessage(input: unknown) {
  const value = record(input)
  if (value.nonce !== nonce || typeof value.requestId !== 'string') return
  if (value.type === 'app-tool-cancel') {
    appCalls.get(value.requestId)?.abort()
    return
  }
  if (value.type !== 'app-tool-call' || typeof value.name !== 'string') return
  const current = bridge,
    key = nonce,
    requestId = value.requestId
  if (!current) return
  const controller = new AbortController()
  appCalls.set(requestId, controller)
  void current
    .callTool(
      { name: value.name, arguments: record(value.arguments) },
      { signal: controller.signal, timeout: 30000 },
    )
    .then((result) => {
      if (bridge === current && nonce === key) post({ type: 'app-tool-result', requestId, result })
    })
    .catch((error) => {
      if (bridge === current && nonce === key)
        post({ type: 'app-tool-result', requestId, error: String(error) })
    })
    .finally(() => appCalls.delete(requestId))
}
window.dovoMcpAppTool = appToolMessage
window.addEventListener('message', (event) => {
  if (event.source !== parent) return
  appToolMessage(event.data)
  if (event.data?.type === 'load')
    void load(event.data.app, event.data.nonce, event.data.theme, false).catch((error) =>
      post({ type: 'error', message: String(error) }),
    )
  if (event.data?.type === 'reply') reply(event.data)
  if (event.data?.type === 'notify') notify()
  if (event.data?.type === 'teardown') void cleanup()
})
window.dovoMcpLoad = (app, key, theme) => {
  void load(app, key, theme, true).catch((error) => post({ type: 'error', message: String(error) }))
}
window.dovoMcpReply = reply
window.dovoMcpNotify = notify
window.addEventListener('pagehide', () => {
  void cleanup()
})
const observer = new ResizeObserver(() => {
  if (legacy) post({ type: 'height', height: Math.min(1000, rootElement.scrollHeight) })
})
observer.observe(rootElement)
post({ type: 'ready' })
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(value: string): void }
    dovoMcpLoad: (app: McpApp, key: string, theme: 'dark' | 'light') => void
    dovoMcpReply: (value: unknown) => void
    dovoMcpNotify: () => void
    dovoMcpAppTool: (value: unknown) => void
  }
}
