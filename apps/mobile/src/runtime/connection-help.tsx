import { View } from 'react-native'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'

export function ConnectionHelp({ pairing = false }: { pairing?: boolean }) {
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>Start your computer</Text>
        <Text style={styles.muted}>
          Open Dovo on your Mac and keep the Mac awake. In Settings → Devices & runtime, choose
          Manage for this computer. The installed Mac app’s background service keeps running after
          the window closes.
        </Text>
      </View>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>Use a reachable address</Text>
        <Text style={styles.muted}>
          Copy the full Wi-Fi, Tailscale, NetBird, or HTTPS address shown on your computer,
          including its port. localhost and 0.0.0.0 are not addresses your phone can connect to.
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
