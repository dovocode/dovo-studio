import { useEffect, useRef, useState } from 'react'
import { AppState, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import {
  createRuntimeClient,
  decodeResult,
  mutableStruct,
  uuidSchema,
  remoteDesktopRequestSchema,
  remoteDesktopResponseSchema,
  responses,
} from '@dovo/protocol'
import html from '../../assets/remote-desktop.json'
import { useRuntime } from '../runtime/connection/provider'
import { SafeModal } from '../ui/layout/safe-modal'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

const messageSchema = Schema.Union([
  mutableStruct({ channel: Schema.Literal('dovo-desktop'), type: Schema.Literal('ready') }),
  mutableStruct({
    channel: Schema.Literal('dovo-desktop'),
    type: Schema.Literal('request'),
    id: Schema.Number,
    action: Schema.Literal('desktop'),
    input: remoteDesktopRequestSchema,
  }),
  mutableStruct({
    channel: Schema.Literal('dovo-desktop'),
    type: Schema.Literal('request'),
    id: Schema.Number,
    action: Schema.Literal('unlock'),
    sessionId: uuidSchema,
  }),
])

/** Only desktop commands and one-use socket tickets cross this bridge, never Mac credentials. */
export function MobileRemoteDesktop({ onClose }: { onClose: () => void }) {
  const { styles } = useTheme()
  const { connected, snapshot, connection, readEffect } = useRuntime()
  const web = useRef<WebView>(null)
  const [foreground, setForeground] = useState(AppState.currentState !== 'background')
  const [generation, setGeneration] = useState(0)
  const [error, setError] = useState('')
  const ready = useRef(false)
  const epoch = useRef(0)
  const live = useRef({ active: true, id: null as string | null })
  const post = (value: object) =>
    web.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify({ channel: 'dovo-desktop', ...value }).replace(/</g, '\\u003c')}}));true;`,
    )
  const stop = async (id = live.current.id) => {
    if (!id) return
    try {
      await runClientEffect(
        readEffect('/api/remote-desktop', { action: 'stop', id }, remoteDesktopResponseSchema),
      )
      if (live.current.id === id) live.current.id = null
    } catch {
      if (live.current.active)
        setError('Stop could not be confirmed. The host ends idle sessions after 30 seconds.')
    }
  }
  const stopCurrent = useRef(stop)
  stopCurrent.current = stop
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // iOS briefly becomes inactive for native keyboard/password UI. Only background ends sharing.
      if (state === 'inactive') return
      live.current.active = state === 'active'
      if (state === 'background') {
        ready.current = false
        epoch.current++
        void stopCurrent.current()
      }
      setForeground(state === 'active')
    })
    return () => {
      subscription.remove()
      live.current.active = false
      epoch.current++
      void stopCurrent.current()
    }
  }, [])
  useEffect(() => {
    if (ready.current)
      post({ type: 'configure', connected, enabled: snapshot?.remoteDesktopEnabled === true })
  }, [connected, snapshot?.remoteDesktopEnabled])
  return (
    <SafeModal visible animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.row,
          { paddingHorizontal: 16, paddingVertical: 8, justifyContent: 'space-between' },
        ]}
      >
        <Text style={styles.text}>Remote desktop</Text>
        <Action label="Close" secondary onPress={onClose} />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {foreground ? (
        <WebView
          key={generation}
          ref={web}
          style={styles.screen}
          // A trustworthy local document enables Web Crypto for macOS ARD authentication.
          // The paired runtime and its socket may still use HTTP/WS over LAN/VPN.
          source={{ html, baseUrl: 'http://localhost/' }}
          originWhitelist={['*']}
          allowFileAccess={false}
          mixedContentMode="always"
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
          allowsBackForwardNavigationGestures={false}
          bounces={false}
          onShouldStartLoadWithRequest={(request) =>
            ['about:blank', 'http://localhost/'].includes(request.url)
          }
          onContentProcessDidTerminate={() => {
            ready.current = false
            epoch.current++
            void stopCurrent.current().then(() => setGeneration((value) => value + 1))
          }}
          onRenderProcessGone={() => {
            ready.current = false
            epoch.current++
            void stopCurrent.current().then(() => setGeneration((value) => value + 1))
          }}
          onMessage={(event) => {
            let value: unknown
            try {
              value = JSON.parse(event.nativeEvent.data)
            } catch {
              return
            }
            const parsed = decodeResult(messageSchema, value)
            if (!parsed.success || !live.current.active) return
            const message = parsed.data
            if (message.type === 'ready') {
              ready.current = true
              post({
                type: 'configure',
                connected,
                enabled: snapshot?.remoteDesktopEnabled === true,
              })
              return
            }
            const version = epoch.current
            const respond = async () => {
              if (message.action === 'unlock') {
                if (!connection || message.sessionId !== live.current.id)
                  throw new Error('Desktop session ended')
                const { ticket } = await runClientEffect(
                  readEffect(
                    '/api/remote-desktop/unlock-ticket',
                    { id: message.sessionId },
                    responses.ticket,
                  ),
                )
                return createRuntimeClient(connection).socketUrl(
                  '/ws/remote-desktop/unlock',
                  ticket,
                )
              }
              const input = message.input
              if (input.action === 'start') {
                if (live.current.id && live.current.id !== input.id)
                  throw new Error('Stop the current desktop session first')
                live.current.id = input.id
              } else if (input.id !== live.current.id) throw new Error('Desktop session ended')
              const result = await runClientEffect(
                readEffect('/api/remote-desktop', input, remoteDesktopResponseSchema),
              )
              if (input.action === 'stop' && live.current.id === input.id) live.current.id = null
              if ((!live.current.active || version !== epoch.current) && input.action === 'start')
                await stop(input.id)
              return result
            }
            void respond()
              .then((value) => {
                if (live.current.active && version === epoch.current)
                  post({ type: 'result', id: message.id, value })
              })
              .catch((cause: unknown) => {
                if (live.current.active && version === epoch.current)
                  post({
                    type: 'result',
                    id: message.id,
                    error: cause instanceof Error ? cause.message : String(cause),
                  })
              })
          }}
        />
      ) : (
        <Text style={styles.muted}>Sharing ended while Studio was in the background.</Text>
      )}
    </SafeModal>
  )
}
