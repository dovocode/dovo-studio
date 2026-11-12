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
  immediate = false,
  editController?: ReturnType<typeof createComposerDraft>,
) {
  const { setWorkspace, connection, flush: sync } = useWorkspace()
  const key = composerRecoveryKey(connection, task.id)
  const [error, setError] = useState('')
  const report = useCallback((cause: unknown) => {
    setError(`Could not save the draft. ${String(cause)}`)
  }, [])
  const [recovery] = useState<{ current: ReturnType<typeof createComposerRecovery> | null }>(() => {
    try {
      return { current: createComposerRecovery(key) }
    } catch (cause) {
      report(cause)
      return { current: null }
    }
  })
  const [recoveryText, setRecoveryText] = useState(() =>
    recovery.current?.backup !== task.draft ? (recovery.current?.backup ?? '') : '',
  )
  const discardRecovery = () => {
    try {
      recovery.current?.discardBackup()
      setRecoveryText('')
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
        recovery.current ??= createComposerRecovery(key)
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
    savedController.receive(task.draft)
    if (savedController.text !== previous) {
      // An accepted external workspace edit replaces this controller's old recovery text.
      // The workspace outbox owns that edit; do not replay the superseded record on reload.
      try {
        recovery.current?.retire(recovery.current.checkpoint())
      } catch (cause) {
        report(cause)
      }
    }
  }, [savedController, task.draft, recovery, report])
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
      if (immediate) controller.flush()
    },
    [controller, immediate],
  )
  const accept = useCallback(
    (submitted: string, revision?: number) => {
      try {
        savedController.accept(submitted, revision)
        setError('')
      } catch (cause) {
        report(cause)
      }
    },
    [savedController, report],
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
    recoveryText,
    discardRecovery,
    hasText,
    error,
    update,
    accept,
    appendOnce,
    flush,
  }
}
