import {
  adapterDiagnosticsSchema,
  codexNetworkDiagnosticSchema,
  type CodexNetworkDiagnostic,
  type AdapterDiagnostic,
} from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace, useAppPreferences } from '@dovo/studio-core'
import { Button } from './components/ui/button'
import { useCallback, useEffect, useRef } from 'react'
export function HarnessUpdates() {
  const { providerUpdateChecks } = useAppPreferences()
  const { connected, request, workspace } = useWorkspace()
  const [items, setItems] = useApplicationState<AdapterDiagnostic[]>([])
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [network, setNetwork] = useApplicationState<CodexNetworkDiagnostic | undefined>(undefined)
  const [networkAgentId, setNetworkAgentId] = useApplicationState('')
  const codexAgents = workspace.agents.filter((agent) => agent.provider === 'codex')
  const [networkBusy, setNetworkBusy] = useApplicationState(false)
  const generation = useRef(0)
  const check = useCallback(async () => {
    const attempt = ++generation.current
    setBusy(true)
    setError('')
    try {
      const value = await request(
        '/api/agents/updates',
        { checkUpdates: providerUpdateChecks },
        adapterDiagnosticsSchema,
      )
      if (attempt === generation.current) setItems(value)
    } catch (error) {
      if (attempt === generation.current) setError(String(error))
    } finally {
      if (attempt === generation.current) setBusy(false)
    }
  }, [request, providerUpdateChecks])
  useEffect(() => {
    if (connected) void check()
    return () => {
      generation.current++
    }
  }, [connected, check])
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">Provider diagnostics</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy}
          onClick={() => void check()}
        >
          {busy
            ? 'Checking…'
            : providerUpdateChecks
              ? 'Check for updates'
              : 'Check installed versions'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Checks installed versions on this server. Updates are installed separately on the host;
        bundled SDKs update with Dovo.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <select
        aria-label="Codex diagnostic profile"
        className="h-8 rounded-md border bg-background px-2 text-xs"
        value={networkAgentId}
        disabled={!connected || networkBusy}
        onChange={(event) => {
          setNetworkAgentId(event.target.value)
          setNetwork(undefined)
        }}
      >
        <option value="">Default Codex executable</option>
        {codexAgents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={!connected || networkBusy}
        onClick={async () => {
          const attempt = generation.current
          setNetworkBusy(true)
          setError('')
          try {
            const result = await request(
              '/api/agents/codex/network-diagnostics',
              networkAgentId ? { agentId: networkAgentId } : {},
              codexNetworkDiagnosticSchema,
            )
            if (attempt === generation.current) setNetwork(result)
          } catch (error) {
            if (attempt === generation.current) setError(String(error))
          } finally {
            setNetworkBusy(false)
          }
        }}
      >
        {networkBusy ? 'Testing Codex network…' : 'Test Codex network'}
      </Button>
      {network && (
        <div role="status" className="space-y-2 text-xs">
          <p>
            {network.ok ? 'Network diagnostic completed' : 'Network diagnostic failed'} ·{' '}
            {(network.durationMs / 1000).toFixed(1)}s
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{network.output}</pre>
        </div>
      )}
      {items.map((item) => (
        <details key={item.id} className="text-sm">
          <summary className="cursor-pointer">
            {item.name} · {item.installedVersion ?? 'Unavailable'} ·{' '}
            {item.updateStatus === 'update-available'
              ? `Update available: ${item.latestVersion}`
              : item.updateStatus === 'current'
                ? 'Up to date'
                : item.updateStatus === 'ahead'
                  ? 'Ahead of latest release'
                  : 'Version not confirmed'}
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            {item.detail} {item.guidance}
          </p>
        </details>
      ))}
    </section>
  )
}
