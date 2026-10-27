import { router } from 'expo-router'
import { useOpenAppLink } from '../../ui/content/open-link'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../../runtime/state/application-state'
import { type ComponentRef, useEffect, useLayoutEffect, useRef } from 'react'
import { captureRef } from 'react-native-view-shot'
import { Image, Keyboard, Platform, ScrollView, View, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-screens/experimental'
import { WebView } from 'react-native-webview'
import {
  deviceHostSettingsResultSchema,
  previewDevicesSchema,
  previewResultSchema,
  previewUrl,
  previewPresets,
  type PreviewDevice,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { IconButton } from '../../ui/controls/icon-button'
import { useTheme } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import { useScreenshotAttachment } from './screenshot-attachment'
import { RemoteBrowser } from './remote-browser'
import { BrowserToolbar, type BrowserMode } from './browser-toolbar'
import { PhysicalControls } from './physical-controls'
import { DeviceActions, type DeviceForward } from './device-actions'
import { deviceHostMessage } from '../../screens/device-host-form'
import { usePreviewActive } from './use-preview-active'
const addresses = new Map<string, string>()
function rememberAddress(scope: string, url: string) {
  addresses.delete(scope)
  addresses.set(scope, url)
  if (addresses.size > 50) {
    const oldest = addresses.keys().next().value
    if (oldest !== undefined) addresses.delete(oldest)
  }
}
function savedAddress(scope: string) {
  const url = addresses.get(scope)
  if (url !== undefined) rememberAddress(scope, url)
  return url
}
type PreviewProps = {
  taskId: string
  expanded: boolean
  onExpand: (value: boolean) => void
  openLink?: { id: string; url: string }
  onLinkOpened?: () => void
}
export function BrowserPane(props: PreviewProps) {
  return <PreviewPane {...props} initialMode="remote" />
}
export function DevicesPane(props: PreviewProps) {
  return <PreviewPane {...props} initialMode="devices" />
}
function PreviewPane({
  taskId,
  expanded,
  onExpand,
  initialMode,
  openLink,
  onLinkOpened,
}: PreviewProps & { initialMode: 'remote' | 'devices' }) {
  const { colors, styles } = useTheme()
  const [keyboard, setKeyboard] = useApplicationState(() => Keyboard.isVisible())
  useEffect(() => {
    const show = () => setKeyboard(true)
    const hide = () => setKeyboard(false)
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', show),
      Keyboard.addListener('keyboardDidHide', hide),
      ...(Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillShow', show),
            Keyboard.addListener('keyboardWillHide', hide),
          ]
        : []),
    ]
    // A pane can mount midway through the composer's keyboard dismissal.
    setKeyboard(Keyboard.isVisible())
    return () => subscriptions.forEach((subscription) => subscription.remove())
  }, [])

  const { profile, snapshot } = useRuntime()
  const linkScope = JSON.stringify([
    profile?.id,
    profile?.connection.address,
    profile?.connection.runtimeId,
    taskId,
  ])
  const [accepted, setAccepted] = useApplicationState({ scope: linkScope, link: openLink })
  const acceptedLink = accepted.scope === linkScope ? accepted.link : undefined
  const [mode, setMode] = useApplicationState<'remote' | 'web' | 'devices'>(
    openLink ? 'remote' : initialMode,
  )
  useEffect(() => {
    if (!openLink) return
    setAccepted({ scope: linkScope, link: openLink })
    setMode('remote')
    onLinkOpened?.()
  }, [openLink?.id, linkScope, onLinkOpened])
  const [reloadToken, setReloadToken] = useApplicationState(0)
  const latestTurn = snapshot?.workspace.tasks.find((task) => task.id === taskId)?.turns?.at(-1)
  const seenTurn = useRef(latestTurn?.status === 'completed' ? latestTurn.id : '')
  useEffect(() => {
    if (!latestTurn || latestTurn.status !== 'completed' || seenTurn.current === latestTurn.id)
      return
    seenTurn.current = latestTurn.id
    if (
      latestTurn.checkpoint &&
      (latestTurn.checkpoint.files.length || latestTurn.checkpoint.omitted.length)
    )
      setReloadToken((value) => value + 1)
  }, [latestTurn?.id, latestTurn?.status, latestTurn?.checkpoint])
  const scope = `${profile?.id}:${taskId}`
  const switchBrowser = (next: BrowserMode, address?: string) => {
    if (address && /^https?:\/\//i.test(address))
      rememberAddress(
        scope,
        previewUrl(address, next === 'web' ? profile?.connection.address : undefined),
      )
    setMode(next)
  }
  const browserControls = (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <View
        style={{
          flex: 1,
        }}
      >
        <Text style={styles.muted}>Devices</Text>
      </View>
      <IconButton
        label={expanded ? 'Show controls' : 'Expand preview'}
        icon={expanded ? 'collapse' : 'expand'}
        onPress={() => onExpand(!expanded)}
      />
    </View>
  )
  return (
    // The route owns the side insets; the preview owns the remaining bottom inset.
    // Keep overlays inside the padded content, and let the root avoid the keyboard.
    <SafeAreaView edges={{ bottom: !keyboard }} style={{ backgroundColor: colors.surface }}>
      <View style={{ flex: 1 }}>
        {initialMode === 'devices' && browserControls}
        {mode === 'remote' ? (
          <RemoteBrowser
            key={`${scope}:${acceptedLink?.id ?? ''}`}
            taskId={taskId}
            expanded={expanded}
            reloadToken={reloadToken}
            initialUrl={acceptedLink?.url ?? savedAddress(scope)}
            onMode={switchBrowser}
            onExpand={() => onExpand(true)}
          />
        ) : (
          <BrowserContent
            key={scope}
            scope={scope}
            taskId={taskId}
            mode={mode}
            expanded={expanded}
            reloadToken={reloadToken}
            onMode={switchBrowser}
            onExpand={() => onExpand(true)}
          />
        )}
        {initialMode !== 'devices' && expanded && (
          <View style={{ position: 'absolute', bottom: 8, right: 8 }}>
            <IconButton
              label="Show browser controls"
              icon="collapse"
              variant="glass"
              onPress={() => onExpand(false)}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}
function BrowserContent({
  scope,
  taskId,
  mode,
  expanded,
  reloadToken,
  onMode,
  onExpand,
}: {
  scope: string
  taskId: string
  mode: string
  expanded: boolean
  reloadToken: number
  onMode: (mode: BrowserMode, address?: string) => void
  onExpand: () => void
}) {
  const { colors, styles } = useTheme()

  const screenshots = useScreenshotAttachment(taskId)
  const browserCapture = useRef<ComponentRef<typeof View>>(null)
  const openLink = useOpenAppLink(taskId)
  const { profile, profiles, connected, read, callEffect } = useRuntime(),
    { busy, error, act } = useAction()
  const active = usePreviewActive()
  const [input, setInput] = useApplicationState(
      () => savedAddress(scope) ?? 'http://localhost:3000',
    ),
    [url, setUrl] = useApplicationState(() => savedAddress(scope) ?? '')
  const [preset, setPreset] = useApplicationState('fill'),
    [landscape, setLandscape] = useApplicationState(false)
  const [devices, setDevices] = useApplicationState<PreviewDevice[]>([]),
    [diagnostics, setDiagnostics] = useApplicationState<string[]>([])
  const [liveDevice, setLiveDevice] = useApplicationState<PreviewDevice | undefined>(undefined)
  const [setupDevice, setSetupDevice] = useApplicationState<PreviewDevice | undefined>(undefined)
  const [actionDevice, setActionDevice] = useApplicationState<PreviewDevice | null>(null)
  const [forward, setForward] = useApplicationState<DeviceForward | null>(null)
  const [hubEnabled, setHubEnabled] = useApplicationState<boolean | null>(null)
  const listGeneration = useRef(0)
  useEffect(
    () => () => {
      listGeneration.current++
    },
    [],
  )
  const [image, setImage] = useApplicationState(''),
    [loadError, setLoadError] = useApplicationState('')
  const [previewGeneration, setPreviewGeneration] = useApplicationState(0)
  const web = useRef<WebView>(null)
  useEffect(() => {
    if (reloadToken && mode === 'web' && url) web.current?.reload()
  }, [reloadToken])
  const [history, setHistory] = useApplicationState({
    back: false,
    forward: false,
    url: '',
  })
  const editingAddress = useRef(false)
  useLayoutEffect(() => {
    if (active) return
    // Direct pages are remounted on return; reopen the last navigated URL.
    setUrl(history.url || url)
    setHistory((previous) =>
      previous.back || previous.forward ? { ...previous, back: false, forward: false } : previous,
    )
  }, [active, history.url, url])
  const recoverPreview = () => {
    setUrl(history.url || url)
    setHistory((previous) => ({ ...previous, back: false, forward: false }))
    setLoadError('')
    setPreviewGeneration((value) => value + 1)
  }
  const size = previewPresets.find((p) => p.id === preset) ?? previewPresets[0]
  const load = () => {
    const generation = ++listGeneration.current
    return runClientEffect(
      mobileWorkflow(function* () {
        const settings = yield* nativeEffect(() =>
          read('/api/device-hosts', undefined, deviceHostSettingsResultSchema, 'GET'),
        )
        if (generation !== listGeneration.current) return
        setHubEnabled(settings.enabled === true)
        if (settings.enabled !== true) {
          setDevices([])
          setDiagnostics([])
          setLiveDevice(undefined)
          setSetupDevice(undefined)
          setActionDevice(null)
          setForward(null)
          return
        }
        const result = yield* callEffect(
          '/api/previews/devices',
          {
            taskId,
          },
          previewDevicesSchema,
        )
        if (generation === listGeneration.current) {
          setDevices(result.devices)
          setDiagnostics(result.diagnostics)
        }
      }),
    )
  }
  useEffect(() => {
    if (active && mode === 'devices' && connected) act(load)
    return () => {
      listGeneration.current++
    }
  }, [active, mode, connected])
  const navigate = () =>
    act(() =>
      nativeEffect(() => {
        const target = previewUrl(input, profile?.connection.address)
        if (target === url) web.current?.reload()
        setUrl(target)
        setHistory({ back: false, forward: false, url: target })
        setInput(target)
        rememberAddress(scope, target)
        setLoadError('')
      }),
    )
  const deviceAction = (
    device: PreviewDevice,
    action:
      | 'boot'
      | 'shutdown'
      | 'open'
      | 'screenshot'
      | 'devicehub'
      | 'accessibility'
      | 'screen-recording',
  ) =>
    act(() =>
      mobileWorkflow(function* () {
        const result = yield* callEffect(
          '/api/previews/action',
          {
            taskId,
            id: device.id,
            hostId: device.hostId,
            action,
            url: input,
          },
          previewResultSchema,
        )
        if (action === 'screenshot' && !result.image)
          throw new Error('The device did not return a screenshot. Please try again.')
        if (result.image) {
          setImage(result.image)
          const captured = result.image
          if (action === 'screenshot') yield* nativeEffect(() => screenshots.attach(captured))
        }
        yield* nativeEffect(() => load())
      }),
    )
  const actions = actionDevice ? (
    <DeviceActions
      key={actionDevice.id}
      taskId={taskId}
      device={actionDevice}
      forward={forward}
      onForward={setForward}
      onUrl={setInput}
      onClose={() => setActionDevice(null)}
    />
  ) : null
  const setup = setupDevice ? (
    <PhysicalControls
      taskId={taskId}
      device={setupDevice}
      onClose={() => setSetupDevice(undefined)}
    />
  ) : null
  const previewControls =
    mode === 'web' ? (
      <View style={{ display: expanded ? 'none' : 'flex' }}>
        <BrowserToolbar
          address={input}
          onAddress={setInput}
          onEditing={(value) => {
            editingAddress.current = value
          }}
          mode="web"
          onMode={(next) => onMode(next, history.url || url)}
          onExpand={onExpand}
          onNavigate={navigate}
          back={history.back}
          forward={history.forward}
          onBack={() => web.current?.goBack()}
          onForward={() => web.current?.goForward()}
          onReload={() => {
            setLoadError('')
            web.current?.reload()
          }}
          preset={preset}
          onPreset={setPreset}
          onRotate={() => setLandscape((value) => !value)}
          reloadDisabled={!url}
          onExternal={url ? () => act(() => openLink(history.url || url, true)) : undefined}
          screenshotDisabled={
            !connected || busy || screenshots.busy || !url || !active || Platform.OS === 'web'
          }
          onScreenshot={() =>
            act(() =>
              nativeEffect(async () => {
                if (!browserCapture.current)
                  throw new Error('Open the browser page before taking a screenshot.')
                const data = await captureRef(browserCapture.current, {
                  format: 'png',
                  result: 'base64',
                })
                await screenshots.attach(`data:image/png;base64,${data}`)
              }),
            )
          }
        />
        {(error || loadError) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {deviceHostMessage(error || loadError, profiles)}
          </Text>
        )}
      </View>
    ) : (
      <View
        style={{
          display: expanded ? 'none' : 'flex',
          padding: 8,
          gap: 6,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        }}
      >
        <Field
          label="Preview URL"
          hideLabel
          value={input}
          onChangeText={setInput}
          keyboardType="url"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={navigate}
        />
        {(error || loadError) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {deviceHostMessage(error || loadError, profiles)}
          </Text>
        )}
      </View>
    )
  if (mode === 'devices' && liveDevice)
    return (
      <View
        style={{
          flex: 1,
        }}
      >
        {setup}
        {actions}
        <View
          style={{
            display: expanded ? 'none' : 'flex',
            paddingHorizontal: 12,
            paddingVertical: 4,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <IconButton
            icon="back"
            label="Back to devices"
            onPress={() => setLiveDevice(undefined)}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.muted,
              {
                flex: 1,
              },
            ]}
          >
            {liveDevice.name}
            {liveDevice.hostName ? ` · ${liveDevice.hostName}` : ' · Local runtime'}
          </Text>
          <IconButton
            icon="settings"
            label="Install app / URL forwards"
            disabled={!connected || busy}
            onPress={() => setActionDevice(liveDevice)}
          />
          {liveDevice.kind === 'physical' && liveDevice.platform === 'ios' && (
            <IconButton
              icon="settings"
              label="Device controls"
              disabled={!connected || busy}
              onPress={() => setSetupDevice(liveDevice)}
            />
          )}
        </View>
        <RemoteBrowser
          key={`${scope}:${liveDevice.id}`}
          taskId={taskId}
          deviceId={liveDevice.id}
          devicePlatform={liveDevice.platform}
          expanded={expanded}
        />
      </View>
    )
  return (
    <View
      style={{
        flex: 1,
      }}
    >
      {screenshots.editor}
      {screenshots.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {screenshots.error}
        </Text>
      ) : null}
      {mode !== 'web' && previewControls}
      {mode === 'web' ? (
        url ? (
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
            }}
          >
            <ScrollView
              horizontal
              contentContainerStyle={{
                flexGrow: 1,
              }}
            >
              <View
                style={
                  size.width
                    ? {
                        width: landscape ? size.height : size.width,
                        height: landscape ? size.width : size.height,
                      }
                    : {
                        flex: 1,
                        minWidth: 1,
                      }
                }
              >
                {Platform.OS === 'web' ? (
                  <View
                    style={{
                      padding: 16,
                    }}
                  >
                    <Text style={styles.text}>Open this preview externally in Safari.</Text>
                  </View>
                ) : active ? (
                  <View ref={browserCapture} collapsable={false} style={{ flex: 1 }}>
                    <WebView
                      key={previewGeneration}
                      ref={web}
                      source={{
                        uri: url,
                      }}
                      style={{
                        flex: 1,
                      }}
                      originWhitelist={['http://*', 'https://*']}
                      setSupportMultipleWindows={false}
                      allowsInlineMediaPlayback
                      allowsBackForwardNavigationGestures={false}
                      onShouldStartLoadWithRequest={(request) =>
                        /^https?:\/\//i.test(request.url) || request.url === 'about:blank'
                      }
                      onError={(event) => setLoadError(event.nativeEvent.description)}
                      onContentProcessDidTerminate={recoverPreview}
                      onRenderProcessGone={recoverPreview}
                      onHttpError={(event) =>
                        setLoadError(`Page returned HTTP ${event.nativeEvent.statusCode}`)
                      }
                      onNavigationStateChange={(state) => {
                        const pageUrl = /^https?:\/\//i.test(state.url)
                        setHistory((previous) => ({
                          back: state.canGoBack,
                          forward: state.canGoForward,
                          url: pageUrl ? state.url : previous.url,
                        }))
                        if (pageUrl) {
                          if (!editingAddress.current) setInput(state.url)
                          rememberAddress(scope, state.url)
                        }
                      }}
                    />
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </ScrollView>
        ) : (
          <View
            style={{
              flex: 1,
              padding: 20,
              gap: 12,
            }}
          >
            <Text style={styles.text}>Start your project’s server, then enter its address.</Text>
            <Text style={styles.muted}>
              Localhost uses your runtime’s hostname. The server must accept connections from your
              phone over Wi-Fi or VPN.
            </Text>
          </View>
        )
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            gap: 16,
          }}
        >
          <Action
            secondary
            label={busy ? 'Working…' : 'Refresh devices'}
            disabled={!connected || busy}
            onPress={() => act(load)}
          />
          {diagnostics.map((d) => (
            <Text key={d} style={styles.muted}>
              {deviceHostMessage(d, profiles)}
            </Text>
          ))}
          {hubEnabled === false && (
            <View style={{ gap: 12 }}>
              <Text style={styles.muted}>
                Device Hub is off for this computer. Enable it in Device previews settings to
                discover simulators and connected phones.
              </Text>
              <Action
                label="Enable in Device previews settings"
                onPress={() => router.push('/settings/device-hosts')}
              />
            </View>
          )}
          {hubEnabled === true && !devices.length && !busy && (
            <Text style={styles.muted}>
              No devices found. Connect a phone to the host or create a simulator.
            </Text>
          )}
          {devices.map((device, index) => (
            <View
              key={device.id}
              testID={`Simulator ${device.id}`}
              style={{
                gap: 8,
                padding: 16,
                borderRadius: 20,
                backgroundColor: colors.surface,
              }}
            >
              {(index === 0 || devices[index - 1].kind !== device.kind) && (
                <Text
                  style={[
                    styles.muted,
                    {
                      fontWeight: '600',
                      paddingBottom: 4,
                    },
                  ]}
                >
                  {device.kind === 'physical'
                    ? 'Connected phones and tablets'
                    : 'Simulators and emulators'}
                </Text>
              )}
              <Text style={styles.text}>{device.name}</Text>
              <Text style={styles.muted}>{device.hostName ?? 'Local runtime'}</Text>
              <Text style={styles.muted}>
                {device.kind === 'physical'
                  ? `Physical ${device.platform === 'ios' ? 'iPhone / iPad' : 'Android'} · ${device.connection}`
                  : `${device.platform === 'ios' ? 'iOS simulator' : 'Android emulator'} · ${device.state}`}
                {device.kind === 'physical' && device.state === 'booted' && ' · Direct control'}
              </Text>
              <View
                style={[
                  styles.row,
                  {
                    flexWrap: 'wrap',
                  },
                ]}
              >
                <Action
                  label={device.kind === 'physical' ? 'Control device' : 'Live preview'}
                  disabled={
                    device.liveSupported === false ||
                    (device.kind === 'physical' && device.state !== 'booted') ||
                    !connected ||
                    busy ||
                    (device.kind !== 'physical' && device.state !== 'booted')
                  }
                  onPress={() => setLiveDevice(device)}
                />
                <Action
                  secondary
                  label="Install app / URL forwards"
                  disabled={!connected || busy}
                  onPress={() => setActionDevice(device)}
                />
                {device.kind === 'physical' && (
                  <>
                    {device.platform === 'android' && (
                      <Action
                        secondary
                        label="Open URL"
                        disabled={!connected || busy || device.state !== 'booted'}
                        onPress={() => deviceAction(device, 'open')}
                      />
                    )}
                    {device.platform === 'ios' && (
                      <Action
                        secondary
                        label="Device controls"
                        disabled={!connected || busy}
                        onPress={() => setSetupDevice(device)}
                      />
                    )}
                    <Action
                      secondary
                      label="Take screenshot"
                      disabled={!connected || busy}
                      onPress={() => deviceAction(device, 'screenshot')}
                    />
                  </>
                )}
                {device.kind !== 'physical' && (
                  <>
                    <Action
                      label={device.state === 'booted' ? 'Stop' : 'Start'}
                      disabled={!connected || busy || device.state === 'starting'}
                      onPress={() =>
                        deviceAction(device, device.state === 'booted' ? 'shutdown' : 'boot')
                      }
                    />
                    <Action
                      secondary
                      label="Open URL"
                      disabled={!connected || busy || device.state !== 'booted'}
                      onPress={() => deviceAction(device, 'open')}
                    />
                    <Action
                      secondary
                      label="Take screenshot"
                      disabled={!connected || busy || device.state !== 'booted'}
                      onPress={() => deviceAction(device, 'screenshot')}
                    />
                  </>
                )}
              </View>
            </View>
          ))}
          {setup}
          {actions}
          {image && (
            <>
              <Text style={styles.muted}>
                Captured screenshot · capture again with Take screenshot
              </Text>
              <Image
                source={{
                  uri: image,
                }}
                accessibilityLabel="Simulator screenshot"
                resizeMode="contain"
                style={{
                  width: '100%',
                  height: 540,
                }}
              />
            </>
          )}
        </ScrollView>
      )}
      {mode === 'web' && previewControls}
    </View>
  )
}
