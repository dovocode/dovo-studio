import { useEffect, useRef } from 'react'
import { ActivityIndicator, Keyboard, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { randomUUID } from 'expo-crypto'
import { Effect } from 'effect'
import {
  DO_CHAT_LIMITS,
  SCRATCH_PROJECT_ID,
  doChatCreateReplySchema,
  resolveScopedAgents,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { useApplicationState } from '../runtime/state/application-state'
import { taskHref } from '../shell/task-route'
import { Text } from '../ui/content/text'
import { Choice } from '../ui/controls/choice'
import { IconButton } from '../ui/controls/icon-button'
import { useAction } from '../ui/controls/use-action'
import { Sheet } from '../ui/layout/sheet'
import { useTheme } from '../ui/theme'
import { doChatAttempt, type DoChatAttempt } from './chat-attempt'

export function DoChatComposer({ active }: { active: boolean }) {
  const { colors, styles } = useTheme()
  const { connected, snapshot, profile, callEffect } = useRuntime()
  const { busy, error, act } = useAction()
  const [text, setText] = useApplicationState('')
  const [repositoryId, setRepositoryId] = useApplicationState('')
  const [agentId, setAgentId] = useApplicationState('')
  const [options, setOptions] = useApplicationState(false)
  const attempt = useRef<DoChatAttempt | null>(null)
  const alive = useRef(true)
  const writable = useRef(false)
  const repositories =
    snapshot?.workspace.repositories.filter(
      (repository) => repository.kind !== 'scratch' && repository.id !== SCRATCH_PROJECT_ID,
    ) ?? []
  const repository = repositories.find((repository) => repository.id === repositoryId)
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    repositoryId
      ? repository
      : snapshot?.workspace.repositories.find(
          (repository) => repository.kind === 'scratch' || repository.id === SCRATCH_PROJECT_ID,
        ),
    snapshot?.workspace.agents ?? [],
  )
  const agent = agents.find((agent) => agent.id === agentId)
  const stale = (!!repositoryId && !repository) || (!!agentId && !agent)
  const disabled = !active || !connected || !snapshot?.doEnabled || busy || stale
  writable.current = active && connected && snapshot?.doEnabled === true && !stale && !!profile
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const send = () => {
    if (disabled || !profile || !text.trim()) return
    const runtimeId = profile.id
    act(() => {
      if (!alive.current || !writable.current) return Effect.void
      const pending = doChatAttempt(
        attempt.current,
        runtimeId,
        {
          text: text.trim(),
          ...(repositoryId ? { repositoryId } : {}),
          ...(agentId ? { agentId } : {}),
        },
        randomUUID,
      )
      attempt.current = pending
      return callEffect('/api/do/chat/create', pending.input, doChatCreateReplySchema).pipe(
        Effect.tap(({ taskId }) =>
          Effect.sync(() => {
            if (!alive.current || !writable.current) return
            // A hidden composer retains its request ID so returning and retrying is safe.
            Keyboard.dismiss()
            setText('')
            attempt.current = null
            router.push(taskHref(runtimeId, taskId))
          }),
        ),
      )
    })
  }
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={styles.largeTitle}>
          What would you like to do?
        </Text>
        <Text style={styles.muted}>
          Talk it through with your agent. Review any proposed plan before choosing Start.
        </Text>
      </View>
      <View style={[styles.card, { borderRadius: 24, padding: 12, gap: 12 }]}>
        <TextInput
          testID="Do message"
          accessibilityLabel="Do message"
          placeholder="Describe your goal…"
          placeholderTextColor={colors.muted}
          selectionColor={colors.accent}
          multiline
          maxLength={DO_CHAT_LIMITS.message}
          editable={!busy}
          value={text}
          onChangeText={setText}
          style={{
            minHeight: 120,
            maxHeight: 280,
            padding: 8,
            textAlignVertical: 'top',
            color: colors.text,
            fontSize: 17,
            lineHeight: 25,
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconButton
            label="Chat options"
            icon="settings"
            disabled={busy}
            onPress={() => setOptions(true)}
          />
          <Text style={[styles.muted, { flex: 1 }]}>
            {repositoryId ? (repository?.name ?? 'Unavailable project') : 'No project'}
            {agentId ? ` · ${agent?.name ?? 'Unavailable agent'}` : ''}
          </Text>
          {busy ? (
            <ActivityIndicator accessibilityLabel="Sending goal" color={colors.muted} />
          ) : null}
          <IconButton
            label="Send"
            icon="send"
            variant="filled"
            disabled={disabled || !text.trim()}
            onPress={send}
          />
        </View>
      </View>
      {!connected && (
        <Text accessibilityRole="alert" style={styles.muted}>
          This computer is offline. Your message stays here; reconnect to send it.
        </Text>
      )}
      {stale && (
        <Text accessibilityRole="alert" style={styles.error}>
          The selected project or agent is no longer available. Update Chat options before sending.
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {options && active && (
        <Sheet title="Chat options" onClose={() => setOptions(false)}>
          <Choice
            label="Project (optional)"
            value={repositoryId}
            selectedLabel={
              repositoryId ? (repository?.name ?? 'Unavailable project') : 'No project'
            }
            disabled={busy}
            items={[
              { id: '', name: 'No project' },
              ...repositories.map(({ id, name }) => ({ id, name })),
            ]}
            onChange={(id) => {
              setRepositoryId(id)
              setAgentId('')
            }}
          />
          <Choice
            label="Agent (optional)"
            value={agentId}
            selectedLabel={agentId ? (agent?.name ?? 'Unavailable agent') : 'Default agent'}
            disabled={busy || (!!repositoryId && !repository)}
            items={[
              { id: '', name: 'Default agent' },
              ...agents.map(({ id, name }) => ({ id, name })),
            ]}
            onChange={setAgentId}
          />
          <Text style={styles.muted}>
            These choose the conversation’s context. Your agent can propose work across other
            projects and computers.
          </Text>
        </Sheet>
      )}
    </View>
  )
}
