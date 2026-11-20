import { useEffect, useRef } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'

export function useForegroundCompletion(
  visible: boolean,
  completion: string,
  identity: string,
  unread: boolean,
  write: () => Promise<void>,
) {
  const [failure, setFailure] = useApplicationState<{
    identity: string
    message: string
  } | null>(null)
  const [attempt, setAttempt] = useApplicationState(0)
  const attempted = useRef('')
  useEffect(() => {
    if (!visible) {
      attempted.current = ''
      return
    }
    let stopped = false
    let pending = false
    let acknowledged = false
    const modalOpen = () =>
      [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
        (dialog) => dialog.getClientRects().length > 0,
      )
    let covered = modalOpen()
    const acknowledge = async () => {
      if (
        stopped ||
        pending ||
        acknowledged ||
        attempted.current === completion ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus() ||
        modalOpen()
      )
        return
      // Preserve an explicit Mark unread action until the view is revisited.
      // Snapshot updates alone must not acknowledge the same completion again.
      attempted.current = completion
      if (!unread) return
      pending = true
      try {
        await write()
        acknowledged = true
        if (!stopped) setFailure(null)
      } catch (error) {
        if (!stopped)
          setFailure({
            identity,
            message: error instanceof Error ? error.message : String(error),
          })
      } finally {
        pending = false
      }
    }
    const onVisible = () => void acknowledge()
    const onInactive = () => {
      attempted.current = ''
      acknowledged = false
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onVisible()
      else onInactive()
    }
    onVisible()
    window.addEventListener('focus', onVisible)
    window.addEventListener('blur', onInactive)
    document.addEventListener('visibilitychange', onVisibilityChange)
    // A modal can close without a window-focus event. Retry only when it reveals the view,
    // not on every DOM mutation (including an acknowledgement failure message).
    const observer = new MutationObserver(() => {
      const next = modalOpen()
      if (covered && !next) onVisible()
      covered = next
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'hidden', 'data-state'],
    })
    return () => {
      stopped = true
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('blur', onInactive)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      observer.disconnect()
    }
  }, [write, visible, unread, identity, completion, attempt])
  return {
    error: unread && failure?.identity === identity ? failure.message : '',
    retry: () => {
      attempted.current = ''
      setAttempt((value) => value + 1)
    },
  }
}
