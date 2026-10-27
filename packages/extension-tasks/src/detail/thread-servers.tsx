import { useEffect, useRef, useState } from 'react'
import { Globe, RefreshCw, Square } from 'lucide-react'
import { threadServersSchema, responses, type ThreadServer } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, IconButton } from '@dovo/studio-ui'
import { startLiveRefresh } from './live-refresh'

export function ThreadServers({
  taskId,
  onOpen,
}: {
  taskId: string
  onOpen: (url: string) => void
}) {
  const { request, connection, connected, snapshot } = useWorkspace()
  const scope = JSON.stringify([taskId, connection?.address, connection?.token])
  const [listing, setListing] = useState<{ scope: string; servers: ThreadServer[] }>({
    scope,
    servers: [],
  })
  const servers = listing.scope === scope ? listing.servers : []
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState<number | null>(null)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const revision = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setListing({ scope, servers: [] })
    setError('')
    setStopping(null)
    if (!connected || !snapshot?.threadServersSupported) return
    const stop = startLiveRefresh(
      async () => {
        const read = ++revision.current
        try {
          const result = await request('/api/terminals/servers', { taskId }, threadServersSchema)
          if (generation.current !== current || revision.current !== read) return
          setListing({ scope, servers: result.servers })
          setError('')
        } catch (cause) {
          if (generation.current === current && revision.current === read)
            setError(cause instanceof Error ? cause.message : String(cause))
        }
      },
      document,
      // Reads report their own failures with both owner and revision guards.
      () => {},
      5000,
    )
    return () => {
      generation.current++
      stop()
    }
  }, [
    taskId,
    connection?.address,
    connection?.token,
    connected,
    snapshot?.threadServersSupported,
    request,
    retry,
    scope,
  ])
  if (!servers.length && !error) return null
  const stopServer = async (server: ThreadServer) => {
    const current = generation.current
    if (stopping !== null || !connected) return
    setStopping(server.pid)
    revision.current++
    setError('')
    try {
      await request(
        '/api/terminals/servers/stop',
        { taskId, pid: server.pid, port: server.port, started: server.started },
        responses.ok,
      )
      if (generation.current !== current) return
      const read = ++revision.current
      const result = await request('/api/terminals/servers', { taskId }, threadServersSchema)
      if (generation.current === current && revision.current === read)
        setListing({ scope, servers: result.servers })
    } catch (cause) {
      if (generation.current === current)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generation.current === current) setStopping(null)
    }
  }
  return (
    <section
      aria-label="Running servers"
      className="studio-project-section border-t border-border/60"
    >
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Running servers
      </h3>
      {servers.map((server) => (
        <div
          key={`${server.pid}:${server.port}:${server.started}`}
          className="flex min-w-0 items-center gap-1"
        >
          <Button
            variant="ghost"
            size="sm"
            className="studio-project-row min-w-0 flex-1"
            disabled={!connected || !server.url}
            title={`${server.source === 'agent' ? 'Agent' : 'Terminal'} · ${server.name}`}
            onClick={() => server.url && onOpen(server.url)}
          >
            <Globe className="size-4 shrink-0" />
            <span className="truncate">localhost:{server.port}</span>
            <span className="ml-auto truncate text-[10px] text-muted-foreground">
              {server.source === 'agent' ? 'Agent' : 'Terminal'}
              {!server.url && ' · TCP'}
            </span>
          </Button>
          <IconButton
            className="size-8 shrink-0"
            label={`Stop localhost:${server.port}`}
            disabled={!connected || stopping !== null}
            onClick={() => void stopServer(server)}
          >
            <Square className="size-3" />
          </IconButton>
        </div>
      ))}
      {error && (
        <div role="status" className="mt-2 text-xs text-destructive">
          <p className="break-words">Could not refresh servers: {error}</p>
          <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>
            <RefreshCw className="size-3" /> Retry
          </Button>
        </div>
      )}
    </section>
  )
}
