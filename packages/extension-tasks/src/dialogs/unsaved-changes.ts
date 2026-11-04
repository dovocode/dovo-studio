import { useConfirmation } from '@dovo/studio-core'
import { useRef } from 'react'

/** Keep edits until the caller accepts discarding this project's draft. */
export function useConfirmDiscardChanges(projectId: string, subject: string, draft: string) {
  const confirm = useConfirmation(JSON.stringify([projectId, draft]))
  const pending = useRef(false)
  return async (dirty: boolean) => {
    if (pending.current) return false
    if (!dirty) return true
    pending.current = true
    try {
      return await confirm({
        title: `Discard ${subject} changes?`,
        description: 'Your unsaved edits will be lost.',
        confirmLabel: 'Discard changes',
        destructive: true,
      })
    } finally {
      pending.current = false
    }
  }
}
