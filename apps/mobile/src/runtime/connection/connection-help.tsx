import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function ConnectionHelp({ pairing = false }: { pairing?: boolean }) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>
          <InterfaceText>{'Start your computer'}</InterfaceText>
        </Text>
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Open Dovo on your computer and keep it awake. In Settings → Devices & runtime, sign in and enable Dovo Connect. Sign in to the same account on your phone and choose Connect. No pairing code, VPN or local IP is needed for internet access.'
            }
          </InterfaceText>
        </Text>
      </View>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>
          <InterfaceText>{'Direct internet connection'}</InterfaceText>
        </Text>
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'WebRTC + STUN connects your phone directly to the computer. Your content is end-to-end encrypted. Enabling Dovo Connect permits an encrypted relay fallback if a network blocks direct connections. The relay forwards encrypted traffic; it cannot read your content.'
            }
          </InterfaceText>
        </Text>
      </View>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>
          <InterfaceText>{'LAN / VPN connections'}</InterfaceText>
        </Text>
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Pair LAN / VPN separately to prefer that connection when available. Copy the full Wi-Fi, Tailscale, NetBird, or HTTPS address shown on your computer, including its port. localhost and 0.0.0.0 are not addresses your phone can connect to.'
            }
          </InterfaceText>
        </Text>
      </View>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>
          <InterfaceText>{'Check your network'}</InterfaceText>
        </Text>
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Use the same Wi-Fi or connect both devices to your VPN. For Wi-Fi connections, allow Dovo access to your Local Network in iPhone Settings.'
            }
          </InterfaceText>
        </Text>
      </View>
      <Text style={styles.muted}>
        {pairing
          ? uiText(
              'Pairing codes expire after two minutes. CLI codes approve automatically; a code from the desktop may need approval there.',
            )
          : uiText(
              'Your pairing is saved. Try Reconnect before generating another code. If the address changed, choose Update connection address in this computer’s settings.',
            )}
      </Text>
    </View>
  )
}
