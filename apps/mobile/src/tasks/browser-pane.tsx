import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { useEffect, useRef } from 'react'
import { Image, Linking, Platform, ScrollView, View } from 'react-native'
import { WebView } from 'react-native-webview'
import {
  previewDevicesSchema,
  previewResultSchema,
  previewUrl,
  previewPresets,
  type PreviewDevice,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Text } from '../ui/text'
import { Field } from '../ui/field'
import { Action } from '../ui/action'
import { IconButton } from '../ui/icon-button'
import { Choice } from '../ui/choice'
import { styles, colors } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { RemoteBrowser } from './remote-browser'
import { PhysicalControls } from './physical-controls'
const addresses = new Map<string, string>()
export function BrowserPane({
  taskId,
  expanded,
  onExpand,
}: {
  taskId: string
  expanded: boolean
  onExpand: (value: boolean) => void
}) {
  const { profile } = useRuntime()
  const [mode, setMode] = useApplicationState('remote')
  const scope = `${profile?.id}:${taskId}`
  return (
    <View
      style={{
        flex: 1,
      }}
    >
      <View
        style={{
          paddingHorizontal: 8,
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
          {!expanded && (
            <Choice
              label="Browser mode"
              compact
              hideLabel
              value={mode}
              items={[
                {
                  id: 'remote',
                  name: 'Host browser',
                },
                {
                  id: 'web',
                  name: 'Direct preview',
                },
                {
                  id: 'devices',
                  name: 'Devices',
                },
              ]}
              onChange={setMode}
            />
          )}
          {expanded && <Text style={styles.muted}>Preview</Text>}
        </View>
        <IconButton
          label={expanded ? 'Show controls' : 'Expand preview'}
          icon={expanded ? 'collapse' : 'expand'}
          onPress={() => onExpand(!expanded)}
        />
      </View>
      {mode === 'remote' ? (
        <RemoteBrowser key={scope} taskId={taskId} expanded={expanded} />
      ) : (
        <BrowserContent key={scope} scope={scope} taskId={taskId} mode={mode} expanded={expanded} />
      )}
    </View>
  )
}
function BrowserContent({
  scope,
  taskId,
  mode,
  expanded,
}: {
  scope: string
  taskId: string
  mode: string
  expanded: boolean
}) {
  const { profile, connected, callEffect } = useRuntime(),
    { busy, error, act } = useAction()
  const [input, setInput] = useApplicationState(addresses.get(scope) ?? 'http://localhost:3000'),
    [url, setUrl] = useApplicationState(addresses.get(scope) ?? '')
  const [preset, setPreset] = useApplicationState('fill'),
    [landscape, setLandscape] = useApplicationState(false)
  const [devices, setDevices] = useApplicationState<PreviewDevice[]>([]),
    [diagnostics, setDiagnostics] = useApplicationState<string[]>([])
  const [liveDevice, setLiveDevice] = useApplicationState<PreviewDevice | undefined>(undefined)
  const [setupDevice, setSetupDevice] = useApplicationState<PreviewDevice | undefined>(undefined)
  const [image, setImage] = useApplicationState(''),
    [loadError, setLoadError] = useApplicationState('')
  const web = useRef<WebView>(null)
  const [history, setHistory] = useApplicationState({
    back: false,
    forward: false,
    url: '',
  })
  const size = previewPresets.find((p) => p.id === preset) ?? previewPresets[0]
  const load = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        const result = yield* callEffect(
          '/api/previews/devices',
          {
            taskId,
          },
          previewDevicesSchema,
        )
        setDevices(result.devices)
        setDiagnostics(result.diagnostics)
      }),
    )
  }
  useEffect(() => {
    if (mode === 'devices' && connected) act(load)
  }, [mode, connected])
  const navigate = () =>
    act(() =>
      nativeEffect(() => {
        const target = previewUrl(input, profile?.connection.address)
        if (target === url) web.current?.reload()
        setUrl(target)
        setInput(target)
        addresses.set(scope, target)
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
            action,
            url: input,
          },
          previewResultSchema,
        )
        if (result.image) setImage(result.image)
        yield* nativeEffect(() => load())
      }),
    )
  const setup = setupDevice ? (
    <PhysicalControls
      taskId={taskId}
      device={setupDevice}
      onClose={() => setSetupDevice(undefined)}
    />
  ) : null
  if (mode === 'devices' && liveDevice)
    return (
      <View
        style={{
          flex: 1,
        }}
      >
        {setup}
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
          </Text>
          {liveDevice.kind === 'physical' && (
            <IconButton
              icon="settings"
              label="Device controls"
              onPress={() => setSetupDevice(liveDevice)}
            />
          )}
        </View>
        <RemoteBrowser
          key={`${scope}:${liveDevice.id}`}
          taskId={taskId}
          deviceId={liveDevice.id}
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
      <View
        style={{
          display: expanded ? 'none' : 'flex',
          padding: 8,
          gap: 6,
          borderBottomWidth: 0.5,
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
        {mode === 'web' && (
          <View
            style={[
              styles.row,
              {
                justifyContent: 'space-between',
              },
            ]}
          >
            <IconButton
              label="Back"
              icon="back"
              disabled={!history.back || mode !== 'web'}
              onPress={() => web.current?.goBack()}
            />
            <IconButton
              label="Forward"
              icon="next"
              disabled={!history.forward || mode !== 'web'}
              onPress={() => web.current?.goForward()}
            />
            <IconButton
              label="Reload"
              icon="refresh"
              disabled={!url || mode !== 'web'}
              onPress={() => {
                setLoadError('')
                web.current?.reload()
              }}
            />
            <IconButton
              label="Open externally"
              icon="web"
              disabled={!url}
              onPress={() => act(() => Linking.openURL(history.url || url))}
            />
            <Action label="Go" disabled={mode !== 'web'} onPress={navigate} />
          </View>
        )}
        {mode === 'web' && (
          <View
            style={[
              styles.row,
              {
                flexWrap: 'wrap',
              },
            ]}
          >
            <View
              style={{
                flex: 1,
              }}
            >
              <Choice
                label="Preview mode"
                hideLabel
                value={preset}
                items={previewPresets.map((p) => ({
                  id: p.id,
                  name: p.name,
                }))}
                onChange={setPreset}
              />
            </View>
            <Action
              secondary
              label="Rotate"
              disabled={mode !== 'web' || preset === 'fill'}
              onPress={() => setLandscape((v) => !v)}
            />
          </View>
        )}
        {(error || loadError) && (
          <Text
            accessibilityRole="alert"
            style={{
              color: colors.error,
            }}
          >
            {error || loadError}
          </Text>
        )}
      </View>
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
                ) : (
                  <WebView
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
                    onHttpError={(event) =>
                      setLoadError(`Page returned HTTP ${event.nativeEvent.statusCode}`)
                    }
                    onNavigationStateChange={(state) => {
                      setHistory({
                        back: state.canGoBack,
                        forward: state.canGoForward,
                        url: state.url,
                      })
                      if (state.url.startsWith('http')) {
                        setInput(state.url)
                        addresses.set(scope, state.url)
                      }
                    }}
                  />
                )}
              </View>
            </ScrollView>
          </ScrollView>
        ) : (
          <View
            style={{
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
              {d}
            </Text>
          ))}
          {!devices.length && !busy && (
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
                paddingBottom: 12,
                borderBottomWidth: 0.5,
                borderColor: colors.border,
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
              <Text style={styles.muted}>
                {device.kind === 'physical'
                  ? `Physical ${device.platform === 'ios' ? 'iPhone / iPad' : 'Android'} · ${device.connection}`
                  : `Simulator · ${device.state}`}
                {device.kind === 'physical' && device.platform === 'ios' && ' · Direct control'}
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
                    !connected ||
                    busy ||
                    (device.kind !== 'physical' && device.state !== 'booted')
                  }
                  onPress={() => setLiveDevice(device)}
                />
                {device.kind === 'physical' && (
                  <>
                    {device.platform === 'ios' && (
                      <Action
                        secondary
                        label="Device controls"
                        onPress={() => setSetupDevice(device)}
                      />
                    )}
                    <Action
                      secondary
                      label="Screenshot"
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
                      label="Screenshot"
                      disabled={!connected || busy || device.state !== 'booted'}
                      onPress={() => deviceAction(device, 'screenshot')}
                    />
                  </>
                )}
              </View>
            </View>
          ))}
          {setup}
          {image && (
            <>
              <Text style={styles.muted}>Captured screenshot · refresh with Screenshot</Text>
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
    </View>
  )
}
