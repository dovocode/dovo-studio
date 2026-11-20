import { permissionPolicyUIIssue } from '../../../agents/permission-policy'
import { sendingDraft, sendDestination, type MobilePendingSend } from '../../composer/pending-send'
import { mobileWorkflow } from '../../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../../../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { Alert } from 'react-native'
import { randomUUID, digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto'
import type { PendingQueueRestore } from '../../draft/storage'
import { nativeEffect } from '../../../runtime/state/native-effect'
import { useEffect, useRef } from 'react'
import { Schema, Effect } from 'effect'
import {
  conversationPageSchema,
  type TurnSettings,
  sameTurnSettings,
  applyTurnSettings,
  queuedModelAgent,
  planModeIssue,
  responses,
  generatedTitleSchema,
  snapshotSchema,
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
import { useQueueEdit } from '../../draft/use-queue-edit'
import {
  observeQueueEdit,
  prepareQueueEdit,
  settleQueueEdit,
  startQueueEdit,
  type QueueEdit,
} from '../../draft/queue-edit'
import { useAttachmentPicker } from '../../composer/attachment-picker'
import { useComposerDictation } from '../../composer/use-composer-dictation'
import { useComposerHistory } from '../../composer/use-composer-history'
import { createSendAttempts, type SendAttempt } from '../../composer/send-attempts'
import type { ComposerInputHandle } from '../../composer/native-composer-input.types'
const sendAttempts = createSendAttempts(randomUUID)
const queueEditsInFlight = new Set<string>()
const queueEditOperation = <A, E>(key: string, operation: Effect.Effect<A, E>) =>
  Effect.suspend<A, E | Error, never>(() => {
    if (queueEditsInFlight.has(key))
      return Effect.fail(new Error('A queued message save is already in progress.'))
    queueEditsInFlight.add(key)
    return operation.pipe(Effect.ensuring(Effect.sync(() => queueEditsInFlight.delete(key))))
  })
export type BackgroundStart = {
  /** The message is durably saved locally or acknowledged by its computer. */
  confirmed: () => void
  settled: (outcome: 'failed' | 'pending' | 'confirmed') => void
}
export function useConversationActions(task: Task) {
  const composerInput = useRef<ComposerInputHandle>(null)
  const {
      call,
      connected,
      snapshot,
      activeId,
      profile,
      readEffect,
      callEffect,
      pendingMessages: savedMessages,
      attachmentUploads,
      finishAttachmentEffect,
      reviewAttachments,
    } = useRuntime(),
    storedDraft = useDraft(
      task.id,
      task.draft,
      [...task.messages, ...(task.queue ?? [])].map((message) => message.id),
    ),
    action = useAction()
  const stopScope =
    task.activeRunId || task.status === 'running'
      ? JSON.stringify([activeId, task.id, task.activeRunId])
      : undefined
  const cancellation = useAction(stopScope)
  const currentStopScope = useRef(stopScope)
  currentStopScope.current = stopScope
  const [draftTurnSettings, setTurnSettings] = useApplicationState<TurnSettings | null>(
    task.draftTurnSettings ?? null,
  )
  useEffect(() => {
    setTurnSettings(task.draftTurnSettings ?? null)
  }, [task.draftTurnSettings, setTurnSettings])
  const [draftPlan, setDraftPlan] = useApplicationState(task.draftPlan === true)
  useEffect(() => {
    setDraftPlan(task.draftPlan === true)
  }, [task.draftPlan, setDraftPlan])
  const queueEdit = useQueueEdit(activeId ?? '', task.id)
  const editing = queueEdit.edit
  const updateEdit = (
    session: string,
    update: (draft: QueueEdit['draft']) => QueueEdit['draft'],
    refreshText = false,
  ) =>
    queueEdit.update((current) => {
      if (current?.session !== session) return current
      const draft = update(current.draft)
      return draft === current.draft
        ? current
        : {
            ...current,
            draft,
            version: current.version + 1,
            revision: current.revision + (refreshText ? 1 : 0),
          }
    })
  const turnSettings = task.bot ? null : editing ? editing.draft.settings : draftTurnSettings
  // One-message plan mode: kept with the draft until a plan send is accepted.
  const plan = !task.bot && (editing ? editing.draft.plan : draftPlan)
  const planSupported = !task.bot && snapshot?.planModeSupported === true
  const latestDraftText = useRef(storedDraft.text)
  latestDraftText.current = storedDraft.text
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
  const [stageIntents, setStageIntents] = useApplicationState<
    {
      scope: string
      messageId: string
      wasRunning: boolean
      runId?: string
    }[]
  >([])
  const stageIntent = stageIntents.find((intent) => intent.scope === pendingScope)
  const stageIntentObserved =
    !!stageIntent &&
    (task.queuePaused === true ||
      [...task.messages, ...(task.queue ?? [])].some(
        (message) => message.id === stageIntent.messageId,
      ) ||
      (task.status === 'running' &&
        (!stageIntent.wasRunning || task.activeRunId !== stageIntent.runId)))
  useEffect(() => {
    if (stageIntentObserved)
      setStageIntents((current) => current.filter((intent) => intent !== stageIntent))
  }, [stageIntentObserved, stageIntent, setStageIntents])
  const pendingMessage = localPending.filter((item) => item.scope === pendingScope).at(-1) ?? null
  const pendingMessages = mergePendingMessages(
    task,
    savedMessages(task),
    localPending.filter((item) => item.scope === pendingScope),
  )
  const { busy } = action
  const failedSend = useRef<SendAttempt | null>(null)
  const restoredScope = useRef('')
  const [submitting, setSubmitting] = useApplicationState(false)
  const [backgroundSubmitting, setBackgroundSubmitting] = useApplicationState(false)
  const backgroundLocked = useRef(false)
  const admitted = useRef(false)
  const run = (work: () => Promise<unknown> | Effect.Effect<unknown, unknown>) => {
    if (admitted.current) return Promise.resolve()
    admitted.current = true
    failedSend.current = null
    return action.run(work).finally(() => {
      admitted.current = false
    })
  }
  const act = (work: () => Promise<unknown> | Effect.Effect<unknown, unknown>) => {
    void run(work)
  }
  const scope = {
    runtimeId: activeId ?? '',
    taskId: task.id,
  }
  const composerHistory = useComposerHistory({
    scope: storedDraft.key,
    text: storedDraft.text,
    revision: storedDraft.revision,
    messages: task.messages,
    loadHistory: async (signal, before) => {
      if (!connected) throw new Error('Reconnect to recall earlier messages.')
      const page = await Effect.runPromise(
        readEffect(
          '/api/tasks/composer-history',
          { id: task.id, ...(before ? { before } : {}) },
          conversationPageSchema,
        ),
        { signal },
      )
      return page
    },
    // Keep a recalled draft stable while Send waits for its native snapshot.
    // The composer controls already prevent starting history while busy.
    enabled:
      storedDraft.ready &&
      queueEdit.ready &&
      !editing &&
      !submitting &&
      !storedDraft.pendingFork &&
      !storedDraft.pendingRestore &&
      (!storedDraft.submission || storedDraft.submission.accepted) &&
      !task.archivedAt &&
      !task.example,
  })
  const updateDraft = (text: string, source?: 'keyboard') => {
    if (backgroundLocked.current) return
    if (editing) {
      updateEdit(
        editing.session,
        (draft) => (draft.text === text ? draft : { ...draft, text }),
        source !== 'keyboard',
      )
      return
    }
    composerHistory.cancel()
    latestDraftText.current = text
    sendAttempts.textChanged(scope, text)
    storedDraft.update(text, source)
  }
  const dictation = useComposerDictation({
    taskId: task.id,
    title: task.title,
    editing: !!editing,
    draftKey: storedDraft.key,
    draft: {
      ...storedDraft,
      text: editing?.draft.text ?? composerHistory.text,
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
    ready: storedDraft.ready && queueEdit.ready,
    error: queueEdit.error || storedDraft.error,
    revision: editing
      ? JSON.stringify([editing.session, editing.revision])
      : JSON.stringify([
          storedDraft.revision,
          composerHistory.index,
          pendingMessage?.taskId === task.id &&
          (pendingMessage.state === 'sending' || (pendingMessage.state === 'saved' && submitting))
            ? pendingMessage.message.id
            : null,
        ]),
    text: editing
      ? editing.draft.text
      : sendingDraft(
          composerHistory.text,
          pendingMessage?.taskId === task.id ? pendingMessage : null,
          submitting,
        ),
    update: dictation.update,
  }
  const attachmentPicker = useAttachmentPicker(
    task.id,
    editing && snapshot?.fullTurnSettingsSupported
      ? {
          messageId: editing.messageId,
          files: editing.draft.files,
          uploaded: (file, replaceId) => {
            const current = queueEdit.current()
            if (current?.session !== editing.session) return false
            if (replaceId && !current.draft.files.some((item) => item.id === replaceId))
              return false
            updateEdit(editing.session, (draft) =>
              replaceId && !draft.files.some((item) => item.id === replaceId)
                ? draft
                : {
                    ...draft,
                    files: [...draft.files.filter((item) => item.id !== replaceId), file],
                  },
            )
            return true
          },
        }
      : undefined,
  )
  const [attachmentPreviewBusy, setAttaching] = useApplicationState(false)
  const attaching = attachmentPreviewBusy || attachmentPicker.busy
  const submissionFiles = [
    ...new Map(
      [...(task.draftAttachments ?? []), ...attachmentPicker.submissionFiles].map((file) => [
        file.id,
        file,
      ]),
    ).values(),
  ]
  useEffect(() => {
    if (!storedDraft.ready) return
    const scopeKey = JSON.stringify(scope)
    if (restoredScope.current !== scopeKey) {
      restoredScope.current = scopeKey
      if (storedDraft.submission) {
        sendAttempts.restore(scope, storedDraft.submission.attempt, storedDraft.submission.accepted)
        if (!storedDraft.submission.accepted) {
          setTurnSettings(storedDraft.submission.attempt.turnSettings ?? null)
          if (storedDraft.submission.attempt.plan) setDraftPlan(true)
        }
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
      if (
        !latestDraftText.current.trim() ||
        latestDraftText.current.trim() === pending.message.text.trim()
      ) {
        setTurnSettings((current) =>
          sameTurnSettings(current, pending.message.turnSettings) ? null : current,
        )
        if (pending.message.plan) setDraftPlan(false)
      }
      const submitted = attempt ?? {
        id: pending.message.id,
        text: pending.message.text,
        attachmentIds: pending.message.attachments?.map((file) => file.id) ?? [],
        mode: 'queue' as const,
        turnSettings: pending.message.turnSettings,
        ...(pending.message.plan ? { plan: true } : {}),
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
      if (!latestDraftText.current.trim() || latestDraftText.current.trim() === attempt.text) {
        setTurnSettings((current) =>
          sameTurnSettings(current, attempt.turnSettings) ? null : current,
        )
        if (attempt.plan) setDraftPlan(false)
      }
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
      ? queuedModelAgent(threadAgent, task.queue, editing?.messageId)
      : threadAgent
  const policyIssue = agent
    ? permissionPolicyUIIssue(
        applyTurnSettings(agent, turnSettings ?? undefined),
        snapshot?.permissionPolicySupported === true,
      )
    : undefined
  const planIssue = !plan
    ? undefined
    : !planSupported
      ? 'Update the task computer to use plan mode.'
      : planModeIssue(agent)
  const firstMessage = !task.messages.length && !task.queue?.length && !task.turns?.length
  const checkoutEditable = !task.bot && canChangeTaskCheckout(task)
  const hasInput =
    !!draft.text.trim() || !!(editing ? editing.draft.files.length : submissionFiles.length)
  const canSend =
    !policyIssue &&
    !planIssue &&
    (connected ||
      (!!profile && !editing && (!task.autoProject || snapshot?.messageSetupSupported === true))) &&
    !busy &&
    !cancellation.busy &&
    !storedDraft.pendingRestore &&
    !storedDraft.pendingFork &&
    draft.ready &&
    hasInput &&
    (!editing || !!task.queue?.some((message) => message.id === editing.messageId)) &&
    (!attaching || (!attachmentPreviewBusy && attachmentPicker.canSubmitWhileUploading)) &&
    !attachmentPicker.failedUploads.length &&
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
    defer = false,
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
      { defer },
    )
  const patch = (changes: Parameters<typeof patchEffect>[0]) =>
    runClientEffect(patchEffect(changes))
  const stageSupported = snapshot?.promptQueueStagingSupported === true
  const retryAttempt =
    sendAttempts.peek(scope) ??
    (!storedDraft.submission?.accepted ? storedDraft.submission?.attempt : undefined)
  const retryStage =
    retryAttempt?.mode === 'stage' &&
    retryAttempt.text === storedDraft.text.trim() &&
    sameTurnSettings(retryAttempt.turnSettings, turnSettings) &&
    !!retryAttempt.plan === plan &&
    ![...task.messages, ...(task.queue ?? [])].some((message) => message.id === retryAttempt.id)
  const retryAutomaticAddition =
    retryAttempt?.preserveQueuePause === true &&
    retryAttempt.text === storedDraft.text.trim() &&
    sameTurnSettings(retryAttempt.turnSettings, turnSettings) &&
    !!retryAttempt.plan === plan &&
    JSON.stringify(retryAttempt.attachmentIds) ===
      JSON.stringify(task.draftAttachments?.map((file) => file.id) ?? [])
  const defaultSendMode =
    !retryAutomaticAddition &&
    stageSupported &&
    ((!!stageIntent && !stageIntentObserved) ||
      retryStage ||
      (!!task.queue?.length && (task.queuePaused || task.queue[0]?.paused)))
      ? 'stage'
      : 'queue'
  const canStartInBackground =
    !editing &&
    firstMessage &&
    defaultSendMode === 'queue' &&
    (!retryAttempt || retryAttempt.mode === 'queue')
  const confirmQueueEdit = (edit: QueueEdit, attempt: NonNullable<QueueEdit['attempt']>) =>
    mobileWorkflow(function* () {
      let cleared = false
      yield* queueEdit.updateEffect((current) => {
        const next = settleQueueEdit(current, edit.session, attempt, true)
        cleared = !!current && !next
        return next
      })
      if (cleared && queueEdit.active() && !queueEdit.current()) dictation.reset()
      if (profile) {
        const ids = new Set(attempt.intended.files.map((file) => file.id))
        yield* Effect.forEach(
          attachmentUploads(profile).filter((item) => ids.has(item.id)),
          (item) =>
            finishAttachmentEffect(profile, item.id).pipe(
              Effect.catch(() => Effect.sync(() => reviewAttachments(profile))),
            ),
        )
      }
    })
  const reconcileQueueEdit = (edit: QueueEdit, attempt: NonNullable<QueueEdit['attempt']>) =>
    mobileWorkflow(function* () {
      const query = new URLSearchParams({ scope: 'threads', history: 'paged', task: task.id })
      const fresh = yield* readEffect(`/api/snapshot?${query}`, undefined, snapshotSchema, 'GET')
      const message = fresh.workspace.tasks
        .find((thread) => thread.id === task.id)
        ?.queue?.find((item) => item.id === edit.messageId)
      const observed = observeQueueEdit(edit, attempt, message)
      if (observed === 'saved') yield* confirmQueueEdit(edit, attempt)
      else if (observed === 'original')
        yield* queueEdit.updateEffect((current) =>
          settleQueueEdit(current, edit.session, attempt, false),
        )
      else if (observed === 'removed')
        throw new Error('This message already started or was removed. Your edit was kept.')
      else throw new Error('This queued message changed on the computer. Your edit was kept.')
      return observed
    })
  useEffect(() => {
    const attempt = editing?.attempt
    if (!connected || !editing || !attempt || queueEditsInFlight.has(queueEdit.key)) return
    act(() => queueEditOperation(queueEdit.key, reconcileQueueEdit(editing, attempt)))
  }, [connected, editing?.attempt?.id, queueEdit.key])
  const saveQueueEdit = (editing: QueueEdit, text: string) =>
    queueEditOperation(
      queueEdit.key,
      mobileWorkflow(function* () {
        let edit = editing
        if (edit.attempt) {
          if ((yield* reconcileQueueEdit(edit, edit.attempt)) === 'saved') return
          const current = queueEdit.current()
          if (current?.session !== edit.session || current.version !== edit.version)
            throw new Error('The queued message edit changed. Review it and try again.')
          edit = current
        }
        const { input, attempt } = prepareQueueEdit(edit, task.id, text, randomUUID(), {
          attachments: snapshot?.fullTurnSettingsSupported === true,
          settings: snapshot?.queuedTurnSettingsSupported === true,
          plan: planSupported,
        })
        const staged = yield* queueEdit.updateEffect((current) =>
          current?.session === edit.session && current.version === edit.version && !current.attempt
            ? { ...current, draft: attempt.intended, attempt }
            : current,
        )
        if (staged?.attempt?.id !== attempt.id)
          throw new Error('The queued message edit changed. Review it and try again.')
        const result = yield* Effect.result(
          callEffect('/api/tasks/queue', input, responses.queueAction),
        )
        if (result._tag === 'Success' && result.success.ok) yield* confirmQueueEdit(edit, attempt)
        else if ((yield* reconcileQueueEdit(edit, attempt)) === 'original')
          return yield* Effect.fail(
            result._tag === 'Failure'
              ? result.failure
              : new Error('The queued edit was not saved.'),
          )
      }),
    )
  const submit = (
    mode: 'queue' | 'steer' | 'stage' | 'direct' = defaultSendMode,
    providedInput?: string,
    startInBackground?: (attemptId: string) => BackgroundStart,
  ) => {
    let submittedId: string | undefined
    let background: BackgroundStart | undefined
    let backgroundOutcome: Parameters<BackgroundStart['settled']>[0] = 'failed'
    return mobileWorkflow(function* () {
      if (startInBackground && (!canStartInBackground || mode !== 'queue'))
        return yield* Effect.fail(
          new Error('Resolve the earlier send before starting in background.'),
        )
      if (
        !connected &&
        (editing ||
          mode === 'steer' ||
          mode === 'direct' ||
          (task.autoProject && !snapshot?.messageSetupSupported))
      )
        return yield* Effect.fail(new Error('Connect to the computer before using this action.'))
      if (mode === 'direct' && snapshot?.directMessageSupported !== true)
        return yield* Effect.fail(
          new Error('Update the task computer to send without resuming the queue.'),
        )
      if (mode === 'stage' && !stageSupported)
        return yield* Effect.fail(new Error('Update the task computer to stage queued messages.'))
      if (storedDraft.pendingFork)
        return yield* Effect.fail(new Error('Resolve the pending fork before sending'))
      if (storedDraft.pendingRestore)
        return yield* Effect.fail(
          new Error('Resolve the pending queued-message restore before sending'),
        )
      if (attaching && (!attachmentPicker.canSubmitWhileUploading || attachmentPreviewBusy))
        return yield* Effect.fail(new Error('Finish preparing attachments before sending.'))
      if (attachmentPicker.failedUploads.length)
        return yield* Effect.fail(new Error('Retry or remove failed attachments before sending.'))
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
      if (planIssue) return yield* Effect.fail(new Error(planIssue))
      if (plan && mode === 'steer')
        return yield* Effect.fail(
          new Error('Queue this message to plan before the agent changes anything.'),
        )
      const draftKey = storedDraft.key
      if (!queueEdit.ready) throw new Error('Wait for the queued message edit to load.')
      // A pending older page must not replace the selected text during the native read.
      composerHistory.cancelLoad()
      const input =
        providedInput ??
        (yield* nativeEffect(() =>
          composerInput.current ? composerInput.current.readText() : Promise.resolve(draft.text),
        ))
      if (currentDraftKey.current !== draftKey || queueEdit.current()?.session !== editing?.session)
        return yield* Effect.fail(new Error('The thread changed before sending. Try Send again.'))
      const deferSend =
        (mode === 'queue' || mode === 'stage') &&
        (snapshot?.messageSetupSupported === true || !connected)
      if (editing) {
        yield* nativeEffect(() => attachmentPicker.waitForUploads(editing.draft.files))
        const current = queueEdit.current()
        if (current?.session !== editing.session || current.version !== editing.version)
          throw new Error('The queued message edit changed. Review it and try again.')
        return yield* saveQueueEdit(current, input)
      }
      if (composerHistory.active) {
        // Commit only after validation; cancelled browsing never overwrites the durable draft.
        updateDraft(input)
        latestDraftText.current = input
      }
      setSubmitting(true)
      dictation.reset()
      const text = input.trim(),
        attachmentIds = submissionFiles.map((file) => file.id)
      const attempt = sendAttempts.begin(scope, {
        text,
        attachmentIds,
        mode,
        runId: mode === 'steer' ? task.activeRunId : undefined,
        turnSettings: turnSettings ?? undefined,
        ...(plan ? { plan: true } : {}),
        preserveQueuePause:
          mode === 'queue' &&
          defaultSendMode !== 'stage' &&
          !task.queuePaused &&
          snapshot?.queuePausePreservationSupported === true,
      })
      if (firstMessage && !task.bot) {
        const summary =
          text ||
          `Work with attached files: ${task.draftAttachments?.map((file) => file.name).join(', ')}`
        sendAttempts.setTitle(
          scope,
          attempt.id,
          attempt.title ?? (summary.split('\n')[0]?.trim().slice(0, 80) || 'New thread'),
        )
      }
      submittedId = attempt.id
      // Start suppression only after admission and validation, using the stable retry identity.
      if (startInBackground) {
        background = startInBackground(attempt.id)
        backgroundLocked.current = true
        setBackgroundSubmitting(true)
      }
      yield* nativeEffect(() => attachmentPicker.waitForUploads(submissionFiles))
      const preparedInput =
        submissionFiles.length && composerInput.current
          ? yield* nativeEffect(() => composerInput.current!.readText())
          : latestDraftText.current
      if (currentDraftKey.current !== draftKey || queueEdit.current() || preparedInput !== input)
        throw new Error('The draft changed while preparing attachments. Review it and try again.')
      // Pending messages hide the input. Validate attachment preparation before clearing it.
      setPendingMessage({
        taskId: task.id,
        state: 'sending',
        destination: sendDestination(task, mode),
        message: {
          id: attempt.id,
          role: 'user',
          text,
          createdAt: new Date().toISOString(),
          attachments: submissionFiles,
          turnSettings: attempt.turnSettings,
          ...(attempt.plan ? { plan: true } : {}),
        },
      })
      yield* storedDraft.stageEffect(attempt)
      if (firstMessage && !task.bot && task.autoProject && !snapshot?.messageSetupSupported) {
        yield* callEffect(
          '/api/tasks/projects/select',
          { id: task.id, requestId: attempt.id, text: text || 'Work with the attached files' },
          taskSchema,
        )
      }
      if (firstMessage && !task.bot) {
        if (!snapshot?.messageSetupSupported)
          yield* patchEffect(
            {
              title: {
                before: task.title,
                after: attempt.title,
              },
            },
            false,
            deferSend,
          )
      }
      return yield* mobileWorkflow(function* () {
        let messageAcknowledged = false
        const request = callEffect(
          mode === 'steer' ? '/api/tasks/steer' : '/api/tasks/message',
          {
            id: task.id,
            messageId: attempt.id,
            ...(firstMessage && !task.bot && snapshot?.messageSetupSupported
              ? {
                  initialTitle: { before: task.title, after: attempt.title },
                  ...(task.autoProject ? { selectProject: true } : {}),
                }
              : {}),
            ...(mode === 'stage' ? { queueOnly: true } : {}),
            ...(mode === 'direct' ? { sendNow: true } : {}),
            ...(attempt.preserveQueuePause ? { preserveQueuePause: true } : {}),
            runId: attempt.runId,
            turnSettings: attempt.turnSettings,
            ...(attempt.plan ? { plan: true } : {}),
            text,
            attachmentIds,
          },
          responses.ok,
          undefined,
          { defer: deferSend },
        ).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              messageAcknowledged = !result.pending
              if (result.pending)
                setPendingMessage((pending) =>
                  pending?.message.id === attempt.id ? { ...pending, state: 'saved' } : pending,
                )
            }),
          ),
        )
        // Legacy requests retain their retry identity until acknowledged.
        // A deferred send has already committed to the durable outbox, so it can
        // release the composer without waiting for the network recovery worker.
        const clearDraft =
          background && !deferSend
            ? yield* request.pipe(
                Effect.flatMap(() =>
                  messageAcknowledged
                    ? sendAttempts.deliverEffect(scope, attempt, Effect.void)
                    : Effect.succeed(false),
                ),
              )
            : yield* sendAttempts.deliverEffect(scope, attempt, request)
        if (background && !messageAcknowledged && !deferSend) {
          backgroundOutcome = 'pending'
          return
        }
        // Keep builder intent across HTTP acceptance and the later authoritative snapshot.
        if (attempt.mode === 'stage')
          setStageIntents((current) => [
            ...current.filter((intent) => intent.scope !== pendingScope),
            {
              scope: pendingScope,
              messageId: attempt.id,
              wasRunning: task.status === 'running',
              runId: attempt.runId ?? task.activeRunId,
            },
          ])
        else if (attempt.mode === 'queue')
          setStageIntents((current) => current.filter((intent) => intent.scope !== pendingScope))
        yield* storedDraft.confirmEffect(attempt, clearDraft)
        if (firstMessage && !task.bot && messageAcknowledged && !snapshot?.messageSetupSupported)
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

        if (!latestDraftText.current.trim() || latestDraftText.current.trim() === attempt.text) {
          setTurnSettings((current) =>
            sameTurnSettings(current, attempt.turnSettings) ? null : current,
          )
          if (attempt.plan)
            setDraftPlan((current) => (current === !!attempt.plan ? false : current))
        }
        if (background && (messageAcknowledged || deferSend)) {
          yield* Effect.sync(background.confirmed)
          backgroundOutcome = 'confirmed'
        }
      }).pipe(
        Effect.catch((error) =>
          mobileWorkflow(function* () {
            failedSend.current = attempt
            return yield* Effect.fail(error)
          }),
        ),
      )
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          setSubmitting(false)
          if (background) {
            backgroundLocked.current = false
            setBackgroundSubmitting(false)
            background.settled(backgroundOutcome)
          }
        }),
      ),
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
          ...(restore.plan !== undefined && restore.draftPlan !== undefined
            ? { expectedPlan: restore.plan, expectedDraftPlan: restore.draftPlan }
            : {}),
        },
        responses.queueAction,
      )
      yield* storedDraft.confirmRestoreEffect(restore.requestId)
      if (currentDraftKey.current === key) {
        setTurnSettings((current) =>
          sameTurnSettings(current, restore.draftTurnSettings) ? restore.turnSettings : current,
        )
        if (restore.plan !== undefined)
          setDraftPlan((current) => (current === restore.draftPlan ? !!restore.plan : current))
      }
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
    composerInput,
    editing,
    restoreQueuedMessage: (message: NonNullable<Task['queue']>[number]) =>
      run(() =>
        mobileWorkflow(function* () {
          if (storedDraft.pendingFork) throw new Error('Resolve the pending fork first')
          if (editing || attaching || dictation.active || !storedDraft.ready)
            throw new Error('Finish editing or attaching files before returning a queued message')
          if (
            (storedDraft.text.trim() || task.draftAttachments?.length) &&
            !sameTurnSettings(message.turnSettings, draftTurnSettings)
          )
            throw new Error(
              'Clear the composer before restoring a message with different model settings',
            )
          if (
            (storedDraft.text.trim() || task.draftAttachments?.length) &&
            !!message.plan !== draftPlan
          )
            throw new Error(
              'Clear the composer before restoring a message with a different plan mode',
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
            // Decided once so every retry sends the same request to the same receipt.
            ...(snapshot.queueRestorePlanSupported ? { plan: !!message.plan, draftPlan } : {}),
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
      if (busy || attaching || !queueEdit.ready || editing || dictation.active) return
      const next = startQueueEdit(message, randomUUID())
      queueEdit.update((current) => current ?? next)
    },
    removeEditAttachment: (id: string) => {
      if (editing)
        updateEdit(editing.session, (draft) => ({
          ...draft,
          files: draft.files.filter((file) => file.id !== id),
        }))
    },
    cancelEdit: () => {
      if (!editing) return
      dictation.reset()
      act(() =>
        queueEdit.updateEffect((current) =>
          current?.session === editing.session ? undefined : current,
        ),
      )
      if (profile) reviewAttachments(profile)
    },
    turnSettings,
    setTurnSettings: (value: TurnSettings | null) => {
      if (editing) {
        updateEdit(editing.session, (draft) => ({ ...draft, settings: value }))
        return
      }
      setTurnSettings(value)
      act(() =>
        patchEffect({
          draftTurnSettings: { before: task.draftTurnSettings ?? null, after: value },
        }),
      )
    },
    plan,
    planSupported,
    planIssue,
    setPlan: (value: boolean) => {
      if (editing) {
        updateEdit(editing.session, (draft) => ({ ...draft, plan: value }))
        return
      }
      setDraftPlan(value)
      act(() => patchEffect({ draftPlan: { before: task.draftPlan ?? null, after: value } }))
    },
    threadScope: JSON.stringify([profile?.connection.address, profile?.connection.token, task.id]),
    pendingMessage,
    pendingMessages,
    draftAttachments: editing
      ? editing.draft.files
      : pendingMessage?.taskId === task.id && pendingMessage.state === 'sending'
        ? task.draftAttachments?.filter(
            (file) => !pendingMessage.message.attachments?.some((sent) => sent.id === file.id),
          )
        : task.draftAttachments,
    call,
    stopping: cancellation.busy,
    stop: () => {
      const runId = task.activeRunId
      const run = () => {
        if (currentStopScope.current !== stopScope) return
        return cancellation.run(() =>
          callEffect(
            '/api/tasks/cancel',
            {
              id: task.id,
              runId,
            },
            responses.ok,
          ),
        )
      }
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
    composerHistory,
    dictation,
    busy,
    // A later snapshot may also acknowledge a request after its HTTP error was displayed.
    error:
      policyIssue ||
      planIssue ||
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
    canStartInBackground,
    backgroundSubmitting,
    submitting,
    defaultSendMode,
    stageSupported,
    patch,
    submit,
  }
}
