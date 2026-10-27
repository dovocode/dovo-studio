import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Effect } from 'effect'
import { startPolling, runClientEffect } from '@dovo/client-runtime'
import { threadServersSchema, responses, type ThreadServer } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAppActive } from '../../runtime/state/app-active'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

export function ThreadServers({
  taskId,
  onOpen,
}: {
  taskId: string
  onOpen: (url: string) => void
}) {
  const { connected, profile, readEffect, callEffect, snapshot } = useRuntime()
  const foreground = useAppActive()
  const { styles } = useTheme()
  const scope = JSON.stringify([
    taskId,
    profile?.id,
    profile?.connection.address,
    profile?.connection.token,
  ])
  const [listing, setListing] = useState<{ scope: string; servers: ThreadServer[] }>({
    scope,
    servers: [],
  })
  const servers = listing.scope === scope ? listing.servers : []
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const reads = useRef<ReturnType<typeof startPolling> | null>(null)
  useEffect(() => {
    const current = ++generation.current
    setListing({ scope, servers: [] })
    setError('')
    setBusy(false)
    if (!connected || !foreground || !snapshot?.threadServersSupported) return
    const polling = startPolling(
      readEffect('/api/terminals/servers', { taskId }, threadServersSchema).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (generation.current !== current) return
            setListing({ scope, servers: result.servers })
            setError('')
          }),
        ),
        Effect.asVoid,
      ),
      {
        interval: 5000,
        onError: (cause) => {
          if (generation.current === current) setError(String(cause))
        },
      },
    )
    reads.current = polling
    return () => {
      generation.current++
      reads.current = null
      void polling.stop()
    }
  }, [
    taskId,
    profile?.id,
    profile?.connection.address,
    profile?.connection.token,
    connected,
    foreground,
    snapshot?.threadServersSupported,
    readEffect,
    retry,
    scope,
  ])
  if (!servers.length && !error) return null
  const stop = (server: ThreadServer) => {
    if (busy || !connected) return
    const current = generation.current
    setBusy(true)
    setError('')
    void runClientEffect(
      callEffect(
        '/api/terminals/servers/stop',
        { taskId, pid: server.pid, port: server.port, started: server.started },
        responses.ok,
      ),
    )
      .then(() => {
        if (current === generation.current) reads.current?.refresh()
      })
      .catch((cause: unknown) => {
        if (current === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (current === generation.current) setBusy(false)
      })
  }
  return (
    <View accessibilityLabel="Running servers" style={{ gap: 8 }}>
      <Text style={styles.muted}>Running servers</Text>
      {servers.map((server) => (
        <View key={`${server.pid}:${server.port}:${server.started}`} style={{ gap: 4 }}>
          <Text style={styles.muted}>
            {server.source === 'agent' ? 'Agent' : 'Terminal'} · {server.name}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Action
              label={`Open localhost:${server.port}`}
              disabled={!connected || !server.url}
              onPress={() => server.url && onOpen(server.url)}
            />
            <Action
              label={`Stop localhost:${server.port}`}
              disabled={!connected || busy}
              onPress={() => stop(server)}
            />
          </View>
        </View>
      ))}
      {error && (
        <>
          <Text style={styles.error}>Could not refresh servers: {error}</Text>
          <Action label="Retry servers" onPress={() => setRetry((value) => value + 1)} />
        </>
      )}
    </View>
  )
}
