import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import {
  nativeThreadPageSchema,
  subagentMetadata,
  type NativeThreadPage,
  type Subagent,
} from '@dovo/protocol'
import { ScreenHeader } from '../../ui/layout/screen-header'
import { Text } from '../../ui/content/text'
import { Markdown } from '../../ui/content/markdown'
import { Action } from '../../ui/controls/action'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../../ui/theme'

export function NativeAgentThread({
  taskId,
  agent,
  onClose,
  parentTitle,
}: {
  taskId: string
  agent: Subagent
  onClose: () => void
  parentTitle?: string
}) {
  const { connected, call } = useRuntime()
  const { colors, styles } = useTheme()
  const [page, setPage] = useState<NativeThreadPage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [load, setLoad] = useState<{ before?: string; revision: number }>({ revision: 0 })
  useEffect(() => {
    let active = true
    if (!connected) {
      setBusy(false)
      return
    }
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
    <View style={{ flex: 1 }} accessibilityLabel="Native agent thread">
      <ScreenHeader
        title={agent.name}
        leading={<Action secondary label="Back to agents" onPress={onClose} />}
        buttons={[
          {
            label: 'Refresh thread',
            icon: 'refresh',
            disabled: !connected || busy,
            onPress: () => setLoad(({ revision }) => ({ revision: revision + 1 })),
          },
        ]}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        accessibilityLabel="Native agent thread"
      >
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
            style={
              entry.role === 'user'
                ? {
                    alignSelf: 'flex-end',
                    maxWidth: '88%',
                    paddingHorizontal: 13,
                    paddingVertical: 9,
                    borderRadius: 18,
                    backgroundColor: colors.elevated,
                  }
                : { gap: 5 }
            }
          >
            {entry.role === 'tool' || entry.role === 'reasoning' ? (
              <>
                <Text style={styles.muted}>
                  {entry.label || (entry.role === 'reasoning' ? 'Reasoning' : 'Tool')}
                </Text>
                <Text
                  selectable
                  style={{ color: colors.muted, fontFamily: 'monospace', fontSize: 13 }}
                >
                  {entry.text}
                </Text>
              </>
            ) : (
              <Markdown text={entry.text} taskId={taskId} />
            )}
          </View>
        ))}
        {page && !page.entries.length && (
          <Text style={styles.muted}>No conversation messages are available.</Text>
        )}
      </ScrollView>
      <Text
        style={[styles.muted, { padding: 16, borderTopWidth: 0.5, borderTopColor: colors.border }]}
      >
        {parentTitle && `${parentTitle} · `}
        {subagentMetadata(agent) || agent.provider} · {agent.status} · Read only
      </Text>
    </View>
  )
}
