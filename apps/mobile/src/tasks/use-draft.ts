import { Effect } from 'effect'
import { clientTaskScope, runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRuntime } from '../runtime/provider'
import { createDraftStorage } from './draft-storage'
const drafts = createDraftStorage(AsyncStorage)
export function saveRuntimeDraft(runtimeId: string, taskId: string, text: string) {
  return drafts.write(`dovo.draft.${encodeURIComponent(runtimeId)}.${taskId}`, text)
}
export function useDraft(taskId: string, initial = '') {
  const { activeId, legacyDraftRuntimeId } = useRuntime()
  const key = `dovo.draft.${encodeURIComponent(activeId ?? '')}.${taskId}`
  const migrateLegacy = !!activeId && activeId === legacyDraftRuntimeId
  const [text, setText] = useApplicationState(''),
    [ready, setReady] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const initialText = useRef(initial)
  const activeKey = useRef<string | null>(null)
  useEffect(() => {
    const commands = clientTaskScope()
    let edited = false
    activeKey.current = key
    setReady(false)
    setError('')
    const unsubscribe = drafts.subscribe(key, (value) => {
      edited = true
      setText(value)
    })
    void commands.run(
      drafts.readEffect(key, migrateLegacy ? `dovo.draft.${taskId}` : undefined).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            if (!edited) setText(value ?? initialText.current)
            setReady(true)
          }),
        ),
        Effect.catchAll((error) => Effect.sync(() => setError(String(error)))),
      ),
    )
    return () => {
      void commands.stop()
      activeKey.current = null
      unsubscribe()
    }
  }, [taskId, key, migrateLegacy])
  const update = (value: string) => {
    if (activeKey.current === key) setText(value)
    void runClientEffect(
      drafts.writeEffect(key, value).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            if (activeKey.current === key) setError(String(error))
          }),
        ),
      ),
    )
  }
  return {
    text,
    update,
    ready,
    error,
  }
}
