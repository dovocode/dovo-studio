import { useApplicationState } from '@dovo/studio-core/state'
import { Effect, Schema } from 'effect'
import { useEffect, useState } from 'react'
import {
  activitySchema,
  useWorkspace,
  startPolling,
  formatDateTime,
  useAppPreferences,
} from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'
export function ActivityLog() {
  const { showToolDetails } = useAppPreferences()
  const { requestEffect: request, connected } = useWorkspace(),
    [query, setQuery] = useApplicationState(''),
    [offset, setOffset] = useApplicationState(0),
    [data, setData] = useApplicationState<Schema.Schema.Type<typeof activitySchema>>({
      events: [],
    }),
    [error, setError] = useApplicationState('')
  const [loading, setLoading] = useApplicationState(connected)
  // Search as typed, but query the runtime once the user pauses instead of per keystroke.
  const [search, setSearch] = useState(query)
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 300)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    let stopped = false
    let first = true
    setLoading(connected)
    const load = Effect.gen(function* () {
      if (first) {
        first = false
        yield* Effect.sleep(200)
      }
      if (!connected || document.visibilityState !== 'visible') return
      const value = yield* request(
        '/api/activity',
        { query: search, offset, includeDetails: showToolDetails },
        activitySchema,
      )
      if (!stopped) {
        setData(value)
        setError('')
        setLoading(false)
      }
    })
    const polling = startPolling(load, {
      interval: 10000,
      onError: (error) => {
        if (!stopped) {
          setError(error.message)
          setLoading(false)
        }
      },
    })
    document.addEventListener('visibilitychange', polling.refresh)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', polling.refresh)
      void polling.stop()
    }
  }, [request, connected, search, offset, showToolDetails])

  return (
    <section className="space-y-3" aria-label="Recorded activity">
      <div>
        <h2 className="text-sm font-semibold">Recorded activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Recent requests, messages and commands. Expand an entry to see its details.
        </p>
      </div>
      <Input
        aria-label="Search activity"
        placeholder="Search messages, tasks and commands…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOffset(0)
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!connected && (
        <p role="status" className="text-xs text-muted-foreground">
          Offline · Reconnect this computer to load activity.
        </p>
      )}
      {loading && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading activity…
        </p>
      )}
      {!loading && connected && !error && !data.events.length && (
        <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">
          {query.trim()
            ? 'No activity matches your search.'
            : offset
              ? 'No older activity.'
              : 'No activity recorded yet.'}
        </p>
      )}
      <div
        className="max-h-96 overflow-auto rounded-lg border bg-card px-4"
        aria-busy={loading}
        tabIndex={data.events.length ? 0 : undefined}
        role="region"
        aria-label="Activity entries"
      >
        {data.events.map((e) => (
          <details key={e.id} className="border-b py-2 text-xs">
            <summary className="cursor-pointer break-words py-1 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
              {formatDateTime(e.time)} · {e.kind} · {e.summary}
            </summary>
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3">
              {e.payload}
            </pre>
          </details>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!offset || loading || !connected}
          onClick={() => setOffset((v) => Math.max(0, v - 100))}
        >
          Newer
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={data.events.length < 100 || loading || !connected}
          onClick={() => setOffset((v) => v + 100)}
        >
          Older
        </Button>
        {!!data.events.length && (
          <span className="ml-auto text-xs text-muted-foreground">
            Entries {offset + 1}–{offset + data.events.length}
          </span>
        )}
      </div>
    </section>
  )
}
