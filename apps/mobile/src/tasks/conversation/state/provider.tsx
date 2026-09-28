import { useApplicationState } from '../../../runtime/state/application-state'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { AssistantRuntimeProvider } from '@assistant-ui/react-native'
import { useExternalStoreRuntime } from '@assistant-ui/core/react'
import { visiblePendingMessage, type PendingMessage, type Task } from '@dovo/protocol'
import { useConversationActions } from './use-actions'
import { useToolActivity } from './use-tool-activity'
import { conversationMessages } from './messages'
import { useKeepScreenOn } from '../../detail/keep-screen-on'
import { useMobilePreferences } from '../../../runtime/preferences/app-preferences'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { useRef } from 'react'
import { taskToolEvents, type ToolEvents } from './tool-events'
type Conversation = {
  visible: boolean
  task: Task
  actions: ReturnType<typeof useConversationActions>
  send: (mode?: 'queue' | 'steer') => void
  stop: () => void
  openCheckpoint: (turnId: string) => void
  openTerminal: (terminalId: string) => void
  legacyEvents: ToolEvents
  activityError: string
  followRequest: number
}
const Context = createContext<Conversation | null>(null)
const PendingContext = createContext<PendingMessage | null>(null)
export function useTaskConversation() {
  const value = useContext(Context)
  if (!value) throw new Error('Task conversation provider is missing')
  return value
}
export function usePendingConversationMessage() {
  return useContext(PendingContext)
}
export function ConversationProvider({
  task,
  visible,
  openCheckpoint,
  openTerminal,
  children,
}: {
  task: Task
  visible: boolean
  openCheckpoint: (turnId: string) => void
  openTerminal: (terminalId: string) => void
  children: ReactNode
}) {
  const { carMode, readRepliesAloud, speechLanguage, speechVoice } = useMobilePreferences()
  const speechAvailable =
    (Platform.OS === 'ios' || Platform.OS === 'android') &&
    !!requireOptionalNativeModule('ExpoSpeech')
  const latestTurn = task.turns?.at(-1)
  const spokenTurn = useRef(latestTurn?.status === 'completed' ? latestTurn.id : '')
  useEffect(() => {
    if (!latestTurn || latestTurn.status === 'running' || spokenTurn.current === latestTurn.id)
      return
    spokenTurn.current = latestTurn.id
    if (
      !visible ||
      !carMode ||
      !readRepliesAloud ||
      !speechAvailable ||
      latestTurn.status !== 'completed' ||
      AppState.currentState !== 'active'
    )
      return
    const reply = task.messages
      .find((message) => message.id === latestTurn.assistantId)
      ?.text.trim()
    if (!reply) return
    let active = true
    void import('expo-speech')
      .then(async (speech) => {
        if (!active) return
        await speech.stop()
        if (!active) return
        const plain = reply
          .replace(/```[\s\S]*?```/g, ' Code block. ')
          .replace(/[`*_#>]/g, '')
          .trim()
        const length = Math.max(100, Math.min(speech.maxSpeechInputLength, 2500))
        for (let at = 0; at < plain.length; at += length)
          speech.speak(plain.slice(at, at + length), {
            ...(speechLanguage ? { language: speechLanguage } : {}),
            ...(speechVoice ? { voice: speechVoice } : {}),
          })
      })
      .catch((error: unknown) => console.error('Could not read reply aloud', error))
    return () => {
      active = false
      void import('expo-speech').then((speech) => speech.stop())
    }
  }, [latestTurn?.id, latestTurn?.status, visible, carMode, readRepliesAloud, speechAvailable, speechLanguage, speechVoice])
  const actions = useConversationActions(task)
  const [followRequest, setFollowRequest] = useApplicationState(0)
  const { active: dictating, stop: finishDictation } = actions.dictation
  const answeringQuestion = actions.snapshot?.questions.some(
    (question) => question.taskId === task.id && question.prompt.blocking !== false,
  )
  useKeepScreenOn(task.id, visible && task.status === 'running')
  useEffect(() => {
    if ((!visible || answeringQuestion || task.archived) && dictating) finishDictation()
  }, [visible, answeringQuestion, task.archived, dictating, finishDictation])
  const activity = useToolActivity(task.id, visible, task.status === 'running')
  const pendingMessage = useMemo(
    () => visiblePendingMessage(task, actions.pendingMessage),
    [task.id, task.messages, task.queue, actions.pendingMessage],
  )
  const messages = useMemo(() => {
    const displayed = pendingMessage
      ? { ...task, messages: [...task.messages, pendingMessage.message] }
      : task
    return conversationMessages(displayed, activity.events)
  }, [task, activity.events, pendingMessage])
  const legacyEvents = useMemo(() => {
    const messageIds = new Set(task.messages.map((message) => message.id))
    const visibleTurns = new Set(
      task.turns?.filter((turn) => messageIds.has(turn.assistantId)).map((turn) => turn.id),
    )
    return taskToolEvents(task, activity.events).filter(
      (event) => !event.turnId || !visibleTurns.has(event.turnId),
    )
  }, [activity.events, task.id, task.status, task.turns, task.messages])
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
        openTerminal,
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
      <PendingContext.Provider value={pendingMessage}>
        <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
      </PendingContext.Provider>
    </Context.Provider>
  )
}
