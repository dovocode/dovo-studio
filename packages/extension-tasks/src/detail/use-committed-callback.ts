import { useLayoutEffect, useMemo, useRef } from 'react'

function dispatch<Args extends unknown[], Result>(ref: { current: (...args: Args) => Result }) {
  return (...args: Args) => ref.current(...args)
}

/** Event handlers keep their identity while releasing previous committed render scopes. */
export function useCommittedCallback<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
) {
  const latest = useRef(handler)
  useLayoutEffect(() => {
    latest.current = handler
  })
  return useMemo(() => dispatch(latest), [])
}
