import {
  useCallback,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { updateTask, useWorkspace, type Task, type Workspace } from '@dovo/studio-core'
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

/** The parent keys the composer by task; cleanup always writes to that same task. */
export function useComposerDraft(
  task: Task,
  immediate = false,
  editController?: ReturnType<typeof createComposerDraft>,
) {
  const { setWorkspace } = useWorkspace()
  const [error, setError] = useState('')
  const report = useCallback((cause: unknown) => {
    setError(`Could not save the draft. ${String(cause)}`)
  }, [])
  const [savedController] = useState(() =>
    createComposerDraft(task.draft, saveDraft(setWorkspace, task.id), report),
  )
  const controller = editController ?? savedController
  useLayoutEffect(() => {
    savedController.rebind(saveDraft(setWorkspace, task.id))
  }, [savedController, setWorkspace, task.id])
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
    savedController.receive(task.draft)
  }, [savedController, task.draft])
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
    hasText,
    error,
    update,
    accept,
    appendOnce,
    flush,
  }
}
