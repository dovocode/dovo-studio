import { runtimeComputerName } from '@dovo/protocol'
import { useApplicationState } from '../state/application-state'
import { useEffect, type ReactNode } from 'react'
import { Alert, View } from 'react-native'
import { router } from 'expo-router'
import { runtimeReachability } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { useRuntime } from './provider'
import { Action } from '../../ui/controls/action'
import { Pill } from '../../ui/controls/pill'
import { Sheet } from '../../ui/layout/sheet'
import { useAction } from '../../ui/controls/use-action'
import { formatDateTime } from '../../ui/content/format-date'
import { useTheme } from '../../ui/theme'

/** Floating connection indicator: one quiet pill instead of a full-width banner. Tap to
 * reconnect; if the computer is still unreachable, the next tap explains why. */
export function ConnectionPill({ runtimeId }: { runtimeId?: string | null }) {
  const { styles } = useTheme()

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
  const saved = scoped.filter((entry) => runtime.mutationStatus(entry.profile).pending > 0)
  const hasSaved = !!saved.length
  const offline = runtime.ready && (!!unavailable.length || hasSaved)
  const revoked = unavailable.filter((entry) => entry.unauthorized)
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
  // Reconnecting cannot fix a revoked pairing; say what will.
  const label = busy
    ? 'Reconnecting…'
    : hasSaved && !unavailable.length
      ? 'Saved actions · Review'
      : revoked.length
        ? 'Pairing expired · Pair again'
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
          attempted || revoked.length
            ? 'Shows connection details'
            : 'Reconnects. Touch and hold for details'
        }
        onPress={() => (attempted || revoked.length || hasSaved ? setDetails(true) : reconnect())}
        onLongPress={() => setDetails(true)}
      />
      {details && (
        <Sheet title="Connection" onClose={() => setDetails(false)}>
          <Text style={styles.text}>
            {revoked.length
              ? 'This phone is no longer paired with a computer below. It was removed on that computer, or the runtime was reset. Pair it again from Devices in Settings.'
              : 'Saved work stays available. Reconnect a computer to send messages or run commands there.'}
          </Text>
          {saved.map((entry) => {
            const status = runtime.mutationStatus(entry.profile)
            return (
              <View key={`saved:${entry.profile.id}`} style={{ gap: 6 }}>
                <Text style={styles.title}>
                  {runtimeComputerName(entry)} · {status.pending} saved actions
                </Text>
                {!!status.error && (
                  <Text selectable style={styles.error}>
                    {status.error}
                  </Text>
                )}
                <Action
                  label="Retry saved actions"
                  disabled={busy || !entry.connected}
                  onPress={() => act(() => runtime.retryMutations(entry.profile))}
                />
                <Action
                  label="Discard saved actions"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      'Discard saved actions?',
                      'Actions already applied on the computer will remain applied. Unsent actions will be removed from this phone.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Discard',
                          style: 'destructive',
                          onPress: () => act(() => runtime.discardMutations(entry.profile)),
                        },
                      ],
                    )
                  }
                />
              </View>
            )
          })}
          {unavailable.map((entry) => (
            <View key={entry.profile.id} style={{ gap: 6 }}>
              <Text style={styles.title}>{runtimeComputerName(entry)}</Text>
              <Text selectable style={styles.muted}>
                {entry.profile.connection.address}
              </Text>
              {!!entry.lastSeen && (
                <Text style={styles.muted}>Last connected {formatDateTime(entry.lastSeen)}</Text>
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
            label={revoked.length ? 'Pair again' : 'Open settings'}
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
