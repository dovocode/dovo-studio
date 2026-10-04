import { adapterDiagnosticsSchema, type AdapterDiagnostic } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace, useAppPreferences } from '@dovo/studio-core'
import { Button } from './components/ui/button'
import { useCallback, useEffect, useRef } from 'react'
export function HarnessUpdates() {
  const { providerUpdateChecks } = useAppPreferences()
  const { connected, request } = useWorkspace()
  const [items, setItems] = useApplicationState<AdapterDiagnostic[]>([])
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
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
