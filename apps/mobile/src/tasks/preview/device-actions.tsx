import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { Switch } from '../../ui/controls/switch'
import { useEffect } from 'react'
import { View } from 'react-native'
import {
  decode,
  deviceHostInstallSchema,
  deviceHostForwardSchema,
  deviceHostForwardResultSchema,
  previewResultSchema,
  responses,
  type PreviewDevice,
} from '@dovo/protocol'
import { useApplicationState } from '../../runtime/state/application-state'
import { useRuntime } from '../../runtime/connection/provider'
import { SettingsSheet } from '../../screens/settings-theme'
import { SettingsAction as Action, SettingsField as Field } from '../../screens/settings-controls'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import { deviceHostMessage } from '../../screens/device-host-form'

export type DeviceForward = typeof deviceHostForwardResultSchema.Type & { hostId: string }

export function DeviceActions({
  taskId,
  device,
  forward,
  onForward,
  onUrl,
  onClose,
}: {
  taskId: string
  device: PreviewDevice
  forward: DeviceForward | null
  onForward: (value: DeviceForward | null) => void
  onUrl: (url: string) => void
  onClose: () => void
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const { connected, profiles, call } = useRuntime()
  const { act, busy, error } = useAction()
  const [artifactPath, setArtifactPath] = useApplicationState('')
  const [bundleId, setBundleId] = useApplicationState('')
  const [exposeToNetwork, setExposeToNetwork] = useApplicationState(false)
  const [localPort, setLocalPort] = useApplicationState('3000')
  const [remotePort, setRemotePort] = useApplicationState('3000')
  const [duration, setDuration] = useApplicationState('600')
  const [message, setMessage] = useApplicationState('')
  useEffect(() => {
    if (!forward) return
    const remaining = new Date(forward.expiresAt).getTime() - Date.now()
    if (remaining <= 0) {
      onForward(null)
      return
    }
    const timer = setTimeout(() => onForward(null), remaining)
    return () => clearTimeout(timer)
  }, [forward, onForward])
  const disabled = !connected || busy
  const safeCall = async (work: () => Promise<void>) => {
    setMessage('')
    try {
      await work()
    } catch (reason) {
      throw new Error(
        deviceHostMessage(reason instanceof Error ? reason.message : String(reason), profiles),
      )
    }
  }
  return (
    <SettingsSheet
      title={uiText('Device actions · {value0}', { value0: device.hostName ?? 'Local runtime' })}
      busy={busy}
      onClose={onClose}
    >
      <Text style={styles.text}>{device.name}</Text>
      {!connected && (
        <Text accessibilityRole="alert" style={styles.muted}>
          <InterfaceText>
            {'The current runtime is offline. Reconnect to perform device actions.'}
          </InterfaceText>
        </Text>
      )}
      <View style={styles.card}>
        <Text style={styles.text}>
          <InterfaceText>{'Install app'}</InterfaceText>
        </Text>
        <Field
          label={uiText('Build artifact path in task checkout')}
          value={artifactPath}
          editable={!disabled}
          onChangeText={setArtifactPath}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={
            device.platform === 'android'
              ? uiText('android/app/build/outputs/apk/debug/app-debug.apk')
              : uiText('build/MyApp.app')
          }
        />
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Use a path inside this task’s checkout on the current runtime, not this phone. Dovo transfers remote builds over SSH before installing.'
            }
          </InterfaceText>
        </Text>
        <Text style={styles.muted}>
          {device.platform === 'android'
            ? uiText('Android requires an .apk file.')
            : device.kind === 'physical'
              ? uiText(
                  'A physical iPhone requires a signed iPhoneOS .app with an embedded provisioning profile.',
                )
              : uiText('Use an .app built for iPhoneSimulator.')}
        </Text>
        <Field
          label={uiText('App identifier (optional)')}
          value={bundleId}
          editable={!disabled}
          onChangeText={setBundleId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={uiText('com.example.app')}
        />
        <Action
          label={
            bundleId.trim() ? uiText('Install and launch app') : uiText('Install app on device')
          }
          disabled={disabled || device.state !== 'booted' || !artifactPath.trim()}
          onPress={() =>
            act(() =>
              safeCall(async () => {
                const input = decode(deviceHostInstallSchema, {
                  taskId,
                  id: device.id,
                  hostId: device.hostId,
                  artifactPath: artifactPath.trim(),
                })
                await call('/api/device-hosts/install', input, previewResultSchema)
                if (bundleId.trim())
                  await call(
                    '/api/previews/action',
                    { taskId, id: device.id, action: 'launch', bundleId: bundleId.trim() },
                    previewResultSchema,
                  )
                setMessage(
                  `${bundleId.trim() ? 'Installed and launched' : 'Installed'} on ${device.name}.`,
                )
              }),
            )
          }
        />
        <Action
          secondary
          label={uiText('Launch installed app')}
          disabled={
            disabled ||
            device.state !== 'booted' ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(bundleId.trim())
          }
          onPress={() =>
            act(() =>
              safeCall(async () => {
                await call(
                  '/api/previews/action',
                  { taskId, id: device.id, action: 'launch', bundleId: bundleId.trim() },
                  previewResultSchema,
                )
                setMessage(`Launched on ${device.name}.`)
              }),
            )
          }
        />
      </View>
      {device.hostId && (
        <View style={styles.card}>
          <Text style={styles.text}>
            <InterfaceText>{'Forward development server'}</InterfaceText>
          </Text>
          <Field
            label={uiText('Server port on current runtime')}
            value={localPort}
            editable={!disabled && !forward}
            keyboardType="number-pad"
            onChangeText={setLocalPort}
          />
          <Field
            label={uiText('Listening port on destination host')}
            value={remotePort}
            editable={!disabled && !forward}
            keyboardType="number-pad"
            onChangeText={setRemotePort}
          />
          <Field
            label={uiText('Forward duration in seconds (1–3600)')}
            value={duration}
            editable={!disabled && !forward}
            keyboardType="number-pad"
            onChangeText={setDuration}
          />
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Forwards the current runtime’s localhost server to the destination’s loopback address over SSH. Simulators and emulators can use it directly. For physical phones, allow destination network access below or use a directly reachable development-server URL.'
              }
            </InterfaceText>
          </Text>
          {device.kind === 'physical' && (
            <View style={{ gap: 8 }}>
              <Text style={styles.text}>
                <InterfaceText>{'Allow phones on the destination network'}</InterfaceText>
              </Text>
              <Text style={styles.muted}>
                <InterfaceText>
                  {
                    'Expose this port on the destination’s LAN/VPN. Its SSH server must use GatewayPorts clientspecified.'
                  }
                </InterfaceText>
              </Text>
              <Switch
                accessibilityLabel={uiText('Allow phones on the destination network')}
                value={exposeToNetwork}
                disabled={disabled || !!forward}
                onValueChange={setExposeToNetwork}
              />
            </View>
          )}
          {!forward && (
            <Action
              label={uiText('Start URL forward')}
              disabled={disabled}
              onPress={() =>
                act(() =>
                  safeCall(async () => {
                    if (
                      ![localPort, remotePort, duration].every((value) =>
                        /^\d+$/.test(value.trim()),
                      )
                    )
                      throw new Error('Ports and duration must be whole numbers.')
                    const input = decode(deviceHostForwardSchema, {
                      taskId,
                      hostId: device.hostId,
                      localPort: Number(localPort),
                      remotePort: Number(remotePort),
                      durationSeconds: Number(duration),
                      exposeToNetwork,
                    })
                    const result = await call(
                      '/api/device-hosts/forward',
                      input,
                      deviceHostForwardResultSchema,
                    )
                    onForward({ ...result, hostId: input.hostId })
                  }),
                )
              }
            />
          )}
          {forward && (
            <>
              <Text selectable style={styles.text}>
                {forward.url}
              </Text>
              <Text style={styles.muted}>
                <InterfaceText
                  values={{ value0: new Date(forward.expiresAt).toLocaleTimeString() }}
                >
                  {
                    'Expires {value0}. A forward also stops when the task closes. Leaving this preview does not stop it immediately.'
                  }
                </InterfaceText>
              </Text>
              {device.kind === 'physical' && !forward.url.startsWith('http://127.0.0.1:') && (
                <Text style={styles.muted}>
                  <InterfaceText>
                    {
                      'Use the device host’s LAN/VPN address if its SSH alias is not reachable from your phone.'
                    }
                  </InterfaceText>
                </Text>
              )}
              {forward.hostId === device.hostId && device.kind !== 'physical' && (
                <Action
                  secondary
                  label={uiText('Use forwarded preview URL')}
                  disabled={disabled}
                  onPress={() => {
                    const url = new URL(forward.url)
                    if (
                      device.platform === 'android' &&
                      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
                    )
                      url.hostname = '10.0.2.2'
                    onUrl(device.platform === 'android' ? url.toString() : forward.url)
                    onClose()
                  }}
                />
              )}
              <Action
                secondary
                label={uiText('Stop URL forward')}
                disabled={disabled}
                onPress={() =>
                  act(() =>
                    safeCall(async () => {
                      await call(
                        '/api/device-hosts/forward/stop',
                        { taskId, id: forward.id },
                        responses.ok,
                      )
                      onForward(null)
                    }),
                  )
                }
              />
            </>
          )}
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {message}
        </Text>
      )}
    </SettingsSheet>
  )
}
