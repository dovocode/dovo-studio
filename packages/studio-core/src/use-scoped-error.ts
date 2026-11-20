import { useState } from 'react'

/** A late request failure belongs to the operation that started the request. */
export function useScopedError(scope: string | undefined) {
  const [state, setState] = useState(() => ({ scope, identity: {}, error: '' }))
  if (state.scope !== scope) setState({ scope, identity: {}, error: '' })
  return [
    state.scope === scope ? state.error : '',
    (error: string) => {
      setState((current) => (current.identity === state.identity ? { ...current, error } : current))
    },
  ] as const
}
