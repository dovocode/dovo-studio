import { useApplicationState } from './application-state'
import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { runtimeReachability } from '@dovo/protocol'
import { Text } from '../ui/text'
import { useRuntime } from './provider'
import { Action } from '../ui/action'
import { Pill } from '../ui/pill'
import { Sheet } from '../ui/sheet'
import { useAction } from '../ui/use-action'
import { styles } from '../ui/theme'

/** Floating connection indicator: one quiet pill instead of a full-width banner. Tap to
 * reconnect; if the computer is still unreachable, the next tap explains why. */
export function ConnectionPill({ runtimeId }: { runtimeId?: string | null }) {
  const runtime = useRuntime()
  const { busy, act } = useAction()
  const [visible, setVisible] = useApplicationState(false)
  const [attempted, setAttempted] = useApplicationState(false)
  const [details, setDetails] = useApplicationState(false)
  const scoped = runtimeId
    ? runtime.overviews.filter((entry) => entry.profile.id === runtimeId)
    : runtime.overviews
  // Only hosts whose requests failed count; a computer still connecting is not offline.
  const unavailable = scoped.filter((entry) => runtimeReachability(entry) === 'offline')
  const offline = runtime.ready && !!unavailable.length
  useEffect(() => {
    if (!offline) {
      setVisible(false)
      setAttempted(false)
      setDetails(false)
      return
    }
    // Brief reconnects shouldn't flash an indicator while somebody is reading or typing.
    const timer = setTimeout(() => setVisible(true), 2500)
    return () => clearTimeout(timer)
  }, [offline])
  if (!offline || (!visible && !busy)) return null
  const subject =
    unavailable.length === 1 && scoped.length === 1 ? 'Offline' : `${unavailable.length} offline`
  const label = busy
    ? 'Reconnecting…'
    : attempted
      ? `Still ${subject.toLowerCase()}`
      : `${subject} · Reconnect`
  const reconnect = () =>
    act(async () => {
      await runtime.refreshAll()
      setAttempted(true)
    })
  return (
    <>
      <Pill
        testID="Connection details"
        icon="device"
        label={label}
        busy={busy}
        accessibilityHint={
          attempted ? 'Shows connection details' : 'Reconnects. Touch and hold for details'
        }
        onPress={() => (attempted ? setDetails(true) : reconnect())}
        onLongPress={() => setDetails(true)}
      />
      {details && (
        <Sheet title="Connection" onClose={() => setDetails(false)}>
          <Text style={styles.text}>
            Saved work stays available. Reconnect a computer to send messages or run commands there.
          </Text>
          {unavailable.map((entry) => (
            <View key={entry.profile.id} style={{ gap: 6 }}>
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
          <Action wide label="Reconnect" disabled={busy} onPress={reconnect} />
          <Action
            label="Open settings"
            secondary
            disabled={busy}
            onPress={() => {
              setDetails(false)
              router.navigate('/settings/devices', { withAnchor: true })
            }}
          />
        </Sheet>
      )}
    </>
  )
}

/** Pins floating pills just above whatever follows in the layout (composer or tab bar). */
export function FloatingPills({ children }: { children: ReactNode }) {
  return (
    <View style={{ height: 0, zIndex: 10 }}>
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: 10,
          left: 0,
          right: 0,
          alignItems: 'center',
          gap: 8,
        }}
      >
        {children}
      </View>
    </View>
  )
}
