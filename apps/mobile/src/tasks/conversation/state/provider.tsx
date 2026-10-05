import { useConversationHistory } from './use-conversation-history'
import { visibleMobileSend } from '../../composer/pending-send'
import { useApplicationState } from '../../../runtime/state/application-state'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { RegistryContext, useAtomValue } from '@effect-atom/atom-react'
import { applicationState } from '@dovo/client-runtime'
import { AssistantRuntimeProvider } from '@assistant-ui/react-native'
import { useExternalStoreRuntime } from '@assistant-ui/core/react'
import {
  startingConversationMessage,
  conversationPresentation,
  type PendingMessage,
  type Task,
} from '@dovo/protocol'
import { useConversationActions } from './use-actions'
import { useToolActivity } from './use-tool-activity'
import { createConversationMessages, convertConversationMessage } from './messages'
import { useKeepScreenOn } from '../../detail/keep-screen-on'
import { useMobilePreferences } from '../../../runtime/preferences/app-preferences'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { useRef } from 'react'
import { taskToolEvents, type ToolEvents } from './tool-events'
type Conversation = {
  visible: boolean
  history: ReturnType<typeof useConversationHistory<Task>>
  task: Task
  presentation: ReturnType<typeof conversationPresentation>
  actions: ReturnType<typeof useConversationActions>
  send: (mode?: 'queue' | 'steer') => void
  stop: () => void
  openCheckpoint: (turnId: string, path?: string) => void
  openTerminal: (terminalId: string) => void
  legacyEvents: ToolEvents
  activityError: string
  collapsedTurns: Record<string, boolean>
  toggleTurn: (turnId: string) => void
  followRequest: number
}
const Context = createContext<ReturnType<typeof applicationState<Conversation>>['atom'] | null>(
  null,
)
const PendingContext = createContext<PendingMessage | null>(null)
const wholeConversation = (value: Conversation) => value
export function useConversationSelector<A>(selector: (value: Conversation) => A) {
  const atom = useContext(Context)
  if (!atom) throw new Error('Task conversation provider is missing')
  return useAtomValue(atom, selector)
}
export function useConversationTurn(assistantId: string) {
  return useConversationSelector(
    useCallback((value: Conversation) => value.presentation.get(assistantId)?.turn, [assistantId]),
  )
}
export function useConversationPresentation(messageId: string) {
  return useConversationSelector(
    useCallback((value: Conversation) => value.presentation.get(messageId), [messageId]),
  )
}
export function useTaskConversation() {
  return useConversationSelector(wholeConversation)
}
export function usePendingConversationMessage() {
  return useContext(PendingContext)
}
export function ConversationProvider({
  task: liveTask,
  temporary = false,
  visible,
  openCheckpoint,
  openTerminal,
  children,
}: {
  task: Task
  temporary?: boolean
  visible: boolean
  openCheckpoint: (turnId: string, path?: string) => void
  openTerminal: (terminalId: string) => void
  children: ReactNode
}) {
  const history = useConversationHistory(liveTask)
  const task = history.task
  const retainPresentation = useMemo(() => {
    let previous: ReturnType<typeof conversationPresentation> = new Map()
    return (next: ReturnType<typeof conversationPresentation>) => {
      for (const [id, item] of next) {
        const old = previous.get(id)
        if (
          old &&
          old.groupId === item.groupId &&
          old.header === item.header &&
          old.final === item.final &&
          old.footer === item.footer &&
          old.turn === item.turn &&
          old.groupTurn?.id === item.groupTurn?.id &&
          old.groupTurn?.startedAt === item.groupTurn?.startedAt &&
          old.groupTurn?.finishedAt === item.groupTurn?.finishedAt &&
          old.groupTurn?.status === item.groupTurn?.status
        )
          next.set(id, old)
      }
      previous = next
      return next
    }
  }, [])
  const presentation = useMemo(
    () => retainPresentation(conversationPresentation(task)),
    [task.messages, task.turns, retainPresentation],
  )
  const { carMode, readRepliesAloud, speechLanguage, speechVoice, speechRate } =
    useMobilePreferences()
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
            rate: speechRate,
          })
      })
      .catch((error: unknown) => console.error('Could not read reply aloud', error))
    return () => {
      active = false
      void import('expo-speech').then((speech) => speech.stop())
    }
  }, [
    latestTurn?.id,
    latestTurn?.status,
    visible,
    carMode,
    readRepliesAloud,
    speechAvailable,
    speechLanguage,
    speechVoice,
    speechRate,
  ])
  const actions = useConversationActions(task)
  const [collapsedTurns, setCollapsedTurns] = useApplicationState<Record<string, boolean>>({})
  const [followRequest, setFollowRequest] = useApplicationState(0)
  const { active: dictating, stop: finishDictation } = actions.dictation
  const answeringQuestion = actions.snapshot?.questions.some(
    (question) => question.taskId === task.id && question.prompt.blocking !== false,
  )
  useKeepScreenOn(task.id, visible && task.status === 'running')
  useEffect(() => {
    if ((!visible || answeringQuestion || task.archived) && dictating) finishDictation()
  }, [visible, answeringQuestion, task.archived, dictating, finishDictation])
  const activity = useToolActivity(task.id, visible && !temporary, task.status === 'running')
  const pendingMessage = useMemo(() => {
    const pending = visibleMobileSend(task, actions.pendingMessage)
    return pending?.destination === 'thread' ? pending : null
  }, [task.id, task.messages, task.queue, actions.pendingMessage])
  const projectMessages = useMemo(() => createConversationMessages(), [])
  const { id, status, turns, compactions, messages: taskMessages } = task
  const startingMessage = startingConversationMessage(task)
  const messages = useMemo(() => {
    return projectMessages(
      {
        id,
        status,
        turns,
        compactions,
        messages: startingMessage
          ? [...taskMessages, startingMessage]
          : pendingMessage
            ? [...taskMessages, pendingMessage.message]
            : taskMessages,
      },
      activity.events,
    )
  }, [
    projectMessages,
    id,
    status,
    turns,
    compactions,
    taskMessages,
    startingMessage,
    activity.events,
    pendingMessage,
  ])
  const legacyEvents = useMemo(() => {
    const visibleTurns = new Set(
      [...presentation.values()].flatMap((item) => (item.turn ? [item.turn.id] : [])),
    )
    return taskToolEvents(task, activity.events).filter(
      (event) => !event.turnId || !visibleTurns.has(event.turnId),
    )
  }, [activity.events, task.id, task.status, task.turns, presentation])
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: convertConversationMessage,
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
  const currentTask = useRef(task)
  currentTask.current = task
  const navigation = useRef({ openCheckpoint, openTerminal })
  navigation.current = { openCheckpoint, openTerminal }
  const showCheckpoint = useCallback(
    (turnId: string, path?: string) => navigation.current.openCheckpoint(turnId, path),
    [],
  )
  const showTerminal = useCallback(
    (terminalId: string) => navigation.current.openTerminal(terminalId),
    [],
  )
  const toggleTurn = useCallback(
    (turnId: string) =>
      setCollapsedTurns((previous) => ({
        ...previous,
        [turnId]: !(
          previous[turnId] ??
          [...conversationPresentation(currentTask.current).values()].find(
            (item) => item.groupId === turnId,
          )?.groupTurn?.status === 'completed'
        ),
      })),
    [setCollapsedTurns],
  )
  const value: Conversation = {
    task,
    presentation,
    history,
    visible,
    actions,
    openCheckpoint: showCheckpoint,
    openTerminal: showTerminal,
    legacyEvents,
    activityError: activity.error,
    collapsedTurns,
    toggleTurn,
    followRequest,
    send: (mode = 'queue') => {
      if (actions.canSend) {
        // Only a local Send/Queue/Steer asks to leave a manually scrolled position.
        // Remote messages and queued turns arriving later must not move the reader.
        setFollowRequest((revision) => revision + 1)
        void actions.run(() => actions.submit(mode))
      }
    },
    stop: () => runtime.thread.cancelRun(),
  }
  const [{ atom }] = useState(() => applicationState(value))
  const registry = useContext(RegistryContext)
  // Publish after commit; selector subscriptions leave unrelated message cells untouched.
  useLayoutEffect(() => {
    registry.set(atom, value)
  })
  return (
    <Context.Provider value={atom}>
      <PendingContext.Provider value={pendingMessage}>
        <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
      </PendingContext.Provider>
    </Context.Provider>
  )
}
