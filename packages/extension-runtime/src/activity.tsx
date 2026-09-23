import { useApplicationState } from '@dovo/studio-core/state'
import { Effect, Schema } from 'effect'
import { useEffect } from 'react'
import { activitySchema, useWorkspace, startPolling } from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'
export function ActivityLog() {
  const { requestEffect: request, connected } = useWorkspace(),
    [query, setQuery] = useApplicationState(''),
    [offset, setOffset] = useApplicationState(0),
    [data, setData] = useApplicationState<Schema.Schema.Type<typeof activitySchema>>({
      events: [],
    }),
    [error, setError] = useApplicationState('')
  useEffect(() => {
    let stopped = false
    let first = true
    const load = Effect.gen(function* () {
      if (first) {
        first = false
        yield* Effect.sleep(200)
      }
      if (!connected || document.visibilityState !== 'visible') return
      const value = yield* request('/api/activity', { query, offset }, activitySchema)
      if (!stopped) {
        setData(value)
        setError('')
      }
    })
    const polling = startPolling(load, {
      interval: 10000,
      onError: (error) => {
        if (!stopped) setError(error.message)
      },
    })
    document.addEventListener('visibilitychange', polling.refresh)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', polling.refresh)
      void polling.stop()
    }
  }, [request, connected, query, offset])

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Activity & message history</h2>
      <Input
        aria-label="Search activity"
        placeholder="Search messages, tasks and commands…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOffset(0)
        }}
      />
      {error && <p role="alert">{error}</p>}
      <div className="max-h-96 overflow-auto">
        {data.events.map((e) => (
          <details key={e.id} className="border-b py-2 text-xs">
            <summary>
              {new Date(e.time).toLocaleString()} · {e.kind} · {e.summary}
            </summary>
            <pre className="overflow-auto whitespace-pre-wrap p-2">{e.payload}</pre>
          </details>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!offset} onClick={() => setOffset((v) => Math.max(0, v - 100))}>
          Newer
        </Button>
        <Button
          size="sm"
          disabled={data.events.length < 100}
          onClick={() => setOffset((v) => v + 100)}
        >
          Older
        </Button>
      </div>
    </section>
  )
}
