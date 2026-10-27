import { permissionPolicyUIIssue } from '../../../agents/permission-policy'
import { sendingDraft, sendDestination, type MobilePendingSend } from '../../composer/pending-send'
import { mobileWorkflow } from '../../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../../../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { Alert, Keyboard } from 'react-native'
import { randomUUID, digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto'
import type { PendingQueueRestore } from '../../draft/storage'
import { nativeEffect } from '../../../runtime/state/native-effect'
import { useEffect, useRef } from 'react'
import { Schema, Effect } from 'effect'
import {
  type TurnSettings,
  type Attachment,
  sameTurnSettings,
  applyTurnSettings,
  queuedModelAgent,
  responses,
  generatedTitleSchema,
  taskSchema,
  cleanedDictationSchema,
  resolveTaskAgent,
  canChangeTaskCheckout,
  type Task,
  visiblePendingMessage,
  mergePendingMessages,
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
  const {
      call,
      connected,
      snapshot,
      activeId,
      profile,
      readEffect,
      callEffect,
      pendingMessages: savedMessages,
    } = useRuntime(),
    storedDraft = useDraft(
      task.id,
      task.draft,
      [...task.messages, ...(task.queue ?? [])].map((message) => message.id),
    ),
    action = useAction(),
    cancellation = useAction()
  const [draftTurnSettings, setTurnSettings] = useApplicationState<TurnSettings | null>(
    task.draftTurnSettings ?? null,
  )
  useEffect(() => {
    setTurnSettings(task.draftTurnSettings ?? null)
  }, [task.draftTurnSettings, setTurnSettings])
  const [editing, setEditing] = useApplicationState<{
    message: Task['messages'][number]
    text: string
    revision: number
    settings: TurnSettings | null
    files: Attachment[]
  } | null>(null)
  const turnSettings = editing ? editing.settings : draftTurnSettings
  const currentDraftKey = useRef(storedDraft.key)
  currentDraftKey.current = storedDraft.key
  const pendingScope = JSON.stringify([
    profile?.connection.address,
    profile?.connection.token,
    task.id,
  ])
  const [localPending, setLocalPending] = useApplicationState<
    (MobilePendingSend & { scope: string })[]
  >([])
  const setPendingMessage = (
    update: MobilePendingSend | ((message: MobilePendingSend | null) => MobilePendingSend | null),
  ) => {
    setLocalPending((items) => {
      if (typeof update !== 'function')
        return [
          ...items.filter(
            (item) => item.scope !== pendingScope || item.message.id !== update.message.id,
          ),
          { ...update, scope: pendingScope },
        ]
      return items.flatMap((item) => {
        if (item.scope !== pendingScope) return [item]
        const next = update(item)
        return next ? [{ ...next, scope: pendingScope }] : []
      })
    })
  }
  const pendingMessage = localPending.filter((item) => item.scope === pendingScope).at(-1) ?? null
  const pendingMessages = mergePendingMessages(
    task,
    savedMessages(task),
    localPending.filter((item) => item.scope === pendingScope),
  )
  const { busy } = action
  const failedSend = useRef<SendAttempt | null>(null)
  const restoredScope = useRef('')
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
  const updateDraft = (text: string, source?: 'keyboard') => {
    if (editing) {
      setEditing((current) =>
        current
          ? {
              ...current,
              text,
              revision: source === 'keyboard' ? current.revision : current.revision + 1,
            }
          : current,
      )
      return
    }
    sendAttempts.textChanged(scope, text)
    storedDraft.update(text, source)
  }
  const dictation = useComposerDictation({
    draft: {
      ...storedDraft,
      text: editing?.text ?? storedDraft.text,
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
    revision: JSON.stringify([
      editing?.message.id,
      editing?.revision,
      storedDraft.revision,
      pendingMessage?.taskId === task.id && pendingMessage.state === 'sending'
        ? pendingMessage.message.id
        : null,
    ]),
    text: editing
      ? editing.text
      : sendingDraft(storedDraft.text, pendingMessage?.taskId === task.id ? pendingMessage : null),
    update: dictation.update,
  }
  const attachmentPicker = useAttachmentPicker(
    task.id,
    editing && snapshot?.fullTurnSettingsSupported
      ? {
          messageId: editing.message.id,
          files: editing.files,
          uploaded: (file, replaceId) =>
            setEditing((current) =>
              current?.message.id === editing.message.id
                ? {
                    ...current,
                    files: [...current.files.filter((item) => item.id !== replaceId), file],
                  }
                : current,
            ),
        }
      : undefined,
  )
  const [attachmentPreviewBusy, setAttaching] = useApplicationState(false)
  const attaching = attachmentPreviewBusy || attachmentPicker.busy
  useEffect(() => {
    if (!storedDraft.ready) return
    const scopeKey = JSON.stringify(scope)
    if (restoredScope.current !== scopeKey) {
      restoredScope.current = scopeKey
      if (storedDraft.submission) {
        sendAttempts.restore(scope, storedDraft.submission.attempt, storedDraft.submission.accepted)
        if (!storedDraft.submission.accepted)
          setTurnSettings(storedDraft.submission.attempt.turnSettings ?? null)
      }
    }
    const attempt = sendAttempts.peek(scope)
    const ids = [...task.messages, ...(task.queue ?? [])].map((message) => message.id)
    const acknowledged = sendAttempts.reconcile(
      scope,
      {
        text: storedDraft.text,
        attachmentIds: task.draftAttachments?.map((file) => file.id) ?? [],
      },
      ids,
    )
    const pending =
      pendingMessage?.taskId === task.id && ids.includes(pendingMessage.message.id)
        ? pendingMessage
        : null
    if (pending) {
      setTurnSettings((current) =>
        sameTurnSettings(current, pending.message.turnSettings) ? null : current,
      )
      const submitted = attempt ?? {
        id: pending.message.id,
        text: pending.message.text,
        attachmentIds: pending.message.attachments?.map((file) => file.id) ?? [],
        mode: 'queue' as const,
        turnSettings: pending.message.turnSettings,
      }
      void runClientEffect(
        storedDraft
          .confirmEffect(submitted, true)
          .pipe(
            Effect.tap(() =>
              Effect.sync(() =>
                setPendingMessage((current) =>
                  current?.message.id === submitted.id ? null : current,
                ),
              ),
            ),
          ),
      )
    } else if (acknowledged && attempt) {
      setTurnSettings((current) =>
        sameTurnSettings(current, attempt.turnSettings) ? null : current,
      )
      void runClientEffect(storedDraft.confirmEffect(attempt, true))
    }
    // Once the host lists the message, the local copy is done; keeping it would show a ghost
    // "Sending…" bubble whenever that message later leaves the queue.
  }, [
    activeId,
    task.id,
    task.messages,
    task.queue,
    task.draftAttachments,
    storedDraft.ready,
    storedDraft.submission,
    pendingMessage?.message.id,
    pendingMessage?.state,
  ])
  useEffect(() => {
    setLocalPending((items) => {
      const next = items.filter(
        (item) => item.scope !== pendingScope || !!visiblePendingMessage(task, item),
      )
      return next.length === items.length ? items : next
    })
  }, [task.id, task.messages, task.queue, pendingScope])
  const threadAgent = resolveTaskAgent(task, snapshot?.workspace.agents ?? [])
  const agent =
    threadAgent && snapshot?.persistentTurnModelsSupported
      ? queuedModelAgent(threadAgent, task.queue, editing?.message.id)
      : threadAgent
  const policyIssue = agent
    ? permissionPolicyUIIssue(
        applyTurnSettings(agent, turnSettings ?? undefined),
        snapshot?.permissionPolicySupported === true,
      )
    : undefined
  const firstMessage = !task.messages.length && !task.queue?.length && !task.turns?.length
  const checkoutEditable = canChangeTaskCheckout(task)
  const hasInput =
    !!draft.text.trim() || !!(editing ? editing.files.length : task.draftAttachments?.length)
  const canSend =
    !policyIssue &&
    connected &&
    !busy &&
    !cancellation.busy &&
    !storedDraft.pendingRestore &&
    draft.ready &&
    hasInput &&
    (!editing || !!task.queue?.some((message) => message.id === editing.message.id)) &&
    !attaching &&
    !dictation.active &&
    !task.archivedAt &&
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
        revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
      }),
      'PATCH',
    )
  const patch = (changes: Parameters<typeof patchEffect>[0]) =>
    runClientEffect(patchEffect(changes))
  const submit = (mode: 'queue' | 'steer' = 'queue', input = draft.text) => {
    let submittedId: string | undefined
    return mobileWorkflow(function* () {
      if (storedDraft.pendingRestore)
        return yield* Effect.fail(
          new Error('Resolve the pending queued-message restore before sending'),
        )
      if (policyIssue) return yield* Effect.fail(new Error(policyIssue))
      if (turnSettings && snapshot?.queuedTurnSettingsSupported !== true)
        return yield* Effect.fail(
          new Error('Update the task computer to choose a model for this turn.'),
        )
      if (turnSettings?.harness && !snapshot?.fullTurnSettingsSupported)
        return yield* Effect.fail(
          new Error('Update the task computer to use all settings for this turn.'),
        )
      if (turnSettings && mode === 'steer')
        return yield* Effect.fail(
          new Error('Queue this message to use its model and reasoning settings.'),
        )
      if (editing) {
        yield* callEffect(
          '/api/tasks/queue',
          {
            id: task.id,
            action: 'edit',
            messageId: editing.message.id,
            text: input,
            expectedText: editing.message.text,
            ...(snapshot?.fullTurnSettingsSupported
              ? {
                  attachmentIds: editing.files.map((file) => file.id),
                  expectedAttachmentIds: editing.message.attachments?.map((file) => file.id) ?? [],
                }
              : {}),
            ...(snapshot?.queuedTurnSettingsSupported
              ? {
                  turnSettings: editing.settings,
                  expectedTurnSettings: editing.message.turnSettings ?? null,
                }
              : {}),
          },
          responses.ok,
        )
        dictation.reset()
        setEditing(null)
        return
      }
      Keyboard.dismiss()
      dictation.reset()
      const text = input.trim(),
        attachmentIds = task.draftAttachments?.map((file) => file.id) ?? []
      const attempt = sendAttempts.begin(scope, {
        text,
        attachmentIds,
        mode,
        runId: mode === 'steer' ? task.activeRunId : undefined,
        turnSettings: turnSettings ?? undefined,
      })
      submittedId = attempt.id
      setPendingMessage({
        taskId: task.id,
        state: 'sending',
        destination: sendDestination(task, mode),
        message: {
          id: attempt.id,
          role: 'user',
          text,
          createdAt: new Date().toISOString(),
          attachments: task.draftAttachments,
          turnSettings: attempt.turnSettings,
        },
      })
      yield* storedDraft.stageEffect(attempt)
      if (firstMessage && task.autoProject) {
        yield* callEffect(
          '/api/tasks/projects/select',
          { id: task.id, requestId: attempt.id, text: text || 'Work with the attached files' },
          taskSchema,
        )
      }
      if (firstMessage) {
        const summary =
          text ||
          `Work with attached files: ${task.draftAttachments?.map((file) => file.name).join(', ')}`
        const title = attempt.title ?? (summary.split('\n')[0]?.trim().slice(0, 80) || 'New task')
        sendAttempts.setTitle(scope, attempt.id, title)
        yield* storedDraft.stageEffect(attempt)
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
              runId: attempt.runId,
              turnSettings: attempt.turnSettings,
              text,
              attachmentIds,
            },
            responses.ok,
          ).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                if (result.pending)
                  setPendingMessage((pending) =>
                    pending?.message.id === attempt.id ? { ...pending, state: 'saved' } : pending,
                  )
              }),
            ),
          ),
        )
        yield* storedDraft.confirmEffect(attempt, clearDraft)
        if (firstMessage)
          void runClientEffect(
            readEffect(
              '/api/tasks/title',
              {
                taskId: task.id,
                expectedTitle: attempt.title,
                text: text || 'Work with the attached files',
              },
              generatedTitleSchema,
            ).pipe(Effect.catch(() => Effect.succeed(undefined))),
          )

        setTurnSettings(null)
      }).pipe(
        Effect.catch((error) =>
          mobileWorkflow(function* () {
            failedSend.current = attempt
            return yield* Effect.fail(error)
          }),
        ),
      )
    }).pipe(
      Effect.catch((error) =>
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
  const restoreTried = useRef(new Set<string>())
  useEffect(() => {
    restoreTried.current.clear()
  }, [storedDraft.key, pendingScope])
  const restoreKey = (restore: PendingQueueRestore) =>
    JSON.stringify([storedDraft.key, pendingScope, restore.requestId])
  const connectionIdentity = () =>
    nativeEffect(() =>
      digestStringAsync(
        CryptoDigestAlgorithm.SHA256,
        JSON.stringify([profile?.connection.address, profile?.connection.token]),
      ),
    )
  const finishRestore = (restore: PendingQueueRestore) =>
    mobileWorkflow(function* () {
      if (!snapshot?.queueRestoreReceiptsSupported)
        throw new Error('Update this computer’s runtime before restoring queued messages')
      if (restore.connection !== (yield* connectionIdentity()))
        throw new Error(
          'This saved restore belongs to the original computer connection. Reconnect it or discard the restore.',
        )
      // Re-persist before every request, including retries after an earlier disk failure.
      yield* storedDraft.stageRestoreEffect(restore)
      const key = storedDraft.key
      yield* callEffect(
        '/api/tasks/queue',
        {
          id: task.id,
          action: 'restore',
          messageId: restore.messageId,
          restoreRequestId: restore.requestId,
          expectedText: restore.text,
          expectedAttachmentIds: restore.attachmentIds,
          expectedTurnSettings: restore.turnSettings,
          expectedDraftTurnSettings: restore.draftTurnSettings,
        },
        responses.ok,
      )
      yield* storedDraft.confirmRestoreEffect(restore.requestId)
      if (currentDraftKey.current === key)
        setTurnSettings((current) =>
          sameTurnSettings(current, restore.draftTurnSettings) ? restore.turnSettings : current,
        )
    })
  useEffect(() => {
    const restore = storedDraft.pendingRestore
    if (!restore || !storedDraft.ready) return
    const key = restoreKey(restore)
    if (!connected) {
      restoreTried.current.delete(key)
      return
    }
    if (busy || restoreTried.current.has(key)) return
    restoreTried.current.add(key)
    void run(() => finishRestore(restore))
  }, [
    storedDraft.pendingRestore,
    storedDraft.ready,
    storedDraft.key,
    pendingScope,
    connected,
    busy,
  ])
  return {
    editing,
    restoreQueuedMessage: (message: NonNullable<Task['queue']>[number]) =>
      run(() =>
        mobileWorkflow(function* () {
          if (editing || attaching || dictation.active || !storedDraft.ready)
            throw new Error('Finish editing or attaching files before returning a queued message')
          if (
            (storedDraft.text.trim() || task.draftAttachments?.length) &&
            !sameTurnSettings(message.turnSettings, draftTurnSettings)
          )
            throw new Error(
              'Clear the composer before restoring a message with different model settings',
            )
          if (!snapshot?.queueRestoreReceiptsSupported)
            throw new Error('Update this computer’s runtime before restoring queued messages')
          const restore = storedDraft.pendingRestore ?? {
            requestId: randomUUID(),
            messageId: message.id,
            text: message.text,
            attachmentIds: message.attachments?.map((file) => file.id) ?? [],
            turnSettings: message.turnSettings ?? null,
            draftTurnSettings,
            connection: yield* connectionIdentity(),
          }
          if (restore.messageId !== message.id)
            throw new Error('Resolve the pending queued-message restore first')
          restoreTried.current.add(restoreKey(restore))
          yield* finishRestore(restore)
        }),
      ),
    pendingRestore: storedDraft.pendingRestore,
    retryRestore: () => {
      const restore = storedDraft.pendingRestore
      if (restore) void run(() => finishRestore(restore))
    },
    discardRestore: () => {
      const restore = storedDraft.pendingRestore
      if (!restore) return
      Alert.alert(
        'Discard pending restore?',
        'The runtime may already have returned this message to its draft. Check the thread on its computer before discarding this saved recovery request.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard restore',
            style: 'destructive',
            onPress: () => {
              void run(() => storedDraft.discardRestoreEffect(restore.requestId))
            },
          },
        ],
      )
    },
    beginEdit: (message: Task['messages'][number]) => {
      if (busy || attaching || editing || dictation.active) return
      setEditing({
        message,
        text: message.text,
        revision: 0,
        settings: message.turnSettings ?? null,
        files: message.attachments ?? [],
      })
    },
    removeEditAttachment: (id: string) =>
      setEditing((current) =>
        current ? { ...current, files: current.files.filter((file) => file.id !== id) } : current,
      ),
    cancelEdit: () => {
      dictation.reset()
      setEditing(null)
    },
    turnSettings,
    setTurnSettings: (value: TurnSettings | null) => {
      if (editing) {
        setEditing({ ...editing, settings: value })
        return
      }
      setTurnSettings(value)
      act(() =>
        patchEffect({
          draftTurnSettings: { before: task.draftTurnSettings ?? null, after: value },
        }),
      )
    },
    threadScope: JSON.stringify([profile?.connection.address, profile?.connection.token, task.id]),
    pendingMessage,
    pendingMessages,
    draftAttachments: editing
      ? editing.files
      : pendingMessage?.taskId === task.id && pendingMessage.state === 'sending'
        ? task.draftAttachments?.filter(
            (file) => !pendingMessage.message.attachments?.some((sent) => sent.id === file.id),
          )
        : task.draftAttachments,
    call,
    stopping: cancellation.busy,
    stop: () => {
      const runId = task.activeRunId
      const run = () =>
        cancellation.run(() =>
          callEffect(
            '/api/tasks/cancel',
            {
              id: task.id,
              runId,
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
      policyIssue ||
      (failedSend.current &&
      (sendAttempts.isConfirmed(failedSend.current) ||
        [...task.messages, ...(task.queue ?? [])].some(
          (message) => message.id === failedSend.current?.id,
        ))
        ? cancellation.error
        : cancellation.error || action.error),
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
