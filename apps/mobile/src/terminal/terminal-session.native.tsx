// iOS/Android entry: adapts the app runtime, preferences and theme to the package's native
// Ghostty session. Binaries built without expo-libghostty keep the WebView renderer.
import { useCallback } from 'react'
import { View } from 'react-native'
import { responses } from '@dovo/protocol'
import {
  NativeTerminalSession,
  nativeTerminalAvailable,
  terminalSocketUrl,
  type NativeTerminalStatus,
} from '@dovo/terminal/native'
import { nerdFontFamily } from '@dovo/studio-core/fonts'
import { useApplicationState } from '../runtime/state/application-state'
import { useRuntime } from '../runtime/connection/provider'
import { useMobilePreferences } from '../runtime/preferences/app-preferences'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { WebViewTerminalSession } from './webview-terminal-session'

export function TerminalSession(props: { id: string; visible?: boolean }) {
  return nativeTerminalAvailable ? (
    <GhosttyTerminalSession {...props} />
  ) : (
    <WebViewTerminalSession {...props} />
  )
}

function GhosttyTerminalSession({ id, visible = true }: { id: string; visible?: boolean }) {
  const { styles } = useTheme()
  const { terminalFontFamily, terminalFontSize } = useMobilePreferences()
  const { call, connection } = useRuntime()
  const [state, setState] = useApplicationState<NativeTerminalStatus>({
    status: 'Loading terminal…',
    inputReady: false,
    error: '',
    notice: '',
  })
  // A new loader identity (runtime, device token or terminal change) reconnects the session.
  const openSocket = useCallback(async () => {
    if (!connection) throw new Error('Not connected to a computer.')
    return terminalSocketUrl(
      connection,
      await call('/api/terminals/ticket', { id }, responses.ticket),
    )
  }, [call, connection, id])
  return (
    <View style={styles.screen}>
      <NativeTerminalSession
        id={id}
        visible={visible && !!connection}
        openSocket={openSocket}
        fontSize={terminalFontSize}
        font={terminalFontFamily === nerdFontFamily ? 'bundled-nerd' : 'system'}
        onStatusChange={setState}
      />
      {!!state.notice && <Text style={[styles.muted, { padding: 10 }]}>{state.notice}</Text>}
      {!!state.status && !state.error && (
        <Text style={[styles.muted, { padding: 10 }]}>{state.status}</Text>
      )}
      {!!state.error && <Text style={[styles.error, { padding: 10 }]}>{state.error}</Text>}
    </View>
  )
}
