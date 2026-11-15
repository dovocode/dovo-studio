import type { AgentSecretReference } from '@dovo/protocol'
import { responses } from '@dovo/protocol'
import { useWorkspace, useSecretReferenceCheck } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button } from './components/ui/button'

export function SecretReferenceCheck({
  reference,
  disabled,
}: {
  reference: AgentSecretReference
  disabled?: boolean
}) {
  const { request, connection, snapshot, connected } = useWorkspace()
  const uiText = useInterfaceText()
  const state = useSecretReferenceCheck(reference, JSON.stringify(connection), (value) =>
    request('/api/agents/secrets/check', { reference: value }, responses.ok),
  )
  if (!snapshot?.secretReferenceCheckSupported) return null
  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || !connected || state.busy}
        onClick={() => void state.run()}
      >
        {uiText(state.busy ? 'Checking reference…' : 'Check reference')}
      </Button>
      {state.status && (
        <p role="status" className="text-xs">
          {uiText(state.status)}
        </p>
      )}
    </div>
  )
}
