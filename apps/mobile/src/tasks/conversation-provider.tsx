import { useApplicationState } from '../runtime/application-state'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { AssistantRuntimeProvider } from '@assistant-ui/react-native'
import { useExternalStoreRuntime } from '@assistant-ui/core/react'
import { type Task } from '@dovo/protocol'
import { useConversationActions } from './use-conversation-actions'
import { useToolActivity } from './use-tool-activity'
import { conversationMessages } from './conversation-messages'
import { taskToolEvents, type ToolEvents } from './task-tool-events'
type Conversation = {
  visible: boolean
  task: Task
  actions: ReturnType<typeof useConversationActions>
  send: (mode?: 'queue' | 'steer') => void
  stop: () => void
  openCheckpoint: (turnId: string) => void
  legacyEvents: ToolEvents
  activityError: string
  followRequest: number
}
const Context = createContext<Conversation | null>(null)
export function useTaskConversation() {
  const value = useContext(Context)
  if (!value) throw new Error('Task conversation provider is missing')
  return value
}
export function ConversationProvider({
  task,
  visible,
  openCheckpoint,
  children,
}: {
  task: Task
  visible: boolean
  openCheckpoint: (turnId: string) => void
  children: ReactNode
}) {
  const actions = useConversationActions(task)
  const [followRequest, setFollowRequest] = useApplicationState(0)
  const { active: dictating, stop: finishDictation } = actions.dictation
  const answeringQuestion = actions.snapshot?.questions.some(
    (question) => question.taskId === task.id && question.prompt.blocking !== false,
  )
  useEffect(() => {
    if ((!visible || answeringQuestion || task.archived) && dictating) finishDictation()
  }, [visible, answeringQuestion, task.archived, dictating, finishDictation])
  const activity = useToolActivity(task.id, visible, task.status === 'running')
  const messages = useMemo(
    () => conversationMessages(task, activity.events),
    [task, activity.events],
  )
  const legacyEvents = useMemo(
    () =>
      taskToolEvents(task, activity.events).filter(
        (event) =>
          !task.turns?.some(
            (turn) =>
              turn.id === event.turnId &&
              task.messages.some((message) => message.id === turn.assistantId),
          ),
      ),
    [activity.events, task.id, task.status, task.turns, task.messages],
  )
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isRunning: task.status === 'running',
    isDisabled: !actions.connected || !!task.archived || !!task.example,
    onNew: async (message) => {
      if (!actions.canSend) return
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      await actions.run(() =>
        actions.submit(message.runConfig?.custom?.mode === 'steer' ? 'steer' : 'queue', text),
      )
    },
    onCancel: async () => {
      await actions.stop()
    },
  })
  return (
    <Context.Provider
      value={{
        task,
        visible,
        actions,
        openCheckpoint,
        legacyEvents,
        activityError: activity.error,
        followRequest,
        send: (mode = 'queue') => {
          if (actions.canSend) {
            // Only a local Send/Queue/Steer asks to leave a manually scrolled position.
            // Remote messages and queued turns arriving later must not move the reader.
            setFollowRequest((revision) => revision + 1)
            runtime.thread.append({
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: actions.draft.text,
                },
              ],
              runConfig: {
                custom: {
                  mode,
                },
              },
            })
          }
        },
        stop: () => runtime.thread.cancelRun(),
      }}
    >
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </Context.Provider>
  )
}
