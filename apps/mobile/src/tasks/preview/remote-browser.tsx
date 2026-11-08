import type { BrowserSearchEngine } from '@dovo/protocol'
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
  type RemoteBrowserInput,
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
import { browserAddress } from '../../browser/browser-state'
import { useOpenAppLink } from '../../ui/content/open-link'
import { Action } from '../../ui/controls/action'
import { shareBrowserDownload } from './browser-download'
const bridgeSchema = mutableStruct({
  channel: Schema.Literal('dovo-browser'),
  type: Schema.Literals(['ready', 'reconnect', 'close', 'screenshot']),
  image: Schema.optional(Schema.String),
})
export type RemoteBrowserControls = { input: (input: RemoteBrowserInput) => void }
type RemoteBrowserProps = {
  taskId: string
  tabId?: string
  profileId?: string
  searchEngine?: BrowserSearchEngine
  searchReady?: boolean
  deviceId?: string
  devicePlatform?: 'ios' | 'android'
  expanded?: boolean
  reloadToken?: number
  initialUrl?: string
  onMode?: (mode: BrowserMode, address?: string) => void
  onExpand?: () => void
  onState?: (state: Extract<RemoteBrowserMessage, { type: 'state' }>) => void
  onClosed?: () => void
  onControls?: (controls: RemoteBrowserControls | null) => void
}
export function RemoteBrowser(props: RemoteBrowserProps) {
  const { connection } = useRuntime()
  const identity = JSON.stringify([
    connection?.address,
    connection?.token,
    connection ? createRuntimeClient(connection).url('/') : undefined,
    props.taskId,
    props.tabId,
    props.profileId,
    props.deviceId,
  ])
  return props.tabId ? (
    <RemoteBrowserContent key={identity} {...props} />
  ) : (
    <ThreadRemoteBrowser key={identity} {...props} />
  )
}
function ThreadRemoteBrowser(props: RemoteBrowserProps) {
  const attachment = useScreenshotAttachment(props.taskId)
  return <RemoteBrowserContent {...props} attachment={attachment} />
}
function RemoteBrowserContent({
  taskId,
  tabId,
  profileId = 'default',
  searchEngine,
  searchReady = true,
  deviceId,
  devicePlatform,
  expanded = false,
  reloadToken,
  initialUrl,
  onMode,
  onExpand,
  onState,
  onClosed,
  onControls,
  attachment,
}: RemoteBrowserProps & { attachment?: ReturnType<typeof useScreenshotAttachment> }) {
  const { styles, mode } = useTheme()
  const appearance = useRef(mode)
  const screenshots = attachment
  const stateCallback = useRef(onState)
  const closedCallback = useRef(onClosed)
  closedCallback.current = onClosed
  const controlsCallback = useRef(onControls)
  stateCallback.current = onState
  controlsCallback.current = onControls
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
  const [filePicking, setFilePicking] = useApplicationState<string | null>(null)
  const foreground = usePreviewActive()
  const active = usePreviewActive(!!filePicking)
  // Android's document picker backgrounds the app. Keep its socket, but stop capturing frames.
  useEffect(() => {
    if (ready.current && !deviceId) post({ type: 'visibility', visible: foreground })
  }, [foreground, online, deviceId])
  useEffect(() => {
    if (!filePicking) return
    const expired = setTimeout(() => setFilePicking(null), 10 * 60 * 1000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setFilePicking(null)
    })
    return () => {
      clearTimeout(expired)
      subscription.remove()
    }
  }, [filePicking])
  const visible = useRef(active)
  const web = useRef<WebView>(null)
  const [generation, setGeneration] = useApplicationState(0)
  const [processFailed, setProcessFailed] = useApplicationState(false)
  const webGeneration = useRef(0)
  const recovered = useRef(false)
  const failed = useRef(false)
  const mounted = useRef(true)
  const current = useRef(0)
  const downloadOrigin = useRef('')
  const transfers = useRef(new Map<string, AbortController>())
  const stopDownloads = (id?: string) => {
    for (const [key, controller] of transfers.current)
      if (!id || key === id) {
        controller.abort()
        transfers.current.delete(key)
      }
  }
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
    if (filePicking && ready.current) post({ type: 'filePickingReady', id: filePicking })
  }, [filePicking])
  const send = useRef(post)
  send.current = post
  useEffect(() => {
    controlsCallback.current?.({ input: (input) => send.current({ type: 'input', input }) })
    return () => controlsCallback.current?.(null)
  }, [tabId, profileId])
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
              tabId,
              profileId: tabId ? profileId : undefined,
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
          if (tabId && (result.tabId !== tabId || result.profileId !== profileId))
            throw new Error('Update this runtime to support shared browser tabs.')
          const target = createRuntimeClient(connection).socketUrl(
            deviceId ? '/ws/simulator' : '/ws/browser',
            result,
          )
          const downloadTarget = new URL(target)
          downloadTarget.protocol = downloadTarget.protocol === 'wss:' ? 'https:' : 'http:'
          downloadOrigin.current = downloadTarget.origin
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
    if (foreground && !online && ready.current) void resume.current()
  }, [foreground, online])
  useLayoutEffect(() => {
    visible.current = active
    if (!active) {
      stopDownloads()
      current.current++
      pending.current = false
      web.current?.injectJavaScript("window.dispatchEvent(new Event('pagehide'));true;")
    } else if (ready.current) {
      // Preserve the canvas and viewport across screen switches and backgrounding.
      void resume.current()
    }
  }, [active])
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopDownloads()
      visible.current = false
      current.current++
      pending.current = false
      web.current?.injectJavaScript("window.dispatchEvent(new Event('pagehide'));true;")
    }
  }, [])
  const remount = () => {
    stopDownloads()
    setFilePicking(null)
    current.current++
    pending.current = false
    ready.current = false
    setOnline(false)
    webGeneration.current++
    setGeneration(webGeneration.current)
  }
  const processLost = () => {
    if (!mounted.current || generation !== webGeneration.current || failed.current) return
    stopDownloads()
    if (recovered.current) {
      current.current++
      pending.current = false
      ready.current = false
      failed.current = true
      setOnline(false)
      setProcessFailed(true)
    } else {
      recovered.current = true
      remount()
    }
  }
  return (
    <View style={styles.screen}>
      {screenshots?.editor}
      {screenshots?.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {screenshots.error}
        </Text>
      ) : null}
      {processFailed ? (
        <View style={styles.content}>
          <Text accessibilityRole="alert" style={styles.error}>
            The browser preview stopped. Retry to connect again.
          </Text>
          <Action
            label="Retry browser"
            disabled={!active}
            onPress={() => {
              recovered.current = false
              failed.current = false
              setProcessFailed(false)
              remount()
            }}
          />
        </View>
      ) : (
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
          onContentProcessDidTerminate={processLost}
          onRenderProcessGone={processLost}
          onMessage={(event) => {
            if (!mounted.current || generation !== webGeneration.current || failed.current) return
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
              if ('type' in message && message.type === 'downloadStop') {
                stopDownloads(
                  'id' in message && typeof message.id === 'string' ? message.id : undefined,
                )
                return
              }
              if (
                'type' in message &&
                message.type === 'downloadSave' &&
                'id' in message &&
                typeof message.id === 'string' &&
                'requestId' in message &&
                typeof message.requestId === 'string' &&
                'url' in message &&
                typeof message.url === 'string' &&
                'name' in message &&
                typeof message.name === 'string' &&
                'size' in message &&
                typeof message.size === 'number'
              ) {
                const { id, requestId, url, name, size } = message
                if (!visible.current || AppState.currentState === 'background') return
                stopDownloads(id)
                const controller = new AbortController()
                transfers.current.set(id, controller)
                void shareBrowserDownload({
                  url,
                  name,
                  size,
                  origin: downloadOrigin.current,
                  signal: controller.signal,
                })
                  .then(
                    () => 'Share sheet closed.',
                    (error: unknown) =>
                      error instanceof Error ? error.message : 'Download failed.',
                  )
                  .then((result) => {
                    if (transfers.current.get(id) !== controller || !mounted.current) return
                    transfers.current.delete(id)
                    post({ type: 'downloadResult', id, requestId, message: result })
                  })
                return
              }
              if (
                'type' in message &&
                message.type === 'filePicking' &&
                'active' in message &&
                typeof message.active === 'boolean' &&
                'id' in message &&
                typeof message.id === 'string' &&
                message.id.length <= 100
              ) {
                if (message.active) setFilePicking(message.id)
                else if (AppState.currentState !== 'background')
                  setFilePicking((current) => (current === message.id ? null : current))
                return
              }
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
              if (state.success && state.data.type === 'closed' && state.data.byPage) {
                closedCallback.current?.()
                return
              }
              if (state.success && state.data.type === 'state') {
                setBrowserState(state.data)
                stateCallback.current?.(state.data)
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
              if (!screenshots) return
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
                    tabId,
                    profileId: tabId ? profileId : undefined,
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
      )}
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
          onNavigate={() => {
            try {
              if (tabId && !searchReady)
                throw new Error('Browser profiles are still loading on this computer.')
              post({
                type: 'input',
                input: {
                  type: 'navigate',
                  url: tabId ? browserAddress(address, searchEngine) : address,
                },
              })
            } catch (cause) {
              Alert.alert(
                'Could not navigate',
                cause instanceof Error ? cause.message : String(cause),
              )
            }
          }}
          onBack={() => post({ type: 'input', input: { type: 'back' } })}
          onForward={() => post({ type: 'input', input: { type: 'forward' } })}
          onReload={() => post({ type: 'reload' })}
          onReconnect={() => post({ type: 'reconnect' })}
          onCloseSession={() => post({ type: 'close' })}
          onDiagnostics={() => post({ type: 'performance' })}
          onKeyboard={() => post({ type: 'keyboard' })}
          onScreenshot={() => {
            if (screenshots) post({ type: 'screenshot' })
          }}
          screenshotDisabled={
            !screenshots ||
            screenshots.busy ||
            !browserState?.url ||
            browserState.url === 'about:blank'
          }
          preset={preset}
          onPreset={setPreset}
          onRotate={() => setLandscape((value) => !value)}
        />
      )}
    </View>
  )
}
