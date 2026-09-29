import type { PendingMessage } from '@dovo/protocol'
import { mobileWorkflow } from '../../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../../../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { Alert, Keyboard } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { useEffect, useRef } from 'react'
import { Schema, Effect } from 'effect'
import {
  responses,
  generatedTitleSchema,
  cleanedDictationSchema,
  resolveTaskAgent,
  canChangeTaskCheckout,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { readMobilePreferences } from '../../../runtime/preferences/app-preferences'
import { useAction } from '../../../ui/controls/use-action'
import { useDraft } from '../../draft/use-draft'
import { useAttachmentPicker } from '../../composer/attachment-picker'
import { useComposerDictation } from '../../composer/use-composer-dictation'
import { createSendAttempts, type SendAttempt } from '../../composer/send-attempts'
const sendAttempts = createSendAttempts(randomUUID)
export function useConversationActions(task: Task) {
  const { call, connected, snapshot, activeId, readEffect, callEffect } = useRuntime(),
    storedDraft = useDraft(task.id, task.draft),
    action = useAction(),
    cancellation = useAction()
  const [pendingMessage, setPendingMessage] = useApplicationState<PendingMessage | null>(null)
  const { busy } = action
  const failedSend = useRef<SendAttempt | null>(null)
  const run = (work: () => Promise<unknown> | Effect.Effect<unknown, unknown>) => {
    failedSend.current = null
    return action.run(work)
  }
  const act = (work: () => Promise<unknown> | Effect.Effect<unknown, unknown>) => {
    void run(work)
  }
  const scope = {
    runtimeId: activeId ?? '',
    taskId: task.id,
  }
  const updateDraft = (text: string) => {
    sendAttempts.textChanged(scope, text)
    storedDraft.update(text)
  }
  const dictation = useComposerDictation({
    draft: {
      ...storedDraft,
      update: updateDraft,
    },
    connected,
    cleanup: (text) => {
      return mobileWorkflow(function* () {
        return (yield* readEffect(
          '/api/tasks/dictation/cleanup',
          {
            text,
          },
          cleanedDictationSchema,
        )).text
      })
    },
  })
  const draft = {
    ...storedDraft,
    update: dictation.update,
  }
  const attachmentPicker = useAttachmentPicker(task.id)
  const [attachmentPreviewBusy, setAttaching] = useApplicationState(false)
  const attaching = attachmentPreviewBusy || attachmentPicker.busy
  useEffect(() => {
    if (!storedDraft.ready) return
    const ids = [...task.messages, ...(task.queue ?? [])].map((message) => message.id)
    const acknowledged = sendAttempts.reconcile(
      scope,
      {
        text: storedDraft.text,
        attachmentIds: task.draftAttachments?.map((file) => file.id) ?? [],
      },
      ids,
    )
    if (acknowledged) storedDraft.update('')
    // Once the host lists the message, the local copy is done; keeping it would show a ghost
    // "Sending…" bubble whenever that message later leaves the queue.
    setPendingMessage((pending) =>
      pending?.taskId === task.id && pending.state !== 'failed' && ids.includes(pending.message.id)
        ? null
        : pending,
    )
  }, [activeId, task.id, task.messages, task.queue, task.draftAttachments, storedDraft.ready])
  const agent = resolveTaskAgent(task, snapshot?.workspace.agents ?? [])
  const firstMessage = !task.messages.length && !task.queue?.length && !task.turns?.length
  const checkoutEditable = canChangeTaskCheckout(task)
  const hasInput = !!draft.text.trim() || !!task.draftAttachments?.length
  const canSend =
    connected &&
    !busy &&
    !cancellation.busy &&
    draft.ready &&
    hasInput &&
    !attaching &&
    !dictation.active &&
    !task.archived &&
    !task.example &&
    !!task.repositoryId &&
    !!agent
  const patchEffect = (
    changes: Record<
      string,
      {
        before: unknown
        after: unknown
      }
    >,
    refresh = true,
  ) =>
    (refresh ? callEffect : readEffect)(
      '/api/workspace',
      {
        collection: 'tasks',
        id: task.id,
        changes,
      },
      mutableStruct({
        revision: Schema.Number.pipe(Schema.finite()),
      }),
      'PATCH',
    )
  const patch = (changes: Parameters<typeof patchEffect>[0]) =>
    runClientEffect(patchEffect(changes))
  const submit = (mode: 'queue' | 'steer' = 'queue', input = draft.text) => {
    let submittedId: string | undefined
    return mobileWorkflow(function* () {
      Keyboard.dismiss()
      dictation.reset()
      const text = input.trim(),
        attachmentIds = task.draftAttachments?.map((file) => file.id) ?? []
      const attempt = sendAttempts.begin(scope, {
        text,
        attachmentIds,
        mode,
      })
      submittedId = attempt.id
      setPendingMessage({
        taskId: task.id,
        state: 'sending',
        message: {
          id: attempt.id,
          role: 'user',
          text,
          createdAt: new Date().toISOString(),
          attachments: task.draftAttachments,
        },
      })
      if (firstMessage) {
        const summary =
          text ||
          `Work with attached files: ${task.draftAttachments?.map((file) => file.name).join(', ')}`
        // A title is a convenience; the first message must still send when no title harness
        // is configured or the model is slow.
        const title =
          attempt.title ??
          (yield* readEffect('/api/tasks/title', { text: summary }, generatedTitleSchema).pipe(
            Effect.map((value) => value.title),
            Effect.catchAll(() =>
              Effect.succeed(summary.split('\n')[0]?.trim().slice(0, 80) || 'New task'),
            ),
          ))
        sendAttempts.setTitle(scope, attempt.id, title)
        yield* patchEffect(
          {
            title: {
              before: task.title,
              after: title,
            },
          },
          false,
        )
      }
      return yield* mobileWorkflow(function* () {
        const clearDraft = yield* sendAttempts.deliverEffect(
          scope,
          attempt,
          callEffect(
            mode === 'steer' ? '/api/tasks/steer' : '/api/tasks/message',
            {
              id: task.id,
              messageId: attempt.id,
              text,
              attachmentIds,
            },
            responses.ok,
          ),
        )
        if (clearDraft) draft.update('')
      }).pipe(
        Effect.catchAll((error) =>
          mobileWorkflow(function* () {
            failedSend.current = attempt
            return yield* Effect.fail(error)
          }),
        ),
      )
    }).pipe(
      Effect.catchAll((error) =>
        mobileWorkflow(function* () {
          setPendingMessage((pending) =>
            pending?.taskId === task.id && pending.message.id === submittedId
              ? { ...pending, state: 'failed' }
              : pending,
          )
          return yield* Effect.fail(error)
        }),
      ),
    )
  }
  return {
    pendingMessage,
    call,
    stopping: cancellation.busy,
    stop: () => {
      const run = () =>
        cancellation.run(() =>
          callEffect(
            '/api/tasks/cancel',
            {
              id: task.id,
            },
            responses.ok,
          ),
        )
      // Settings → General → Confirm before stopping a running task.
      if (!readMobilePreferences().confirmStop) return run()
      Alert.alert(
        `Stop “${task.title}”?`,
        'Queued messages stay paused until you continue or send a follow-up.',
        [
          { text: 'Keep running', style: 'cancel' },
          { text: 'Stop', style: 'destructive', onPress: run },
        ],
      )
    },
    connected,
    snapshot,
    draft,
    dictation,
    busy,
    // A later snapshot may also acknowledge a request after its HTTP error was displayed.
    error:
      failedSend.current &&
      (sendAttempts.isConfirmed(failedSend.current) ||
        [...task.messages, ...(task.queue ?? [])].some(
          (message) => message.id === failedSend.current?.id,
        ))
        ? cancellation.error
        : cancellation.error || action.error,
    act,
    run,
    attaching,
    setAttaching,
    attachmentPicker,
    agent,
    firstMessage,
    checkoutEditable,
    hasInput,
    canSend,
    patch,
    submit,
  }
}
