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
  // TextInput changes must batch with React Native's own native-event state.
  const [text, setText] = useState(''),
    [loadedKey, setLoadedKey] = useApplicationState<string | null>(null),
    [submission, setSubmission] = useApplicationState<DraftRecord['submission']>(undefined),
    [error, setError] = useApplicationState('')
  const delivered = useRef(deliveredIds)
  delivered.current = deliveredIds
  const initialText = useRef(initial)
  initialText.current = initial
  const activeKey = useRef<string | null>(null)
  useEffect(() => {
    const commands = clientTaskScope()
    let edited = false
    let disposed = false
    activeKey.current = key
    setLoadedKey(null)
    setSubmission(undefined)
    // Wait for the durable delivery record rather than flashing a server's stale pre-send draft.
    setText('')
    setError('')
    const unsubscribe = drafts.subscribe(key, (value) => {
      edited = true
      setText(value)
    })
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
          edited: () => edited,
        },
      ).pipe(
        Effect.tap((hydration) =>
          Effect.sync(() => {
            if (disposed) return
            if (hydration.text !== undefined) setText(hydration.text)
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
    (value: string) => {
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
    },
    [key, setText, setError],
  )
  return {
    text: loadedKey === key ? text : '',
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
