import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { AgentSideChats } from './agent-side-chats'
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
type SideQuestionProps = {
  task: Task
  selectedChatId?: string
  onClose: () => void
  drafts: Record<string, string>
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>
}
export function SideQuestion(props: SideQuestionProps) {
  const [readOnly, setReadOnly] = useState(!!props.selectedChatId)
  useEffect(() => {
    if (props.selectedChatId) setReadOnly(true)
  }, [props.selectedChatId])
  return readOnly ? (
    <ReadOnlySideQuestion {...props} onAgents={() => setReadOnly(false)} />
  ) : (
    <AgentSideChats
      task={props.task}
      onClose={props.onClose}
      onReadOnly={() => setReadOnly(true)}
    />
  )
}
function ReadOnlySideQuestion({
  task,
  onClose,
  drafts,
  setDrafts,
  selectedChatId,
  onAgents,
}: {
  task: Task
  selectedChatId?: string
  onClose: () => void
  drafts: Record<string, string>
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>
  onAgents: () => void
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { connected, call, callEffect } = useRuntime()
  const { actions } = useTaskConversation()
  const { act, busy, error } = useAction()
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [askErrors, setAskErrors] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [selection, setSelection] = useState({ id: selectedChatId ?? '', request: selectedChatId })
  const selected =
    selectedChatId && selectedChatId !== selection.request ? selectedChatId : selection.id
  useEffect(() => {
    if (selectedChatId && selectedChatId !== selection.request)
      setSelection({ id: selectedChatId, request: selectedChatId })
  }, [selectedChatId, selection.request])
  const selectChat = (id: string) => setSelection({ id, request: selectedChatId })
  const pendingRequests = useRef(new Set<string>())
  const chats = task.sideChats ?? []
  const seenChatIds = useRef(new Set<string>())
  useEffect(() => {
    for (const item of chats) seenChatIds.current.add(item.id)
  }, [task.sideChats])
  const selectedChat = chats.find((item) => item.id === selected)
  const awaitingChat = !!selected && !selectedChat && !seenChatIds.current.has(selected)
  const chat = selectedChat ?? (awaitingChat ? undefined : chats[0])
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
      title={uiText('Read-only chat')}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {chat && (
            <>
              <Field
                label={uiText('Question')}
                value={question}
                onChangeText={(value) => setDrafts((current) => ({ ...current, [chat.id]: value }))}
                multiline
                autoCapitalize="sentences"
                maxLength={4000}
                editable={!disabled && !asking}
              />
              <Action
                label={pending[chat.id] ? uiText('Asking…') : uiText('Ask')}
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
                label={uiText('Save draft')}
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
      <Action secondary label={uiText('Agent side chats')} onPress={onAgents} />
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Ask about this thread and its checkout without changing files. Your coding agent keeps working.'
          }
        </InterfaceText>
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {!!chats.length && (
          <Choice
            label={uiText('Side chat')}
            hideLabel
            compact
            value={chat?.id ?? ''}
            items={chats.map((item) => ({ id: item.id, name: item.title }))}
            onChange={selectChat}
          />
        )}
        <Action
          label={uiText('New read-only chat')}
          disabled={disabled}
          onPress={() =>
            act(() =>
              callEffect('/api/tasks/side-chat/save', { id: task.id }, savedSchema).pipe(
                Effect.tap((result) => Effect.sync(() => selectChat(result.id))),
              ),
            )
          }
        />
      </View>
      {awaitingChat && (
        <Text style={styles.muted}>
          <InterfaceText>{'Loading side chat…'}</InterfaceText>
        </Text>
      )}
      {chat && (
        <Action
          secondary
          label={uiText('Rename side chat')}
          disabled={disabled}
          onPress={() => {
            setTitle(chat.title)
            setRenaming(true)
          }}
        />
      )}
      {chat && (
        <Action
          destructive
          secondary
          label={uiText('Delete side chat')}
          disabled={disabled}
          onPress={() =>
            Alert.alert(
              uiText('Delete this side chat?'),
              uiText('Its saved questions and answers will be removed.'),
              [
                { text: uiText('Cancel'), style: 'cancel' },
                {
                  text: uiText('Delete'),
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
          <Field
            label={uiText('Side chat name')}
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />
          <Action
            label={uiText('Save name')}
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
          <Action secondary label={uiText('Cancel')} onPress={() => setRenaming(false)} />
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
          <Action
            secondary
            label={uiText('Add question to thread')}
            onPress={() => add(entry.question)}
          />
          {entry.answer && (
            <>
              <ThreadMarkdown taskId={task.id} text={entry.answer} variant="chat" />
              <Action
                secondary
                label={uiText('Add answer to thread')}
                onPress={() => add(entry.answer ?? '')}
              />
            </>
          )}
          {entry.status === 'pending' && (
            <Text style={styles.muted}>
              <InterfaceText>{'Asking…'}</InterfaceText>
            </Text>
          )}
          {entry.error && <Text style={styles.error}>{entry.error}</Text>}
        </View>
      ))}
      {!!(error || (chat && askErrors[chat.id])) && (
        <Text style={styles.error}>{error || (chat && askErrors[chat.id])}</Text>
      )}
    </Sheet>
  )
}
