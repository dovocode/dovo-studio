import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Schema } from 'effect'
import {
  projectTransferActive,
  projectTransferLabel,
  projectTransferSchema,
  type ProjectTransfer,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

/**
 * What the user can do with a thread that moves to another computer. The runtime owns the
 * outcome: cancellation unlocks the source only after the destination confirms cleanup, and a
 * committed move always wins over a later cancel. Desktop uses the same wording.
 */
function machineHandoffStatus(
  handoff: NonNullable<Task['machineHandoff']>,
  job: ProjectTransfer | undefined,
  name: string,
) {
  if (handoff.state === 'staged')
    return {
      title: 'This thread is arriving from another computer',
      detail: 'It opens here when the source computer finishes the move.',
      canCancel: false,
      canRetry: false,
      canOpen: false,
    }
  const failed = job?.state === 'failed'
  // A moved source is durable, but the destination opens the thread only after activation.
  if (handoff.state === 'moved')
    return job?.state === 'completed'
      ? {
          title: `This thread continues on ${name}`,
          detail:
            'Open it there and send your next message. This copy is read-only and stays here for recovery.',
          canCancel: false,
          canRetry: false,
          canOpen: true,
        }
      : {
          title: `Finishing handoff to ${name}…`,
          detail: failed
            ? `${name} has the thread but has not opened it yet. Retry to finish the handoff. This copy stays read-only.`
            : `${name} opens the thread when the handoff finishes. This copy stays read-only.`,
          canCancel: false,
          canRetry: failed,
          canOpen: false,
        }
  const unconfirmed = job?.state === 'cancelled' || job?.state === 'completed'
  return {
    title: `Moving this thread to ${name}…`,
    detail: failed
      ? `Retry the move, or cancel it. Cancel unlocks this thread only after ${name} confirms that it removed its copy. If ${name} already received the thread, cancel finishes the move instead.`
      : unconfirmed
        ? `The result is not confirmed yet. This thread stays read-only until ${name} is online and confirms it.`
        : 'Messages and edits are paused while the thread moves.',
    canCancel: !!job && job.state !== 'completed',
    canRetry: failed,
    canOpen: false,
  }
}

/**
 * Replaces the message input while a thread moves, or after it moved, to another computer.
 * The source stays read-only, so two computers never run the same thread.
 */
export function MachineHandoffNotice({
  handoff,
  taskId,
}: {
  handoff: NonNullable<Task['machineHandoff']>
  taskId: string
}) {
  const uiText = useInterfaceText()

  const runtime = useRuntime()
  const { navigate } = useNavigation()
  const { styles, colors } = useTheme()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  // The handoff ID is the transfer job ID; it also survives later copies of this thread.
  const jobs = runtime.snapshot?.projectTransfers
  const job =
    jobs?.find((item) => item.id === handoff.id) ??
    jobs?.filter((item) => item.sourceTaskId === taskId).at(-1)
  const target = runtime.overviews.find(
    (entry) =>
      (entry.profile.connection.runtimeId ?? entry.snapshot?.runtimeId) === handoff.targetRuntimeId,
  )
  const name = job?.targetName ?? target?.profile.name ?? 'another computer'
  const targetTaskId = handoff.targetTaskId ?? job?.targetTaskId
  const status = machineHandoffStatus(handoff, job, name)
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View
      style={{
        gap: 8,
        margin: 12,
        padding: 12,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}
    >
      <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>{status.title}</Text>
        <Text style={styles.muted}>{status.detail}</Text>
        {job && handoff.state !== 'staged' && job.state !== 'completed' && (
          <Text
            style={job.state === 'failed' ? styles.error : styles.muted}
            accessibilityLabel={
              projectTransferActive(job) && job.totalBytes
                ? `${projectTransferLabel(job)}, ${Math.floor((job.bytes / job.totalBytes) * 100)}%`
                : undefined
            }
          >
            {projectTransferLabel(job)}
          </Text>
        )}
        {status.canOpen && targetTaskId && !target && (
          <Text style={styles.muted}>
            <InterfaceText values={{ value0: name }}>
              {'Pair {value0} to open this thread.'}
            </InterfaceText>
          </Text>
        )}
      </View>
      {status.canOpen && targetTaskId && (
        <Action
          secondary
          label={uiText('Open on {value0}', { value0: name })}
          disabled={busy || !target}
          onPress={() => {
            if (target) navigate('tasks', targetTaskId, target.profile.id)
          }}
        />
      )}
      {status.canRetry && job && (
        <Action
          secondary
          label={uiText('Retry move')}
          disabled={busy || !runtime.connected}
          onPress={() =>
            void act(() =>
              runtime.call(
                '/api/scm/project-transfer/retry',
                { id: job.id },
                projectTransferSchema,
              ),
            )
          }
        />
      )}
      {status.canCancel && job && (
        <Action
          secondary
          label={uiText('Cancel move')}
          disabled={busy || !runtime.connected}
          onPress={() =>
            void act(() =>
              runtime.call(
                '/api/scm/project-transfer/cancel',
                { id: job.id },
                Schema.Struct({ ok: Schema.Boolean }),
              ),
            )
          }
        />
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
