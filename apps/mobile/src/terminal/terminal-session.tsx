import { useApplicationState } from '../runtime/application-state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { startReconnecting } from '@dovo/client-runtime'
import { AppState, View } from 'react-native'
import { Text } from '../ui/text'
import { WebView } from 'react-native-webview'
import { Schema } from 'effect'
import { responses } from '@dovo/protocol'
import terminalHtml from '../../assets/terminal.json'
import { useRuntime } from '../runtime/provider'
import { styles } from '../ui/theme'
export function TerminalSession({ id }: { id: string }) {
  const { call, connection } = useRuntime(),
    view = useRef<WebView>(null),
    [error, setError] = useApplicationState(''),
    [status, setStatus] = useApplicationState('Loading terminal…')
  const [generation, setGeneration] = useApplicationState(0)
  const [ready, setReady] = useApplicationState(0)
  const sequence = useRef(0)
  const session = useRef<{
    attempt: number
    connected: () => void
    fail: (error: Error) => void
  } | null>(null)
  useEffect(() => {
    if (!ready || !connection) return
    const reconnect = startReconnecting(
      async (signal, connected) => {
        setStatus('Connecting terminal…')
        const { ticket } = await call('/api/terminals/ticket', { id }, responses.ticket)
        if (signal.aborted) return
        const url = new URL('/ws/terminal', connection.address)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        url.searchParams.set('ticket', ticket)
        const attempt = ++sequence.current
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timeout)
            signal.removeEventListener('abort', abort)
            if (session.current?.attempt === attempt) session.current = null
            view.current?.injectJavaScript(`window.disconnectTerminal(${attempt});true;`)
          }
          const abort = () => {
            cleanup()
            resolve()
          }
          const fail = (error: Error) => {
            cleanup()
            reject(error)
          }
          const timeout = setTimeout(() => fail(new Error('Terminal connection timed out.')), 10000)
          session.current = {
            attempt,
            connected: () => {
              clearTimeout(timeout)
              connected()
              setStatus('')
              setError('')
            },
            fail,
          }
          signal.addEventListener('abort', abort, { once: true })
          view.current?.injectJavaScript(
            `window.connectTerminal(${JSON.stringify(url.toString())},${attempt});true;`,
          )
        })
      },
      (error) => setError(`${error.message} Reconnecting…`),
    )
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconnect.restart()
    })
    return () => {
      subscription.remove()
      void reconnect.stop()
    }
  }, [ready, connection, call, id])
  return (
    <View style={styles.screen}>
      <WebView
        key={generation}
        onContentProcessDidTerminate={() => {
          setReady(0)
          setStatus('Reloading terminal…')
          setError('')
          setGeneration((value) => value + 1)
        }}
        onRenderProcessGone={() => {
          setReady(0)
          setStatus('Reloading terminal…')
          setError('')
          setGeneration((value) => value + 1)
        }}
        ref={view}
        source={{
          html: terminalHtml,
        }}
        style={styles.screen}
        originWhitelist={['*']}
        allowFileAccess={false}
        mixedContentMode="always"
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        onError={(event) => setError(event.nativeEvent.description)}
        onMessage={(event) => {
          try {
            const message = decode(
              Schema.Union(
                mutableStruct({
                  error: Schema.String,
                  attempt: Schema.optional(Schema.Number),
                }),
                mutableStruct({
                  type: Schema.Literal('ready', 'connected'),
                  attempt: Schema.optional(Schema.Number),
                }),
              ),
              JSON.parse(event.nativeEvent.data),
            )
            if ('type' in message && message.type === 'ready') {
              setReady((value) => value + 1)
            } else if (message.attempt === session.current?.attempt && session.current) {
              if ('error' in message) session.current.fail(new Error(message.error))
              else session.current.connected()
            } else if ('error' in message && message.attempt === undefined) {
              setError(message.error)
            }
          } catch {
            setError('The terminal sent an invalid status message.')
          }
        }}
      />
      {!!status && !error && (
        <Text
          style={[
            styles.muted,
            {
              padding: 10,
            },
          ]}
        >
          {status}
        </Text>
      )}
      {!!error && (
        <Text
          style={[
            styles.error,
            {
              padding: 10,
            },
          ]}
        >
          {error}
        </Text>
      )}
    </View>
  )
}
