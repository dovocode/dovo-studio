import { useScreenshotAttachment } from './screenshot-attachment'
import { Text } from '../../ui/content/text'
import {
  createRuntimeClient,
  mutableStruct,
  decodeResult,
  remoteBrowserTicketSchema,
  remoteBrowserMessageSchema,
  type RemoteBrowserMessage,
  responses,
} from '@dovo/protocol'
import { mobileWorkflow, nativeEffect } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../../runtime/state/application-state'
import { type ComponentRef, useEffect, useLayoutEffect, useRef } from 'react'
import { type TextInput, Alert, AppState, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { Schema, Effect } from 'effect'
import { remoteBrowserHtml } from '@dovo/protocol/browser-viewer'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../../ui/theme'
import { deviceHostMessage } from '../../screens/device-host-form'
import { usePreviewActive } from './use-preview-active'
import { BrowserToolbar, type BrowserMode } from './browser-toolbar'
import { useOpenAppLink } from '../../ui/content/open-link'
const bridgeSchema = mutableStruct({
  channel: Schema.Literal('dovo-browser'),
  type: Schema.Literals(['ready', 'reconnect', 'close', 'screenshot']),
  image: Schema.optional(Schema.String),
})
export function RemoteBrowser({
  taskId,
  deviceId,
  devicePlatform,
  expanded = false,
  reloadToken,
  initialUrl,
  onMode,
  onExpand,
}: {
  taskId: string
  deviceId?: string
  devicePlatform?: 'ios' | 'android'
  expanded?: boolean
  reloadToken?: number
  initialUrl?: string
  onMode?: (mode: BrowserMode, address?: string) => void
  onExpand?: () => void
}) {
  const { styles, mode } = useTheme()
  const appearance = useRef(mode)
  const screenshots = useScreenshotAttachment(taskId)
  const openLink = useOpenAppLink(taskId)
  const [browserState, setBrowserState] = useApplicationState<
    Extract<RemoteBrowserMessage, { type: 'state' }> | undefined
  >(undefined)
  const [online, setOnline] = useApplicationState(false)
  const [address, setAddress] = useApplicationState(initialUrl ?? '')
  const lastAddress = useRef(initialUrl ?? '')
  const editing = useRef(false)
  const addressField = useRef<ComponentRef<typeof TextInput>>(null)
  const [preset, setPreset] = useApplicationState('fill')
  const [landscape, setLandscape] = useApplicationState(false)

  const { connection, profiles, readEffect } = useRuntime()
  const active = usePreviewActive()
  const visible = useRef(active)
  const web = useRef<WebView>(null)
  const [generation, setGeneration] = useApplicationState(0)
  const current = useRef(0)
  const pending = useRef(false)
  const ready = useRef(false)
  const presentation = useRef(expanded)
  useEffect(() => {
    presentation.current = expanded
  }, [expanded, deviceId])
  const post = (message: object) =>
    web.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify({
        channel: 'dovo-browser',
        ...message,
      }).replace(/</g, '\\u003c')}}));true;`,
    )
  useLayoutEffect(() => {
    appearance.current = mode
    if (ready.current) post({ type: 'appearance', theme: mode })
  }, [mode])
  useEffect(() => {
    if (reloadToken) post({ type: 'reload' })
  }, [reloadToken])
  const connect = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (
          !connection ||
          !visible.current ||
          pending.current ||
          AppState.currentState === 'background'
        )
          return
        const version = current.current
        pending.current = true
        post({ type: 'appearance', theme: appearance.current })
        if (deviceId)
          post({
            type: 'configure',
            device: {
              platform:
                devicePlatform ??
                (deviceId.startsWith('ios:') || deviceId.startsWith('physical-ios:')
                  ? 'ios'
                  : 'android'),
            },
          })
        return yield* mobileWorkflow(function* () {
          const result = yield* readEffect(
            deviceId ? '/api/previews/simulator/open' : '/api/previews/browser/open',
            {
              taskId,
              id: deviceId,
              ...(!deviceId && lastAddress.current ? { url: lastAddress.current } : {}),
            },
            remoteBrowserTicketSchema,
          )
          if (
            version !== current.current ||
            !visible.current ||
            AppState.currentState === 'background'
          )
            return
          const target = createRuntimeClient(connection).socketUrl(
            deviceId ? '/ws/simulator' : '/ws/browser',
            result,
          )
          post({
            type: 'connect',
            url: target,
            device: result.device,
          })
          post({
            type: 'presentation',
            expanded: !deviceId || presentation.current,
            externalNavigation: !deviceId,
          })
        }).pipe(
          Effect.catch((error) =>
            nativeEffect(() => {
              if (version === current.current)
                post({
                  type: 'error',
                  message: deviceHostMessage(
                    error instanceof Error ? error.message : String(error),
                    profiles,
                  ),
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
        expanded: !deviceId || expanded,
        externalNavigation: !deviceId,
      })
  }, [expanded, deviceId])
  useEffect(() => {
    if (ready.current && online && !deviceId) post({ type: 'viewport', preset, landscape })
  }, [preset, landscape, online, deviceId])
  const resume = useRef(connect)
  useLayoutEffect(() => {
    resume.current = connect
  })
  useLayoutEffect(() => {
    visible.current = active
    if (!active) {
      current.current++
      pending.current = false
      web.current?.injectJavaScript("window.dispatchEvent(new Event('pagehide'));true;")
    } else if (ready.current) {
      // Preserve the canvas and viewport across screen switches and backgrounding.
      void resume.current()
    }
  }, [active])
  useLayoutEffect(() => {
    return () => {
      visible.current = false
      current.current++
      pending.current = false
      web.current?.injectJavaScript("window.dispatchEvent(new Event('pagehide'));true;")
    }
  }, [])
  return (
    <View style={styles.screen}>
      {screenshots.editor}
      {screenshots.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {screenshots.error}
        </Text>
      ) : null}
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
          setOnline(false)
          setGeneration((value) => value + 1)
        }}
        onRenderProcessGone={() => {
          current.current++
          pending.current = false
          ready.current = false
          setOnline(false)
          setGeneration((value) => value + 1)
        }}
        onMessage={(event) => {
          let message: unknown
          try {
            message = JSON.parse(event.nativeEvent.data)
          } catch {
            return
          }
          if (
            !deviceId &&
            message &&
            typeof message === 'object' &&
            'channel' in message &&
            message.channel === 'dovo-browser'
          ) {
            if ('type' in message && message.type === 'focusAddress') {
              addressField.current?.focus()
              return
            }
            if (
              'type' in message &&
              message.type === 'performance' &&
              'details' in message &&
              typeof message.details === 'string'
            ) {
              Alert.alert('Browser connection', message.details.slice(0, 2000))
              return
            }
            const state = decodeResult(remoteBrowserMessageSchema, message)
            if (state.success && state.data.type === 'state') {
              setBrowserState(state.data)
              lastAddress.current = state.data.url === 'about:blank' ? '' : state.data.url
              if (!editing.current) setAddress(lastAddress.current)
              return
            }
            if (
              'type' in message &&
              message.type === 'connection' &&
              'online' in message &&
              typeof message.online === 'boolean'
            ) {
              setOnline(message.online)
              return
            }
          }
          const parsed = decodeResult(bridgeSchema, message)
          if (!parsed.success) return
          if (parsed.data.type === 'screenshot') {
            if (
              visible.current &&
              AppState.currentState !== 'background' &&
              parsed.data.image &&
              !screenshots.busy
            )
              void screenshots.attach(parsed.data.image)
            return
          }
          if (parsed.data.type === 'close') {
            if (!visible.current || AppState.currentState === 'background') return
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
                Effect.catch((error) =>
                  nativeEffect(() =>
                    post({
                      type: 'error',
                      message: deviceHostMessage(String(error), profiles),
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
      {!deviceId && !expanded && (
        <BrowserToolbar
          addressRef={addressField}
          address={address}
          mode="remote"
          onMode={onMode ? (next) => onMode(next, lastAddress.current) : undefined}
          onExpand={onExpand}
          onExternal={
            /^https?:\/\//i.test(lastAddress.current)
              ? () => {
                  void runClientEffect(
                    nativeEffect(() => openLink(lastAddress.current, true)).pipe(
                      Effect.catch((error) =>
                        nativeEffect(() => Alert.alert('Could not open browser', String(error))),
                      ),
                    ),
                  )
                }
              : undefined
          }
          onAddress={setAddress}
          onEditing={(value) => {
            editing.current = value
          }}
          available={online}
          back={browserState?.back ?? false}
          forward={browserState?.forward ?? false}
          onNavigate={() => post({ type: 'input', input: { type: 'navigate', url: address } })}
          onBack={() => post({ type: 'input', input: { type: 'back' } })}
          onForward={() => post({ type: 'input', input: { type: 'forward' } })}
          onReload={() => post({ type: 'reload' })}
          onReconnect={() => post({ type: 'reconnect' })}
          onCloseSession={() => post({ type: 'close' })}
          onDiagnostics={() => post({ type: 'performance' })}
          onKeyboard={() => post({ type: 'keyboard' })}
          onScreenshot={() => post({ type: 'screenshot' })}
          screenshotDisabled={
            screenshots.busy || !browserState?.url || browserState.url === 'about:blank'
          }
          preset={preset}
          onPreset={setPreset}
          onRotate={() => setLandscape((value) => !value)}
        />
      )}
    </View>
  )
}
