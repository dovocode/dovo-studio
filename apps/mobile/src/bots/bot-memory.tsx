import { requestMessageReveal } from '../tasks/conversation/message-reveal'
import { BotMemoryLearning } from './bot-memory-learning'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { runClientEffect } from '@dovo/client-runtime'
import {
  memoryListSchema,
  memoryEntrySchema,
  mutableStruct,
  responses,
  type MemoryEntry,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { createDetailDrafts, detailDraftKey, useDetailDraft } from '../runtime/state/detail-drafts'
import { Sheet } from '../ui/layout/sheet'
import { Action } from '../ui/controls/action'
import { Field } from '../ui/controls/field'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'

const drafts = createDetailDrafts<{ key: string; content: string; expectedRevision?: string }>()
export function BotMemory(props: { taskId: string; onClose: () => void }) {
  const { profile } = useRuntime()
  return (
    <BotMemoryEditor
      key={detailDraftKey(profile?.connection ?? null, 'bot-memory', props.taskId)}
      {...props}
    />
  )
}
function BotMemoryEditor({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { profile, connected: online, snapshot, callEffect } = useRuntime()
  const connected = online && snapshot?.botsSupported === true
  const { styles } = useTheme()
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [learning, setLearning] = useState(false)
  const [sources, setSources] = useState<string[]>([])
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<MemoryEntry | null | undefined>()
  const { act, busy, error } = useAction()
  const scope = { scope: 'bot' as const, botId: taskId }
  useEffect(() => {
    let current = true
    if (connected)
      act(async () => {
        const result = await runClientEffect(
          callEffect('/api/memory/list', scope, memoryListSchema),
        )
        if (current) {
          setEntries(result.entries)
          setTotal(result.total)
        }
      })
    return () => {
      current = false
    }
  }, [taskId, profile?.connection, connected, reload])
  return (
    <Sheet title="Memory" onClose={onClose} busy={busy}>
      <Text style={styles.muted}>
        Dovo memory tools keep these notes separate from other threads and child agents. A
        full-access agent on this computer can read files.
      </Text>
      {!connected && (
        <Text accessibilityRole="alert">
          Reconnect this computer or update its runtime to manage Bot memory.
        </Text>
      )}
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Action label="Retry memory" onPress={() => setReload((value) => value + 1)} />
        </>
      )}
      <Action
        secondary
        label={learning ? 'Hide background learning' : 'Background learning'}
        onPress={() => setLearning(!learning)}
      />
      {learning && (
        <BotMemoryLearning taskId={taskId} onChanged={() => setReload((value) => value + 1)} />
      )}
      <Text style={styles.muted}>
        {total} {total === 1 ? 'saved note' : 'saved notes'}
      </Text>
      <Field
        label="Search loaded notes"
        placeholder="Find a name or phrase…"
        value={query}
        onChangeText={setQuery}
      />
      {query.trim() && entries.length < total ? (
        <Text style={styles.muted}>
          Search covers {entries.length} loaded notes. Load more to search the rest.
        </Text>
      ) : null}
      <Action
        label="Add memory note"
        disabled={!connected || busy}
        onPress={() => setSelected(null)}
      />
      {!entries.length && !busy && !error && <Text style={styles.muted}>No memory notes yet.</Text>}
      {!!query.trim() &&
        !entries.some((entry) =>
          `${entry.key} ${entry.content}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        ) && <Text style={styles.muted}>No matching loaded notes.</Text>}
      {entries
        .filter((entry) =>
          `${entry.key} ${entry.content}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
        .map((entry) => (
          <View key={entry.key} style={styles.card}>
            <Text style={styles.title}>{entry.key}</Text>
            <Text style={styles.text} numberOfLines={3}>
              {entry.content}
            </Text>
            <Text style={styles.muted}>
              Updated {new Date(entry.updatedAt).toLocaleDateString()}
            </Text>
            {entry.evidence && (
              <View style={{ gap: 4 }}>
                <Action
                  secondary
                  label={`${sources.includes(entry.key) ? 'Hide' : 'Show'} sources for ${entry.key}`}
                  onPress={() =>
                    setSources((current) =>
                      current.includes(entry.key)
                        ? current.filter((key) => key !== entry.key)
                        : [...current, entry.key],
                    )
                  }
                />
                <Text style={styles.muted}>
                  {entry.evidence.sources.length} source{' '}
                  {entry.evidence.sources.length === 1 ? 'message' : 'messages'}
                </Text>
                {sources.includes(entry.key) &&
                  entry.evidence.sources.map((source) => (
                    <View key={source.messageId}>
                      <Text>{source.quote}</Text>
                      <Action
                        label="View source message"
                        secondary
                        disabled={!profile?.connection}
                        onPress={() => {
                          if (profile?.connection) {
                            requestMessageReveal(profile.connection, taskId, source.messageId)
                            onClose()
                          }
                        }}
                      />
                    </View>
                  ))}
              </View>
            )}
            <Action
              label={`Edit ${entry.key}`}
              secondary
              disabled={!connected || busy}
              onPress={() => setSelected(entry)}
            />
          </View>
        ))}
      {entries.length < total && (
        <Action
          label="Load more notes"
          disabled={!connected || busy}
          onPress={() =>
            act(async () => {
              const result = await runClientEffect(
                callEffect(
                  '/api/memory/list',
                  { ...scope, offset: entries.length },
                  memoryListSchema,
                ),
              )
              setEntries((current) => [
                ...current,
                ...result.entries.filter((entry) => !current.some((old) => old.key === entry.key)),
              ])
              setTotal(result.total)
            })
          }
        />
      )}
      {selected !== undefined && (
        <MemoryNote
          key={selected?.key ?? 'new'}
          taskId={taskId}
          note={selected ?? undefined}
          onClose={() => setSelected(undefined)}
          onSaved={() => {
            setSelected(undefined)
            setReload((value) => value + 1)
          }}
        />
      )}
    </Sheet>
  )
}
function MemoryNote({
  taskId,
  note,
  onClose,
  onSaved,
}: {
  taskId: string
  note?: MemoryEntry
  onClose: () => void
  onSaved: () => void
}) {
  const { profile, connected: online, snapshot, callEffect } = useRuntime()
  const connected = online && snapshot?.botsSupported === true
  const { styles } = useTheme()
  const { draft, setField, clear } = useDetailDraft(
    drafts,
    detailDraftKey(profile?.connection ?? null, 'bot-memory', taskId, note?.key ?? 'new'),
    () => ({
      key: note?.key ?? '',
      content: note?.content ?? '',
      expectedRevision: note?.revision,
    }),
  )
  const { act, busy, error } = useAction()
  const scope = { scope: 'bot' as const, botId: taskId, key: draft.key }
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <Sheet title={note ? 'Edit memory note' : 'New memory note'} busy={busy} onClose={onClose}>
      <Text style={styles.muted}>
        {draft.key !== (note?.key ?? '') || draft.content !== (note?.content ?? '')
          ? 'Unsaved changes · Draft kept on this device'
          : note
            ? 'Saved note'
            : 'Write a note for future replies'}
      </Text>
      <Field
        label="Note name"
        maxLength={120}
        hint={
          note
            ? 'The name stays fixed. Edit the content below.'
            : 'Use a short, clear name for this note.'
        }
        value={draft.key}
        editable={!note && connected && !busy}
        onChangeText={(value) => setField('key', value)}
      />
      <Field
        label="Note content"
        maxLength={16000}
        style={{ minHeight: 260, lineHeight: 24 }}
        hint={`${draft.content.length.toLocaleString()} / 16,000 characters`}
        value={draft.content}
        multiline
        editable={connected && !busy}
        onChangeText={(value) => setField('content', value)}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label="Save memory note"
        disabled={!connected || busy || !draft.key.trim() || !draft.content.trim()}
        onPress={() =>
          act(async () => {
            await runClientEffect(
              callEffect(
                '/api/memory/write',
                { ...scope, content: draft.content, expectedRevision: draft.expectedRevision },
                mutableStruct({ memory: memoryEntrySchema }),
              ),
            )
            clear()
            onSaved()
          })
        }
      />
      <Action secondary label="Close editor" disabled={busy} onPress={onClose} />
      <Text style={styles.muted}>Closing keeps your draft. Save applies it to this Bot.</Text>
      {confirmDelete && (
        <Action
          secondary
          label="Cancel delete"
          disabled={busy}
          onPress={() => setConfirmDelete(false)}
        />
      )}
      {note && (
        <Action
          label={confirmDelete ? 'Confirm delete note' : 'Delete memory note'}
          secondary
          disabled={!connected || busy}
          onPress={() => {
            if (!confirmDelete) {
              setConfirmDelete(true)
              return
            }
            act(async () => {
              await runClientEffect(
                callEffect(
                  '/api/memory/delete',
                  { ...scope, expectedRevision: draft.expectedRevision },
                  responses.ok,
                ),
              )
              clear()
              onSaved()
            })
          }}
        />
      )}
    </Sheet>
  )
}
