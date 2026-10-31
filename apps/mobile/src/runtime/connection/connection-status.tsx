import { ConnectionProgress } from './connection-progress'
import { runtimeSyncStatus, retryRuntimeSync, runtimeComputerName } from '@dovo/protocol'
import { attachmentUploadSchema, decodeResult } from '@dovo/protocol'
import { useApplicationState } from '../state/application-state'
import { useEffect, useState, type ReactNode } from 'react'
import { Alert, View } from 'react-native'
import { router } from 'expo-router'
import { runtimeReachability } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { useRuntime } from './provider'
import { useOptionalMobileAccount } from './account-context'
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
  const account = useOptionalMobileAccount()
  const { busy, error, act } = useAction()
  const [visibleFor, setVisibleFor] = useState<string | null>(null)
  const [attempted, setAttempted] = useApplicationState(false)
  const [details, setDetails] = useApplicationState(false)
  const scoped = runtimeId
    ? runtime.overviews.filter((entry) => entry.profile.id === runtimeId)
    : runtime.overviews
  // Only hosts whose requests failed count; a computer still connecting is not offline.
  const unavailable = scoped.filter((entry) => runtimeReachability(entry) === 'offline')
  // In-flight journal entries are ordinary saves. Surface recovery only after failure.
  const saved = scoped.filter((entry) => {
    const status = runtime.mutationStatus(entry.profile)
    return status.pending > 0 && status.error !== null
  })
  const fallback = scoped.filter(
    (entry) =>
      entry.connected &&
      runtimeSyncStatus(entry.profile.connection) !== undefined &&
      runtimeSyncStatus(entry.profile.connection) !== 'live',
  )
  const hasSaved = !!saved.length
  const offline = runtime.ready && (!!unavailable.length || hasSaved || !!fallback.length)
  const urgent = !!unavailable.length || hasSaved
  const noticeKey = JSON.stringify([
    runtimeId ?? '',
    unavailable.map((entry) => entry.profile.id).sort(),
    saved.map((entry) => entry.profile.id).sort(),
    fallback.map((entry) => entry.profile.id).sort(),
  ])
  const accountManaged = (entry: (typeof scoped)[number]) =>
    !!(
      account?.client.sessionId() &&
      (entry.profile.connection.accountSession === account.client.sessionId() ||
        entry.profile.connection.internet?.session === account.client.sessionId())
    )
  const revoked = unavailable.filter((entry) => entry.unauthorized && !accountManaged(entry))
  const renewing = unavailable.some((entry) => account?.recovery?.[entry.profile.id]?.pending)
  useEffect(() => {
    if (!offline) {
      setVisibleFor(null)
      setAttempted(false)
      setDetails(false)
      return
    }
    // Brief reconnects shouldn't flash an indicator while somebody is reading or typing.
    const timer = setTimeout(() => setVisibleFor(noticeKey), urgent ? 2500 : 15_000)
    return () => clearTimeout(timer)
  }, [offline, noticeKey, urgent])
  if (!offline || (visibleFor !== noticeKey && !busy)) return null
  const subject =
    unavailable.length === 1 && scoped.length === 1 ? 'Offline' : `${unavailable.length} offline`
  // Reconnecting cannot fix a revoked pairing; say what will.
  const label =
    busy || renewing
      ? 'Reconnecting…'
      : fallback.length && !hasSaved && !unavailable.length
        ? 'HTTP updates · Review'
        : hasSaved && !unavailable.length
          ? 'Saved actions · Review'
          : revoked.length
            ? 'Pairing expired · Pair again'
            : attempted
              ? `Still ${subject.toLowerCase()}`
              : `${subject} · Reconnect`
  const reconnect = () =>
    act(async () => {
      account?.retryRecovery?.()
      for (const entry of scoped) retryRuntimeSync(entry.profile.connection)
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
        onPress={() =>
          attempted || revoked.length || hasSaved || fallback.length
            ? setDetails(true)
            : reconnect()
        }
        onLongPress={() => setDetails(true)}
      />
      {details && (
        <Sheet title="Connection" onClose={() => setDetails(false)}>
          {!!error && (
            <Text selectable style={styles.error}>
              {error}
            </Text>
          )}
          <Text style={styles.text}>
            {revoked.length
              ? 'This phone is no longer paired with a computer below. It was removed on that computer, or the runtime was reset. Pair it again from Devices in Settings.'
              : fallback.length && !unavailable.length
                ? 'Connected using HTTP updates. Live streaming is reconnecting or unavailable. Reconnect to retry it.'
                : 'Saved work stays available. Reconnect a computer to send messages or run commands there.'}
          </Text>
          {saved.map((entry) => {
            const status = runtime.mutationStatus(entry.profile)
            const uploads = runtime.attachmentUploads(entry.profile)
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
                {status.pending > uploads.length && (
                  <Action
                    label="Retry saved actions"
                    disabled={busy || !entry.connected}
                    onPress={() =>
                      status.reviewRequired
                        ? Alert.alert(
                            `Retry saved actions on ${runtimeComputerName(entry)}?`,
                            'Access to this computer was renewed. Some saved actions may already have run and retrying could repeat them. Check the computer before continuing. Messages keep their original delivery identity.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Retry actions',
                                onPress: () =>
                                  act(() => runtime.retryMutations(entry.profile, true)),
                              },
                            ],
                          )
                        : act(() => runtime.retryMutations(entry.profile))
                    }
                  />
                )}
                {status.pending > uploads.length && (
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
                )}
                {uploads.map((item) => {
                  const parsed = decodeResult(attachmentUploadSchema, item.input)
                  const input = parsed.success ? parsed.data : null
                  const title = input
                    ? entry.snapshot?.workspace.tasks.find((task) => task.id === input.taskId)
                        ?.title
                    : undefined
                  return (
                    <View key={item.id} style={{ gap: 6 }}>
                      <Text selectable>
                        {input
                          ? `${input.name}${title ? ` · ${title}` : ''}${input.queuedMessageId ? ' · queued edit' : ''}`
                          : 'Saved attachment'}
                      </Text>
                      <Text style={styles.muted}>
                        Attach to the task’s current draft or discard the upload. Existing files
                        remain unchanged.
                      </Text>
                      <Action
                        label="Attach to current task draft"
                        disabled={busy || !entry.connected || !input}
                        onPress={() =>
                          Alert.alert(
                            'Attach saved file?',
                            'This adds the saved file to the current draft of its original task. It does not modify a queued message.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Attach',
                                onPress: () =>
                                  act(() => runtime.recoverAttachment(entry.profile, item.id)),
                              },
                            ],
                          )
                        }
                      />
                      <Action
                        label="Discard saved upload"
                        disabled={busy || !entry.connected}
                        onPress={() =>
                          Alert.alert(
                            'Discard saved upload?',
                            'This permanently abandons this upload. An attachment already saved in a message or draft is not removed.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Discard',
                                style: 'destructive',
                                onPress: () =>
                                  act(() => runtime.discardAttachment(entry.profile, item.id)),
                              },
                            ],
                          )
                        }
                      />
                    </View>
                  )
                })}
              </View>
            )
          })}
          {scoped.map((entry) => (
            <View key={entry.profile.id} style={{ gap: 6 }}>
              <Text style={styles.title}>{runtimeComputerName(entry)}</Text>
              <ConnectionProgress
                entry={entry}
                recovering={account?.recovery?.[entry.profile.id]?.pending}
              />
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
              {!!account?.recovery?.[entry.profile.id]?.error && (
                <Text selectable style={styles.error}>
                  Dovo Connect: {account.recovery[entry.profile.id]?.error}
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
