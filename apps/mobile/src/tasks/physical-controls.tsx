import { mobileWorkflow } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { useEffect } from 'react'
import { View } from 'react-native'
import { previewResultSchema, previewUrl, type PreviewDevice } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Sheet } from '../ui/sheet'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
export function PhysicalControls({
  taskId,
  device,
  onClose,
}: {
  taskId: string
  device: PreviewDevice
  onClose: () => void
}) {
  const { profile, callEffect } = useRuntime(),
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
  useEffect(() => {
    let live = true
    act(() =>
      mobileWorkflow(function* () {
        const result = yield* callEffect(
          '/api/previews/action',
          {
            taskId,
            id: device.id,
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
  }, [device.id, taskId])
  const command = (action: string) =>
    act(() =>
      mobileWorkflow(function* () {
        setMessage('')
        yield* callEffect(
          '/api/previews/action',
          {
            taskId,
            id: device.id,
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
    <Sheet title="Device controls" onClose={onClose}>
      <View
        style={{
          padding: 16,
          gap: 16,
        }}
      >
        <Text style={styles.muted}>
          Tap, swipe, hold, and type directly on the phone preview. No Device Hub window needed.
        </Text>
        <Choice
          label="Developer app"
          value={selected}
          items={apps.map((app) => ({
            id: app.bundleId,
            name: app.name,
          }))}
          onChange={setSelected}
          disabled={busy}
        />
        {!apps.length && !busy && <Text style={styles.muted}>No developer apps installed.</Text>}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Action label="Launch" disabled={busy || !selected} onPress={() => command('launch')} />
          <Action
            label="Relaunch"
            secondary
            disabled={busy || !selected}
            onPress={() => command('relaunch')}
          />
        </View>
        <Field
          label="Open URL on phone"
          value={url}
          onChangeText={setUrl}
          placeholder="https:// or your Mac’s LAN address"
          autoCapitalize="none"
          keyboardType="url"
        />
        <Action
          label="Open URL"
          secondary
          disabled={busy || !url.trim()}
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
              disabled={busy}
              onPress={() => command(action)}
            />
          ))}
        </View>
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {!!message && <Text style={styles.muted}>{message}</Text>}
      </View>
    </Sheet>
  )
}
