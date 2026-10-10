import type { SettingsScope } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { responses, useWorkspace, type Agent, type ProviderStatus } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { CircleCheck, CircleX } from 'lucide-react'
export function ProviderCheck({
  agent,
  repositoryId,
  settingsScope,
}: {
  agent: Agent
  repositoryId?: string
  settingsScope?: SettingsScope
}) {
  const { connected, request } = useWorkspace()
  const [result, setResult] = useApplicationState<ProviderStatus | null>(null)
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  function check() {
    setBusy(true)
    setError('')
    setResult(null)
    void request(
      '/api/agents/probe',
      {
        id: agent.id,
        repositoryId,
        settingsScope,
      },
      responses.provider,
    )
      .then(setResult)
      .catch((error: unknown) => setError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="mt-3 space-y-3">
      <p className="leading-relaxed">
        Checks the saved profile on the connected computer to confirm its provider is installed and
        signed in. Unsaved changes are not included.
      </p>
      <Button size="sm" variant="outline" disabled={!connected || busy} onClick={check}>
        {busy ? 'Checking…' : 'Check provider'}
      </Button>
      {result && (
        <p role="status" className="flex items-start gap-2 text-xs">
          {result.available ? (
            <CircleCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
          ) : (
            <CircleX aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          )}
          <span className="min-w-0 break-words">
            <span className="font-medium text-foreground">
              {result.available ? 'Ready' : 'Not available'}
            </span>
            {result.detail ? ` · ${result.detail}` : ''}
          </span>
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
