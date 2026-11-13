import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createBotCall } from '@dovo/client-runtime'
import {
  botCallReplies,
  desktopDictationBridge,
  randomUUID,
  responses,
  type Task,
} from '@dovo/protocol'
import { useAppPreferences, useWorkspace } from '@dovo/studio-core'
import { useRuntimeDictationBridge } from '@dovo/studio-core/runtime-dictation'
import {
  BotAvatar,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'
import { browserBotCallAudio } from './bot-call-audio'

export function BotCall({ task, onClose }: { task: Task; onClose: () => void }) {
  const { request, connection, snapshot, activeRuntimeId, connected } = useWorkspace()
  const preferences = useAppPreferences()
  const scope = JSON.stringify([
    connection?.runtimeId,
    connection?.address,
    connection?.token,
    activeRuntimeId,
    task.id,
  ])
  const bridge = useRuntimeDictationBridge(request, task.id, scope)
  const runtimeId = snapshot?.runtimeId ?? activeRuntimeId
  const remote = !!runtimeId && preferences.runtimeDictationIds.includes(runtimeId)
  const call = useMemo(
    () =>
      createBotCall(
        browserBotCallAudio(
          remote ? bridge : (desktopDictationBridge() ?? bridge),
          preferences.dictationLanguage,
        ),
        async (messageId, text) => {
          await request(
            '/api/tasks/message',
            { id: task.id, messageId, text, preserveQueuePause: true },
            responses.ok,
          )
        },
        randomUUID,
      ),
    [scope, request, bridge, remote, preferences.dictationLanguage],
  )
  const state = useSyncExternalStore(call.subscribe, call.getSnapshot, call.getSnapshot)
  const available =
    connected &&
    task.bot?.state === 'active' &&
    snapshot?.queuePausePreservationSupported === true &&
    !task.queuePaused &&
    !task.queue?.[0]?.paused &&
    !task.archived &&
    !task.archivedAt &&
    !task.replica
  const needsInput =
    !!snapshot?.questions.some((q) => q.taskId === task.id) ||
    !!snapshot?.approvals.some((a) => a.taskId === task.id) ||
    !!snapshot?.secureInputs?.some((q) => q.taskId === task.id)
  useEffect(() => {
    call.sync(botCallReplies(task, call.requests()), {
      available,
      needsInput,
      error: !connected
        ? 'Connection lost. Reconnect before continuing.'
        : 'Resume this Bot and its queue before calling.',
    })
  }, [call, task, available, needsInput, connected, state.phase])
  useEffect(() => {
    const hide = () => {
      if (document.hidden) call.end()
    }
    document.addEventListener('visibilitychange', hide)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      call.end()
    }
  }, [call])
  const close = () => {
    call.end()
    onClose()
  }
  const label = state.muted
    ? 'Muted'
    : state.phase === 'waiting'
      ? 'Listening · Bot is working'
      : state.phase === 'needs-input'
        ? 'Review needed in chat'
        : state.phase === 'error'
          ? 'Call paused'
          : state.phase === 'idle'
            ? 'Ready to call'
            : state.phase === 'ended'
              ? 'Call ended'
              : state.phase[0].toUpperCase() + state.phase.slice(1)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="max-w-md" data-studio-human-only="true">
        <DialogTitle>Call {task.title}</DialogTitle>
        <DialogDescription>
          Uses this Bot’s conversation and permissions. Speak after a reply, or select Interrupt.
          Keep Dovo open during the call.
        </DialogDescription>
        <div className="grid justify-items-center gap-4 py-6">
          <BotAvatar avatar={task.bot?.avatar} name={task.title} className="size-24 rounded-full" />
          <p role="status" aria-live="polite" className="text-sm font-medium">
            {label}
          </p>
          <p className="text-xs text-muted-foreground">{task.bot?.role}</p>
        </div>
        <div
          className="max-h-52 space-y-3 overflow-auto rounded-lg bg-muted/40 p-3 text-sm"
          aria-label="Call transcript"
        >
          {state.heard && (
            <p>
              <strong>You:</strong> {state.heard}
            </p>
          )}
          {state.reply && (
            <p className="whitespace-pre-wrap">
              <strong>{task.title}:</strong> {state.reply}
            </p>
          )}
          {!state.heard && !state.reply && (
            <p>
              Your messages and full replies stay in the chat. The microphone pauses during playback
              to avoid echo.
            </p>
          )}
        </div>
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        {!snapshot?.queuePausePreservationSupported && (
          <p>Update this Bot’s computer before calling.</p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {state.phase === 'idle' || state.phase === 'ended' ? (
            <Button disabled={!available || needsInput} onClick={() => call.start()}>
              Start call
            </Button>
          ) : (
            <>
              <Button variant="outline" aria-pressed={state.muted} onClick={() => call.mute()}>
                {state.muted ? 'Unmute' : 'Mute'}
              </Button>
              {state.phase === 'speaking' && (
                <Button variant="outline" onClick={() => call.interrupt()}>
                  Interrupt
                </Button>
              )}
              {state.phase === 'error' && (
                <Button disabled={!available || needsInput} onClick={() => call.retry()}>
                  {state.retrySend ? 'Retry same message' : 'Resume call'}
                </Button>
              )}
            </>
          )}
          <Button variant="destructive" onClick={close}>
            End call
          </Button>
          {needsInput && (
            <Button variant="outline" onClick={close}>
              Review in chat
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
