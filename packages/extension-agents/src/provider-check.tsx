import { useState } from 'react'
import { responses, useWorkspace, type Agent, type ProviderStatus } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
export function ProviderCheck({ agent }: { agent: Agent }) {
  const { connected, request } = useWorkspace()
  const [result, setResult] = useState<ProviderStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  function check() {
    setBusy(true)
    setError('')
    void request('/api/agents/probe', { id: agent.id }, responses.provider)
      .then(setResult)
      .catch((error) => setError(String(error)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="mt-4 space-y-2">
      <Button size="sm" variant="outline" disabled={!connected || busy} onClick={check}>
        {busy ? 'Checking…' : 'Check provider'}
      </Button>
      {result && (
        <p className="text-xs text-muted-foreground">
          {result.available ? 'Available' : 'Unavailable'} · {result.detail}
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
