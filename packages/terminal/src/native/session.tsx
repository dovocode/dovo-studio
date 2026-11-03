// iOS/Android terminal session: libghostty renders natively (Metal on iOS, libghostty-vt +
// Canvas on Android) while this component owns the runtime `/ws/terminal` socket. It has no
// app provider/preference imports: the host passes the socket loader, font and theme.
import { requireOptionalNativeModule } from 'expo'
import type { TerminalTheme, TerminalViewProps, TerminalViewRef } from 'expo-libghostty'
import type { ComponentRef, ComponentType } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  AppState,
  Keyboard,
  Platform,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { createRuntimeClient, type RuntimeConnection } from '@dovo/protocol'
import { startReconnecting } from '@dovo/client-runtime'
import {
  fontFallbackNotice,
  nativeFontFamilySupported,
  nativeTerminalFontFamily,
  unsupportedFontNotice,
  type NativeTerminalFont,
} from './terminal-font'
import {
  bytesToBase64,
  openTerminalStream,
  terminalGridSize,
  type TerminalGridSize,
  type TerminalStream,
  type TerminalStreamProtocol,
} from './terminal-stream'

/** Props added by patches/expo-libghostty@0.8.1.patch (repo root). */
type GhosttyViewProps = TerminalViewProps & {
  fontFamily?: string
  onFontFallback?: (event: { nativeEvent: { fontFamily: string; message: string } }) => void
}

type ExpoViewConfigs = {
  expo?: {
    getViewConfig?(moduleName: string): { validAttributes?: Record<string, unknown> } | null
  }
}

const GhosttyView: ComponentType<GhosttyViewProps> | null = requireOptionalNativeModule(
  'ExpoLibghostty',
)
  ? // Loaded lazily: requiring the package registers a native view that may not exist.
    (require('expo-libghostty') as typeof import('expo-libghostty')).TerminalView
  : null

/**
 * False in binaries built without expo-libghostty (an older development client, Expo Go) and
 * on web; hosts should render their fallback renderer instead of NativeTerminalSession.
 */
export const nativeTerminalAvailable = !!GhosttyView

// A binary built without the font patch has no fontFamily prop; say so instead of ignoring it.
const fontFamilySupported =
  !!GhosttyView &&
  nativeFontFamilySupported((globalThis as ExpoViewConfigs).expo?.getViewConfig?.('ExpoLibghostty'))

/** Matches the web/WebView terminal. iOS applies the theme app-wide, keep its identity stable. */
export const defaultTerminalTheme: TerminalTheme = { background: '#101113', foreground: '#ededee' }

export type NativeTerminalStatus = {
  /**
   * Progress text ('Loading terminal…', 'Connecting terminal…', 'Replaying terminal history…');
   * empty once the terminal accepts input.
   */
  status: string
  /**
   * Whether keystrokes reach the shell. False until the reconnect replay has been consumed:
   * emulator answers to replayed queries and typed keys share one native input callback, so all
   * input is dropped (and the surface does not take touches) until then.
   */
  inputReady: boolean
  /** Connection or render error; reconnect attempts continue while it is shown. */
  error: string
  /** Font notice when the chosen font cannot be shown; empty otherwise. */
  notice: string
}

export type NativeTerminalSessionProps = {
  /** Runtime terminal id. */
  id: string
  /** Connect only while true; hiding or a true background stay closes the socket. */
  visible?: boolean
  /**
   * Issues a fresh single-use ticket and returns the `/ws/terminal` URL (see
   * `terminalSocketUrl`). Called for every (re)connect. Keep it referentially stable: a new
   * function identity reconnects, which is how hosts react to connection/auth changes.
   */
  openSocket: (signal: AbortSignal) => Promise<string>
  /** Integer 8–32; other values use 12. iOS remounts and replays on change. */
  fontSize?: number
  font?: NativeTerminalFont
  theme?: TerminalTheme
  onStatusChange?: (status: NativeTerminalStatus) => void
  style?: StyleProp<ViewStyle>
  /** Test id of the tappable surface (tapping raises the keyboard). */
  testID?: string
  /**
   * Output stream: binary v1 (default; flow controlled, replay boundaries) or the legacy text
   * stream. Runtimes without binary v1 answer in text and are handled either way.
   */
  protocol?: TerminalStreamProtocol
}

/** The terminal socket URL for a ticket; keeps HTTP LAN/VPN runtimes on plain ws://. */
export function terminalSocketUrl(connection: RuntimeConnection, ticket: { ticket: string }) {
  return createRuntimeClient(connection).socketUrl('/ws/terminal', ticket).toString()
}

