import { useApplicationState } from '../../runtime/state/application-state'
import { openAppLink } from '../../ui/content/open-link'
import { Pressable, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  fixChecksPrompt,
  pullStatusLabel,
  pullStackLabel,
  responses,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Icon } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { colors } from '../../ui/theme'

/** The task's pull request state and checks; failing checks can be handed to the agent. */
function PrimaryPullStatus({ task }: { task: Task }) {
  const { connected, callEffect } = useRuntime()
  const { act, busy, error } = useAction()
  const status = task.pullStatus
  if (!status) return null
  const failing = status.state === 'open' && status.checks === 'failed'
  const color =
    status.state === 'merged'
      ? '#c4b5fd'
      : status.state === 'closed' || failing
        ? colors.error
        : status.checks === 'passed'
          ? colors.success
          : colors.muted
  return (
    <View style={{ paddingHorizontal: 16, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${pullStatusLabel(status)}. Opens the pull request.`}
          onPress={() => void openAppLink(status.url).catch(() => undefined)}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            opacity: pressed ? 0.55 : 1,
          })}
        >
          <Icon name={status.stack ? 'stack' : 'pulls'} size={14} color={color} />
          <Text numberOfLines={1} style={{ color, fontSize: 13, flexShrink: 1 }}>
            {pullStatusLabel(status)}
            {status.stack ? ` · ${pullStackLabel(status.stack)}` : ''}
          </Text>
        </Pressable>
        {failing && task.status !== 'running' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask the agent to fix the failing checks"
            disabled={!connected || busy}
            onPress={() =>
              act(() =>
                callEffect(
                  '/api/tasks/message',
                  { id: task.id, messageId: randomUUID(), text: fixChecksPrompt(status) },
                  responses.ok,
                ),
              )
            }
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 14,
              backgroundColor: colors.elevated,
              opacity: pressed || !connected || busy ? 0.55 : 1,
            })}
          >
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Fix checks</Text>
          </Pressable>
        )}
      </View>
      {!!status.failedChecks?.length && failing && (
        <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12 }}>
          Failing: {status.failedChecks.join(', ')}
        </Text>
      )}
      {!!error && <Text style={{ color: colors.error, fontSize: 12 }}>{error}</Text>}
    </View>
  )
}

export function PullStatus({ task }: { task: Task }) {
  const [expanded, setExpanded] = useApplicationState(false)
  const [linkError, setLinkError] = useApplicationState('')
  const links = (task.linkedPullRequests ?? []).filter(
    (pull) => pull.url !== task.pullStatus?.url && pull.url !== task.pullRequest?.url,
  )
  if (!task.pullStatus && !links.length) return null
  return (
    <View style={{ gap: 4 }}>
      <PrimaryPullStatus task={task} />
      {!!links.length && (
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(!expanded)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 }}
          >
            <Icon name="pulls" size={14} color={colors.muted} />
            <Text style={{ color: colors.muted, fontSize: 13 }}>Linked PRs ({links.length})</Text>
          </Pressable>
          {expanded &&
            links.map((pull) => (
              <Pressable
                key={pull.url}
                accessibilityRole="link"
                accessibilityLabel={`Open PR #${pull.number}: ${pull.title}`}
                onPress={() => {
                  setLinkError('')
                  void openAppLink(pull.url).catch((error) => setLinkError(String(error)))
                }}
                style={{ minHeight: 36, justifyContent: 'center' }}
              >
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13 }}>
                  #{pull.number} · {pull.title}
                </Text>
              </Pressable>
            ))}
          {!!linkError && <Text style={{ color: colors.error, fontSize: 12 }}>{linkError}</Text>}
        </View>
      )}
    </View>
  )
}
