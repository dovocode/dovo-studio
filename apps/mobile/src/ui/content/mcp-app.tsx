import { startMcpAppTools } from '@dovo/client-runtime'
import { SafeModal } from '../layout/safe-modal'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { memo, useEffect, useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import { Action } from '../controls/action'
import * as Crypto from 'expo-crypto'
import WebView from 'react-native-webview'
import {
  mcpAppDownloads,
  responses,
  mcpAppResponseSchema,
  mcpAppRpcResponseSchema,
  type McpAppReference,
  type McpApp,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from './text'
import { openAppLink } from './open-link'
import { useTheme } from '../theme'
import html from '../../../../../packages/studio-ui/mcp-apps/host.json'
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {}
export const McpAppView = memo(function McpAppView({ reference }: { reference: McpAppReference }) {
  const { colors, styles } = useTheme()

  const { call, connected, activeId, connection } = useRuntime()
  const view = useRef<WebView>(null)
  const [app, setApp] = useState<McpApp>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [height, setHeight] = useState(320)
  const [full, setFull] = useState(false)
  const nonce = useRef(Crypto.randomUUID())
  const ready = useRef(false)
  const tools = useRef<ReturnType<typeof startMcpAppTools>>(undefined)
  const advertisedTools = useRef<unknown[]>([])
  useEffect(() => {
    setApp(undefined)
    setError('')
    ready.current = false
    advertisedTools.current = []
    nonce.current = Crypto.randomUUID()
  }, [activeId, reference.taskId, reference.id])
  useEffect(() => {
    if (!connected) return
    let disposed = false
    setError('')
    void call(
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
  }, [call, activeId, reference.id, reference.taskId, connected])
  useEffect(() => {
    if (!connected || !connection || !app?.connected || app.format !== 'apps') return
    const key = nonce.current
    const sendTool = (value: unknown) =>
      view.current?.injectJavaScript(`window.dovoMcpAppTool(${JSON.stringify(value)});true;`)
    const current = startMcpAppTools({
      address: connection.address,
      ticket: async () =>
        (
          await call(
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
    call,
    reference.taskId,
    reference.id,
  ])
  const load = () => {
    if (ready.current && app)
      view.current?.injectJavaScript(
        `window.dovoMcpLoad(${JSON.stringify(app)},${JSON.stringify(nonce.current)},"dark");true;`,
      )
  }
  useEffect(load, [app?.id])
  useEffect(() => {
    if (reference.revision) view.current?.injectJavaScript('window.dovoMcpNotify();true;')
  }, [reference.revision])
  const browser =
    error && !app ? (
      <Text style={styles.error}>{error}</Text>
    ) : app ? (
      <WebView
        ref={view}
        source={{ html }}
        style={{
          height: full ? undefined : height,
          flex: full ? 1 : undefined,
          backgroundColor: 'transparent',
        }}
        originWhitelist={['*']}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        javaScriptCanOpenWindowsAutomatically={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        onShouldStartLoadWithRequest={(request) =>
          request.url === 'about:blank' ||
          (!request.isTopFrame && /^(https?:|blob:|data:|about:)/.test(request.url))
        }
        onLoad={() => {
          ready.current = true
          load()
        }}
        onContentProcessDidTerminate={() => {
          ready.current = false
          view.current?.reload()
        }}
        onRenderProcessGone={() => {
          ready.current = false
          view.current?.reload()
        }}
        onError={() => setError('Could not load MCP App')}
        onMessage={(event) => {
          let data: unknown
          try {
            data = JSON.parse(event.nativeEvent.data)
          } catch {
            return
          }
          const value = object(data)
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
            if (!connected || !app.connected)
              throw new Error('Reconnect the runtime before interacting with this app')
            if (value.method === 'ui/download-file') {
              const accepted = await new Promise<boolean>((resolve) =>
                Alert.alert(
                  'MCP App export',
                  'Save or share files offered by this app?',
                  [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Continue', onPress: () => resolve(true) },
                  ],
                  { cancelable: true, onDismiss: () => resolve(false) },
                ),
              )
              if (!accepted) throw new Error('Download declined')
              if (!(await Sharing.isAvailableAsync()))
                throw new Error('File sharing is unavailable')
              let resourceIndex = 0
              const files = await mcpAppDownloads(
                value.params,
                async (uri) =>
                  (
                    await call(
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
              for (const item of files) {
                const file = new File(Paths.cache, `${Crypto.randomUUID()}-${item.name}`)
                if (item.text !== undefined) file.write(item.text)
                else file.write(item.blob ?? '', { encoding: 'base64' })
                await Sharing.shareAsync(file.uri, { mimeType: item.mime })
              }
              return {}
            }
            if (value.method === 'ui/open-embedded') {
              const url = object(value.params).url
              if (typeof url !== 'string' || !['http:', 'https:'].includes(new URL(url).protocol))
                throw new Error('Unsupported app URL')
              const accepted = await new Promise<boolean>((resolve) =>
                Alert.alert(
                  'External MCP UI',
                  `Load ${new URL(url).origin}?`,
                  [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Load', onPress: () => resolve(true) },
                  ],
                  { cancelable: true, onDismiss: () => resolve(false) },
                ),
              )
              if (!accepted) throw new Error('External app declined')
              return {}
            }
            if (value.method === 'ui/open-link') {
              const url = object(value.params).url
              if (typeof url !== 'string' || !['http:', 'https:'].includes(new URL(url).protocol))
                throw new Error('Unsupported app link')
              await openAppLink(url)
              return {}
            }
            if (value.method === 'ui/message' || value.method === 'ui/intent') {
              const accepted = await new Promise<boolean>((resolve) =>
                Alert.alert(
                  'MCP App message',
                  `Send this message to the thread?\n\n${JSON.stringify(value.params).slice(0, 500)}`,
                  [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Send', onPress: () => resolve(true) },
                  ],
                  { cancelable: true, onDismiss: () => resolve(false) },
                ),
              )
              if (!accepted) throw new Error('Message declined')
            }
            return (
              await call(
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
            ).result
          }
          const respond = (response: Record<string, unknown>) => {
            if (key === nonce.current)
              view.current?.injectJavaScript(
                `window.dovoMcpReply(${JSON.stringify({ ...response, nonce: key, requestId })});true;`,
              )
          }
          void perform()
            .then((result) => respond({ result }))
            .catch((cause: unknown) => respond({ error: String(cause) }))
        }}
      />
    ) : (
      <Text style={styles.muted}>Loading app…</Text>
    )
  return (
    <View
      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 8, gap: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.text, { flex: 1 }]}>
          {reference.title}
          {!connected || app?.connected === false ? ' · disconnected' : ''}
        </Text>
        <Action label="Expand" secondary onPress={() => setFull(true)} />
      </View>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {notice}
        </Text>
      ) : null}
      {full ? (
        <SafeModal onRequestClose={() => setFull(false)}>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={{ padding: 12, alignItems: 'flex-end' }}>
              <Action label="Close" secondary onPress={() => setFull(false)} />
            </View>
            {browser}
          </View>
        </SafeModal>
      ) : (
        browser
      )}
    </View>
  )
})
