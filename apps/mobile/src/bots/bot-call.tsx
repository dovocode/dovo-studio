import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { AppState, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { createBotCall } from '@dovo/client-runtime'
import { botCallReplies, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Sheet } from '../ui/layout/sheet'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { BotAvatar } from './bot-avatar'
import { mobileBotCallAudio } from './bot-call-audio'
import { useTheme } from '../ui/theme'

export function BotCall({ task, onClose }: { task: Task; onClose: () => void }) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const { call: request, connected, snapshot, profile } = useRuntime()
  const scope = JSON.stringify([
    profile?.id,
    profile?.connection.address,
    profile?.connection.token,
    task.id,
  ])
  const call = useMemo(
    () =>
      createBotCall(
        mobileBotCallAudio(),
        async (messageId, text) => {
          await request(
            '/api/tasks/message',
            { id: task.id, messageId, text, preserveQueuePause: true },
            responses.ok,
          )
        },
        randomUUID,
      ),
    [scope, request],
  )
  const state = useSyncExternalStore(call.subscribe, call.getSnapshot, call.getSnapshot)
  const available =
    connected &&
    task.bot?.state === 'active' &&
    snapshot?.queuePausePreservationSupported === true &&
    !task.queuePaused &&
    !task.queue?.[0]?.paused &&
    !task.archived &&
    !task.archivedAt &&
    !task.replica
  const needsInput =
    !!snapshot?.questions.some((q) => q.taskId === task.id) ||
    !!snapshot?.approvals.some((a) => a.taskId === task.id) ||
    !!snapshot?.secureInputs?.some((q) => q.taskId === task.id)
  useEffect(() => {
    call.sync(botCallReplies(task, call.requests()), {
      available,
      needsInput,
      error: !connected
        ? 'Connection lost. Reconnect before continuing.'
        : 'Resume this Bot and its queue before calling.',
    })
  }, [call, task, available, needsInput, connected, state.phase])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (phase) => {
      if (phase === 'background') call.end()
    })
    return () => {
      subscription.remove()
      call.end()
    }
  }, [call])
  const close = () => {
    call.end()
    onClose()
  }
  const label = state.muted
    ? 'Muted'
    : state.phase === 'waiting'
      ? 'Listening · Bot is working'
      : state.phase === 'needs-input'
        ? 'Review needed in chat'
        : state.phase === 'error'
          ? 'Call paused'
          : state.phase === 'idle'
            ? 'Ready to call'
            : state.phase === 'ended'
              ? 'Call ended'
              : state.phase[0].toUpperCase() + state.phase.slice(1)
  return (
    <Sheet title={uiText('Call {value0}', { value0: task.title })} onClose={close}>
      <View style={{ gap: 16, alignItems: 'center', paddingVertical: 24 }}>
        <BotAvatar avatar={task.bot?.avatar} name={task.title} size={96} />
        <Text style={styles.text} accessibilityLiveRegion="polite">
          {label}
        </Text>
        <Text style={styles.muted}>{task.bot?.role}</Text>
      </View>
      <View style={{ gap: 12 }}>
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Uses this Bot’s conversation and permissions, with this device’s speech service. Keep Dovo open. Continuous listening lets speech interrupt a reply. It is experimental. Use headphones if playback causes false interruptions.'
            }
          </InterfaceText>
        </Text>
        {!!state.heard && (
          <Text style={styles.text} selectable>
            <InterfaceText values={{ value0: state.heard }}>{'You: {value0}'}</InterfaceText>
          </Text>
        )}
        {!!state.reply && (
          <Text style={styles.text} selectable>
            {task.title}: {state.reply}
          </Text>
        )}
        {!snapshot?.queuePausePreservationSupported && (
          <Text style={styles.muted}>
            <InterfaceText>{'Update this Bot’s computer before calling.'}</InterfaceText>
          </Text>
        )}
        {!!state.error && (
          <Text style={styles.error} accessibilityRole="alert">
            {state.error}
          </Text>
        )}
        {state.phase === 'idle' || state.phase === 'ended' ? (
          <Action
            label={uiText('Start call')}
            disabled={!available || needsInput}
            onPress={() => call.start()}
          />
        ) : (
          <>
            <Action
              secondary
              label={state.muted ? uiText('Unmute') : uiText('Mute')}
              onPress={() => call.mute()}
            />
            {state.phase === 'speaking' && (
              <Action secondary label={uiText('Interrupt')} onPress={() => call.interrupt()} />
            )}
            {state.phase === 'error' && (
              <Action
                label={state.retrySend ? uiText('Retry same message') : uiText('Resume call')}
                disabled={!available || needsInput}
                onPress={() => call.retry()}
              />
            )}
          </>
        )}
        <Action
          secondary
          label={
            state.continuous
              ? uiText('Continuous listening on')
              : uiText('Continuous listening off')
          }
          onPress={() => call.setContinuous(!state.continuous)}
        />
        <Action label={uiText('End call')} onPress={close} />
        {needsInput && <Action secondary label={uiText('Review in chat')} onPress={close} />}
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Your messages and full replies stay in the chat. End call stops audio and keeps work already started.'
            }
          </InterfaceText>
        </Text>
      </View>
    </Sheet>
  )
}
