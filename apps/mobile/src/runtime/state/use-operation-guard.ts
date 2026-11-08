import { useEffect, useRef } from 'react'

/** An old operation cannot take over navigation after its source changes or unmounts. */
export function useOperationGuard(scope: string) {
  const active = useRef({ scope })
  if (active.current.scope !== scope) active.current = { scope }
  const origin = active.current
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return () => mounted.current && active.current === origin
}
