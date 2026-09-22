import { useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRuntime } from '../runtime/provider'
import { createDraftStorage } from './draft-storage'

const drafts = createDraftStorage(AsyncStorage)

export function useDraft(taskId: string, initial = '') {
  const { activeId, legacyDraftRuntimeId } = useRuntime()
  const key = `dovo.draft.${encodeURIComponent(activeId ?? '')}.${taskId}`
  const migrateLegacy = !!activeId && activeId === legacyDraftRuntimeId
  const [text, setText] = useState(''),
    [ready, setReady] = useState(false),
    [error, setError] = useState('')
  const initialText = useRef(initial)
  const activeKey = useRef<string | null>(null)
  useEffect(() => {
    let stopped = false,
      edited = false
    activeKey.current = key
    setReady(false)
    setError('')
    const unsubscribe = drafts.subscribe(key, (value) => {
      edited = true
      setText(value)
    })
    void drafts
      .read(key, migrateLegacy ? `dovo.draft.${taskId}` : undefined)
      .then((value) => {
        if (!stopped) {
          if (!edited) setText(value ?? initialText.current)
          setReady(true)
        }
      })
      .catch((error) => {
        if (!stopped) setError(String(error))
      })
    return () => {
      stopped = true
      activeKey.current = null
      unsubscribe()
    }
  }, [taskId, key, migrateLegacy])
  const update = (value: string) => {
    if (activeKey.current === key) setText(value)
    void drafts.write(key, value).catch((error) => {
      if (activeKey.current === key) setError(String(error))
    })
  }
  return { text, update, ready, error }
}
