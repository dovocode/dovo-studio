import { useRef, useState } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import { WebView } from 'react-native-webview'
import { z } from 'zod'
import { responses } from '@dovo/protocol'
import terminalHtml from '../../assets/terminal.json'
import { useRuntime } from '../runtime/provider'
import { styles } from '../ui/theme'
export function TerminalSession({ id }: { id: string }) {
  const { call, connection } = useRuntime(),
    view = useRef<WebView>(null),
    [error, setError] = useState(''),
    [status, setStatus] = useState('Loading terminal…')
  const connect = async () => {
    if (!connection) return
    const { ticket } = await call('/api/terminals/ticket', { id }, responses.ticket)
    const url = new URL('/ws/terminal', connection.address)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('ticket', ticket)
    view.current?.injectJavaScript(
      `window.connectTerminal(${JSON.stringify(url.toString())});true;`,
    )
  }
  return (
    <View style={styles.screen}>
      <WebView
        ref={view}
        source={{ html: terminalHtml }}
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
            const message = z
              .union([
                z.object({ error: z.string() }),
                z.object({ type: z.enum(['ready', 'connected']) }),
              ])
              .parse(JSON.parse(event.nativeEvent.data))
            if ('error' in message) setError(message.error)
            else if (message.type === 'connected') {
              setStatus('')
              setError('')
            } else {
              setStatus('Connecting terminal…')
              void connect().catch((error) => setError(String(error)))
            }
          } catch {
            setError('The terminal sent an invalid status message.')
          }
        }}
      />
      {!!status && !error && <Text style={[styles.muted, { padding: 10 }]}>{status}</Text>}
      {!!error && <Text style={[styles.error, { padding: 10 }]}>{error}</Text>}
    </View>
  )
}
