import { ZodError } from 'zod'
import { useRef, useState } from 'react'
export function useAction() {
  const running = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const run = (work: () => Promise<unknown>) => {
    if (running.current) return Promise.resolve()
    running.current = true
    setBusy(true)
    setError('')
    return Promise.resolve()
      .then(work)
      .catch((error) =>
        setError(
          error instanceof ZodError
            ? [...new Set(error.issues.map((issue) => issue.message))].join('\n')
            : error instanceof Error
              ? error.message
              : String(error),
        ),
      )
      .finally(() => {
        running.current = false
        setBusy(false)
      })
  }
  const act = (work: () => Promise<unknown>) => {
    void run(work)
  }
  return { busy, error, act, run }
}
