import { useEffect, useState } from 'react'
import { activitySchema, useWorkspace } from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'
export function ActivityLog() {
  const { request, connected } = useWorkspace(),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<ReturnType<typeof activitySchema.parse>>({ events: [] }),
    [error, setError] = useState('')
  useEffect(() => {
    let stopped = false
    const load = () => {
      if (connected)
        void request('/api/activity', { query, offset }, activitySchema)
          .then((v) => {
            if (!stopped) {
              setData(v)
              setError('')
            }
          })
          .catch((e) => {
            if (!stopped) setError(String(e))
          })
    }
    const initial = setTimeout(load, 200),
      timer = setInterval(load, 10000)
    return () => {
      stopped = true
      clearTimeout(initial)
      clearInterval(timer)
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
