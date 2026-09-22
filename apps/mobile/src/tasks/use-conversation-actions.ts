import { Keyboard } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import {
  responses,
  generatedTitleSchema,
  cleanedDictationSchema,
  resolveTaskAgent,
  canChangeTaskCheckout,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useAction } from '../ui/use-action'
import { useDraft } from './use-draft'
import { useAttachmentPicker } from './attachment-picker'
import { useComposerDictation } from './use-composer-dictation'
import { createSendAttempts, type SendAttempt } from './send-attempts'

const sendAttempts = createSendAttempts(randomUUID)

export function useConversationActions(task: Task) {
  const { call, read, connected, snapshot, activeId } = useRuntime(),
    storedDraft = useDraft(task.id, task.draft),
    action = useAction(),
    cancellation = useAction()
  const { busy } = action
  const failedSend = useRef<SendAttempt | null>(null)
  const run = (work: () => Promise<unknown>) => {
    failedSend.current = null
    return action.run(work)
  }
  const act = (work: () => Promise<unknown>) => {
    void run(work)
  }
  const scope = { runtimeId: activeId ?? '', taskId: task.id }
  const updateDraft = (text: string) => {
    sendAttempts.textChanged(scope, text)
    storedDraft.update(text)
  }
  const dictation = useComposerDictation({
    draft: { ...storedDraft, update: updateDraft },
    connected,
    cleanup: async (text) =>
      (await read('/api/tasks/dictation/cleanup', { text }, cleanedDictationSchema)).text,
  })
  const draft = { ...storedDraft, update: dictation.update }
  const attachmentPicker = useAttachmentPicker(task.id)
  const [attachmentPreviewBusy, setAttaching] = useState(false)
  const attaching = attachmentPreviewBusy || attachmentPicker.busy
  useEffect(() => {
    if (!storedDraft.ready) return
    const acknowledged = sendAttempts.reconcile(
      scope,
      {
        text: storedDraft.text,
        attachmentIds: task.draftAttachments?.map((file) => file.id) ?? [],
      },
      [...task.messages, ...(task.queue ?? [])].map((message) => message.id),
    )
    if (acknowledged) storedDraft.update('')
  }, [activeId, task, storedDraft.ready, storedDraft.text])
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
  const patch = (changes: Record<string, { before: unknown; after: unknown }>) =>
    call(
      '/api/workspace',
      { collection: 'tasks', id: task.id, changes },
      z.object({ revision: z.number() }),
      'PATCH',
    )
  const submit = async (mode: 'queue' | 'steer' = 'queue', input = draft.text) => {
    Keyboard.dismiss()
    dictation.reset()
    const text = input.trim(),
      attachmentIds = task.draftAttachments?.map((file) => file.id) ?? []
    const attempt = sendAttempts.begin(scope, { text, attachmentIds, mode })
    if (firstMessage) {
      const title =
        attempt.title ??
        (
          await call(
            '/api/tasks/title',
            {
              text:
                text ||
                `Work with attached files: ${task.draftAttachments?.map((file) => file.name).join(', ')}`,
            },
            generatedTitleSchema,
          )
        ).title
      sendAttempts.setTitle(scope, attempt.id, title)
      await patch({ title: { before: task.title, after: title } })
    }
    try {
      const clearDraft = await sendAttempts.deliver(scope, attempt, () =>
        call(
          mode === 'steer' ? '/api/tasks/steer' : '/api/tasks/message',
          { id: task.id, messageId: attempt.id, text, attachmentIds },
          responses.ok,
        ),
      )
      if (clearDraft) draft.update('')
    } catch (error) {
      failedSend.current = attempt
      throw error
    }
  }
  return {
    call,
    stopping: cancellation.busy,
    stop: () => cancellation.run(() => call('/api/tasks/cancel', { id: task.id }, responses.ok)),
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
