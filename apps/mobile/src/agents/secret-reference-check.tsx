import type { AgentSecretReference } from '@dovo/protocol'
import { responses } from '@dovo/protocol'
import { useSecretReferenceCheck } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { View } from 'react-native'

export function SecretReferenceCheck({
  reference,
  disabled,
}: {
  reference: AgentSecretReference
  disabled?: boolean
}) {
  const { call, connection, snapshot, connected } = useRuntime()
  const uiText = useInterfaceText()
  const state = useSecretReferenceCheck(reference, JSON.stringify(connection), (value) =>
    call('/api/agents/secrets/check', { reference: value }, responses.ok),
  )
  if (!snapshot?.secretReferenceCheckSupported) return null
  return (
    <View style={{ gap: 6 }}>
      <Action
        secondary
        disabled={disabled || !connected || state.busy}
        onPress={() => void state.run()}
        label={uiText(state.busy ? 'Checking reference…' : 'Check reference')}
      />
      {!!state.status && <Text accessibilityLiveRegion="polite">{uiText(state.status)}</Text>}
    </View>
  )
}
