import {
  useCallback,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from 'react'
import { updateTask, useWorkspace, type Task } from '@dovo/studio-core'
import { createComposerDraft } from './composer-draft'

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
    createComposerDraft(
      task.draft,
      (draft) => {
        setWorkspace((workspace) =>
          updateTask(workspace, task.id, (current) => ({ ...current, draft })),
        )
      },
      report,
    ),
  )
  const controller = editController ?? savedController
  useLayoutEffect(() => {
    savedController.rebind((draft) => {
      setWorkspace((workspace) =>
        updateTask(workspace, task.id, (current) => ({ ...current, draft })),
      )
    })
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
    (submitted: string) => {
      try {
        savedController.accept(submitted)
        setError('')
      } catch (cause) {
        report(cause)
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
    flush,
  }
}
