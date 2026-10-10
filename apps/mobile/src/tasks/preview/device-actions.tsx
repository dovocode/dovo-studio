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
      title={`Device actions · ${device.hostName ?? 'Local runtime'}`}
      busy={busy}
      onClose={onClose}
    >
      <Text style={styles.text}>{device.name}</Text>
      {!connected && (
        <Text accessibilityRole="alert" style={styles.muted}>
          The current runtime is offline. Reconnect to perform device actions.
        </Text>
      )}
      <View style={styles.card}>
        <Text style={styles.text}>Install app</Text>
        <Field
          label="Build artifact path in task checkout"
          value={artifactPath}
          editable={!disabled}
          onChangeText={setArtifactPath}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={
            device.platform === 'android'
              ? 'android/app/build/outputs/apk/debug/app-debug.apk'
              : 'build/MyApp.app'
          }
        />
        <Text style={styles.muted}>
          Use a path inside this task’s checkout on the current runtime, not this phone. Dovo
          transfers remote builds over SSH before installing.
        </Text>
        <Text style={styles.muted}>
          {device.platform === 'android'
            ? 'Android requires an .apk file.'
            : device.kind === 'physical'
              ? 'A physical iPhone requires a signed iPhoneOS .app with an embedded provisioning profile.'
              : 'Use an .app built for iPhoneSimulator.'}
        </Text>
        <Field
          label="App identifier (optional)"
          value={bundleId}
          editable={!disabled}
          onChangeText={setBundleId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="com.example.app"
        />
        <Action
          label={bundleId.trim() ? 'Install and launch app' : 'Install app on device'}
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
          label="Launch installed app"
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
          <Text style={styles.text}>Forward development server</Text>
          <Field
            label="Server port on current runtime"
            value={localPort}
            editable={!disabled && !forward}
            keyboardType="number-pad"
            onChangeText={setLocalPort}
          />
          <Field
            label="Listening port on destination host"
            value={remotePort}
            editable={!disabled && !forward}
            keyboardType="number-pad"
            onChangeText={setRemotePort}
          />
          <Field
            label="Forward duration in seconds (1–3600)"
            value={duration}
            editable={!disabled && !forward}
            keyboardType="number-pad"
            onChangeText={setDuration}
          />
          <Text style={styles.muted}>
            Forwards the current runtime’s localhost server to the destination’s loopback address
            over SSH. Simulators and emulators can use it directly. For physical phones, allow
            destination network access below or use a directly reachable development-server URL.
          </Text>
          {device.kind === 'physical' && (
            <View style={{ gap: 8 }}>
              <Text style={styles.text}>Allow phones on the destination network</Text>
              <Text style={styles.muted}>
                Expose this port on the destination’s LAN/VPN. Its SSH server must use GatewayPorts
                clientspecified.
              </Text>
              <Switch
                accessibilityLabel="Allow phones on the destination network"
                value={exposeToNetwork}
                disabled={disabled || !!forward}
                onValueChange={setExposeToNetwork}
              />
            </View>
          )}
          {!forward && (
            <Action
              label="Start URL forward"
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
                Expires {new Date(forward.expiresAt).toLocaleTimeString()}. A forward also stops
                when the task closes. Leaving this preview does not stop it immediately.
              </Text>
              {device.kind === 'physical' && !forward.url.startsWith('http://127.0.0.1:') && (
                <Text style={styles.muted}>
                  Use the device host’s LAN/VPN address if its SSH alias is not reachable from your
                  phone.
                </Text>
              )}
              {forward.hostId === device.hostId && device.kind !== 'physical' && (
                <Action
                  secondary
                  label="Use forwarded preview URL"
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
                label="Stop URL forward"
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
