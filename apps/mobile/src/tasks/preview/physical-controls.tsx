import { mobileWorkflow } from '../../runtime/state/native-effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { useEffect } from 'react'
import { View } from 'react-native'
import { previewResultSchema, previewUrl, type PreviewDevice } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Sheet } from '../../ui/layout/sheet'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import { deviceHostMessage } from '../../screens/device-host-form'
export function PhysicalControls({
  taskId,
  device,
  onClose,
}: {
  taskId: string
  device: PreviewDevice
  onClose: () => void
}) {
  const { styles } = useTheme()

  const { profile, profiles, connected, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const [apps, setApps] = useApplicationState<
    Array<{
      name: string
      bundleId: string
    }>
  >([])
  const [selected, setSelected] = useApplicationState(''),
    [url, setUrl] = useApplicationState(''),
    [message, setMessage] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  const disabled = busy || !connected
  useEffect(() => {
    let live = true
    if (!connected) return
    act(() =>
      mobileWorkflow(function* () {
        const result = yield* callEffect(
          '/api/previews/action',
          {
            taskId,
            id: device.id,
            hostId: device.hostId,
            action: 'apps',
          },
          previewResultSchema,
        )
        if (live) {
          setApps(result.apps ?? [])
          setSelected(result.apps?.[0]?.bundleId ?? '')
        }
      }),
    )
    return () => {
      live = false
    }
  }, [device.id, taskId, connected, retry])
  const command = (action: string) =>
    act(() =>
      mobileWorkflow(function* () {
        setMessage('')
        yield* callEffect(
          '/api/previews/action',
          {
            taskId,
            id: device.id,
            hostId: device.hostId,
            action,
            bundleId: selected || undefined,
            url: action === 'open' ? previewUrl(url, profile?.connection.address) : undefined,
          },
          previewResultSchema,
        )
        setMessage('Applied on ' + device.name)
      }),
    )
  return (
    <Sheet
      title={`Device controls · ${device.hostName ?? 'Local runtime'}`}
      busy={busy}
      onClose={onClose}
    >
      <View
        style={{
          padding: 16,
          gap: 16,
        }}
      >
        <Text style={styles.muted}>
          Tap, swipe, hold, and type directly on the phone preview. No Device Hub window needed.
        </Text>
        {!connected && (
          <Text style={styles.muted}>
            The current runtime is offline. Reconnect to control this device.
          </Text>
        )}
        <Choice
          label="Developer app"
          value={selected}
          items={apps.map((app) => ({
            id: app.bundleId,
            name: app.name,
          }))}
          onChange={setSelected}
          disabled={disabled}
        />
        <Action
          secondary
          label="Refresh developer apps"
          disabled={disabled}
          onPress={() => setRetry((value) => value + 1)}
        />
        {!apps.length && !busy && <Text style={styles.muted}>No developer apps installed.</Text>}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Action
            label="Launch"
            disabled={disabled || !selected}
            onPress={() => command('launch')}
          />
          <Action
            label="Relaunch"
            secondary
            disabled={disabled || !selected}
            onPress={() => command('relaunch')}
          />
        </View>
        <Field
          label="Open URL on phone"
          value={url}
          onChangeText={setUrl}
          editable={!disabled}
          placeholder="HTTP or HTTPS URL reachable from the phone"
          autoCapitalize="none"
          keyboardType="url"
        />
        <Action
          label="Open URL"
          secondary
          disabled={disabled || !url.trim()}
          onPress={() => command('open')}
        />
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {(['portrait', 'landscape', 'light', 'dark'] as const).map((action) => (
            <Action
              key={action}
              label={action[0].toUpperCase() + action.slice(1)}
              secondary
              disabled={disabled}
              onPress={() => command(action)}
            />
          ))}
        </View>
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {deviceHostMessage(error, profiles)}
          </Text>
        )}
        {!!message && <Text style={styles.muted}>{message}</Text>}
      </View>
    </Sheet>
  )
}
