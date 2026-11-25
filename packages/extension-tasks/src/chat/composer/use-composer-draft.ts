import {
  useCallback,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react'
import {
  composerRecoveryKey,
  createComposerRecovery,
  updateTask,
  useWorkspace,
  type Task,
  type Workspace,
} from '@dovo/studio-core'
import { taskDraftIdentity } from '@dovo/protocol'
import { createComposerDraft } from './composer-draft'
import { appendHandoff } from '../../detail/side-threads'

/**
 * Persist a composer draft. A send acknowledgement passes `expected`, so a delayed result
 * cannot replace a newer draft saved by a remounted composer or another route.
 */
export function saveDraft(setWorkspace: Dispatch<SetStateAction<Workspace>>, taskId: string) {
  return (draft: string, expected?: string) =>
    setWorkspace((workspace) =>
      updateTask(workspace, taskId, (current) =>
        expected !== undefined && current.draft !== expected ? current : { ...current, draft },
      ),
    )
}

/** The parent keys by runtime ID, address, credential and task; rebind stays in that scope. */
export function useComposerDraft(
  task: Task,
  temporary = false,
  editController?: ReturnType<typeof createComposerDraft>,
) {
  const { setWorkspace, connection, activeRuntimeId, flush: sync } = useWorkspace()
  const startupKey = composerRecoveryKey(connection, task.id, activeRuntimeId)
  const key = temporary ? startupKey : composerRecoveryKey(connection, task.id)
  const [error, setError] = useState('')
  const report = useCallback((cause: unknown) => {
    setError(`Could not save the draft. ${String(cause)}`)
  }, [])
  const [recovery] = useState<{ current: ReturnType<typeof createComposerRecovery> | null }>(() => {
    try {
      const current = createComposerRecovery(key, temporary ? task.repositoryId : undefined)
      if (key !== startupKey && current.checkpoint() === null) {
        const startup = createComposerRecovery(startupKey)
        if (startup.startup) return { current: startup }
      }
      return { current }
    } catch (cause) {
      report(cause)
      return { current: null }
    }
  })
  const [backup, setBackup] = useState(() =>
    recovery.current?.backup !== task.draft ? (recovery.current?.backup ?? '') : '',
  )
  const checkpoint = useCallback(() => recovery.current?.checkpoint() ?? null, [recovery])
  const showBackup =
    backup &&
    backup !== task.draft &&
    !task.queue?.some((message) => message.text === backup) &&
    !task.messages.some((message) => message.role === 'user' && message.text === backup)
  const discardRecovery = () => {
    try {
      recovery.current?.discardBackup()
      setBackup('')
    } catch (cause) {
      report(cause)
    }
  }
  const [savedController] = useState(() => {
    const value = createComposerDraft(
      task.draft,
      saveDraft(setWorkspace, task.id),
      report,
      (text, expected) => {
        recovery.current ??= createComposerRecovery(key, temporary ? task.repositoryId : undefined)
        const protectedDraft = recovery.current.protect(text, expected)
        if (protectedDraft) setError('')
        return protectedDraft
      },
    )
    if (
      recovery.current?.text !== null &&
      recovery.current?.text !== undefined &&
      recovery.current.text !== task.draft
    )
      value.update(recovery.current.text)
    return value
  })
  const controller = editController ?? savedController
  useLayoutEffect(() => {
    const write = saveDraft(setWorkspace, task.id)
    savedController.rebind((text, expected) => {
      write(text, expected)
      const checkpoint = recovery.current?.checkpoint() ?? null
      void sync(task.id).then(
        () => {
          try {
            recovery.current?.retire(checkpoint)
          } catch (cause) {
            report(cause)
          }
        },
        () => {
          // The workspace reports sync failures. The local recovery record stays intact.
        },
      )
    })
  }, [savedController, setWorkspace, task.id, recovery, sync, report])
  const hasText = useSyncExternalStore(
    controller.subscribe,
    () => !!controller.text.trim(),
    () => !!controller.text.trim(),
  )
  const flush = () => {
    try {
      controller.flush()
      setError('')
    } catch (cause) {
      report(cause)
      throw cause
    }
  }
  // Reconcile and flush during layout so remounts cannot paint an old debounced draft.
  useLayoutEffect(() => {
    const previous = savedController.text
    savedController.receive(
      task.draft,
      taskDraftIdentity(
        task.draft,
        task.draftAttachments?.map(({ id }) => id) ?? [],
        task.draftTurnSettings,
        task.draftPlan,
      ),
    )
    if (savedController.text !== previous) {
      // An accepted external workspace edit replaces this controller's old recovery text.
      // The workspace outbox owns that edit; do not replay the superseded record on reload.
      try {
        recovery.current?.retire(recovery.current.checkpoint())
      } catch (cause) {
        report(cause)
      }
    }
  }, [
    savedController,
    task.draft,
    task.draftAttachments,
    task.draftTurnSettings,
    task.draftPlan,
    recovery,
    report,
  ])
  useLayoutEffect(() => {
    const save = () => {
      try {
        controller.flush()
      } catch (cause) {
        report(cause)
      }
    }
    const hide = () => {
      if (document.visibilityState === 'hidden') save()
    }
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', hide)
    return () => {
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [controller, report])
  useLayoutEffect(
    () => () => {
      try {
        controller.flush()
      } catch (cause) {
        report(cause)
      }
    },
    [controller, report],
  )
  const update = useCallback(
    (value: SetStateAction<string>) => {
      const next = typeof value === 'function' ? value(controller.text) : value
      controller.update(next)
      if (temporary) controller.flush()
    },
    [controller, temporary],
  )
  const accept = useCallback(
    (
      submitted: string,
      revision?: number,
      identity?: string,
      submittedCheckpoint?: string | null,
    ) => {
      try {
        const previous = savedController.revision
        const currentCheckpoint = checkpoint()
        savedController.accept(submitted, revision, identity)
        if (submittedCheckpoint != null && recovery.current?.retire(submittedCheckpoint, submitted))
          setBackup((current) => (current.trim() === submitted.trim() ? '' : current))
        else if (identity !== undefined && savedController.revision !== previous)
          recovery.current?.retire(currentCheckpoint)
        setError('')
      } catch (cause) {
        report(cause)
      }
    },
    [savedController, checkpoint, recovery, report],
  )
  // Handoffs always target the saved draft, even while a queued message is being edited, and
  // persist immediately on top of any local edits the runtime has not seen yet.
  const appendOnce = useCallback(
    (text: string) => {
      const next = appendHandoff(savedController.text, text)
      try {
        if (next !== savedController.text) savedController.update(next)
        savedController.flush()
        setError('')
        return true
      } catch (cause) {
        report(cause)
        return false
      }
    },
    [savedController, report],
  )
  return {
    controller,
    recoveryText: showBackup ? backup : '',
    discardRecovery,
    checkpoint,
    hasText,
    error,
    update,
    accept,
    appendOnce,
    flush,
  }
}
