import { useEffect, useRef, useState } from 'react'
import type { AgentSecretReference } from '@dovo/protocol'

/** A check returns no secret. Configuration and connection changes invalidate pending replies. */
export function useSecretReferenceCheck(
  reference: AgentSecretReference,
  scope: string,
  check: (reference: AgentSecretReference) => Promise<unknown>,
) {
  const identity = JSON.stringify([scope, reference])
  const latest = useRef({ identity, generation: 0, busy: false })
  if (latest.current.identity !== identity)
    latest.current = { identity, generation: latest.current.generation + 1, busy: false }
  const generation = latest.current.generation
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [result, setResult] = useState({ generation: -1, busy: false, status: '' })
  return {
    busy: result.generation === generation && result.busy,
    status: result.generation === generation ? result.status : '',
    async run() {
      if (latest.current.busy) return
      latest.current.busy = true
      setResult({ generation, busy: true, status: '' })
      let status = 'Secret reference resolved'
      try {
        await check(reference)
      } catch {
        status =
          'Could not read this secret reference. Check its value and the secret manager login on this computer.'
      }
      if (mounted.current && latest.current.generation === generation) {
        latest.current.busy = false
        setResult({ generation, busy: false, status })
      }
    },
  }
}
