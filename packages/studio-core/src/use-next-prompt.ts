import { useEffect, useState, useRef, useCallback } from 'react'
import { promptSuggestionSchema, canSuggestNextPrompt, type Task } from '@dovo/protocol'

/** Ask only for a visible, empty human thread. The runtime coalesces requests per turn. */
export function useNextPrompt({
  task,
  enabled,
  scope,
  request,
}: {
  task: Task
  enabled: boolean
  scope: string
  request: (
    path: string,
    input: unknown,
    schema: typeof promptSuggestionSchema,
  ) => Promise<typeof promptSuggestionSchema.Type>
}) {
  const turn = task.turns?.at(-1)
  const key = JSON.stringify([scope, task.id, turn?.id])
  const [result, setResult] = useState({ key: '', text: '', error: '' })
  const [dismissed, setDismissed] = useState('')
  const eligible = enabled && canSuggestNextPrompt(task)
  const requests = useRef(new Map<string, Promise<typeof promptSuggestionSchema.Type>>())
  useEffect(() => {
    if (!eligible || dismissed === key) return
    let stopped = false
    let pending = requests.current.get(key)
    if (!pending) {
      pending = request(
        '/api/tasks/prompt-suggestion',
        { id: task.id, turnId: turn!.id },
        promptSuggestionSchema,
      )
      requests.current.set(key, pending)
      if (requests.current.size > 50) requests.current.delete(requests.current.keys().next().value!)
    }
    void pending.then(
      (value) => {
        if (!stopped) setResult({ key, text: value.text, error: '' })
      },
      (cause: unknown) => {
        if (!stopped) setResult({ key, text: '', error: String(cause) })
      },
    )
    return () => {
      stopped = true
    }
  }, [eligible, dismissed, key, request])
  const dismiss = useCallback(() => setDismissed(key), [key])
  return {
    text: eligible && dismissed !== key && result.key === key ? result.text : '',
    error: eligible && result.key === key ? result.error : '',
    dismiss,
  }
}