export function NativeTerminalSession({
  id,
  visible = true,
  openSocket,
  fontSize: requestedFontSize = 12,
  font = 'system',
  theme = defaultTerminalTheme,
  onStatusChange,
  style,
  testID = 'Terminal surface',
  protocol = 'binary-v1',
}: NativeTerminalSessionProps) {
  if (!GhosttyView) throw new Error('The native Ghostty terminal is not available in this build.')
  const TerminalView = GhosttyView
  const platform = Platform.OS === 'ios' ? 'ios' : 'android'
  const fontSize =
    Number.isInteger(requestedFontSize) && requestedFontSize >= 8 && requestedFontSize <= 32
      ? requestedFontSize
      : 12
  const fontFamily = nativeTerminalFontFamily(platform, font)
  // iOS rebuilds the Ghostty surface (and clears its grid) when the font size changes, so a
  // size change remounts the view and reconnects to receive the runtime replay. Android
  // reflows in place. Family changes are a live config update on both platforms.
  const viewKey = platform === 'ios' ? `font-${fontSize}` : 'terminal'
  const [status, setStatus] = useState('Loading terminal…')
  const [error, setError] = useState('')
  const [inputReady, setInputReady] = useState(false)
  const [fontFallback, setFontFallback] = useState({ family: '', message: '' })
  const [backgrounded, setBackgrounded] = useState(AppState.currentState === 'background')
  const [readyKey, setReadyKey] = useState('')
  const [keyboardInset, setKeyboardInset] = useState(0)
  const ready = readyKey === viewKey
  const terminal = useRef<TerminalViewRef>(null)
  const size = useRef<{ key: string; value: TerminalGridSize } | null>(null)
  const stream = useRef<TerminalStream | null>(null)
  const container = useRef<ComponentRef<typeof View>>(null)
  const notice = !fontFamilySupported
    ? unsupportedFontNotice(platform, font)
    : fontFamily && fontFallback.family === fontFamily
      ? fontFallbackNotice(fontFallback.message)
      : ''

  const statusListener = useRef(onStatusChange)
  statusListener.current = onStatusChange
  useEffect(() => {
    statusListener.current?.({ status, error, notice, inputReady })
  }, [status, error, notice, inputReady])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') setBackgrounded(true)
      else if (state === 'active') setBackgrounded(false)
    })
    return () => subscription.remove()
  }, [])

  // Android's native view pads itself above the IME. iOS does not, so keep the cursor rows
  // visible by shrinking the view by the keyboard overlap (Ghostty then reports a resize).
  useEffect(() => {
    if (platform !== 'ios') return
    const subscriptions = [
      Keyboard.addListener('keyboardWillChangeFrame', (event) => {
        const top = event.endCoordinates.screenY
        container.current?.measureInWindow((_x, y, _width, height) =>
          setKeyboardInset(Math.max(0, Math.round(y + height - top))),
        )
      }),
      Keyboard.addListener('keyboardWillHide', () => setKeyboardInset(0)),
    ]
    return () => subscriptions.forEach((subscription) => subscription.remove())
  }, [platform])

  useEffect(() => {
    if (!ready || backgrounded || !visible) return
    const reconnect = startReconnecting(
      async (signal, connected) => {
        setStatus('Connecting terminal…')
        const url = await openSocket(signal)
        if (signal.aborted) return
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            setInputReady(false)
            clearTimeout(timeout)
            signal.removeEventListener('abort', abort)
            if (stream.current === opened) stream.current = null
            opened.close()
          }
          const abort = () => {
            cleanup()
            resolve()
          }
          const timeout = setTimeout(() => {
            cleanup()
            reject(new Error('Terminal connection timed out.'))
          }, 10000)
          const opened = openTerminalStream({
            url,
            size: () => (size.current?.key === viewKey ? size.current.value : undefined),
            protocol,
            // Socket open only means the replay is coming; input is still unavailable.
            onOpen: () => {
              clearTimeout(timeout)
              setStatus('Replaying terminal history…')
            },
            onReady: () => {
              connected()
              setStatus('')
              setError('')
              setInputReady(true)
            },
            // Serialized by the stream; it resets the grid before each replay and acknowledges
            // binary output once the renderer accepted it.
            write: (output) => {
              const view = terminal.current
              if (!view) return Promise.reject(new Error('The terminal view is not ready.'))
              return typeof output === 'string'
                ? view.writeText(output)
                : view.write(bytesToBase64(output))
            },
            onClose: (cause) => {
              cleanup()
              reject(cause)
            },
          })
          stream.current = opened
          signal.addEventListener('abort', abort, { once: true })
        })
      },
      (cause) => setError(`${cause.message} Reconnecting…`),
    )
    // Cleanup closes the socket and cancels retries on a true background stay, when hidden,
    // or when the id/loader changes. Inactive states (permission prompts) keep the session.
    return () => {
      void reconnect.stop()
    }
  }, [ready, backgrounded, visible, openSocket, id, viewKey, protocol])

  return (
    <View
      ref={container}
      testID={testID}
      style={[
        { flex: 1, minHeight: 0, backgroundColor: theme.background ?? '#101113' },
        style,
        { paddingBottom: keyboardInset },
        // Output keeps rendering, but touches (focus, keyboard, paste) wait for input readiness.
        { pointerEvents: inputReady ? 'auto' : 'none' },
      ]}
      accessibilityState={{ disabled: !inputReady }}
    >
      {platform === 'ios' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            keyboardInset > 0 ? 'Hide terminal keyboard' : 'Show terminal keyboard'
          }
          disabled={!inputReady}
          onPress={() => {
            const view = terminal.current
            if (!view || !inputReady) return
            void (keyboardInset > 0 ? view.blur() : view.focus()).catch((cause: unknown) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Could not change terminal keyboard visibility.',
              ),
            )
          }}
          style={{
            alignSelf: 'flex-end',
            minHeight: 40,
            paddingHorizontal: 12,
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: theme.foreground ?? '#ededee', opacity: inputReady ? 1 : 0.5 }}>
            {keyboardInset > 0 ? 'Hide keyboard' : 'Show keyboard'}
          </Text>
        </Pressable>
      )}
      <TerminalView
        key={viewKey}
        ref={terminal}
        style={{ flex: 1 }}
        fontSize={fontSize}
        theme={theme}
        {...(fontFamilySupported ? { fontFamily } : {})}
        onFontFallback={({ nativeEvent }) =>
          setFontFallback({ family: nativeEvent.fontFamily, message: nativeEvent.message })
        }
        onInput={({ nativeEvent }) => stream.current?.input(nativeEvent.text)}
        onResize={({ nativeEvent }) => {
          const value = terminalGridSize(nativeEvent.cols, nativeEvent.rows)
          if (!value) return
          size.current = { key: viewKey, value }
          setReadyKey(viewKey)
          stream.current?.resize(value)
        }}
      />
    </View>
  )
}
