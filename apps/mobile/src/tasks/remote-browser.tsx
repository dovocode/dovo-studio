import { mobileWorkflow, nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { mutableStruct } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { AppState, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { Schema, Effect } from 'effect'
import { remoteBrowserTicketSchema, responses } from '@dovo/protocol'
import { remoteBrowserHtml } from '@dovo/protocol/browser-viewer'
import { useRuntime } from '../runtime/provider'
import { styles } from '../ui/theme'
const bridgeSchema = mutableStruct({
  channel: Schema.Literal('dovo-browser'),
  type: Schema.Literal('ready', 'reconnect', 'close'),
})
export function RemoteBrowser({
  taskId,
  deviceId,
  expanded = false,
}: {
  taskId: string
  deviceId?: string
  expanded?: boolean
}) {
  const { connection, readEffect } = useRuntime()
  const web = useRef<WebView>(null)
  const [generation, setGeneration] = useApplicationState(0)
  const current = useRef(0)
  const pending = useRef(false)
  const ready = useRef(false)
  const presentation = useRef(expanded)
  useEffect(() => {
    presentation.current = expanded
  }, [expanded])
  const post = (message: object) =>
    web.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify({
        channel: 'dovo-browser',
        ...message,
      }).replace(/</g, '\\u003c')}}));true;`,
    )
  const connect = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (!connection || pending.current || AppState.currentState === 'background') return
        const version = current.current
        pending.current = true
        if (deviceId)
          post({
            type: 'configure',
            device: {
              platform:
                deviceId.startsWith('ios:') || deviceId.startsWith('physical-ios:')
                  ? 'ios'
                  : 'android',
            },
          })
        return yield* mobileWorkflow(function* () {
          const result = yield* readEffect(
            deviceId ? '/api/previews/simulator/open' : '/api/previews/browser/open',
            {
              taskId,
              id: deviceId,
            },
            remoteBrowserTicketSchema,
          )
          if (version !== current.current) return
          const target = new URL(deviceId ? '/ws/simulator' : '/ws/browser', connection.address)
          target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
          target.searchParams.set('ticket', result.ticket)
          post({
            type: 'connect',
            url: target.href,
            device: result.device,
          })
          post({
            type: 'presentation',
            expanded: presentation.current,
          })
        }).pipe(
          Effect.catchAll((error) =>
            nativeEffect(() => {
              if (version === current.current)
                post({
                  type: 'error',
                  message: error instanceof Error ? error.message : String(error),
                })
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              if (version === current.current) pending.current = false
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  useEffect(() => {
    if (ready.current)
      post({
        type: 'presentation',
        expanded,
      })
  }, [expanded])
  const resume = useRef(connect)
  useEffect(() => {
    resume.current = connect
  })
  useEffect(() => {
    let backgrounded = false
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgrounded = true
        current.current++
        pending.current = false
        web.current?.injectJavaScript("window.dispatchEvent(new Event('pagehide'));true;")
      }
      if (state === 'active' && backgrounded && ready.current) {
        backgrounded = false
        // Retain the canvas, viewport and address draft while obtaining a fresh ticket.
        // Only a terminated WebKit process needs a full remount.
        void resume.current()
      }
    })
    return () => {
      current.current++
      subscription.remove()
    }
  }, [])
  return (
    <View style={styles.screen}>
      <WebView
        key={generation}
        ref={web}
        source={{
          html: remoteBrowserHtml,
        }}
        style={styles.screen}
        originWhitelist={['*']}
        allowFileAccess={false}
        mixedContentMode="always"
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        allowsBackForwardNavigationGestures={false}
        bounces={false}
        scrollEnabled={false}
        overScrollMode="never"
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        onContentProcessDidTerminate={() => {
          current.current++
          pending.current = false
          ready.current = false
          setGeneration((value) => value + 1)
        }}
        onRenderProcessGone={() => {
          current.current++
          pending.current = false
          ready.current = false
          setGeneration((value) => value + 1)
        }}
        onMessage={(event) => {
          let message: unknown
          try {
            message = JSON.parse(event.nativeEvent.data)
          } catch {
            return
          }
          const parsed = decodeResult(bridgeSchema, message)
          if (!parsed.success) return
          if (parsed.data.type === 'close') {
            current.current++
            pending.current = false
            ready.current = false
            void runClientEffect(
              readEffect(
                deviceId ? '/api/previews/simulator/close' : '/api/previews/browser/close',
                {
                  taskId,
                  id: deviceId,
                },
                responses.ok,
              ).pipe(
                Effect.catchAll((error) =>
                  nativeEffect(() =>
                    post({
                      type: 'error',
                      message: String(error),
                    }),
                  ),
                ),
              ),
            )
          } else {
            ready.current = true
            void connect()
          }
        }}
      />
    </View>
  )
}
