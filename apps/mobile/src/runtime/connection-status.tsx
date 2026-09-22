import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { useRuntime } from './provider'
import { Action } from '../ui/action'
import { Icon } from '../ui/icon'
import { Sheet } from '../ui/sheet'
import { useAction } from '../ui/use-action'
import { colors, styles } from '../ui/theme'

export function ConnectionStatus({ onSettings }: { onSettings: () => void }) {
  const runtime = useRuntime()
  const { busy, error, act } = useAction()
  const [visible, setVisible] = useState(false)
  const [details, setDetails] = useState(false)
  const unavailable = runtime.overviews.filter((entry) => !entry.connected)
  const offline = runtime.ready && !!unavailable.length
  useEffect(() => {
    if (!offline) {
      setVisible(false)
      setDetails(false)
      return
    }
    // Brief reconnects shouldn't move the screen while somebody is reading or typing.
    const timer = setTimeout(() => setVisible(true), 800)
    return () => clearTimeout(timer)
  }, [offline])
  if (!offline || !visible) return null
  const summary =
    unavailable.length === runtime.overviews.length
      ? 'Offline · Showing saved work'
      : `${unavailable.length} computer${unavailable.length === 1 ? '' : 's'} offline · Saved work included`
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          gap: 8,
          borderBottomWidth: 0.5,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Connection details"
          accessibilityValue={{ text: summary }}
          testID="Connection details"
          onPress={() => setDetails(true)}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon name="device" size={15} color={colors.muted} />
          <Text numberOfLines={2} style={[styles.muted, { flex: 1 }]}>
            {summary}
          </Text>
          <Icon name="next" size={10} color={colors.muted} />
        </Pressable>
        {!!runtime.profiles.length && (
          <Action
            label="Retry connection"
            secondary
            disabled={busy}
            onPress={() => act(runtime.refreshAll)}
          />
        )}
      </View>
      {details && (
        <Sheet title="Connection" onClose={() => setDetails(false)}>
          <Text style={styles.text}>
            Saved work stays in your collections. Reconnect a computer to send messages or run
            commands there.
          </Text>
          {unavailable.map((entry) => (
            <View key={entry.profile.id} style={{ gap: 8 }}>
              <Text style={styles.title}>{entry.profile.name}</Text>
              <Text selectable style={styles.muted}>
                {entry.profile.connection.address}
              </Text>
              {!!entry.lastSeen && (
                <Text style={styles.muted}>
                  Last connected {new Date(entry.lastSeen).toLocaleString()}
                </Text>
              )}
              {!!entry.error && (
                <Text selectable style={styles.error}>
                  {entry.error}
                </Text>
              )}
            </View>
          ))}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action label="Reconnect" disabled={busy} onPress={() => act(runtime.refreshAll)} />
          <Action
            label="Open settings"
            secondary
            disabled={busy}
            onPress={() => {
              setDetails(false)
              onSettings()
            }}
          />
        </Sheet>
      )}
    </>
  )
}
