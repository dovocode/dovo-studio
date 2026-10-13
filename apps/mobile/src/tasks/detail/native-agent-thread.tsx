import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import {
  nativeThreadPageSchema,
  subagentMetadata,
  type NativeThreadPage,
  type Subagent,
} from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { Markdown } from '../../ui/content/markdown'
import { Action } from '../../ui/controls/action'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../../ui/theme'

export function NativeAgentThread({
  taskId,
  agent,
  onClose,
}: {
  taskId: string
  agent: Subagent
  onClose: () => void
}) {
  const { connected, call } = useRuntime()
  const { colors, styles } = useTheme()
  const [page, setPage] = useState<NativeThreadPage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [load, setLoad] = useState<{ before?: string; revision: number }>({ revision: 0 })
  useEffect(() => {
    let active = true
    if (!connected) return
    setBusy(true)
    setError('')
    void call(
      '/api/tasks/native-thread',
      {
        taskId,
        id: agent.id,
        provider: agent.provider,
        sessionId: agent.sessionId,
        before: load.before,
      },
      nativeThreadPageSchema,
    ).then(
      (next) => {
        if (!active) return
        setPage((previous) => {
          if (!load.before || !previous) return next
          const ids = new Set(next.entries.map((entry) => entry.id))
          return {
            ...next,
            entries: [...next.entries, ...previous.entries.filter((entry) => !ids.has(entry.id))],
          }
        })
        setBusy(false)
      },
      (error: unknown) => {
        if (!active) return
        setError(error instanceof Error ? error.message : String(error))
        setBusy(false)
      },
    )
    return () => {
      active = false
    }
  }, [call, connected, taskId, agent.id, agent.provider, agent.sessionId, load])
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      accessibilityLabel="Native agent thread"
    >
      <Action secondary label="Back to agents" onPress={onClose} />
      <Text style={{ fontSize: 18, fontWeight: '600' }}>{agent.name}</Text>
      <Text style={styles.muted}>
        {subagentMetadata(agent) || agent.provider} · {agent.status} · Read only
      </Text>
      <Action
        secondary
        label="Refresh thread"
        disabled={!connected || busy}
        onPress={() => setLoad(({ revision }) => ({ revision: revision + 1 }))}
      />
      {!connected && <Text style={styles.muted}>Reconnect to load this native thread.</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
      {!!page?.notice && <Text style={styles.muted}>{page.notice}</Text>}
      {!!page?.before && (
        <Action
          secondary
          label="Load older messages"
          disabled={!connected || busy}
          onPress={() =>
            setLoad(({ revision }) => ({ before: page.before, revision: revision + 1 }))
          }
        />
      )}
      {busy && <Text style={styles.muted}>Loading thread…</Text>}
      {page?.entries.map((entry) => (
        <View
          key={entry.id}
          style={{
            borderWidth: 0.5,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 12,
            gap: 8,
          }}
        >
          <Text style={[styles.muted, { fontSize: 11 }]}>
            {entry.label ||
              (entry.role === 'user'
                ? 'Prompt'
                : entry.role === 'assistant'
                  ? 'Assistant'
                  : entry.role === 'reasoning'
                    ? 'Reasoning'
                    : 'Tool')}
          </Text>
          {entry.role === 'assistant' ? (
            <Markdown text={entry.text} taskId={taskId} />
          ) : (
            <Text selectable style={{ fontSize: 13 }}>
              {entry.text}
            </Text>
          )}
        </View>
      ))}
      {page && !page.entries.length && (
        <Text style={styles.muted}>No conversation messages are available.</Text>
      )}
    </ScrollView>
  )
}
