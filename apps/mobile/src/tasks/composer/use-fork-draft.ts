import { useEffect, useRef } from 'react'
import { Alert } from 'react-native'
import { Schema } from 'effect'
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto'
import { mutableStruct, taskForkResultSchema, type Task, type TurnSettings } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'
import { mobileWorkflow, nativeEffect } from '../../runtime/state/native-effect'
import { useAction } from '../../ui/controls/use-action'
import type { useDraft } from '../draft/use-draft'
import type { PendingFork } from '../draft/storage'

type ForkDraft = Pick<
  ReturnType<typeof useDraft>,
  | 'key'
  | 'ready'
  | 'text'
  | 'pendingFork'
  | 'pendingRestore'
  | 'stageForkEffect'
  | 'confirmForkEffect'
  | 'finishForkEffect'
  | 'discardForkEffect'
>

/** A fork's delivery identity belongs to its original computer/thread, beyond a mount. */
export function useForkDraft({
  task,
  draft,
  disabled,
  turnSettings,
}: {
  task: Task
  draft: ForkDraft
  disabled: boolean
  turnSettings: TurnSettings | null
}) {
  const { connected, profile, activeId, callEffect } = useRuntime()
  const { navigate } = useNavigation()
  const action = useAction()
  const current = useRef({ task, key: draft.key, activeId })
  current.current = { task, key: draft.key, activeId }
  const tried = useRef(new Set<string>())
  const connection = JSON.stringify([profile?.connection.address, profile?.connection.token])
  useEffect(() => tried.current.clear(), [draft.key, connection])
  const identity = () =>
    nativeEffect(() => digestStringAsync(CryptoDigestAlgorithm.SHA256, connection))
  const deliver = (saved: PendingFork) =>
    mobileWorkflow(function* () {
      if (saved.sourceTaskId !== task.id || saved.connection !== (yield* identity()))
        throw new Error(
          'This saved fork belongs to the original computer connection. Reconnect it or discard the fork request.',
        )
      // The original text and files must survive before the runtime can create anything.
      let fork = yield* draft.stageForkEffect(saved)
      if (!fork.accepted) {
        const result = yield* callEffect(
          '/api/tasks/start-fork',
          {
            id: fork.sourceTaskId,
            forkId: fork.id,
            text: fork.text,
            attachmentIds: fork.attachmentIds,
          },
          taskForkResultSchema,
        )
        if (result.id !== fork.id)
          throw new Error('The computer returned a different fork. The saved request was kept.')
        fork = (yield* draft.confirmForkEffect(fork.id)) ?? { ...fork, accepted: true }
      }
      // Retain source files until the runtime confirms; its idempotent replay compares
      // their original bytes. Only consume submitted files, preserving newly added ones.
      const source = current.current
      if (source.key !== draft.key || source.activeId !== activeId) return
      const files = source.task.draftAttachments ?? []
      const remaining = files.filter((file) => !fork.attachmentIds.includes(file.id))
      if (remaining.length !== files.length)
        yield* callEffect(
          '/api/workspace',
          {
            collection: 'tasks',
            id: fork.sourceTaskId,
            changes: { draftAttachments: { before: files, after: remaining } },
          },
          mutableStruct({ revision: Schema.Number }),
          'PATCH',
        )
      yield* draft.finishForkEffect(fork.id)
      if (current.current.key === draft.key && current.current.activeId === activeId)
        navigate('tasks', fork.id, activeId ?? undefined)
    })
  useEffect(() => {
    const pending = draft.pendingFork
    if (!pending || !draft.ready) return
    if (!connected) {
      tried.current.delete(pending.id)
      return
    }
    if (action.busy || disabled || tried.current.has(pending.id)) return
    tried.current.add(pending.id)
    void action.run(() => deliver(pending))
  }, [draft.pendingFork, draft.ready, draft.key, connection, connected, action.busy, disabled])
  const start = () => {
    if (
      !connected ||
      disabled ||
      action.busy ||
      !draft.ready ||
      turnSettings ||
      draft.pendingRestore
    )
      return
    const text = draft.text.trim()
    const attachmentIds = task.draftAttachments?.map((file) => file.id) ?? []
    if (!text && !attachmentIds.length) return
    action.act(() =>
      mobileWorkflow(function* () {
        const pending = draft.pendingFork ?? {
          id: randomUUID(),
          sourceTaskId: task.id,
          text,
          draftText: draft.text,
          attachmentIds,
          connection: yield* identity(),
          accepted: false,
        }
        tried.current.add(pending.id)
        yield* deliver(pending)
      }),
    )
  }
  return {
    ...action,
    start,
    pending: draft.pendingFork,
    retry: () => {
      const pending = draft.pendingFork
      if (pending && connected && !disabled) action.act(() => deliver(pending))
    },
    discard: () => {
      const pending = draft.pendingFork
      if (!pending) return
      Alert.alert(
        'Discard pending fork?',
        'The computer may already have created this fork. Check its threads before starting another. Your current draft will be kept.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard request',
            style: 'destructive',
            onPress: () => action.act(() => draft.discardForkEffect(pending.id)),
          },
        ],
      )
    },
  }
}
