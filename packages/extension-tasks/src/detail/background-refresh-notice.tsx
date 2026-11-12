import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type Issue = { label: string; error: string; retry: () => Promise<void> }
type Registry = { issues: Record<string, Issue>; register: (id: string, issue?: Issue) => void }
const Context = createContext<Registry | null>(null)

/** Keep refresh feedback within the current thread and connection. */
export function BackgroundRefreshProvider({ children }: { children: ReactNode }) {
  const [issues, setIssues] = useState<Record<string, Issue>>({})
  const register = useCallback((id: string, issue?: Issue) => {
    setIssues((current) => {
      const next = { ...current }
      if (issue) next[id] = issue
      else delete next[id]
      return next
    })
  }, [])
  const value = useMemo(() => ({ issues, register }), [issues, register])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function BackgroundRefreshIssue({ label, error, retry }: Issue) {
  const context = useContext(Context)
  const register = context?.register
  const id = useId()
  useEffect(() => {
    if (!register || !error) return
    register(id, { label, error, retry })
    return () => register(id)
  }, [register, id, label, error, retry])
  return !context && error ? <Notice issues={[{ label, error, retry }]} /> : null
}

export function BackgroundRefreshNotice() {
  const context = useContext(Context)
  return <Notice issues={Object.values(context?.issues ?? {})} />
}

function Notice({ issues }: { issues: Issue[] }) {
  const [busy, setBusy] = useState(false)
  if (!issues.length) return null
  return (
    <div role="status" className="flex items-start gap-2 px-4 py-1.5 text-xs text-muted-foreground">
      <details className="min-w-0 flex-1">
        <summary className="cursor-pointer">
          Some information could not refresh. View details
        </summary>
        <ul className="mt-1 space-y-1 break-words">
          {issues.map((issue, index) => (
            <li key={index}>
              {issue.label}: {issue.error}
            </li>
          ))}
        </ul>
      </details>
      <button
        type="button"
        className="shrink-0 underline disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await Promise.allSettled(issues.map((issue) => issue.retry()))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  )
}
