import { useEffect, useRef } from 'react'

function localStore() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const attempts = new Map<string, { id: string; objective: string }>()

/** Journal creation before sending, retaining the ID after an uncertain response or remount. */
export function prepareSideThread(scope: string, id: string, objective = '') {
  const key = `dovo.sideThreadCreation.${scope}`
  let saved = attempts.get(key)
  const raw = localStore()?.getItem(key)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (
        parsed &&
        typeof parsed === 'object' &&
        'id' in parsed &&
        typeof parsed.id === 'string' &&
        'objective' in parsed &&
        typeof parsed.objective === 'string'
      )
        saved = { id: parsed.id, objective: parsed.objective }
    } catch {
      /* A malformed journal cannot identify a request. */
    }
  }
  const next = saved?.objective === objective ? saved : { id, objective }
  localStore()?.setItem(key, JSON.stringify(next))
  attempts.set(key, next)
  return next.id
}

export function finishSideThread(scope: string, id: string) {
  const key = `dovo.sideThreadCreation.${scope}`
  if (attempts.get(key)?.id !== id) return
  localStore()?.removeItem(key)
  attempts.delete(key)
}

/** Invalidates an operation after switching away and back, as well as after unmount. */
export function useSideThreadSource(scope: string) {
  const source = useRef({ scope })
  if (source.current.scope !== scope) source.current = { scope }
  const origin = source.current
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return () => mounted.current && source.current === origin
}
