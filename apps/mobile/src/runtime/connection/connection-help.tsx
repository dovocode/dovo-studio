import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function ConnectionHelp({ pairing = false }: { pairing?: boolean }) {
  const { styles } = useTheme()

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>Start your computer</Text>
        <Text style={styles.muted}>
          Open Dovo on your computer and keep it awake. In Settings → Devices & runtime, sign in and
          enable Dovo Connect. Sign in to the same account on your phone and choose Connect. No
          pairing code, VPN or local IP is needed for internet access.
        </Text>
      </View>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>Direct internet connection</Text>
        <Text style={styles.muted}>
          WebRTC + STUN connects your phone directly to the computer. Your content is end-to-end
          encrypted. Enabling Dovo Connect permits an encrypted relay fallback if a network blocks
          direct connections. The relay forwards encrypted traffic; it cannot read your content.
        </Text>
      </View>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>LAN / VPN connections</Text>
        <Text style={styles.muted}>
          Pair LAN / VPN separately to prefer that connection when available. Copy the full Wi-Fi,
          Tailscale, NetBird, or HTTPS address shown on your computer, including its port. localhost
          and 0.0.0.0 are not addresses your phone can connect to.
        </Text>
      </View>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>Check your network</Text>
        <Text style={styles.muted}>
          Use the same Wi-Fi or connect both devices to your VPN. For Wi-Fi connections, allow Dovo
          access to your Local Network in iPhone Settings.
        </Text>
      </View>
      <Text style={styles.muted}>
        {pairing
          ? 'Pairing codes expire after two minutes. CLI codes approve automatically; a code from the desktop may need approval there.'
          : 'Your pairing is saved. Try Reconnect before generating another code. If the address changed, choose Update connection address in this computer’s settings.'}
      </Text>
    </View>
  )
}
