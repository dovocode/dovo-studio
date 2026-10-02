import { useCallback, useEffect, useState, type SetStateAction } from 'react'
import { updateTask, useWorkspace, type Task } from '@dovo/studio-core'
import { createComposerDraft } from './composer-draft'

/** The parent keys the composer by task; cleanup always writes to that same task. */
export function useComposerDraft(task: Task) {
  const { setWorkspace } = useWorkspace()
  const [error, setError] = useState('')
  const report = useCallback((cause: unknown) => {
    setError(`Could not save the draft. ${String(cause)}`)
  }, [])
  const [controller] = useState(() =>
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
  const [text, setText] = useState(controller.text)
  const flush = () => {
    try {
      controller.flush()
      setError('')
    } catch (cause) {
      report(cause)
      throw cause
    }
  }
  useEffect(() => {
    setText(controller.receive(task.draft))
  }, [controller, task.draft])
  useEffect(
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
      setText(controller.update(next))
    },
    [controller],
  )
  const accept = useCallback(
    (submitted: string) => {
      try {
        controller.accept(submitted)
        setError('')
      } catch (cause) {
        report(cause)
      } finally {
        // Delivery succeeded even if persisting the cleared draft must be retried.
        setText(controller.text)
      }
    },
    [controller, report],
  )
  return {
    text,
    error,
    update,
    accept,
    flush,
  }
}
