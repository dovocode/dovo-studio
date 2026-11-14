import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { requestMessageReveal } from '../tasks/conversation/message-reveal'
import { BotMemoryLearning } from './bot-memory-learning'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { runClientEffect } from '@dovo/client-runtime'
import {
  memoryListSchema,
  memoryEntrySchema,
  memoryVersionsSchema,
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

const drafts = createDetailDrafts<{
  key: string
  content: string
  expectedRevision?: string
  expiresAt: string
}>()
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
  const uiText = useInterfaceText()

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
    <Sheet title={uiText('Memory')} onClose={onClose} busy={busy}>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Dovo memory tools keep these notes separate from other threads and child agents. A full-access agent on this computer can read files.'
          }
        </InterfaceText>
      </Text>
      {!connected && (
        <Text accessibilityRole="alert">
          <InterfaceText>
            {'Reconnect this computer or update its runtime to manage Bot memory.'}
          </InterfaceText>
        </Text>
      )}
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Action label={uiText('Retry memory')} onPress={() => setReload((value) => value + 1)} />
        </>
      )}
      <Action
        secondary
        label={learning ? uiText('Hide background learning') : uiText('Background learning')}
        onPress={() => setLearning(!learning)}
      />
      {learning && (
        <BotMemoryLearning taskId={taskId} onChanged={() => setReload((value) => value + 1)} />
      )}
      <Text style={styles.muted}>
        {total} {total === 1 ? uiText('saved note') : uiText('saved notes')}
      </Text>
      <Field
        label={uiText('Search loaded notes')}
        placeholder={uiText('Find a name or phrase…')}
        value={query}
        onChangeText={setQuery}
      />
      {query.trim() && entries.length < total ? (
        <Text style={styles.muted}>
          <InterfaceText values={{ value0: entries.length }}>
            {'Search covers {value0} loaded notes. Load more to search the rest.'}
          </InterfaceText>
        </Text>
      ) : null}
      <Action
        label={uiText('Add memory note')}
        disabled={!connected || busy}
        onPress={() => setSelected(null)}
      />
      {!entries.length && !busy && !error && (
        <Text style={styles.muted}>
          <InterfaceText>{'No memory notes yet.'}</InterfaceText>
        </Text>
      )}
      {!!query.trim() &&
        !entries.some((entry) =>
          `${entry.key} ${entry.content}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        ) && (
          <Text style={styles.muted}>
            <InterfaceText>{'No matching loaded notes.'}</InterfaceText>
          </Text>
        )}
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
              <InterfaceText values={{ value0: new Date(entry.updatedAt).toLocaleDateString() }}>
                {'Updated {value0}'}
              </InterfaceText>
            </Text>
            {entry.evidence && (
              <View style={{ gap: 4 }}>
                <Action
                  secondary
                  label={uiText('{value0} sources for {value1}', {
                    value0: sources.includes(entry.key) ? 'Hide' : 'Show',
                    value1: entry.key,
                  })}
                  onPress={() =>
                    setSources((current) =>
                      current.includes(entry.key)
                        ? current.filter((key) => key !== entry.key)
                        : [...current, entry.key],
                    )
                  }
                />
                <Text style={styles.muted}>
                  <InterfaceText
                    values={{
                      value0: entry.evidence.sources.length,
                      value1:
                        entry.evidence.sources.length === 1
                          ? uiText('message')
                          : uiText('messages'),
                    }}
                  >
                    {'{value0} source {value1}'}
                  </InterfaceText>
                </Text>
                {sources.includes(entry.key) &&
                  entry.evidence.sources.map((source) => (
                    <View key={source.messageId}>
                      <Text>{source.quote}</Text>
                      <Action
                        label={uiText('View source message')}
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
              label={uiText('Edit {value0}', { value0: entry.key })}
              secondary
              disabled={!connected || busy}
              onPress={() => setSelected(entry)}
            />
          </View>
        ))}
      {entries.length < total && (
        <Action
          label={uiText('Load more notes')}
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
  const uiText = useInterfaceText()

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
      expiresAt: note?.expiresAt ?? '',
    }),
  )
  const { act, busy, error } = useAction()
  const scope = { scope: 'bot' as const, botId: taskId, key: draft.key }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [versions, setVersions] = useState<MemoryEntry[]>([])
  return (
    <Sheet
      title={note ? uiText('Edit memory note') : uiText('New memory note')}
      busy={busy}
      onClose={onClose}
    >
      <Text style={styles.muted}>
        {draft.key !== (note?.key ?? '') || draft.content !== (note?.content ?? '')
          ? uiText('Unsaved changes · Draft kept on this device')
          : note
            ? uiText('Saved note')
            : uiText('Write a note for future replies')}
      </Text>
      <Field
        label={uiText('Note name')}
        maxLength={120}
        hint={
          note
            ? uiText('The name stays fixed. Edit the content below.')
            : uiText('Use a short, clear name for this note.')
        }
        value={draft.key}
        editable={!note && connected && !busy}
        onChangeText={(value) => setField('key', value)}
      />
      <Field
        label={uiText('Note content')}
        maxLength={16000}
        style={{ minHeight: 260, lineHeight: 24 }}
        hint={uiText('{value0} / 16,000 characters', {
          value0: draft.content.length.toLocaleString(),
        })}
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
      {snapshot?.botMemoryVersionsSupported && (
        <Field
          label={uiText('Expires at (UTC, optional)')}
          placeholder="2026-12-01T12:00:00Z"
          hint={uiText('Expired notes stay here for review. Agents cannot use them.')}
          value={draft.expiresAt}
          editable={connected && !busy}
          onChangeText={(value) => setField('expiresAt', value)}
        />
      )}
      {note && snapshot?.botMemoryVersionsSupported && (
        <Action
          secondary
          label={uiText('Read previous versions')}
          disabled={!connected || busy}
          onPress={() =>
            act(async () => {
              const result = await runClientEffect(
                callEffect('/api/memory/versions', scope, memoryVersionsSchema),
              )
              setVersions(result.entries)
            })
          }
        />
      )}
      {versions.map((version) => (
        <View key={version.revision} style={{ gap: 8 }}>
          <Text style={styles.muted}>{new Date(version.updatedAt).toLocaleString()}</Text>
          <Text selectable>{version.content}</Text>
          <Action
            secondary
            label={uiText('Use this text in draft')}
            onPress={() => setField('content', version.content)}
          />
        </View>
      ))}
      <Action
        label={uiText('Save memory note')}
        disabled={!connected || busy || !draft.key.trim() || !draft.content.trim()}
        onPress={() =>
          act(async () => {
            await runClientEffect(
              callEffect(
                '/api/memory/write',
                {
                  ...scope,
                  content: draft.content,
                  expectedRevision: draft.expectedRevision,
                  ...(snapshot?.botMemoryVersionsSupported
                    ? { expiresAt: draft.expiresAt.trim() || null }
                    : {}),
                },
                mutableStruct({ memory: memoryEntrySchema }),
              ),
            )
            clear()
            onSaved()
          })
        }
      />
      <Action secondary label={uiText('Close editor')} disabled={busy} onPress={onClose} />
      <Text style={styles.muted}>
        <InterfaceText>{'Closing keeps your draft. Save applies it to this Bot.'}</InterfaceText>
      </Text>
      {confirmDelete && (
        <Action
          secondary
          label={uiText('Cancel delete')}
          disabled={busy}
          onPress={() => setConfirmDelete(false)}
        />
      )}
      {note && (
        <Action
          destructive={confirmDelete ? false : true}
          label={confirmDelete ? uiText('Confirm delete note') : uiText('Delete memory note')}
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
