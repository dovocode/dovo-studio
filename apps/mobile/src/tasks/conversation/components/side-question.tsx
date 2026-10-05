import { useState } from 'react'
import { Alert, View } from 'react-native'
import { Effect, Schema } from 'effect'
import { mutableStruct, type Task } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useAction } from '../../../ui/controls/use-action'
import { Action } from '../../../ui/controls/action'
import { Field } from '../../../ui/controls/field'
import { ThreadMarkdown } from './thread-markdown'
import { Sheet } from '../../../ui/layout/sheet'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { useTaskConversation } from '../state/provider'
const savedSchema = mutableStruct({ id: Schema.String })
const answerSchema = mutableStruct({ answer: Schema.String })
export function SideQuestion({ task, onClose }: { task: Task; onClose: () => void }) {
  const { styles } = useTheme()

  const { connected, call, callEffect } = useRuntime()
  const { actions } = useTaskConversation()
  const { act, busy, error } = useAction()
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [askError, setAskError] = useState('')
  const [selected, setSelected] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const chats = task.sideChats ?? []
  const chat = chats.find((item) => item.id === selected) ?? chats[0]
  const asking =
    !!chat && (!!pending[chat.id] || chat.messages.some((item) => item.status === 'pending'))
  const question = chat ? (drafts[chat.id] ?? chat.draft) : ''
  const disabled = !connected || !!task.archived || busy
  const add = (text: string) => {
    actions.draft.update([actions.draft.text.trimEnd(), text].filter(Boolean).join('\n\n'))
    onClose()
  }
  return (
    <Sheet title="Side chats" onClose={onClose} busy={busy}>
      <Text style={styles.muted}>Saved with this thread. Ask without interrupting its agent.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {chats.map((item) => (
          <Action
            key={item.id}
            secondary={item.id !== chat?.id}
            label={item.title}
            onPress={() => setSelected(item.id)}
          />
        ))}
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
      {chat?.messages.map((entry) => (
        <View key={entry.id} style={[styles.card, { gap: 6 }]}>
          <Text style={[styles.muted, { fontWeight: '600' }]}>{entry.question}</Text>
          <Action secondary label="Add question to composer" onPress={() => add(entry.question)} />
          {entry.answer && (
            <>
              <ThreadMarkdown text={entry.answer} variant="chat" />
              <Action
                secondary
                label="Add answer to composer"
                onPress={() => add(entry.answer ?? '')}
              />
            </>
          )}
          {entry.status === 'pending' && <Text style={styles.muted}>Asking…</Text>}
          {entry.error && <Text style={styles.error}>{entry.error}</Text>}
        </View>
      ))}
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
              if (pending[chat.id]) return
              setPending((current) => ({ ...current, [chat.id]: true }))
              setAskError('')
              void call(
                '/api/tasks/side-chat/ask',
                { id: task.id, chatId: chat.id, question },
                answerSchema,
              )
                .then(() => setDrafts((current) => ({ ...current, [chat.id]: '' })))
                .catch((cause: unknown) =>
                  setAskError(cause instanceof Error ? cause.message : String(cause)),
                )
                .finally(() => setPending((current) => ({ ...current, [chat.id]: false })))
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
        </>
      )}
      {!!(error || askError) && <Text style={styles.error}>{error || askError}</Text>}
    </Sheet>
  )
}
