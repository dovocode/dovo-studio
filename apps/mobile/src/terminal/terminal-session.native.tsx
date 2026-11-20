import { useTerminalViewed } from './use-terminal-viewed'
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
import { WebViewTerminalSession, type MobileTerminalSessionProps } from './webview-terminal-session'

export function TerminalSession(props: MobileTerminalSessionProps) {
  return nativeTerminalAvailable ? (
    <GhosttyTerminalSession {...props} />
  ) : (
    <WebViewTerminalSession {...props} />
  )
}

function GhosttyTerminalSession({
  id,
  visible = true,
  covered = false,
  readOnly = false,
  reconnectToken,
}: MobileTerminalSessionProps) {
  const { styles, colors } = useTheme()
  const { terminalFontFamily, terminalFontSize } = useMobilePreferences()
  const { call, connection, connected } = useRuntime()
  const [state, setState] = useApplicationState<NativeTerminalStatus>({
    status: 'Loading terminal…',
    inputReady: false,
    error: '',
    notice: '',
  })
  const viewError = useTerminalViewed(
    id,
    visible && (state.inputReady || (readOnly && !state.status && !state.error)),
    covered,
  )
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
      {!!viewError && <Text accessibilityRole="alert">{viewError}</Text>}
      <NativeTerminalSession
        id={id}
        visible={visible && !!connection && connected}
        readOnly={readOnly}
        reconnectToken={reconnectToken}
        openSocket={openSocket}
        fontSize={terminalFontSize}
        font={terminalFontFamily === nerdFontFamily ? 'bundled-nerd' : 'system'}
        onStatusChange={setState}
      />
      {connected && !!(state.notice || state.error || state.status) && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: colors.surface,
            padding: 10,
          }}
        >
          {!!state.notice && <Text style={styles.muted}>{state.notice}</Text>}
          {!!(state.error || state.status) && (
            <Text style={state.error ? styles.error : styles.muted}>
              {state.error || state.status}
            </Text>
          )}
        </View>
      )}
    </View>
  )
}
