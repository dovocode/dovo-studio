import { Platform, View } from 'react-native'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'

export function ConnectionHelp({ pairing = false }: { pairing?: boolean }) {
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>Start your computer</Text>
        <Text style={styles.muted}>
          Keep it awake and start Dovo using the same data directory as your desktop app.
        </Text>
        <Text
          selectable
          style={[styles.muted, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}
        >
          pnpm server start --data-dir &lt;your-data-directory&gt;
        </Text>
        <Text
          selectable
          style={[styles.muted, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}
        >
          {pairing
            ? 'pnpm server pair --data-dir <your-data-directory>'
            : 'pnpm server status --data-dir <your-data-directory>'}
        </Text>
      </View>
      <View style={{ gap: 5 }}>
        <Text style={[styles.text, { fontWeight: '600' }]}>Use a reachable address</Text>
        <Text style={styles.muted}>
          Copy the full Wi-Fi, Tailscale, NetBird, or HTTPS address shown by the command, including
          its port. localhost and 0.0.0.0 are not addresses your phone can connect to.
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
          : 'Your pairing is saved. Try Reconnect before generating another code. If the computer address changed, pair it again using its new address.'}
      </Text>
    </View>
  )
}
