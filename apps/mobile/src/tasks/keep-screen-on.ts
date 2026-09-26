import { useEffect } from 'react'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useMobilePreferences } from '../runtime/app-preferences'

/** Settings → General → Keep the screen on while a task runs: only while that task is open and
 * working, so following a long turn doesn't lock the phone. */
export function useKeepScreenOn(taskId: string, active: boolean) {
  const { keepScreenOn, carMode } = useMobilePreferences()
  // Car mode always keeps a running task visible.
  const wanted = keepScreenOn || carMode
  useEffect(() => {
    if (!wanted || !active) return
    const tag = `dovo-task-${taskId}`
    activateKeepAwakeAsync(tag).catch(() => {})
    return () => {
      deactivateKeepAwake(tag).catch(() => {})
    }
  }, [wanted, active, taskId])
}
