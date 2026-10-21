import { View } from 'react-native'
import {
  decode,
  peerRelayProviderSchema,
  PEER_RELAY_CHOICES,
  peerRelayDescription,
  type PeerRelayProvider,
} from '@dovo/protocol'
import { Choice } from '../../ui/controls/choice'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function PeerRelayChoice({
  value,
  onChange,
  disabled = false,
  approval = false,
}: {
  value?: PeerRelayProvider
  onChange: (value: PeerRelayProvider | undefined) => void
  disabled?: boolean
  approval?: boolean
}) {
  const { styles } = useTheme()
  return (
    <View style={{ gap: 6 }}>
      <Choice
        label="Relay fallback"
        value={value ?? 'direct'}
        items={PEER_RELAY_CHOICES}
        disabled={disabled}
        onChange={(value) =>
          onChange(value === 'direct' ? undefined : decode(peerRelayProviderSchema, value))
        }
      />
      <Text style={styles.muted}>{peerRelayDescription(value)}</Text>
      {value === 'dovo' && !approval && (
        <Text style={styles.muted}>
          The computer must allow relay in its pairing QR. For a Direct-only pairing, generate a new
          Dovo-enabled QR on the computer and pair again.
        </Text>
      )}
    </View>
  )
}
