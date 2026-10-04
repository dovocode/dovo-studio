import { Effect } from 'effect'
import { clientTaskScope, runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../../runtime/state/application-state'
import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRuntime } from '../../runtime/connection/provider'
import { AppState } from 'react-native'
import type { SendAttempt } from '../composer/send-attempts'
import { createDraftStorage, type DraftRecord } from './storage'
import { hydrateDraft } from './hydration'
const drafts = createDraftStorage(AsyncStorage)
export function saveRuntimeDraft(runtimeId: string, taskId: string, text: string) {
  return drafts.write(`dovo.draft.${encodeURIComponent(runtimeId)}.${taskId}`, text)
}
export function useDraft(taskId: string, initial = '', deliveredIds: readonly string[] = []) {
  const { activeId, legacyDraftRuntimeId } = useRuntime()
  const key = `dovo.draft.${encodeURIComponent(activeId ?? '')}.${taskId}`
  const migrateLegacy = !!activeId && activeId === legacyDraftRuntimeId
  // Only external edits are sent back to the native input; keyboard edits already live there.
  const [{ text, revision }, setDraft] = useState({ text: '', revision: 0 }),
    [loadedKey, setLoadedKey] = useApplicationState<string | null>(null),
    [submission, setSubmission] = useApplicationState<DraftRecord['submission']>(undefined),
    [error, setError] = useApplicationState('')
  const delivered = useRef(deliveredIds)
  delivered.current = deliveredIds
  const initialText = useRef(initial)
  initialText.current = initial
  const activeKey = useRef<string | null>(null)
  const editedKey = useRef<string | null>(null)
  const listener = useRef<((value: string) => void) | undefined>(undefined)
  useEffect(() => {
    const commands = clientTaskScope()
    let edited = false
    let disposed = false
    activeKey.current = key
    editedKey.current = null
    setLoadedKey(null)
    setSubmission(undefined)
    // Wait for the durable delivery record rather than flashing a server's stale pre-send draft.
    setDraft((previous) => ({ text: '', revision: previous.revision + 1 }))
    setError('')
    const receive = (value: string) => {
      edited = true
      setDraft((previous) => ({ text: value, revision: previous.revision + 1 }))
    }
    listener.current = receive
    const unsubscribe = drafts.subscribe(key, receive)
    void commands.run(
      hydrateDraft(
        drafts
          .readRecordEffect(
            key,
            migrateLegacy ? `dovo.draft.${taskId}` : undefined,
            () => delivered.current,
          )
          .pipe(
            Effect.tap((record) =>
              Effect.sync(() => {
                if (!disposed) setSubmission(record?.submission)
              }),
            ),
            Effect.map((record) => record?.text ?? null),
          ),
        {
          initial: () => initialText.current,
          edited: () => edited || editedKey.current === key,
        },
      ).pipe(
        Effect.tap((hydration) =>
          Effect.sync(() => {
            if (disposed) return
            const hydrated = hydration.text
            if (hydrated !== undefined)
              setDraft((previous) => ({ text: hydrated, revision: previous.revision + 1 }))
            setLoadedKey(key)
            setError(hydration.error)
          }),
        ),
        Effect.zipRight(
          drafts.flushEffect().pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                if (activeKey.current === key)
                  setError(`Could not save the recovered draft. ${String(error)}`)
              }),
            ),
          ),
        ),
      ),
    )
    return () => {
      disposed = true
      void commands.stop()
      activeKey.current = null
      listener.current = undefined
      unsubscribe()
    }
  }, [taskId, key, migrateLegacy])
  const report = (error: unknown) => {
    if (activeKey.current === key) setError(`Could not save the draft. ${String(error)}`)
  }
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return
      void runClientEffect(
        drafts.flushEffect().pipe(Effect.catchAll((error) => Effect.sync(() => report(error)))),
      )
    })
    return () => subscription.remove()
  }, [key])
  const update = useCallback(
    (value: string, source?: 'keyboard') => {
      if (activeKey.current === key) {
        editedKey.current = key
        setDraft((previous) => ({
          text: value,
          revision: previous.revision + (source === 'keyboard' ? 0 : 1),
        }))
      }
      void runClientEffect(
        // Own edits are already in React state. Persistence must not echo an older
        // keystroke into a controlled TextInput when its Effect starts later.
        drafts.writeEffect(key, value, listener.current).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              if (activeKey.current === key) setError(String(error))
            }),
          ),
        ),
      )
    },
    [key, setError],
  )
  return {
    text: loadedKey === key ? text : '',
    revision,
    key,
    update,
    ready: loadedKey === key,
    submission: loadedKey === key ? submission : undefined,
    stageEffect: (attempt: SendAttempt) =>
      drafts
        .stageEffect(key, attempt, text)
        .pipe(Effect.tapError((error) => Effect.sync(() => report(error)))),
    confirmEffect: (attempt: SendAttempt, clear: boolean) =>
      drafts
        .confirmEffect(key, attempt, clear)
        .pipe(Effect.catchAll((error) => Effect.sync(() => report(error)))),
    error,
  }
}
