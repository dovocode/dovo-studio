import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Alert, View } from 'react-native'
import { Effect, Schema } from 'effect'
import { mutableStruct, type Task } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useAction } from '../../../ui/controls/use-action'
import { Action } from '../../../ui/controls/action'
import { Choice } from '../../../ui/controls/choice'
import { Field } from '../../../ui/controls/field'
import { ThreadMarkdown } from './thread-markdown'
import { Sheet } from '../../../ui/layout/sheet'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { useTaskConversation } from '../state/provider'
const savedSchema = mutableStruct({ id: Schema.String })
const answerSchema = mutableStruct({ answer: Schema.String })
export function SideQuestion({
  task,
  onClose,
  drafts,
  setDrafts,
}: {
  task: Task
  onClose: () => void
  drafts: Record<string, string>
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>
}) {
  const { styles } = useTheme()

  const { connected, call, callEffect } = useRuntime()
  const { actions } = useTaskConversation()
  const { act, busy, error } = useAction()
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [askErrors, setAskErrors] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [selected, setSelected] = useState('')
  const pendingRequests = useRef(new Set<string>())
  const chats = task.sideChats ?? []
  const chat = chats.find((item) => item.id === selected) ?? chats[0]
  const asking =
    !!chat && (!!pending[chat.id] || chat.messages.some((item) => item.status === 'pending'))
  const question = chat ? (drafts[chat.id] ?? chat.draft) : ''
  useEffect(() => {
    setDrafts((current) => {
      const acknowledged = chats.filter((item) => current[item.id] === item.draft)
      if (!acknowledged.length) return current
      const next = { ...current }
      for (const item of acknowledged) delete next[item.id]
      return next
    })
  }, [task.sideChats, setDrafts])
  const disabled = !connected || !!task.archived || !!task.archivedAt || busy
  const add = (text: string) => {
    actions.draft.update([actions.draft.text.trimEnd(), text].filter(Boolean).join('\n\n'))
    onClose()
  }
  return (
    <Sheet
      title="Side chats"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {chat && (
            <>
              <Field
                label="Question"
                value={question}
                onChangeText={(value) => setDrafts((current) => ({ ...current, [chat.id]: value }))}
                multiline
                autoCapitalize="sentences"
                maxLength={4000}
                editable={!disabled && !asking}
              />
              <Action
                label={pending[chat.id] ? 'Asking…' : 'Ask'}
                disabled={
                  disabled ||
                  !!pending[chat.id] ||
                  !question.trim() ||
                  chat.messages.some((item) => item.status === 'pending')
                }
                onPress={() => {
                  if (pendingRequests.current.has(chat.id)) return
                  pendingRequests.current.add(chat.id)
                  setPending((current) => ({ ...current, [chat.id]: true }))
                  setAskErrors((current) => ({ ...current, [chat.id]: '' }))
                  void call(
                    '/api/tasks/side-chat/ask',
                    { id: task.id, chatId: chat.id, question },
                    answerSchema,
                  )
                    .then(() => setDrafts((current) => ({ ...current, [chat.id]: '' })))
                    .catch((cause: unknown) =>
                      setAskErrors((current) => ({
                        ...current,
                        [chat.id]: cause instanceof Error ? cause.message : String(cause),
                      })),
                    )
                    .finally(() => {
                      pendingRequests.current.delete(chat.id)
                      setPending((current) => ({ ...current, [chat.id]: false }))
                    })
                }}
              />
              <Action
                secondary
                label="Save draft"
                disabled={disabled || asking}
                onPress={() =>
                  act(() =>
                    callEffect(
                      '/api/tasks/side-chat/save',
                      { id: task.id, chatId: chat.id, draft: question },
                      savedSchema,
                    ),
                  )
                }
              />
            </>
          )}
        </>
      }
    >
      <Text style={styles.muted}>Saved with this thread. Ask without interrupting its agent.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {!!chats.length && (
          <Choice
            label="Side chat"
            hideLabel
            compact
            value={chat?.id ?? ''}
            items={chats.map((item) => ({ id: item.id, name: item.title }))}
            onChange={setSelected}
          />
        )}
        <Action
          label="New side chat"
          disabled={disabled}
          onPress={() =>
            act(() =>
              callEffect('/api/tasks/side-chat/save', { id: task.id }, savedSchema).pipe(
                Effect.tap((result) => Effect.sync(() => setSelected(result.id))),
              ),
            )
          }
        />
      </View>
      {chat && (
        <Action
          secondary
          label="Rename side chat"
          disabled={disabled}
          onPress={() => {
            setTitle(chat.title)
            setRenaming(true)
          }}
        />
      )}
      {chat && (
        <Action
          secondary
          label="Delete side chat"
          disabled={disabled}
          onPress={() =>
            Alert.alert(
              'Delete this side chat?',
              'Its saved questions and answers will be removed.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () =>
                    act(() =>
                      callEffect(
                        '/api/tasks/side-chat/save',
                        { id: task.id, chatId: chat.id, remove: true },
                        savedSchema,
                      ),
                    ),
                },
              ],
            )
          }
        />
      )}
      {chat && renaming && (
        <View style={{ gap: 8 }}>
          <Field label="Side chat name" value={title} onChangeText={setTitle} maxLength={80} />
          <Action
            label="Save name"
            disabled={disabled || !title.trim()}
            onPress={() =>
              act(() =>
                callEffect(
                  '/api/tasks/side-chat/save',
                  { id: task.id, chatId: chat.id, title: title.trim() },
                  savedSchema,
                ).pipe(Effect.tap(() => Effect.sync(() => setRenaming(false)))),
              )
            }
          />
          <Action secondary label="Cancel" onPress={() => setRenaming(false)} />
        </View>
      )}
      {chat?.messages.map((entry) => (
        <View key={entry.id} style={{ gap: 8, paddingVertical: 12 }}>
          <Text
            style={[
              styles.card,
              { alignSelf: 'flex-end', padding: 12, borderRadius: 16, fontWeight: '600' },
            ]}
          >
            {entry.question}
          </Text>
          <Action secondary label="Add question to thread" onPress={() => add(entry.question)} />
          {entry.answer && (
            <>
              <ThreadMarkdown text={entry.answer} variant="chat" />
              <Action
                secondary
                label="Add answer to thread"
                onPress={() => add(entry.answer ?? '')}
              />
            </>
          )}
          {entry.status === 'pending' && <Text style={styles.muted}>Asking…</Text>}
          {entry.error && <Text style={styles.error}>{entry.error}</Text>}
        </View>
      ))}
      {!!(error || (chat && askErrors[chat.id])) && (
        <Text style={styles.error}>{error || (chat && askErrors[chat.id])}</Text>
      )}
    </Sheet>
  )
}
