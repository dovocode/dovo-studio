import { adapterDiagnosticsSchema, type AdapterDiagnostic } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
export function HarnessUpdates() {
  const { connected, request } = useWorkspace()
  const [items, setItems] = useApplicationState<AdapterDiagnostic[]>([])
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  async function check() {
    setBusy(true)
    setError('')
    try {
      setItems(
        await request('/api/agents/updates', { checkUpdates: true }, adapterDiagnosticsSchema),
      )
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">Harness updates</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || busy}
          onClick={() => void check()}
        >
          {busy ? 'Checking…' : 'Check for updates'}
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
